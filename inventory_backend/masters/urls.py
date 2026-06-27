# =============================================================================
# masters/urls.py
#
# Removed: asset-categories, service-categories, services,
#          assets/allocate, assets/return, assets/transfer,
#          assets/update-condition, assets/allocations, assets/allocatable
# Kept:    financial-years, suppliers, customers, assets (CRUD only)
# =============================================================================

from django.urls import path

from .views import (
    OrganizationAddressDetailView,
    OrganizationAddressListCreateView,
    # Financial Year
    FinancialYearActivateView,
    FinancialYearDetailView,
    FinancialYearListView,
    # Supplier / Vendor
    SupplierCreateView,
    SupplierDetailView,
    SupplierListView,
    SupplierPurchaseHistoryView,
    # Customer
    CustomerCreateView,
    CustomerDetailView,
    CustomerInvoicesView,
    CustomerListView,
    # Asset / Item
    AssetCreateView,
    AssetDetailView,
    AssetListView,
)

urlpatterns = [
    # ── Organization Addresses ────────────────────────────────────────────────
    path("organization-addresses/",
         OrganizationAddressListCreateView.as_view()),
    path("organization-addresses/<int:address_id>/",
         OrganizationAddressDetailView.as_view()),

    # ── Financial Year ────────────────────────────────────────────────────────
    path("financial-years/",
         FinancialYearListView.as_view()),
    path("financial-years/<int:fy_id>/",
         FinancialYearDetailView.as_view()),
    path("financial-years/<int:fy_id>/activate/",
         FinancialYearActivateView.as_view()),

    # ── Suppliers / Vendors ───────────────────────────────────────────────────
    path("suppliers/",
         SupplierListView.as_view()),
    path("suppliers/create/",
         SupplierCreateView.as_view()),
    path("suppliers/<int:supplier_id>/",
         SupplierDetailView.as_view()),           # GET  PUT  DELETE
    path("suppliers/<int:supplier_id>/purchase-history/",
         SupplierPurchaseHistoryView.as_view()),

    # ── Customers ─────────────────────────────────────────────────────────────
    path("customers/",
         CustomerListView.as_view()),
    path("customers/create/",
         CustomerCreateView.as_view()),
    path("customers/<int:customer_id>/",
         CustomerDetailView.as_view()),           # GET  PUT
    path("customers/<int:customer_id>/invoices/",
         CustomerInvoicesView.as_view()),

    # ── Assets / Items (CRUD only) ────────────────────────────────────────────
    path("assets/",
         AssetListView.as_view()),
    path("assets/create/",
         AssetCreateView.as_view()),
    path("assets/<int:asset_id>/",
         AssetDetailView.as_view()),              # GET  PUT  DELETE
]
