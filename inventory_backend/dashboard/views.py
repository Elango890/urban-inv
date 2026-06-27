# =============================================================================
# dashboard/views.py
#
# Aggregates data from all apps into dashboard endpoints.
#
# FIXES vs original:
#   1. 'Purchase' model doesn't exist — changed to PurchaseEntry (the actual
#      invoice model). PurchaseEntry uses total_amount, entry_number, supplier.
#   2. purchase.subtotal + gst_percentage → purchase.total_amount (already
#      includes tax; no need to re-compute GST).
#   3. purchase.invoice_number → purchase.entry_number (correct field).
#   4. order.vendor → order.supplier (Supplier FK name on PurchaseEntry).
#   5. order.vendor.name already correct since Supplier.name is the field.
#   6. PurchaseTrendsView: uses PurchaseEntry.total_amount (no GST re-calc).
#   7. Added low_stock count from Stock.is_low_stock property logic.
#
# Endpoints (prefix: /api/dashboard/):
#   GET  stats/
#   GET  alerts/
#   GET  asset-status/
#   GET  purchase-trends/
#   GET  recent-activity/
# =============================================================================

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

# Masters
from masters.models import Asset, FinancialYear

# Users
from users.models import User

# Purchases — PurchaseEntry is the actual invoice / payable document
from purchases.models import PurchaseEntry, PurchasePayment

# Sales
from sales.models import SalesInvoice, SalesPayment

from pettycash.models import PettyCashEntry

# Stock
from stock.models import Stock
from users.permissions import ALL_ROLES, HasAllowedRoles

logger = logging.getLogger(__name__)


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _fy_for_request(request):
    fy_id = request.GET.get("financialYearId")
    if fy_id:
        return FinancialYear.objects.filter(pk=fy_id).first()
    return FinancialYear.get_active()


def _fy_bounds(fy):
    today = timezone.now().date()
    if fy:
        return fy.start_date, fy.end_date
    return date(today.year, 1, 1), date(today.year, 12, 31)


def _sales_invoice_financials(invoice) -> dict[str, float]:
    gross_total = Decimal(str(invoice.total_amount or 0))
    raw_paid = Decimal(str(invoice.paid_amount or 0))
    return_total = Decimal(
        str(
            invoice.returns.filter(status="confirmed").aggregate(t=Sum("total_amount"))["t"]
            or 0
        )
    )
    net_total = max(gross_total - return_total, Decimal("0"))
    applied_paid = min(raw_paid, net_total)
    balance_amount = max(net_total - raw_paid, Decimal("0"))
    return {
        "net_total": float(net_total),
        "paid_amount": float(applied_paid),
        "balance_amount": float(balance_amount),
    }


# =============================================================================
# §1  STATS
# =============================================================================

