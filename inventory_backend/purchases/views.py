# =============================================================================
# purchases/views.py — COMPLETE
# =============================================================================

import os
from calendar import monthrange
from decimal import Decimal, InvalidOperation
from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum, Count, Q, Value, DecimalField
from django.db.models.functions import TruncMonth
from django.db.models.functions import Coalesce
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from inventory_backend.api_errors import error_response
from inventory_backend.emailing import send_templated_email, money

from audit.utils import create_audit_log
from masters.models import (
    Supplier, Asset, Service, FinancialYear, Customer,
    PAYMENT_METHOD_CHOICES, PAYMENT_TERMS_CHOICES,
)
from users.permissions import HasAllowedRoles, OPERATIONS_ROLES
from .models import (
    PurchaseOrder, PurchaseOrderItem,
    PurchaseEntry, PurchaseEntryItem,
    PurchasePayment,
)


def _err(msg, code=400, errors=None):
    return error_response(msg, code=code, errors=errors)


def _next_po_number() -> str:
    year = date.today().year
    prefix = f"PO-{year}-"
    last = PurchaseOrder.objects.filter(po_number__startswith=prefix).order_by("-po_number").first()
    seq = (int(last.po_number.split("-")[-1]) + 1) if last else 1
    return f"{prefix}{seq:04d}"


def _next_pe_number() -> str:
    year = date.today().year
    prefix = f"PE-{year}-"
    last = PurchaseEntry.objects.filter(entry_number__startswith=prefix).order_by("-entry_number").first()
    seq = (int(last.entry_number.split("-")[-1]) + 1) if last else 1
    return f"{prefix}{seq:04d}"


def _supplier_name_q(value):
    return (
        Q(vendor__display_name__icontains=value)
        | Q(vendor__company_name__icontains=value)
        | Q(vendor__first_name__icontains=value)
        | Q(vendor__last_name__icontains=value)
    )


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


def _is_integral_decimal(value):
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return False
    return dec == dec.to_integral_value()


def _financial_year_from_payload(data):
    fy_id = data.get("financial_year") or data.get("financialYearId")
    if fy_id:
        return get_object_or_404(FinancialYear, id=fy_id)
    return FinancialYear.get_active()


def _send_po_email(order: PurchaseOrder):
    supplier = order.vendor
    if not supplier.email:
        raise ValueError("Supplier has no email address.")

    subject = f"Purchase Order {order.po_number}"
    send_templated_email(
        subject=subject,
        to=[supplier.email],
        template_name="purchase_order",
        context={
            "subject": subject,
            "preheader": f"Purchase order {order.po_number} for {money(order.total_amount)} is ready to review.",
            "title": "Purchase Order",
            "intro": f"Purchase order {order.po_number} has been prepared for {supplier.name}.",
            "supplier_name": supplier.name,
            "po_number": order.po_number,
            "order_date": str(order.order_date),
            "expected_date": str(order.expected_date) if order.expected_date else None,
            "reference_no": order.reference_no or None,
            "shipment_preference": order.shipment_preference or None,
            "payment_terms": dict(PAYMENT_TERMS_CHOICES).get(order.payment_terms, order.payment_terms),
            "delivery_address": order.delivery_address or None,
            "items": [
                {
                    "item_name": item.item_name,
                    "quantity": item.quantity,
                    "unit_price": money(item.unit_price),
                    "tax_rate": f"{float(item.tax_rate):.2f}".rstrip("0").rstrip("."),
                    "line_total": money(item.line_total),
                }
                for item in order.items.all()
            ],
            "subtotal": money(order.subtotal),
            "discount": money(order.disc_amount),
            "tax": money(order.tax_amount),
            "total": money(order.total_amount),
            "notes": order.notes or None,
        },
    )


def _billing_dict(supplier):
    return {
        "attention": supplier.billing_attention,
        "country": supplier.billing_country,
        "line1": supplier.billing_address_line1,
        "line2": supplier.billing_address_line2,
        "city": supplier.billing_city,
        "state": supplier.billing_state,
        "zip": supplier.billing_zip,
        "phone": supplier.billing_phone,
        "fax": supplier.billing_fax,
    }


def _shipping_dict(supplier):
    return {
        "attention": supplier.shipping_attention,
        "country": supplier.shipping_country,
        "line1": supplier.shipping_address_line1,
        "line2": supplier.shipping_address_line2,
        "city": supplier.shipping_city,
        "state": supplier.shipping_state,
        "zip": supplier.shipping_zip,
        "phone": supplier.shipping_phone,
        "fax": supplier.shipping_fax,
    }


# ─── Serialisers ──────────────────────────────────────────────────────────────

def _serialise_order(o, include_items=False):
    d = {
        "id": o.id, "poNumber": o.po_number,
        "referenceNo": o.reference_no,
        "orderDate": str(o.order_date),
        "expectedDate": str(o.expected_date) if o.expected_date else None,
        "financialYear": str(o.financial_year) if o.financial_year else None,
        "supplier": {"id": o.vendor_id, "name": o.vendor.name},
        "deliveryAddressType": o.delivery_address_type,
        "deliveryCustomerId": o.delivery_customer_id,
        "deliveryCustomer": (
            {"id": o.delivery_customer_id, "name": o.delivery_customer.name}
            if o.delivery_customer_id
            else None
        ),
        "deliveryAddress": o.delivery_address,
        "shipmentPreference": o.shipment_preference,
        "paymentTerms": o.payment_terms,
        "taxExclusive": bool(o.tax_exclusive),
        "taxLevel": o.tax_level,
        "subtotal": float(o.subtotal), "discAmount": float(o.disc_amount),
        "taxAmount": float(o.tax_amount), "totalAmount": float(o.total_amount),
        "status": o.status,
        "statusDisplay": dict(PurchaseOrder.STATUS_CHOICES).get(o.status, o.status),
        "approvedBy": o.approved_by.name if o.approved_by else None,
        "approvedAt": o.approved_at.isoformat() if o.approved_at else None,
        "notes": o.notes,
        "createdBy": o.created_by.name if o.created_by else "System",
        "createdAt": o.created_at.isoformat(),
        "updatedAt": o.updated_at.isoformat() if getattr(o, "updated_at", None) else o.created_at.isoformat(),
    }
    if include_items:
        d["items"] = [_serialise_order_item(i) for i in o.items.select_related("item").all()]
    return d


