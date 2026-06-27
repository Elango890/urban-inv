# =============================================================================
# sales/models.py
#
# Full sales cycle: Invoice → Payment.
#
# Models:
#   SalesInvoice     — header document (customer snapshot + totals)
#   SalesInvoiceItem — line items referencing masters.Item (goods or service)
#   SalesPayment     — payment received against an invoice
#
# KEY DESIGN CHANGES vs previous version:
#   ✗ Dual FK (asset / service) on line items REMOVED.
#       → replaced by a single "item" FK to masters.Item.
#       → ad-hoc lines use item=None with item_name filled manually.
#   ✗ "Service" import removed (services are now Item rows with item_type="service").
#   ✗ customer_gst snapshot field renamed to customer_trn (matches CustomerSnapshotMixin).
#
# Cascade:
#   SalesInvoiceItem.save/delete  → invoice.recalculate() → _sync_payment_status()
#   SalesPayment.save/delete      → invoice.sync_paid_amount() → customer.sync_outstanding()
# =============================================================================

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum

from masters.models import (
    TimeStampMixin, CreatedByMixin, CustomerSnapshotMixin,
    FinancialYear, Customer, Item,
    PAYMENT_METHOD_CHOICES,
)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _recalc_header(invoice):
    """Re-aggregate line item totals onto the parent SalesInvoice."""
    items = invoice.items.all()
    invoice.subtotal     = round(sum(float(i.subtotal)    for i in items), 2)
    invoice.disc_amount  = round(sum(float(i.disc_amount) for i in items), 2)
    invoice.tax_amount   = round(sum(float(i.tax_amount)  for i in items), 2)
    invoice.total_amount = round(
        float(invoice.subtotal) - float(invoice.disc_amount) + float(invoice.tax_amount), 2
    )
    invoice.save(update_fields=[
        "subtotal", "disc_amount", "tax_amount", "total_amount", "updated_at",
    ])


def _next_invoice_number() -> str:
    from datetime import date
    year   = date.today().year
    prefix = f"INV-{year}-"
    last   = (
        SalesInvoice.objects
        .filter(invoice_number__startswith=prefix)
        .order_by("-invoice_number")
        .first()
    )
    seq = (int(last.invoice_number.split("-")[-1]) + 1) if last else 1
    return f"{prefix}{seq:04d}"


def _next_return_number() -> str:
    from datetime import date
    year = date.today().year
    prefix = f"SRN-{year}-"
    last = (
        SalesReturn.objects
        .filter(return_number__startswith=prefix)
        .order_by("-return_number")
        .first()
    )
    seq = (int(last.return_number.split("-")[-1]) + 1) if last else 1
    return f"{prefix}{seq:04d}"


# ─────────────────────────────────────────────────────────────────────────────
# SALES INVOICE
# ─────────────────────────────────────────────────────────────────────────────

class SalesInvoice(TimeStampMixin, CreatedByMixin, CustomerSnapshotMixin):
    """
    Invoice raised to a customer for goods or services.
    Status flow: draft → confirmed → [paid | partial | cancelled]

    Customer data is snapshotted at creation time via snapshot_customer().
    The FK is retained so reports can still filter by customer.
    """

    STATUS_CHOICES = (
        ("draft",     "Draft"),
        ("confirmed", "Confirmed"),
        ("cancelled", "Cancelled"),
    )

    PAYMENT_STATUS_CHOICES = (
        ("unpaid",  "Unpaid"),
        ("partial", "Partially Paid"),
        ("paid",    "Paid"),
    )

    financial_year = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                       related_name="sales_invoices")
    sales_person   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="assigned_sales_invoices",
    )

    invoice_number = models.CharField(max_length=50, unique=True)
    invoice_date   = models.DateField()
    due_date       = models.DateField(null=True, blank=True)

    # ── Totals (aggregated from SalesInvoiceItem) ─────────────────────────────
    subtotal       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_amount    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    balance_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # ── Invoice-level toggles (PDF / UI) ──────────────────────────────────────
    tax_enabled      = models.BooleanField(default=True)
    discount_enabled = models.BooleanField(default=True)
    discount_mode    = models.CharField(
        max_length=10,
        choices=(("percent", "Percent"), ("fixed", "Fixed")),
        default="percent",
    )
    discount_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    offer_enabled  = models.BooleanField(default=False)
    offer_text     = models.TextField(blank=True, default="")

    status         = models.CharField(max_length=12, choices=STATUS_CHOICES,         default="draft")
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS_CHOICES, default="unpaid")

    # ── Stock dispatch guard ───────────────────────────────────────────────────
    stock_posted = models.BooleanField(
        default=False,
        help_text="True once warehouse stock has been deducted for this invoice.",
    )

    terms_and_conditions = models.TextField(blank=True, default="")
    notes                = models.TextField(blank=True, default="")

    class Meta:
        ordering            = ["-invoice_date", "-created_at"]
        verbose_name        = "Sales Invoice"
        verbose_name_plural = "Sales Invoices"

    def __str__(self):
        return f"INV#{self.invoice_number} — {self.customer_name}"

    def recalculate(self):
        _recalc_header(self)
        self._sync_payment_status()

    def _sync_payment_status(self):
        """
        Recompute balance_amount and payment_status from paid_amount.
        FIX: paid_amount is explicitly included in update_fields so it
        is persisted to the DB (was missing in a prior version).
        """
        paid  = float(self.paid_amount)
        total = float(self.total_amount)
        self.balance_amount = round(total - paid, 2)
        if paid <= 0:
            self.payment_status = "unpaid"
        elif paid >= total - 0.01:
            self.payment_status = "paid"
        else:
            self.payment_status = "partial"
        self.save(update_fields=[
            "paid_amount", "balance_amount", "payment_status", "updated_at",
        ])

    def sync_paid_amount(self):
        """Recalculate paid_amount from linked SalesPayment rows."""
        total_paid       = self.payments.aggregate(t=Sum("amount"))["t"] or 0
        self.paid_amount = total_paid
        self._sync_payment_status()
        if self.customer:
            self.customer.sync_outstanding()


