"""Self-check for viewer org scope rules.

Run: PYTHONPATH=backend python -m modules.platform.users.scope_check
"""

from __future__ import annotations

from modules.platform.users.scope import ViewerOrgScope, effective_plant_id


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
    print("ok")


if __name__ == "__main__":
    main()
