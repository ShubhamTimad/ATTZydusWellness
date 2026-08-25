import os
import json
import logging
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from starlette.middleware.cors import CORSMiddleware

from admin_api.routes import router as admin_api_router
from app_api.routes import router as app_api_router
from core.logging_setup import configure_logging
from core.request_context import get_request_id
from core.request_logging_middleware import RequestLoggingMiddleware
from core.sentry_setup import capture_exception, init_sentry, sentry_enabled
from modules.platform.audit import AdminAuditMiddleware
from modules.platform.auth.session_idle_middleware import SessionIdleMiddleware

from db.session import SessionLocal
from modules.rbac_sync import sync_all_modules_to_db

configure_logging()
init_sentry()
logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or get_request_id()

# Behind nginx, the API is mounted at /api/ (see frontend/nginx.conf). Swagger UI
# must fetch /api/openapi.json; without root_path it requests /openapi.json and
# gets the SPA HTML → "definition does not specify a valid version field".
_root_path = (os.getenv("ROOT_PATH") or "").strip().rstrip("/")
app = FastAPI(root_path=_root_path)
app.add_middleware(AdminAuditMiddleware)
app.add_middleware(SessionIdleMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Outermost: times full stack and stamps X-Request-ID on every response.
app.add_middleware(RequestLoggingMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.warning(
        "request_validation_failed",
        extra={
            "event": "request_validation_failed",
            "method": request.method,
            "path": request.url.path,
            "error_count": len(exc.errors()),
        },
    )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "request_id": _request_id(request)},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if exc.status_code >= 500:
        capture_exception(exc)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "request_id": _request_id(request)},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Custom handlers swallow the exception; send to Sentry explicitly.
    capture_exception(exc)
    logger.exception(
        "unhandled_exception",
        extra={
            "event": "unhandled_exception",
            "method": request.method,
            "path": request.url.path,
            "error_type": type(exc).__name__,
        },
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": _request_id(request)},
    )


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@app.get("/sentry-debug", include_in_schema=False)
def sentry_debug(
    request: Request,
    token: str = Query(default=""),
) -> JSONResponse:
    """
    Fire a test exception to Sentry (verify DSN on local/Docker/server).

    Only works when ``SENTRY_DEBUG_TOKEN`` is set and matches ``?token=…``.
    Example: GET /api/sentry-debug?token=your-secret  (behind nginx ROOT_PATH=/api)
    """
    expected = (os.getenv("SENTRY_DEBUG_TOKEN") or "").strip()
    if not expected or token != expected:
        raise HTTPException(status_code=404, detail="Not found")
    if not sentry_enabled():
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Sentry is not configured (set SENTRY_DSN).",
                "request_id": _request_id(request),
            },
        )
    raise RuntimeError("Sentry debug probe — safe to ignore")


@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
def admin_root_redirect() -> RedirectResponse:
    """
    Convenience redirect for humans in a browser.

    The admin UI is served by the frontend app; the backend mounts JSON APIs at /admin/*.
    """
    target = os.getenv("FRONTEND_ADMIN_URL", "http://localhost:5173/admin")
    return RedirectResponse(url=target, status_code=307)


@app.get("/admin/login", include_in_schema=False)
@app.get("/admin/login/", include_in_schema=False)
def admin_login_redirect() -> RedirectResponse:
    target = os.getenv("FRONTEND_ADMIN_URL", "http://localhost:5173/admin")
    return RedirectResponse(url=f"{target.rstrip('/')}/login", status_code=307)


@app.get("/deploy-now", include_in_schema=False)
def deploy_now(token: str = Query(default="")) -> HTMLResponse:
    """
    Trigger a develop deploy from Teams (optional).
    Requires DEPLOY_NOW_TOKEN + GH_PAT (Actions: write) + GITHUB_REPOSITORY.
    """
    expected = (os.getenv("DEPLOY_NOW_TOKEN") or "").strip()
    if not expected or token != expected:
        raise HTTPException(status_code=404, detail="Not found")

    pat = (os.getenv("GH_PAT") or os.getenv("GITHUB_DEPLOY_PAT") or "").strip()
    repo = (os.getenv("GITHUB_REPOSITORY") or "").strip()
    if not pat or not repo:
        raise HTTPException(status_code=503, detail="Deploy-now is not configured on the server")

    url = f"https://api.github.com/repos/{repo}/actions/workflows/deploy-develop.yml/dispatches"
    body = json.dumps({"ref": "develop"}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {pat}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "takeda-att-deploy-now",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = getattr(resp, "status", 204)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise HTTPException(status_code=502, detail=f"GitHub API {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise HTTPException(status_code=502, detail=f"GitHub request failed: {e}") from e

    if status not in (201, 204):
        raise HTTPException(status_code=502, detail=f"Unexpected GitHub status {status}")

    return HTMLResponse(
        "<!doctype html><html><body style='font-family:system-ui;padding:2rem'>"
        "<h1>Deploy started</h1>"
        "<p>A develop deploy has been started. You can close this tab.</p>"
        "<p>You can close this tab.</p>"
        "</body></html>"
    )


if _env_flag("SYNC_MODULES_ON_STARTUP", True):
    db = SessionLocal()
    sync_all_modules_to_db(db)
    db.close()

app.include_router(app_api_router)
app.include_router(admin_api_router, prefix="/admin")
