# =============================================================================
# stock/models.py
#
# Warehouse inventory management.
#
# Models:
#   Warehouse        — physical storage location
#   Stock            — quantity snapshot per (Item, Warehouse) pair
#   StockAdjustment  — manual add / remove / damage operations
#   StockTransfer    — move stock between warehouses
#   StockHistory     — immutable audit ledger for every stock movement
#
# REMOVED vs previous version:
#   ✗ All references to "Asset" — replaced by "Item" from masters.models
#   ✗ "maintenance_out" / "maintenance_return" movement types (no maintenance module)
#   ✗ "allocated" / "returned" movement types (no allocation module)
#
# Stock flow rules:
#   • Purchase receipt  → PurchaseEntryReceiveView calls item._record_stock_receipt()
#   • Sales dispatch    → SalesInvoice "Dispatch" action deducts stock
#   • Manual adjustment → StockAdjustment (add / remove / damaged)
#   • Transfer          → StockTransfer.confirm()
#   • Opening balance   → StockAdjustment with type="add", reason="Opening Balance"
# =============================================================================

from django.db import models, transaction
from django.conf import settings
from django.utils import timezone
from masters.models import TimeStampMixin, CreatedByMixin, Item


# ─────────────────────────────────────────────────────────────────────────────
# WAREHOUSE
# ─────────────────────────────────────────────────────────────────────────────

class Warehouse(TimeStampMixin):
    """Physical storage location. Items are stocked per warehouse."""
    name      = models.CharField(max_length=200, unique=True)
    location  = models.TextField(blank=True, default="")
    manager   = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="managed_warehouses",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────────────────────
# STOCK
# ─────────────────────────────────────────────────────────────────────────────

class Stock(models.Model):
    """
    Running quantity snapshot for one Item at one Warehouse.
    available_quantity = total_quantity − damaged_quantity.

    Only Items with track_inventory=True should have Stock rows.
    Service items must never appear here.
    """
    item             = models.ForeignKey(Item, on_delete=models.CASCADE,
                                         related_name="stock_entries")
    warehouse        = models.ForeignKey(Warehouse, on_delete=models.CASCADE,
                                         related_name="stock_entries")
    total_quantity   = models.PositiveIntegerField(default=0)
    damaged_quantity = models.PositiveIntegerField(default=0)
    expired_quantity = models.PositiveIntegerField(default=0)
    minimum_stock    = models.PositiveIntegerField(default=0,
                                                   help_text="Low-stock alert threshold")
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together     = ("item", "warehouse")
        verbose_name_plural = "Stock"

    def __str__(self):
        return f"{self.item.name} @ {self.warehouse.name} = {self.available_quantity}"

    @property
    def available_quantity(self):
        return max(0, self.total_quantity - self.damaged_quantity - self.expired_quantity)

    @property
    def is_low_stock(self):
        return self.available_quantity <= self.minimum_stock


class StockBatch(TimeStampMixin):
    """
    Batch-wise stock ledger for one Item at one Warehouse.

    Each receipt creates a row that stores the received quantity and the current
    sellable quantity left for FEFO dispatch.
    """

    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="batch_stocks",
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name="batch_stocks",
    )
    purchase_entry_item = models.ForeignKey(
        "purchases.PurchaseEntryItem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_batches",
    )
    sales_return_item = models.ForeignKey(
        "sales.SalesReturnItem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="restocked_batches",
    )
    batch_number = models.CharField(max_length=100, blank=True, default="")
    expiry_date = models.DateField(null=True, blank=True)
    quantity_received = models.PositiveIntegerField(default=0)
    quantity_available = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["expiry_date", "created_at", "id"]
        indexes = [
            models.Index(
                fields=["item", "warehouse", "expiry_date"],
                name="stockbatch_wh_exp_idx",
            ),
            models.Index(
                fields=["item", "quantity_available"],
                name="stockbatch_avail_idx",
            ),
        ]

    def __str__(self):
        batch_label = self.batch_number or "No Batch"
        return (
            f"{self.item.name} | {batch_label} | "
            f"avail={self.quantity_available}/{self.quantity_received}"
        )

    @property
    def quantity_sold(self):
        return max(0, self.quantity_received - self.quantity_available)


def _fefo_batch_queryset(stock):
    return (
        StockBatch.objects
        .select_for_update()
        .filter(
            item=stock.item,
            warehouse=stock.warehouse,
            quantity_available__gt=0,
        )
        .order_by("expiry_date", "created_at", "id")
    )


