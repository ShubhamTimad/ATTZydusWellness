"""Import models so SQLAlchemy registers them on Base.metadata."""

from modules.platform.audit.model import AuditLog
from modules.platform.auth.model import PasswordResetToken, UserSession
from modules.platform.auth_policy.model import AuthPolicy
from modules.platform.mfa.model import MfaChallenge, MfaSetupToken, UserMfa
from modules.platform.features.model import Feature
from modules.platform.org_units.model import OrgUnit
from modules.platform.permissions.model import Permission
from modules.platform.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalStep,
    ApprovalTask,
    ApprovalWorkflow,
    ApprovalWorkflowMapping,
)
from modules.platform.rbac_audit.model import RbacAuditLog
from modules.platform.rbac_versioning.model import RbacCompanyPermissionVersion, RbacUserPermissionVersion
from modules.rbac_association import role_org_unit, role_permission, user_org_unit, user_role  # noqa: F401
from modules.platform.roles.model import Role
from modules.platform.settings.model import Setting
from modules.platform.users.model import User
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.assets.model import AssetCategory, AssetMaster  # noqa: F401
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem

__all__ = [
    "AuditLog",
    "Feature",
    "OrgUnit",
    "Permission",
    "ApprovalWorkflow",
    "ApprovalWorkflowMapping",
    "ApprovalStep",
    "ApprovalRequest",
    "ApprovalTask",
    "ApprovalAction",
    "RbacAuditLog",
    "RbacCompanyPermissionVersion",
    "RbacUserPermissionVersion",
    "Role",
    "Setting",
    "User",
    "UserSession",
    "PasswordResetToken",
    "AuthPolicy",
    "UserMfa",
    "MfaChallenge",
    "MfaSetupToken",
    "role_permission",
    "PhysicalOrder",
    "PhysicalOrderItem",
    "PhysicalOrderAudit",
    "CostCenterMaster",
    "FunctionalLocationMaster",
    "ActualLocationMaster",
    "ProfitCenterMaster",
    "TagColorMaster",
    "AssetMaster",
    "AssetCategory",
]
