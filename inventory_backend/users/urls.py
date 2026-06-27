# =============================================================================
# users/urls.py
#
# Include in root urls.py:
#   path("api/users/", include("users.urls")),
#
# ─────────────────────────────────────────────────────────────────────────────
# ROUTE MAP
# ─────────────────────────────────────────────────────────────────────────────
#   POST    /api/users/login/
#   POST    /api/users/logout/
#   POST    /api/users/register/
#   GET     /api/users/users/
#   PUT     /api/users/update/<user_id>/
#   DELETE  /api/users/delete/<user_id>/
#   POST    /api/users/reset-password/<user_id>/
#   GET     /api/users/my-assets/
#   GET     /api/users/assets/<user_id>/
#   GET     /api/users/profile/
#   PUT     /api/users/profile/update/
#   POST    /api/users/profile/change-password/
# =============================================================================

from django.urls import path

from .views import (
    ChangePasswordView,
    DeleteUserView,
    LoginView,
    LogoutView,
    ProfileView,
    RegisterUserView,
    ResetUserPasswordView,
    UpdateProfileView,
    UpdateUserView,
    UserAssetsDetailView,
    UserAssetsView,
    UserList,
)

urlpatterns = [
    # ── Authentication ─────────────────────────────────────────────────────────
    path("login/",    LoginView.as_view(),  name="login"),
    path("logout/",   LogoutView.as_view(), name="logout"),
    path("register/", RegisterUserView.as_view(), name="register"),

    # ── User management (admin) ────────────────────────────────────────────────
    path("users/",                      UserList.as_view(),            name="user-list"),
    path("update/<int:user_id>/",       UpdateUserView.as_view(),      name="user-update"),
    path("delete/<int:user_id>/",       DeleteUserView.as_view(),      name="user-delete"),
    path("reset-password/<int:user_id>/", ResetUserPasswordView.as_view(), name="user-reset-password"),

    # ── Asset views ────────────────────────────────────────────────────────────
    path("my-assets/",              UserAssetsView.as_view(),       name="user-my-assets"),
    path("assets/<int:user_id>/",   UserAssetsDetailView.as_view(), name="user-assets-detail"),

    # ── Profile (self-service) ─────────────────────────────────────────────────
    path("profile/",                ProfileView.as_view(),       name="profile"),
    path("profile/update/",         UpdateProfileView.as_view(), name="profile-update"),
    path("profile/change-password/",ChangePasswordView.as_view(), name="profile-change-password"),
]