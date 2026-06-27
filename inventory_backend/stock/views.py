# =============================================================================
# stock/views.py
# =============================================================================

from datetime import date

from django.shortcuts import get_object_or_404
from django.db.models import Q, Sum, Count, F, Value, IntegerField, ExpressionWrapper
from django.db.models.functions import Coalesce
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import (
    Stock,
    StockAdjustment,
    StockTransfer,
    StockHistory,
    StockBatch,
    Warehouse,
)
from masters.models import Asset
from audit.utils import create_audit_log
from users.permissions import HasAllowedRoles, OPERATIONS_ROLES

try:
    from utils.logger import get_logger
    logger = get_logger(__name__)
except Exception:
    import logging
    logger = logging.getLogger(__name__)


# ─── Serialisers ─────────────────────────────────────────────────────────────

def _stock_to_dict(stock: Stock) -> dict:
    item = stock.item

    available = getattr(stock, "available_qty", None)
    if available is None:
        available = stock.total_quantity - stock.damaged_quantity - getattr(stock, "expired_quantity", 0)
    available = max(0, available)
    is_low = available <= stock.minimum_stock

    return {
        "stock_id":         stock.id,
        "asset_id":         stock.item_id,
        "asset_name":       item.name,
        "asset_code":       item.asset_code,
        "category":         "—",
        "asset_type":       item.item_type,
        "asset_status":     item.status,
        "total_quantity":   stock.total_quantity,
        "damaged_quantity": stock.damaged_quantity,
        "expired_quantity": getattr(stock, "expired_quantity", 0),
        "available":        available,
        "minimum_stock":    stock.minimum_stock,
        "warehouse_id":     stock.warehouse_id,
        "warehouse_name":   stock.warehouse.name     if stock.warehouse else "—",
        "location":         stock.warehouse.location if stock.warehouse else "",
        "status":           "Low Stock" if is_low else "In Stock",
        "is_low_stock":     is_low,
        "updated_at":       stock.updated_at.isoformat() if stock.updated_at else None,
    }


