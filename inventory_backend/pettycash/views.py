# =============================================================================
# petty_cash/views.py
#
# API for petty cash fund management.
#
# FIXES vs original:
#   1. PettyCashCreateView no longer calls PettyCashFund.update_balance() manually
#      AND then bypasses the model's save() via Model.save(). That caused the
#      fund balance to be mutated twice (once in the view, once inside
#      PettyCashEntry.save()). Fix: set entry._current_user and call
#      entry.save() normally — the model mixin handles everything once.
#   2. PettyCashUpdateView had the same double-update bug on new amount and
#      improperly called Model.save(). Fixed to call entry.save() after
#      manually setting entry.balance so the mixin's update_balance() is
#      NOT triggered a second time.  The correct pattern for update:
#        a) reverse old effect directly on fund
#        b) apply new effect directly on fund → capture new_balance
#        c) set entry.balance = new_balance
#        d) save remaining fields via update_fields (skipping save() override)
#   3. PettyCashDeleteView: same pattern — reverse effect then delete.
#   4. Category filter in list view was documented to use .lower(); confirmed
#      model stores lowercase values — no change needed there.
#   5. Added FY filter to list and stats views.
#   6. Added missing audit logging to create/update/delete.
#   7. PettyCashStatsView: added FY-scoped filter support.
#   8. Added PettyCashFundView to GET/PATCH the singleton fund balance directly.
#
# Endpoints (prefix: /api/pettycash/):
#   GET         list/
#   POST        create/
#   PUT         update/<pk>/
#   DELETE      delete/<pk>/
#   GET         stats/
#   GET         categories/
#   GET  PATCH  fund/
# =============================================================================

from decimal import Decimal, InvalidOperation
from datetime import datetime

from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import create_audit_log
from masters.models import FinancialYear

from .models import PettyCashEntry, PettyCashFund
from masters.models import Customer, Vendor
from inventory_backend.api_errors import error_response, field_errors
from users.permissions import HasAllowedRoles, OPERATIONS_ROLES


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _err(msg, code=400, errors=None):
    return error_response(msg, code=code, errors=errors)


def _serialize_entry(entry: PettyCashEntry) -> dict:
    return {
        "id":              entry.id,
        "date":            str(entry.transaction_date),
        "description":     entry.description,
        "type":            entry.transaction_type,
        "amount":          float(entry.amount),
        "balance":         float(entry.balance),
        "category":        entry.category,
        "categoryDisplay": entry.get_category_display(),
        "relatedPartyType": entry.related_party_type,
        "relatedPartyTypeDisplay": entry.get_related_party_type_display(),
        "customerId":      entry.customer_id,
        "customerName":    entry.customer.display_name if entry.customer else None,
        "vendorId":        entry.vendor_id,
        "vendorName":      entry.vendor.display_name if entry.vendor else None,
        "financialYear":   str(entry.financial_year) if entry.financial_year else None,
        "approvedBy":      entry.approved_by.name if entry.approved_by else "N/A",
        "createdBy":       entry.created_by.name  if entry.created_by  else "System",
        "notes":           entry.notes,
        "receiptFile":     entry.receipt_file.url if entry.receipt_file else None,
        "createdAt":       entry.created_at.isoformat(),
    }


def _parse_amount(raw) -> tuple[Decimal | None, str | None]:
    """Return (Decimal, None) on success or (None, error_message) on failure."""
    try:
        val = Decimal(str(raw))
        if val <= 0:
            return None, "amount must be greater than zero"
        return val, None
    except (InvalidOperation, TypeError, ValueError):
        return None, "'amount' is required and must be a valid number"


# =============================================================================
# §1  LIST
# =============================================================================

