from django.db import models
from django.conf import settings


class AuditLog(models.Model):

    ACTION_CHOICES = [
        ("create", "Create"),
        ("update", "Update"),
        ("delete", "Delete"),
        ("login", "Login"),
        ("logout", "Logout"),
        ("renew", "Renew"),
        ("allocate", "Allocate"),
        ("adjust", "Adjust"),
        ("approve", "Approve"),
        ("transfer", "Transfer"),
        ("return", "Return"),
        ("reschedule", "Reschedule"),
        ("cancel", "Cancel"),
        ("upload", "Upload"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    resource = models.CharField(max_length=255)
    resource_type = models.CharField(max_length=50)
    details = models.TextField(blank=True, null=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    changes = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} - {self.action} - {self.resource}"