def _batch_to_dict(batch: StockBatch) -> dict:
    today = date.today()
    is_expired = bool(batch.expiry_date and batch.expiry_date < today)
    return {
        "batch_id": batch.id,
        "batch_number": batch.batch_number or "",
        "expiry_date": batch.expiry_date.isoformat() if batch.expiry_date else None,
        "quantity_received": batch.quantity_received,
        "quantity_available": batch.quantity_available,
        "quantity_sold": batch.quantity_sold,
        "purchase_entry_item_id": batch.purchase_entry_item_id,
        "sales_return_item_id": batch.sales_return_item_id,
        "is_expired": is_expired,
        "warehouse_id": batch.warehouse_id,
        "warehouse_name": batch.warehouse.name if batch.warehouse_id else "—",
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


def _history_to_dict(h: StockHistory, adjustment_map=None) -> dict:
    TYPE_LABELS = {
        "purchase_receipt": "Purchase Receipt",
        "sale_dispatch":    "Sale Dispatch",
        "add":              "Manual Add",
        "remove":           "Manual Remove",
        "damaged":          "Marked Damaged",
        "expired":          "Marked Expired",
        "dmg_out":          "Removed Damaged Stock",
        "exp_out":          "Removed Expired Stock",
        "restored":         "Restored",
        "maintenance_out":  "Maintenance Issue",
        "maintenance_return": "Maintenance Return",
        "transfer_in":      "Transfer In",
        "transfer_out":     "Transfer Out",
        "allocated":        "Allocated",
        "returned":         "Returned",
        "opening":          "Opening Balance",
    }
    adjustment = None
    if (
        adjustment_map
        and h.reference_type == "StockAdjustment"
        and h.reference_id in adjustment_map
    ):
        adjustment = adjustment_map[h.reference_id]

    return {
        "id":             h.id,
        "movement_type":  h.movement_type,
        "type_label":     TYPE_LABELS.get(h.movement_type, h.movement_type),
        "quantity":       h.quantity,
        "balance_after":  h.balance_after,
        "reference_type": h.reference_type,
        "reference_id":   h.reference_id,
        "batch_number":   h.batch_number,
        "expiry_date":    h.expiry_date.isoformat() if h.expiry_date else None,
        "reason":         h.reason or "",
        "performed_by":   (
            getattr(h.performed_by, "name", None) or
            getattr(h.performed_by, "email", str(h.performed_by))
            if h.performed_by else "System"
        ),
        "adjustment_id":  adjustment.id if adjustment else None,
        "can_restore":    bool(adjustment and adjustment.can_restore),
        "is_restored":    bool(adjustment and adjustment.is_restored),
        "restored_at":    adjustment.restored_at.strftime("%d %b %Y, %H:%M") if adjustment and adjustment.restored_at else None,
        "restored_by":    adjustment.restored_by.name if adjustment and adjustment.restored_by else "",
        "restore_reason": adjustment.restore_reason if adjustment else "",
        "created_at": h.created_at.strftime("%d %b %Y, %H:%M") if h.created_at else None,
    }


def _warehouse_to_dict(wh: Warehouse) -> dict:
    stock_count = wh.stock_entries.count()
    total_qty   = wh.stock_entries.aggregate(t=Sum("total_quantity"))["t"] or 0
    low_count   = sum(1 for s in wh.stock_entries.all() if s.is_low_stock)
    return {
        "id":          wh.id,
        "name":        wh.name,
        "location":    wh.location,
        "is_active":   wh.is_active,
        "stock_count": stock_count,
        "total_qty":   total_qty,
        "low_count":   low_count,
        "manager":     wh.manager.name if wh.manager else None,
        "created_at":  wh.created_at.isoformat() if wh.created_at else None,
    }


# =============================================================================
# STOCK VIEWS
# =============================================================================

class StockDashboardView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        qs = (
            Stock.objects.select_related("item", "warehouse")
            .annotate(
                available_qty=ExpressionWrapper(
                    F("total_quantity") - F("damaged_quantity") - F("expired_quantity"),
                    output_field=IntegerField(),
                )
            )
        )

        wh_id   = request.query_params.get("warehouse", "").strip()
        search  = request.query_params.get("search",    "").strip()
        st_filt = request.query_params.get("status",    "").strip()
        cat     = request.query_params.get("category",  "").strip()

        if wh_id and wh_id.isdigit():   qs = qs.filter(warehouse_id=int(wh_id))
        if search: qs = qs.filter(Q(item__name__icontains=search) | Q(item__sku__icontains=search))
        if cat:    qs = qs.filter(item__item_type__icontains=cat)

        if st_filt == "low_stock":
            qs = qs.filter(available_qty__lte=F("minimum_stock"))
        elif st_filt == "in_stock":
            qs = qs.filter(available_qty__gt=F("minimum_stock"))
        elif st_filt == "damaged":
            qs = qs.filter(damaged_quantity__gt=0)
        elif st_filt == "expired":
            qs = qs.filter(expired_quantity__gt=0)

        # ── Pagination (optional) ────────────────────────────────────────────
        page_param = request.GET.get("page")
        page_size_param = request.GET.get("page_size")
        if page_param or page_size_param:
            try:
                page = int(page_param or 1)
                page_size = int(page_size_param or 10)
            except (TypeError, ValueError):
                page, page_size = 1, 10
            page = max(1, page)
            page_size = max(1, min(page_size, 200))

            total = qs.count()
            total_pages = max(1, -(-total // page_size))
            start = (page - 1) * page_size
            paged = qs.order_by("item__name", "warehouse__name")[start : start + page_size]

            rows = [_stock_to_dict(s) for s in paged]
            summary = qs.aggregate(
                total_items=Count("id"),
                available_stock=Coalesce(Sum("available_qty"), Value(0)),
                damaged=Coalesce(Sum("damaged_quantity"), Value(0)),
                expired=Coalesce(Sum("expired_quantity"), Value(0)),
                low_stock_items=Count("id", filter=Q(available_qty__lte=F("minimum_stock"))),
                total_quantity=Coalesce(Sum("total_quantity"), Value(0)),
            )

            return Response({
                "summary": summary,
                "stock_table": rows,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total_count": total,
                    "total_pages": total_pages,
                },
            })

        rows = [_stock_to_dict(s) for s in qs.order_by("item__name", "warehouse__name")]
        summary = qs.aggregate(
            total_items=Count("id"),
            available_stock=Coalesce(Sum("available_qty"), Value(0)),
            damaged=Coalesce(Sum("damaged_quantity"), Value(0)),
            expired=Coalesce(Sum("expired_quantity"), Value(0)),
            low_stock_items=Count("id", filter=Q(available_qty__lte=F("minimum_stock"))),
            total_quantity=Coalesce(Sum("total_quantity"), Value(0)),
        )
        return Response({"summary": summary, "stock_table": rows})


class CreateStockView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        data    = request.data
        missing = [f for f in ["asset_id", "warehouse_id", "total_quantity"] if data.get(f) is None]
        if missing:
            return Response({"error": f"Missing: {', '.join(missing)}"}, status=400)

        try:
            asset     = Asset.objects.get(id=data["asset_id"])
            warehouse = Warehouse.objects.get(id=data["warehouse_id"])
        except Asset.DoesNotExist:
            return Response({"error": "Asset not found."}, status=404)
        except Warehouse.DoesNotExist:
            return Response({"error": "Warehouse not found."}, status=404)

        try:
            total_qty = int(data["total_quantity"])
            min_stock = int(data.get("minimum_stock", 0))
        except (ValueError, TypeError):
            return Response({"error": "Quantities must be integers."}, status=400)

        if total_qty < 0:
            return Response({"error": "total_quantity cannot be negative."}, status=400)

        if Stock.objects.filter(item=asset, warehouse=warehouse).exists():
            return Response({"error": f"Stock already exists for '{asset.name}' in '{warehouse.name}'."}, status=409)

        stock = Stock.objects.create(
            item=asset, warehouse=warehouse,
            total_quantity=total_qty, minimum_stock=min_stock,
        )

        reason = (data.get("reason") or "Initial stock entry").strip()
        if total_qty > 0:
            StockHistory.objects.create(
                item=asset, warehouse=warehouse,
                movement_type="opening", quantity=total_qty,
                balance_after=stock.available_quantity,
                reference_type="Stock", reference_id=stock.pk,
                reason=reason, performed_by=request.user,
            )

        create_audit_log(
            user=request.user, action="create",
            resource=asset.asset_code, resource_type="Stock",
            request=request,
            details=f"Stock created for {asset.name} in {warehouse.name}",
            changes={"asset_id": asset.id, "warehouse_id": warehouse.id, "total_quantity": total_qty},
        )
        return Response(
            {"message": f"Stock created for '{asset.name}' in '{warehouse.name}'.", **_stock_to_dict(stock)},
            status=201,
        )


class AdjustStockView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        data     = request.data
        missing  = [f for f in ["stock_id", "adjustment_type", "quantity", "reason"] if not data.get(f)]
        if missing:
            return Response({"error": f"Missing: {', '.join(missing)}"}, status=400)

        adj_type = data["adjustment_type"]
        if adj_type not in ("add", "remove", "damaged", "expired", "dmg_out", "exp_out"):
            return Response({"error": "adjustment_type must be: add, remove, damaged, expired, dmg_out, exp_out."}, status=400)

        try:
            quantity = int(data["quantity"])
        except (ValueError, TypeError):
            return Response({"error": "quantity must be a positive integer."}, status=400)
        if quantity <= 0:
            return Response({"error": "quantity must be greater than zero."}, status=400)

        stock  = get_object_or_404(Stock.objects.select_related("item", "warehouse"), id=data["stock_id"])
        reason = data["reason"].strip()

        if adj_type == "remove" and quantity > stock.available_quantity:
            return Response({"error": f"Cannot remove {quantity} available item(s) — only {stock.available_quantity} available."}, status=400)
        if adj_type == "damaged" and quantity > stock.available_quantity:
            return Response({"error": f"Cannot mark {quantity} damaged — only {stock.available_quantity} available."}, status=400)
        if adj_type == "expired" and quantity > stock.available_quantity:
            return Response({"error": f"Cannot mark {quantity} expired — only {stock.available_quantity} available."}, status=400)
        if adj_type == "dmg_out" and quantity > stock.damaged_quantity:
            return Response({"error": f"Cannot remove {quantity} damaged item(s) — only {stock.damaged_quantity} marked damaged."}, status=400)
        if adj_type == "exp_out" and quantity > stock.expired_quantity:
            return Response({"error": f"Cannot remove {quantity} expired item(s) — only {stock.expired_quantity} marked expired."}, status=400)

        adj = StockAdjustment(
            stock=stock, adjustment_type=adj_type,
            quantity=quantity, reason=reason,
            reference_no=(data.get("reference_no") or "").strip(),
            created_by=request.user,
        )
        adj.save()
        stock.refresh_from_db()

        create_audit_log(
            user=request.user, action="adjust",
            resource=stock.item.asset_code, resource_type="Stock",
            request=request,
            details=f"Stock {adj_type}: {quantity} × {stock.item.name} @ {stock.warehouse.name}",
            changes={"type": adj_type, "quantity": quantity, "reason": reason},
        )
        return Response({"message": f"Stock {adj_type} of {quantity} applied.", **_stock_to_dict(stock)})


class RestoreStockAdjustmentView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request, adjustment_id):
        adjustment = get_object_or_404(
            StockAdjustment.objects.select_related("stock__item", "stock__warehouse"),
            id=adjustment_id,
        )
        reason = (request.data.get("reason") or "").strip()

        try:
            adjustment.restore(request.user, reason=reason)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

        stock = adjustment.stock
        stock.refresh_from_db()
        create_audit_log(
            user=request.user,
            action="update",
            resource=stock.item.asset_code,
            resource_type="Stock",
            request=request,
            details=(
                f"Restored stock adjustment {adjustment.id} "
                f"for {stock.item.name} @ {stock.warehouse.name}"
            ),
            changes={
                "adjustment_id": adjustment.id,
                "adjustment_type": adjustment.adjustment_type,
                "quantity": adjustment.quantity,
                "reason": reason,
            },
        )
        return Response({
            "message": f"Restored {adjustment.get_adjustment_type_display().lower()} quantity of {adjustment.quantity}.",
            **_stock_to_dict(stock),
        })


class SetMinimumStockView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        data = request.data
        if data.get("stock_id") is None:
            return Response({"error": "stock_id is required."}, status=400)
        if data.get("minimum_stock") is None:
            return Response({"error": "minimum_stock is required."}, status=400)

        try:
            min_stock = int(data["minimum_stock"])
        except (ValueError, TypeError):
            return Response({"error": "minimum_stock must be a non-negative integer."}, status=400)
        if min_stock < 0:
            return Response({"error": "minimum_stock cannot be negative."}, status=400)

        stock   = get_object_or_404(Stock.objects.select_related("item", "warehouse"), id=data["stock_id"])
        old_min = stock.minimum_stock
        stock.minimum_stock = min_stock
        stock.save(update_fields=["minimum_stock", "updated_at"])

        create_audit_log(
            user=request.user, action="update",
            resource=stock.item.asset_code, resource_type="Stock",
            request=request,
            details=f"Min stock updated for {stock.item.name}: {old_min} → {min_stock}",
            changes={"old": old_min, "new": min_stock},
        )
        return Response({"message": f"Minimum stock updated to {min_stock}.", **_stock_to_dict(stock)})


class StockHistoryView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, stock_id):
        stock = get_object_or_404(Stock.objects.select_related("item", "warehouse"), id=stock_id)

        qs      = StockHistory.objects.filter(item=stock.item, warehouse=stock.warehouse).select_related("performed_by").order_by("-created_at")
        mv_type = request.query_params.get("movement_type", "").strip()
        if mv_type:
            qs = qs.filter(movement_type=mv_type)

        try:
            limit = int(request.query_params.get("limit", "100"))
        except (ValueError, TypeError):
            limit = 100

        adjustment_map = {}
        adjustment_ids = [
            h.reference_id
            for h in qs[:limit]
            if h.reference_type == "StockAdjustment" and h.reference_id
        ]
        if adjustment_ids:
            adjustment_map = {
                adjustment.id: adjustment
                for adjustment in StockAdjustment.objects.select_related("restored_by").filter(id__in=adjustment_ids)
            }

        history_rows = list(qs[:limit])
        return Response({
            "stock_id":   stock.id,
            "asset_name": stock.item.name,
            "asset_code": stock.item.asset_code,
            "warehouse":  stock.warehouse.name,
            "history":    [_history_to_dict(h, adjustment_map=adjustment_map) for h in history_rows],
        })


class StockDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, stock_id):
        stock = get_object_or_404(
            Stock.objects.select_related("item", "warehouse"),
            id=stock_id,
        )
        batches = list(
            StockBatch.objects
            .filter(
                item=stock.item,
                warehouse=stock.warehouse,
                quantity_available__gt=0,
            )
            .select_related("warehouse")
            .order_by("expiry_date", "created_at", "id")
        )
        recent_history = list(
            StockHistory.objects
            .filter(item=stock.item, warehouse=stock.warehouse)
            .select_related("performed_by")
            .order_by("-created_at")[:10]
        )
        adjustment_ids = [
            row.reference_id
            for row in recent_history
            if row.reference_type == "StockAdjustment" and row.reference_id
        ]
        adjustment_map = {
            adjustment.id: adjustment
            for adjustment in StockAdjustment.objects.select_related("restored_by").filter(id__in=adjustment_ids)
        }

        return Response({
            "stock": _stock_to_dict(stock),
            "batches": [_batch_to_dict(batch) for batch in batches],
            "recent_history": [
                _history_to_dict(history_row, adjustment_map=adjustment_map)
                for history_row in recent_history
            ],
        })


class TransferStockView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        data    = request.data
        missing = [f for f in ["stock_id", "to_warehouse_id", "quantity"] if not data.get(f)]
        if missing:
            return Response({"error": f"Missing: {', '.join(missing)}"}, status=400)

        try:
            quantity = int(data["quantity"])
        except (ValueError, TypeError):
            return Response({"error": "quantity must be a positive integer."}, status=400)
        if quantity <= 0:
            return Response({"error": "quantity must be greater than zero."}, status=400)

        stock        = get_object_or_404(Stock.objects.select_related("item", "warehouse"), id=data["stock_id"])
        to_warehouse = get_object_or_404(Warehouse, id=data["to_warehouse_id"])

        if stock.warehouse_id == to_warehouse.id:
            return Response({"error": "Source and destination warehouses must differ."}, status=400)
        if stock.available_quantity < quantity:
            return Response({"error": f"Insufficient. Available: {stock.available_quantity}, Requested: {quantity}."}, status=400)

        from django.utils import timezone as tz
        reason   = (data.get("reason") or f"Transfer to {to_warehouse.name}").strip()
        transfer = StockTransfer(
            item=stock.item, from_warehouse=stock.warehouse,
            to_warehouse=to_warehouse, quantity=quantity,
            transfer_date=tz.now().date(), reason=reason,
            created_by=request.user,
        )
        transfer.save()
        transfer.confirm()
        stock.refresh_from_db()

        create_audit_log(
            user=request.user, action="transfer",
            resource=stock.item.asset_code, resource_type="Stock",
            request=request,
            details=f"Transferred {quantity} × {stock.item.name} → {to_warehouse.name}",
            changes={"from": stock.warehouse.name, "to": to_warehouse.name, "quantity": quantity},
        )
        return Response({
            "message": f"Transferred {quantity} unit(s) of '{stock.item.name}' to '{to_warehouse.name}'.",
            **_stock_to_dict(stock),
        })


