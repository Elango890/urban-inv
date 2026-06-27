from django.urls import path
from .views import (
    AuditLogListView,
    AuditLogDeleteView,
    AuditLogBulkDeleteView,
    AuditLogStatsView
)

urlpatterns = [
    path("", AuditLogListView.as_view()),
    path("stats/", AuditLogStatsView.as_view()),
    path("delete/<int:pk>/", AuditLogDeleteView.as_view()),
    path("bulk-delete/", AuditLogBulkDeleteView.as_view()),
]