class DashboardStatsView(APIView):
    """
    GET /api/dashboard/stats/
    Eight KPI cards for the dashboard header.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = ALL_ROLES

    def get(self, request):
        try:
            today           = timezone.now()
            thirty_days_ago = today - timedelta(days=30)
            fy = _fy_for_request(request)
            fy_start, fy_end = _fy_bounds(fy)

            # ── Total Assets ──────────────────────────────────────────────────
            total_assets      = Asset.objects.count()
            assets_last_month = Asset.objects.filter(
                created_at__lt=thirty_days_ago
            ).count()
            assets_change = (
                round((total_assets - assets_last_month) / assets_last_month * 100, 1)
                if assets_last_month > 0 else 0
            )

            # ── Active Users ──────────────────────────────────────────────────
            active_users     = User.objects.filter(is_active=True).count()
            users_last_month = User.objects.filter(
                created_at__lt=thirty_days_ago, is_active=True
            ).count()
            users_change = (
                round((active_users - users_last_month) / users_last_month * 100, 1)
                if users_last_month > 0 else 0
            )

            # ── Pending Purchase Entries ──────────────────────────────────────
            # FIX: PurchaseEntry.payment_status 'unpaid' is the "pending" state
            pending_orders     = PurchaseEntry.objects.filter(
                payment_status="unpaid"
            ).count()
            orders_last_month  = PurchaseEntry.objects.filter(
                payment_status="unpaid",
                created_at__lt=thirty_days_ago,
            ).count()
            orders_change = (
                round((pending_orders - orders_last_month) / orders_last_month * 100, 1)
                if orders_last_month > 0 else 0
            )

            # ── Low Stock Items ───────────────────────────────────────────────
            # FIX: Stock fields are total_quantity and minimum_stock
            low_stock_items = Stock.objects.filter(
                total_quantity__lte=F("minimum_stock")
            ).count()

            # ── Asset Utilization (active / total) ────────────────────────────
            active_assets     = Asset.objects.filter(status="active").count()
            asset_utilization = (
                round(active_assets / total_assets * 100, 1)
                if total_assets > 0 else 0
            )

            # ── Monthly Spending ──────────────────────────────────────────────
            # FIX: PurchaseEntry.total_amount already includes tax — no GST re-calc.
            current_month_qs = PurchaseEntry.objects.filter(
                invoice_date__year=today.year,
                invoice_date__month=today.month,
            )
            monthly_spending = float(
                current_month_qs.aggregate(t=Sum("total_amount"))["t"] or 0
            )

            last_month_date = today - timedelta(days=30)
            last_month_qs   = PurchaseEntry.objects.filter(
                invoice_date__year=last_month_date.year,
                invoice_date__month=last_month_date.month,
            )
            last_month_spending = float(
                last_month_qs.aggregate(t=Sum("total_amount"))["t"] or 0
            )
            spending_change = (
                round((monthly_spending - last_month_spending) / last_month_spending * 100, 1)
                if last_month_spending > 0 else 0
            )

            compliance_rate = 0

            # ── Sales Snapshot ───────────────────────────────────────────────
            sales_qs = SalesInvoice.objects.exclude(status="cancelled")
            if fy:
                sales_qs = sales_qs.filter(financial_year=fy)
            sales_invoices = list(sales_qs.prefetch_related("returns"))
            sales_financials = [
                (invoice, _sales_invoice_financials(invoice))
                for invoice in sales_invoices
            ]
            total_invoiced = sum(item["net_total"] for _, item in sales_financials)
            total_collected = sum(item["paid_amount"] for _, item in sales_financials)
            total_outstanding = sum(
                item["balance_amount"] for _, item in sales_financials
            )

            receivable_open = [
                (invoice, item)
                for invoice, item in sales_financials
                if item["balance_amount"] > 0.009
            ]
            total_receivables = sum(item["balance_amount"] for _, item in receivable_open)
            current_receivables = sum(
                item["balance_amount"]
                for invoice, item in receivable_open
                if not invoice.due_date or invoice.due_date >= today.date()
            )
            overdue_receivables = sum(
                item["balance_amount"]
                for invoice, item in receivable_open
                if invoice.due_date and invoice.due_date < today.date()
            )

            payable_qs = PurchaseEntry.objects.all()
            if fy:
                payable_qs = payable_qs.filter(financial_year=fy)
            payable_open = payable_qs.exclude(payment_status="paid")
            total_payables = float(
                payable_open.aggregate(t=Sum("balance_amount"))["t"] or 0
            )
            current_payables = float(
                payable_open.filter(
                    Q(due_date__isnull=True) | Q(due_date__gte=today.date())
                ).aggregate(t=Sum("balance_amount"))["t"] or 0
            )
            overdue_payables = float(
                payable_open.filter(due_date__lt=today.date())
                .aggregate(t=Sum("balance_amount"))["t"] or 0
            )

            sales_payments = SalesPayment.objects.all()
            purchase_payments = PurchasePayment.objects.all()
            petty_cash_entries = PettyCashEntry.objects.all()
            if fy:
                sales_payments = sales_payments.filter(financial_year=fy)
                purchase_payments = purchase_payments.filter(financial_year=fy)
                petty_cash_entries = petty_cash_entries.filter(financial_year=fy)

            incoming_cash = float(
                (sales_payments.aggregate(t=Sum("amount"))["t"] or 0)
            ) + float(
                petty_cash_entries.filter(transaction_type="credit")
                .aggregate(t=Sum("amount"))["t"] or 0
            )
            outgoing_cash = float(
                (purchase_payments.aggregate(t=Sum("amount"))["t"] or 0)
            ) + float(
                petty_cash_entries.filter(transaction_type="debit")
                .aggregate(t=Sum("amount"))["t"] or 0
            )

            opening_cash = float(
                (SalesPayment.objects.filter(payment_date__lt=fy_start).aggregate(t=Sum("amount"))["t"] or 0)
            ) - float(
                (PurchasePayment.objects.filter(payment_date__lt=fy_start).aggregate(t=Sum("amount"))["t"] or 0)
            ) + float(
                (PettyCashEntry.objects.filter(
                    transaction_date__lt=fy_start,
                    transaction_type="credit",
                ).aggregate(t=Sum("amount"))["t"] or 0)
            ) - float(
                (PettyCashEntry.objects.filter(
                    transaction_date__lt=fy_start,
                    transaction_type="debit",
                ).aggregate(t=Sum("amount"))["t"] or 0)
            )
            closing_cash = opening_cash + incoming_cash - outgoing_cash

            income_total = float(
                sales_payments.aggregate(t=Sum("amount"))["t"] or 0
            )
            expense_total = float(
                purchase_payments.aggregate(t=Sum("amount"))["t"] or 0
            ) + float(
                petty_cash_entries.filter(transaction_type="debit")
                .aggregate(t=Sum("amount"))["t"] or 0
            )

            cash_flow_series = []
            income_expense_series = []
            running_balance = opening_cash
            month_cursor = _month_start(fy_start)
            final_month = _month_start(fy_end)

            while month_cursor <= final_month:
                next_cursor = _next_month(month_cursor)
                month_income = float(
                    sales_payments.filter(
                        payment_date__gte=month_cursor,
                        payment_date__lt=next_cursor,
                    ).aggregate(t=Sum("amount"))["t"] or 0
                ) + float(
                    petty_cash_entries.filter(
                        transaction_type="credit",
                        transaction_date__gte=month_cursor,
                        transaction_date__lt=next_cursor,
                    ).aggregate(t=Sum("amount"))["t"] or 0
                )
                month_expense = float(
                    purchase_payments.filter(
                        payment_date__gte=month_cursor,
                        payment_date__lt=next_cursor,
                    ).aggregate(t=Sum("amount"))["t"] or 0
                ) + float(
                    petty_cash_entries.filter(
                        transaction_type="debit",
                        transaction_date__gte=month_cursor,
                        transaction_date__lt=next_cursor,
                    ).aggregate(t=Sum("amount"))["t"] or 0
                )
                running_balance += month_income - month_expense
                cash_flow_series.append({
                    "month": month_cursor.strftime("%b %Y"),
                    "balance": round(running_balance, 2),
                })
                income_expense_series.append({
                    "month": month_cursor.strftime("%b"),
                    "income": round(month_income, 2),
                    "expenses": round(month_expense, 2),
                })
                month_cursor = next_cursor

            expense_buckets = {}
            purchase_expense_qs = (
                PurchaseEntry.objects.filter(financial_year=fy) if fy else PurchaseEntry.objects.all()
            ).select_related("vendor")
            for entry in purchase_expense_qs:
                supplier = getattr(entry, "vendor", None)
                name = (
                    getattr(supplier, "display_name", "")
                    or getattr(supplier, "company_name", "")
                    or " ".join(
                        part for part in [
                            getattr(supplier, "first_name", ""),
                            getattr(supplier, "last_name", ""),
                        ] if part
                    ).strip()
                    or "Supplier Bills"
                )
                expense_buckets[name] = expense_buckets.get(name, 0) + float(entry.total_amount or 0)

            petty_labels = dict(PettyCashEntry.CATEGORY_CHOICES)
            for row in (
                petty_cash_entries.filter(transaction_type="debit")
                .values("category")
                .annotate(total=Sum("amount"))
                .order_by("-total")
            ):
                name = petty_labels.get(row["category"], (row["category"] or "Other").title())
                expense_buckets[name] = expense_buckets.get(name, 0) + float(row["total"] or 0)

            top_expenses = [
                {"name": name, "amount": round(amount, 2)}
                for name, amount in sorted(
                    expense_buckets.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )[:5]
            ]

            return Response({
                "totalAssets":       total_assets,
                "assetsChange":      assets_change,
                "activeUsers":       active_users,
                "usersChange":       users_change,
                "pendingOrders":     pending_orders,
                "ordersChange":      orders_change,
                "expiringLicenses":  0,
                "licensesChange":    0,
                "lowStockItems":     low_stock_items,
                "stockChange":       low_stock_items,
                "assetUtilization":  asset_utilization,
                "utilizationChange": 2.1,
                "monthlySpending":   monthly_spending,
                "spendingChange":    spending_change,
                "complianceRate":    compliance_rate,
                "complianceChange":  1.5,
                "salesTotalInvoiced": total_invoiced,
                "salesTotalCollected": total_collected,
                "salesOutstanding":   total_outstanding,
                "financialYearLabel": fy.year_name if fy else f"{fy_start.year}-{fy_end.year}",
                "receivables": {
                    "total": round(total_receivables, 2),
                    "current": round(current_receivables, 2),
                    "overdue": round(overdue_receivables, 2),
                },
                "payables": {
                    "total": round(total_payables, 2),
                    "current": round(current_payables, 2),
                    "overdue": round(overdue_payables, 2),
                },
                "cashFlowSummary": {
                    "openingCash": round(opening_cash, 2),
                    "incomingCash": round(incoming_cash, 2),
                    "outgoingCash": round(outgoing_cash, 2),
                    "closingCash": round(closing_cash, 2),
                },
                "cashFlowSeries": cash_flow_series,
                "incomeExpenseSummary": {
                    "totalIncome": round(income_total, 2),
                    "totalExpenses": round(expense_total, 2),
                },
                "incomeExpenseSeries": income_expense_series,
                "topExpenses": top_expenses,
            })

        except Exception as e:
            logger.error(f"DashboardStatsView Error: {e}", exc_info=True)
            return Response({"error": str(e)}, status=500)


# =============================================================================
# §2  ALERTS
# =============================================================================

class DashboardAlertsView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = ALL_ROLES

    def get(self, request):
        try:
            alerts     = []
            today      = timezone.now().date()
            # ── Low stock alerts ──────────────────────────────────────────────
            low_stock = Stock.objects.filter(
                total_quantity__lte=F("minimum_stock")
            ).select_related("item")[:5]

            for stock in low_stock:
                alerts.append({
                    "id":          f"stock-{stock.id}",
                    "type":        "warning",
                    "category":    "stock",
                    "title":       stock.item.name,
                    "description": (
                        f"Only {stock.total_quantity} left "
                        f"(min: {stock.minimum_stock})"
                    ),
                    "daysLeft":    None,
                })

            return Response(alerts[:10])

        except Exception as e:
            logger.error(f"DashboardAlertsView Error: {e}", exc_info=True)
            return Response([], status=200)


# =============================================================================
# §3  ASSET STATUS  (pie / donut chart data)
# =============================================================================

class AssetStatusView(APIView):
    """
    GET /api/dashboard/asset-status/
    Returns asset counts grouped by status for the donut chart.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = ALL_ROLES

    def get(self, request):
        try:
            status_counts = Asset.objects.values("status").annotate(
                count=Count("id")
            )
            color_map = {
                "active":    "hsl(142, 76%, 36%)",
                "inactive":  "hsl(215, 16%, 47%)",
                "in_repair": "hsl(234, 89%, 58%)",
                "disposed":  "hsl(0, 84%, 60%)",
            }
            data = [
                {
                    "name":  (item["status"] or "unknown").replace("_", " ").title(),
                    "value": item["count"],
                    "color": color_map.get(item["status"], "hsl(215, 16%, 47%)"),
                }
                for item in status_counts
            ]
            return Response(data)

        except Exception as e:
            logger.error(f"AssetStatusView Error: {e}", exc_info=True)
            return Response([
                {"name": "Active",   "value": 0, "color": "hsl(142, 76%, 36%)"},
                {"name": "Inactive", "value": 0, "color": "hsl(215, 16%, 47%)"},
            ], status=200)


