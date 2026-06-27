# =============================================================================
# users/views.py
#
# Authentication + user management API.
#
# FIXES vs original:
#   1. User asset allocation endpoints are retired and return empty states
#   2. ProfileView returns 'assetsAssigned' (matching frontend expectation)
#      instead of 'active_assets' mismatch
#   3. UserList returns all fields including returned_assets + total_assets
#   4. LoginView: removed debug print statements (password logged to console)
#   5. UpdateUserView: is_staff sync happens after role set (was before)
#   6. Error responses consistently use _err() helper
#
# Endpoints (prefix: /api/users/):
#   POST  login/
#   POST  logout/
#   POST  register/
#   GET   users/
#   PUT   update/<user_id>/
#   GET   my-assets/
#   GET   assets/<user_id>/
#   POST  reset-password/<user_id>/
#   DELETE delete/<user_id>/
#   GET   profile/
#   PUT   profile/update/
#   POST  profile/change-password/
# =============================================================================

import random
import string
import logging

from django.contrib.auth import authenticate
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from audit.utils import create_audit_log
from inventory_backend.emailing import send_templated_email
from .models import User
from .permissions import IsAdmin
from inventory_backend.api_errors import error_response, field_errors

sec_logger = logging.getLogger("app.security")


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _err(msg, code=400, errors=None):
    return error_response(msg, code=code, errors=errors)


def _generate_password(length=12) -> str:
    chars = string.ascii_letters + string.digits + "@#$%&*"
    return "".join(random.choice(chars) for _ in range(length))


def _send_credentials_email(
    name: str,
    email: str,
    password: str,
    subject: str | None = None,
    role: str | None = None,
    department: str | None = None,
    title: str | None = None,
    intro: str | None = None,
    preheader: str | None = None,
):
    """Send temporary password email. Silently swallows send failures."""
    try:
        mail_subject = subject or "Your Account Credentials — InvenTrack"
        send_templated_email(
            subject=mail_subject,
            to=[email],
            template_name="user_credentials",
            context={
                "subject": mail_subject,
                "preheader": preheader or "Your account access details are ready.",
                "title": title or "Account Credentials",
                "intro": intro or "Your account has been created or updated successfully.",
                "recipient_name": name,
                "message_intro": intro or "Your account access details are listed below.",
                "login_email": email,
                "password": password,
                "role": role.title() if role else None,
                "department": department or None,
            },
        )
    except Exception:
        pass


def _serialize_user(user: User) -> dict:
    """Full serialisation of a User row."""
    return {
        "id":              user.id,
        "name":            user.name,
        "email":           user.email,
        "role":            user.role,
        "department":      user.department or "",
        "last_login":      user.last_login.isoformat() if user.last_login else None,
        "assetsAssigned":  user.assets_count,
        "returned_assets": user.returned_assets_count,
        "total_assets":    user.total_assets_count,
        "status":          "active" if user.is_active else "inactive",
        "is_active":       user.is_active,
        "created_at":      user.created_at.isoformat() if hasattr(user, "created_at") and user.created_at else None,
    }


def _client_ip(request):
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


# =============================================================================
# §1  AUTH
# =============================================================================

class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email    = request.data.get("username") or request.data.get("email")
        password = request.data.get("password")

        # FIX: removed debug print(password) — never log passwords
        if not email or not password:
            sec_logger.info(
                "login_failed missing_credentials email=%s ip=%s",
                email or "",
                _client_ip(request),
            )
            errors = {}
            if not email:
                errors.update(field_errors("email", "Email is required."))
            if not password:
                errors.update(field_errors("password", "Password is required."))
            return _err("Validation failed", errors=errors)

        user = authenticate(email=email, password=password)
        if not user:
            sec_logger.info(
                "login_failed invalid_credentials email=%s ip=%s",
                email or "",
                _client_ip(request),
            )
            return _err("Invalid credentials", 401)
        if not user.is_active:
            sec_logger.info(
                "login_failed inactive_account email=%s ip=%s",
                email or "",
                _client_ip(request),
            )
            return _err("Account is inactive", 403)

        refresh = RefreshToken.for_user(user)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        sec_logger.info(
            "login_success user_id=%s email=%s ip=%s",
            user.id,
            user.email,
            _client_ip(request),
        )

        create_audit_log(
            user=user,
            action="login",
            resource=user.email,
            resource_type="User",
            request=request,
            details=f"User {user.name} logged in",
        )

        return Response({
            "access_token":  str(refresh.access_token),
            "refresh_token": str(refresh),
            "role":          user.role,
            "name":          user.name,
            "email":         user.email,
            "id":            user.id,
        })


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        create_audit_log(
            user=request.user,
            action="logout",
            resource=request.user.email,
            resource_type="User",
            request=request,
            details=f"User {request.user.name} logged out",
        )
        sec_logger.info(
            "logout user_id=%s email=%s ip=%s",
            request.user.id,
            request.user.email,
            _client_ip(request),
        )
        return Response({"message": "Logged out successfully"})


