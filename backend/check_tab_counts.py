"""Self-check: list tab badges must equal the rows each tab returns under the same search.

Usage (from backend/): python check_tab_counts.py <user_id> [search]
"""
import sys

from db.session import SessionLocal
from modules.assets.service import AssetMasterService
from modules.capex.service import CapexFormService
from modules.disposals.service import DisposalOrderService
from modules.orders.service import PhysicalOrderService
from modules.transfers.service import TransferOrderService

uid = int(sys.argv[1])
search = sys.argv[2] if len(sys.argv) > 2 else "a"
db = SessionLocal()
try:
    lists = {
        "transfers": lambda tab: TransferOrderService(db).list_orders(
            tab=tab, page=1, page_size=1, viewer_user_id=uid, search=search
        ),
        "disposals": lambda tab: DisposalOrderService(db).list_orders(
            tab=tab, page=1, page_size=1, viewer_user_id=uid, search=search
        ),
        "capex": lambda tab: CapexFormService(db).list_forms(
            tab=tab, page=1, page_size=1, viewer_user_id=uid, search=search
        ),
        "orders": lambda tab: PhysicalOrderService(db).list_orders(
            tab=tab, page=1, page_size=1, viewer_id=uid, search=search
        ),
    }
    for name, fetch in lists.items():
        badges = fetch("all").tab_counts
        for tab in ("all", "needs_action"):
            total = fetch(tab).total
            assert badges[tab] == total, f"{name}/{tab}: badge {badges[tab]} != rows {total}"
            print(f"ok {name}/{tab}: {total}")

    assets = AssetMasterService(db)
    badges = assets.list_assets(page_size=1, viewer_user_id=uid, search=search).tab_counts
    for tab in ("all", "approved", "draft", "pending", "rejected"):
        total = assets.list_assets(
            page_size=1, viewer_user_id=uid, search=search, approval_status=None if tab == "all" else tab
        ).total
        assert badges[tab] == total, f"assets/{tab}: badge {badges[tab]} != rows {total}"
        print(f"ok assets/{tab}: {total}")
finally:
    db.rollback()
    db.close()
