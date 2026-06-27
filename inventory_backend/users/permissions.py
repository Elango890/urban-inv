from rest_framework.permissions import BasePermission

ROLE_ADMIN = "admin"
ROLE_STAFF = "staff"
ROLE_SALESPERSON = "salesperson"

ALL_ROLES = (
    ROLE_ADMIN,
    ROLE_STAFF,
    ROLE_SALESPERSON,
)
OPERATIONS_ROLES = (
    ROLE_ADMIN,
    ROLE_STAFF,
)
SALES_ROLES = (
    ROLE_ADMIN,
    ROLE_STAFF,
    ROLE_SALESPERSON,
)
CUSTOMER_ROLES = SALES_ROLES
ADMIN_ONLY_ROLES = (ROLE_ADMIN,)


class HasAllowedRoles(BasePermission):
    message = "You do not have permission to access this resource."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        allowed_roles = getattr(view, "allowed_roles", None)
        if not allowed_roles:
            return True
        if getattr(request.user, "is_superuser", False):
            return True
        return request.user.role in allowed_roles


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", "").lower() == ROLE_ADMIN
        )
    
