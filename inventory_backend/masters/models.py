# =============================================================================
# masters/models.py
#
# Core reference data for the entire application.
#
# Models:
#   FinancialYear       — active FY singleton guard
#   OrganizationAddress — company shipping/billing addresses
#   Vendor (+ Supplier alias) — Zoho Books-style vendor
#   Customer            — Zoho Books-style customer
#   Item                — unified Goods + Service catalogue (table: masters_item)
#
# REMOVED vs previous iteration:
#   ✗ Asset / AssetAllocation / AssetCategory  → replaced by clean Item model
#   ✗ Service / ServiceCategory                → services are Item rows (item_type="service")
#   ✗ ItemCategory                             → removed; no category on Item
#   ✗ VendorAMCHistory                         → removed; no AMC module
#   ✗ Vendor.amc_start_date / amc_end_date / support_details / amc_status
#   ✗ Item.category FK                         → removed along with ItemCategory
#   ✗ All legacy backward-compat property aliases except Supplier = Vendor
# =============================================================================

from django.conf import settings
from django.db import models
from django.db.models import Sum


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL CHOICE LISTS  (imported by purchases, sales, petty_cash, stock)
# ─────────────────────────────────────────────────────────────────────────────

PAYMENT_METHOD_CHOICES = [
    ("cash",          "Cash"),
    ("upi",           "UPI"),
    ("bank_transfer", "Bank Transfer"),
    ("card",          "Card"),
    ("cheque",        "Cheque"),
    ("credit",        "Credit / Outstanding"),
    ("other",         "Other"),
]

SALUTATION_CHOICES = [
    ("Mr.",   "Mr."),
    ("Mrs.",  "Mrs."),
    ("Ms.",   "Ms."),
    ("Dr.",   "Dr."),
    ("Prof.", "Prof."),
]

TAX_TREATMENT_CHOICES = [
    ("vat_registered",         "VAT Registered"),
    ("vat_not_registered",     "VAT Not Registered"),
    ("gcc_vat_registered",     "GCC VAT Registered"),
    ("gcc_vat_not_registered", "GCC VAT Not Registered"),
    ("non_gcc",                "Non-GCC"),
    ("deemed_supply",          "Deemed Supply"),
    ("overseas",               "Overseas"),
]

PAYMENT_TERMS_CHOICES = [
    ("due_on_receipt",  "Due On Receipt"),
    ("net_15",          "Net 15"),
    ("net_30",          "Net 30"),
    ("net_45",          "Net 45"),
    ("net_60",          "Net 60"),
    ("cod",             "COD"),
    ("consignment_30",  "Consignment 30 days"),
    ("end_of_month",    "End of Month"),
    ("custom",          "Custom"),
]

CURRENCY_CHOICES = [
    ("AED", "AED - UAE Dirham"),
    ("USD", "USD - US Dollar"),
    ("EUR", "EUR - Euro"),
    ("GBP", "GBP - British Pound"),
    ("SAR", "SAR - Saudi Riyal"),
    ("QAR", "QAR - Qatari Riyal"),
    ("KWD", "KWD - Kuwaiti Dinar"),
    ("BHD", "BHD - Bahraini Dinar"),
    ("OMR", "OMR - Omani Rial"),
]

UAE_EMIRATES_CHOICES = [
    ("abu_dhabi",      "Abu Dhabi"),
    ("dubai",          "Dubai"),
    ("sharjah",        "Sharjah"),
    ("ajman",          "Ajman"),
    ("umm_al_quwain",  "Umm Al Quwain"),
    ("ras_al_khaimah", "Ras Al Khaimah"),
    ("fujairah",       "Fujairah"),
    ("out_of_uae",     "Out of UAE"),
]

UNIT_CHOICES = [
    ("pcs",   "Pieces"),
    ("box",   "Box"),
    ("kg",    "Kilogram"),
    ("g",     "Gram"),
    ("l",     "Litre"),
    ("ml",    "Millilitre"),
    ("m",     "Metre"),
    ("cm",    "Centimetre"),
    ("set",   "Set"),
    ("pair",  "Pair"),
    ("doz",   "Dozen"),
    ("hr",    "Hour"),
    ("day",   "Day"),
    ("month", "Month"),
    ("other", "Other"),
]


