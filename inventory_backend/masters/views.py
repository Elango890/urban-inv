# =============================================================================
# masters/views.py  — UPDATED
#
# Removed: ItemCategory/AssetCategory, Service, ServiceCategory,
#           ItemAllocation/AssetAllocation (all allocation views)
# Kept:    FinancialYear, Vendor (Supplier), Customer, Item (Asset)
# =============================================================================

from django.utils         import timezone
from django.shortcuts     import get_object_or_404
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db.models       import Sum, Q, Count
from django.db.models.deletion import ProtectedError
from django.db import IntegrityError
from datetime import date

from rest_framework.views       import APIView
from rest_framework.response    import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework             import status

from inventory_backend.api_errors import error_response, field_errors, required_errors

from audit.utils      import create_audit_log
from users.models     import User
from users.permissions import (
    HasAllowedRoles,
    IsAdmin,
    ADMIN_ONLY_ROLES,
    CUSTOMER_ROLES,
    OPERATIONS_ROLES,
)

from .models import (
    # Vendor (previously Supplier)
    Vendor,
    Supplier,
    # Customer
    Customer, OrganizationAddress,
    # Item (previously Asset)
    Item,
    # aliases
    Asset,
    # Financial Year
    FinancialYear,
)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _err(message, code=400, errors=None):
    return error_response(message, code=code, errors=errors)


def _validate_required(data, fields):
    errors = required_errors(data, fields)
    if errors:
        return _err("Validation failed", errors=errors)
    return None


def _parse_optional_date(value, field_name, errors):
    if value in (None, "", "null"):
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        errors[field_name] = "Enter a valid date."
        return None


# ─────────────────────────────────────────────────────────────────────────────
# ADDRESS DICT HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _billing_dict(obj):
    return {
        "attention":    obj.billing_attention,
        "country":      obj.billing_country,
        "addressLine1": obj.billing_address_line1,
        "addressLine2": obj.billing_address_line2,
        "city":         obj.billing_city,
        "state":        obj.billing_state,
        "zip":          obj.billing_zip,
        "phone":        obj.billing_phone,
        "fax":          obj.billing_fax,
    }


def _shipping_dict(obj):
    return {
        "attention":    obj.shipping_attention,
        "country":      obj.shipping_country,
        "addressLine1": obj.shipping_address_line1,
        "addressLine2": obj.shipping_address_line2,
        "city":         obj.shipping_city,
        "state":        obj.shipping_state,
        "zip":          obj.shipping_zip,
        "phone":        obj.shipping_phone,
        "fax":          obj.shipping_fax,
    }


def _apply_billing(obj, d):
    billing = d.get("billingAddress", {})
    obj.billing_attention     = billing.get("attention",    obj.billing_attention)
    obj.billing_country       = billing.get("country",      obj.billing_country)
    obj.billing_address_line1 = billing.get("addressLine1", obj.billing_address_line1)
    obj.billing_address_line2 = billing.get("addressLine2", obj.billing_address_line2)
    obj.billing_city          = billing.get("city",         obj.billing_city)
    obj.billing_state         = billing.get("state",        obj.billing_state)
    obj.billing_zip           = billing.get("zip",          obj.billing_zip)
    obj.billing_phone         = billing.get("phone",        obj.billing_phone)
    obj.billing_fax           = billing.get("fax",          obj.billing_fax)


def _apply_shipping(obj, d):
    shipping = d.get("shippingAddress", {})
    obj.shipping_attention     = shipping.get("attention",    obj.shipping_attention)
    obj.shipping_country       = shipping.get("country",      obj.shipping_country)
    obj.shipping_address_line1 = shipping.get("addressLine1", obj.shipping_address_line1)
    obj.shipping_address_line2 = shipping.get("addressLine2", obj.shipping_address_line2)
    obj.shipping_city          = shipping.get("city",         obj.shipping_city)
    obj.shipping_state         = shipping.get("state",        obj.shipping_state)
    obj.shipping_zip           = shipping.get("zip",          obj.shipping_zip)
    obj.shipping_phone         = shipping.get("phone",        obj.shipping_phone)
    obj.shipping_fax           = shipping.get("fax",          obj.shipping_fax)


def _organization_address_to_dict(address):
    return {
        "id": address.id,
        "name": address.name,
        "attention": address.attention,
        "addressLine1": address.address_line1,
        "addressLine2": address.address_line2,
        "city": address.city,
        "state": address.state,
        "country": address.country,
        "zip": address.zip,
        "phone": address.phone,
        "isDefault": address.is_default,
        "isActive": address.is_active,
        "formatted": address.formatted,
        "createdAt": address.created_at.isoformat(),
    }


def _apply_organization_address(address, data):
    address.name = (data.get("name") or address.name or "").strip()
    address.attention = (data.get("attention", address.attention) or "").strip()
    address.address_line1 = (data.get("addressLine1") or address.address_line1 or "").strip()
    address.address_line2 = (data.get("addressLine2", address.address_line2) or "").strip()
    address.city = (data.get("city", address.city) or "").strip()
    address.state = (data.get("state", address.state) or "").strip()
    address.country = (data.get("country", address.country) or "United Arab Emirates").strip()
    address.zip = (data.get("zip", address.zip) or "").strip()
    address.phone = (data.get("phone", address.phone) or "").strip()
    if "isDefault" in data:
        address.is_default = bool(data.get("isDefault"))
    if "isActive" in data:
        address.is_active = bool(data.get("isActive"))


# =============================================================================
# ░░  FINANCIAL YEAR  ░░
# =============================================================================


class OrganizationAddressListCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        qs = OrganizationAddress.objects.all()
        if request.GET.get("includeInactive", "").lower() != "true":
            qs = qs.filter(is_active=True)
        return Response([_organization_address_to_dict(a) for a in qs])

    def post(self, request):
        data = request.data
        errors = {}
        if not (data.get("name") or "").strip():
            errors["name"] = "Address name is required."
        if not (data.get("addressLine1") or "").strip():
            errors["addressLine1"] = "Address line 1 is required."
        if errors:
            return _err("Validation failed", errors=errors)
        address = OrganizationAddress()
        _apply_organization_address(address, data)
        if not OrganizationAddress.objects.exists():
            address.is_default = True
        address.save()
        create_audit_log(
            user=request.user,
            action="create",
            resource=address.name,
            resource_type="OrganizationAddress",
            request=request,
            details=f"Organization address '{address.name}' created",
            changes=_organization_address_to_dict(address),
        )
        return Response(_organization_address_to_dict(address), status=status.HTTP_201_CREATED)


class OrganizationAddressDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def put(self, request, address_id):
        address = get_object_or_404(OrganizationAddress, id=address_id)
        _apply_organization_address(address, request.data)
        if not address.name:
            return _err("Validation failed", errors={"name": "Address name is required."})
        if not address.address_line1:
            return _err("Validation failed", errors={"addressLine1": "Address line 1 is required."})
        address.save()
        return Response(_organization_address_to_dict(address))

    def delete(self, request, address_id):
        address = get_object_or_404(OrganizationAddress, id=address_id)
        address.is_active = False
        address.is_default = False
        address.save(update_fields=["is_active", "is_default", "updated_at"])
        if not OrganizationAddress.objects.filter(is_active=True, is_default=True).exists():
            fallback = OrganizationAddress.objects.filter(is_active=True).first()
            if fallback:
                fallback.is_default = True
                fallback.save(update_fields=["is_default", "updated_at"])
        return Response({"message": "Organization address archived."})

class FinancialYearListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        years = FinancialYear.objects.all()
        return Response([
            {
                "id":        fy.id,
                "yearName":  fy.year_name,
                "startDate": fy.start_date,
                "endDate":   fy.end_date,
                "isActive":  fy.is_active,
            }
            for fy in years
        ])

    def post(self, request):
        d = request.data
        err = _validate_required(d, ["yearName", "startDate", "endDate"])
        if err:
            return err
        fy = FinancialYear.objects.create(
            year_name  = d["yearName"],
            start_date = d["startDate"],
            end_date   = d["endDate"],
            is_active  = d.get("isActive", False),
        )
        return Response({"message": "Financial year created", "id": fy.id}, status=201)


class FinancialYearActivateView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    allowed_roles = ADMIN_ONLY_ROLES

    def put(self, request, fy_id):
        fy = get_object_or_404(FinancialYear, id=fy_id)
        fy.is_active = True
        fy.save()
        return Response({"message": f"{fy.year_name} set as active financial year"})


class FinancialYearDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    allowed_roles = ADMIN_ONLY_ROLES

    def put(self, request, fy_id):
        fy = get_object_or_404(FinancialYear, id=fy_id)
        d  = request.data
        err = _validate_required(d, ["yearName", "startDate", "endDate"])
        if err:
            return err
        fy.year_name  = d["yearName"]
        fy.start_date = d["startDate"]
        fy.end_date   = d["endDate"]
        if "isActive" in d:
            fy.is_active = bool(d["isActive"])
        fy.save()
        return Response({"message": "Financial year updated"})


# =============================================================================
# ░░  VENDOR  (previously Supplier)  ░░
# =============================================================================

def _vendor_to_dict(v, include_purchases=False):
    result = {
        "id":              v.id,
        "salutation":      v.salutation,
        "firstName":       v.first_name,
        "lastName":        v.last_name,
        "fullName":        v.full_name,
        "companyName":     v.company_name,
        "displayName":     v.display_name,
        "email":           v.email,
        "phone":           v.phone,
        "mobile":          v.mobile,
        "taxTreatment":    v.tax_treatment,
        "trn":             v.trn,
        "pan":             v.pan,
        "sourceOfSupply":  v.source_of_supply,
        "currency":        v.currency,
        "paymentTerms":    v.payment_terms,
        "priceList":       v.price_list,
        "creditLimit":     float(v.credit_limit),
        "outstanding":     float(v.outstanding),
        "bankName":        v.bank_name,
        "bankAccount":     v.bank_account,
        "bankIfsc":        v.bank_ifsc,
        "billingAddress":  _billing_dict(v),
        "shippingAddress": _shipping_dict(v),
        "notes":           v.notes,
        "isActive":        v.is_active,
        "createdAt":       v.created_at.isoformat(),
    }
    if include_purchases:
        from purchases.models import PurchaseEntry
        result["totalPurchases"] = float(
            PurchaseEntry.objects.filter(vendor=v)
            .aggregate(t=Sum("total_amount"))["t"] or 0
        )
    return result


