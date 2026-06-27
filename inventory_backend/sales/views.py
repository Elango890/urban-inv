# =============================================================================
# sales/views.py  — COMPLETE with full validation
#
# Key rules:
#   • Assets in sales dropdown: status="active" AND available stock > 0
#   • Services: is_active=True only
#   • Auto-fill: asset → selling_price + stock info; service → base_price + gst %
#   • Backend validates stock availability at invoice creation time
#   • All numeric fields validated (qty > 0, price ≥ 0, disc/tax whole 0-100)
# =============================================================================

import io
from calendar import monthrange
from datetime import date, timedelta
from decimal  import Decimal, InvalidOperation

from django.conf import settings
from django.db              import transaction
from django.db.models       import Q, Sum, Count, Case, When, Value, IntegerField
from django.db.models.functions import TruncMonth
from django.http            import FileResponse
from django.shortcuts        import get_object_or_404
from django.utils            import timezone

from rest_framework.views        import APIView
from rest_framework.permissions  import IsAuthenticated
from rest_framework.response     import Response
from rest_framework              import status as http_status

from inventory_backend.api_errors import error_response
from inventory_backend.emailing import send_templated_email, money

from audit.utils    import create_audit_log
from masters.models import (
    FinancialYear, Customer, Asset,
    PAYMENT_METHOD_CHOICES,
)
from .models import (
    SalesInvoice,
    SalesInvoiceItem,
    SalesPayment,
    SalesReturn,
    SalesReturnItem,
    _next_invoice_number,
    _next_return_number,
)
from users.models import User
from users.permissions import CUSTOMER_ROLES, HasAllowedRoles, SALES_ROLES
from stock.models import (
    Warehouse,
    Stock,
    StockBatch,
    StockHistory,
    SalesItemBatchAllocation,
)

import logging
logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _err(msg: str, code: int = 400, errors=None) -> Response:
    return error_response(msg, code=code, errors=errors)


def _parse_decimal(val, field: str) -> Decimal:
    try:
        return Decimal(str(val))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"'{field}' must be a valid number (received: {val!r})")


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _days_from_payment_terms(payment_terms):
    return {
        "due_on_receipt": 0,
        "cod": 0,
        "net_15": 15,
        "net_30": 30,
        "net_45": 45,
        "net_60": 60,
        "consignment_30": 30,
    }.get(payment_terms)


def _calculate_due_date(invoice_date, payment_terms):
    invoice_date = _parse_date(invoice_date)
    if not invoice_date or not payment_terms or payment_terms == "custom":
        return None
    if payment_terms == "end_of_month":
        return invoice_date.replace(day=monthrange(invoice_date.year, invoice_date.month)[1])
    days = _days_from_payment_terms(payment_terms)
    if days is None:
        return None
    return invoice_date + timedelta(days=days)


def _get_asset_stock(asset):
    """Return sellable FEFO batch stock for an asset."""
    try:
        batch_totals = (
            StockBatch.objects
            .filter(
                item=asset,
                warehouse__is_active=True,
                quantity_available__gt=0,
            )
            .values("warehouse_id", "warehouse__name")
            .annotate(available=Sum("quantity_available"))
            .order_by("warehouse__name", "warehouse_id")
        )
        total = sum(int(row["available"] or 0) for row in batch_totals)
        warehouses = [
            {
                "warehouseId": row["warehouse_id"],
                "warehouseName": row["warehouse__name"],
                "available": int(row["available"] or 0),
            }
            for row in batch_totals
            if int(row["available"] or 0) > 0
        ]
        return total, warehouses
    except Exception:
        return 0, []