# ─────────────────────────────────────────────────────────────────────────────
# ABSTRACT MIXINS
# ─────────────────────────────────────────────────────────────────────────────

class TimeStampMixin(models.Model):
    """Adds created_at / updated_at to any model."""
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class CreatedByMixin(models.Model):
    """Adds a nullable created_by FK to AUTH_USER_MODEL."""
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="+",
    )

    class Meta:
        abstract = True


class LineItemMixin(models.Model):
    """
    Shared calculated fields for every order / invoice line.

    Formula:
        subtotal    = quantity × unit_price
        disc_amount = subtotal × discount / 100
        taxable     = subtotal − disc_amount
        tax_amount  = taxable  × tax_rate / 100
        line_total  = taxable  + tax_amount
    """
    quantity    = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    discount    = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    tax_rate    = models.DecimalField(max_digits=5,  decimal_places=2, default=0)
    subtotal    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    disc_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        abstract = True

    def _get_unit_price(self) -> float:
        return float(getattr(self, "unit_price", 0) or 0)

    def compute_line_totals(self):
        qty      = float(self.quantity or 0)
        price    = self._get_unit_price()
        disc_pct = float(self.discount or 0)
        tax_pct  = float(self.tax_rate or 0)

        self.subtotal    = round(qty * price, 2)
        self.disc_amount = round(float(self.subtotal) * disc_pct / 100, 2)
        taxable          = float(self.subtotal) - float(self.disc_amount)
        self.tax_amount  = round(taxable * tax_pct / 100, 2)
        self.line_total  = round(taxable + float(self.tax_amount), 2)

    def save(self, *args, **kwargs):
        self.compute_line_totals()
        super().save(*args, **kwargs)


class CustomerSnapshotMixin(models.Model):
    """
    Denormalised snapshot of customer data copied onto invoice at creation time.
    The FK is kept so reports can still JOIN; the text fields survive customer edits.
    Call snapshot_customer(customer_instance) before saving the invoice header.
    """
    customer = models.ForeignKey(
        "masters.Customer",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="%(class)s_set",
    )
    customer_name             = models.CharField(max_length=200, default="Walk-in Customer")
    customer_phone            = models.CharField(max_length=50,  blank=True, default="")
    customer_email            = models.CharField(max_length=200, blank=True, default="")
    customer_address          = models.TextField(blank=True, default="")
    customer_shipping_address = models.TextField(blank=True, default="")
    customer_state            = models.CharField(max_length=100, blank=True, default="")
    customer_trn              = models.CharField(max_length=50,  blank=True, default="",
                                                  verbose_name="Customer TRN (snapshot)")

    class Meta:
        abstract = True

    def snapshot_customer(self, customer=None):
        c = customer or self.customer
        if not c:
            return
        self.customer                  = c
        self.customer_name             = c.display_name or c.company_name or c.full_name
        self.customer_phone            = c.phone
        self.customer_email            = c.email or ""
        self.customer_address          = c.billing_address_line1
        self.customer_shipping_address = c.shipping_address_line1 or c.billing_address_line1 or ""
        self.customer_state            = c.billing_state or ""
        self.customer_trn              = c.trn or ""


# ─────────────────────────────────────────────────────────────────────────────
# ORGANIZATION ADDRESS
# ─────────────────────────────────────────────────────────────────────────────

