"""Every admin route must depend on an auth or permission check."""

from __future__ import annotations

from fastapi.routing import APIRoute

from modules.asset_masters.router import router as asset_masters_router
from modules.assets.router import router as assets_router
from modules.capex.router import router as capex_router
from modules.disposals.router import router as disposals_router
from modules.orders.router import router as orders_router
from modules.platform.approvals.admin_router import router as approvals_router
from modules.platform.approvals.mappings_admin_router import router as mappings_router
from modules.platform.dashboard.router import router as dashboard_router
from modules.platform.emails.admin_router import router as emails_router
from modules.platform.features.router import router as features_router
from modules.platform.org_units.router import router as org_units_router
from modules.platform.permissions.router import router as permissions_router
from modules.platform.roles.router import router as roles_router
from modules.platform.settings.router import router as settings_router
from modules.platform.users.router import router as users_router
from modules.transfers.router import router as transfers_router

_GUARDS = {"permission_checker", "superuser_checker", "get_current_user"}

_ROUTERS = (
    asset_masters_router,
    assets_router,
    capex_router,
    disposals_router,
    orders_router,
    approvals_router,
    mappings_router,
    dashboard_router,
    emails_router,
    features_router,
    org_units_router,
    permissions_router,
    roles_router,
    settings_router,
    users_router,
    transfers_router,
)


def _calls(dep) -> set[str]:
    names: set[str] = set()
    call = getattr(dep, "call", None)
    if call is not None:
        names.add(getattr(call, "__name__", ""))
    for sub in getattr(dep, "dependencies", ()) or ():
        names |= _calls(sub)
    return names


def test_admin_routes_have_an_auth_dependency() -> None:
    missing: list[str] = []
    for router in _ROUTERS:
        prefix = router.prefix or ""
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            if _calls(route.dependant) & _GUARDS:
                continue
            missing.append(f"{','.join(sorted(route.methods))} {prefix}{route.path}")
    assert missing == []