# =============================================================================
# §2  USER MANAGEMENT  (admin-only)
# =============================================================================

class RegisterUserView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request):
        d          = request.data
        name       = (d.get("name") or "").strip()
        email      = (d.get("email") or "").strip().lower()
        role       = (d.get("role") or "staff").lower()
        department = (d.get("department") or "").strip() or None

        if not name or not email:
            errors = {}
            if not name:
                errors.update(field_errors("name", "Name is required."))
            if not email:
                errors.update(field_errors("email", "Email is required."))
            return _err("Validation failed", errors=errors)
        if role not in ("admin", "staff", "salesperson"):
            return _err(
                "Validation failed",
                errors=field_errors("role", "Role must be admin, staff, or salesperson."),
            )
        if User.objects.filter(email=email).exists():
            return _err(
                "Validation failed",
                errors=field_errors("email", "Email already registered."),
            )

        password    = _generate_password() if role in ("admin", "staff", "salesperson") else None
        user        = User.objects.create_user(
            email=email, name=name, password=password,
            role=role, department=department,
        )
        user.is_staff = (role == "admin")
        user.save(update_fields=["is_staff"])

        if password:
            _send_credentials_email(
                name,
                email,
                password,
                subject="Welcome to InvenTrack — Your Account Is Ready",
                role=role,
                department=department,
                title="Welcome to InvenTrack",
                intro="Your user account has been created successfully. Use the temporary password below to sign in for the first time.",
                preheader="Your new InvenTrack account is ready to use.",
            )

        create_audit_log(
            user=request.user,
            action="create",
            resource=user.email,
            resource_type="User",
            request=request,
            details=f"User {user.name} created with role {user.role}",
            changes={"role": role, "email": email, "department": department},
        )

        return Response({
            "message":            "User created successfully",
            "id":                 user.id,
            "name":               user.name,
            "email":              user.email,
            "role":               user.role,
            "department":         user.department or "",
            "password_sent":      password is not None,
        }, status=201)


class UserList(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        users = User.objects.all()

        # Optional filters
        search = request.GET.get("search", "").strip()
        role   = request.GET.get("role",   "").strip()
        dept   = request.GET.get("department", "").strip()
        active = request.GET.get("isActive")

        if search:
            users = users.filter(name__icontains=search)
        if role:
            users = users.filter(role=role)
        if dept:
            users = users.filter(department__icontains=dept)
        if active is not None:
            users = users.filter(is_active=(active.lower() == "true"))

        if request.user.role != "admin":
            if role and role != "salesperson":
                return _err("You do not have permission to view that user list.", 403)
            if active not in (None, "", "true", "True", "TRUE"):
                return _err("You do not have permission to view inactive users.", 403)
            users = users.filter(role="salesperson", is_active=True)

        return Response([_serialize_user(u) for u in users])


class UpdateUserView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def put(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)

        d           = request.data
        new_password = None
        changes      = {}

        # Name
        name = (d.get("name") or "").strip()
        if name and name != user.name:
            user.name = name
            changes["name"] = name

        # Email — changing email forces a password reset
        email = (d.get("email") or "").strip().lower()
        if email and email != user.email:
            if User.objects.exclude(id=user.id).filter(email=email).exists():
                return _err(
                    "Validation failed",
                    errors=field_errors("email", "Email already in use."),
                )
            new_password = _generate_password()
            user.email   = email
            user.set_password(new_password)
            changes["email"] = email

        # Department
        dept = d.get("department")
        if dept is not None and dept != user.department:
            user.department = dept or None
            changes["department"] = dept

        # Status
        user_status = d.get("status")
        if user_status is not None:
            new_active = user_status.lower() == "active"
            if new_active != user.is_active:
                user.is_active = new_active
                changes["status"] = user_status

        # Role updates among the supported user roles
        role = (d.get("role") or "").lower()
        if role:
            if role not in ("admin", "staff", "salesperson"):
                return _err(
                    "Validation failed",
                    errors=field_errors("role", "Role must be admin, staff, or salesperson."),
                )
            if role != user.role:
                user.role = role
                changes["role"] = role
            # FIX: set is_staff AFTER role has been updated
            user.is_staff = (user.role == "admin")

        user.save()

        if new_password:
            _send_credentials_email(
                user.name, user.email, new_password,
                subject="Your InvenTrack Account Has Been Updated",
                role=user.role,
                department=user.department,
                title="Account Updated",
                intro="Your account login details were updated. Please use the temporary password below and change it immediately after signing in.",
                preheader="Your updated InvenTrack login details are ready.",
            )

        create_audit_log(
            user=request.user,
            action="update",
            resource=user.email,
            resource_type="User",
            request=request,
            details=f"User {user.name} updated",
            changes=changes,
        )

        return Response({
            "message":                 "User updated successfully",
            **_serialize_user(user),
            "temporary_password_sent": new_password is not None,
        })


class DeleteUserView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def delete(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)

        if user == request.user:
            return _err("You cannot delete your own account")
        if user.is_superuser:
            return _err("Cannot delete a superuser")

        name  = user.name
        email = user.email
        user.delete()

        create_audit_log(
            user=request.user,
            action="delete",
            resource=email,
            resource_type="User",
            request=request,
            details=f"User {name} deleted",
            changes={"user_id": user_id},
        )
        return Response({"message": "User deleted successfully"})


class ResetUserPasswordView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request, user_id):
        new_password = request.data.get("new_password", "").strip()

        if not new_password:
            return _err(
                "Validation failed",
                errors=field_errors("new_password", "New password is required."),
            )
        if len(new_password) < 8:
            return _err(
                "Validation failed",
                errors=field_errors("new_password", "Password must be at least 8 characters."),
            )

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)

        user.set_password(new_password)
        user.save(update_fields=["password"])
        sec_logger.info(
            "admin_reset_password target_user_id=%s by_user_id=%s",
            user.id,
            request.user.id,
        )

        create_audit_log(
            user=request.user,
            action="reset_password",
            resource=user.email,
            resource_type="User",
            request=request,
            details=f"Password reset for {user.name}",
            changes={"user_id": user_id},
        )
        return Response({"message": "Password updated successfully"})