class StockStatsView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        stocks = (
            Stock.objects.select_related("item")
            .annotate(
                available_qty=ExpressionWrapper(
                    F("total_quantity") - F("damaged_quantity") - F("expired_quantity"),
                    output_field=IntegerField(),
                )
            )
        )
        agg = stocks.aggregate(
            total_items=Count("id"),
            total_quantity=Coalesce(Sum("total_quantity"), Value(0)),
            available=Coalesce(Sum("available_qty"), Value(0)),
            damaged=Coalesce(Sum("damaged_quantity"), Value(0)),
            expired=Coalesce(Sum("expired_quantity"), Value(0)),
            low_stock=Count("id", filter=Q(available_qty__lte=F("minimum_stock"))),
        )
        return Response(agg)


# =============================================================================
# WAREHOUSE VIEWS
# =============================================================================

class WarehouseListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        qs = Warehouse.objects.prefetch_related("stock_entries").all()
        show_inactive = request.query_params.get("showInactive", "").lower() == "true"
        if not show_inactive:
            qs = qs.filter(is_active=True)
        return Response([_warehouse_to_dict(w) for w in qs.order_by("name")])


class WarehouseCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        name     = (request.data.get("name") or "").strip()
        location = (request.data.get("location") or "").strip()

        if not name:
            return Response({"error": "Warehouse name is required."}, status=400)
        if Warehouse.objects.filter(name__iexact=name).exists():
            return Response({"error": f"Warehouse '{name}' already exists."}, status=409)

        wh = Warehouse.objects.create(name=name, location=location)
        create_audit_log(
            user=request.user, action="create",
            resource=wh.name, resource_type="Warehouse",
            request=request,
            details=f"Warehouse '{name}' created",
            changes={"name": name, "location": location},
        )
        return Response(_warehouse_to_dict(wh), status=201)

    def put(self, request):
        """Update a warehouse — PUT /api/stock/warehouses/ with {id, name, location, is_active}"""
        wh_id = request.data.get("id")
        if not wh_id:
            return Response({"error": "id is required."}, status=400)

        wh = get_object_or_404(Warehouse, id=wh_id)
        if "name" in request.data:
            new_name = request.data["name"].strip()
            if not new_name:
                return Response({"error": "name cannot be empty."}, status=400)
            if Warehouse.objects.filter(name__iexact=new_name).exclude(id=wh_id).exists():
                return Response({"error": f"Warehouse '{new_name}' already exists."}, status=409)
            wh.name = new_name
        if "location"  in request.data: wh.location  = (request.data["location"] or "").strip()
        if "is_active" in request.data: wh.is_active = bool(request.data["is_active"])
        wh.save()

        create_audit_log(
            user=request.user, action="update",
            resource=wh.name, resource_type="Warehouse",
            request=request,
            details=f"Warehouse '{wh.name}' updated",
            changes=request.data,
        )
        return Response(_warehouse_to_dict(wh))

    def delete(self, request):
        """Soft-delete (deactivate) a warehouse — DELETE /api/stock/warehouses/ with {id}"""
        wh_id = request.data.get("id")
        if not wh_id:
            return Response({"error": "id is required."}, status=400)

        wh = get_object_or_404(Warehouse, id=wh_id)
        if wh.stock_entries.filter(total_quantity__gt=0).exists():
            return Response({"error": "Cannot deactivate a warehouse that still has stock. Transfer or adjust to zero first."}, status=400)

        wh.is_active = False
        wh.save(update_fields=["is_active", "updated_at"])
        return Response({"message": f"Warehouse '{wh.name}' deactivated."})


class WarehouseDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, warehouse_id):
        wh    = get_object_or_404(Warehouse.objects.prefetch_related("stock_entries__item"), id=warehouse_id)
        data  = _warehouse_to_dict(wh)
        stocks = wh.stock_entries.select_related("item").all()
        data["stock_items"] = [_stock_to_dict(s) for s in stocks]
        return Response(data)

    def put(self, request, warehouse_id):
        """Update a warehouse — PUT /api/stock/warehouses/<id>/"""
        wh = get_object_or_404(Warehouse, id=warehouse_id)
        if "name" in request.data:
            new_name = request.data["name"].strip()
            if not new_name:
                return Response({"error": "name cannot be empty."}, status=400)
            if Warehouse.objects.filter(name__iexact=new_name).exclude(id=warehouse_id).exists():
                return Response({"error": f"Warehouse '{new_name}' already exists."}, status=409)
            wh.name = new_name
        if "location" in request.data:
            wh.location = (request.data["location"] or "").strip()
        if "is_active" in request.data:
            wh.is_active = bool(request.data["is_active"])
        wh.save()

        create_audit_log(
            user=request.user, action="update",
            resource=wh.name, resource_type="Warehouse",
            request=request,
            details=f"Warehouse '{wh.name}' updated",
            changes=request.data,
        )
        return Response(_warehouse_to_dict(wh))

    def delete(self, request, warehouse_id):
        """Soft-delete (deactivate) a warehouse — DELETE /api/stock/warehouses/<id>/"""
        wh = get_object_or_404(Warehouse, id=warehouse_id)
        if wh.stock_entries.filter(total_quantity__gt=0).exists():
            return Response({"error": "Cannot deactivate a warehouse that still has stock. Transfer or adjust to zero first."}, status=400)

        wh.is_active = False
        wh.save(update_fields=["is_active", "updated_at"])
        return Response({"message": f"Warehouse '{wh.name}' deactivated."})


class AssetDropdownView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        wh_id = request.query_params.get("warehouse_id", "").strip()
        if wh_id and wh_id.isdigit():
            existing_ids = Stock.objects.filter(warehouse_id=int(wh_id)).values_list("item_id", flat=True)
        else:
            existing_ids = Stock.objects.values_list("item_id", flat=True)

        assets = (
            Asset.objects.filter(status="active", track_inventory=True, item_type="goods")
            .exclude(id__in=existing_ids)
            .order_by("name")
            .values("id", "name", "sku", "item_type")
        )
        return Response([
            {
                "id": a["id"],
                "name": a["name"],
                "asset_code": a["sku"],
                "asset_type": a["item_type"],
            }
            for a in assets
        ])
