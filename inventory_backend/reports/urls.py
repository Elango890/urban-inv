# =============================================================================
# reports/urls.py
#
# Include in root urls.py as:
#   path("api/reports/", include("reports.urls")),
# =============================================================================

from django.urls import path
from .views import (
    ReportTypesView,
    ReportStatsView,
    PreviewReportView,
    GenerateReportView,
)

urlpatterns = [
    path("types/",    ReportTypesView.as_view(),    name="report-types"),
    path("stats/",    ReportStatsView.as_view(),    name="report-stats"),
    path("preview/",  PreviewReportView.as_view(),  name="report-preview"),
    path("generate/", GenerateReportView.as_view(), name="report-generate"),
]