# ─────────────────────────────────────────────────────────────────────────────
# SALES INVOICE ITEM
# ─────────────────────────────────────────────────────────────────────────────

class SalesInvoiceItem(models.Model):
    """
    Line item on a SalesInvoice.

    item FK → masters.Item (goods or service).
    Set item=None for ad-hoc / free-text lines and fill item_name manually.

    Pricing formula:
        rsp_without_vat  = selling price ex-VAT (= unit_price)
        rsp_incl_vat     = rsp_without_vat × (1 + tax_rate/100)
        discount_per_unit = rsp_without_vat × discount% OR fixed discount amount
        amount_per_unit  = rsp_without_vat − discount_per_unit
        subtotal         = quantity × rsp_without_vat
        disc_amount      = quantity × discount_per_unit
        taxable          = quantity × amount_per_unit
        tax_amount       = taxable  × tax_rate / 100
        line_total       = taxable  + tax_amount
    """

    DISCOUNT_TYPE_CHOICES = (
        ("amount",  "Fixed Amount"),
        ("percent", "Percentage"),
    )

    invoice = models.ForeignKey(SalesInvoice, on_delete=models.CASCADE,
                                related_name="items")

    # Single FK replaces old dual (asset / service) FK pattern
    item             = models.ForeignKey(Item, on_delete=models.PROTECT,
                                         null=True, blank=True,
                                         related_name="sales_items")
    item_name        = models.CharField(max_length=200, default="",
                                        help_text="Auto-filled from item; editable for ad-hoc lines")
    item_description = models.TextField(blank=True, default="")

    quantity        = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price      = models.DecimalField(max_digits=12, decimal_places=2)
    batch_number    = models.CharField(max_length=100, blank=True, default="")
    expiry_date     = models.DateField(null=True, blank=True)
    rsp_incl_vat    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    rsp_without_vat = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_type   = models.CharField(max_length=10, choices=DISCOUNT_TYPE_CHOICES,
                                       default="amount")
    discount        = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_rate        = models.DecimalField(max_digits=5,  decimal_places=2, default=0)

    # ── Calculated ────────────────────────────────────────────────────────────
    amount_per_unit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    subtotal        = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total      = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Sales Invoice Item"

    def __str__(self):
        return f"{self.invoice.invoice_number} — {self.item_name}"

    def save(self, *args, **kwargs):
        # Auto-fill item_name from FK
        if self.item and not self.item_name:
            self.item_name = self.item.name

        qty          = Decimal(str(self.quantity   or 0))
        rsp_without  = Decimal(str(self.rsp_without_vat or self.unit_price or 0))
        tax_rate     = Decimal(str(self.tax_rate   or 0))
        rsp_incl     = Decimal(str(self.rsp_incl_vat or 0))
        discount     = Decimal(str(self.discount   or 0))
        discount_type = self.discount_type or "amount"

        # Sanitise
        rsp_without = max(Decimal("0"), rsp_without)
        discount    = max(Decimal("0"), discount)

        # Derive missing price from the other
        if rsp_incl <= 0:
            rsp_incl = rsp_without * (Decimal("1") + tax_rate / Decimal("100"))
        elif rsp_without > 0 and tax_rate <= 0:
            tax_rate = ((rsp_incl - rsp_without) / rsp_without) * Decimal("100")

        # Compute discount per unit
        if discount_type == "percent":
            discount = min(discount, Decimal("100"))
            discount_per_unit = rsp_without * discount / Decimal("100")
        else:
            discount_per_unit = min(discount, rsp_without)

        amount_per_unit = max(Decimal("0"), rsp_without - discount_per_unit)
        taxable         = qty * amount_per_unit
        subtotal        = qty * rsp_without
        disc_amount     = qty * discount_per_unit
        tax_amount      = taxable * tax_rate / Decimal("100")

        self.unit_price      = round(float(rsp_without), 2)
        self.rsp_without_vat = round(float(rsp_without), 2)
        self.rsp_incl_vat    = round(float(rsp_incl), 2)
        self.discount_type   = discount_type
        self.discount        = round(float(discount), 2)
        self.tax_rate        = round(float(tax_rate), 2)
        self.amount_per_unit = round(float(amount_per_unit), 2)
        self.subtotal        = round(float(subtotal), 2)
        self.disc_amount     = round(float(disc_amount), 2)
        self.tax_amount      = round(float(tax_amount), 2)
        self.line_total      = round(float(taxable + tax_amount), 2)

        super().save(*args, **kwargs)
        self.invoice.recalculate()

    def delete(self, *args, **kwargs):
        invoice = self.invoice
        super().delete(*args, **kwargs)
        invoice.recalculate()