def _vendor_related_data(v):
    from purchases.models import PurchaseEntry, PurchaseOrder, PurchasePayment
    from pettycash.models import PettyCashEntry
    from pettycash.views import _serialize_entry

    entries_qs = (
        PurchaseEntry.objects.filter(vendor=v)
        .select_related("financial_year", "purchase_order")
        .prefetch_related("payments", "items")
        .order_by("-invoice_date", "-created_at")
    )
    petty_cash_qs = (
        PettyCashEntry.objects.filter(related_party_type="vendor", vendor=v)
        .select_related("approved_by", "created_by", "financial_year", "vendor")
        .order_by("-transaction_date", "-created_at")
    )
    orders_qs = (
        PurchaseOrder.objects.filter(vendor=v)
        .select_related("financial_year", "approved_by", "created_by")
        .prefetch_related("entries", "items")
        .order_by("-order_date", "-created_at")
    )
    payments_qs = (
        PurchasePayment.objects.filter(purchase_entry__vendor=v)
        .select_related("purchase_entry", "financial_year")
        .order_by("-payment_date", "-created_at")
    )

    entries = []
    for entry in entries_qs[:25]:
        entries.append(
            {
                "id": entry.id,
                "entryNumber": entry.entry_number,
                "supplierInvoiceNo": entry.vendor_invoice_no,
                "invoiceDate": entry.invoice_date.isoformat(),
                "dueDate": entry.due_date.isoformat() if entry.due_date else None,
                "purchaseOrderId": entry.purchase_order_id,
                "purchaseOrderNo": entry.purchase_order.po_number if entry.purchase_order else None,
                "financialYear": str(entry.financial_year) if entry.financial_year else None,
                "subtotal": float(entry.subtotal or 0),
                "taxAmount": float(entry.tax_amount or 0),
                "totalAmount": float(entry.total_amount or 0),
                "paidAmount": float(entry.paid_amount or 0),
                "balanceAmount": float(entry.balance_amount or 0),
                "paymentStatus": entry.payment_status,
                "itemCount": entry.items.count(),
                "paymentCount": entry.payments.count(),
                "isReceived": bool(getattr(entry, "is_received", False)),
                "receivedAt": entry.received_at.isoformat() if getattr(entry, "received_at", None) else None,
            }
        )

    orders = []
    for order in orders_qs[:25]:
        orders.append(
            {
                "id": order.id,
                "poNumber": order.po_number,
                "referenceNo": order.reference_no,
                "orderDate": order.order_date.isoformat(),
                "expectedDate": order.expected_date.isoformat() if order.expected_date else None,
                "financialYear": str(order.financial_year) if order.financial_year else None,
                "paymentTerms": order.payment_terms,
                "status": order.status,
                "subtotal": float(order.subtotal or 0),
                "taxAmount": float(order.tax_amount or 0),
                "totalAmount": float(order.total_amount or 0),
                "itemCount": order.items.count(),
                "entryCount": order.entries.count(),
                "approvedBy": order.approved_by.name if order.approved_by else None,
                "approvedAt": order.approved_at.isoformat() if order.approved_at else None,
            }
        )

    payments = []
    for payment in payments_qs[:50]:
        payments.append(
            {
                "id": payment.id,
                "entryId": payment.purchase_entry_id,
                "entryNumber": payment.purchase_entry.entry_number,
                "paymentDate": payment.payment_date.isoformat(),
                "financialYear": str(payment.financial_year) if payment.financial_year else None,
                "amount": float(payment.amount or 0),
                "paymentMethod": payment.payment_method,
                "referenceNo": payment.reference_no,
                "notes": payment.notes,
            }
        )

    entry_summary = entries_qs.aggregate(
        totalPurchases=Sum("total_amount"),
        totalPaid=Sum("paid_amount"),
        totalBalance=Sum("balance_amount"),
        totalEntries=Count("id"),
        unpaidEntries=Count("id", filter=Q(payment_status="unpaid")),
        partialEntries=Count("id", filter=Q(payment_status="partial")),
        paidEntries=Count("id", filter=Q(payment_status="paid")),
    )
    order_summary = orders_qs.aggregate(
        totalOrders=Count("id"),
        draftOrders=Count("id", filter=Q(status="draft")),
        approvedOrders=Count("id", filter=Q(status="approved")),
        receivedOrders=Count("id", filter=Q(status="received")),
        partialOrders=Count("id", filter=Q(status="partial")),
        cancelledOrders=Count("id", filter=Q(status="cancelled")),
        totalOrderedValue=Sum("total_amount"),
    )
    payment_summary = payments_qs.aggregate(
        totalPayments=Count("id"),
        totalPaymentAmount=Sum("amount"),
    )

    return {
        "summary": {
            "totalPurchases": float(entry_summary["totalPurchases"] or 0),
            "totalPaid": float(entry_summary["totalPaid"] or 0),
            "totalBalance": float(entry_summary["totalBalance"] or 0),
            "totalEntries": int(entry_summary["totalEntries"] or 0),
            "unpaidEntries": int(entry_summary["unpaidEntries"] or 0),
            "partialEntries": int(entry_summary["partialEntries"] or 0),
            "paidEntries": int(entry_summary["paidEntries"] or 0),
            "totalOrders": int(order_summary["totalOrders"] or 0),
            "draftOrders": int(order_summary["draftOrders"] or 0),
            "approvedOrders": int(order_summary["approvedOrders"] or 0),
            "receivedOrders": int(order_summary["receivedOrders"] or 0),
            "partialOrders": int(order_summary["partialOrders"] or 0),
            "cancelledOrders": int(order_summary["cancelledOrders"] or 0),
            "totalOrderedValue": float(order_summary["totalOrderedValue"] or 0),
            "totalPayments": int(payment_summary["totalPayments"] or 0),
            "totalPaymentAmount": float(payment_summary["totalPaymentAmount"] or 0),
        },
        "purchaseEntries": entries,
        "purchaseOrders": orders,
        "payments": payments,
        "pettyCash": [_serialize_entry(entry) for entry in petty_cash_qs[:50]],
    }


class SupplierListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        vendors = Vendor.objects.filter(is_active=True)
        search  = request.GET.get("search", "")
        if search:
            vendors = vendors.filter(
                Q(display_name__icontains=search) | Q(company_name__icontains=search)
            )
        return Response([_vendor_to_dict(v, include_purchases=True) for v in vendors])


class SupplierCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        d   = request.data
        err = _validate_required(d, ["displayName"])
        if err:
            return err

        if d.get("email"):
            try:
                validate_email(d["email"])
            except ValidationError:
                return _err("Validation failed",
                            errors=field_errors("email", "Invalid email format."))

        vendor = Vendor.objects.create(
            salutation       = d.get("salutation",      ""),
            first_name       = d.get("firstName",       ""),
            last_name        = d.get("lastName",        ""),
            company_name     = d.get("companyName",     ""),
            display_name     = d["displayName"],
            email            = d.get("email")  or None,
            phone            = d.get("phone",           ""),
            mobile           = d.get("mobile",          ""),
            tax_treatment    = d.get("taxTreatment",    "vat_registered"),
            trn              = d.get("trn",             ""),
            pan              = d.get("pan",             ""),
            source_of_supply = d.get("sourceOfSupply", ""),
            currency         = d.get("currency",        "AED"),
            payment_terms    = d.get("paymentTerms",    "net_30"),
            price_list       = d.get("priceList",       ""),
            credit_limit     = d.get("creditLimit",     0),
            bank_name        = d.get("bankName",        ""),
            bank_account     = d.get("bankAccount",     ""),
            bank_ifsc        = d.get("bankIfsc",        ""),
            notes            = d.get("notes",           ""),
        )
        _apply_billing(vendor, d)
        _apply_shipping(vendor, d)
        vendor.save()

        create_audit_log(
            user=request.user, action="create",
            resource=vendor.display_name, resource_type="Vendor",
            request=request,
            details=f"Vendor {vendor.display_name} created",
            changes={"displayName": vendor.display_name},
        )
        return Response({"message": "Vendor created successfully", "id": vendor.id}, status=201)


class SupplierDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, supplier_id):
        v = get_object_or_404(Vendor, id=supplier_id)
        return Response({
            **_vendor_to_dict(v, include_purchases=True),
            **_vendor_related_data(v),
        })

    def put(self, request, supplier_id):
        v = get_object_or_404(Vendor, id=supplier_id)
        d = request.data

        if "email" in d and d["email"]:
            try:
                validate_email(d["email"])
            except ValidationError:
                return _err("Validation failed",
                            errors=field_errors("email", "Invalid email format."))

        v.salutation       = d.get("salutation",      v.salutation)
        v.first_name       = d.get("firstName",       v.first_name)
        v.last_name        = d.get("lastName",        v.last_name)
        v.company_name     = d.get("companyName",     v.company_name)
        v.display_name     = d.get("displayName",     v.display_name)
        v.email            = d.get("email",           v.email) or None
        v.phone            = d.get("phone",           v.phone)
        v.mobile           = d.get("mobile",          v.mobile)
        v.tax_treatment    = d.get("taxTreatment",    v.tax_treatment)
        v.trn              = d.get("trn",             v.trn)
        v.pan              = d.get("pan",             v.pan)
        v.source_of_supply = d.get("sourceOfSupply",  v.source_of_supply)
        v.currency         = d.get("currency",        v.currency)
        v.payment_terms    = d.get("paymentTerms",    v.payment_terms)
        v.price_list       = d.get("priceList",       v.price_list)
        v.credit_limit     = d.get("creditLimit",     v.credit_limit)
        v.bank_name        = d.get("bankName",        v.bank_name)
        v.bank_account     = d.get("bankAccount",     v.bank_account)
        v.bank_ifsc        = d.get("bankIfsc",        v.bank_ifsc)
        v.notes            = d.get("notes",           v.notes)
        v.is_active        = d.get("isActive",        v.is_active)
        _apply_billing(v, d)
        _apply_shipping(v, d)
        v.save()

        create_audit_log(
            user=request.user, action="update",
            resource=v.display_name, resource_type="Vendor",
            request=request,
            details=f"Vendor {v.display_name} updated",
            changes=d,
        )
        return Response({"message": "Vendor updated successfully", **_vendor_to_dict(v)})

    def delete(self, request, supplier_id):
        try:
            v    = get_object_or_404(Vendor, id=supplier_id)
            name = v.display_name
            v.delete()
            create_audit_log(
                user=request.user, action="delete",
                resource=name, resource_type="Vendor",
                request=request,
                details=f"Vendor {name} deleted",
                changes={"vendorId": supplier_id},
            )
            return Response({"message": "Vendor deleted successfully"})
        except ProtectedError:
            return _err("Cannot delete this vendor because it is linked to existing records.", 400)


class SupplierPurchaseHistoryView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, supplier_id):
        v = get_object_or_404(Vendor, id=supplier_id)
        from purchases.models import PurchaseEntry
        entries = PurchaseEntry.objects.filter(vendor=v).order_by("-invoice_date")
        data    = [
            {
                "id":              e.id,
                "entryNumber":     e.entry_number,
                "supplierInvoice": e.vendor_invoice_no,
                "invoiceDate":     e.invoice_date,
                "dueDate":         e.due_date,
                "totalAmount":     float(e.total_amount),
                "paidAmount":      float(e.paid_amount),
                "balanceAmount":   float(e.balance_amount),
                "paymentStatus":   e.payment_status,
                "financialYear":   str(e.financial_year),
            }
            for e in entries
        ]
        return Response({
            "vendor":         v.display_name,
            "totalPurchases": float(entries.aggregate(t=Sum("total_amount"))["t"] or 0),
            "entries":        data,
        })


# =============================================================================
# ░░  CUSTOMER  ░░
# =============================================================================

