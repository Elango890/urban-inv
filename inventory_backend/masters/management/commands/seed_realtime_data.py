from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from masters.models import Customer, FinancialYear, Item, OrganizationAddress, Vendor
from pettycash.models import PettyCashEntry
from purchases.models import (
    PurchaseEntry,
    PurchaseEntryItem,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchasePayment,
)
from sales.models import SalesInvoice, SalesInvoiceItem, SalesPayment
from stock.models import Stock, StockAdjustment, StockTransfer, Warehouse
from users.models import User


class Command(BaseCommand):
    help = "Create 2-3 sample realtime records for the main inventory modules."

    def handle(self, *args, **options):
        with transaction.atomic():
            data = self._seed()

        self.stdout.write(self.style.SUCCESS("Realtime sample data seeded successfully."))
        for label, count in data.items():
            self.stdout.write(f"{label}: {count}")

    def _seed(self):
        today = timezone.now().date()
        current_year = today.year
        fy, _ = FinancialYear.objects.update_or_create(
            year_name=f"{current_year}-{current_year + 1}",
            defaults={
                "start_date": date(current_year, 4, 1),
                "end_date": date(current_year + 1, 3, 31),
                "is_active": True,
            },
        )

        users = self._create_users()
        admin_user = users["admin"]
        sales_user = users["salesperson"]

        addresses = self._create_addresses()
        vendors = self._create_vendors()
        customers = self._create_customers()
        items = self._create_items(admin_user, vendors)
        warehouses = self._create_warehouses(admin_user)
        stock_data = self._create_stock(items, warehouses, admin_user)
        purchase_data = self._create_purchase_flow(
            fy, admin_user, vendors, items, warehouses["main"], today
        )
        sales_data = self._create_sales_flow(
            fy, sales_user, customers, items, warehouses["main"], today
        )
        petty_cash_entries = self._create_petty_cash_entries(fy, admin_user, today)

        return {
            "users": len(users),
            "organization_addresses": len(addresses),
            "vendors": len(vendors),
            "customers": len(customers),
            "items": len(items),
            "warehouses": len(warehouses),
            "stock_rows": len(stock_data["stocks"]),
            "stock_adjustments": stock_data["adjustments"],
            "stock_transfers": stock_data["transfers"],
            "purchase_orders": purchase_data["orders"],
            "purchase_entries": purchase_data["entries"],
            "purchase_payments": purchase_data["payments"],
            "sales_invoices": sales_data["invoices"],
            "sales_payments": sales_data["payments"],
            "petty_cash_entries": petty_cash_entries,
        }

    def _create_users(self):
        specs = [
            {
                "email": "admin@urbaninventory.local",
                "name": "Urban Admin",
                "role": "admin",
                "department": "Operations",
                "is_staff": True,
                "is_superuser": True,
                "password": "Admin@123",
            },
            {
                "email": "sales@urbaninventory.local",
                "name": "Nadia Sales",
                "role": "salesperson",
                "department": "Sales",
                "is_staff": False,
                "is_superuser": False,
                "password": "Sales@123",
            },
            {
                "email": "store@urbaninventory.local",
                "name": "Imran Store",
                "role": "staff",
                "department": "Warehouse",
                "is_staff": True,
                "is_superuser": False,
                "password": "Store@123",
            },
        ]

        users = {}
        for spec in specs:
            user, created = User.objects.get_or_create(
                email=spec["email"],
                defaults={
                    "name": spec["name"],
                    "role": spec["role"],
                    "department": spec["department"],
                    "is_staff": spec["is_staff"],
                    "is_superuser": spec["is_superuser"],
                },
            )
            changed = False
            for field in ["name", "role", "department", "is_staff", "is_superuser"]:
                value = spec[field]
                if getattr(user, field) != value:
                    setattr(user, field, value)
                    changed = True
            if created or not user.has_usable_password():
                user.set_password(spec["password"])
                changed = True
            if changed:
                user.save()
            users["admin" if spec["role"] == "admin" else spec["role"]] = user
        return users

    def _create_addresses(self):
        specs = [
            {
                "name": "Urban HQ Dubai",
                "attention": "Accounts Team",
                "address_line1": "Office 210, Business Bay",
                "city": "Dubai",
                "state": "Dubai",
                "phone": "+971500001111",
                "is_default": True,
            },
            {
                "name": "Urban Sharjah Store",
                "attention": "Warehouse Desk",
                "address_line1": "Industrial Area 4",
                "city": "Sharjah",
                "state": "Sharjah",
                "phone": "+971500001112",
                "is_default": False,
            },
        ]
        addresses = []
        for spec in specs:
            address, _ = OrganizationAddress.objects.update_or_create(
                name=spec["name"],
                defaults=spec,
            )
            addresses.append(address)
        return addresses

    def _create_vendors(self):
        specs = [
            {
                "display_name": "Gulf Tech Supplies",
                "company_name": "Gulf Tech Supplies LLC",
                "email": "procurement@gulftech.ae",
                "phone": "+971555010101",
                "billing_address_line1": "Al Quoz Industrial Area",
                "billing_city": "Dubai",
                "billing_state": "Dubai",
                "shipping_address_line1": "Al Quoz Warehouse Block A",
                "shipping_city": "Dubai",
                "shipping_state": "Dubai",
                "trn": "100345678900003",
            },
            {
                "display_name": "Desert Office Mart",
                "company_name": "Desert Office Mart Trading",
                "email": "orders@desertoffice.ae",
                "phone": "+971555010202",
                "billing_address_line1": "King Faisal Street",
                "billing_city": "Sharjah",
                "billing_state": "Sharjah",
                "shipping_address_line1": "Sharjah Logistics Hub",
                "shipping_city": "Sharjah",
                "shipping_state": "Sharjah",
                "trn": "100345678900004",
            },
            {
                "display_name": "Prime Service Works",
                "company_name": "Prime Service Works LLC",
                "email": "support@primeservice.ae",
                "phone": "+971555010303",
                "billing_address_line1": "Electra Street",
                "billing_city": "Abu Dhabi",
                "billing_state": "Abu Dhabi",
                "shipping_address_line1": "Electra Street",
                "shipping_city": "Abu Dhabi",
                "shipping_state": "Abu Dhabi",
                "trn": "100345678900005",
            },
        ]
        vendors = []
        for spec in specs:
            vendor, _ = Vendor.objects.update_or_create(
                display_name=spec["display_name"],
                defaults=spec,
            )
            vendors.append(vendor)
        return vendors

    def _create_customers(self):
        specs = [
            {
                "display_name": "Blue Wave Contracting",
                "company_name": "Blue Wave Contracting LLC",
                "email": "accounts@bluewave.ae",
                "phone": "+971566010101",
                "billing_address_line1": "Mussafah M12",
                "billing_city": "Abu Dhabi",
                "billing_state": "Abu Dhabi",
                "shipping_address_line1": "Project Site, Yas Island",
                "shipping_city": "Abu Dhabi",
                "shipping_state": "Abu Dhabi",
                "trn": "100456789000001",
            },
            {
                "display_name": "Sunrise Retail",
                "company_name": "Sunrise Retail FZE",
                "email": "finance@sunriseretail.ae",
                "phone": "+971566010202",
                "billing_address_line1": "Jebel Ali Free Zone",
                "billing_city": "Dubai",
                "billing_state": "Dubai",
                "shipping_address_line1": "JAFZA South",
                "shipping_city": "Dubai",
                "shipping_state": "Dubai",
                "trn": "100456789000002",
            },
            {
                "display_name": "CityCare Clinics",
                "company_name": "CityCare Clinics",
                "email": "payables@citycare.ae",
                "phone": "+971566010303",
                "billing_address_line1": "Corniche Road",
                "billing_city": "Sharjah",
                "billing_state": "Sharjah",
                "shipping_address_line1": "Corniche Road",
                "shipping_city": "Sharjah",
                "shipping_state": "Sharjah",
                "trn": "100456789000003",
            },
        ]
        customers = []
        for spec in specs:
            customer, _ = Customer.objects.update_or_create(
                display_name=spec["display_name"],
                defaults=spec,
            )
            customers.append(customer)
        return customers

    def _create_items(self, admin_user, vendors):
        specs = [
            {
                "sku": "ITM-LED-001",
                "name": "LED Panel Light 24W",
                "item_type": "goods",
                "unit": "pcs",
                "track_inventory": True,
                "cost_price": Decimal("42.00"),
                "selling_price": Decimal("58.00"),
                "tax_rate": Decimal("5.00"),
                "preferred_vendor": vendors[0],
            },
            {
                "sku": "ITM-CAB-002",
                "name": "Cat6 Network Cable Box",
                "item_type": "goods",
                "unit": "box",
                "track_inventory": True,
                "cost_price": Decimal("120.00"),
                "selling_price": Decimal("155.00"),
                "tax_rate": Decimal("5.00"),
                "preferred_vendor": vendors[1],
            },
            {
                "sku": "ITM-SVC-003",
                "name": "Installation Service",
                "item_type": "service",
                "unit": "hr",
                "track_inventory": False,
                "cost_price": Decimal("0.00"),
                "selling_price": Decimal("95.00"),
                "tax_rate": Decimal("5.00"),
                "preferred_vendor": vendors[2],
            },
        ]
        items = []
        for spec in specs:
            item, _ = Item.objects.update_or_create(
                sku=spec["sku"],
                defaults={**spec, "created_by": admin_user},
            )
            items.append(item)
        return items

    def _create_warehouses(self, admin_user):
        specs = [
            {"name": "Main Warehouse", "location": "Dubai Investment Park", "manager": admin_user},
            {"name": "Sharjah Depot", "location": "Sharjah Industrial Area", "manager": admin_user},
        ]
        warehouses = {}
        for spec in specs:
            warehouse, _ = Warehouse.objects.update_or_create(
                name=spec["name"],
                defaults=spec,
            )
            warehouses["main" if "Main" in spec["name"] else "secondary"] = warehouse
        return warehouses

    def _create_stock(self, items, warehouses, admin_user):
        stocks = []
        adjustments_count = 0

        opening_specs = [
            (items[0], warehouses["main"], 40, 8, "OPEN-LED-001"),
            (items[1], warehouses["main"], 18, 5, "OPEN-CAB-002"),
            (items[0], warehouses["secondary"], 12, 3, "OPEN-LED-002"),
        ]
        for item, warehouse, qty, min_stock, ref in opening_specs:
            stock, _ = Stock.objects.get_or_create(
                item=item,
                warehouse=warehouse,
                defaults={"total_quantity": 0, "minimum_stock": min_stock},
            )
            if stock.minimum_stock != min_stock:
                stock.minimum_stock = min_stock
                stock.save(update_fields=["minimum_stock", "updated_at"])
            if not stock.adjustments.filter(reference_no=ref).exists():
                StockAdjustment.objects.create(
                    stock=stock,
                    adjustment_type="add",
                    quantity=qty,
                    reason="Opening balance",
                    reference_no=ref,
                    created_by=admin_user,
                )
                adjustments_count += 1
            stocks.append(stock)

        if not StockTransfer.objects.filter(
            item=items[0],
            from_warehouse=warehouses["main"],
            to_warehouse=warehouses["secondary"],
            quantity=5,
            transfer_date=date.today(),
        ).exists():
            transfer = StockTransfer.objects.create(
                item=items[0],
                from_warehouse=warehouses["main"],
                to_warehouse=warehouses["secondary"],
                quantity=5,
                transfer_date=date.today(),
                reason="Project staging stock",
                status="pending",
                created_by=admin_user,
            )
            transfer.confirm()
            transfers_count = 1
        else:
            transfers_count = 0

        return {
            "stocks": stocks,
            "adjustments": adjustments_count,
            "transfers": transfers_count,
        }

    def _create_purchase_flow(self, fy, admin_user, vendors, items, warehouse, today):
        order_specs = [
            {
                "po_number": "PO-RT-001",
                "vendor": vendors[0],
                "reference_no": "RFQ-1001",
                "order_date": today - timedelta(days=10),
                "expected_date": today - timedelta(days=6),
                "status": "approved",
                "items": [
                    {
                        "item": items[0],
                        "quantity": Decimal("20.00"),
                        "unit_price": Decimal("42.00"),
                        "tax_rate": Decimal("5.00"),
                    }
                ],
            },
            {
                "po_number": "PO-RT-002",
                "vendor": vendors[1],
                "reference_no": "RFQ-1002",
                "order_date": today - timedelta(days=8),
                "expected_date": today - timedelta(days=4),
                "status": "approved",
                "items": [
                    {
                        "item": items[1],
                        "quantity": Decimal("10.00"),
                        "unit_price": Decimal("120.00"),
                        "tax_rate": Decimal("5.00"),
                    }
                ],
            },
        ]

        orders_count = 0
        entries_count = 0
        payments_count = 0

        for spec in order_specs:
            order, created = PurchaseOrder.objects.update_or_create(
                po_number=spec["po_number"],
                defaults={
                    "financial_year": fy,
                    "vendor": spec["vendor"],
                    "reference_no": spec["reference_no"],
                    "order_date": spec["order_date"],
                    "expected_date": spec["expected_date"],
                    "delivery_address_type": "organization",
                    "delivery_address": warehouse.location,
                    "payment_terms": "net_30",
                    "tax_exclusive": True,
                    "tax_level": "item",
                    "status": spec["status"],
                    "notes": "Realtime purchase seed data",
                    "created_by": admin_user,
                    "approved_by": admin_user,
                    "approved_at": timezone.now(),
                },
            )
            if created:
                orders_count += 1
            if not order.items.exists():
                for line in spec["items"]:
                    PurchaseOrderItem.objects.create(
                        order=order,
                        item=line["item"],
                        item_name=line["item"].name,
                        quantity=line["quantity"],
                        unit_price=line["unit_price"],
                        tax_rate=line["tax_rate"],
                    )

            entry_number = spec["po_number"].replace("PO", "PE")
            entry, created = PurchaseEntry.objects.update_or_create(
                entry_number=entry_number,
                defaults={
                    "financial_year": fy,
                    "vendor": spec["vendor"],
                    "purchase_order": order,
                    "vendor_invoice_no": f"VIN-{entry_number}",
                    "invoice_date": spec["order_date"] + timedelta(days=1),
                    "due_date": spec["order_date"] + timedelta(days=31),
                    "is_received": True,
                    "received_at": timezone.now(),
                    "received_by": admin_user,
                    "notes": "Realtime purchase entry seed data",
                    "created_by": admin_user,
                },
            )
            if created:
                entries_count += 1
            if not entry.items.exists():
                for line in spec["items"]:
                    pei = PurchaseEntryItem.objects.create(
                        entry=entry,
                        item=line["item"],
                        item_name=line["item"].name,
                        quantity=line["quantity"],
                        unit_price=line["unit_price"],
                        tax_rate=line["tax_rate"],
                    )
                    pei._record_stock_receipt(warehouse, admin_user)
            if not entry.payments.exists():
                PurchasePayment.objects.create(
                    financial_year=fy,
                    purchase_entry=entry,
                    payment_date=entry.invoice_date + timedelta(days=5),
                    amount=Decimal(str(entry.total_amount)) / Decimal("2"),
                    payment_method="bank_transfer",
                    reference_no=f"PAY-{entry.entry_number}",
                    notes="Seeded partial vendor payment",
                    created_by=admin_user,
                )
                payments_count += 1

        return {
            "orders": orders_count,
            "entries": entries_count,
            "payments": payments_count,
        }

    def _create_sales_flow(self, fy, sales_user, customers, items, warehouse, today):
        invoice_specs = [
            {
                "invoice_number": "INV-RT-001",
                "customer": customers[0],
                "invoice_date": today - timedelta(days=3),
                "lines": [
                    {
                        "item": items[0],
                        "quantity": Decimal("6.00"),
                        "rsp_without_vat": Decimal("58.00"),
                        "tax_rate": Decimal("5.00"),
                    },
                    {
                        "item": items[2],
                        "quantity": Decimal("2.00"),
                        "rsp_without_vat": Decimal("95.00"),
                        "tax_rate": Decimal("5.00"),
                    },
                ],
            },
            {
                "invoice_number": "INV-RT-002",
                "customer": customers[1],
                "invoice_date": today - timedelta(days=2),
                "lines": [
                    {
                        "item": items[1],
                        "quantity": Decimal("3.00"),
                        "rsp_without_vat": Decimal("155.00"),
                        "tax_rate": Decimal("5.00"),
                    }
                ],
            },
            {
                "invoice_number": "INV-RT-003",
                "customer": customers[2],
                "invoice_date": today - timedelta(days=1),
                "lines": [
                    {
                        "item": items[2],
                        "quantity": Decimal("4.00"),
                        "rsp_without_vat": Decimal("95.00"),
                        "tax_rate": Decimal("5.00"),
                    }
                ],
            },
        ]

        invoices_count = 0
        payments_count = 0

        for spec in invoice_specs:
            invoice, created = SalesInvoice.objects.update_or_create(
                invoice_number=spec["invoice_number"],
                defaults={
                    "financial_year": fy,
                    "customer": spec["customer"],
                    "sales_person": sales_user,
                    "invoice_date": spec["invoice_date"],
                    "due_date": spec["invoice_date"] + timedelta(days=15),
                    "tax_enabled": True,
                    "discount_enabled": True,
                    "discount_mode": "percent",
                    "status": "confirmed",
                    "notes": "Realtime sales seed data",
                    "created_by": sales_user,
                },
            )
            invoice.snapshot_customer(spec["customer"])
            invoice.save()
            if created:
                invoices_count += 1

            if not invoice.items.exists():
                for line in spec["lines"]:
                    SalesInvoiceItem.objects.create(
                        invoice=invoice,
                        item=line["item"],
                        item_name=line["item"].name,
                        quantity=line["quantity"],
                        rsp_without_vat=line["rsp_without_vat"],
                        unit_price=line["rsp_without_vat"],
                        tax_rate=line["tax_rate"],
                    )

            if invoice.invoice_number == "INV-RT-001" and not invoice.payments.exists():
                SalesPayment.objects.create(
                    financial_year=fy,
                    sales_invoice=invoice,
                    payment_date=invoice.invoice_date + timedelta(days=1),
                    amount=Decimal(str(invoice.total_amount)) / Decimal("2"),
                    payment_method="upi",
                    reference_no=f"RCPT-{invoice.invoice_number}",
                    notes="Seeded partial customer payment",
                    created_by=sales_user,
                )
                payments_count += 1
            elif invoice.invoice_number == "INV-RT-002" and not invoice.payments.exists():
                SalesPayment.objects.create(
                    financial_year=fy,
                    sales_invoice=invoice,
                    payment_date=invoice.invoice_date + timedelta(days=1),
                    amount=Decimal(str(invoice.total_amount)),
                    payment_method="bank_transfer",
                    reference_no=f"RCPT-{invoice.invoice_number}",
                    notes="Seeded full customer payment",
                    created_by=sales_user,
                )
                payments_count += 1

        self._post_sales_stock(items, warehouse, sales_user)

        return {
            "invoices": invoices_count,
            "payments": payments_count,
        }

    def _post_sales_stock(self, items, warehouse, sales_user):
        dispatch_specs = [
            ("INV-RT-001", items[0], 6),
            ("INV-RT-002", items[1], 3),
        ]
        for invoice_number, item, qty in dispatch_specs:
            invoice = SalesInvoice.objects.get(invoice_number=invoice_number)
            if invoice.stock_posted:
                continue

            stock = Stock.objects.get(item=item, warehouse=warehouse)
            stock.total_quantity = max(0, stock.total_quantity - qty)
            stock.save(update_fields=["total_quantity", "updated_at"])
            item.stock_history.create(
                warehouse=warehouse,
                movement_type="sale_dispatch",
                quantity=qty,
                balance_after=stock.available_quantity,
                reference_type="SalesInvoice",
                reference_id=invoice.pk,
                reason=f"Dispatched via {invoice.invoice_number}",
                performed_by=sales_user,
            )
            invoice.stock_posted = True
            invoice.save(update_fields=["stock_posted", "updated_at"])

    def _create_petty_cash_entries(self, fy, admin_user, today):
        specs = [
            {
                "transaction_date": today - timedelta(days=4),
                "description": "Opening petty cash replenishment",
                "transaction_type": "credit",
                "category": "fund",
                "amount": Decimal("1500.00"),
            },
            {
                "transaction_date": today - timedelta(days=2),
                "description": "Office stationery purchase",
                "transaction_type": "debit",
                "category": "office",
                "amount": Decimal("180.50"),
            },
            {
                "transaction_date": today - timedelta(days=1),
                "description": "Courier and local delivery charges",
                "transaction_type": "debit",
                "category": "logistics",
                "amount": Decimal("95.00"),
            },
        ]

        created_count = 0
        for spec in specs:
            exists = PettyCashEntry.objects.filter(
                transaction_date=spec["transaction_date"],
                description=spec["description"],
                amount=spec["amount"],
            ).exists()
            if exists:
                continue
            PettyCashEntry.objects.create(
                financial_year=fy,
                approved_by=admin_user,
                created_by=admin_user,
                notes="Realtime petty cash seed data",
                **spec,
            )
            created_count += 1
        return created_count