class OrganizationAddress(TimeStampMixin):
    """
    One or more physical addresses for the company itself.
    Exactly one row may have is_default=True at any time.
    """
    name          = models.CharField(max_length=200)
    attention     = models.CharField(max_length=100, blank=True, default="")
    address_line1 = models.TextField()
    address_line2 = models.TextField(blank=True, default="")
    city          = models.CharField(max_length=100, blank=True, default="")
    state         = models.CharField(max_length=100, blank=True, default="")
    country       = models.CharField(max_length=100, default="United Arab Emirates")
    zip           = models.CharField(max_length=20,  blank=True, default="")
    phone         = models.CharField(max_length=50,  blank=True, default="")
    is_default    = models.BooleanField(default=False)
    is_active     = models.BooleanField(default=True)

    class Meta:
        ordering     = ["-is_default", "name", "city"]
        verbose_name = "Organization Address"
        verbose_name_plural = "Organization Addresses"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_default:
            OrganizationAddress.objects.exclude(pk=self.pk).update(is_default=False)

    @property
    def formatted(self):
        return "\n".join(filter(None, [
            self.name, self.attention, self.address_line1, self.address_line2,
            ", ".join(filter(None, [self.city, self.state])),
            self.country, self.zip, self.phone,
        ]))

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────────────────────
# FINANCIAL YEAR
# ─────────────────────────────────────────────────────────────────────────────

