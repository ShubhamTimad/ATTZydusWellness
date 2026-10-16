"""ponytail: approval mail must open the record page, not My Tasks."""

from __future__ import annotations

import os

from modules.assets.lifecycle import approval_action_link, entity_label_for_type


def test_action_link_uses_entity_page_not_tasks() -> None:
    os.environ["FRONTEND_APP_URL"] = "https://app.example.com"
    cases = {
        "physical_order_creation": "https://app.example.com/dashboard/orders/9",
        "physical_order_closure": "https://app.example.com/dashboard/orders/9",
        "transfer_order": "https://app.example.com/dashboard/transfer-orders/9",
        "disposal_order": "https://app.example.com/dashboard/disposal-orders/9",
        "disposal_order_engineering": "https://app.example.com/dashboard/disposal-orders/9",
        "capitalization_request": "https://app.example.com/dashboard/capitalization/9",
        "asset_creation": "https://app.example.com/dashboard/assets/9",
        "user_creation": "https://app.example.com/dashboard/users/9",
    }
    for entity_type, expected in cases.items():
        link = approval_action_link(entity_type, 9)
        assert link == expected, (entity_type, link)
        assert "/dashboard/tasks/" not in link
    assert entity_label_for_type("physical_order_closure") == "Order"
    assert entity_label_for_type("transfer_order") == "Transfer"
    assert entity_label_for_type("unknown_thing") == "Record"


if __name__ == "__main__":
    test_action_link_uses_entity_page_not_tasks()
    print("ok")
