# =============================================================================
# purchases/models.py
#
# Full purchase cycle: PO → Purchase Entry (GRN) → Payment.
#
# Models:
#   PurchaseOrder      — approval-stage request to a vendor
#   PurchaseOrderItem  — line items on a PO
#   PurchaseEntry      — supplier invoice / goods receipt note
#   PurchaseEntryItem  — line items on a PE
#   PurchasePayment    — payment made to vendor against a PE
#
# KEY DESIGN CHANGES vs previous version:
#   ✗ Dual FK (asset / service) on line items REMOVED.
#       → replaced by a single "item" FK to masters.Item.
#       → ad-hoc / free-text lines use item=None with item_name filled manually.
#   ✗ "Service" import removed (services are now Item rows with item_type="service").
#   ✗ "Supplier" import kept as alias for Vendor for backward compat.
#
# STOCK FLOW:
#   Stock is NOT updated when a PurchaseEntry is saved.
#   Stock updates only when the user clicks "Receive Package":
#       POST /api/purchases/entries/<id>/receive/
#   → PurchaseEntryReceiveView calls item._record_stock_receipt() per line.
#   is_received=True acts as idempotency guard.
# =============================================================================

from django.conf import settings
from django.db import models
from django.db.models import Sum

from masters.models import (
    TimeStampMixin, CreatedByMixin,
    FinancialYear, Item, Vendor, Supplier, Customer,
    PAYMENT_METHOD_CHOICES, PAYMENT_TERMS_CHOICES,
)


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPER
# ─────────────────────────────────────────────────────────────────────────────

def _recalc_header(instance):
    """Re-aggregate line item totals onto the parent document header."""
    items = instance.items.all()
    instance.subtotal     = round(sum(float(i.subtotal)    for i in items), 2)
    instance.disc_amount  = round(sum(float(i.disc_amount) for i in items), 2)
    instance.tax_amount   = round(sum(float(i.tax_amount)  for i in items), 2)
    instance.total_amount = round(
        float(instance.subtotal) - float(instance.disc_amount) + float(instance.tax_amount), 2
    )
    instance.save(update_fields=[
        "subtotal", "disc_amount", "tax_amount", "total_amount", "updated_at",
    ])


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASE ORDER
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseOrder(TimeStampMixin, CreatedByMixin):
    """
    Approval-stage purchase request raised to a vendor.
    Status flow: draft → submitted → approved → [received | partial | cancelled]

    Converting an approved PO to a Purchase Entry is done via the API;
    one PO can generate multiple partial PEs.
    Stock is NOT affected at PO stage.
    """

    STATUS_CHOICES = (
        ("draft",     "Draft"),
        ("submitted", "Submitted for Approval"),
        ("approved",  "Approved"),
        ("received",  "Fully Received"),
        ("partial",   "Partially Received"),
        ("cancelled", "Cancelled"),
    )

    financial_year = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                       related_name="purchase_orders")
    vendor         = models.ForeignKey(Vendor, on_delete=models.PROTECT,
                                       related_name="purchase_orders")

    po_number     = models.CharField(max_length=50, unique=True)
    reference_no  = models.CharField(max_length=100, blank=True, default="")
    order_date    = models.DateField()
    expected_date = models.DateField(null=True, blank=True)

    # ── Delivery ──────────────────────────────────────────────────────────────
    delivery_address_type = models.CharField(
        max_length=20,
        choices=(("organization", "Organization"), ("customer", "Customer")),
        default="organization",
    )
    delivery_customer = models.ForeignKey(
        Customer, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_orders",
    )
    delivery_address    = models.TextField(blank=True, default="")
    shipment_preference = models.CharField(max_length=100, blank=True, default="")

    # ── Terms ─────────────────────────────────────────────────────────────────
    payment_terms = models.CharField(max_length=20, choices=PAYMENT_TERMS_CHOICES,
                                     default="net_30")
    tax_exclusive = models.BooleanField(default=True)
    tax_level     = models.CharField(
        max_length=20,
        choices=(("item", "Item Level"), ("transaction", "Transaction Level")),
        default="item",
    )

    # ── Totals (aggregated from PurchaseOrderItem) ────────────────────────────
    subtotal     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # ── Approval ──────────────────────────────────────────────────────────────
    status      = models.CharField(max_length=15, choices=STATUS_CHOICES, default="draft")
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="approved_purchase_orders",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    notes       = models.TextField(blank=True, default="")

    class Meta:
        ordering     = ["-order_date", "-created_at"]
        verbose_name = "Purchase Order"

    def __str__(self):
        return f"PO#{self.po_number} — {self.vendor.name}"

    def recalculate(self):
        _recalc_header(self)