class FinancialYear(models.Model):
    """
    Exactly one FY can be active at a time.
    All transactional documents carry a FK to the active FY.
    """
    year_name  = models.CharField(max_length=20, unique=True)
    start_date = models.DateField()
    end_date   = models.DateField()
    is_active  = models.BooleanField(default=False)

    class Meta:
        ordering     = ["-start_date"]
        verbose_name = "Financial Year"

    def save(self, *args, **kwargs):
        if self.is_active:
            FinancialYear.objects.exclude(pk=self.pk).update(is_active=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.year_name

    @classmethod
    def get_active(cls):
        return cls.objects.filter(is_active=True).first()


# ─────────────────────────────────────────────────────────────────────────────
# VENDOR  (table name: masters_supplier for backward migration compat)
# ─────────────────────────────────────────────────────────────────────────────

class Vendor(TimeStampMixin):
    """
    Zoho Books-style Vendor / Supplier.

    Billing address  = where we send our own bills to vendor.
    Shipping address = where vendor ships goods from / to us.
    """

    # ── Primary Contact ────────────────────────────────────────────────────
    salutation = models.CharField(max_length=10, choices=SALUTATION_CHOICES,
                                  blank=True, default="")
    first_name = models.CharField(max_length=100, blank=True, default="")
    last_name  = models.CharField(max_length=100, blank=True, default="")

    # ── Company / Display ──────────────────────────────────────────────────
    company_name = models.CharField(max_length=200, blank=True, default="")
    display_name = models.CharField(max_length=200,
                                    help_text="Name shown on documents (required)")

    # ── Contact Info ───────────────────────────────────────────────────────
    email  = models.EmailField(blank=True, null=True)
    phone  = models.CharField(max_length=20, blank=True, default="")
    mobile = models.CharField(max_length=20, blank=True, default="")

    # ── Tax / Compliance ───────────────────────────────────────────────────
    tax_treatment    = models.CharField(max_length=30, choices=TAX_TREATMENT_CHOICES,
                                        default="vat_registered")
    trn              = models.CharField(max_length=20, blank=True, default="",
                                        verbose_name="Tax Registration Number (TRN)")
    pan              = models.CharField(max_length=12, blank=True, default="")
    source_of_supply = models.CharField(max_length=30, choices=UAE_EMIRATES_CHOICES,
                                        blank=True, default="",
                                        help_text="Emirate / source of supply")

    # ── Financial ──────────────────────────────────────────────────────────
    currency      = models.CharField(max_length=5,  choices=CURRENCY_CHOICES,      default="AED")
    payment_terms = models.CharField(max_length=20, choices=PAYMENT_TERMS_CHOICES, default="net_30")
    price_list    = models.CharField(max_length=100, blank=True, default="")
    credit_limit  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    outstanding   = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # ── Bank Details ───────────────────────────────────────────────────────
    bank_name    = models.CharField(max_length=100, blank=True, default="")
    bank_account = models.CharField(max_length=30,  blank=True, default="")
    bank_ifsc    = models.CharField(max_length=15,  blank=True, default="")

    # ── Billing Address ────────────────────────────────────────────────────
    billing_attention     = models.CharField(max_length=150, blank=True, default="")
    billing_country       = models.CharField(max_length=100, blank=True, default="United Arab Emirates")
    billing_address_line1 = models.TextField(blank=True, default="")
    billing_address_line2 = models.TextField(blank=True, default="")
    billing_city          = models.CharField(max_length=100, blank=True, default="")
    billing_state         = models.CharField(max_length=100, blank=True, default="")
    billing_zip           = models.CharField(max_length=20,  blank=True, default="")
    billing_phone         = models.CharField(max_length=20,  blank=True, default="")
    billing_fax           = models.CharField(max_length=20,  blank=True, default="")

    # ── Shipping Address ───────────────────────────────────────────────────
    shipping_attention     = models.CharField(max_length=150, blank=True, default="")
    shipping_country       = models.CharField(max_length=100, blank=True, default="United Arab Emirates")
    shipping_address_line1 = models.TextField(blank=True, default="")
    shipping_address_line2 = models.TextField(blank=True, default="")
    shipping_city          = models.CharField(max_length=100, blank=True, default="")
    shipping_state         = models.CharField(max_length=100, blank=True, default="")
    shipping_zip           = models.CharField(max_length=20,  blank=True, default="")
    shipping_phone         = models.CharField(max_length=20,  blank=True, default="")
    shipping_fax           = models.CharField(max_length=20,  blank=True, default="")

    # ── Documents / Notes ─────────────────────────────────────────────────
    notes     = models.TextField(blank=True, default="")
    documents = models.JSONField(default=list, blank=True,
                                 help_text="List of uploaded document metadata dicts")

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering     = ["display_name"]
        verbose_name = "Vendor"

    # ── Helpers ────────────────────────────────────────────────────────────
    @property
    def full_name(self):
        return " ".join(p for p in [self.salutation, self.first_name, self.last_name] if p).strip()

    @property
    def name(self):
        """Backward-compatible alias used throughout views."""
        return self.display_name or self.company_name or self.full_name

    def __str__(self):
        return self.display_name or self.company_name or self.full_name

    def sync_outstanding(self):
        from purchases.models import PurchaseEntry
        qs = PurchaseEntry.objects.filter(vendor=self).exclude(payment_status="paid")
        total_invoiced = qs.aggregate(t=Sum("total_amount"))["t"] or 0
        total_paid     = qs.aggregate(t=Sum("paid_amount"))["t"] or 0
        new_val = max(0, float(total_invoiced) - float(total_paid))
        Vendor.objects.filter(pk=self.pk).update(outstanding=new_val)
        self.outstanding = new_val

    @property
    def available_credit(self):
        return max(0, float(self.credit_limit) - float(self.outstanding))

    @property
    def gstin(self):
        """Backward-compatible alias for older supplier payloads."""
        return self.trn


# Backward-compatible alias — purchases.models still imports "Supplier"
Supplier = Vendor


# ─────────────────────────────────────────────────────────────────────────────
# CUSTOMER
# ─────────────────────────────────────────────────────────────────────────────

class Customer(TimeStampMixin):
    """
    Zoho Books-style Customer.
    customer_type distinguishes Business vs Individual.
    Full billing + shipping address stored directly on the record.
    """

    CUSTOMER_TYPE_CHOICES = (
        ("business",   "Business"),
        ("individual", "Individual"),
    )

    # ── Primary Contact ────────────────────────────────────────────────────
    salutation = models.CharField(max_length=10, choices=SALUTATION_CHOICES,
                                  blank=True, default="")
    first_name = models.CharField(max_length=100, blank=True, default="")
    last_name  = models.CharField(max_length=100, blank=True, default="")

    # ── Company / Display ──────────────────────────────────────────────────
    company_name      = models.CharField(max_length=200, blank=True, default="")
    display_name      = models.CharField(max_length=200,
                                         help_text="Name shown on documents (required)")
    customer_type     = models.CharField(max_length=20, choices=CUSTOMER_TYPE_CHOICES,
                                         default="business")
    customer_language = models.CharField(max_length=50, blank=True, default="English")

    # ── Contact Info ───────────────────────────────────────────────────────
    email  = models.EmailField(blank=True, null=True)
    phone  = models.CharField(max_length=20, blank=True, default="")
    mobile = models.CharField(max_length=20, blank=True, default="")

    # ── Tax / Compliance ───────────────────────────────────────────────────
    tax_treatment   = models.CharField(max_length=30, choices=TAX_TREATMENT_CHOICES,
                                       default="vat_registered")
    trn             = models.CharField(max_length=20, blank=True, default="",
                                       verbose_name="Tax Registration Number (TRN)")
    pan             = models.CharField(max_length=12, blank=True, default="")
    place_of_supply = models.CharField(max_length=30, choices=UAE_EMIRATES_CHOICES,
                                       blank=True, default="",
                                       help_text="Emirate / place of supply")

    # ── Financial ──────────────────────────────────────────────────────────
    currency      = models.CharField(max_length=5,  choices=CURRENCY_CHOICES,      default="AED")
    payment_terms = models.CharField(max_length=20, choices=PAYMENT_TERMS_CHOICES, default="net_30")
    price_list    = models.CharField(max_length=100, blank=True, default="")
    credit_limit  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    outstanding   = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    # ── Billing Address ────────────────────────────────────────────────────
    billing_attention     = models.CharField(max_length=150, blank=True, default="")
    billing_country       = models.CharField(max_length=100, blank=True, default="United Arab Emirates")
    billing_address_line1 = models.TextField(blank=True, default="")
    billing_address_line2 = models.TextField(blank=True, default="")
    billing_city          = models.CharField(max_length=100, blank=True, default="")
    billing_state         = models.CharField(max_length=100, blank=True, default="")
    billing_zip           = models.CharField(max_length=20,  blank=True, default="")
    billing_phone         = models.CharField(max_length=20,  blank=True, default="")
    billing_fax           = models.CharField(max_length=20,  blank=True, default="")

    # ── Shipping Address ───────────────────────────────────────────────────
    shipping_attention     = models.CharField(max_length=150, blank=True, default="")
    shipping_country       = models.CharField(max_length=100, blank=True, default="United Arab Emirates")
    shipping_address_line1 = models.TextField(blank=True, default="")
    shipping_address_line2 = models.TextField(blank=True, default="")
    shipping_city          = models.CharField(max_length=100, blank=True, default="")
    shipping_state         = models.CharField(max_length=100, blank=True, default="")
    shipping_zip           = models.CharField(max_length=20,  blank=True, default="")
    shipping_phone         = models.CharField(max_length=20,  blank=True, default="")
    shipping_fax           = models.CharField(max_length=20,  blank=True, default="")

    # ── Documents / Notes ─────────────────────────────────────────────────
    notes     = models.TextField(blank=True, default="")
    documents = models.JSONField(default=list, blank=True,
                                 help_text="List of uploaded document metadata dicts")

    is_active = models.BooleanField(default=True)

    class Meta:
        ordering     = ["display_name"]
        verbose_name = "Customer"

    @property
    def full_name(self):
        return " ".join(p for p in [self.salutation, self.first_name, self.last_name] if p).strip()

    @property
    def name(self):
        """Backward-compatible alias."""
        return self.display_name or self.company_name or self.full_name

    def __str__(self):
        return self.display_name or self.company_name or self.full_name

    def sync_outstanding(self):
        from sales.models import SalesInvoice, SalesReturn
        from django.db.models import Q
        qs = SalesInvoice.objects.filter(customer=self).exclude(
            Q(status="cancelled") | Q(payment_status="paid")
        )
        total_invoiced = qs.aggregate(t=Sum("total_amount"))["t"] or 0
        total_paid     = qs.aggregate(t=Sum("paid_amount"))["t"] or 0
        total_returns = (
            SalesReturn.objects.filter(customer=self, status="confirmed")
            .aggregate(t=Sum("total_amount"))["t"]
            or 0
        )
        new_val = max(0, float(total_invoiced) - float(total_paid) - float(total_returns))
        Customer.objects.filter(pk=self.pk).update(outstanding=new_val)
        self.outstanding = new_val

    @property
    def available_credit(self):
        return max(0, float(self.credit_limit) - float(self.outstanding))


# ─────────────────────────────────────────────────────────────────────────────
# ITEM  (unified Goods + Services catalogue)
# ─────────────────────────────────────────────────────────────────────────────

class Item(TimeStampMixin, CreatedByMixin):
    """
    Zoho Books-style Item — the single catalogue for everything bought or sold.

    item_type = "goods"   → physical product with optional inventory tracking
    item_type = "service" → labour / service; track_inventory is always False

    Design decisions:
      • Single SKU field — the unique item code, no legacy aliases.
      • No category FK — items are identified by sku, name, and item_type only.
      • preferred_vendor FK for PO auto-fill.
      • tax_rate is the default; overridable per line item.
      • sales_account / purchase_account are plain-text GL account labels.
    """

    ITEM_TYPE_CHOICES = (
        ("goods",   "Goods"),
        ("service", "Service"),
    )

    STATUS_CHOICES = (
        ("active",   "Active"),
        ("inactive", "Inactive"),
    )

    # ── Identity ───────────────────────────────────────────────────────────
    item_type = models.CharField(max_length=10, choices=ITEM_TYPE_CHOICES,
                                 default="goods",
                                 help_text="Goods = physical product; Service = labour/service")
    name      = models.CharField(max_length=200)
    sku       = models.CharField(max_length=50, unique=True,
                                 help_text="Stock Keeping Unit — unique item code")

    # ── Physical details (Goods only) ──────────────────────────────────────
    unit            = models.CharField(max_length=10, choices=UNIT_CHOICES,
                                       blank=True, default="pcs")
    barcode         = models.CharField(max_length=100, blank=True, default="")
    is_excise_product = models.BooleanField(default=False)
    track_inventory   = models.BooleanField(
        default=True,
        help_text="Enables stock tracking. Always False for service items.",
    )

    # ── Pricing ────────────────────────────────────────────────────────────
    selling_price = models.DecimalField(max_digits=14, decimal_places=2, default=0,
                                        help_text="Default unit selling price")
    cost_price    = models.DecimalField(max_digits=14, decimal_places=2, default=0,
                                        help_text="Default unit cost / purchase price")

    # ── Tax ────────────────────────────────────────────────────────────────
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=5,
                                   help_text="Default VAT % applied to this item")

    # ── GL Accounts ────────────────────────────────────────────────────────
    sales_account    = models.CharField(max_length=100, blank=True, default="Sales",
                                        help_text="GL account label for sales")
    purchase_account = models.CharField(max_length=100, blank=True,
                                        default="Cost of Goods Sold",
                                        help_text="GL account label for purchases")

    # ── Document Descriptions ──────────────────────────────────────────────
    sales_description    = models.TextField(blank=True, default="",
                                            help_text="Description printed on sales documents")
    purchase_description = models.TextField(blank=True, default="",
                                            help_text="Description printed on purchase documents")

    # ── Preferred Vendor ───────────────────────────────────────────────────
    preferred_vendor = models.ForeignKey(
        Vendor,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="preferred_items",
        help_text="Default vendor auto-filled on new purchase orders",
    )

    # ── Status ─────────────────────────────────────────────────────────────
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="active")

    class Meta:
        ordering     = ["name"]
        verbose_name = "Item"

    def __str__(self):
        return f"{self.sku} — {self.name}"

    def save(self, *args, **kwargs):
        # Services never track inventory
        if self.item_type == "service":
            self.track_inventory = False
        super().save(*args, **kwargs)

    @property
    def is_service(self):
        return self.item_type == "service"

    @property
    def is_goods(self):
        return self.item_type == "goods"

    @property
    def total_stock(self):
        """
        Sum of available_quantity across all warehouses.
        Returns 0 for service items or items with track_inventory=False.
        """
        if not self.track_inventory:
            return 0
        from stock.models import Stock
        return sum(s.available_quantity for s in self.stock_entries.all())

    @property
    def is_in_stock(self):
        return self.total_stock > 0

    @property
    def asset_code(self):
        return self.sku

    @property
    def code(self):
        return self.sku

    @property
    def purchase_cost(self):
        return self.cost_price

    @property
    def is_active(self):
        return self.status == "active"


# Backward-compatible aliases for legacy imports in views/modules that still
# use the older Asset/Service naming. Both map to the unified Item model.
Asset = Item
Service = Item
