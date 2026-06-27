from .models import AuditLog

def create_audit_log(user, action, resource, resource_type, request=None, details="", changes=None):
    try:
        ip = None
        if request:
            ip = request.META.get("REMOTE_ADDR")

        AuditLog.objects.create(
            user=user,
            action=action,
            resource=resource,
            resource_type=resource_type,
            details=details,
            ip_address=ip,
            changes=changes
        )

        print("✅ Audit log created")

    except Exception as e:
        print("❌ Audit log error:", e)