class PettyCashListView(APIView):
    """
    GET /api/pettycash/list/
    Query params: type, category, date_from, date_to, search, financialYearId,
    related_party_type, customerId, vendorId
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        entries = PettyCashEntry.objects.select_related(
            "approved_by", "created_by", "financial_year", "customer", "vendor"
        ).order_by("-transaction_date", "-created_at")

        tx_type  = request.GET.get("type",     "").lower().strip()
        category = request.GET.get("category", "").lower().strip()
        date_from = request.GET.get("date_from")
        date_to   = request.GET.get("date_to")
        search    = request.GET.get("search",  "").strip()
        fy_id     = request.GET.get("financialYearId")
        related_party_type = request.GET.get("related_party_type", "").lower().strip()
        customer_id = request.GET.get("customerId")
        vendor_id = request.GET.get("vendorId")

        if tx_type:
            entries = entries.filter(transaction_type=tx_type)
        if category:
            entries = entries.filter(category=category)
        if date_from:
            entries = entries.filter(transaction_date__gte=date_from)
        if date_to:
            entries = entries.filter(transaction_date__lte=date_to)
        if search:
            entries = entries.filter(
                Q(description__icontains=search)
                | Q(notes__icontains=search)
                | Q(customer__display_name__icontains=search)
                | Q(vendor__display_name__icontains=search)
            )
        if fy_id:
            entries = entries.filter(financial_year_id=fy_id)
        if related_party_type:
            entries = entries.filter(related_party_type=related_party_type)
        if customer_id:
            entries = entries.filter(customer_id=customer_id)
        if vendor_id:
            entries = entries.filter(vendor_id=vendor_id)

        return Response([_serialize_entry(e) for e in entries])


# =============================================================================
# §2  CREATE
# =============================================================================

class PettyCashCreateView(APIView):
    """
    POST /api/pettycash/create/

    FIX: original called PettyCashFund.update_balance() here AND relied on
    Model.save() to bypass PettyCashEntry.save() — causing a double-update.
    Correct pattern: set entry._current_user and call entry.save() normally.
    The model's save() calls PettyCashFund.update_balance() exactly once.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data

        tx_type = (d.get("type", "debit") or "debit").lower()
        if tx_type not in ("credit", "debit"):
            return _err(
                "Validation failed",
                errors=field_errors("type", "Type must be 'credit' or 'debit'."),
            )

        amount, err = _parse_amount(d.get("amount"))
        if err:
            return _err("Validation failed", errors=field_errors("amount", err))

        desc = (d.get("description") or "").strip()
        if not desc:
            return _err(
                "Validation failed",
                errors=field_errors("description", "Description is required."),
            )

        # Validate sufficient balance for debit
        if tx_type == "debit":
            current = float(PettyCashFund.get_current_balance())
            if float(amount) > current:
                return error_response(
                    "Insufficient petty cash balance",
                    code=400,
                    errors=field_errors(
                        "amount",
                        f"Amount exceeds available balance (AED {current:,.2f}).",
                    ),
                )

        fy = FinancialYear.get_active()
        if not fy:
            return _err("No active financial year. Please activate one first.")

        category = (d.get("category", "other") or "other").lower()
        related_party_type = (d.get("relatedPartyType", "own") or "own").lower()
        if related_party_type not in {"own", "customer", "vendor"}:
            return _err(
                "Validation failed",
                errors=field_errors("relatedPartyType", "Related party type must be own, customer, or vendor."),
            )

        customer = None
        vendor = None
        if related_party_type == "customer":
            customer_id = d.get("customerId")
            if not customer_id:
                return _err(
                    "Validation failed",
                    errors=field_errors("customerId", "Customer is required for customer-related petty cash."),
                )
            customer = get_object_or_404(Customer, pk=customer_id)
        elif related_party_type == "vendor":
            vendor_id = d.get("vendorId")
            if not vendor_id:
                return _err(
                    "Validation failed",
                    errors=field_errors("vendorId", "Vendor is required for vendor-related petty cash."),
                )
            vendor = get_object_or_404(Vendor, pk=vendor_id)

        entry = PettyCashEntry(
            financial_year   = fy,
            transaction_date = d.get("date") or str(datetime.now().date()),
            description      = desc,
            transaction_type = tx_type,
            amount           = amount,
            category         = category,
            related_party_type = related_party_type,
            customer         = customer,
            vendor           = vendor,
            notes            = d.get("notes", ""),
            approved_by      = request.user,
            created_by       = request.user,
        )

        # FIX: set _current_user so the model's save() passes it to
        # PettyCashFund.update_balance() — do NOT call update_balance() here.
        entry._current_user = request.user
        entry.save()    # ← model save() handles fund mutation + balance snapshot

        if "receipt_file" in request.FILES:
            entry.receipt_file = request.FILES["receipt_file"]
            # Save only the file field — does NOT trigger balance update again
            PettyCashEntry.objects.filter(pk=entry.pk).update(
                receipt_file=entry.receipt_file
            )

        create_audit_log(
            user=request.user,
            action="create",
            resource=str(entry.id),
            resource_type="PettyCashEntry",
            request=request,
            details=(
                f"Petty cash {tx_type} AED {amount} — {entry.description}"
            ),
            changes={
                "type":     tx_type,
                "amount":   float(amount),
                "category": category,
                "relatedPartyType": related_party_type,
                "customerId": customer.id if customer else None,
                "vendorId": vendor.id if vendor else None,
            },
        )

        return Response({
            "message":    "Petty cash entry created successfully",
            "entryId":    entry.id,
            "newBalance": float(entry.balance),
        }, status=201)


