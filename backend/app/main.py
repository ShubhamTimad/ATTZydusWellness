import os
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.cors import CORSMiddleware

from admin_api.routes import router as admin_api_router
from app_api.routes import router as app_api_router
from core.logging_setup import configure_logging
from core.request_context import get_request_id
from core.request_logging_middleware import RequestLoggingMiddleware
from modules.platform.audit import AdminAuditMiddleware
from modules.platform.auth.session_idle_middleware import SessionIdleMiddleware

from db.session import SessionLocal, engine
from modules.rbac_sync import sync_all_modules_to_db

configure_logging()
logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or get_request_id()

# Behind nginx, the API is mounted at /api/ (see frontend/nginx.conf). Swagger UI
# must fetch /api/openapi.json; without root_path it requests /openapi.json and
# gets the SPA HTML → "definition does not specify a valid version field".
_root_path = (os.getenv("ROOT_PATH") or "").strip().rstrip("/")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Docs stay on for local dev. Compose sets ENABLE_API_DOCS=false.
_docs_enabled = _env_flag("ENABLE_API_DOCS", True)
app = FastAPI(
    root_path=_root_path,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)
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
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "request_id": _request_id(request)},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
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


@app.get("/health", include_in_schema=False)
def health():
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health_db_failed")
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ok"}


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


if _env_flag("SYNC_MODULES_ON_STARTUP", True):
    db = SessionLocal()
    sync_all_modules_to_db(db)
    db.close()

app.include_router(app_api_router)
app.include_router(admin_api_router, prefix="/admin")