def _customer_to_dict(c):
    return {
        "id":               c.id,
        "salutation":       c.salutation,
        "firstName":        c.first_name,
        "lastName":         c.last_name,
        "fullName":         c.full_name,
        "companyName":      c.company_name,
        "displayName":      c.display_name,
        "customerType":     c.customer_type,
        "customerLanguage": c.customer_language,
        "email":            c.email,
        "phone":            c.phone,
        "mobile":           c.mobile,
        "taxTreatment":     c.tax_treatment,
        "trn":              c.trn,
        "pan":              c.pan,
        "placeOfSupply":    c.place_of_supply,
        "currency":         c.currency,
        "paymentTerms":     c.payment_terms,
        "priceList":        c.price_list,
        "creditLimit":      float(c.credit_limit),
        "outstanding":      float(c.outstanding),
        "billingAddress":   _billing_dict(c),
        "shippingAddress":  _shipping_dict(c),
        "notes":            c.notes,
        "isActive":         c.is_active,
        "createdAt":        c.created_at.isoformat(),
    }


def _customer_related_data(c):
    from sales.models import SalesInvoice, SalesPayment, SalesReturn
    from sales.views import _invoice_to_dict, _sales_return_to_dict
    from pettycash.models import PettyCashEntry
    from pettycash.views import _serialize_entry

    invoices_qs = (
        SalesInvoice.objects.filter(customer=c)
        .select_related("financial_year", "sales_person", "customer")
        .prefetch_related("payments", "returns")
        .order_by("-invoice_date", "-created_at")
    )
    payments_qs = (
        SalesPayment.objects.filter(sales_invoice__customer=c)
        .select_related("sales_invoice", "financial_year")
        .order_by("-payment_date", "-created_at")
    )
    returns_qs = (
        SalesReturn.objects.filter(customer=c)
        .select_related("sales_invoice", "warehouse", "created_by", "customer")
        .prefetch_related("items__sales_invoice_item__invoice")
        .order_by("-return_date", "-created_at")
    )
    petty_cash_qs = (
        PettyCashEntry.objects.filter(related_party_type="customer", customer=c)
        .select_related("approved_by", "created_by", "financial_year", "customer")
        .order_by("-transaction_date", "-created_at")
    )

    invoices = [_invoice_to_dict(inv, include_items=False, include_payments=False) for inv in invoices_qs[:25]]
    payments = [
        {
            "id": payment.id,
            "invoiceId": payment.sales_invoice_id,
            "invoiceNumber": payment.sales_invoice.invoice_number,
            "paymentDate": payment.payment_date.isoformat(),
            "financialYear": str(payment.financial_year) if payment.financial_year else None,
            "amount": float(payment.amount or 0),
            "transactionType": "refund" if float(payment.amount or 0) < 0 else "payment",
            "paymentMethod": payment.payment_method,
            "referenceNo": payment.reference_no,
            "notes": payment.notes,
        }
        for payment in payments_qs[:50]
    ]
    returns = [_sales_return_to_dict(ret, include_items=False) for ret in returns_qs[:25]]

    invoice_summary = invoices_qs.aggregate(
        totalInvoices=Count("id"),
        grossAmount=Sum("total_amount"),
        rawPaid=Sum("paid_amount"),
        unpaidInvoices=Count("id", filter=Q(payment_status="unpaid")),
        partialInvoices=Count("id", filter=Q(payment_status="partial")),
        paidInvoices=Count("id", filter=Q(payment_status="paid")),
    )
    payment_summary = payments_qs.aggregate(
        totalPayments=Count("id"),
        totalCollected=Sum("amount"),
    )
    return_summary = returns_qs.aggregate(
        totalReturns=Count("id"),
        confirmedReturns=Count("id", filter=Q(status="confirmed")),
        draftReturns=Count("id", filter=Q(status="draft")),
        cancelledReturns=Count("id", filter=Q(status="cancelled")),
        totalReturnAmount=Sum("total_amount"),
    )

    return {
        "summary": {
            "totalInvoices": int(invoice_summary["totalInvoices"] or 0),
            "grossAmount": float(invoice_summary["grossAmount"] or 0),
            "rawPaid": float(invoice_summary["rawPaid"] or 0),
            "outstanding": float(c.outstanding or 0),
            "unpaidInvoices": int(invoice_summary["unpaidInvoices"] or 0),
            "partialInvoices": int(invoice_summary["partialInvoices"] or 0),
            "paidInvoices": int(invoice_summary["paidInvoices"] or 0),
            "totalPayments": int(payment_summary["totalPayments"] or 0),
            "totalCollected": float(payment_summary["totalCollected"] or 0),
            "totalReturns": int(return_summary["totalReturns"] or 0),
            "confirmedReturns": int(return_summary["confirmedReturns"] or 0),
            "draftReturns": int(return_summary["draftReturns"] or 0),
            "cancelledReturns": int(return_summary["cancelledReturns"] or 0),
            "totalReturnAmount": float(return_summary["totalReturnAmount"] or 0),
        },
        "invoices": invoices,
        "payments": payments,
        "returns": returns,
        "pettyCash": [_serialize_entry(entry) for entry in petty_cash_qs[:50]],
    }


class CustomerListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = CUSTOMER_ROLES

    def get(self, request):
        customers     = Customer.objects.all()
        search        = request.GET.get("search", "")
        customer_type = request.GET.get("customerType")
        is_active     = request.GET.get("isActive")
        if search:
            customers = customers.filter(
                Q(display_name__icontains=search) |
                Q(company_name__icontains=search) |
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search)
            )
        if customer_type:
            customers = customers.filter(customer_type=customer_type)
        if is_active is not None:
            customers = customers.filter(is_active=(is_active.lower() == "true"))
        return Response([_customer_to_dict(c) for c in customers])


class CustomerCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = CUSTOMER_ROLES

    def post(self, request):
        d   = request.data
        err = _validate_required(d, ["displayName"])
        if err:
            return err

        if d.get("email"):
            try:
                validate_email(d["email"])
            except ValidationError:
                return _err("Validation failed",
                            errors=field_errors("email", "Invalid email format."))

        customer = Customer.objects.create(
            salutation        = d.get("salutation",       ""),
            first_name        = d.get("firstName",        ""),
            last_name         = d.get("lastName",         ""),
            company_name      = d.get("companyName",      ""),
            display_name      = d["displayName"],
            customer_type     = d.get("customerType",     "business"),
            customer_language = d.get("customerLanguage", "English"),
            email             = d.get("email")   or None,
            phone             = d.get("phone",            ""),
            mobile            = d.get("mobile",           ""),
            tax_treatment     = d.get("taxTreatment",     "vat_registered"),
            trn               = d.get("trn",              ""),
            pan               = d.get("pan",              ""),
            place_of_supply   = d.get("placeOfSupply",    ""),
            currency          = d.get("currency",         "AED"),
            payment_terms     = d.get("paymentTerms",     "net_30"),
            price_list        = d.get("priceList",        ""),
            credit_limit      = d.get("creditLimit",      0),
            notes             = d.get("notes",            ""),
        )
        _apply_billing(customer, d)
        _apply_shipping(customer, d)
        customer.save()

        create_audit_log(
            user=request.user, action="create",
            resource=customer.display_name, resource_type="Customer",
            request=request,
            details=f"Customer {customer.display_name} created",
            changes={"displayName": customer.display_name},
        )
        return Response({"message": "Customer created successfully", "id": customer.id}, status=201)


class CustomerDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = CUSTOMER_ROLES

    def get(self, request, customer_id):
        c = get_object_or_404(Customer, id=customer_id)
        return Response({
            **_customer_to_dict(c),
            **_customer_related_data(c),
        })

    def put(self, request, customer_id):
        c = get_object_or_404(Customer, id=customer_id)
        d = request.data

        if "email" in d and d["email"]:
            try:
                validate_email(d["email"])
            except ValidationError:
                return _err("Validation failed",
                            errors=field_errors("email", "Invalid email format."))

        c.salutation        = d.get("salutation",       c.salutation)
        c.first_name        = d.get("firstName",        c.first_name)
        c.last_name         = d.get("lastName",         c.last_name)
        c.company_name      = d.get("companyName",      c.company_name)
        c.display_name      = d.get("displayName",      c.display_name)
        c.customer_type     = d.get("customerType",     c.customer_type)
        c.customer_language = d.get("customerLanguage", c.customer_language)
        c.email             = d.get("email",            c.email) or None
        c.phone             = d.get("phone",            c.phone)
        c.mobile            = d.get("mobile",           c.mobile)
        c.tax_treatment     = d.get("taxTreatment",     c.tax_treatment)
        c.trn               = d.get("trn",              c.trn)
        c.pan               = d.get("pan",              c.pan)
        c.place_of_supply   = d.get("placeOfSupply",    c.place_of_supply)
        c.currency          = d.get("currency",         c.currency)
        c.payment_terms     = d.get("paymentTerms",     c.payment_terms)
        c.price_list        = d.get("priceList",        c.price_list)
        c.credit_limit      = d.get("creditLimit",      c.credit_limit)
        c.notes             = d.get("notes",            c.notes)
        c.is_active         = d.get("isActive",         c.is_active)
        _apply_billing(c, d)
        _apply_shipping(c, d)
        c.save()

        create_audit_log(
            user=request.user, action="update",
            resource=c.display_name, resource_type="Customer",
            request=request,
            details=f"Customer {c.display_name} updated",
            changes=d,
        )
        return Response({"message": "Customer updated successfully"})


class CustomerInvoicesView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = CUSTOMER_ROLES

    def get(self, request, customer_id):
        from sales.models import SalesInvoice
        c        = get_object_or_404(Customer, id=customer_id)
        invoices = SalesInvoice.objects.filter(customer=c).order_by("-invoice_date")
        data     = [
            {
                "id":            inv.id,
                "invoiceNumber": inv.invoice_number,
                "invoiceDate":   str(inv.invoice_date),
                "dueDate":       str(inv.due_date) if inv.due_date else None,
                "subtotal":      float(inv.subtotal),
                "discAmount":    float(inv.disc_amount),
                "taxAmount":     float(inv.tax_amount),
                "totalAmount":   float(inv.total_amount),
                "paidAmount":    float(inv.paid_amount),
                "balanceAmount": float(inv.balance_amount),
                "paymentStatus": inv.payment_status,
                "financialYear": str(inv.financial_year),
                "createdAt":     inv.created_at.isoformat(),
            }
            for inv in invoices
        ]
        agg = invoices.aggregate(
            total=Sum("total_amount"), paid=Sum("paid_amount"), balance=Sum("balance_amount"),
        )
        return Response({
            "customer":      _customer_to_dict(c),
            "totalInvoices": invoices.count(),
            "totalAmount":   float(agg["total"] or 0),
            "totalPaid":     float(agg["paid"] or 0),
            "totalBalance":  float(agg["balance"] or 0),
            "invoices":      data,
        })


# =============================================================================
# ░░  ITEM  (previously Asset) — no category, no allocation  ░░
# =============================================================================

