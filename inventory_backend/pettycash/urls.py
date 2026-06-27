# =============================================================================
# petty_cash/urls.py
#
# Include in root urls.py:
#   path("api/pettycash/", include("petty_cash.urls")),
#
# ─────────────────────────────────────────────────────────────────────────────
# ROUTE MAP
# ─────────────────────────────────────────────────────────────────────────────
#   GET         /api/pettycash/list/
#   POST        /api/pettycash/create/
#   PUT         /api/pettycash/update/<pk>/
#   DELETE      /api/pettycash/delete/<pk>/
#   GET         /api/pettycash/stats/
#   GET         /api/pettycash/categories/
#   GET  PATCH  /api/pettycash/fund/
# =============================================================================

from django.urls import path

from .views import (
    PettyCashCategoriesView,
    PettyCashCreateView,
    PettyCashDeleteView,
    PettyCashFundView,
    PettyCashListView,
    PettyCashStatsView,
    PettyCashUpdateView,
)

urlpatterns = [
    path("list/",           PettyCashListView.as_view(),       name="pettycash-list"),
    path("create/",         PettyCashCreateView.as_view(),     name="pettycash-create"),
    path("update/<int:pk>/",PettyCashUpdateView.as_view(),     name="pettycash-update"),
    path("delete/<int:pk>/",PettyCashDeleteView.as_view(),     name="pettycash-delete"),
    path("stats/",          PettyCashStatsView.as_view(),      name="pettycash-stats"),
    path("categories/",     PettyCashCategoriesView.as_view(), name="pettycash-categories"),
    path("fund/",           PettyCashFundView.as_view(),       name="pettycash-fund"),
]