def _serialise_order_item(i):
    return {
        "id": i.id, "itemName": i.item_name,
        "assetId": i.item_id,
        "assetCode": i.item.asset_code if i.item else None,
        "category": i.item.get_item_type_display() if i.item else None,
        "purchasePrice": float(i.item.purchase_cost) if i.item else 0,
        "purchaseCost": float(i.item.purchase_cost) if i.item else 0,
        "quantity": float(i.quantity), "unitPrice": float(i.unit_price),
        "discount": float(i.discount), "taxRate": float(i.tax_rate),
        "subtotal": float(i.subtotal), "discAmount": float(i.disc_amount),
        "taxAmount": float(i.tax_amount), "lineTotal": float(i.line_total),
        "account": i.account,
        "batchNumber": i.batch_number,
        "expiryDate": str(i.expiry_date) if i.expiry_date else None,
        "notes": i.notes,
    }


def _serialise_entry(e, include_items=False, include_payments=False):
    paid_amount = getattr(e, "paid_amount_actual", None)
    if paid_amount is None:
        paid_amount = e.payments.aggregate(
            total=Coalesce(
                Sum("amount"),
                Value(Decimal("0.00")),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )["total"]
    total_amount = Decimal(str(e.total_amount or 0))
    paid_amount = Decimal(str(paid_amount or 0))
    balance_amount = max(total_amount - paid_amount, Decimal("0.00"))
    if paid_amount <= 0:
        payment_status = "unpaid"
    elif paid_amount >= total_amount:
        payment_status = "paid"
    else:
        payment_status = "partial"

    d = {
        "id": e.id, "entryNumber": e.entry_number,
        "supplierInvoiceNo": e.vendor_invoice_no,
        "invoiceDate": str(e.invoice_date),
        "dueDate": str(e.due_date) if e.due_date else None,
        "financialYear": str(e.financial_year) if e.financial_year else None,
        "supplier": {"id": e.vendor_id, "name": e.vendor.name},
        "purchaseOrderId": e.purchase_order_id,
        "purchaseOrderNo": e.purchase_order.po_number if e.purchase_order else None,
        "subtotal": float(e.subtotal), "discAmount": float(e.disc_amount),
        "taxAmount": float(e.tax_amount), "totalAmount": float(e.total_amount),
        "paidAmount": float(paid_amount), "balanceAmount": float(balance_amount),
        "paymentStatus": payment_status,
        "paymentStatusDisplay": dict(PurchaseEntry.PAYMENT_STATUS_CHOICES).get(payment_status, payment_status),
        "isReceived": getattr(e, "is_received", False),
        "receivedAt": e.received_at.isoformat() if getattr(e, "received_at", None) else None,
        "receivedBy": e.received_by.name if getattr(e, "received_by", None) else None,
        "hasInvoiceFile": bool(e.invoice_file),
        "notes": e.notes,
        "createdBy": e.created_by.name if e.created_by else "System",
        "createdAt": e.created_at.isoformat(),
        "updatedAt": e.updated_at.isoformat() if getattr(e, "updated_at", None) else e.created_at.isoformat(),
    }
    if include_items:
        po_item_lookup = {}
        if getattr(e, "purchase_order_id", None):
            po_item_lookup = {
                (po_item.item_id, (po_item.item_name or "").strip().lower()): po_item
                for po_item in e.purchase_order.items.all()
            }
        d["items"] = [
            _serialise_entry_item(
                i,
                fallback_po_item=po_item_lookup.get(
                    (i.item_id, (i.item_name or "").strip().lower())
                ),
            )
            for i in e.items.select_related("item").all()
        ]
    if include_payments:
        d["payments"] = [
            {
                "id": p.id, "paymentDate": str(p.payment_date),
                "amount": float(p.amount), "paymentMethod": p.payment_method,
                "referenceNo": p.reference_no, "notes": p.notes,
                "createdAt": p.created_at.isoformat(),
            }
            for p in e.payments.all()
        ]
    return d


def _serialise_entry_item(i, fallback_po_item=None):
    batch_number = i.batch_number
    expiry_date = i.expiry_date
    if fallback_po_item:
        batch_number = batch_number or fallback_po_item.batch_number
        expiry_date = expiry_date or fallback_po_item.expiry_date
    batch_lines = [
        {
            "batchId": batch.id,
            "batchNumber": batch.batch_number,
            "expiryDate": str(batch.expiry_date) if batch.expiry_date else None,
            "receivedQty": batch.quantity_received,
            "availableQty": batch.quantity_available,
            "warehouseId": batch.warehouse_id,
            "warehouseName": batch.warehouse.name if batch.warehouse_id else "",
        }
        for batch in i.stock_batches.select_related("warehouse").all()
    ]
    return {
        "id": i.id, "itemName": i.item_name,
        "assetId": i.item_id, "serviceId": None,
        "assetCode": i.item.asset_code if i.item else None,
        "account": i.item.purchase_account if i.item else "",
        "batchNumber": batch_number,
        "expiryDate": str(expiry_date) if expiry_date else None,
        "quantity": float(i.quantity), "unitPrice": float(i.unit_price),
        "discount": float(i.discount), "taxRate": float(i.tax_rate),
        "subtotal": float(i.subtotal), "discAmount": float(i.disc_amount),
        "taxAmount": float(i.tax_amount), "lineTotal": float(i.line_total),
        "batchLines": batch_lines,
        "notes": i.notes,
    }


# ─── Validation ───────────────────────────────────────────────────────────────

def _validate_po_items(items_data):
    errors = []
    if not items_data:
        errors.append("At least one asset line item is required.")
        return errors
    seen = []
    for idx, item in enumerate(items_data):
        row = idx + 1
        if not item.get("assetId"):
            errors.append(f"Row {row}: assetId is required. Purchase Orders only accept assets.")
            continue
        try:
            asset_id = int(item["assetId"])
        except (TypeError, ValueError):
            errors.append(f"Row {row}: assetId must be an integer.")
            continue
        try:
            asset = Asset.objects.get(id=asset_id, status="active")
        except Asset.DoesNotExist:
            errors.append(f"Row {row}: Asset id={asset_id} not found or inactive.")
            continue
        if asset_id in seen:
            errors.append(f"Row {row}: Asset '{asset.name}' appears more than once.")
        seen.append(asset_id)
        try:
            qty = Decimal(str(item.get("quantity", 1)))
            if qty <= 0:
                errors.append(f"Row {row} ({asset.name}): quantity must be > 0.")
            elif qty != qty.to_integral_value():
                errors.append(f"Row {row} ({asset.name}): quantity must be a whole number.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row} ({asset.name}): quantity must be a number.")
        try:
            if Decimal(str(item.get("unitPrice", 0))) < 0:
                errors.append(f"Row {row} ({asset.name}): unitPrice cannot be negative.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row} ({asset.name}): unitPrice must be a number.")
        for field, label in [("discount", "Discount"), ("taxRate", "Tax rate")]:
            try:
                v = Decimal(str(item.get(field, 0)))
                if not (0 <= v <= 100):
                    errors.append(f"Row {row} ({asset.name}): {label} must be 0–100.")
                elif field in ("discount", "taxRate") and v != v.to_integral_value():
                    errors.append(f"Row {row} ({asset.name}): {label} must be a whole number.")
            except (InvalidOperation, TypeError):
                errors.append(f"Row {row} ({asset.name}): {label} must be a number.")
    return errors


def _validate_entry_items(items_data):
    errors = []
    if not items_data:
        errors.append("At least one line item is required.")
        return errors
    for idx, item in enumerate(items_data):
        row = idx + 1
        has_asset   = bool(item.get("assetId"))
        has_service = bool(item.get("serviceId"))
        has_name    = bool((item.get("itemName") or "").strip())
        asset_obj = None
        if has_asset and has_service:
            errors.append(f"Row {row}: choose either asset or service, not both.")
            continue
        if not has_asset and not has_service and not has_name:
            errors.append(f"Row {row}: must have an asset, service, or item name.")
            continue
        if has_asset:
            try:
                asset_obj = Asset.objects.filter(id=int(item["assetId"]), status="active").first()
                if not asset_obj:
                    errors.append(f"Row {row}: Asset id={item['assetId']} not found or inactive.")
            except (TypeError, ValueError):
                errors.append(f"Row {row}: assetId must be an integer.")
        if has_service:
            try:
                if not Service.objects.filter(id=int(item["serviceId"]), status="active", item_type="service").exists():
                    errors.append(f"Row {row}: Service id={item['serviceId']} not found or inactive.")
            except (TypeError, ValueError):
                errors.append(f"Row {row}: serviceId must be an integer.")
        try:
            qty = Decimal(str(item.get("quantity", 1)))
            if qty <= 0:
                errors.append(f"Row {row}: quantity must be > 0.")
            elif qty != qty.to_integral_value():
                errors.append(f"Row {row}: quantity must be a whole number.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: quantity must be a number.")
        try:
            if Decimal(str(item.get("unitPrice", 0))) < 0:
                errors.append(f"Row {row}: unitPrice cannot be negative.")
        except (InvalidOperation, TypeError):
            errors.append(f"Row {row}: unitPrice must be a number.")
        for field, label in [("discount", "Discount"), ("taxRate", "Tax rate")]:
            try:
                v = Decimal(str(item.get(field, 0)))
                if not (0 <= v <= 100):
                    errors.append(f"Row {row}: {label} must be 0–100.")
                elif field in ("discount", "taxRate") and v != v.to_integral_value():
                    errors.append(f"Row {row}: {label} must be a whole number.")
            except (InvalidOperation, TypeError):
                errors.append(f"Row {row}: {label} must be a number.")
        if has_asset and asset_obj and getattr(asset_obj, "track_inventory", False):
            if not (item.get("batchNumber") or "").strip():
                errors.append(f"Row {row} ({asset_obj.name}): batch number is required.")
            expiry_date = _parse_date(item.get("expiryDate"))
            if not expiry_date:
                errors.append(f"Row {row} ({asset_obj.name}): expiry date is required.")
    return errors


# ─── Item builders ────────────────────────────────────────────────────────────

def _create_items_for_order(order, items_data):
    for item in items_data:
        asset = get_object_or_404(Asset, id=item["assetId"])
        item_name = (item.get("itemName") or "").strip() or asset.name
        raw = item.get("unitPrice")
        unit_price = (
            asset.purchase_cost
            if raw is None or Decimal(str(raw)) == 0
            else Decimal(str(raw))
        )
        account = (item.get("account") or "").strip() or asset.purchase_account
        batch_number = (item.get("batchNumber") or "").strip()
        expiry_date = _parse_date(item.get("expiryDate"))
        PurchaseOrderItem.objects.create(
            order=order, item=asset, item_name=item_name,
            quantity=Decimal(str(item.get("quantity", 1))),
            unit_price=unit_price,
            discount=Decimal(str(item.get("discount", 0))),
            tax_rate=Decimal(str(item.get("taxRate", 0))),
            account=account,
            batch_number=batch_number,
            expiry_date=expiry_date,
            notes=(item.get("notes") or "").strip(),
        )


def _create_items_for_entry(entry, items_data):
    """Creates entry items. Stock NOT updated here — only via ReceiveView."""
    po_lookup = {}
    if entry.purchase_order_id:
        po_lookup = {
            (po_item.item_id, (po_item.item_name or "").strip().lower()): po_item
            for po_item in entry.purchase_order.items.all()
        }

    for item in items_data:
        item_obj = None
        item_name = (item.get("itemName") or "").strip()
        unit_price = Decimal(str(item.get("unitPrice", 0)))
        if item.get("assetId"):
            item_obj = get_object_or_404(Asset, id=item["assetId"])
            item_name = item_name or item_obj.name
            if unit_price == 0:
                unit_price = item_obj.purchase_cost
        elif item.get("serviceId"):
            item_obj = get_object_or_404(Service, id=item["serviceId"])
            item_name = item_name or item_obj.name
            if unit_price == 0:
                unit_price = item_obj.purchase_cost
        po_item = po_lookup.get((getattr(item_obj, "id", None), item_name.lower()))
        quantity = Decimal(str(item.get("quantity", 1)))
        discount = Decimal(str(item.get("discount", 0)))
        tax_rate = Decimal(str(item.get("taxRate", 0)))
        if po_item:
            item_obj = po_item.item or item_obj
            item_name = po_item.item_name or item_name
            quantity = po_item.quantity
            unit_price = po_item.unit_price
            discount = po_item.discount
            tax_rate = po_item.tax_rate
        PurchaseEntryItem.objects.create(
            entry=entry, item=item_obj,
            item_name=item_name,
            quantity=quantity,
            unit_price=unit_price,
            discount=discount,
            tax_rate=tax_rate,
            batch_number=(item.get("batchNumber") or "").strip(),
            expiry_date=_parse_date(item.get("expiryDate")),
            notes=(item.get("notes") or "").strip(),
        )


# =============================================================================
# PURCHASE ORDER VIEWS
# =============================================================================

class PurchaseOrderListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        qs = PurchaseOrder.objects.select_related(
            "vendor", "financial_year", "approved_by", "created_by"
        ).all()
        if (v := request.GET.get("financialYearId")): qs = qs.filter(financial_year_id=v)
        if (v := request.GET.get("status")): qs = qs.filter(status=v)
        if (v := request.GET.get("supplierId")): qs = qs.filter(vendor_id=v)
        if (v := request.GET.get("search")):
            qs = qs.filter(Q(po_number__icontains=v) | _supplier_name_q(v))

        include_items = request.GET.get("include_items", "").lower() == "true"
        if include_items:
            qs = qs.prefetch_related("items__item")

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
            paged = qs.order_by("-order_date", "-created_at")[start : start + page_size]
            return Response({
                "results": [_serialise_order(o, include_items=include_items) for o in paged],
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        return Response([_serialise_order(o, include_items=include_items) for o in qs])


class PurchaseOrderCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data
        he = {}
        if not d.get("supplierId"): he["supplierId"] = "supplierId is required."
        if not d.get("orderDate"):  he["orderDate"]  = "orderDate is required."
        items_data = d.get("items") or []
        ie = _validate_po_items(items_data)
        if he or ie:
            return Response({"error": "; ".join(list(he.values()) + ie), "fieldErrors": he, "itemErrors": ie}, status=400)
        fy = _financial_year_from_payload(d)
        if not fy:
            return _err("No active financial year.")
        supplier = get_object_or_404(Supplier, id=d["supplierId"])
        if not supplier.is_active:
            return _err(f"Supplier '{supplier.name}' is inactive.")
        delivery_address_type = d.get("deliveryAddressType") or "organization"
        if delivery_address_type not in ("organization", "customer"):
            he["deliveryAddressType"] = "Invalid delivery address type."
        delivery_customer = None
        if delivery_address_type == "customer":
            customer_id = d.get("deliveryCustomerId")
            if not customer_id:
                he["deliveryCustomerId"] = "deliveryCustomerId is required."
            else:
                delivery_customer = get_object_or_404(Customer, id=customer_id)
        tax_level = d.get("taxLevel") or "item"
        if tax_level not in ("item", "transaction"):
            he["taxLevel"] = "Invalid tax level."
        payment_terms = d.get("paymentTerms") or supplier.payment_terms or "net_30"
        if payment_terms not in dict(PAYMENT_TERMS_CHOICES):
            he["paymentTerms"] = "Invalid payment terms."
        send_email = bool(d.get("sendEmail"))
        if send_email and not supplier.email:
            he["sendEmail"] = "Supplier email is required to send."
        if he:
            return Response({"error": "; ".join(list(he.values()) + ie), "fieldErrors": he, "itemErrors": ie}, status=400)
        status = "submitted" if d.get("submit") else "draft"
        order = PurchaseOrder.objects.create(
            financial_year=fy, vendor=supplier, po_number=_next_po_number(),
            order_date=d["orderDate"], expected_date=d.get("expectedDate") or None,
            reference_no=(d.get("referenceNo") or "").strip(),
            delivery_address_type=delivery_address_type,
            delivery_customer=delivery_customer,
            delivery_address=(d.get("deliveryAddress") or "").strip(),
            shipment_preference=(d.get("shipmentPreference") or "").strip(),
            payment_terms=payment_terms,
            tax_exclusive=bool(d.get("taxExclusive", True)),
            tax_level=tax_level,
            status=status,
            notes=(d.get("notes") or "").strip(),
            created_by=request.user,
        )
        _create_items_for_order(order, items_data)
        order.refresh_from_db()
        email_sent = False
        email_error = None
        if send_email:
            try:
                _send_po_email(order)
                email_sent = True
            except Exception as exc:
                email_error = str(exc)
        create_audit_log(user=request.user, action="create", resource=order.po_number,
                         resource_type="PurchaseOrder", request=request,
                         details=f"PO {order.po_number} created", changes={"supplier": supplier.name})
        message = "Purchase order created and sent." if email_sent else "Purchase order created."
        if send_email and not email_sent:
            message = (
                "Purchase order created, but email could not be sent. "
                "Please review the mail configuration and try sending again."
            )
        return Response({
            "message": message,
            "poNumber": order.po_number,
            "orderId": order.id,
            "totalAmount": float(order.total_amount),
            "emailSent": email_sent,
            "emailError": email_error,
        }, status=201)


class PurchaseOrderDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, order_id):
        o = get_object_or_404(
            PurchaseOrder.objects.select_related("vendor", "financial_year", "approved_by", "created_by")
            .prefetch_related("items__item"), id=order_id)
        return Response(_serialise_order(o, include_items=True))

    @transaction.atomic
    def put(self, request, order_id):
        o = get_object_or_404(PurchaseOrder, id=order_id)
        d = request.data
        if o.status not in ("draft", "submitted"):
            return _err(f"Cannot edit PO with status '{o.status}'.")
        he = {}
        if "supplierId" in d and not d["supplierId"]: he["supplierId"] = "Cannot be empty."
        if "orderDate"  in d and not d["orderDate"]:  he["orderDate"]  = "Cannot be empty."
        if "deliveryAddressType" in d and d["deliveryAddressType"] not in ("organization", "customer"):
            he["deliveryAddressType"] = "Invalid delivery address type."
        if "taxLevel" in d and d["taxLevel"] not in ("item", "transaction"):
            he["taxLevel"] = "Invalid tax level."
        if "paymentTerms" in d and d["paymentTerms"] not in dict(PAYMENT_TERMS_CHOICES):
            he["paymentTerms"] = "Invalid payment terms."
        items_data = d.get("items")
        ie = _validate_po_items(items_data) if items_data is not None else []
        if he or ie:
            return Response({"error": "; ".join(list(he.values()) + ie), "fieldErrors": he, "itemErrors": ie}, status=400)
        if "supplierId" in d:
            sup = get_object_or_404(Supplier, id=d["supplierId"])
            if not sup.is_active: return _err(f"Supplier '{sup.name}' is inactive.")
            o.vendor = sup
            if "paymentTerms" not in d and sup.payment_terms:
                o.payment_terms = sup.payment_terms
        if "referenceNo" in d:
            o.reference_no = (d.get("referenceNo") or "").strip()
        o.order_date    = d.get("orderDate",    o.order_date)
        o.expected_date = d.get("expectedDate", o.expected_date) or None
        if "deliveryAddressType" in d:
            o.delivery_address_type = d.get("deliveryAddressType") or "organization"
            if o.delivery_address_type == "customer":
                customer_id = d.get("deliveryCustomerId")
                if not customer_id:
                    return _err("deliveryCustomerId is required when deliveryAddressType=customer")
                o.delivery_customer = get_object_or_404(Customer, id=customer_id)
            else:
                o.delivery_customer = None
        elif "deliveryCustomerId" in d and d.get("deliveryCustomerId"):
            o.delivery_customer = get_object_or_404(Customer, id=d.get("deliveryCustomerId"))
        if "deliveryAddress" in d:
            o.delivery_address = (d.get("deliveryAddress") or "").strip()
        if "shipmentPreference" in d:
            o.shipment_preference = (d.get("shipmentPreference") or "").strip()
        if "paymentTerms" in d:
            o.payment_terms = d.get("paymentTerms") or o.payment_terms
        if "taxExclusive" in d:
            o.tax_exclusive = bool(d.get("taxExclusive"))
        if "taxLevel" in d:
            o.tax_level = d.get("taxLevel") or o.tax_level
        o.notes         = (d.get("notes", o.notes) or "").strip()
        if d.get("submit") and o.status == "draft":
            o.status = "submitted"
        o.save()
        if items_data is not None:
            o.items.all().delete()
            _create_items_for_order(o, items_data)
        o.refresh_from_db()
        email_sent = False
        email_error = None
        if d.get("sendEmail"):
            if not o.vendor.email:
                return _err("Supplier email is required to send.")
            try:
                _send_po_email(o)
                email_sent = True
            except Exception as exc:
                email_error = str(exc)
        message = "Purchase order updated and sent." if email_sent else "Purchase order updated."
        if d.get("sendEmail") and not email_sent:
            message = (
                "Purchase order updated, but email could not be sent. "
                "Please review the mail configuration and try sending again."
            )
        return Response({
            "message": message,
            "emailSent": email_sent,
            "emailError": email_error,
            **_serialise_order(o, include_items=True),
        })


class PurchaseOrderApproveView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def put(self, request, order_id):
        o = get_object_or_404(PurchaseOrder, id=order_id)
        if o.status == "approved":
            return Response({"message": "Already approved.", **_serialise_order(o)})
        if o.status not in ("draft", "submitted"):
            return _err(f"Cannot approve PO with status '{o.status}'.")
        if not o.items.exists():
            return _err("Cannot approve an empty Purchase Order.")
        o.status = "approved"; o.approved_by = request.user; o.approved_at = timezone.now()
        o.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        create_audit_log(user=request.user, action="approve", resource=o.po_number,
                         resource_type="PurchaseOrder", request=request,
                         details=f"PO {o.po_number} approved", changes={})
        return Response({"message": f"PO {o.po_number} approved. Now go to Purchase Entries → create entry → Receive Package to update stock.", **_serialise_order(o)})


class PurchaseOrderCancelView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def put(self, request, order_id):
        o = get_object_or_404(PurchaseOrder, id=order_id)
        if o.status == "cancelled": return _err("Already cancelled.")
        if o.status == "received":  return _err("Cannot cancel a fully received PO.")
        o.status = "cancelled"
        o.save(update_fields=["status", "updated_at"])
        return Response({"message": f"PO {o.po_number} cancelled."})


# =============================================================================
# PURCHASE ENTRY VIEWS
# =============================================================================

class PurchaseEntryListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        qs = PurchaseEntry.objects.select_related(
            "vendor", "financial_year", "purchase_order", "created_by", "received_by"
        ).annotate(
            paid_amount_actual=Coalesce(
                Sum("payments__amount"),
                Value(Decimal("0.00")),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        ).all()
        if (v := request.GET.get("financialYearId")): qs = qs.filter(financial_year_id=v)
        if (v := request.GET.get("paymentStatus")): qs = qs.filter(payment_status=v)
        if (v := request.GET.get("supplierId")):     qs = qs.filter(vendor_id=v)
        if (v := request.GET.get("isReceived")):     qs = qs.filter(is_received=(v.lower() == "true"))
        if (v := request.GET.get("dateFrom")):       qs = qs.filter(invoice_date__gte=v)
        if (v := request.GET.get("dateTo")):         qs = qs.filter(invoice_date__lte=v)
        if (v := request.GET.get("search")):
            qs = qs.filter(Q(entry_number__icontains=v) | Q(vendor_invoice_no__icontains=v) | _supplier_name_q(v))

        include_items = request.GET.get("include_items", "").lower() == "true"
        include_payments = request.GET.get("include_payments", "").lower() == "true"
        if include_items or include_payments:
            qs = qs.prefetch_related("items__item", "payments")
            if include_items:
                qs = qs.prefetch_related("items__stock_batches__warehouse")

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
                "results": [
                    _serialise_entry(e, include_items=include_items, include_payments=include_payments)
                    for e in paged
                ],
                "count": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        return Response([
            _serialise_entry(e, include_items=include_items, include_payments=include_payments)
            for e in qs
        ])


class PurchaseEntryCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data
        he = {}
        if not d.get("supplierId"):  he["supplierId"]  = "supplierId is required."
        if not d.get("invoiceDate"): he["invoiceDate"] = "invoiceDate is required."
        items_data = d.get("items") or []
        ie = _validate_entry_items(items_data)
        if he or ie:
            return Response({"error": "; ".join(list(he.values()) + ie), "fieldErrors": he, "itemErrors": ie}, status=400)
        fy = _financial_year_from_payload(d)
        if not fy: return _err("No active financial year.")
        supplier = get_object_or_404(Supplier, id=d["supplierId"])
        if not supplier.is_active: return _err(f"Supplier '{supplier.name}' is inactive.")
        po = None
        if d.get("purchaseOrderId"):
            po = get_object_or_404(PurchaseOrder, id=d["purchaseOrderId"])
            if po.status not in ("approved", "partial"):
                return _err(f"PO {po.po_number} status '{po.status}'. Must be approved.")
            if po.vendor_id != supplier.id:
                return _err(f"PO {po.po_number} belongs to '{po.vendor.name}', not '{supplier.name}'.")
        resolved_due_date = (
            d.get("dueDate")
            or _calculate_due_date(
                d["invoiceDate"],
                po.payment_terms if po else supplier.payment_terms,
            )
            or None
        )
        entry = PurchaseEntry.objects.create(
            financial_year=fy, vendor=supplier, purchase_order=po,
            entry_number=_next_pe_number(),
            vendor_invoice_no=(d.get("supplierInvoiceNo") or "").strip(),
            invoice_date=d["invoiceDate"], due_date=resolved_due_date,
            notes=(d.get("notes") or "").strip(), created_by=request.user,
        )
        _create_items_for_entry(entry, items_data)
        entry.refresh_from_db()
        create_audit_log(user=request.user, action="create", resource=entry.entry_number,
                         resource_type="PurchaseEntry", request=request,
                         details=f"Entry {entry.entry_number} created",
                         changes={"supplier": supplier.name, "totalAmount": float(entry.total_amount)})
        return Response({
            "message":     "Purchase entry created. Click 'Receive Package' to update stock.",
            "entryId":     entry.id,
            "entryNumber": entry.entry_number,
            "totalAmount": float(entry.total_amount),
        }, status=201)


class PurchaseEntryDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, entry_id):
        e = get_object_or_404(
            PurchaseEntry.objects
            .select_related("vendor", "financial_year", "purchase_order", "created_by", "received_by")
            .annotate(
                paid_amount_actual=Coalesce(
                    Sum("payments__amount"),
                    Value(Decimal("0.00")),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                )
            )
            .prefetch_related("items__item", "items__stock_batches__warehouse", "payments"),
            id=entry_id)
        return Response(_serialise_entry(e, include_items=True, include_payments=True))

    @transaction.atomic
    def put(self, request, entry_id):
        e = get_object_or_404(PurchaseEntry, id=entry_id)
        d = request.data
        if e.payment_status == "paid":
            return _err("Cannot edit a fully paid entry.")
        if getattr(e, "is_received", False):
            return _err("Cannot edit a received entry. Adjust stock via Stock Management.")
        he = {}
        if "supplierId" in d and not d["supplierId"]: he["supplierId"] = "Cannot be empty."
        if "invoiceDate" in d and not d["invoiceDate"]: he["invoiceDate"] = "Cannot be empty."
        items_data = d.get("items")
        ie = _validate_entry_items(items_data) if items_data is not None else []
        if he or ie:
            return Response({"error": "; ".join(list(he.values()) + ie), "fieldErrors": he, "itemErrors": ie}, status=400)
        if "supplierId" in d:
            sup = get_object_or_404(Supplier, id=d["supplierId"])
            if not sup.is_active: return _err(f"Supplier '{sup.name}' is inactive.")
            e.vendor = sup
        if "purchaseOrderId" in d:
            po = None
            if d.get("purchaseOrderId"):
                po = get_object_or_404(PurchaseOrder, id=d["purchaseOrderId"])
                if po.status not in ("approved", "partial"):
                    return _err(f"PO {po.po_number} status '{po.status}'. Must be approved.")
                if po.vendor_id != e.vendor_id:
                    return _err(f"PO {po.po_number} belongs to '{po.vendor.name}', not '{e.vendor.name}'.")
            e.purchase_order = po
        e.vendor_invoice_no = (d.get("supplierInvoiceNo", e.vendor_invoice_no) or "").strip()
        e.invoice_date = d.get("invoiceDate", e.invoice_date)
        if "dueDate" in d:
            e.due_date = (
                d.get("dueDate")
                or _calculate_due_date(
                    e.invoice_date,
                    e.purchase_order.payment_terms if e.purchase_order else e.vendor.payment_terms,
                )
                or None
            )
        e.notes = (d.get("notes", e.notes) or "").strip()
        e.save()
        if items_data is not None:
            e.items.all().delete()
            _create_items_for_entry(e, items_data)
        e.refresh_from_db()
        return Response({"message": "Purchase entry updated.", **_serialise_entry(e, include_items=True)})


class PurchaseEntryDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def delete(self, request, entry_id):
        e = get_object_or_404(PurchaseEntry, id=entry_id)
        if float(e.paid_amount) > 0:
            return _err("Cannot delete an entry with payments. Delete payments first.")
        if getattr(e, "is_received", False):
            return _err("Cannot delete a received entry. Adjust stock first via Stock Management.")
        number = e.entry_number
        e.delete()
        return Response({"message": f"Purchase entry {number} deleted."})


# =============================================================================
# RECEIVE PACKAGE  ★ The stock-update endpoint ★
# =============================================================================

class PurchaseEntryReceiveView(APIView):
    """
    POST /api/purchases/entries/<entry_id>/receive/

    Marks goods as physically received and updates warehouse stock.
    One-time action — idempotency guard prevents double-receive.
    Optional body: { "warehouseId": <int> }
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def post(self, request, entry_id):
        from stock.models import Warehouse

        e = get_object_or_404(
            PurchaseEntry.objects
            .select_related("purchase_order", "vendor")
            .prefetch_related("items__item"),
            id=entry_id,
        )

        if getattr(e, "is_received", False):
            return Response({
                "message":    "Already received — stock was updated previously.",
                "isReceived": True,
                "receivedAt": e.received_at.isoformat() if e.received_at else None,
                "receivedBy": e.received_by.name if e.received_by else None,
            })

        wh_id = request.data.get("warehouseId")
        if wh_id:
            wh = get_object_or_404(Warehouse, id=wh_id, is_active=True)
        else:
            wh = Warehouse.objects.filter(is_active=True).first()
        if not wh:
            return _err("No active warehouse found. Create one in Stock Management first.")

        received_count = 0
        stock_summary  = []
        receive_errors = []

        for item in e.items.all():
            if not item.item or not getattr(item.item, "track_inventory", False):
                continue
            if not (item.batch_number or "").strip():
                receive_errors.append(
                    f"Item '{item.item.name}' is missing a batch number in purchase entry {e.entry_number}."
                )
            if not item.expiry_date:
                receive_errors.append(
                    f"Item '{item.item.name}' is missing an expiry date in purchase entry {e.entry_number}."
                )

        if receive_errors:
            return _err("Please complete batch number and expiry date for all stock items before receiving.", errors=receive_errors)

        for item in e.items.all():
            receipt_summary = item._record_stock_receipt(wh, request.user)
            if not receipt_summary:
                continue
            received_count += 1
            stock_summary.append(receipt_summary)

        fields = ["updated_at"]
        if hasattr(e, "is_received"):
            e.is_received = True
            e.received_at = timezone.now()
            e.received_by = request.user
            fields += ["is_received", "received_at", "received_by"]
        e.save(update_fields=fields)

        po = e.purchase_order
        if po:
            total    = po.entries.count()
            received = po.entries.filter(is_received=True).count()
            po.status = "received" if received >= total else "partial"
            po.save(update_fields=["status", "updated_at"])

        create_audit_log(
            user=request.user, action="receive", resource=e.entry_number,
            resource_type="PurchaseEntry", request=request,
            details=f"{e.entry_number} received at '{wh.name}'. {received_count} asset type(s) → stock.",
            changes={"entryId": e.id, "warehouse": wh.name, "assetTypes": received_count},
        )
        return Response({
            "message":            f"✅ Received! {received_count} asset type(s) added to stock in '{wh.name}'.",
            "isReceived":         True,
            "warehouse":          {"id": wh.id, "name": wh.name},
            "assetItemsReceived": received_count,
            "stockSummary":       stock_summary,
        })


# =============================================================================
# INVOICE FILE
# =============================================================================

ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg"}
ALLOWED_EXTS  = {".pdf", ".png", ".jpg", ".jpeg"}


class UploadEntryInvoiceView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def put(self, request, entry_id):
        e    = get_object_or_404(PurchaseEntry, id=entry_id)
        file = request.FILES.get("invoice_file")
        if not file: return _err("No file provided.")
        ext = os.path.splitext(file.name)[1].lower()
        if file.content_type not in ALLOWED_TYPES or ext not in ALLOWED_EXTS:
            return _err("Invalid file. Allowed: PDF, PNG, JPG.")
        if file.size > 10 * 1024 * 1024: return _err("Max 10 MB.")
        if e.invoice_file:
            try:
                old = e.invoice_file.path
                if os.path.exists(old): os.remove(old)
            except Exception:
                pass
        e.invoice_file = file
        e.save(update_fields=["invoice_file", "updated_at"])
        return Response({"message": "Invoice uploaded.", "hasInvoiceFile": True})


class DownloadEntryInvoiceView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, entry_id):
        e = get_object_or_404(PurchaseEntry, id=entry_id)
        if not e.invoice_file: return _err("No invoice file.", 404)
        path = e.invoice_file.path
        if not os.path.exists(path): return _err("File not found on server.", 404)
        ext = os.path.splitext(path)[1].lower()
        ct  = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "application/octet-stream")
        disposition = "attachment" if request.GET.get("download") == "true" else "inline"
        try:
            fh = open(path, "rb")
            r  = FileResponse(fh, content_type=ct)
            r["Content-Disposition"]           = f'{disposition}; filename="{os.path.basename(path)}"'
            r["Access-Control-Allow-Origin"]   = "*"
            r["Access-Control-Expose-Headers"] = "Content-Disposition"
            return r
        except Exception as exc:
            return _err(f"Could not read file: {exc}", 500)


# =============================================================================
# PAYMENTS
# =============================================================================

class PurchasePaymentCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request, entry_id):
        e = get_object_or_404(PurchaseEntry, id=entry_id)
        d = request.data
        try:
            amount = Decimal(str(d.get("amount", 0)))
        except (InvalidOperation, TypeError, ValueError):
            return _err("amount must be a valid number.")
        if amount <= 0: return _err("Amount must be > 0.")
        balance = Decimal(str(e.balance_amount))
        if amount > balance + Decimal("0.01"):
            return _err(f"Payment AED {float(amount):,.2f} exceeds balance AED {float(balance):,.2f}.")
        valid_methods = [m[0] for m in PAYMENT_METHOD_CHOICES]
        pay_method = d.get("paymentMethod", "cash")
        if pay_method not in valid_methods:
            return _err(f"Invalid paymentMethod. Valid: {', '.join(valid_methods)}.")
        fy = e.financial_year or FinancialYear.get_active()
        p = PurchasePayment.objects.create(
            financial_year=fy, purchase_entry=e,
            payment_date=d.get("paymentDate", date.today()),
            amount=amount, payment_method=pay_method,
            reference_no=(d.get("referenceNo") or "").strip(),
            notes=(d.get("notes") or "").strip(), created_by=request.user,
        )
        e.refresh_from_db()
        return Response({
            "message": f"Payment of AED {float(amount):,.2f} recorded.",
            "paymentId": p.id, "paidAmount": float(e.paid_amount),
            "balanceAmount": float(e.balance_amount), "paymentStatus": e.payment_status,
        }, status=201)


class PurchasePaymentDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def delete(self, request, payment_id):
        payment = get_object_or_404(PurchasePayment, id=payment_id)
        entry   = payment.purchase_entry
        amount  = float(payment.amount)
        payment.delete()
        entry.refresh_from_db()
        return Response({
            "message":       f"Payment of AED {amount:,.2f} deleted.",
            "balanceAmount": float(entry.balance_amount),
            "paymentStatus": entry.payment_status,
        })


class PurchasePaymentBulkSupplierView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    @transaction.atomic
    def post(self, request):
        d = request.data
        if not d.get("supplierId"): return _err("supplierId is required.")
        if not d.get("entryIds") or not isinstance(d["entryIds"], list):
            return _err("entryIds must be a non-empty list.")
        if not d.get("amount"): return _err("amount is required.")
        try:
            total = Decimal(str(d["amount"]))
        except (InvalidOperation, TypeError, ValueError):
            return _err("amount must be a valid number.")
        if total <= 0: return _err("amount must be > 0.")
        supplier   = get_object_or_404(Supplier, id=d["supplierId"])
        pay_date   = d.get("paymentDate") or str(date.today())
        pay_method = d.get("paymentMethod", "cash")
        ref_no     = (d.get("referenceNo") or "").strip()
        notes_txt  = (d.get("notes") or "").strip()
        valid_methods = [m[0] for m in PAYMENT_METHOD_CHOICES]
        if pay_method not in valid_methods:
            return _err(f"Invalid paymentMethod.")
        entries = list(
            PurchaseEntry.objects.filter(id__in=d["entryIds"], vendor=supplier)
            .exclude(payment_status="paid").order_by("invoice_date", "created_at")
        )
        if not entries: return _err("No open entries for this supplier.")
        outstanding = sum(Decimal(str(e.balance_amount)) for e in entries)
        if total > outstanding + Decimal("0.01"):
            return _err(f"Payment AED {float(total):,.2f} exceeds outstanding AED {float(outstanding):,.2f}.")
        fy = entries[0].financial_year or FinancialYear.get_active()
        remaining = total
        results   = []
        for entry in entries:
            if remaining <= 0: break
            balance  = Decimal(str(entry.balance_amount))
            pay_this = min(remaining, balance)
            if pay_this <= 0: continue
            PurchasePayment(
                financial_year=fy, purchase_entry=entry, payment_date=pay_date,
                amount=pay_this, payment_method=pay_method, reference_no=ref_no,
                notes=notes_txt, created_by=request.user,
            ).save()
            entry.refresh_from_db()
            remaining -= pay_this
            results.append({
                "entryId": entry.id, "entryNumber": entry.entry_number,
                "amountPaid": float(pay_this), "newBalance": float(entry.balance_amount),
                "paymentStatus": entry.payment_status,
            })
        applied = float(total - remaining)
        return Response({
            "message": f"AED {applied:,.2f} paid across {len(results)} entries.",
            "totalApplied": applied, "remaining": float(remaining), "allocations": results,
        }, status=201)


# =============================================================================
# STATS
# =============================================================================

class PurchaseStatsView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        fy_id    = request.GET.get("financialYearId")
        entry_qs = PurchaseEntry.objects.all()
        order_qs = PurchaseOrder.objects.all()
        if fy_id:
            entry_qs = entry_qs.filter(financial_year_id=fy_id)
            order_qs = order_qs.filter(financial_year_id=fy_id)
        today       = date.today()
        month_start = today.replace(day=1)
        agg = entry_qs.aggregate(
            total_invoiced=Sum("total_amount"), total_paid=Sum("paid_amount"),
            total_balance=Sum("balance_amount"),
            unpaid_count=Count("id", filter=Q(payment_status="unpaid")),
            partial_count=Count("id", filter=Q(payment_status="partial")),
            paid_count=Count("id", filter=Q(payment_status="paid")),
        )
        overdue = entry_qs.filter(due_date__lt=today, payment_status__in=["unpaid","partial"]).aggregate(
            count=Count("id"), amount=Sum("balance_amount"))
        monthly = entry_qs.filter(invoice_date__gte=month_start).aggregate(rev=Sum("total_amount"), count=Count("id"))
        order_agg = order_qs.aggregate(
            draft_count=Count("id", filter=Q(status="draft")),
            pending_count=Count("id", filter=Q(status="submitted")),
            approved_count=Count("id", filter=Q(status="approved")),
        )
        return Response({
            "summary": {
                "totalInvoiced": float(agg["total_invoiced"] or 0),
                "totalPaid":     float(agg["total_paid"]     or 0),
                "totalBalance":  float(agg["total_balance"]  or 0),
                "unpaidCount":   agg["unpaid_count"]  or 0,
                "partialCount":  agg["partial_count"] or 0,
                "paidCount":     agg["paid_count"]    or 0,
                "overdueCount":  overdue["count"]     or 0,
                "overdueAmount": float(overdue["amount"] or 0),
                "monthlySpend":  float(monthly["rev"] or 0),
                "monthlyEntries":monthly["count"]     or 0,
            },
            "purchaseOrders": {
                "draftCount":    order_agg["draft_count"]    or 0,
                "pendingCount":  order_agg["pending_count"]  or 0,
                "approvedCount": order_agg["approved_count"] or 0,
            },
        })


# =============================================================================
# DROPDOWNS
# =============================================================================

class SupplierDropdownView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES
    def get(self, request):
        qs = Supplier.objects.filter(is_active=True).order_by("display_name")
        limit = request.GET.get("limit")
        if limit and str(limit).isdigit():
            qs = qs[: min(int(limit), 500)]
        return Response([
            {"id": s.id, "name": s.name, "displayName": s.display_name,
             "phone": s.phone, "gstin": s.gstin, "trn": s.trn,
             "email": s.email, "paymentTerms": s.payment_terms,
             "billingAddress": _billing_dict(s),
             "shippingAddress": _shipping_dict(s),
             "outstanding": float(s.outstanding)}
            for s in qs
        ])


class AssetDropdownView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES
    def get(self, request):
        assets = Asset.objects.filter(status="active", item_type="goods").order_by("name")
        limit = request.GET.get("limit")
        if limit and str(limit).isdigit():
            assets = assets[: min(int(limit), 500)]
        return Response([
            {"id": a.id, "name": a.name, "code": a.asset_code,
             "category": a.get_item_type_display(),
             "purchasePrice": float(a.purchase_cost),
             "purchaseCost": float(a.purchase_cost),
             "purchaseAccount": a.purchase_account,
             "taxRate": float(getattr(a, "tax_rate", 0) or 0),
             "sellingPriceInclVat": float(getattr(a, "selling_price", 0) or 0),
             "sellingPrice": float(getattr(a, "selling_price", 0) or 0)}
            for a in assets
        ])


class ServiceDropdownView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES
    def get(self, request):
        services = Service.objects.filter(status="active", item_type="service").order_by("name")
        limit = request.GET.get("limit")
        if limit and str(limit).isdigit():
            services = services[: min(int(limit), 500)]
        return Response([
            {"id": s.id, "name": s.name, "code": s.code, "category": s.get_item_type_display(),
             "basePrice": float(s.purchase_cost), "taxRate": float(s.tax_rate)}
            for s in services
        ])


class ApprovedPODropdownView(APIView):
    """
    GET /api/purchases/approved-pos/

    Returns approved/partial POs with full item detail so the
    Purchase Entry form can pre-fill items from the PO.
    Also flags POs that have no entry yet (needsEntry=True).
    """
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        pos = (
            PurchaseOrder.objects
            .filter(status__in=["approved", "partial"])
            .select_related("vendor")
            .prefetch_related("items__item")
            .order_by("order_date")
        )
        result = []
        for po in pos:
            entry_count    = po.entries.count()
            received_count = po.entries.filter(is_received=True).count()
            result.append({
                "id":            po.id,
                "poNumber":      po.po_number,
                "orderDate":     str(po.order_date),
                "expectedDate":  str(po.expected_date) if po.expected_date else None,
                "status":        po.status,
                "paymentTerms":  po.payment_terms,
                "supplier":      {"id": po.vendor_id, "name": po.vendor.name},
                "totalAmount":   float(po.total_amount),
                "entryCount":    entry_count,
                "receivedCount": received_count,
                "needsEntry":    entry_count == 0,
                "items": [
                    {
                        "assetId":      i.item_id,
                        "itemName":     i.item_name,
                        "assetCode":    i.item.asset_code if i.item else None,
                        "category":     i.item.get_item_type_display() if i.item else None,
                        "purchasePrice": float(i.item.purchase_cost) if i.item else 0,
                        "purchaseCost": float(i.item.purchase_cost) if i.item else 0,
                        "quantity":     float(i.quantity),
                        "unitPrice":    float(i.unit_price),
                        "discount":     float(i.discount),
                        "taxRate":      float(i.tax_rate),
                        "account":      i.account,
                    }
                    for i in po.items.all()
                ],
            })
        return Response(result)