def _item_to_dict(item):
    """Serialize an Item with live stock info."""
    try:
        from stock.models import Stock
        stocks = Stock.objects.filter(
            item=item, warehouse__is_active=True
        ).select_related("warehouse")
        total_stock   = sum(s.available_quantity for s in stocks)
        damaged_stock = sum(s.damaged_quantity   for s in stocks)
        warehouse_info = [
            {
                "warehouseId":   s.warehouse_id,
                "warehouseName": s.warehouse.name,
                "available":     s.available_quantity,
                "total":         s.total_quantity,
                "damaged":       s.damaged_quantity,
            }
            for s in stocks
        ]
    except Exception:
        total_stock = damaged_stock = 0
        warehouse_info = []

    effective_track_inventory = bool(
        item.track_inventory or total_stock > 0 or damaged_stock > 0 or warehouse_info
    )

    purchase_price = float(item.cost_price)
    selling_price_incl_vat = float(item.selling_price)
    selling_price_without_vat = round(selling_price_incl_vat / 1.05, 2)

    return {
        "id":          item.id,
        "itemType":    item.item_type,
        "name":        item.name,
        "sku":         item.sku,
        "unit":        item.unit,
        "barcode":     item.barcode,
        "isExciseProduct":  item.is_excise_product,
        "trackInventory":   effective_track_inventory,
        # Pricing
        "purchasePrice":    purchase_price,
        "sellingPriceInclVat": selling_price_incl_vat,
        "sellingPriceWithoutVat": selling_price_without_vat,
        "sellingPrice":     selling_price_incl_vat,
        "costPrice":        purchase_price,
        # Accounts
        "salesAccount":     item.sales_account,
        "purchaseAccount":  item.purchase_account,
        # Descriptions
        "salesDescription":    item.sales_description,
        "purchaseDescription": item.purchase_description,
        # Tax
        "taxRate":     float(item.tax_rate),
        # Preferred Vendor
        "preferredVendor": (
            {"id": item.preferred_vendor.id, "displayName": item.preferred_vendor.display_name}
            if item.preferred_vendor else None
        ),
        # Status
        "status":       item.status,
        # Stock
        "totalStock":    total_stock,
        "damagedStock":  damaged_stock,
        "inStock":       total_stock > 0,
        "warehouses":    warehouse_info,
        "createdAt":     item.created_at.isoformat(),
        # Backward-compat aliases
        "assetCode":    item.sku,
        "purchaseCost": purchase_price,
    }


_asset_to_dict = _item_to_dict