# =============================================================================
# §3  ASSET VIEWS
# =============================================================================

class UserAssetsView(APIView):
    """GET /api/users/my-assets/ — allocation module retired."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"assigned_assets": []})


class UserAssetsDetailView(APIView):
    """GET /api/users/assets/<user_id>/ — allocation module retired."""
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return _err("User not found", 404)

        return Response({
            "userId":   user.id,
            "userName": user.name,
            "assets":   [],
        })


# =============================================================================
# §4  PROFILE  (self-service for authenticated user)
# =============================================================================

class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # FIX: return 'assetsAssigned' (matches frontend UserDataType)
        return Response({
            **_serialize_user(request.user),
            # Additional profile-only fields
            "active_assets":   request.user.assets_count,
        })


class UpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        user    = request.user
        d       = request.data
        changes = {}

        name = (d.get("name") or "").strip()
        if "name" in d and not name:
            return _err(
                "Validation failed",
                errors=field_errors("name", "Name is required."),
            )
        if name and name != user.name:
            user.name = name
            changes["name"] = name

        dept = d.get("department")
        if dept is not None and dept != user.department:
            user.department = dept or None
            changes["department"] = dept

        if changes:
            user.save()
            create_audit_log(
                user=user,
                action="update",
                resource=user.email,
                resource_type="Profile",
                request=request,
                details=f"Profile updated by {user.name}",
                changes=changes,
            )

        return Response({
            "message": "Profile updated successfully",
            **_serialize_user(user),
        })


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user             = request.user
        current_password = request.data.get("current_password", "")
        new_password     = request.data.get("new_password", "")

        if not current_password or not new_password:
            errors = {}
            if not current_password:
                errors.update(field_errors("current_password", "Current password is required."))
            if not new_password:
                errors.update(field_errors("new_password", "New password is required."))
            return _err("Validation failed", errors=errors)
        if not user.check_password(current_password):
            return _err(
                "Validation failed",
                errors=field_errors("current_password", "Current password is incorrect."),
            )
        if len(new_password) < 8:
            return _err(
                "Validation failed",
                errors=field_errors("new_password", "New password must be at least 8 characters."),
            )
        if current_password == new_password:
            return _err(
                "Validation failed",
                errors=field_errors("new_password", "New password must differ from the current password."),
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])
        sec_logger.info(
            "change_password user_id=%s ip=%s",
            user.id,
            _client_ip(request),
        )

        create_audit_log(
            user=user,
            action="change_password",
            resource=user.email,
            resource_type="Profile",
            request=request,
            details=f"Password changed by {user.name}",
        )

        _send_credentials_email(
            user.name, user.email, "*** hidden ***",
            subject="Password Changed — Inventory System",
        )

        return Response({"message": "Password changed successfully"})