# =============================================================================
# §3  UPDATE
# =============================================================================

class PettyCashUpdateView(APIView):
    """
    PUT /api/pettycash/update/<pk>/

    FIX: original had double-update bug (called update_balance + Model.save).
    Correct pattern:
      a) Reverse old effect on fund directly
      b) Validate new debit has sufficient balance
      c) Apply new effect on fund directly → capture new_balance
      d) Update entry fields + balance via update_fields (bypasses save() override)
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def put(self, request, pk):
        entry = get_object_or_404(PettyCashEntry, id=pk)
        d     = request.data

        old_type   = entry.transaction_type
        old_amount = float(entry.amount)

        new_type = (d.get("type", old_type) or old_type).lower()
        if new_type not in ("credit", "debit"):
            return _err(
                "Validation failed",
                errors=field_errors("type", "Type must be 'credit' or 'debit'."),
            )

        new_amount, err = _parse_amount(d.get("amount", old_amount))
        if err:
            return _err("Validation failed", errors=field_errors("amount", err))

        desc = (d.get("description", entry.description) or "").strip()
        if not desc:
            return _err(
                "Validation failed",
                errors=field_errors("description", "Description is required."),
            )

        # Step a: reverse old effect
        reverse_type = "credit" if old_type == "debit" else "debit"
        PettyCashFund.update_balance(old_amount, reverse_type, request.user)

        # Step b: validate debit balance
        if new_type == "debit":
            current = float(PettyCashFund.get_current_balance())
            if float(new_amount) > current:
                # Rollback — re-apply old effect
                PettyCashFund.update_balance(old_amount, old_type, request.user)
                return error_response(
                    "Insufficient petty cash balance for this update",
                    code=400,
                    errors=field_errors(
                        "amount",
                        f"Amount exceeds available balance (AED {current:,.2f}).",
                    ),
                )

        # Step c: apply new effect
        new_balance = PettyCashFund.update_balance(
            float(new_amount), new_type, request.user
        )

        # Step d: update entry using update_fields to SKIP the save() override
        # (the override would call update_balance again, causing another mutation)
        new_category = (d.get("category", entry.category) or entry.category).lower()
        related_party_type = (d.get("relatedPartyType", entry.related_party_type) or entry.related_party_type).lower()
        if related_party_type not in {"own", "customer", "vendor"}:
            PettyCashFund.update_balance(float(new_amount), "credit" if new_type == "debit" else "debit", request.user)
            PettyCashFund.update_balance(old_amount, old_type, request.user)
            return _err(
                "Validation failed",
                errors=field_errors("relatedPartyType", "Related party type must be own, customer, or vendor."),
            )

        customer_id = None
        vendor_id = None
        if related_party_type == "customer":
            customer_id = d.get("customerId") or entry.customer_id
            if not customer_id:
                PettyCashFund.update_balance(float(new_amount), "credit" if new_type == "debit" else "debit", request.user)
                PettyCashFund.update_balance(old_amount, old_type, request.user)
                return _err(
                    "Validation failed",
                    errors=field_errors("customerId", "Customer is required for customer-related petty cash."),
                )
            get_object_or_404(Customer, pk=customer_id)
        elif related_party_type == "vendor":
            vendor_id = d.get("vendorId") or entry.vendor_id
            if not vendor_id:
                PettyCashFund.update_balance(float(new_amount), "credit" if new_type == "debit" else "debit", request.user)
                PettyCashFund.update_balance(old_amount, old_type, request.user)
                return _err(
                    "Validation failed",
                    errors=field_errors("vendorId", "Vendor is required for vendor-related petty cash."),
                )
            get_object_or_404(Vendor, pk=vendor_id)

        PettyCashEntry.objects.filter(pk=pk).update(
            transaction_date = d.get("date",        entry.transaction_date),
            description      = desc,
            transaction_type = new_type,
            amount           = new_amount,
            balance          = new_balance,
            category         = new_category,
            related_party_type = related_party_type,
            customer_id      = customer_id if related_party_type == "customer" else None,
            vendor_id        = vendor_id if related_party_type == "vendor" else None,
            notes            = d.get("notes",       entry.notes),
        )

        create_audit_log(
            user=request.user,
            action="update",
            resource=str(pk),
            resource_type="PettyCashEntry",
            request=request,
            details=f"Petty cash entry {pk} updated",
            changes={
                "oldType":   old_type,   "newType":   new_type,
                "oldAmount": old_amount, "newAmount": float(new_amount),
                "relatedPartyType": related_party_type,
                "customerId": customer_id,
                "vendorId": vendor_id,
            },
        )

        return Response({
            "message":    "Entry updated successfully",
            "newBalance": float(new_balance),
        })


# =============================================================================
# §4  DELETE
# =============================================================================

class PettyCashDeleteView(APIView):
    """
    DELETE /api/pettycash/delete/<pk>/

    FIX: original called update_balance (correct) then entry.delete() (correct),
    but had leftover Model.save() pattern from create view. Cleaned up.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def delete(self, request, pk):
        entry = get_object_or_404(PettyCashEntry, id=pk)

        # Reverse the entry's effect on the fund balance
        reverse_type = "credit" if entry.transaction_type == "debit" else "debit"
        PettyCashFund.update_balance(float(entry.amount), reverse_type, request.user)

        description = entry.description
        tx_type     = entry.transaction_type
        amount      = float(entry.amount)

        entry.delete()

        create_audit_log(
            user=request.user,
            action="delete",
            resource=str(pk),
            resource_type="PettyCashEntry",
            request=request,
            details=f"Petty cash {tx_type} AED {amount} — {description} deleted",
            changes={"type": tx_type, "amount": amount},
        )

        return Response({
            "message":    "Entry deleted successfully",
            "newBalance": float(PettyCashFund.get_current_balance()),
        })


