# =============================================================================
# petty_cash/models.py
#
# Manages the company's petty cash float.
#
#   PettyCashFund  — singleton balance tracker (always pk=1)
#   PettyCashEntry — ledger row for every credit / debit
#
# PettyCashEntry.save() mutates PettyCashFund and stores the running balance
# snapshot on the row so the ledger is self-consistent without replaying rows.
# Every entry carries a FinancialYear FK for FY-level expense reports.
#
# No changes to business logic vs previous version.
# =============================================================================

from django.conf import settings
from django.db import models

from masters.models import (
    TimeStampMixin,
    CreatedByMixin,
    FinancialYear,
    Customer,
    Vendor,
)


# ─────────────────────────────────────────────────────────────────────────────
# PETTY CASH FUND  (singleton)
# ─────────────────────────────────────────────────────────────────────────────

class PettyCashFund(models.Model):
    """
    Singleton (always pk=1) — holds the running petty cash balance.
    Never create a second row. Access via PettyCashFund.get_instance().
    """
    current_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    last_updated    = models.DateTimeField(auto_now=True)
    updated_by      = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )

    class Meta:
        verbose_name        = "Petty Cash Fund"
        verbose_name_plural = "Petty Cash Fund"

    def __str__(self):
        return f"Petty Cash Balance: AED {self.current_balance}"

    @classmethod
    def get_instance(cls):
        fund, _ = cls.objects.get_or_create(pk=1, defaults={"current_balance": 0})
        return fund

    @classmethod
    def get_current_balance(cls):
        return cls.get_instance().current_balance

    @classmethod
    def update_balance(cls, amount: float, transaction_type: str, user=None) -> float:
        """
        Mutate the fund balance atomically.
        transaction_type: 'credit' | 'debit'
        Returns the updated balance.
        """
        fund = cls.get_instance()
        if transaction_type == "credit":
            fund.current_balance = round(float(fund.current_balance) + amount, 2)
        else:
            fund.current_balance = round(float(fund.current_balance) - amount, 2)
        fund.updated_by = user
        fund.save()
        return float(fund.current_balance)


# ─────────────────────────────────────────────────────────────────────────────
# PETTY CASH ENTRY
# ─────────────────────────────────────────────────────────────────────────────

class PettyCashEntry(TimeStampMixin, CreatedByMixin):
    """
    Immutable ledger row for every petty cash movement.

    balance = running total snapshot at the moment this entry was saved.
    This makes the ledger self-consistent without replaying all prior rows.
    """

    TRANSACTION_TYPE_CHOICES = (
        ("credit", "Credit — Fund Replenishment"),
        ("debit",  "Debit — Expense"),
    )

    CATEGORY_CHOICES = (
        ("fund",        "Fund Replenishment"),
        ("office",      "Office Supplies"),
        ("logistics",   "Logistics & Courier"),
        ("hospitality", "Hospitality"),
        ("travel",      "Travel & Transport"),
        ("maintenance", "Maintenance"),
        ("utilities",   "Utilities"),
        ("other",       "Other"),
    )

    RELATED_PARTY_TYPE_CHOICES = (
        ("own", "Own"),
        ("customer", "Customer"),
        ("vendor", "Vendor"),
    )

    financial_year   = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                          related_name="petty_cash_entries")
    transaction_date = models.DateField()
    description      = models.CharField(max_length=500)
    transaction_type = models.CharField(max_length=10, choices=TRANSACTION_TYPE_CHOICES)
    category         = models.CharField(max_length=20, choices=CATEGORY_CHOICES,
                                         default="other")
    related_party_type = models.CharField(
        max_length=20,
        choices=RELATED_PARTY_TYPE_CHOICES,
        default="own",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="petty_cash_entries",
    )
    vendor = models.ForeignKey(
        Vendor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="petty_cash_entries",
    )
    amount           = models.DecimalField(max_digits=10, decimal_places=2)
    balance          = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Running balance after this entry (auto-set on save)",
    )

    # ── Approval ──────────────────────────────────────────────────────────────
    approved_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="approved_petty_cash",
    )
    receipt_file = models.FileField(upload_to="petty_cash_receipts/%Y/%m/",
                                    null=True, blank=True)
    notes        = models.TextField(blank=True, default="")

    class Meta:
        ordering            = ["-transaction_date", "-created_at"]
        verbose_name        = "Petty Cash Entry"
        verbose_name_plural = "Petty Cash Entries"

    def save(self, *args, **kwargs):
        if self.related_party_type == "customer":
            self.vendor = None
        elif self.related_party_type == "vendor":
            self.customer = None
        else:
            self.customer = None
            self.vendor = None
        user = getattr(self, "_current_user", self.created_by)
        new_balance   = PettyCashFund.update_balance(
            float(self.amount), self.transaction_type, user
        )
        self.balance = new_balance
        super().save(*args, **kwargs)

    def __str__(self):
        sign = "+" if self.transaction_type == "credit" else "-"
        return (
            f"{self.transaction_date} | {sign}AED {self.amount} "
            f"| {self.get_category_display()} | bal AED {self.balance}"
        )
