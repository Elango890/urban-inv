# sales/urls.py
# =============================================================================
# URL config for the sales module.
# Line items: assets only.
# =============================================================================

from django.urls import path
from .views import (
    SalesInvoiceListView,
    SalesInvoiceCreateView,
    SalesInvoiceDetailView,
    SalesInvoiceUpdateView,
    SalesInvoiceDeleteView,
    SalesInvoiceCancelView,
    SalesInvoiceConfirmView,
    SalesPaymentCreateView,
    SalesPaymentDeleteView,
    SalesReturnListView,
    SalesReturnCreateView,
    SalesReturnDetailView,
    SalesReturnConfirmView,
    SalesReturnCancelView,
    DownloadInvoicePDFView,
    SalesStatsView,
    CustomerListForBillingView,
    AvailableAssetsView,
)

urlpatterns = [
    # ── Invoices ──────────────────────────────────────────────────────────────
    path("invoices/",                    SalesInvoiceListView.as_view(),   name="sales-invoice-list"),
    path("invoices/create/",             SalesInvoiceCreateView.as_view(), name="sales-invoice-create"),
    path("invoices/<int:pk>/",           SalesInvoiceDetailView.as_view(), name="sales-invoice-detail"),
    path("invoices/<int:pk>/update/",    SalesInvoiceUpdateView.as_view(), name="sales-invoice-update"),
    path("invoices/<int:pk>/delete/",    SalesInvoiceDeleteView.as_view(), name="sales-invoice-delete"),
    path("invoices/<int:pk>/cancel/",    SalesInvoiceCancelView.as_view(), name="sales-invoice-cancel"),
    path("invoices/<int:pk>/confirm/",   SalesInvoiceConfirmView.as_view(), name="sales-invoice-confirm"),
    path("invoices/<int:pk>/pdf/",       DownloadInvoicePDFView.as_view(), name="sales-invoice-pdf"),

    # ── Payments ──────────────────────────────────────────────────────────────
    path("invoices/<int:pk>/payments/",           SalesPaymentCreateView.as_view(), name="sales-payment-create"),
    path("payments/<int:payment_id>/delete/",     SalesPaymentDeleteView.as_view(), name="sales-payment-delete"),

    # ── Returns ───────────────────────────────────────────────────────────────
    path("returns/",                    SalesReturnListView.as_view(),    name="sales-return-list"),
    path("returns/create/",             SalesReturnCreateView.as_view(),  name="sales-return-create"),
    path("returns/<int:pk>/",           SalesReturnDetailView.as_view(),  name="sales-return-detail"),
    path("returns/<int:pk>/confirm/",   SalesReturnConfirmView.as_view(), name="sales-return-confirm"),
    path("returns/<int:pk>/cancel/",    SalesReturnCancelView.as_view(),  name="sales-return-cancel"),

    # ── Stats ─────────────────────────────────────────────────────────────────
    path("stats/", SalesStatsView.as_view(), name="sales-stats"),

    # ── Dropdown helpers  (assets only) ───────────────────────────────────────
    path("customers/", CustomerListForBillingView.as_view(), name="sales-customers"),
    path("assets/",    AvailableAssetsView.as_view(),        name="sales-assets"),
]
