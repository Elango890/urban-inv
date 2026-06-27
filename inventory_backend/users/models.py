# =============================================================================
# users/models.py
# Custom user model — email-based auth, role-based access.
# =============================================================================

from django.db import models
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager


class UserManager(BaseUserManager):

    def create_user(self, email, name, password=None, role="staff", department=None):
        if not email:
            raise ValueError("Email is required")
        if not name:
            raise ValueError("Name is required")

        user = self.model(
            email=self.normalize_email(email),
            name=name,
            role=role,
            department=department,
        )
        user.set_password(password) if password else user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, name, password):
        user = self.create_user(email=email, name=name, password=password, role="admin")
        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    """
    Single user table for admin, staff, and salespersons.
    """

    ROLE_CHOICES = (
        ("admin",       "Admin"),
        ("staff",       "Staff"),
        ("salesperson", "Salesperson"),
    )

    id         = models.BigAutoField(primary_key=True)
    name       = models.CharField(max_length=150)
    email      = models.EmailField(unique=True, default='example@example.com')
    role       = models.CharField(max_length=20, choices=ROLE_CHOICES, default="staff")
    department = models.CharField(max_length=100, blank=True, null=True)
    is_active  = models.BooleanField(default=True)
    is_staff   = models.BooleanField(default=False)
    last_login = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD  = "email"
    EMAIL_FIELD     = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.email})"

    @property
    def assets_count(self):
        return 0

    @property
    def active_assets_count(self):
        """Alias for assets_count."""
        return self.assets_count

    @property
    def returned_assets_count(self):
        return 0

    @property
    def total_assets_count(self):
        return 0