# =============================================================================
# §5  STATS
# =============================================================================

class PettyCashStatsView(APIView):
    """
    GET /api/pettycash/stats/  ?financialYearId=
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        fy_id       = request.GET.get("financialYearId")
        today       = timezone.now()
        month_start = today.replace(day=1).date()

        qs = PettyCashEntry.objects.all()
        if fy_id:
            qs = qs.filter(financial_year_id=fy_id)

        current_balance  = float(PettyCashFund.get_current_balance())

        total_credits    = float(qs.filter(transaction_type="credit").aggregate(t=Sum("amount"))["t"] or 0)
        total_debits     = float(qs.filter(transaction_type="debit").aggregate(t=Sum("amount"))["t"] or 0)

        monthly_qs       = qs.filter(transaction_date__gte=month_start)
        monthly_credits  = float(monthly_qs.filter(transaction_type="credit").aggregate(t=Sum("amount"))["t"] or 0)
        monthly_debits   = float(monthly_qs.filter(transaction_type="debit").aggregate(t=Sum("amount"))["t"] or 0)

        # Top 5 spending categories
        category_spending = [
            {
                "category":        row["category"],
                "categoryDisplay": dict(PettyCashEntry.CATEGORY_CHOICES).get(
                                       row["category"], row["category"].title()
                                   ),
                "total": float(row["total"]),
            }
            for row in (
                qs.filter(transaction_type="debit")
                .values("category")
                .annotate(total=Sum("amount"))
                .order_by("-total")[:5]
            )
        ]

        # Last 5 large transactions (≥ AED 500)
        recent_large = [
            {
                "date":        str(t.transaction_date),
                "description": t.description,
                "amount":      float(t.amount),
                "type":        t.transaction_type,
            }
            for t in qs.filter(amount__gte=500).order_by("-transaction_date")[:5]
        ]

        # Monthly trend — last 6 months
        from django.db.models.functions import TruncMonth
        monthly_trend = [
            {
                "month":   row["month"].strftime("%b %Y"),
                "credits": float(row["credits"] or 0),
                "debits":  float(row["debits"]  or 0),
            }
            for row in (
                qs.annotate(month=TruncMonth("transaction_date"))
                .values("month")
                .annotate(
                    credits=Sum("amount", filter=Q(transaction_type="credit")),
                    debits =Sum("amount", filter=Q(transaction_type="debit")),
                )
                .order_by("month")
            )
        ]

        return Response({
            "currentBalance":          current_balance,
            "totalCredits":            total_credits,
            "totalDebits":             total_debits,
            "monthlyCredits":          monthly_credits,
            "monthlyDebits":           monthly_debits,
            "categorySpending":        category_spending,
            "recentLargeTransactions": recent_large,
            "monthlyTrend":            monthly_trend,
        })


# =============================================================================
# §6  CATEGORIES
# =============================================================================

class PettyCashCategoriesView(APIView):
    """GET /api/pettycash/categories/ — return all category choices."""
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        return Response([
            {"value": value, "label": label}
            for value, label in PettyCashEntry.CATEGORY_CHOICES
        ])


# =============================================================================
# §7  FUND  (singleton balance)
# =============================================================================

class PettyCashFundView(APIView):
    """
    GET   /api/pettycash/fund/  — return current balance + last updated
    PATCH /api/pettycash/fund/  — manually adjust balance (admin override)
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        fund = PettyCashFund.get_instance()
        return Response({
            "currentBalance": float(fund.current_balance),
            "lastUpdated":    fund.last_updated.isoformat(),
            "updatedBy":      fund.updated_by.name if fund.updated_by else "System",
        })

    def patch(self, request):
        """Direct balance override — use sparingly (e.g. physical recount)."""
        new_balance, err = _parse_amount(request.data.get("balance"))
        if err:
            return _err(err)

        fund                  = PettyCashFund.get_instance()
        old_balance           = float(fund.current_balance)
        fund.current_balance  = new_balance
        fund.updated_by       = request.user
        fund.save()

        create_audit_log(
            user=request.user,
            action="update",
            resource="PettyCashFund",
            resource_type="PettyCashFund",
            request=request,
            details=f"Fund balance manually adjusted AED {old_balance} → AED {new_balance}",
            changes={"oldBalance": old_balance, "newBalance": float(new_balance)},
        )

        return Response({
            "message":       "Fund balance updated",
            "oldBalance":    old_balance,
            "currentBalance": float(fund.current_balance),
        })
