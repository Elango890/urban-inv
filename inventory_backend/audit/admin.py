from django.contrib import admin
from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'action', 'resource', 'resource_type', 'created_at')
    list_filter = ('action', 'resource_type', 'created_at')
    search_fields = ('user__name', 'resource', 'resource_type', 'details')
    readonly_fields = ('user', 'action', 'resource', 'resource_type', 'created_at', 'ip_address', 'changes', 'details')
    ordering = ('-created_at',)