class PurchaseOrderItem(models.Model):
    """
    Line item on a PurchaseOrder.

    item FK → masters.Item (goods or service).
    Set item=None for ad-hoc free-text lines and fill item_name manually.
    No stock changes occur here.
    """

    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE,
                              related_name="items")

    # Single FK replaces old dual (asset / service) FK pattern
    item      = models.ForeignKey(Item, on_delete=models.PROTECT,
                                  null=True, blank=True,
                                  related_name="po_items")
    item_name = models.CharField(max_length=200, default="",
                                 help_text="Auto-filled from item; editable for ad-hoc lines")

    quantity     = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price   = models.DecimalField(max_digits=12, decimal_places=2)
    discount     = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    tax_rate     = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    account      = models.CharField(max_length=100, blank=True, default="",
                                    help_text="Override GL account for this line")
    batch_number = models.CharField(max_length=100, blank=True, default="")
    expiry_date  = models.DateField(null=True, blank=True)

    # ── Calculated ────────────────────────────────────────────────────────────
    subtotal    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes = models.TextField(blank=True, default="")

    def save(self, *args, **kwargs):
        if self.item and not self.item_name:
            self.item_name = self.item.name

        qty              = float(self.quantity)
        price            = float(self.unit_price)
        self.subtotal    = round(qty * price, 2)
        self.disc_amount = round(float(self.subtotal) * float(self.discount) / 100, 2)
        taxable          = float(self.subtotal) - float(self.disc_amount)
        self.tax_amount  = round(taxable * float(self.tax_rate) / 100, 2)
        self.line_total  = round(taxable + float(self.tax_amount), 2)

        super().save(*args, **kwargs)
        self.order.recalculate()

    def delete(self, *args, **kwargs):
        order = self.order
        super().delete(*args, **kwargs)
        order.recalculate()

    def __str__(self):
        return f"{self.order.po_number} — {self.item_name}"


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASE ENTRY  (Supplier Invoice / GRN)
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseEntry(TimeStampMixin, CreatedByMixin):
    """
    Actual goods/services receipt with vendor invoice.
    Creates a payable to the vendor.
    Optionally linked to an approved PurchaseOrder.

    STOCK is NOT updated on save.
    Stock updates only via PurchaseEntryReceiveView ("Receive Package" button).
    is_received=True prevents double-receipt.
    """

    PAYMENT_STATUS_CHOICES = (
        ("unpaid",  "Unpaid"),
        ("partial", "Partially Paid"),
        ("paid",    "Paid"),
    )

    financial_year = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                       related_name="purchase_entries")
    vendor         = models.ForeignKey(Vendor, on_delete=models.PROTECT,
                                       related_name="purchase_entries")
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="entries",
        help_text="Originating PO (optional)",
    )

    entry_number        = models.CharField(max_length=50, unique=True,
                                           help_text="Internal reference e.g. PE-2025-001")
    vendor_invoice_no   = models.CharField(max_length=100, blank=True, default="",
                                           help_text="Vendor's own invoice number")
    invoice_date        = models.DateField()
    due_date            = models.DateField(null=True, blank=True)
    invoice_file        = models.FileField(upload_to="purchase_invoices/%Y/%m/",
                                           null=True, blank=True)

    # ── Totals ────────────────────────────────────────────────────────────────
    subtotal       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_amount    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    balance_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUS_CHOICES,
                                      default="unpaid")

    # ── Goods Receipt guard ───────────────────────────────────────────────────
    is_received = models.BooleanField(
        default=False,
        help_text=(
            "True once 'Receive Package' has been clicked and warehouse stock updated. "
            "Cannot be received again once True."
        ),
    )
    received_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="received_purchase_entries",
    )

    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering            = ["-invoice_date", "-created_at"]
        verbose_name        = "Purchase Entry"
        verbose_name_plural = "Purchase Entries"

    def __str__(self):
        return f"PE#{self.entry_number} — {self.vendor.name}"

    def recalculate(self):
        _recalc_header(self)
        self._sync_payment_status()

    def _sync_payment_status(self):
        paid  = float(self.paid_amount)
        total = float(self.total_amount)
        self.balance_amount = round(total - paid, 2)
        if paid <= 0:
            self.payment_status = "unpaid"
        elif paid >= total:
            self.payment_status = "paid"
        else:
            self.payment_status = "partial"
        self.save(update_fields=["balance_amount", "payment_status", "updated_at"])

    def sync_paid_amount(self):
        """Recalculate paid_amount from linked PurchasePayment rows."""
        total_paid      = self.payments.aggregate(t=Sum("amount"))["t"] or 0
        self.paid_amount = total_paid
        self._sync_payment_status()
        self.vendor.sync_outstanding()


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASE ENTRY ITEM
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseEntryItem(models.Model):
    """
    Line item on a PurchaseEntry.

    item FK → masters.Item (or None for free-text ad-hoc lines).
    Stock is NOT touched in save(); it is updated only via
    PurchaseEntryReceiveView which calls _record_stock_receipt() per line.
    """

    entry     = models.ForeignKey(PurchaseEntry, on_delete=models.CASCADE,
                                  related_name="items")
    item      = models.ForeignKey(Item, on_delete=models.PROTECT,
                                  null=True, blank=True,
                                  related_name="purchase_entry_items")
    item_name = models.CharField(max_length=200, default="")

    quantity     = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price   = models.DecimalField(max_digits=12, decimal_places=2)
    discount     = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    tax_rate     = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    batch_number = models.CharField(max_length=100, blank=True, default="")
    expiry_date  = models.DateField(null=True, blank=True)

    # ── Calculated ────────────────────────────────────────────────────────────
    subtotal    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes = models.TextField(blank=True, default="")

    def save(self, *args, **kwargs):
        if self.item and not self.item_name:
            self.item_name = self.item.name

        qty              = float(self.quantity)
        price            = float(self.unit_price)
        self.subtotal    = round(qty * price, 2)
        self.disc_amount = round(float(self.subtotal) * float(self.discount) / 100, 2)
        taxable          = float(self.subtotal) - float(self.disc_amount)
        self.tax_amount  = round(taxable * float(self.tax_rate) / 100, 2)
        self.line_total  = round(taxable + float(self.tax_amount), 2)

        super().save(*args, **kwargs)
        self.entry.recalculate()

        # ── STOCK IS NOT UPDATED HERE ────────────────────────────────────────
        # Call _record_stock_receipt() from PurchaseEntryReceiveView only.
        # ─────────────────────────────────────────────────────────────────────

    def delete(self, *args, **kwargs):
        entry = self.entry
        super().delete(*args, **kwargs)
        entry.recalculate()

    def _record_stock_receipt(self, warehouse, performed_by):
        """
        Increment Stock and write a StockHistory row for this goods line.

        Called ONLY from PurchaseEntryReceiveView after the user clicks
        "Receive Package". Never called from save().

        Service items (item.is_service) and ad-hoc lines (item=None) are
        silently skipped — they have no inventory effect.
        """
        if not self.item or self.item.is_service or not self.item.track_inventory:
            return None

        from stock.models import Stock, StockBatch, StockHistory

        stock, _ = Stock.objects.get_or_create(
            item=self.item,
            warehouse=warehouse,
            defaults={"total_quantity": 0, "minimum_stock": 0},
        )
        qty = int(self.quantity)
        if qty <= 0:
            return None

        stock.total_quantity += qty
        stock.save(update_fields=["total_quantity", "updated_at"])

        batch = StockBatch.objects.create(
            item=self.item,
            warehouse=warehouse,
            purchase_entry_item=self,
            batch_number=(self.batch_number or "").strip(),
            expiry_date=self.expiry_date,
            quantity_received=qty,
            quantity_available=qty,
        )

        StockHistory.objects.create(
            item           = self.item,
            warehouse      = warehouse,
            movement_type  = "purchase_receipt",
            quantity       = qty,
            balance_after  = stock.available_quantity,
            reference_type = "PurchaseEntry",
            reference_id   = self.entry_id,
            batch_number   = batch.batch_number,
            expiry_date    = batch.expiry_date,
            reason         = f"Received via {self.entry.entry_number}",
            performed_by   = performed_by,
        )

        return {
            "assetId": self.item_id,
            "assetName": self.item.name,
            "assetCode": self.item.asset_code,
            "quantityAdded": qty,
            "batchId": batch.id,
            "batchNumber": batch.batch_number,
            "expiryDate": str(batch.expiry_date) if batch.expiry_date else None,
            "newTotal": stock.total_quantity,
            "available": stock.available_quantity,
        }

    def __str__(self):
        return f"{self.entry.entry_number} — {self.item_name}"


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASE PAYMENT
# ─────────────────────────────────────────────────────────────────────────────

class PurchasePayment(TimeStampMixin, CreatedByMixin):
    """
    Payment made to a vendor against a PurchaseEntry.
    Supports partial and split payments.
    save/delete both trigger entry.sync_paid_amount() → vendor.sync_outstanding().
    """

    financial_year = models.ForeignKey(FinancialYear, on_delete=models.PROTECT,
                                       related_name="purchase_payments")
    purchase_entry = models.ForeignKey(PurchaseEntry, on_delete=models.PROTECT,
                                       related_name="payments")

    payment_date   = models.DateField()
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    reference_no   = models.CharField(max_length=100, blank=True, default="",
                                      help_text="UTR / cheque no. / transaction ID")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering     = ["-payment_date", "-created_at"]
        verbose_name = "Purchase Payment"

    def __str__(self):
        return f"AED {self.amount} → {self.purchase_entry.entry_number}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.purchase_entry.sync_paid_amount()

    def delete(self, *args, **kwargs):
        entry = self.purchase_entry
        super().delete(*args, **kwargs)
        entry.sync_paid_amount()