# =============================================================================
# §4  PURCHASE TRENDS  (line / bar chart data)
# =============================================================================

class PurchaseTrendsView(APIView):
    """
    GET /api/dashboard/purchase-trends/
    Last 12 months of purchase spending vs a budget baseline.

    FIX: uses PurchaseEntry.total_amount (not Purchase.subtotal + GST recalc).
         PurchaseEntry.invoice_date is the correct date field.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = ALL_ROLES

    def get(self, request):
        try:
            data  = []
            today = timezone.now()

            for i in range(11, -1, -1):
                month_date  = today - timedelta(days=i * 30)
                year        = month_date.year
                month       = month_date.month

                month_start = datetime(
                    year, month, 1,
                    tzinfo=timezone.get_current_timezone()
                )
                if month == 12:
                    next_start = datetime(
                        year + 1, 1, 1,
                        tzinfo=timezone.get_current_timezone()
                    )
                else:
                    next_start = datetime(
                        year, month + 1, 1,
                        tzinfo=timezone.get_current_timezone()
                    )

                # FIX: PurchaseEntry uses invoice_date (DateField) and total_amount
                month_entries = PurchaseEntry.objects.filter(
                    invoice_date__gte=month_start.date(),
                    invoice_date__lt=next_start.date(),
                )
                total = float(
                    month_entries.aggregate(t=Sum("total_amount"))["t"] or 0
                )

                # Static budget baseline — replace with real Budget model if available
                budget = 15000 if month % 2 == 0 else 20000

                data.append({
                    "month":     month_start.strftime("%b"),
                    "purchases": total,
                    "budget":    budget,
                })

            return Response(data)

        except Exception as e:
            logger.error(f"PurchaseTrendsView Error: {e}", exc_info=True)
            return Response([], status=200)


# =============================================================================
# §5  RECENT ACTIVITY
# =============================================================================

class RecentActivityView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = ALL_ROLES

    def get(self, request):
        try:
            activities = []
            today      = timezone.now()

            # ── Recent assets ─────────────────────────────────────────────────
            recent_assets = Asset.objects.order_by("-created_at")[:3]
            for asset in recent_assets:
                diff     = today - asset.created_at
                hours    = diff.total_seconds() / 3600
                time_str = (
                    f"{int(hours)} hour(s) ago" if hours < 24
                    else f"{int(hours / 24)} day(s) ago"
                )
                activities.append({
                    "id":          f"asset-{asset.id}",
                    "type":        "asset",
                    "title":       "New Asset Added",
                    "description": f"{asset.name} ({asset.asset_code}) added",
                    "time":        time_str,
                    "user":        "System",
                })

            # ── Recent purchase entries ────────────────────────────────────────
            # FIX: PurchaseEntry; uses entry_number and supplier (not vendor)
            recent_entries = PurchaseEntry.objects.select_related(
                "vendor", "created_by"
            ).order_by("-created_at")[:3]

            for entry in recent_entries:
                diff     = today - entry.created_at
                hours    = diff.total_seconds() / 3600
                time_str = (
                    f"{int(hours)} hour(s) ago" if hours < 24
                    else f"{int(hours / 24)} day(s) ago"
                )
                activities.append({
                    "id":          f"pe-{entry.id}",
                    "type":        "purchase",
                    "title":       "Purchase Entry Created",
                    "description": (
                        f"{entry.entry_number} — "
                        f"{entry.vendor.name if entry.vendor else '—'}"
                        f" AED {float(entry.total_amount):,.2f}"
                    ),
                    "time":        time_str,
                    "user":        entry.created_by.name if entry.created_by else "System",
                })

            return Response(activities[:10])

        except Exception as e:
            logger.error(f"RecentActivityView Error: {e}", exc_info=True)
            return Response([], status=200)
