"""Import models so SQLAlchemy registers them on Base.metadata."""

from modules.platform.audit.model import AuditLog
from modules.platform.auth.model import PasswordResetToken, SsoExchangeCode, UserSession
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
from modules.rbac_association import (
    approval_step_roles,
    role_org_unit,
    role_permission,
    user_cost_center,
    user_department,
    user_org_unit,
    user_role,
)  # noqa: F401
from modules.platform.roles.model import Role
from modules.platform.settings.model import Setting
from modules.platform.users.model import User
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterAssetCustodian,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.assets.model import AssetCategory, AssetFieldConfig, AssetMaster  # noqa: F401
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem
from modules.transfers.model import AssetTransferOrder, AssetTransferOrderAudit, AssetTransferOrderItem
from modules.disposals.model import (
    AssetDisposalOrder,
    AssetDisposalOrderAudit,
    AssetDisposalOrderItem,
)
from modules.capex.model import CapitalizationForm, CapitalizationFormAudit

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
    "AssetTransferOrder",
    "AssetTransferOrderItem",
    "AssetTransferOrderAudit",
    "AssetDisposalOrder",
    "AssetDisposalOrderItem",
    "AssetDisposalOrderAudit",
    "CapitalizationForm",
    "CapitalizationFormAudit",
    "CostCenterMaster",
    "CostCenterAssetCustodian",
    "FunctionalLocationMaster",
    "ActualLocationMaster",
    "ProfitCenterMaster",
    "TagColorMaster",
    "AssetMaster",
    "AssetCategory",
    "AssetFieldConfig",
]
