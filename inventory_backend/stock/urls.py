# stock/urls.py
from django.urls import path
from .views import (
    StockDashboardView,
    CreateStockView,
    AdjustStockView,
    RestoreStockAdjustmentView,
    SetMinimumStockView,
    StockHistoryView,
    StockDetailView,
    TransferStockView,
    WarehouseListView,
    WarehouseCreateView,
    WarehouseDetailView,
    AssetDropdownView,
    StockStatsView,
)

urlpatterns = [
    # ── Main ─────────────────────────────────────────────────────────────────
    path("dashboard/",             StockDashboardView.as_view(),  name="stock-dashboard"),
    path("stats/",                 StockStatsView.as_view(),      name="stock-stats"),

    # ── CRUD ──────────────────────────────────────────────────────────────────
    path("create/",                CreateStockView.as_view(),     name="stock-create"),
    path("adjust/",                AdjustStockView.as_view(),     name="stock-adjust"),
    path("adjust/<int:adjustment_id>/restore/", RestoreStockAdjustmentView.as_view(), name="stock-adjust-restore"),
    path("set-minimum/",           SetMinimumStockView.as_view(), name="stock-set-minimum"),
    path("transfer/",              TransferStockView.as_view(),   name="stock-transfer"),

    # ── History ───────────────────────────────────────────────────────────────
    path("history/<int:stock_id>/",StockHistoryView.as_view(),   name="stock-history"),
    path("detail/<int:stock_id>/", StockDetailView.as_view(),    name="stock-detail"),

    # ── Warehouses ────────────────────────────────────────────────────────────
    path("warehouses/",            WarehouseListView.as_view(),   name="warehouse-list"),
    path("warehouses/create/",     WarehouseCreateView.as_view(), name="warehouse-create"),
    path("warehouses/<int:warehouse_id>/", WarehouseDetailView.as_view(), name="warehouse-detail"),

    # ── Dropdowns ─────────────────────────────────────────────────────────────
    path("asset-dropdown/",        AssetDropdownView.as_view(),   name="stock-asset-dropdown"),
]