# ─────────────────────────────────────────────────────────────────────────────
# STOCK ADJUSTMENT
# ─────────────────────────────────────────────────────────────────────────────

class StockAdjustment(TimeStampMixin, CreatedByMixin):
    """
    Manual correction to stock on hand.

    add      → total_quantity += quantity
    remove   → total_quantity -= quantity  (floored at 0)
    damaged  → damaged_quantity += quantity (capped at total_quantity)
    expired  → expired_quantity += quantity (capped at total_quantity)
    dmg_out  → total_quantity -= quantity and damaged_quantity -= quantity
    exp_out  → total_quantity -= quantity and expired_quantity -= quantity

    Applies immediately on first save; subsequent saves are no-ops (is_new guard).
    """
    ADJUSTMENT_TYPE_CHOICES = (
        ("add",     "Add Stock"),
        ("remove",  "Remove Stock"),
        ("damaged", "Mark as Damaged"),
        ("expired", "Mark as Expired"),
        ("dmg_out", "Remove Damaged Stock"),
        ("exp_out", "Remove Expired Stock"),
    )

    stock           = models.ForeignKey(Stock, on_delete=models.CASCADE,
                                        related_name="adjustments")
    adjustment_type = models.CharField(max_length=10, choices=ADJUSTMENT_TYPE_CHOICES)
    quantity        = models.PositiveIntegerField()
    reason          = models.TextField()
    reference_no    = models.CharField(max_length=100, blank=True, default="")
    restored_at     = models.DateTimeField(null=True, blank=True)
    restored_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="restored_stock_adjustments",
    )
    restore_reason  = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_adjustment_type_display()} {self.quantity} × {self.stock.item.name}"

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        super().save(*args, **kwargs)
        if is_new:
            self._apply()

    def _apply(self):
        with transaction.atomic():
            stock = Stock.objects.select_for_update().get(pk=self.stock_id)
            update_fields = ["updated_at"]

            if self.adjustment_type == "add":
                stock.total_quantity += self.quantity
                update_fields.append("total_quantity")
            elif self.adjustment_type == "remove":
                stock.total_quantity = max(0, stock.total_quantity - self.quantity)
                update_fields.append("total_quantity")
                self._allocate_batch_quantity(stock, self.quantity)
            elif self.adjustment_type == "damaged":
                stock.damaged_quantity = min(
                    stock.total_quantity,
                    stock.damaged_quantity + self.quantity,
                )
                update_fields.append("damaged_quantity")
                self._allocate_batch_quantity(stock, self.quantity)
            elif self.adjustment_type == "expired":
                stock.expired_quantity = min(
                    stock.total_quantity,
                    stock.expired_quantity + self.quantity,
                )
                update_fields.append("expired_quantity")
                self._allocate_batch_quantity(stock, self.quantity)
            elif self.adjustment_type == "dmg_out":
                stock.total_quantity = max(0, stock.total_quantity - self.quantity)
                stock.damaged_quantity = max(0, stock.damaged_quantity - self.quantity)
                update_fields.extend(["total_quantity", "damaged_quantity"])
            elif self.adjustment_type == "exp_out":
                stock.total_quantity = max(0, stock.total_quantity - self.quantity)
                stock.expired_quantity = max(0, stock.expired_quantity - self.quantity)
                update_fields.extend(["total_quantity", "expired_quantity"])

            stock.save(update_fields=update_fields)
            self.stock = stock
            StockHistory.objects.create(
                item=stock.item,
                warehouse=stock.warehouse,
                movement_type=self.adjustment_type,
                quantity=self.quantity,
                balance_after=stock.available_quantity,
                reference_type="StockAdjustment",
                reference_id=self.pk,
                reason=self.reason,
                performed_by=self.created_by,
            )

    def _allocate_batch_quantity(self, stock, quantity):
        qty_remaining = int(quantity or 0)
        if qty_remaining <= 0:
            return

        for batch in _fefo_batch_queryset(stock):
            removable = min(int(batch.quantity_available or 0), qty_remaining)
            if removable <= 0:
                continue
            batch.quantity_available -= removable
            batch.save(update_fields=["quantity_available", "updated_at"])
            StockAdjustmentBatchAllocation.objects.create(
                stock_adjustment=self,
                stock_batch=batch,
                quantity=removable,
            )
            qty_remaining -= removable
            if qty_remaining <= 0:
                break

    @property
    def is_restored(self):
        return bool(self.restored_at)

    @property
    def can_restore(self):
        return self.adjustment_type in {"remove", "damaged", "expired", "dmg_out", "exp_out"} and not self.is_restored

    def restore(self, performed_by, reason=""):
        if not self.can_restore:
            raise ValueError("This adjustment cannot be restored.")

        with transaction.atomic():
            stock = Stock.objects.select_for_update().get(pk=self.stock_id)
            allocations = list(
                self.batch_allocations.select_related("stock_batch").select_for_update()
            )
            update_fields = ["updated_at"]
            restore_reason = (reason or f"Restored {self.get_adjustment_type_display().lower()} adjustment").strip()

            if self.adjustment_type == "remove":
                stock.total_quantity += self.quantity
                update_fields.append("total_quantity")
            elif self.adjustment_type == "damaged":
                stock.damaged_quantity = max(0, stock.damaged_quantity - self.quantity)
                update_fields.append("damaged_quantity")
            elif self.adjustment_type == "expired":
                stock.expired_quantity = max(0, stock.expired_quantity - self.quantity)
                update_fields.append("expired_quantity")
            elif self.adjustment_type == "dmg_out":
                stock.total_quantity += self.quantity
                stock.damaged_quantity += self.quantity
                update_fields.extend(["total_quantity", "damaged_quantity"])
            elif self.adjustment_type == "exp_out":
                stock.total_quantity += self.quantity
                stock.expired_quantity += self.quantity
                update_fields.extend(["total_quantity", "expired_quantity"])

            for allocation in allocations:
                batch = allocation.stock_batch
                batch.quantity_available = min(
                    batch.quantity_received,
                    batch.quantity_available + allocation.quantity,
                )
                batch.save(update_fields=["quantity_available", "updated_at"])

            stock.save(update_fields=update_fields)
            restored_at = timezone.now()
            self.restored_at = restored_at
            self.restored_by = performed_by
            self.restore_reason = restore_reason
            self.save(update_fields=["restored_at", "restored_by", "restore_reason", "updated_at"])

            StockHistory.objects.create(
                item=stock.item,
                warehouse=stock.warehouse,
                movement_type="restored",
                quantity=self.quantity,
                balance_after=stock.available_quantity,
                reference_type="StockAdjustment",
                reference_id=self.pk,
                reason=restore_reason,
                performed_by=performed_by,
            )


