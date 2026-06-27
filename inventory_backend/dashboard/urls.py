# =============================================================================
# dashboard/urls.py
#
# Include in root urls.py:
#   path("api/dashboard/", include("dashboard.urls")),
#
# ─────────────────────────────────────────────────────────────────────────────
# ROUTE MAP
# ─────────────────────────────────────────────────────────────────────────────
#   GET  /api/dashboard/stats/
#   GET  /api/dashboard/alerts/
#   GET  /api/dashboard/asset-status/
#   GET  /api/dashboard/purchase-trends/
#   GET  /api/dashboard/recent-activity/
# =============================================================================

from django.urls import path

from .views import (
    AssetStatusView,
    DashboardAlertsView,
    DashboardStatsView,
    PurchaseTrendsView,
    RecentActivityView,
)

urlpatterns = [
    path("stats/",           DashboardStatsView.as_view(),   name="dashboard-stats"),
    path("alerts/",          DashboardAlertsView.as_view(),  name="dashboard-alerts"),
    path("asset-status/",    AssetStatusView.as_view(),      name="asset-status"),
    path("purchase-trends/", PurchaseTrendsView.as_view(),   name="purchase-trends"),
    path("recent-activity/", RecentActivityView.as_view(),   name="recent-activity"),
]