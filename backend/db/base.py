from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass

# Import ALL models

from modules.platform.users.model import *
from modules.platform.roles.model import *
from modules.platform.permissions.model import *
from modules.platform.org_units.model import *

from modules.assets.model import *
from modules.orders.model import *

from modules.platform.auth.model import *

from modules.platform.approvals.model import *

from modules.platform.features.model import *

from modules.platform.settings.model import *

from modules.platform.audit.model import *

from modules.platform.emails.model import *

from modules.platform.auth_policy.model import *

from modules.platform.auth.model import *

from modules.platform.rbac_audit.model import *

from modules.platform.rbac_versioning.model import *