# ─────────────────────────────────────────────────────────────────────────────
# SALES PAYMENT
# ─────────────────────────────────────────────────────────────────────────────

class SalesPayment(TimeStampMixin, CreatedByMixin):
    """
    Payment received from a customer against a SalesInvoice.
    Supports partial and split payments.
    save/delete both trigger invoice.sync_paid_amount() → customer.sync_outstanding().
    """

    financial_year = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                       related_name="sales_payments")
    sales_invoice  = models.ForeignKey(SalesInvoice, on_delete=models.PROTECT,
                                       related_name="payments")

    payment_date   = models.DateField()
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    reference_no   = models.CharField(max_length=100, blank=True, default="",
                                      help_text="UTR / cheque / transaction ID")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering     = ["-payment_date", "-created_at"]
        verbose_name = "Sales Payment"

    def __str__(self):
        return f"AED {self.amount} ← {self.sales_invoice.invoice_number}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.sales_invoice.sync_paid_amount()

    def delete(self, *args, **kwargs):
        invoice = self.sales_invoice
        super().delete(*args, **kwargs)
        invoice.sync_paid_amount()


class SalesReturn(TimeStampMixin, CreatedByMixin):
    STATUS_CHOICES = (
        ("draft", "Draft"),
        ("confirmed", "Confirmed"),
        ("cancelled", "Cancelled"),
    )

    financial_year = models.ForeignKey(
        FinancialYear,
        on_delete=models.PROTECT,
        related_name="sales_returns",
    )
    sales_invoice = models.ForeignKey(
        SalesInvoice,
        on_delete=models.PROTECT,
        related_name="returns",
        null=True,
        blank=True,
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="sales_returns",
    )
    warehouse = models.ForeignKey(
        "stock.Warehouse",
        on_delete=models.PROTECT,
        related_name="sales_returns",
    )

    return_number = models.CharField(max_length=50, unique=True)
    return_date = models.DateField()
    reason = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="draft")

    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    stock_posted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-return_date", "-created_at"]
        verbose_name = "Sales Return"
        verbose_name_plural = "Sales Returns"

    def __str__(self):
        if self.sales_invoice_id:
            return f"{self.return_number} — {self.sales_invoice.invoice_number}"
        return f"{self.return_number} — {self.customer.display_name}"

    def recalculate(self):
        items = self.items.all()
        self.subtotal = round(sum(float(i.subtotal) for i in items), 2)
        self.tax_amount = round(sum(float(i.tax_amount) for i in items), 2)
        self.total_amount = round(sum(float(i.line_total) for i in items), 2)
        self.save(update_fields=["subtotal", "tax_amount", "total_amount", "updated_at"])


class SalesReturnItem(models.Model):
    DISPOSITION_CHOICES = (
        ("restock", "Restock"),
        ("damaged", "Damaged"),
        ("expired", "Expired"),
    )

    sales_return = models.ForeignKey(
        SalesReturn,
        on_delete=models.CASCADE,
        related_name="items",
    )
    sales_invoice_item = models.ForeignKey(
        SalesInvoiceItem,
        on_delete=models.PROTECT,
        related_name="return_items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="sales_return_items",
    )
    item_name = models.CharField(max_length=200, default="")
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disposition = models.CharField(max_length=12, choices=DISPOSITION_CHOICES, default="restock")
    reason = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Sales Return Item"

    def __str__(self):
        return f"{self.sales_return.return_number} — {self.item_name}"

    def save(self, *args, **kwargs):
        if self.sales_invoice_item and not self.item_name:
            self.item_name = self.sales_invoice_item.item_name
        if self.sales_invoice_item and not self.item_id:
            self.item = self.sales_invoice_item.item
        qty = Decimal(str(self.quantity or 0))
        unit_price = Decimal(str(self.unit_price or 0))
        tax_rate = Decimal(str(self.tax_rate or 0))
        self.subtotal = round(qty * unit_price, 2)
        self.tax_amount = round(float(self.subtotal) * float(tax_rate) / 100, 2)
        self.line_total = round(float(self.subtotal) + float(self.tax_amount), 2)
        super().save(*args, **kwargs)
        self.sales_return.recalculate()

    def delete(self, *args, **kwargs):
        sales_return = self.sales_return
        super().delete(*args, **kwargs)
        sales_return.recalculate()