class StockAdjustmentBatchAllocation(models.Model):
    stock_adjustment = models.ForeignKey(
        StockAdjustment,
        on_delete=models.CASCADE,
        related_name="batch_allocations",
    )
    stock_batch = models.ForeignKey(
        StockBatch,
        on_delete=models.PROTECT,
        related_name="adjustment_allocations",
    )
    quantity = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return (
            f"{self.stock_adjustment.get_adjustment_type_display()} | "
            f"{self.stock_batch.batch_number or 'No Batch'} | qty={self.quantity}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# STOCK TRANSFER
# ─────────────────────────────────────────────────────────────────────────────

class StockTransfer(TimeStampMixin, CreatedByMixin):
    """
    Move a quantity of one Item from one Warehouse to another.
    Call confirm() to execute; status moves pending → completed atomically.
    """
    STATUS_CHOICES = (
        ("pending",   "Pending"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    )

    item           = models.ForeignKey(Item, on_delete=models.CASCADE,
                                       related_name="transfers")
    from_warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT,
                                       related_name="transfers_out")
    to_warehouse   = models.ForeignKey(Warehouse, on_delete=models.PROTECT,
                                       related_name="transfers_in")
    quantity       = models.PositiveIntegerField()
    transfer_date  = models.DateField()
    reason         = models.TextField(blank=True, default="")
    status         = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pending")
    notes          = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-transfer_date", "-created_at"]

    def __str__(self):
        return (
            f"Transfer {self.quantity} × {self.item.name}: "
            f"{self.from_warehouse.name} → {self.to_warehouse.name}"
        )

    def confirm(self):
        from django.db import transaction
        if self.status != "pending":
            raise ValueError("Only pending transfers can be confirmed.")
        with transaction.atomic():
            src, _ = Stock.objects.get_or_create(
                item=self.item, warehouse=self.from_warehouse,
                defaults={"total_quantity": 0},
            )
            if src.available_quantity < self.quantity:
                raise ValueError(
                    f"Insufficient stock: only {src.available_quantity} "
                    f"available in {self.from_warehouse.name}."
                )
            dst, _ = Stock.objects.get_or_create(
                item=self.item, warehouse=self.to_warehouse,
                defaults={"total_quantity": 0},
            )
            src.total_quantity -= self.quantity
            src.save(update_fields=["total_quantity", "updated_at"])
            dst.total_quantity += self.quantity
            dst.save(update_fields=["total_quantity", "updated_at"])

            StockHistory.objects.create(
                item=self.item, warehouse=self.from_warehouse,
                movement_type="transfer_out", quantity=self.quantity,
                balance_after=src.available_quantity,
                reference_type="StockTransfer", reference_id=self.pk,
                reason=f"Transfer to {self.to_warehouse.name}",
                performed_by=self.created_by,
            )
            StockHistory.objects.create(
                item=self.item, warehouse=self.to_warehouse,
                movement_type="transfer_in", quantity=self.quantity,
                balance_after=dst.available_quantity,
                reference_type="StockTransfer", reference_id=self.pk,
                reason=f"Transfer from {self.from_warehouse.name}",
                performed_by=self.created_by,
            )
            self.status = "completed"
            self.save(update_fields=["status", "updated_at"])


# ─────────────────────────────────────────────────────────────────────────────
# STOCK HISTORY  (immutable audit ledger)
# ─────────────────────────────────────────────────────────────────────────────

class StockHistory(models.Model):
    """
    Append-only record of every stock movement.
    Never update or delete rows — they are the audit trail.

    movement_type values and their sources:
        purchase_receipt  ← PurchaseEntryReceiveView
        sale_dispatch     ← SalesInvoice dispatch action
        add               ← StockAdjustment (add)
        remove            ← StockAdjustment (remove)
        damaged           ← StockAdjustment (damaged)
        expired           ← StockAdjustment (expired)
        dmg_out           ← StockAdjustment (dmg_out)
        exp_out           ← StockAdjustment (exp_out)
        transfer_in       ← StockTransfer.confirm()
        transfer_out      ← StockTransfer.confirm()
        opening           ← StockAdjustment with reason="Opening Balance"
    """
    MOVEMENT_TYPE_CHOICES = (
        ("purchase_receipt", "Purchase Receipt"),
        ("sale_dispatch",    "Sale Dispatch"),
        ("add",              "Manual Add"),
        ("remove",           "Manual Remove"),
        ("damaged",          "Damaged"),
        ("expired",          "Expired"),
        ("dmg_out",          "Damaged Removed"),
        ("exp_out",          "Expired Removed"),
        ("restored",         "Restored"),
        ("transfer_in",      "Transfer In"),
        ("transfer_out",     "Transfer Out"),
        ("returned",         "Sales Return"),
        ("opening",          "Opening Balance"),
    )

    item           = models.ForeignKey(Item, on_delete=models.CASCADE,
                                       related_name="stock_history")
    warehouse      = models.ForeignKey(Warehouse, on_delete=models.CASCADE,
                                       related_name="stock_history")
    movement_type  = models.CharField(max_length=25, choices=MOVEMENT_TYPE_CHOICES)
    quantity       = models.PositiveIntegerField()
    balance_after  = models.PositiveIntegerField()
    reference_type = models.CharField(max_length=50, blank=True, default="",
                                      help_text="Model name of the originating document")
    reference_id   = models.PositiveIntegerField(null=True, blank=True,
                                                 help_text="PK of the originating document")
    batch_number   = models.CharField(max_length=100, blank=True, default="")
    expiry_date    = models.DateField(null=True, blank=True)
    reason         = models.TextField(blank=True, default="")
    performed_by   = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="stock_movements",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering            = ["-created_at"]
        verbose_name_plural = "Stock History"

    def __str__(self):
        return (
            f"{self.get_movement_type_display()} | "
            f"{self.item.name} | qty={self.quantity} | bal={self.balance_after}"
        )


class SalesItemBatchAllocation(models.Model):
    """
    Links one sales invoice line to the batch rows that fulfilled it.
    """

    sales_invoice_item = models.ForeignKey(
        "sales.SalesInvoiceItem",
        on_delete=models.CASCADE,
        related_name="batch_allocations",
    )
    stock_batch = models.ForeignKey(
        StockBatch,
        on_delete=models.PROTECT,
        related_name="sales_allocations",
    )
    quantity = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return (
            f"{self.sales_invoice_item.invoice.invoice_number} | "
            f"{self.stock_batch.batch_number or 'No Batch'} | qty={self.quantity}"
        )
