import os

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware

from admin_api.routes import router as admin_api_router
from app_api.routes import router as app_api_router
from modules.platform.audit import AdminAuditMiddleware
from modules.platform.auth.session_idle_middleware import SessionIdleMiddleware

from db.session import SessionLocal
from modules.rbac_sync import sync_all_modules_to_db

app = FastAPI()
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


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


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
