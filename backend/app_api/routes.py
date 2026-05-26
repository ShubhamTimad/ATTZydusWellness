"""Aggregate public / app API routers — mounted at ``/``."""

from fastapi import APIRouter

from modules.platform.auth.routes import router as auth_router
from modules.platform.auth.mfa_routes import router as mfa_router
from modules.platform.approvals.router import router as approvals_router
from modules.platform.audit.router import router as audit_router
from modules.platform.dashboard.app_router import router as dashboard_router
from modules.platform.tasks.router import router as tasks_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(mfa_router)
router.include_router(approvals_router)
router.include_router(audit_router)
router.include_router(dashboard_router)
router.include_router(tasks_router)
