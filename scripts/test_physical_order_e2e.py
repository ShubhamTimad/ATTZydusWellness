#!/usr/bin/env python3
"""End-to-end physical order create → approve → execute → audit check."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8000"
PASSWORD = "ChangeMe@123"


def login(email: str) -> str:
    r = httpx.post(
        f"{BASE}/login",
        json={"email": email, "password": PASSWORD},
        timeout=30.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Login failed for {email}: {r.status_code} {r.text}")
    data = r.json()
    if "access_token" not in data:
        raise RuntimeError(f"Login response missing token: {data}")
    return data["access_token"]


def api(token: str, method: str, path: str, **kwargs) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"}
    return httpx.request(method, f"{BASE}{path}", headers=headers, timeout=60.0, **kwargs)


def main() -> int:
    errors: list[str] = []
    checks: list[str] = []

    try:
        creator_token = login("operator@demo.com")
        executor_token = login("executor1@demo.com")
    except Exception as e:
        print(f"FAIL: {e}")
        print("Ensure API is running and demo users exist (seed_manual_test_users.py).")
        return 1

    # Pick RFID assets on same cost center (DEMO-AST-002 / 008 use CC-4200 in seed).
    r = api(creator_token, "GET", "/admin/assets", params={"page": 1, "page_size": 50, "search": "DEMO-AST"})
    if r.status_code != 200:
        print(f"FAIL list assets: {r.status_code} {r.text}")
        return 1
    items = r.json().get("items") or []
    candidates = [
        a
        for a in items
        if (a.get("rfid_code") or "").strip()
        and a.get("cost_center_code") == "CC-4200"
        and a.get("lifecycle_status") == "active"
    ]
    if len(candidates) < 1:
        candidates = [a for a in items if (a.get("rfid_code") or "").strip()][:2]
    if not candidates:
        print("FAIL: no RFID-tagged demo assets")
        return 1

    asset_ids = [int(candidates[0]["id"])]
    asset_code = candidates[0]["asset_code"]
    rfid = (candidates[0].get("rfid_code") or "").strip()
    print(f"Using asset {asset_code} (id={asset_ids[0]}, rfid={rfid})")

    r = api(
        creator_token,
        "POST",
        "/admin/physical-orders/validate-assets",
        json={"asset_ids": asset_ids},
    )
    if r.status_code != 200:
        errors.append(f"validate-assets: {r.status_code} {r.text}")
    else:
        val = r.json()
        checks.append(f"validate: eligible={val.get('eligible_asset_ids')} fy={val.get('financial_year_label')}")
        if not val.get("eligible_asset_ids"):
            errors.append("validate returned no eligible assets")

    r = api(creator_token, "GET", "/admin/physical-orders/executors")
    if r.status_code != 200:
        errors.append(f"executors: {r.status_code} {r.text}")
        executor_pool = []
        executor_id = 1
    else:
        payload = r.json()
        checks.append(f"executor workflow role={payload.get('role_name')}")
        executor_pool = payload.get("items") or []
        executor_id = next((e["id"] for e in executor_pool if e.get("email") == "executor1@demo.com"), None)
        if executor_id is None and executor_pool:
            executor_id = executor_pool[0]["id"]
        if executor_id is None:
            errors.append("No executors returned from workflow role")
            executor_id = 1

    reset_ids: list[int] = []
    if val.get("already_verified_in_fy"):
        fy_ids = {a["asset_id"] for a in val["already_verified_in_fy"]}
        reset_ids = [i for i in asset_ids if i in fy_ids]

    r = api(
        creator_token,
        "POST",
        "/admin/physical-orders",
        json={
            "asset_ids": asset_ids,
            "assigned_to": executor_id,
            "remarks": "E2E test order",
            "submit": True,
            "reset_verification_asset_ids": reset_ids,
        },
    )
    if r.status_code not in (200, 201):
        errors.append(f"create order: {r.status_code} {r.text}")
        print(json.dumps(errors, indent=2))
        return 1

    order = r.json()
    order_id = order["id"]
    order_number = order["order_number"]
    checks.append(f"created order {order_number} status={order['status']}")

    r = api(creator_token, "GET", f"/admin/physical-orders/{order_id}")
    if r.status_code != 200:
        errors.append(f"get order after create: {r.status_code}")
    else:
        order = r.json()
    checks.append(f"items={len(order.get('items') or [])} audit_rows={len(order.get('audit') or [])}")
    if not order.get("items"):
        errors.append("order has no items after create")

    if order.get("status") != "assigned":
        errors.append(f"expected assigned after create+submit, got {order.get('status')}")

    if not order.get("created_by_name"):
        errors.append("created_by_name empty on detail")
    if not order.get("assigned_to_name"):
        errors.append("assigned_to_name empty after submit")

    progress_keys = [s.get("key") for s in (order.get("progress") or {}).get("steps") or []]
    for required in ("order_created", "assigned", "in_progress", "completed", "closed"):
        if required not in progress_keys:
            errors.append(f"progress stepper missing {required}: {progress_keys}")

    # Executor runs order
    r = api(executor_token, "POST", f"/admin/physical-orders/{order_id}/start")
    if r.status_code != 200:
        errors.append(f"start: {r.status_code} {r.text}")
    else:
        started = r.json()
        checks.append(f"after start status={started.get('status')}")
        if started.get("status") != "in_progress":
            errors.append(f"expected in_progress, got {started.get('status')}")

    r = api(
        executor_token,
        "POST",
        f"/admin/physical-orders/{order_id}/scan",
        json={"scan_value": rfid},
    )
    if r.status_code != 200:
        errors.append(f"scan: {r.status_code} {r.text}")
    else:
        scan = r.json()
        item = scan.get("item") or {}
        checks.append(
            f"scan verified_count={scan.get('verified_count')} physically_verified={item.get('physically_verified')}"
        )
        if not item.get("physically_verified"):
            errors.append("item not physically_verified after scan")

    r = api(executor_token, "GET", f"/admin/physical-orders/{order_id}")
    final_order = r.json()
    checks.append(f"final status={final_order.get('status')} verified={final_order.get('physically_verified_count')}")

    # Asset audit
    r = api(creator_token, "GET", f"/admin/assets/{asset_ids[0]}/audit")
    if r.status_code != 200:
        errors.append(f"asset audit: {r.status_code} {r.text}")
    else:
        audit = r.json()
        actions = [e.get("action") for e in audit]
        checks.append(f"asset audit events ({len(audit)}): {actions[:8]}")
        expected_actions = {"physical_order_created", "physical_order_started", "physical_order_verified"}
        if reset_ids:
            expected_actions.add("physical_verification_reset")
        # Legacy create-approval may still write physical_order_approved; not required in new flow.
        missing = expected_actions - set(actions)
        if missing:
            errors.append(f"asset audit missing actions: {sorted(missing)}")
        for ev in audit[:5]:
            if ev.get("action") in expected_actions and not ev.get("summary"):
                errors.append(f"audit event {ev.get('action')} missing summary")

    # Inventory fields on asset detail
    r = api(creator_token, "GET", f"/admin/assets/{asset_ids[0]}")
    if r.status_code == 200:
        asset = r.json()
        inv = asset.get("inventory") or {}
        checks.append(f"inventory physical_count={inv.get('physical_count')} last_verification={inv.get('last_verification_date')}")
        if inv.get("physical_count") != 1:
            errors.append(f"expected physical_count=1 after scan, got {inv.get('physical_count')}")

    print("=== Physical order E2E ===")
    for c in checks:
        print(f"  OK: {c}")
    if errors:
        print("=== ERRORS ===")
        for e in errors:
            print(f"  FAIL: {e}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
