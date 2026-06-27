from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.core.paginator import Paginator
from django.db.models import Q, Count
from django.utils import timezone
from datetime import timedelta

from users.permissions import IsAdmin
from .models import AuditLog


class AuditLogListView(APIView):
    permission_classes = [IsAuthenticated,IsAdmin]

    def get(self, request):

        search = request.GET.get("search")
        action = request.GET.get("action")
        resource_type = request.GET.get("resource_type")
        page = request.GET.get("page", 1)

        logs = AuditLog.objects.all()

        if search:
            logs = logs.filter(
                Q(resource__icontains=search) |
                Q(details__icontains=search) |
                Q(user__username__icontains=search)
            )

        if action:
            logs = logs.filter(action=action)

        if resource_type:
            logs = logs.filter(resource_type=resource_type)

        paginator = Paginator(logs, 50)
        page_obj = paginator.get_page(page)

        data = []
        for log in page_obj:
            data.append({
                "id": log.id,
                "timestamp": log.created_at,
                "user": log.user.name if log.user else "System",
                "action": log.action,
                "resource": log.resource,
                "resourceType": log.resource_type,
                "details": log.details,
                "ipAddress": log.ip_address,
                "changes": log.changes,
            })

        return Response({
            "total_pages": paginator.num_pages,
            "current_page": page_obj.number,
            "total_logs": paginator.count,
            "results": data
        })


class AuditLogDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def delete(self, request, pk):
        try:
            log = AuditLog.objects.get(id=pk)
            log.delete()
            return Response({"message": "Log deleted successfully"})
        except AuditLog.DoesNotExist:
            return Response({"error": "Log not found"}, status=404)
        except Exception as e:
            return Response({"error": str(e)}, status=500)


class AuditLogBulkDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request):
        try:
            ids = request.data.get("ids", [])
            if not ids:
                return Response({"error": "No IDs provided"}, status=400)
            
            deleted_count, _ = AuditLog.objects.filter(id__in=ids).delete()
            return Response({
                "message": f"{deleted_count} log(s) deleted successfully",
                "deleted_count": deleted_count
            })
        except Exception as e:
            return Response({"error": str(e)}, status=500)


class AuditLogStatsView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def get(self, request):
        today = timezone.now().date()
        today_start = timezone.make_aware(timezone.datetime.combine(today, timezone.datetime.min.time()))
        today_end = timezone.make_aware(timezone.datetime.combine(today, timezone.datetime.max.time()))

        # Get today's logs
        today_logs = AuditLog.objects.filter(created_at__gte=today_start, created_at__lte=today_end).count()

        # Get total logs
        total_logs = AuditLog.objects.count()

        # Get active users (users who have logged in)
        active_users = AuditLog.objects.filter(action="login").values('user').distinct().count()

        # Get changes today
        changes_today = AuditLog.objects.filter(
            created_at__gte=today_start,
            created_at__lte=today_end,
            action__in=["create", "update", "delete"]
        ).count()

        return Response({
            "today_logs": today_logs,
            "total_logs": total_logs,
            "active_users": active_users,
            "changes_today": changes_today
        })
