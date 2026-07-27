"""Self-check for plant → department / cost-center multi-assignment rules.

Run: PYTHONPATH=backend python -m modules.platform.users.hierarchy_check
"""

from __future__ import annotations


def _departments_ok(*, dept_parent_ids: list[int | None], plant_ids: set[int]) -> bool:
    if not dept_parent_ids:
        return True
    if not plant_ids:
        return False
    return all(pid is not None and int(pid) in plant_ids for pid in dept_parent_ids)


def _cost_centers_ok(*, cc_plant_ids: list[int], plant_ids: set[int], active: list[bool]) -> bool:
    if not cc_plant_ids:
        return True
    if not plant_ids:
        return False
    return all(int(p) in plant_ids and a for p, a in zip(cc_plant_ids, active, strict=True))


def _assignment_ok(*, has_plant: bool, has_department: bool, has_cost_center: bool) -> bool:
    """Valid: plant only; plant+CC; plant+dept; plant+dept+CC. Invalid without plant."""
    if not has_plant:
        return False
    return True


def main() -> None:
    plants = {1, 2}
    assert _departments_ok(dept_parent_ids=[1, 2], plant_ids=plants)
    assert not _departments_ok(dept_parent_ids=[1, 3], plant_ids=plants)
    assert not _departments_ok(dept_parent_ids=[1], plant_ids=set())
    assert _cost_centers_ok(cc_plant_ids=[1, 2], plant_ids=plants, active=[True, True])
    assert not _cost_centers_ok(cc_plant_ids=[1, 2], plant_ids=plants, active=[True, False])
    assert not _cost_centers_ok(cc_plant_ids=[1, 9], plant_ids=plants, active=[True, True])
    # Department optional: plant + cost center is valid.
    assert _assignment_ok(has_plant=True, has_department=False, has_cost_center=True)
    assert _assignment_ok(has_plant=True, has_department=True, has_cost_center=True)
    assert _assignment_ok(has_plant=True, has_department=False, has_cost_center=False)
    assert not _assignment_ok(has_plant=False, has_department=False, has_cost_center=True)
    print("ok")


if __name__ == "__main__":
    main()
