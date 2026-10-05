"""Self-check: dashboard tile permissions match MODULE_CONFIG and re-sync never re-grants.

Usage (from backend/): ../.venv/bin/python check_dashboard_tiles.py
"""
from modules.capex.service import *  # noqa: F401,F403  (register all mappers)
from modules.orders.service import *  # noqa: F401,F403

from db.session import SessionLocal
from modules.module_config import MODULE_CONFIG
from modules.platform.dashboard.app_router import DASHBOARD_TILE_CODES
from modules.rbac_constants import build_permission_code
from modules.rbac_sync import _backfill_dashboard_section_grants

dash = next(m for m in MODULE_CONFIG if m["key"] == "dashboard")
catalog = {build_permission_code("dashboard", t["key"], "view") for t in dash["tabs"]}
missing = set(DASHBOARD_TILE_CODES.values()) - catalog
assert not missing, f"tile codes missing from MODULE_CONFIG: {missing}"
assert len(DASHBOARD_TILE_CODES) == 11, DASHBOARD_TILE_CODES

db = SessionLocal()
try:
    assert _backfill_dashboard_section_grants(db, set()) == 0, "re-sync must not re-grant tiles"
finally:
    db.rollback()
print("OK: 11 dashboard tiles in catalog; re-sync grants nothing")
