# =============================================================================
# stock/stock_manager.py
#
# Helper class for programmatic stock operations used by views and signals.
#
# FIXES vs the original StockManager:
#   1. Stock imported from stock.models (not old stock.models.Stock)
#   2. StockHistory removed — replaced by StockMovement (the new audit ledger)
#   3. AssetAssignment removed — replaced by AssetAllocation from masters.models
#   4. Product imported from inventory.models (not masters.Asset)
#   5. check_availability works against inventory.Product.current_stock cache
#      AND live stock.Stock rows — covers both fast-read and accurate paths
#   6. restore_stock / reduce_stock now create StockMovement rows (immutable
#      ledger) instead of mutating a separate StockHistory table
# =============================================================================

from django.db import transaction


class StockManager:
    """
    Utility class for stock mutations performed outside the normal
    PurchaseEntry / SalesInvoice save() flows.

    All public methods return a (success: bool, message: str) tuple.
    For reduce_stock and check_availability an additional int is returned
    representing the current / remaining available quantity.
    """

    # ─────────────────────────────────────────────────────────────────────────
    # REDUCE  (e.g. manual sale, write-off)
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def reduce_stock(
        product_id: int,
        quantity: float,
        user,
        warehouse=None,
        reason: str = "Manual reduction",
    ):
        """
        Deduct *quantity* from a Product's stock in the given warehouse
        (or the first active warehouse if none supplied).

        Returns (success, message, remaining_stock).
        """
        from inventory.models import Product          # ← FIXED
        from stock.models import StockMovement, Warehouse, Stock

        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return False, f"Product id={product_id} not found", 0

        wh = warehouse or Warehouse.objects.filter(is_active=True).first()
        if not wh:
            return False, "No active warehouse found", 0

        # Use the live Stock row for accuracy
        stock_row, _ = Stock.objects.get_or_create(
            product=product, warehouse=wh, defaults={"quantity": 0}
        )
        available = float(stock_row.quantity)

        if available < quantity:
            return (
                False,
                f"Insufficient stock. Available: {available}, Requested: {quantity}",
                int(available),
            )

        with transaction.atomic():
            movement = StockMovement(
                product        = product,
                warehouse      = wh,
                movement_type  = "adjustment_remove",
                quantity       = quantity,
                reference_type = "ManualReduction",
                reference_id   = None,
                notes          = reason,
            )
            movement.created_by = user   # CreatedByMixin field
            movement.apply()             # mutates Stock row + saves movement

        # Re-read from db for accurate remaining
        stock_row.refresh_from_db()
        remaining = float(stock_row.quantity)
        return True, f"Stock reduced. Remaining: {remaining}", int(remaining)

    # ─────────────────────────────────────────────────────────────────────────
    # RESTORE  (e.g. invoice cancelled, return received)
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def restore_stock(
        product_id: int,
        quantity: float,
        user,
        warehouse=None,
        reason: str = "Stock restored",
    ):
        """
        Add *quantity* back to a Product's stock.

        Returns (success, message).
        """
        from inventory.models import Product          # ← FIXED
        from stock.models import StockMovement, Warehouse

        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return False, f"Product id={product_id} not found"

        wh = warehouse or Warehouse.objects.filter(is_active=True).first()
        if not wh:
            return False, "No active warehouse found"

        with transaction.atomic():
            movement = StockMovement(
                product        = product,
                warehouse      = wh,
                movement_type  = "adjustment_add",
                quantity       = quantity,
                reference_type = "ManualRestore",
                reference_id   = None,
                notes          = reason,
            )
            movement.created_by = user
            movement.apply()

        return True, "Stock restored successfully"

    # ─────────────────────────────────────────────────────────────────────────
    # CHECK AVAILABILITY
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def check_availability(
        product_id: int,
        requested_quantity: float,
        warehouse=None,
    ):
        """
        Check whether *requested_quantity* is available.

        Two-phase check:
          1. Fast: uses Product.current_stock (denormalised cache).
          2. Accurate: queries the live Stock row for the specific warehouse.

        Returns (available: bool, current_stock: float, message: str).
        """
        from inventory.models import Product          # ← FIXED
        from stock.models import Stock, Warehouse

        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return False, 0, f"Product id={product_id} not found"

        # Fast path via cached field
        if float(product.current_stock) < requested_quantity:
            return (
                False,
                float(product.current_stock),
                f"Only {product.current_stock} units available (cache), "
                f"requested {requested_quantity}",
            )

        # Accurate path via live Stock row
        if warehouse:
            try:
                stock_row = Stock.objects.get(product=product, warehouse=warehouse)
                live_qty  = float(stock_row.quantity)
            except Stock.DoesNotExist:
                live_qty = 0.0
        else:
            # Sum across all warehouses (matches Product.current_stock logic)
            from django.db.models import Sum
            live_qty = float(
                Stock.objects.filter(product=product)
                .aggregate(t=Sum("quantity"))["t"] or 0
            )

        if live_qty >= requested_quantity:
            return True, live_qty, f"{live_qty} units available"

        return (
            False,
            live_qty,
            f"Only {live_qty} units available, requested {requested_quantity}",
        )

    # ─────────────────────────────────────────────────────────────────────────
    # TRANSFER BETWEEN WAREHOUSES
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def transfer_stock(
        product_id: int,
        quantity: float,
        from_warehouse,
        to_warehouse,
        user,
        notes: str = "",
    ):
        """
        Move *quantity* of a product from one warehouse to another.
        Creates two StockMovement rows (transfer_out + transfer_in).

        Returns (success, message).
        """
        from inventory.models import Product          # ← FIXED
        from stock.models import Stock, StockMovement

        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return False, f"Product id={product_id} not found"

        if from_warehouse.id == to_warehouse.id:
            return False, "Source and destination warehouses must be different"

        try:
            src_stock = Stock.objects.get(product=product, warehouse=from_warehouse)
        except Stock.DoesNotExist:
            return False, f"No stock record for '{product.name}' in '{from_warehouse.name}'"

        if float(src_stock.quantity) < quantity:
            return (
                False,
                f"Insufficient stock in '{from_warehouse.name}'. "
                f"Available: {src_stock.quantity}, Requested: {quantity}",
            )

        with transaction.atomic():
            out = StockMovement(
                product        = product,
                warehouse      = from_warehouse,
                movement_type  = "transfer_out",
                quantity       = quantity,
                reference_type = "StockTransfer",
                notes          = notes or f"Transfer to {to_warehouse.name}",
            )
            out.created_by = user
            out.apply()

            in_ = StockMovement(
                product        = product,
                warehouse      = to_warehouse,
                movement_type  = "transfer_in",
                quantity       = quantity,
                reference_type = "StockTransfer",
                notes          = notes or f"Transfer from {from_warehouse.name}",
            )
            in_.created_by = user
            in_.apply()

        return True, (
            f"Transferred {quantity} unit(s) of '{product.name}' "
            f"from '{from_warehouse.name}' to '{to_warehouse.name}'"
        )