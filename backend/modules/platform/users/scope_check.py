"""Self-check for viewer org scope rules.

Run: PYTHONPATH=backend python -m modules.platform.users.scope_check
"""

from __future__ import annotations

from types import SimpleNamespace

from modules.platform.users.scope import (
    ViewerOrgScope,
    asset_in_scope,
    effective_plant_id,
)


def main() -> None:
    open_scope = ViewerOrgScope(None, None, None)
    assert open_scope.unrestricted
    assert effective_plant_id(open_scope, 5) == 5

    plant_only = ViewerOrgScope(frozenset({1, 2}), None, None)
    assert effective_plant_id(plant_only, 1) == 1
    assert effective_plant_id(plant_only, 9) is False

    cc_scope = ViewerOrgScope(
        frozenset({1}),
        frozenset({(1, "CC01"), (1, "CC02")}),
        frozenset({10, 11}),
    )
    assert effective_plant_id(cc_scope, 1) == 1
    assert effective_plant_id(cc_scope, 2) is False

    in_cc = SimpleNamespace(
        location=SimpleNamespace(plant_id=1),
        financial=SimpleNamespace(cost_center="CC01"),
    )
    other_cc = SimpleNamespace(
        location=SimpleNamespace(plant_id=1),
        financial=SimpleNamespace(cost_center="CC99"),
    )
    assert asset_in_scope(in_cc, cc_scope)
    assert not asset_in_scope(other_cc, cc_scope)
    assert asset_in_scope(other_cc, plant_only)
    print("ok")


if __name__ == "__main__":
    main()