class AssetListView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request):
        items = Item.objects.select_related("preferred_vendor").prefetch_related(
            "stock_entries__warehouse"
        ).all()

        search     = request.GET.get("search",   "").strip()
        item_type  = request.GET.get("itemType", "").strip()
        status_val = request.GET.get("status",   "").strip()

        if search:
            items = items.filter(
                Q(name__icontains=search) | Q(sku__icontains=search)
            )
        if item_type:
            items = items.filter(item_type=item_type)
        if status_val:
            items = items.filter(status=status_val)

        page_param      = request.GET.get("page")
        page_size_param = request.GET.get("page_size")

        if page_param or page_size_param:
            try:
                page      = int(page_param or 1)
                page_size = int(page_size_param or 10)
            except (TypeError, ValueError):
                page, page_size = 1, 10

            page      = max(1, page)
            page_size = max(1, min(page_size, 200))
            rows      = [_item_to_dict(a) for a in items.order_by("name")]
            total     = len(rows)
            total_pages = max(1, -(-total // page_size))
            start     = (page - 1) * page_size

            return Response({
                "results":     rows[start: start + page_size],
                "summary": {
                    "total":     total,
                    "active":    sum(1 for r in rows if r["status"] == "active"),
                    "inStock":   sum(1 for r in rows if r["totalStock"] > 0),
                    "zeroStock": sum(1 for r in rows if r["status"] == "active" and r["totalStock"] == 0),
                },
                "count":       total,
                "page":        page,
                "page_size":   page_size,
                "total_pages": total_pages,
            })

        return Response([_item_to_dict(a) for a in items.order_by("name")])


class AssetCreateView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def post(self, request):
        d      = request.data
        errors = {}

        if not d.get("sku", "").strip():
            errors["sku"] = "SKU is required."
        elif len(d["sku"].strip()) < 2:
            errors["sku"] = "SKU must be at least 2 characters."
        elif len(d["sku"].strip()) > 50:
            errors["sku"] = "SKU must be 50 characters or less."
        elif Item.objects.filter(sku=d["sku"].strip()).exists():
            errors["sku"] = "An item with this SKU already exists."

        if not d.get("name", "").strip():
            errors["name"] = "Item name is required."
        elif len(d["name"].strip()) < 2:
            errors["name"] = "Name must be at least 2 characters."

        if not d.get("itemType"):
            errors["itemType"] = "Item type (Goods or Service) is required."

        purchase_price_value = d.get("purchasePrice", d.get("costPrice", 0))
        selling_price_value = d.get(
            "sellingPriceInclVat",
            d.get("rspInclVat", d.get("sellingPrice", 0)),
        )

        try:
            purchase_price = float(purchase_price_value or 0)
            if purchase_price < 0:
                errors["purchasePrice"] = "Purchase price cannot be negative."
        except (ValueError, TypeError):
            errors["purchasePrice"] = "Purchase price must be a valid number."

        try:
            selling_price = float(selling_price_value or 0)
            if selling_price < 0:
                errors["sellingPriceInclVat"] = "Selling price incl. VAT cannot be negative."
        except (ValueError, TypeError):
            errors["sellingPriceInclVat"] = "Selling price incl. VAT must be a valid number."

        if errors:
            return Response({"errors": errors}, status=400)

        preferred_vendor = None
        if d.get("preferredVendorId"):
            preferred_vendor = get_object_or_404(Vendor, id=d["preferredVendorId"])
        if errors:
            return Response({"errors": errors}, status=400)

        item = Item.objects.create(
            item_type            = d.get("itemType", "goods"),
            name                 = d["name"].strip(),
            sku                  = d["sku"].strip(),
            unit                 = d.get("unit",              "pcs"),
            barcode              = (d.get("barcode")         or "").strip(),
            is_excise_product    = bool(d.get("isExciseProduct", False)),
            track_inventory      = bool(d.get("trackInventory", True)),
            selling_price        = selling_price,
            cost_price           = purchase_price,
            sales_account        = (d.get("salesAccount")    or "Sales").strip(),
            purchase_account     = (d.get("purchaseAccount") or "Cost of Goods Sold").strip(),
            sales_description    = (d.get("salesDescription")    or "").strip(),
            purchase_description = (d.get("purchaseDescription") or "").strip(),
            tax_rate             = float(d.get("taxRate", 5) or 5),
            preferred_vendor     = preferred_vendor,
            created_by           = request.user,
        )
        create_audit_log(
            user=request.user, action="create",
            resource=item.sku, resource_type="Item",
            request=request,
            details=f"Item '{item.name}' created",
            changes={"sku": item.sku, "name": item.name},
        )
        return Response({"message": "Item created successfully.", **_item_to_dict(item)}, status=201)


class AssetDetailView(APIView):
    permission_classes = [IsAuthenticated, HasAllowedRoles]
    allowed_roles = OPERATIONS_ROLES

    def get(self, request, asset_id):
        item = get_object_or_404(
            Item.objects.select_related("preferred_vendor")
            .prefetch_related("stock_entries__warehouse"),
            id=asset_id,
        )
        return Response(_item_to_dict(item))

    def put(self, request, asset_id):
        item   = get_object_or_404(Item, id=asset_id)
        d      = request.data
        errors = {}

        if "name" in d:
            name = (d["name"] or "").strip()
            if not name:
                errors["name"] = "Item name is required."
            elif len(name) < 2:
                errors["name"] = "Name must be at least 2 characters."
            else:
                item.name = name

        if "itemType" in d:
            if not d["itemType"]:
                errors["itemType"] = "Item type is required."
            else:
                item.item_type = d["itemType"]

        if "purchasePrice" in d or "costPrice" in d:
            try:
                cp = float(d.get("purchasePrice", d.get("costPrice")) or 0)
                if cp < 0:
                    errors["purchasePrice"] = "Purchase price cannot be negative."
                else:
                    item.cost_price = cp
            except (ValueError, TypeError):
                errors["purchasePrice"] = "Purchase price must be a valid number."

        if "sellingPriceInclVat" in d or "rspInclVat" in d or "sellingPrice" in d:
            try:
                sp = float(
                    d.get("sellingPriceInclVat", d.get("rspInclVat", d.get("sellingPrice"))) or 0
                )
                if sp < 0:
                    errors["sellingPriceInclVat"] = "Selling price incl. VAT cannot be negative."
                else:
                    item.selling_price = sp
            except (ValueError, TypeError):
                errors["sellingPriceInclVat"] = "Selling price incl. VAT must be a valid number."

        if errors:
            return Response({"errors": errors}, status=400)

        item.unit                 =  d.get("unit",                 item.unit)
        item.barcode              = (d.get("barcode",              item.barcode)              or "").strip()
        item.is_excise_product    =  d.get("isExciseProduct",      item.is_excise_product)
        item.track_inventory      =  d.get("trackInventory",       item.track_inventory)
        item.sales_account        = (d.get("salesAccount",         item.sales_account)        or "").strip()
        item.purchase_account     = (d.get("purchaseAccount",      item.purchase_account)     or "").strip()
        item.sales_description    = (d.get("salesDescription",     item.sales_description)    or "").strip()
        item.purchase_description = (d.get("purchaseDescription",  item.purchase_description) or "").strip()
        item.tax_rate             =  d.get("taxRate",              item.tax_rate)
        item.status               =  d.get("status",               item.status)

        if "preferredVendorId" in d:
            item.preferred_vendor = (
                get_object_or_404(Vendor, id=d["preferredVendorId"])
                if d["preferredVendorId"] else None
            )

        item.save()
        create_audit_log(
            user=request.user, action="update",
            resource=item.sku, resource_type="Item",
            request=request,
            details=f"Item '{item.name}' updated",
            changes=dict(d),
        )
        return Response({"message": "Item updated successfully.", **_item_to_dict(item)})

    def delete(self, request, asset_id):
        item = get_object_or_404(Item, id=asset_id)

        if item.track_inventory:
            try:
                from stock.models import Stock
                stock_count = Stock.objects.filter(item=item).aggregate(
                    t=Sum("total_quantity")
                )["t"] or 0
                if stock_count > 0:
                    return _err(
                        f"Cannot delete '{item.name}' — it has {stock_count} units in stock. "
                        "Clear all stock first.", 409,
                    )
            except Exception:
                pass

        name = item.name
        sku  = item.sku
        try:
            item.delete()
        except (ProtectedError, IntegrityError):
            # If historical records still reference this item, keep the audit trail
            # and safely retire it from active use instead of crashing the request.
            update_fields = []
            if item.status != "disposed":
                item.status = "disposed"
                update_fields.append("status")
            if item.track_inventory:
                item.track_inventory = False
                update_fields.append("track_inventory")
            if update_fields:
                update_fields.append("updated_at")
                item.save(update_fields=update_fields)
            create_audit_log(
                user=request.user, action="update",
                resource=sku, resource_type="Item",
                request=request,
                details=f"Item '{name}' archived because it is referenced by historical records",
                changes={"itemId": asset_id, "status": item.status, "trackInventory": item.track_inventory},
            )
            return Response(
                {
                    "message": (
                        f"'{name}' cannot be permanently deleted because it is used in existing records. "
                        "The item was archived instead."
                    ),
                    "archived": True,
                    "status": item.status,
                },
                status=status.HTTP_200_OK,
            )

        create_audit_log(
            user=request.user, action="delete",
            resource=sku, resource_type="Item",
            request=request,
            details=f"Item '{name}' deleted",
            changes={"itemId": asset_id, "sku": sku},
        )
        return Response({"message": f"Item '{name}' deleted."})
