# purchases/urls.py
from django.urls import path
from .views import (
    PurchaseOrderListView,
    PurchaseOrderCreateView,
    PurchaseOrderDetailView,
    PurchaseOrderApproveView,
    PurchaseOrderCancelView,
    PurchaseEntryListView,
    PurchaseEntryCreateView,
    PurchaseEntryDetailView,
    PurchaseEntryDeleteView,
    PurchaseEntryReceiveView,          # ★ NEW — stock update endpoint
    UploadEntryInvoiceView,
    DownloadEntryInvoiceView,
    PurchasePaymentCreateView,
    PurchasePaymentDeleteView,
    PurchasePaymentBulkSupplierView,
    PurchaseStatsView,
    SupplierDropdownView,
    AssetDropdownView,
    ServiceDropdownView,
    ApprovedPODropdownView,            # ★ NEW — approved POs for entry form
)

urlpatterns = [
    # ── Purchase Orders ───────────────────────────────────────────────────────
    path("orders/",                        PurchaseOrderListView.as_view(),    name="purchase-order-list"),
    path("orders/create/",                 PurchaseOrderCreateView.as_view(),  name="purchase-order-create"),
    path("orders/<int:order_id>/",         PurchaseOrderDetailView.as_view(),  name="purchase-order-detail"),
    path("orders/<int:order_id>/approve/", PurchaseOrderApproveView.as_view(), name="purchase-order-approve"),
    path("orders/<int:order_id>/cancel/",  PurchaseOrderCancelView.as_view(),  name="purchase-order-cancel"),

    # ── Purchase Entries ──────────────────────────────────────────────────────
    path("entries/",                                PurchaseEntryListView.as_view(),    name="purchase-entry-list"),
    path("entries/create/",                         PurchaseEntryCreateView.as_view(),  name="purchase-entry-create"),
    path("entries/<int:entry_id>/",                 PurchaseEntryDetailView.as_view(),  name="purchase-entry-detail"),
    path("entries/<int:entry_id>/delete/",          PurchaseEntryDeleteView.as_view(),  name="purchase-entry-delete"),
    path("entries/<int:entry_id>/receive/",         PurchaseEntryReceiveView.as_view(), name="purchase-entry-receive"),  # ★
    path("entries/<int:entry_id>/upload/",          UploadEntryInvoiceView.as_view(),   name="purchase-entry-upload"),
    path("entries/<int:entry_id>/invoice/",         DownloadEntryInvoiceView.as_view(), name="purchase-entry-invoice"),

    # ── Payments ──────────────────────────────────────────────────────────────
    path("entries/<int:entry_id>/payments/",  PurchasePaymentCreateView.as_view(),       name="purchase-payment-create"),
    path("payments/<int:payment_id>/delete/", PurchasePaymentDeleteView.as_view(),       name="purchase-payment-delete"),
    path("payments/bulk/",                    PurchasePaymentBulkSupplierView.as_view(), name="purchase-payment-bulk"),

    # ── Stats & dropdowns ─────────────────────────────────────────────────────
    path("stats/",        PurchaseStatsView.as_view(),       name="purchase-stats"),
    path("suppliers/",    SupplierDropdownView.as_view(),    name="purchase-suppliers"),
    path("assets/",       AssetDropdownView.as_view(),       name="purchase-assets"),
    path("services/",     ServiceDropdownView.as_view(),     name="purchase-services"),
    path("approved-pos/", ApprovedPODropdownView.as_view(),  name="purchase-approved-pos"),  # ★
]