def _available_batch_queryset(asset):
    return (
        StockBatch.objects
        .filter(
            item=asset,
            warehouse__is_active=True,
            quantity_available__gt=0,
        )
        .select_related("warehouse")
        .annotate(
            no_expiry=Case(
                When(expiry_date__isnull=True, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        )
        .order_by("no_expiry", "expiry_date", "created_at", "id")
    )


def _next_available_batch(asset):
    return _available_batch_queryset(asset).first()


def _asset_quantity_to_int(quantity, asset_name: str) -> int:
    qty = Decimal(str(quantity or 0))
    if qty <= 0:
        raise ValueError(f"Asset '{asset_name}' quantity must be greater than 0.")
    if qty != qty.to_integral_value():
        raise ValueError(f"Asset '{asset_name}' quantity must be a whole number for stock tracking.")
    return int(qty)


def _validate_invoice_stock(invoice: SalesInvoice) -> list[str]:
    errors = []
    for item in invoice.items.select_related("item").filter(item__isnull=False):
        try:
            req_qty = _asset_quantity_to_int(item.quantity, item.item_name or item.item.name)
        except ValueError as exc:
            errors.append(str(exc))
            continue

        available, _ = _get_asset_stock(item.item)
        if available < req_qty:
            errors.append(
                f"Asset '{item.item.name}' has only {available} unit(s) available; "
                f"{req_qty} required for invoice {invoice.invoice_number}."
            )
    return errors


def _post_invoice_stock(invoice: SalesInvoice, performed_by) -> None:
    if invoice.stock_posted:
        return

    errors = _validate_invoice_stock(invoice)
    if errors:
        raise ValueError(" ".join(errors))

    for item in invoice.items.select_related("item").filter(item__isnull=False):
        qty_remaining = _asset_quantity_to_int(item.quantity, item.item_name or item.item.name)
        first_batch = None
        batches = list(_available_batch_queryset(item.item).select_for_update())

        for batch in batches:
            available = int(batch.quantity_available or 0)
            if available <= 0:
                continue
            qty_to_remove = min(available, qty_remaining)
            stock = Stock.objects.select_for_update().get(
                item=batch.item,
                warehouse=batch.warehouse,
            )
            stock.total_quantity -= qty_to_remove
            stock.save(update_fields=["total_quantity", "updated_at"])
            batch.quantity_available -= qty_to_remove
            batch.save(update_fields=["quantity_available", "updated_at"])
            allocation = SalesItemBatchAllocation.objects.create(
                sales_invoice_item=item,
                stock_batch=batch,
                quantity=qty_to_remove,
            )
            if first_batch is None:
                first_batch = allocation.stock_batch
            StockHistory.objects.create(
                item=item.item,
                warehouse=batch.warehouse,
                movement_type="sale_dispatch",
                quantity=qty_to_remove,
                balance_after=stock.available_quantity,
                reference_type="SalesInvoice",
                reference_id=invoice.id,
                batch_number=batch.batch_number,
                expiry_date=batch.expiry_date,
                reason=f"Sold via invoice {invoice.invoice_number}",
                performed_by=performed_by,
            )
            qty_remaining -= qty_to_remove
            if qty_remaining == 0:
                break

        if qty_remaining > 0:
            raise ValueError(
                f"Asset '{item.item.name}' could not be fully deducted from stock. "
                f"{qty_remaining} unit(s) still pending."
            )
        if first_batch:
            SalesInvoiceItem.objects.filter(pk=item.pk).update(
                batch_number=first_batch.batch_number,
                expiry_date=first_batch.expiry_date,
            )

    invoice.stock_posted = True
    invoice.save(update_fields=["stock_posted", "updated_at"])


def _restore_invoice_stock(invoice: SalesInvoice, performed_by) -> None:
    if not invoice.stock_posted:
        return

    allocations = list(
        SalesItemBatchAllocation.objects
        .select_related("stock_batch__item", "stock_batch__warehouse")
        .filter(sales_invoice_item__invoice=invoice)
        .order_by("-created_at", "-id")
    )

    if allocations:
        for allocation in allocations:
            batch = StockBatch.objects.select_for_update().get(id=allocation.stock_batch_id)
            stock, _ = Stock.objects.select_for_update().get_or_create(
                item=batch.item,
                warehouse=batch.warehouse,
                defaults={"total_quantity": 0, "minimum_stock": 0},
            )
            stock.total_quantity += allocation.quantity
            stock.save(update_fields=["total_quantity", "updated_at"])
            batch.quantity_available = min(
                batch.quantity_received,
                batch.quantity_available + allocation.quantity,
            )
            batch.save(update_fields=["quantity_available", "updated_at"])
            StockHistory.objects.create(
                item=batch.item,
                warehouse=batch.warehouse,
                movement_type="add",
                quantity=allocation.quantity,
                balance_after=stock.available_quantity,
                reference_type="SalesInvoice",
                reference_id=invoice.id,
                batch_number=batch.batch_number,
                expiry_date=batch.expiry_date,
                reason=f"Stock restored after cancelling invoice {invoice.invoice_number}",
                performed_by=performed_by,
            )
    else:
        history_rows = (
            StockHistory.objects
            .filter(
                reference_type="SalesInvoice",
                reference_id=invoice.id,
                movement_type__in=["remove", "sale_dispatch"],
            )
            .values("item_id", "warehouse_id")
            .annotate(quantity_restored=Sum("quantity"))
        )

        for row in history_rows:
            qty_to_restore = int(row["quantity_restored"] or 0)
            if qty_to_restore <= 0:
                continue

            stock, _ = Stock.objects.select_for_update().get_or_create(
                item_id=row["item_id"],
                warehouse_id=row["warehouse_id"],
                defaults={"total_quantity": 0, "minimum_stock": 0},
            )
            stock.total_quantity += qty_to_restore
            stock.save(update_fields=["total_quantity", "updated_at"])
            StockHistory.objects.create(
                item_id=row["item_id"],
                warehouse_id=row["warehouse_id"],
                movement_type="add",
                quantity=qty_to_restore,
                balance_after=stock.available_quantity,
                reference_type="SalesInvoice",
                reference_id=invoice.id,
                reason=f"Stock restored after cancelling invoice {invoice.invoice_number}",
                performed_by=performed_by,
            )

    invoice.stock_posted = False
    invoice.save(update_fields=["stock_posted", "updated_at"])


# ─── Serialisers ──────────────────────────────────────────────────────────────

def _item_to_dict(i: SalesInvoiceItem) -> dict:
    net_amount = round(float(i.subtotal) - float(i.disc_amount), 2)
    item_type = "custom"
    asset_id = None
    service_id = None
    if i.item:
        if i.item.item_type == "service":
            item_type = "service"
            service_id = i.item_id
        else:
            item_type = "asset"
            asset_id = i.item_id
    batch_allocations = [
        {
            "batchId": allocation.stock_batch_id,
            "batchNumber": allocation.stock_batch.batch_number,
            "expiryDate": str(allocation.stock_batch.expiry_date) if allocation.stock_batch.expiry_date else None,
            "warehouseId": allocation.stock_batch.warehouse_id,
            "warehouseName": allocation.stock_batch.warehouse.name if allocation.stock_batch.warehouse_id else "",
            "quantity": allocation.quantity,
        }
        for allocation in i.batch_allocations.select_related("stock_batch__warehouse").all()
    ]
    return {
        "id":              i.id,
        "itemType":        item_type,
        "assetId":         asset_id,
        "serviceId":       service_id,
        "itemName":        i.item_name,
        "itemDescription": i.item_description,
        "quantity":        float(i.quantity),
        "unitPrice":       float(i.unit_price),
        "batchNumber":     i.batch_number,
        "expiryDate":      str(i.expiry_date) if i.expiry_date else None,
        "rspInclVat":      float(getattr(i, "rsp_incl_vat", 0) or 0),
        "rspWithoutVat":   float(getattr(i, "rsp_without_vat", i.unit_price) or 0),
        "discountType":    getattr(i, "discount_type", "amount"),
        "discount":        float(i.discount),
        "taxRate":         float(i.tax_rate),
        "amountPerUnit":   float(getattr(i, "amount_per_unit", 0) or 0),
        "subtotal":        float(i.subtotal),
        "discAmount":      float(i.disc_amount),
        "taxAmount":       float(i.tax_amount),
        "netAmount":       net_amount,
        "lineTotal":       float(i.line_total),
        "batchAllocations": batch_allocations,
        "notes":           i.notes,
    }


def _payment_to_dict(p: SalesPayment) -> dict:
    transaction_type = "refund" if Decimal(str(p.amount or 0)) < 0 else "payment"
    return {
        "id":            p.id,
        "paymentDate":   str(p.payment_date),
        "amount":        float(p.amount),
        "transactionType": transaction_type,
        "paymentMethod": p.payment_method,
        "referenceNo":   p.reference_no,
        "notes":         p.notes,
        "createdAt":     p.created_at.isoformat(),
    }


def _returned_quantity_map(invoice: SalesInvoice, exclude_return_id=None) -> dict[int, Decimal]:
    invoice_item_ids = list(invoice.items.values_list("id", flat=True))
    return _returned_quantity_map_for_invoice_items(
        invoice_item_ids,
        exclude_return_id=exclude_return_id,
    )


def _returned_quantity_map_for_invoice_items(invoice_item_ids, exclude_return_id=None) -> dict[int, Decimal]:
    if not invoice_item_ids:
        return {}
    qs = SalesReturnItem.objects.filter(
        sales_invoice_item_id__in=invoice_item_ids,
        sales_return__status__in=["draft", "confirmed"],
    )
    if exclude_return_id:
        qs = qs.exclude(sales_return_id=exclude_return_id)
    summary = (
        qs.values("sales_invoice_item_id")
        .annotate(returned_qty=Sum("quantity"))
    )
    return {
        row["sales_invoice_item_id"]: Decimal(str(row["returned_qty"] or 0))
        for row in summary
    }


def _confirmed_return_total(invoice: SalesInvoice) -> Decimal:
    total = (
        invoice.returns.filter(status="confirmed").aggregate(t=Sum("total_amount"))["t"]
        or 0
    )
    return Decimal(str(total))


def _invoice_financials(invoice: SalesInvoice) -> dict[str, object]:
    gross_total = Decimal(str(invoice.total_amount or 0))
    raw_paid = Decimal(str(invoice.paid_amount or 0))
    return_total = _confirmed_return_total(invoice)
    net_total = max(gross_total - return_total, Decimal("0"))
    applied_paid = min(raw_paid, net_total)
    refundable_amount = max(raw_paid - net_total, Decimal("0"))
    balance_amount = max(net_total - raw_paid, Decimal("0"))

    if net_total <= Decimal("0.01"):
        payment_status = "paid"
    elif applied_paid <= Decimal("0.00"):
        payment_status = "unpaid"
    elif balance_amount <= Decimal("0.01"):
        payment_status = "paid"
    else:
        payment_status = "partial"

    return {
        "gross_total": float(gross_total),
        "return_amount": float(return_total),
        "net_total": float(net_total),
        "raw_paid_amount": float(raw_paid),
        "paid_amount": float(applied_paid),
        "refundable_amount": float(refundable_amount),
        "balance_amount": float(balance_amount),
        "payment_status": payment_status,
        "payment_status_display": dict(SalesInvoice.PAYMENT_STATUS_CHOICES).get(payment_status, payment_status),
    }


def _return_item_to_dict(item: SalesReturnItem) -> dict:
    sold_qty = Decimal(str(item.sales_invoice_item.quantity or 0))
    batch_allocations = [
        {
            "batchId": allocation.stock_batch_id,
            "batchNumber": allocation.stock_batch.batch_number,
            "expiryDate": str(allocation.stock_batch.expiry_date) if allocation.stock_batch.expiry_date else None,
            "warehouseId": allocation.stock_batch.warehouse_id,
            "warehouseName": allocation.stock_batch.warehouse.name if allocation.stock_batch.warehouse_id else "",
            "quantity": allocation.quantity,
        }
        for allocation in item.sales_invoice_item.batch_allocations.select_related("stock_batch__warehouse").all()
    ]
    return {
        "id": item.id,
        "invoiceId": item.sales_invoice_item.invoice_id,
        "invoiceNumber": item.sales_invoice_item.invoice.invoice_number,
        "salesInvoiceItemId": item.sales_invoice_item_id,
        "itemId": item.item_id,
        "itemName": item.item_name,
        "batchNumber": item.sales_invoice_item.batch_number,
        "expiryDate": str(item.sales_invoice_item.expiry_date) if item.sales_invoice_item.expiry_date else None,
        "batchAllocations": batch_allocations,
        "quantity": float(item.quantity),
        "soldQuantity": float(sold_qty),
        "unitPrice": float(item.unit_price),
        "taxRate": float(item.tax_rate),
        "subtotal": float(item.subtotal),
        "taxAmount": float(item.tax_amount),
        "lineTotal": float(item.line_total),
        "disposition": item.disposition,
        "dispositionDisplay": dict(SalesReturnItem.DISPOSITION_CHOICES).get(item.disposition, item.disposition),
        "reason": item.reason,
    }


def _primary_batch_snapshot_for_sales_item(sales_item: SalesInvoiceItem):
    allocation = (
        sales_item.batch_allocations
        .select_related("stock_batch")
        .order_by("created_at", "id")
        .first()
    )
    if allocation:
        return allocation.stock_batch.batch_number, allocation.stock_batch.expiry_date
    return sales_item.batch_number, sales_item.expiry_date


def _sales_return_to_dict(ret: SalesReturn, include_items=False) -> dict:
    invoice_rows = list(
        ret.items.select_related("sales_invoice_item__invoice")
        .values_list("sales_invoice_item__invoice__invoice_number", flat=True)
        .distinct()
    )
    invoice_label = ""
    if ret.sales_invoice_id:
        invoice_label = ret.sales_invoice.invoice_number
    elif len(invoice_rows) == 1:
        invoice_label = invoice_rows[0]
    elif invoice_rows:
        invoice_label = f"Multiple invoices ({len(invoice_rows)})"
    data = {
        "id": ret.id,
        "returnNumber": ret.return_number,
        "returnDate": str(ret.return_date),
        "salesInvoiceId": ret.sales_invoice_id,
        "invoiceNumber": invoice_label,
        "invoiceNumbers": invoice_rows,
        "customerId": ret.customer_id,
        "customerName": ret.customer.display_name if ret.customer_id else ret.sales_invoice.customer_name,
        "warehouseId": ret.warehouse_id,
        "warehouseName": ret.warehouse.name if ret.warehouse_id else "",
        "reason": ret.reason,
        "notes": ret.notes,
        "status": ret.status,
        "statusDisplay": dict(SalesReturn.STATUS_CHOICES).get(ret.status, ret.status),
        "subtotal": float(ret.subtotal),
        "taxAmount": float(ret.tax_amount),
        "totalAmount": float(ret.total_amount),
        "stockPosted": ret.stock_posted,
        "createdBy": ret.created_by.name if ret.created_by else "System",
        "createdAt": ret.created_at.isoformat() if ret.created_at else None,
    }
    if include_items:
        data["items"] = [
            _return_item_to_dict(item)
            for item in ret.items.select_related("item", "sales_invoice_item__invoice").all()
        ]
    return data


def _send_invoice_confirmation_email(inv: SalesInvoice) -> None:
    if not inv.customer_email:
        raise ValueError("Customer email is not available for this invoice.")

    subject = f"Invoice {inv.invoice_number} confirmed"
    financials = _invoice_financials(inv)
    send_templated_email(
        subject=subject,
        to=[inv.customer_email],
        template_name="invoice_confirmation",
        context={
            "subject": subject,
            "preheader": f"Invoice {inv.invoice_number} has been confirmed with a balance of {money(financials['balance_amount'])}.",
            "title": "Invoice Confirmed",
            "intro": f"Invoice {inv.invoice_number} has been confirmed and is now ready for your records.",
            "customer_name": inv.customer_name or "Customer",
            "customer_phone": inv.customer_phone or None,
            "customer_email": inv.customer_email,
            "invoice_number": inv.invoice_number,
            "invoice_date": str(inv.invoice_date),
            "due_date": str(inv.due_date) if inv.due_date else None,
            "payment_status": financials.get("payment_status_display") or financials.get("payment_status"),
            "salesperson_name": inv.sales_person.name if inv.sales_person else None,
            "items": [
                {
                    "item_name": item.item_name,
                    "quantity": item.quantity,
                    "tax_rate": f"{float(item.tax_rate):.2f}".rstrip("0").rstrip("."),
                    "line_total": money(item.line_total),
                }
                for item in inv.items.all()
            ],
            "total_amount": money(financials["net_total"]),
            "paid_amount": money(financials["paid_amount"]),
            "balance_amount": money(financials["balance_amount"]),
            "notes": inv.notes or None,
        },
    )


def _invoice_to_dict(inv: SalesInvoice, include_items=False, include_payments=False) -> dict:
    returned_qty_map = _returned_quantity_map(inv) if include_items else {}
    financials = _invoice_financials(inv)
    d = {
        "id":               inv.id,
        "invoiceNumber":    inv.invoice_number,
        "invoiceDate":      str(inv.invoice_date),
        "dueDate":          str(inv.due_date) if inv.due_date else None,
        "financialYear":    str(inv.financial_year) if inv.financial_year else None,
        "financialYearId":  inv.financial_year_id,
        "customerId":       inv.customer_id,
        "salespersonId":    inv.sales_person_id,
        "salespersonName":  inv.sales_person.name if inv.sales_person else "",
        "customerName":     inv.customer_name,
        "customerPhone":    inv.customer_phone,
        "customerEmail":    inv.customer_email,
        "customerAddress":  inv.customer_address,
        "customerShippingAddress": getattr(inv, "customer_shipping_address", ""),
        "customerOutstanding": float(inv.customer.outstanding) if inv.customer else 0,
        "customerState":    getattr(inv, "customer_state", ""),
        "customerGst":      getattr(inv, "customer_trn", ""),
        "subtotal":         float(inv.subtotal),
        "discAmount":       float(inv.disc_amount),
        "taxAmount":        float(inv.tax_amount),
        "grossTotalAmount": financials["gross_total"],
        "returnAmount":     financials["return_amount"],
        "totalAmount":      financials["net_total"],
        "rawPaidAmount":    financials["raw_paid_amount"],
        "paidAmount":       financials["paid_amount"],
        "refundableAmount": financials["refundable_amount"],
        "balanceAmount":    financials["balance_amount"],
        "status":           inv.status,
        "statusDisplay":    dict(SalesInvoice.STATUS_CHOICES).get(inv.status, inv.status),
        "paymentStatus":    financials["payment_status"],
        "paymentStatusDisplay": financials["payment_status_display"],
        "stockPosted":      inv.stock_posted,
        "notes":            inv.notes,
        "termsAndConditions": inv.terms_and_conditions,
        "taxEnabled":       getattr(inv, "tax_enabled", True),
        "gstType":          getattr(inv, "gst_type", "auto"),
        "discountEnabled":  getattr(inv, "discount_enabled", True),
        "discountMode":     getattr(inv, "discount_mode", "percent"),
        "discountValue":    float(getattr(inv, "discount_value", 0) or 0),
        "offerEnabled":     getattr(inv, "offer_enabled", False),
        "offerText":        getattr(inv, "offer_text", ""),
        "createdBy":        inv.created_by.name if inv.created_by else "System",
        "createdAt":        inv.created_at.isoformat() if inv.created_at else None,
    }
    if include_items:
        d["items"] = []
        for i in inv.items.select_related("item").all():
            item_data = _item_to_dict(i)
            returned_qty = returned_qty_map.get(i.id, Decimal("0"))
            remaining_qty = max(Decimal(str(i.quantity or 0)) - returned_qty, Decimal("0"))
            item_data["returnedQty"] = float(returned_qty)
            item_data["remainingReturnQty"] = float(remaining_qty)
            d["items"].append(item_data)
    if include_payments:
        d["payments"] = [_payment_to_dict(p) for p in inv.payments.all()]
    return d


def _validate_return_items(items_data: list, exclude_return_id=None, customer_id=None) -> list[str]:
    if not items_data:
        return ["At least one return item is required."]

    requested_ids = [raw.get("salesInvoiceItemId") for raw in items_data if raw.get("salesInvoiceItemId")]
    invoice_items = {
        item.id: item
        for item in SalesInvoiceItem.objects.select_related("invoice", "item", "invoice__customer").filter(id__in=requested_ids)
    }
    returned_qty_map = _returned_quantity_map_for_invoice_items(requested_ids, exclude_return_id=exclude_return_id)
    errors = []
    has_positive = False
    batch_requested_qty = {}
    valid_dispositions = {choice[0] for choice in SalesReturnItem.DISPOSITION_CHOICES}

    for idx, raw in enumerate(items_data, start=1):
        item_id = raw.get("salesInvoiceItemId")
        if not item_id or item_id not in invoice_items:
            errors.append(f"Row {idx}: select a valid invoice item.")
            continue
        source_item = invoice_items[item_id]
        if source_item.invoice.status != "confirmed":
            errors.append(f"Row {idx}: invoice '{source_item.invoice.invoice_number}' is not confirmed.")
            continue
        if source_item.invoice.status == "cancelled":
            errors.append(f"Row {idx}: invoice '{source_item.invoice.invoice_number}' is cancelled.")
            continue
        if customer_id and source_item.invoice.customer_id != customer_id:
            errors.append(f"Row {idx}: invoice item does not belong to the selected customer.")
            continue
        disposition = (raw.get("disposition") or "restock").strip().lower()
        if disposition not in valid_dispositions:
            errors.append(f"Row {idx}: disposition must be restock, damaged, or expired.")
            continue
        try:
            qty = _parse_decimal(raw.get("quantity", 0), f"items[{idx}].quantity")
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if qty < 0:
            errors.append(f"Row {idx}: quantity cannot be negative.")
            continue
        if qty != qty.to_integral_value():
            errors.append(f"Row {idx}: return quantity must be a whole number.")
            continue
        if qty == 0:
            continue
        has_positive = True
        original_qty = Decimal(str(source_item.quantity or 0))
        already_returned = returned_qty_map.get(item_id, Decimal("0"))
        requested_so_far = batch_requested_qty.get(item_id, Decimal("0"))
        remaining_qty = original_qty - already_returned
        if qty + requested_so_far > remaining_qty:
            errors.append(
                f"Row {idx}: return quantity for '{source_item.item_name}' exceeds remaining qty "
                f"({float(remaining_qty):g})."
            )
            continue
        batch_requested_qty[item_id] = requested_so_far + qty

    if not has_positive and not errors:
        errors.append("Enter a return quantity for at least one line item.")
    return errors


def _create_return_items(sales_return: SalesReturn, items_data: list):
    requested_ids = [raw.get("salesInvoiceItemId") for raw in items_data if raw.get("salesInvoiceItemId")]
    invoice_items = {
        item.id: item
        for item in SalesInvoiceItem.objects.select_related("item", "invoice").filter(id__in=requested_ids)
    }
    for raw in items_data:
        item_id = raw.get("salesInvoiceItemId")
        if not item_id or item_id not in invoice_items:
            continue
        qty = Decimal(str(raw.get("quantity", 0) or 0))
        if qty <= 0:
            continue
        source_item = invoice_items[item_id]
        SalesReturnItem.objects.create(
            sales_return=sales_return,
            sales_invoice_item=source_item,
            item=source_item.item,
            item_name=source_item.item_name,
            quantity=qty,
            unit_price=getattr(source_item, "amount_per_unit", None) or source_item.unit_price or 0,
            tax_rate=source_item.tax_rate or 0,
            disposition=(raw.get("disposition") or "restock").strip().lower() or "restock",
            reason=(raw.get("reason") or "").strip(),
        )


def _post_sales_return_stock(sales_return: SalesReturn, performed_by) -> None:
    if sales_return.stock_posted:
        return

    for item in sales_return.items.select_related("item", "sales_invoice_item__invoice").all():
        if not item.item or not getattr(item.item, "track_inventory", False):
            continue
        qty = _asset_quantity_to_int(item.quantity, item.item_name)
        stock, _ = Stock.objects.select_for_update().get_or_create(
            item=item.item,
            warehouse=sales_return.warehouse,
            defaults={"total_quantity": 0, "damaged_quantity": 0, "expired_quantity": 0, "minimum_stock": 0},
        )
        batch_number, expiry_date = _primary_batch_snapshot_for_sales_item(item.sales_invoice_item)
        stock.total_quantity += qty
        movement_type = "returned"
        if item.disposition == "damaged":
            stock.damaged_quantity += qty
            movement_type = "damaged"
        elif item.disposition == "expired":
            stock.expired_quantity += qty
            movement_type = "expired"
        else:
            StockBatch.objects.create(
                item=item.item,
                warehouse=sales_return.warehouse,
                sales_return_item=item,
                batch_number=(batch_number or "").strip(),
                expiry_date=expiry_date,
                quantity_received=qty,
                quantity_available=qty,
            )
        stock.save(update_fields=["total_quantity", "damaged_quantity", "expired_quantity", "updated_at"])
        StockHistory.objects.create(
            item=item.item,
            warehouse=sales_return.warehouse,
            movement_type=movement_type,
            quantity=qty,
            balance_after=stock.available_quantity,
            reference_type="SalesReturn",
            reference_id=sales_return.id,
            batch_number=(batch_number or "").strip(),
            expiry_date=expiry_date,
            reason=(
                f"{item.disposition.title()} via {sales_return.return_number} "
                f"against {item.sales_invoice_item.invoice.invoice_number}"
            ),
            performed_by=performed_by,
        )

    sales_return.stock_posted = True
    sales_return.save(update_fields=["stock_posted", "updated_at"])


def _reverse_sales_return_stock(sales_return: SalesReturn, performed_by) -> None:
    if not sales_return.stock_posted:
        return

    for item in sales_return.items.select_related("item").all():
        if not item.item or not getattr(item.item, "track_inventory", False):
            continue
        qty = _asset_quantity_to_int(item.quantity, item.item_name)
        stock = get_object_or_404(
            Stock.objects.select_for_update(),
            item=item.item,
            warehouse=sales_return.warehouse,
        )
        if item.disposition == "restock":
            restock_batches = list(item.restocked_batches.select_for_update().order_by("created_at", "id"))
            if sum(batch.quantity_available for batch in restock_batches) < qty:
                raise ValueError(
                    f"Cannot cancel return {sales_return.return_number}. "
                    f"Warehouse '{sales_return.warehouse.name}' only has {stock.available_quantity} "
                    f"returnable unit(s) for '{item.item.name}'."
                )
            qty_remaining = qty
            for batch in restock_batches:
                removable = min(batch.quantity_available, qty_remaining)
                if removable <= 0:
                    continue
                stock.total_quantity -= removable
                batch.quantity_available -= removable
                batch.quantity_received -= removable
                batch_number = batch.batch_number
                expiry_date = batch.expiry_date
                if batch.quantity_received <= 0 and batch.quantity_available <= 0:
                    batch.delete()
                else:
                    batch.save(update_fields=["quantity_received", "quantity_available", "updated_at"])
                StockHistory.objects.create(
                    item=item.item,
                    warehouse=sales_return.warehouse,
                    movement_type="remove",
                    quantity=removable,
                    balance_after=max(0, stock.available_quantity),
                    reference_type="SalesReturn",
                    reference_id=sales_return.id,
                    batch_number=batch_number,
                    expiry_date=expiry_date,
                    reason=f"Stock reversed after cancelling return {sales_return.return_number}",
                    performed_by=performed_by,
                )
                qty_remaining -= removable
                if qty_remaining == 0:
                    break
            if qty_remaining > 0:
                raise ValueError(
                    f"Cannot cancel return {sales_return.return_number}. "
                    f"Some restocked batches are no longer fully available for '{item.item.name}'."
                )
        elif item.disposition == "damaged":
            if stock.damaged_quantity < qty:
                raise ValueError(
                    f"Cannot cancel return {sales_return.return_number}. "
                    f"Warehouse '{sales_return.warehouse.name}' only has {stock.damaged_quantity} "
                    f"damaged unit(s) for '{item.item.name}'."
                )
            stock.damaged_quantity -= qty
            stock.total_quantity -= qty
        elif item.disposition == "expired":
            if getattr(stock, "expired_quantity", 0) < qty:
                raise ValueError(
                    f"Cannot cancel return {sales_return.return_number}. "
                    f"Warehouse '{sales_return.warehouse.name}' only has {stock.expired_quantity} "
                    f"expired unit(s) for '{item.item.name}'."
                )
            stock.expired_quantity -= qty
            stock.total_quantity -= qty
        if item.disposition != "restock":
            batch_number, expiry_date = _primary_batch_snapshot_for_sales_item(item.sales_invoice_item)
            StockHistory.objects.create(
                item=item.item,
                warehouse=sales_return.warehouse,
                movement_type="remove",
                quantity=qty,
                balance_after=max(0, stock.available_quantity),
                reference_type="SalesReturn",
                reference_id=sales_return.id,
                batch_number=(batch_number or "").strip(),
                expiry_date=expiry_date,
                reason=f"Stock reversed after cancelling return {sales_return.return_number}",
                performed_by=performed_by,
            )
        stock.save(update_fields=["total_quantity", "damaged_quantity", "expired_quantity", "updated_at"])

    sales_return.stock_posted = False
    sales_return.save(update_fields=["stock_posted", "updated_at"])


# ─── Item validation ──────────────────────────────────────────────────────────

def _to_bool(val, default=False):
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(val)

def _validate_invoice_items(items_data: list) -> list:
    """
    Returns list of error strings.
    Rules:
      • Each item must have assetId or itemName (custom).
      • quantity > 0
      • unitPrice / rspWithoutVat >= 0
      • discount whole >= 0, taxRate whole 0–100
      • Asset must be active and have sufficient stock
    """
    errors = []
    if not items_data:
        errors.append("At least one line item is required.")
        return errors

    for idx, item in enumerate(items_data):
        row  = idx + 1
        itype = item.get("itemType", "custom")

        has_asset   = bool(item.get("assetId"))
        has_name    = bool((item.get("itemName") or "").strip())

        if not has_asset and not has_name:
            errors.append(f"Row {row}: must have an asset or a custom item name.")
            continue

        # Validate asset
        if itype == "asset" and has_asset:
            try:
                asset_id = int(item["assetId"])
                try:
                    asset = Asset.objects.get(id=asset_id)
                except Asset.DoesNotExist:
                    errors.append(f"Row {row}: Asset id={asset_id} not found.")
                    continue
                if asset.status != "active":
                    errors.append(f"Row {row}: Asset '{asset.name}' is not active (status: {asset.status}).")
                    continue
                if getattr(asset, "item_type", "goods") == "service" or not getattr(asset, "track_inventory", True):
                    errors.append(f"Row {row}: Asset '{asset.name}' is not a stock-tracked goods item.")
                    continue
                # Check stock
                avail, _ = _get_asset_stock(asset)
                try:
                    req_qty = Decimal(str(item.get("quantity", 1)))
                except (InvalidOperation, TypeError):
                    req_qty = Decimal("1")
                if avail <= 0:
                    errors.append(f"Row {row}: Asset '{asset.name}' has no stock available.")
                elif req_qty > avail:
                    errors.append(
                        f"Row {row}: Asset '{asset.name}' — requested {int(req_qty)}, "
                        f"only {avail} available in stock."
                    )
            except (TypeError, ValueError):
                errors.append(f"Row {row}: assetId must be an integer.")

        # Numeric validation
        try:
            qty = Decimal(str(item.get("quantity", 1)))
            if qty <= 0:
                errors.append(f"Row {row}: quantity must be greater than 0.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: quantity must be a valid number.")
            qty = None

        if has_asset and qty is not None and qty != qty.to_integral_value():
            errors.append(f"Row {row}: Asset quantities must be whole numbers.")

        try:
            price = Decimal(str(item.get("rspWithoutVat", item.get("unitPrice", 0))))
            if price < 0:
                errors.append(f"Row {row}: RSP without VAT cannot be negative.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: RSP without VAT must be a valid number.")

        try:
            discount = Decimal(str(item.get("discount", 0)))
            discount_type = (item.get("discountType") or "amount").strip().lower()
            if discount != discount.to_integral_value():
                errors.append(f"Row {row}: Discount must be a whole number.")
            elif discount < 0:
                errors.append(f"Row {row}: Discount cannot be negative.")
            elif discount_type == "percent" and discount > 100:
                errors.append(f"Row {row}: Percentage discount cannot exceed 100.")
            elif discount_type != "percent" and discount > price:
                errors.append(f"Row {row}: Discount cannot exceed RSP without VAT.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: Discount must be a valid number.")

        expiry_date = item.get("expiryDate")
        if expiry_date:
            try:
                date.fromisoformat(str(expiry_date))
            except (TypeError, ValueError):
                errors.append(f"Row {row}: Expiry date must be a valid date.")

        try:
            tax_rate = Decimal(str(item.get("taxRate", 0)))
            if tax_rate != tax_rate.to_integral_value():
                errors.append(f"Row {row}: Tax rate must be a whole number.")
            elif not (0 <= tax_rate <= 100):
                errors.append(f"Row {row}: Tax rate must be between 0 and 100.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: Tax rate must be a valid number.")

    return errors


def _create_items(invoice: SalesInvoice, items_data: list):
    """Create SalesInvoiceItem rows from validated item data."""
    tax_enabled = getattr(invoice, "tax_enabled", True)
    discount_enabled = getattr(invoice, "discount_enabled", True)

    for item in items_data:
        itype       = item.get("itemType", "custom")
        asset_obj   = None
        item_name   = (item.get("itemName") or "").strip()

        if itype == "asset" and item.get("assetId"):
            asset_obj = get_object_or_404(Asset, id=item["assetId"])
            item_name = item_name or asset_obj.name

        if not item_name:
            item_name = "Custom Item"

        rsp_without_vat = item.get("rspWithoutVat", item.get("unitPrice", 0))
        rsp_incl_vat = item.get("rspInclVat")
        discount_value = item.get("discount", 0) if discount_enabled else 0
        discount_type = (item.get("discountType") or "amount").strip().lower()
        tax_rate = item.get("taxRate", 0) if tax_enabled else 0
        expiry_date = item.get("expiryDate") or None
        if expiry_date:
            expiry_date = date.fromisoformat(str(expiry_date))

        SalesInvoiceItem.objects.create(
            invoice          = invoice,
            item             = asset_obj,
            item_name        = item_name,
            item_description = (item.get("itemDescription") or "").strip(),
            quantity         = item.get("quantity",  1),
            unit_price       = rsp_without_vat,
            batch_number     = (item.get("batchNumber") or "").strip(),
            expiry_date      = expiry_date,
            rsp_without_vat  = rsp_without_vat,
            rsp_incl_vat     = rsp_incl_vat if rsp_incl_vat is not None else 0,
            discount_type    = discount_type if discount_enabled else "amount",
            discount         = discount_value,
            tax_rate         = tax_rate,
            notes            = (item.get("notes") or "").strip(),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# INVOICE VIEWS
# ═══════════════════════════════════════════════════════════════════════════════

class SalesInvoiceListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request):
        qs = SalesInvoice.objects.select_related("customer", "financial_year", "created_by", "sales_person").all()
        overdue_only = str(request.GET.get("overdueOnly", "")).strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if (v := request.GET.get("search",        "").strip()):
            qs = qs.filter(Q(invoice_number__icontains=v) | Q(customer_name__icontains=v))
        if (v := request.GET.get("status",        "").strip()): qs = qs.filter(status=v)
        if (v := request.GET.get("paymentStatus", "").strip()): qs = qs.filter(payment_status=v)
        if (v := request.GET.get("customerId",    "").strip()): qs = qs.filter(customer_id=v)
        if (v := request.GET.get("financialYearId","").strip()): qs = qs.filter(financial_year_id=v)
        if (v := request.GET.get("dateFrom",      "").strip()): qs = qs.filter(invoice_date__gte=v)
        if (v := request.GET.get("dateTo",        "").strip()): qs = qs.filter(invoice_date__lte=v)
        if overdue_only:
            qs = qs.filter(
                due_date__isnull=False,
                due_date__lt=date.today(),
                payment_status__in=["unpaid", "partial"],
            ).exclude(status="cancelled")
        page_param = request.GET.get("page")
        page_size_param = request.GET.get("page_size")
        if page_param or page_size_param:
            try:
                page = int(page_param or 1)
                page_size = int(page_size_param or 10)
            except (ValueError, TypeError):
                page, page_size = 1, 10
            page = max(1, page)
            page_size = max(1, min(page_size, 200))
            total = qs.count()
            total_pages = max(1, -(-total // page_size))
            start = (page - 1) * page_size
            paged = qs.order_by("-invoice_date", "-created_at")[start : start + page_size]
            return Response({
                "results": [_invoice_to_dict(inv) for inv in paged],
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        return Response([_invoice_to_dict(inv) for inv in qs])


class SalesInvoiceCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data

        # ── Header validation ─────────────────────────────────────────────────
        header_errors = {}
        if not d.get("customerId"):
            header_errors["customerId"] = "customerId is required."
        if not d.get("invoiceDate"):
            header_errors["invoiceDate"] = "invoiceDate is required."
        salesperson = None
        salesperson_id = d.get("salespersonId")
        if salesperson_id not in (None, "", 0, "0"):
            try:
                salesperson = User.objects.get(
                    id=salesperson_id,
                    role="salesperson",
                    is_active=True,
                )
            except User.DoesNotExist:
                header_errors["salespersonId"] = "Select an active salesperson."

        items_data  = d.get("items") or []
        item_errors = _validate_invoice_items(items_data)

        if header_errors or item_errors:
            return Response({
                "error":       "; ".join(list(header_errors.values()) + item_errors),
                "fieldErrors": header_errors,
                "itemErrors":  item_errors,
            }, status=400)

        fy = FinancialYear.get_active()
        if not fy:
            return _err("No active financial year. Please activate one first.")

        customer = get_object_or_404(Customer, id=d["customerId"])
        if not customer.is_active:
            return _err(f"Customer '{customer.name}' is not active.")

        invoice = SalesInvoice(
            financial_year       = fy,
            sales_person         = salesperson,
            invoice_number       = _next_invoice_number(),
            invoice_date         = d["invoiceDate"],
            due_date             = d.get("dueDate") or _calculate_due_date(d["invoiceDate"], customer.payment_terms) or None,
            notes                = (d.get("notes") or "").strip(),
            terms_and_conditions = (d.get("termsAndConditions") or "").strip(),
            tax_enabled          = _to_bool(d.get("taxEnabled"), True),
            discount_enabled     = _to_bool(d.get("discountEnabled"), True),
            discount_mode        = (d.get("discountMode") or "percent"),
            discount_value       = d.get("discountValue") or 0,
            offer_enabled        = _to_bool(d.get("offerEnabled"), False),
            offer_text           = (d.get("offerText") or "").strip(),
            created_by           = request.user,
        )
        invoice.snapshot_customer(customer)
        invoice.save()

        _create_items(invoice, items_data)
        invoice.refresh_from_db()
        if invoice.customer:
            invoice.customer.sync_outstanding()

        create_audit_log(
            user=request.user, action="create",
            resource=invoice.invoice_number, resource_type="SalesInvoice",
            request=request,
            details=f"Invoice {invoice.invoice_number} for {customer.name}",
            changes={"customer": customer.name, "totalAmount": float(invoice.total_amount)},
        )
        return Response({
            "message":       "Invoice created successfully.",
            "invoiceId":     invoice.id,
            "invoiceNumber": invoice.invoice_number,
            "totalAmount":   float(invoice.total_amount),
        }, status=201)


class SalesInvoiceDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request, pk):
        inv = get_object_or_404(
            SalesInvoice.objects
            .select_related("customer", "financial_year", "created_by", "sales_person")
            .prefetch_related(
                "items__item",
                "items__batch_allocations__stock_batch__warehouse",
                "payments",
            ),
            id=pk,
        )
        return Response(_invoice_to_dict(inv, include_items=True, include_payments=True))


class SalesInvoiceUpdateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def put(self, request, pk):
        inv = get_object_or_404(SalesInvoice, id=pk)
        d   = request.data

        if inv.status == "cancelled":
            return _err("Cannot edit a cancelled invoice.")
        if inv.status == "confirmed" or inv.stock_posted:
            return _err("Confirmed invoices cannot be edited. Cancel the invoice and create a replacement.")
        if inv.payment_status == "paid":
            return _err("Cannot edit a fully paid invoice.")

        header_errors = {}
        if "invoiceDate" in d and not d["invoiceDate"]:
            header_errors["invoiceDate"] = "invoiceDate cannot be empty."
        if "salespersonId" in d and d.get("salespersonId") not in (None, "", 0, "0"):
            if not User.objects.filter(
                id=d.get("salespersonId"),
                role="salesperson",
                is_active=True,
            ).exists():
                header_errors["salespersonId"] = "Select an active salesperson."

        items_data  = d.get("items")
        item_errors = _validate_invoice_items(items_data) if items_data is not None else []

        if header_errors or item_errors:
            return Response({
                "error":       "; ".join(list(header_errors.values()) + item_errors),
                "fieldErrors": header_errors,
                "itemErrors":  item_errors,
            }, status=400)

        if "customerId" in d:
            customer = get_object_or_404(Customer, id=d["customerId"])
            if not customer.is_active:
                return _err(f"Customer '{customer.name}' is not active.")
            inv.snapshot_customer(customer)
        if "salespersonId" in d:
            salesperson_id = d.get("salespersonId")
            if salesperson_id in (None, "", 0, "0"):
                inv.sales_person = None
            else:
                inv.sales_person = get_object_or_404(
                    User,
                    id=salesperson_id,
                    role="salesperson",
                    is_active=True,
                )

        inv.invoice_date         = d.get("invoiceDate", inv.invoice_date)
        if "dueDate" in d:
            inv.due_date = (
                d.get("dueDate")
                or _calculate_due_date(inv.invoice_date, inv.customer.payment_terms if inv.customer else None)
                or None
            )
        inv.notes                = (d.get("notes", inv.notes) or "").strip()
        inv.terms_and_conditions = (d.get("termsAndConditions", inv.terms_and_conditions) or "").strip()
        if "taxEnabled" in d:
            inv.tax_enabled = _to_bool(d.get("taxEnabled"))
        if "discountEnabled" in d:
            inv.discount_enabled = _to_bool(d.get("discountEnabled"))
        if "discountMode" in d:
            inv.discount_mode = d.get("discountMode") or "percent"
        if "discountValue" in d:
            inv.discount_value = d.get("discountValue") or 0
        if "offerEnabled" in d:
            inv.offer_enabled = _to_bool(d.get("offerEnabled"))
        if "offerText" in d:
            inv.offer_text = (d.get("offerText") or "").strip()
        inv.save()

        if items_data is not None:
            inv.items.all().delete()
            _create_items(inv, items_data)

        inv.refresh_from_db()
        if inv.customer:
            inv.customer.sync_outstanding()
        create_audit_log(
            user=request.user, action="update",
            resource=inv.invoice_number, resource_type="SalesInvoice",
            request=request, details=f"Invoice {inv.invoice_number} updated", changes={},
        )
        return Response({"message": "Invoice updated.", **_invoice_to_dict(inv, include_items=True)})


class SalesInvoiceDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def delete(self, request, pk):
        inv = get_object_or_404(SalesInvoice, id=pk)
        if inv.status == "confirmed" or inv.stock_posted:
            return _err("Confirmed invoices cannot be deleted.")
        if float(inv.paid_amount) > 0:
            return _err("Cannot delete an invoice that has payments. Delete payments first.")
        customer = inv.customer
        number = inv.invoice_number
        inv.delete()
        if customer:
            customer.sync_outstanding()
        return Response({"message": f"Invoice {number} deleted."})


class SalesInvoiceCancelView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def put(self, request, pk):
        inv = get_object_or_404(SalesInvoice, id=pk)
        if inv.status == "cancelled":
            return _err("Invoice is already cancelled.")
        if float(inv.paid_amount) > 0:
            return _err("Cannot cancel an invoice that has payments.")
        if inv.returns.exclude(status="cancelled").exists():
            return _err("Cannot cancel an invoice that has active sales returns.")
        if inv.stock_posted:
            _restore_invoice_stock(inv, request.user)
        inv.status = "cancelled"
        inv.save(update_fields=["status", "updated_at"])
        if inv.customer:
            inv.customer.sync_outstanding()
        create_audit_log(
            user=request.user, action="cancel",
            resource=inv.invoice_number, resource_type="SalesInvoice",
            request=request, details=f"Invoice {inv.invoice_number} cancelled", changes={},
        )
        return Response({"message": f"Invoice {inv.invoice_number} cancelled."})


class SalesInvoiceConfirmView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def post(self, request, pk):
        inv = get_object_or_404(SalesInvoice, id=pk)
        if inv.status == "cancelled":
            return _err("Cancelled invoices cannot be confirmed.")
        already_confirmed = inv.status == "confirmed"
        if already_confirmed and inv.stock_posted:
            return Response({
                "message": f"Invoice {inv.invoice_number} is already confirmed.",
                "mailSent": False,
            })

        try:
            _post_invoice_stock(inv, request.user)
        except ValueError as exc:
            return _err(str(exc))

        if not already_confirmed:
            inv.status = "confirmed"
            inv.save(update_fields=["status", "updated_at"])

        mail_sent = False
        email_error = ""
        if not already_confirmed:
            try:
                _send_invoice_confirmation_email(inv)
                mail_sent = True
            except Exception as exc:
                logger.exception("Invoice confirmation email failed pk=%s", pk)
                email_error = str(exc)

        create_audit_log(
            user=request.user,
            action="update",
            resource=inv.invoice_number,
            resource_type="SalesInvoice",
            request=request,
            details=f"Invoice {inv.invoice_number} confirmed",
            changes={"status": "confirmed", "mailSent": mail_sent, "stockPosted": inv.stock_posted},
        )

        response = {
            "message": (
                f"Invoice {inv.invoice_number} confirmed and email sent."
                if mail_sent
                else (
                    f"Invoice {inv.invoice_number} stock updated."
                    if already_confirmed
                    else f"Invoice {inv.invoice_number} confirmed."
                )
            ),
            "status": inv.status,
            "mailSent": mail_sent,
            "stockPosted": inv.stock_posted,
        }
        if email_error:
            response["emailError"] = email_error
        return Response(response)


# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════

class SalesPaymentCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def post(self, request, pk):
        inv = get_object_or_404(SalesInvoice, id=pk)
        d   = request.data

        if inv.status == "cancelled":
            return _err("Cannot add payment to a cancelled invoice.")
        if inv.status != "confirmed":
            return _err("Confirm the invoice before recording payment.")

        try:
            amount = _parse_decimal(d.get("amount", 0), "amount")
        except ValueError as e:
            return _err(str(e))

        if amount <= 0:
            return _err("Amount must be greater than zero.")

        financials = _invoice_financials(inv)
        transaction_type = (d.get("transactionType") or "payment").strip().lower()
        if transaction_type not in {"payment", "refund"}:
            return _err("transactionType must be 'payment' or 'refund'.")

        balance = Decimal(str(financials["balance_amount"]))
        refundable = Decimal(str(financials["refundable_amount"]))
        signed_amount = amount
        if transaction_type == "payment":
            if amount > balance + Decimal("0.01"):
                return _err(f"Payment AED {float(amount):,.2f} exceeds balance AED {float(balance):,.2f}.")
        else:
            if refundable <= Decimal("0.00"):
                return _err("There is no refundable amount available for this invoice.")
            if amount > refundable + Decimal("0.01"):
                return _err(f"Refund AED {float(amount):,.2f} exceeds refundable amount AED {float(refundable):,.2f}.")
            signed_amount = -amount

        valid_methods = [m[0] for m in PAYMENT_METHOD_CHOICES]
        pay_method    = d.get("paymentMethod", "cash")
        if pay_method not in valid_methods:
            return _err(f"Invalid paymentMethod '{pay_method}'. Valid: {', '.join(valid_methods)}.")

        fy = inv.financial_year or FinancialYear.get_active()
        payment = SalesPayment.objects.create(
            financial_year = fy,
            sales_invoice  = inv,
            payment_date   = d.get("paymentDate") or date.today(),
            amount         = signed_amount,
            payment_method = pay_method,
            reference_no   = (d.get("referenceNo") or "").strip(),
            notes          = (d.get("notes") or "").strip(),
            created_by     = request.user,
        )
        inv.refresh_from_db()
        return Response({
            "message":       (
                f"Refund of AED {float(amount):,.2f} recorded."
                if transaction_type == "refund"
                else f"Payment of AED {float(amount):,.2f} recorded."
            ),
            "paymentId":     payment.id,
            "paidAmount":    _invoice_financials(inv)["paid_amount"],
            "balanceAmount": _invoice_financials(inv)["balance_amount"],
            "paymentStatus": _invoice_financials(inv)["payment_status"],
        }, status=201)


class SalesPaymentDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def delete(self, request, payment_id):
        payment = get_object_or_404(SalesPayment, id=payment_id)
        invoice = payment.sales_invoice
        amount  = float(abs(payment.amount))
        transaction_type = "refund" if Decimal(str(payment.amount or 0)) < 0 else "payment"
        payment.delete()
        invoice.refresh_from_db()
        return Response({
            "message":       (
                f"Refund of AED {amount:,.2f} deleted."
                if transaction_type == "refund"
                else f"Payment of AED {amount:,.2f} deleted."
            ),
            "balanceAmount": _invoice_financials(invoice)["balance_amount"],
            "paymentStatus": _invoice_financials(invoice)["payment_status"],
        })


# ═══════════════════════════════════════════════════════════════════════════════
# SALES RETURNS
# ═══════════════════════════════════════════════════════════════════════════════

class SalesReturnListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request):
        qs = SalesReturn.objects.select_related(
            "sales_invoice", "customer", "warehouse", "created_by"
        ).prefetch_related("items__sales_invoice_item__invoice").all()
        if (v := request.GET.get("search", "").strip()):
            qs = qs.filter(
                Q(return_number__icontains=v)
                | Q(sales_invoice__invoice_number__icontains=v)
                | Q(customer__display_name__icontains=v)
                | Q(items__sales_invoice_item__invoice__invoice_number__icontains=v)
            )
        if (v := request.GET.get("status", "").strip()):
            qs = qs.filter(status=v)
        if (v := request.GET.get("salesInvoiceId", "").strip()):
            qs = qs.filter(
                Q(sales_invoice_id=v) | Q(items__sales_invoice_item__invoice_id=v)
            )
        if (v := request.GET.get("customerId", "").strip()):
            qs = qs.filter(customer_id=v)
        if (v := request.GET.get("financialYearId", "").strip()):
            qs = qs.filter(financial_year_id=v)
        if (v := request.GET.get("dateFrom", "").strip()):
            qs = qs.filter(return_date__gte=v)
        if (v := request.GET.get("dateTo", "").strip()):
            qs = qs.filter(return_date__lte=v)
        qs = qs.order_by("-return_date", "-created_at").distinct()

        summary_rows = list(qs)
        summary = {
            "total": len(summary_rows),
            "confirmed": sum(1 for row in summary_rows if row.status == "confirmed"),
            "draft": sum(1 for row in summary_rows if row.status == "draft"),
            "cancelled": sum(1 for row in summary_rows if row.status == "cancelled"),
            "value": sum(float(row.total_amount or 0) for row in summary_rows),
        }

        page_param = request.GET.get("page")
        page_size_param = request.GET.get("page_size")
        if page_param or page_size_param:
            try:
                page = int(page_param or 1)
                page_size = int(page_size_param or 10)
            except (ValueError, TypeError):
                page, page_size = 1, 10
            page = max(1, page)
            page_size = max(1, min(page_size, 200))
            total = len(summary_rows)
            total_pages = max(1, -(-total // page_size))
            start = (page - 1) * page_size
            paged = summary_rows[start : start + page_size]
            return Response({
                "results": [_sales_return_to_dict(ret) for ret in paged],
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "summary": summary,
            })

        return Response({
            "results": [_sales_return_to_dict(ret) for ret in summary_rows],
            "count": len(summary_rows),
            "page": 1,
            "page_size": len(summary_rows) or 1,
            "total_pages": 1,
            "summary": summary,
        })


class SalesReturnCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data
        header_errors = {}
        customer_id = d.get("customerId")
        sales_invoice_id = d.get("salesInvoiceId")
        if not customer_id and sales_invoice_id:
            invoice_for_customer = get_object_or_404(SalesInvoice.objects.select_related("customer"), id=sales_invoice_id)
            customer_id = invoice_for_customer.customer_id
        if not customer_id:
            header_errors["customerId"] = "customerId is required."
        if not d.get("warehouseId"):
            header_errors["warehouseId"] = "warehouseId is required."
        if not d.get("returnDate"):
            header_errors["returnDate"] = "returnDate is required."

        customer = None
        if customer_id:
            customer = get_object_or_404(Customer, id=customer_id, is_active=True)

        items_data = d.get("items") or []
        item_errors = _validate_return_items(items_data, customer_id=customer.id if customer else None)

        if header_errors or item_errors:
            return Response(
                {
                    "error": "; ".join(list(header_errors.values()) + item_errors),
                    "fieldErrors": header_errors,
                    "itemErrors": item_errors,
                },
                status=400,
            )

        warehouse = get_object_or_404(Warehouse, id=d.get("warehouseId"), is_active=True)
        source_invoice_ids = list(
            SalesInvoiceItem.objects.filter(
                id__in=[row.get("salesInvoiceItemId") for row in items_data if row.get("salesInvoiceItemId")]
            ).values_list("invoice_id", flat=True).distinct()
        )
        source_invoices = list(
            SalesInvoice.objects.select_related("financial_year").filter(id__in=source_invoice_ids).order_by("invoice_date", "id")
        )
        source_invoice = source_invoices[0] if len(source_invoices) == 1 else None
        if not source_invoices:
            return _err("Select at least one valid invoice line to return.")
        fy = (
            FinancialYear.objects.filter(id=d.get("financialYearId")).first()
            or (source_invoice.financial_year if source_invoice else source_invoices[0].financial_year)
            or FinancialYear.get_active()
        )
        sales_return = SalesReturn.objects.create(
            financial_year=fy,
            sales_invoice=source_invoice,
            customer=customer,
            warehouse=warehouse,
            return_number=_next_return_number(),
            return_date=d.get("returnDate"),
            reason=(d.get("reason") or "").strip(),
            notes=(d.get("notes") or "").strip(),
            status="draft",
            created_by=request.user,
        )
        _create_return_items(sales_return, items_data)

        requested_status = (d.get("status") or "draft").strip().lower()
        if requested_status == "confirmed":
            _post_sales_return_stock(sales_return, request.user)
            sales_return.status = "confirmed"
            sales_return.save(update_fields=["status", "updated_at"])
            if sales_return.customer:
                sales_return.customer.sync_outstanding()

        create_audit_log(
            user=request.user,
            action="create",
            resource=sales_return.return_number,
            resource_type="SalesReturn",
            request=request,
            details=f"Sales return {sales_return.return_number} created for {customer.display_name}",
            changes={
                "invoiceCount": len(source_invoice_ids),
                "totalAmount": float(sales_return.total_amount),
                "status": sales_return.status,
            },
        )
        sales_return.refresh_from_db()
        return Response(
            {
                "message": f"Sales return {sales_return.return_number} created.",
                **_sales_return_to_dict(sales_return, include_items=True),
            },
            status=201,
        )


class SalesReturnDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request, pk):
        sales_return = get_object_or_404(
            SalesReturn.objects.select_related(
                "sales_invoice", "customer", "warehouse", "created_by"
            ).prefetch_related("items__item", "items__sales_invoice_item__invoice"),
            id=pk,
        )
        return Response(_sales_return_to_dict(sales_return, include_items=True))


class SalesReturnConfirmView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def post(self, request, pk):
        sales_return = get_object_or_404(
            SalesReturn.objects.select_related("customer", "sales_invoice", "warehouse").prefetch_related("items__sales_invoice_item", "items__item"),
            id=pk,
        )
        if sales_return.status == "cancelled":
            return _err("Cancelled returns cannot be confirmed.")
        if sales_return.status == "confirmed" and sales_return.stock_posted:
            return Response({"message": f"{sales_return.return_number} is already confirmed."})

        item_errors = _validate_return_items(
            [
                {
                    "salesInvoiceItemId": i.sales_invoice_item_id,
                    "quantity": i.quantity,
                    "disposition": i.disposition,
                }
                for i in sales_return.items.all()
            ],
            exclude_return_id=sales_return.id,
            customer_id=sales_return.customer_id,
        )
        if item_errors:
            return Response({"error": "; ".join(item_errors), "itemErrors": item_errors}, status=400)

        _post_sales_return_stock(sales_return, request.user)
        sales_return.status = "confirmed"
        sales_return.save(update_fields=["status", "updated_at"])
        if sales_return.customer:
            sales_return.customer.sync_outstanding()
        return Response({"message": f"{sales_return.return_number} confirmed.", **_sales_return_to_dict(sales_return, include_items=True)})


class SalesReturnCancelView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    @transaction.atomic
    def put(self, request, pk):
        sales_return = get_object_or_404(
            SalesReturn.objects.select_related("customer", "warehouse").prefetch_related("items__item"),
            id=pk,
        )
        if sales_return.status == "cancelled":
            return _err("Sales return is already cancelled.")
        if sales_return.stock_posted:
            try:
                _reverse_sales_return_stock(sales_return, request.user)
            except ValueError as exc:
                return _err(str(exc))
        sales_return.status = "cancelled"
        sales_return.save(update_fields=["status", "updated_at"])
        if sales_return.customer:
            sales_return.customer.sync_outstanding()
        return Response({"message": f"{sales_return.return_number} cancelled."})


# ═══════════════════════════════════════════════════════════════════════════════
# PDF
# ═══════════════════════════════════════════════════════════════════════════════
# sales/views.py — ONLY the DownloadInvoicePDFView
# FIX: use SalesInvoicePDFGenerator from pdf_generator.py
# instead of duplicating inline reportlab code

class DownloadInvoicePDFView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request, pk):
        inv = get_object_or_404(
            SalesInvoice.objects
            .select_related("customer", "financial_year", "created_by")
            .prefetch_related("items__item", "payments"),
            id=pk,
        )
        try:
            from .pdf_generator import SalesInvoicePDFGenerator
            gen    = SalesInvoicePDFGenerator(inv)
            buffer = gen.generate()
            resp = FileResponse(buffer, content_type="application/pdf")
            filename = f'invoice_{inv.invoice_number}.pdf'
            if request.GET.get("download", "").strip().lower() == "true":
                resp["Content-Disposition"] = f'attachment; filename="{filename}"'
            else:
                resp["Content-Disposition"] = f'inline; filename="{filename}"'
            return resp
        except ImportError:
            return _err("reportlab is not installed. Run: pip install reportlab", 500)
        except Exception as e:
            logger.exception("PDF generation failed pk=%s", pk)
            return _err(f"PDF generation failed: {str(e)}", 500)
        

# ═══════════════════════════════════════════════════════════════════════════════
# STATS
# ═══════════════════════════════════════════════════════════════════════════════

class SalesStatsView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request):
        fy_id = request.GET.get("financialYearId", "").strip()
        qs = SalesInvoice.objects.exclude(status="cancelled")
        if fy_id:
            qs = qs.filter(financial_year_id=fy_id)

        today       = date.today()
        month_start = today.replace(day=1)

        invoices = list(qs.prefetch_related("returns"))
        agg = qs.aggregate(
            total_invoiced = Sum("total_amount"),
            total_paid     = Sum("paid_amount"),
            total_balance  = Sum("balance_amount"),
            unpaid_count   = Count("id", filter=Q(payment_status="unpaid")),
            partial_count  = Count("id", filter=Q(payment_status="partial")),
            paid_count     = Count("id", filter=Q(payment_status="paid")),
                )
        financials = [_invoice_financials(invoice) for invoice in invoices]
        net_invoiced_total = sum(float(item["net_total"]) for item in financials)
        adjusted_paid_total = sum(float(item["paid_amount"]) for item in financials)
        computed_balance = sum(float(item["balance_amount"]) for item in financials)
        unpaid_count = sum(1 for item in financials if item["payment_status"] == "unpaid")
        partial_count = sum(1 for item in financials if item["payment_status"] == "partial")
        paid_count = sum(1 for item in financials if item["payment_status"] == "paid")
        overdue_rows = [
            item
            for invoice, item in zip(invoices, financials)
            if invoice.due_date and invoice.due_date < today and float(item["balance_amount"]) > 0
        ]
        overdue_count = len(overdue_rows)
        overdue_amount = sum(float(item["balance_amount"]) for item in overdue_rows)
        monthly_revenue = sum(
            float(item["net_total"])
            for invoice, item in zip(invoices, financials)
            if invoice.invoice_date and invoice.invoice_date >= month_start
        )
        monthly_invoice_count = sum(
            1 for invoice in invoices if invoice.invoice_date and invoice.invoice_date >= month_start
        )
        top_customers = (
            qs.values("customer_name")
            .annotate(total=Sum("total_amount"), paid=Sum("paid_amount"), invoices=Count("id"))
            .order_by("-total")[:5]
        )
        monthly_trend = (
            qs.annotate(month=TruncMonth("invoice_date"))
            .values("month")
            .annotate(total=Sum("total_amount"), count=Count("id"))
            .order_by("month")
        )
        return Response({
            "summary": {
                "totalInvoiced":  float(net_invoiced_total),
                "totalPaid":      float(adjusted_paid_total),
                "totalBalance": float(computed_balance), 
                "unpaidCount":    unpaid_count,
                "partialCount":   partial_count,
                "paidCount":      paid_count,
                "overdueCount":   overdue_count,
                "overdueAmount":  float(overdue_amount),
                "monthlyRevenue": float(monthly_revenue),
                "monthlyInvoices":monthly_invoice_count,
            },
            "topCustomers": [
                {"name": r["customer_name"], "total": float(r["total"] or 0),
                 "paid": float(r["paid"] or 0), "invoices": r["invoices"]}
                for r in top_customers
            ],
            "monthlyTrend": [
                {"month": r["month"].strftime("%b %Y"), "total": float(r["total"] or 0),
                 "invoices": r["count"]}
                for r in monthly_trend
            ],
        })


# ═══════════════════════════════════════════════════════════════════════════════
# DROPDOWN HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

class CustomerListForBillingView(APIView):
    """GET /api/sales/customers/ — active customers only"""
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = CUSTOMER_ROLES

    def get(self, request):
        customers = Customer.objects.filter(is_active=True).order_by(
            "display_name", "company_name", "first_name", "last_name"
        )
        search = request.GET.get("search", "").strip()
        if search:
            customers = customers.filter(
                Q(display_name__icontains=search)
                | Q(company_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(phone__icontains=search)
                | Q(mobile__icontains=search)
            )
        limit = request.GET.get("limit")
        if limit and str(limit).isdigit():
            customers = customers[: min(int(limit), 500)]
        page_param = request.GET.get("page")
        page_size_param = request.GET.get("page_size")
        if page_param or page_size_param:
            try:
                page = int(page_param or 1)
                page_size = int(page_size_param or 20)
            except (ValueError, TypeError):
                page, page_size = 1, 20
            page = max(1, page)
            page_size = max(1, min(page_size, 200))
            total = customers.count()
            total_pages = max(1, -(-total // page_size))
            start = (page - 1) * page_size
            paged = customers[start : start + page_size]
            return Response({
                "results": [
                    {
                        "id":          c.id,
                        "name":        c.name,
                        "phone":       c.phone,
                        "email":       c.email or "",
                        "address":     c.billing_address_line1 or c.billing_address_line2 or "",
                        "gstin":       c.trn,
                        "outstanding": float(c.outstanding),
                        "creditLimit": float(c.credit_limit),
                        "paymentTerms": c.payment_terms,
                    }
                    for c in paged
                ],
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        return Response([
            {
                "id":          c.id,
                "name":        c.name,
                "phone":       c.phone,
                "email":       c.email or "",
                "address":     c.billing_address_line1 or c.billing_address_line2 or "",
                "gstin":       c.trn,
                "outstanding": float(c.outstanding),
                "creditLimit": float(c.credit_limit),
                "paymentTerms": c.payment_terms,
            }
            for c in customers
        ])


class AvailableAssetsView(APIView):
    """
    GET /api/sales/assets/
    Returns ONLY active assets that have available stock > 0.
    Includes selling_price (auto-fills unit price) and per-warehouse stock.
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = SALES_ROLES

    def get(self, request):
        assets = (
            Asset.objects
            .filter(status="active", item_type="goods", track_inventory=True)
            .prefetch_related("stock_entries__warehouse")
            .order_by("name")
        )
        search = request.GET.get("search", "").strip()
        if search:
            assets = assets.filter(
                Q(name__icontains=search) | Q(sku__icontains=search)
            )
        limit = request.GET.get("limit")
        if limit and str(limit).isdigit():
            assets = assets[: min(int(limit), 500)]

        page_param = request.GET.get("page")
        page_size_param = request.GET.get("page_size")
        if page_param or page_size_param:
            try:
                page = int(page_param or 1)
                page_size = int(page_size_param or 20)
            except (ValueError, TypeError):
                page, page_size = 1, 20
            page = max(1, page)
            page_size = max(1, min(page_size, 200))
            total = assets.count()
            total_pages = max(1, -(-total // page_size))
            start = (page - 1) * page_size
            assets = assets[start : start + page_size]

        result = []
        for a in assets:
            total_avail, warehouses = _get_asset_stock(a)
            if total_avail <= 0:
                continue  # skip assets with no stock
            batch_rows = list(_available_batch_queryset(a))
            next_batch = batch_rows[0] if batch_rows else None
            result.append({
                "id":             a.id,
                "name":           a.name,
                "code":           a.sku,
                "category":       a.get_item_type_display(),
                "assetType":      a.item_type,
                "batchNumber":    next_batch.batch_number if next_batch else "",
                "expiryDate":     str(next_batch.expiry_date) if next_batch and next_batch.expiry_date else None,
                "batches": [
                    {
                        "batchId": batch.id,
                        "batchNumber": batch.batch_number,
                        "expiryDate": str(batch.expiry_date) if batch.expiry_date else None,
                        "availableQty": int(batch.quantity_available or 0),
                        "warehouseId": batch.warehouse_id,
                        "warehouseName": batch.warehouse.name,
                    }
                    for batch in batch_rows
                ],
                # ↓ Auto-fill unit price with selling price
                "sellingPrice":   float(a.selling_price),
                "purchaseCost":   float(a.cost_price),
                # ↓ Stock info for display
                "availableStock": total_avail,
                "warehouses":     warehouses,
                "inStock":        True,
            })
        if page_param or page_size_param:
            return Response({
                "results": result,
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })
        return Response(result)
