// src/pages/Vendors.tsx
// Aligned to updated backend:
//   - Vendor fields: displayName, firstName, lastName, salutation, companyName,
//     taxTreatment, trn, pan, sourceOfSupply, currency, paymentTerms, priceList,
//     creditLimit, outstanding, bankName, bankAccount, bankIfsc,
//     billingAddress{...}, shippingAddress{...}, notes, isActive
//   - NO amc_start_date / amc_end_date / support_details on Vendor (moved to VendorAMCHistory)
//   - NO renew-amc route (removed from urls.py)
//   - Purchase history: GET /suppliers/<id>/purchase-history/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  PiggyBank,
  Phone,
  Plus,
  Send,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL =
  (window as any).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingAddress {
  attention: string;
  country: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
}

const EMPTY_ADDRESS_FALLBACK: BillingAddress = {
  attention: "",
  country: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  fax: "",
};

export interface VendorData {
  id: number;
  salutation: string;
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  displayName: string;
  email: string | null;
  phone: string;
  mobile: string;
  taxTreatment: string;
  trn: string;
  pan: string;
  sourceOfSupply: string;
  currency: string;
  paymentTerms: string;
  priceList: string;
  creditLimit: number;
  outstanding: number;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  billingAddress: BillingAddress;
  shippingAddress: BillingAddress;
  notes: string;
  isActive: boolean;
  createdAt: string;
  totalPurchases: number;
}

interface PurchaseEntry {
  id: number;
  entryNumber: string;
  supplierInvoice: string;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: string;
  financialYear: string;
  purchaseOrderNo?: string | null;
  itemCount?: number;
  paymentCount?: number;
  isReceived?: boolean;
  receivedAt?: string | null;
}

interface PurchaseOrderSummary {
  id: number;
  poNumber: string;
  referenceNo: string;
  orderDate: string;
  expectedDate: string | null;
  financialYear: string | null;
  paymentTerms: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
  entryCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface PurchasePaymentSummary {
  id: number;
  entryId: number;
  entryNumber: string;
  paymentDate: string;
  financialYear: string | null;
  amount: number;
  paymentMethod: string;
  referenceNo: string;
  notes: string;
}

interface PurchaseEntryLineItemDetail {
  id?: number;
  itemName: string;
  assetCode?: string | null;
  account?: string;
  batchNumber?: string;
  expiryDate?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal?: number;
  subtotal?: number;
  taxAmount?: number;
  discAmount?: number;
  notes?: string;
}

interface PurchaseEntryPaymentDetail {
  id: number;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
  createdAt?: string;
}

interface PurchaseEntryDetailData {
  id: number;
  entryNumber: string;
  supplierInvoiceNo: string;
  invoiceDate: string | null;
  dueDate: string | null;
  supplier: { id: number; name: string };
  purchaseOrderId: number | null;
  purchaseOrderNo: string | null;
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: string;
  paymentStatusDisplay: string;
  isReceived: boolean;
  receivedAt: string | null;
  receivedBy: string | null;
  hasInvoiceFile: boolean;
  notes: string;
  items?: PurchaseEntryLineItemDetail[];
  payments?: PurchaseEntryPaymentDetail[];
}

interface PurchaseOrderLineItemDetail {
  id?: number;
  itemName: string;
  account?: string;
  batchNumber?: string;
  expiryDate?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal?: number;
  notes?: string;
}

interface PurchaseOrderDetailData {
  id: number;
  poNumber: string;
  referenceNo?: string;
  orderDate: string;
  expectedDate: string | null;
  supplier: { id: number; name: string };
  deliveryAddress?: string;
  shipmentPreference?: string;
  paymentTerms?: string;
  taxExclusive?: boolean;
  taxLevel?: string;
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  statusDisplay: string;
  notes: string;
  items?: PurchaseOrderLineItemDetail[];
  createdBy?: string;
  createdAt?: string;
}

interface VendorPettyCashEntry {
  id: number;
  date: string;
  description: string;
  type: "credit" | "debit";
  amount: number;
  balance: number;
  category: string;
  categoryDisplay: string;
  relatedPartyType: "own" | "customer" | "vendor";
  relatedPartyTypeDisplay: string;
  vendorId?: number | null;
  vendorName?: string | null;
  approvedBy: string;
  createdBy: string;
  notes?: string;
}

interface VendorDetailData extends VendorData {
  summary: {
    totalPurchases: number;
    totalPaid: number;
    totalBalance: number;
    totalEntries: number;
    unpaidEntries: number;
    partialEntries: number;
    paidEntries: number;
    totalOrders: number;
    draftOrders: number;
    approvedOrders: number;
    receivedOrders: number;
    partialOrders: number;
    cancelledOrders: number;
    totalOrderedValue: number;
    totalPayments: number;
    totalPaymentAmount: number;
  };
  purchaseEntries: PurchaseEntry[];
  purchaseOrders: PurchaseOrderSummary[];
  payments: PurchasePaymentSummary[];
  pettyCash: VendorPettyCashEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user?.access_token || ""}`,
  };
}

async function apiFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (res.status === 401) {
    window.sessionStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok)
    throw Object.assign(new Error((body as any)?.error ?? "Request failed"), {
      body,
    });
  return body;
}

async function downloadBlobFile(path: string, payload: unknown, filename: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    const body = ct.includes("application/json")
      ? await res.json()
      : await res.text();
    throw Object.assign(new Error((body as any)?.error ?? "Download failed"), { body });
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TAX_TREATMENT_OPTIONS = [
  { value: "vat_registered", label: "VAT Registered" },
  { value: "vat_not_registered", label: "VAT Not Registered" },
  { value: "gcc_vat_registered", label: "GCC VAT Registered" },
  { value: "gcc_vat_not_registered", label: "GCC VAT Not Registered" },
  { value: "non_gcc", label: "Non-GCC" },
  { value: "deemed_supply", label: "Deemed Supply" },
  { value: "overseas", label: "Overseas" },
];

const PAYMENT_TERMS_OPTIONS = [
  { value: "due_on_receipt", label: "Due On Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
  { value: "cod", label: "COD" },
  { value: "consignment_30", label: "Consignment 30 days" },
  { value: "end_of_month", label: "End of Month" },
  { value: "custom", label: "Custom" },
];

const CURRENCY_OPTIONS = [
  { value: "AED", label: "AED - UAE Dirham" },
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "SAR", label: "SAR - Saudi Riyal" },
    { value: "QAR", label: "QAR - Qatari Riyal" },
  { value: "KWD", label: "KWD - Kuwaiti Dinar" },
  { value: "BHD", label: "BHD - Bahraini Dinar" },
  { value: "OMR", label: "OMR - Omani Rial" },
];

const UAE_EMIRATES_OPTIONS = [
  { value: "", label: "Select Emirate…" },
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "dubai", label: "Dubai" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
  { value: "out_of_uae", label: "Out of UAE" },
];

const DETAIL_PAGE_SIZE_OPTIONS = [5, 10, 25];

// ─── Form state ───────────────────────────────────────────────────────────────

const EMPTY_ADDRESS = {
  attention: "",
  country: "United Arab Emirates",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  fax: "",
};

const EMPTY_FORM = {
  salutation: "",
  firstName: "",
  lastName: "",
  companyName: "",
  displayName: "",
  email: "",
  phone: "",
  mobile: "",
  taxTreatment: "vat_registered",
  trn: "",
  pan: "",
  sourceOfSupply: "",
  currency: "AED",
  paymentTerms: "net_30",
  priceList: "",
  creditLimit: "",
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  billingAddress: { ...EMPTY_ADDRESS },
  shippingAddress: { ...EMPTY_ADDRESS },
  notes: "",
  isActive: true,
};

type FormState = typeof EMPTY_FORM;
type FormErrors = Partial<Record<string, string>>;

// ─── Validation ───────────────────────────────────────────────────────────────

function validateVendorForm(form: FormState): FormErrors {
  const e: FormErrors = {};
  if (!form.displayName.trim()) e.displayName = "Display name is required.";
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    e.email = "Enter a valid email address.";
  if (form.phone && !/^[\d\s\+\-\(\)]{7,20}$/.test(form.phone))
    e.phone = "Enter a valid phone number.";
  if (form.trn && !/^\d{15}$/.test(form.trn.replace(/\s/g, "")))
    e.trn = "TRN must be 15 digits.";
  if (
    form.creditLimit !== "" &&
    (isNaN(Number(form.creditLimit)) || Number(form.creditLimit) < 0)
  )
    e.creditLimit = "Credit limit must be a non-negative number.";
  return e;
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
      className,
    )}
  />
);

const Sel = ({
  className,
  children,
  ...p
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  children: React.ReactNode;
}) => (
  <select
    {...p}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors appearance-none",
      className,
    )}
  >
    {children}
  </select>
);

const FieldRow = ({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
      {label}
      {required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-xs text-rose-500 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> {error}
      </p>
    )}
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
    {children}
  </p>
);

// ─── Vendor Form Dialog ───────────────────────────────────────────────────────

function VendorFormDialog({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: VendorData | null;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    billingAddress: { ...EMPTY_ADDRESS },
    shippingAddress: { ...EMPTY_ADDRESS },
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [shipSame, setShipSame] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "basic" | "tax" | "address" | "bank"
  >("basic");
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setActiveTab("basic");
    if (initial) {
      setForm({
        salutation: initial.salutation || "",
        firstName: initial.firstName || "",
        lastName: initial.lastName || "",
        companyName: initial.companyName || "",
        displayName: initial.displayName || "",
        email: initial.email || "",
        phone: initial.phone || "",
        mobile: initial.mobile || "",
        taxTreatment: initial.taxTreatment || "vat_registered",
        trn: initial.trn || "",
        pan: initial.pan || "",
        sourceOfSupply: initial.sourceOfSupply || "",
        currency: initial.currency || "AED",
        paymentTerms: initial.paymentTerms || "net_30",
        priceList: initial.priceList || "",
        creditLimit: String(initial.creditLimit ?? ""),
        bankName: initial.bankName || "",
        bankAccount: initial.bankAccount || "",
        bankIfsc: initial.bankIfsc || "",
        billingAddress: initial.billingAddress
          ? { ...EMPTY_ADDRESS, ...initial.billingAddress }
          : { ...EMPTY_ADDRESS },
        shippingAddress: initial.shippingAddress
          ? { ...EMPTY_ADDRESS, ...initial.shippingAddress }
          : { ...EMPTY_ADDRESS },
        notes: initial.notes || "",
        isActive: initial.isActive ?? true,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        billingAddress: { ...EMPTY_ADDRESS },
        shippingAddress: { ...EMPTY_ADDRESS },
      });
      setShipSame(false);
    }
  }, [open, initial]);

  const set = (k: string, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };

  const setAddr = (
    type: "billingAddress" | "shippingAddress",
    k: string,
    v: string,
  ) => {
    setForm((f) => ({
      ...f,
      [type]: { ...(f[type] as BillingAddress), [k]: v },
    }));
  };

  // Sync shipping = billing
  useEffect(() => {
    if (shipSame) {
      setForm((f) => ({
        ...f,
        shippingAddress: { ...(f.billingAddress as BillingAddress) },
      }));
    }
  }, [shipSame, form.billingAddress]);

  const handleSave = async () => {
    const errs = validateVendorForm(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setActiveTab("basic");
      toast({ title: "Please fix the errors", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        creditLimit: form.creditLimit === "" ? 0 : Number(form.creditLimit),
        email: form.email || null,
      };
      const url = isEdit
        ? `${API_URL}/api/masters/suppliers/${initial!.id}/`
        : `${API_URL}/api/masters/suppliers/create/`;
      await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast({ title: isEdit ? "Vendor updated" : "Vendor created" });
      onSaved();
      onClose();
    } catch (err: any) {
      const body = err.body;
      if (body?.errors && typeof body.errors === "object") {
        setErrors(body.errors);
      } else {
        toast({
          title: "Error",
          description: getApiErrorMessage(err),
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const tabs = [
    { key: "basic", label: "Basic Info" },
    { key: "tax", label: "Tax & Finance" },
    { key: "address", label: "Address" },
    { key: "bank", label: "Bank" },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <h2 className="font-bold">
              {isEdit ? "Edit Vendor" : "New Vendor"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-4 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-semibold border transition-colors",
                activeTab === t.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Basic Info */}
          {activeTab === "basic" && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4 space-y-4">
                <SectionTitle>Primary Contact</SectionTitle>
                <div className="grid grid-cols-4 gap-3">
                  <FieldRow label="Salutation">
                    <Sel
                      value={form.salutation}
                      onChange={(e) => set("salutation", e.target.value)}
                    >
                      <option value="">—</option>
                      {["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Sel>
                  </FieldRow>
                  <FieldRow label="First Name">
                    <Inp
                      value={form.firstName}
                      onChange={(e) => set("firstName", e.target.value)}
                      placeholder="First"
                    />
                  </FieldRow>
                  <FieldRow label="Last Name">
                    <Inp
                      value={form.lastName}
                      onChange={(e) => set("lastName", e.target.value)}
                      placeholder="Last"
                    />
                  </FieldRow>
                  <FieldRow label="Mobile">
                    <Inp
                      value={form.mobile}
                      onChange={(e) => set("mobile", e.target.value)}
                      placeholder="+971..."
                    />
                  </FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FieldRow label="Company Name">
                    <Inp
                      value={form.companyName}
                      onChange={(e) => set("companyName", e.target.value)}
                      placeholder="Company / Organization"
                    />
                  </FieldRow>
                  <FieldRow
                    label="Display Name"
                    required
                    error={errors.displayName}
                  >
                    <Inp
                      value={form.displayName}
                      onChange={(e) => set("displayName", e.target.value)}
                      placeholder="Name shown on documents"
                      className={errors.displayName ? "border-rose-500" : ""}
                    />
                  </FieldRow>
                  <FieldRow label="Email" error={errors.email}>
                    <Inp
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="vendor@example.com"
                      className={errors.email ? "border-rose-500" : ""}
                    />
                  </FieldRow>
                  <FieldRow label="Phone" error={errors.phone}>
                    <Inp
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="+971 4 xxx xxxx"
                      className={errors.phone ? "border-rose-500" : ""}
                    />
                  </FieldRow>
                </div>
                <FieldRow label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    placeholder="Internal notes…"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                </FieldRow>
                {isEdit && (
                  <FieldRow label="Status">
                    <div className="flex gap-2">
                      {[true, false].map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => set("isActive", v)}
                          className={cn(
                            "h-9 px-4 rounded-lg border text-xs font-semibold transition-colors",
                            form.isActive === v
                              ? v
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-rose-600 text-white border-rose-600"
                              : "border-border text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {v ? "Active" : "Inactive"}
                        </button>
                      ))}
                    </div>
                  </FieldRow>
                )}
              </div>
            </div>
          )}

          {/* Tax & Finance */}
          {activeTab === "tax" && (
            <div className="rounded-xl border p-4 space-y-4">
              <SectionTitle>Tax & Compliance</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Tax Treatment">
                  <Sel
                    value={form.taxTreatment}
                    onChange={(e) => set("taxTreatment", e.target.value)}
                  >
                    {TAX_TREATMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Sel>
                </FieldRow>
                <FieldRow label="TRN (Tax Reg. No.)" error={errors.trn}>
                  <Inp
                    value={form.trn}
                    onChange={(e) => set("trn", e.target.value)}
                    placeholder="15-digit TRN"
                    maxLength={15}
                    className={errors.trn ? "border-rose-500" : ""}
                  />
                </FieldRow>
                <FieldRow label="PAN">
                  <Inp
                    value={form.pan}
                    onChange={(e) => set("pan", e.target.value)}
                    placeholder="PAN number"
                  />
                </FieldRow>
                <FieldRow label="Source of Supply">
                  <Sel
                    value={form.sourceOfSupply}
                    onChange={(e) => set("sourceOfSupply", e.target.value)}
                  >
                    {UAE_EMIRATES_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Sel>
                </FieldRow>
              </div>
              <SectionTitle>Financial</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Currency">
                  <Sel
                    value={form.currency}
                    onChange={(e) => set("currency", e.target.value)}
                  >
                    {CURRENCY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Sel>
                </FieldRow>
                <FieldRow label="Payment Terms">
                  <Sel
                    value={form.paymentTerms}
                    onChange={(e) => set("paymentTerms", e.target.value)}
                  >
                    {PAYMENT_TERMS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Sel>
                </FieldRow>
                <FieldRow label="Price List">
                  <Inp
                    value={form.priceList}
                    onChange={(e) => set("priceList", e.target.value)}
                    placeholder="Price list name"
                  />
                </FieldRow>
                <FieldRow label="Credit Limit" error={errors.creditLimit}>
                  <Inp
                    type="text"
                    inputMode="decimal"
                    value={form.creditLimit}
                    onChange={(e) => {
                      if (/^\d*\.?\d*$/.test(e.target.value))
                        set("creditLimit", e.target.value);
                    }}
                    placeholder="0.00"
                    className={errors.creditLimit ? "border-rose-500" : ""}
                  />
                </FieldRow>
              </div>
            </div>
          )}

          {/* Address */}
          {activeTab === "address" && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4 space-y-4">
                <SectionTitle>Billing Address</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      "attention",
                      "country",
                      "addressLine1",
                      "addressLine2",
                      "city",
                      "state",
                      "zip",
                      "phone",
                      "fax",
                    ] as const
                  ).map((k) => (
                    <FieldRow
                      key={k}
                      label={k
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (c) => c.toUpperCase())}
                    >
                      <Inp
                        value={(form.billingAddress as any)[k] || ""}
                        onChange={(e) =>
                          setAddr("billingAddress", k, e.target.value)
                        }
                        placeholder={
                          k === "country" ? "United Arab Emirates" : ""
                        }
                      />
                    </FieldRow>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <SectionTitle>Shipping Address</SectionTitle>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shipSame}
                      onChange={(e) => setShipSame(e.target.checked)}
                      className="rounded"
                    />
                    Same as billing
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      "attention",
                      "country",
                      "addressLine1",
                      "addressLine2",
                      "city",
                      "state",
                      "zip",
                      "phone",
                      "fax",
                    ] as const
                  ).map((k) => (
                    <FieldRow
                      key={k}
                      label={k
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (c) => c.toUpperCase())}
                    >
                      <Inp
                        value={(form.shippingAddress as any)[k] || ""}
                        onChange={(e) =>
                          setAddr("shippingAddress", k, e.target.value)
                        }
                        disabled={shipSame}
                        className={
                          shipSame ? "opacity-50 cursor-not-allowed" : ""
                        }
                      />
                    </FieldRow>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bank */}
          {activeTab === "bank" && (
            <div className="rounded-xl border p-4 space-y-4">
              <SectionTitle>Bank Details</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Bank Name">
                  <Inp
                    value={form.bankName}
                    onChange={(e) => set("bankName", e.target.value)}
                    placeholder="e.g. Emirates NBD"
                  />
                </FieldRow>
                <FieldRow label="Account Number">
                  <Inp
                    value={form.bankAccount}
                    onChange={(e) => set("bankAccount", e.target.value)}
                    placeholder="Account number"
                  />
                </FieldRow>
                <FieldRow label="IFSC / SWIFT Code">
                  <Inp
                    value={form.bankIfsc}
                    onChange={(e) => set("bankIfsc", e.target.value)}
                    placeholder="IFSC or SWIFT"
                  />
                </FieldRow>
              </div>
            </div>
          )}

          {/* Error summary */}
          {Object.keys(errors).length > 0 && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <p className="text-xs font-semibold text-rose-600 mb-1">
                Please fix the following:
              </p>
              <ul className="space-y-0.5">
                {Object.entries(errors).map(([k, v]) => (
                  <li
                    key={k}
                    className="text-xs text-rose-500 flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" /> {v}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5 pt-4 border-t shrink-0">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── View Vendor Dialog ────────────────────────────────────────────────────────

function ViewVendorDialog({
  open,
  onClose,
  vendor,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  vendor: VendorData | null;
  onEdit: (vendor: VendorData) => void;
  onDelete: (vendor: VendorData) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<VendorDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "comments" | "transactions" | "mails" | "statement"
  >("overview");
  const [selectedDetail, setSelectedDetail] = useState<{
    title: string;
    subtitle?: string;
    sections: Array<{
      title: string;
      rows: Array<{ label: string; value: string }>;
    }>;
  } | null>(null);
  const [entryDetail, setEntryDetail] = useState<PurchaseEntryDetailData | null>(null);
  const [orderDetail, setOrderDetail] = useState<PurchaseOrderDetailData | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<PurchasePaymentSummary | null>(null);
  const [pettyCashDetail, setPettyCashDetail] = useState<VendorPettyCashEntry | null>(null);
  const [detailLoadingType, setDetailLoadingType] = useState<null | "entry" | "order" | "payment" | "pettycash">(null);
  const [entryPage, setEntryPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [mailPage, setMailPage] = useState(1);
  const [pettyCashPage, setPettyCashPage] = useState(1);
  const [entryPageSize, setEntryPageSize] = useState(5);
  const [orderPageSize, setOrderPageSize] = useState(5);
  const [paymentPageSize, setPaymentPageSize] = useState(5);
  const [mailPageSize, setMailPageSize] = useState(5);
  const [pettyCashPageSize, setPettyCashPageSize] = useState(5);
  const [statementRange, setStatementRange] = useState<
    "all" | "last_day" | "last_week" | "last_month" | "custom"
  >("all");
  const [statementDateFrom, setStatementDateFrom] = useState("");
  const [statementDateTo, setStatementDateTo] = useState("");
  const [statementDownloading, setStatementDownloading] = useState<null | "pdf" | "xlsx" | "csv">(null);

  useEffect(() => {
    if (!open || !vendor) return;
    setActiveTab("overview");
    setEntryPage(1);
    setOrderPage(1);
    setPaymentPage(1);
    setMailPage(1);
    setPettyCashPage(1);
    setStatementRange("all");
    setStatementDateFrom("");
    setStatementDateTo("");
    setLoading(true);
    apiFetch(`${API_URL}/api/masters/suppliers/${vendor.id}/`)
      .then((data) => setDetail(data as VendorDetailData))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [open, vendor]);

  const current = useMemo(() => {
    const base = detail ?? vendor;
    if (!base) return null;
    return {
      ...base,
      email: base.email ?? null,
      phone: base.phone ?? "",
      mobile: base.mobile ?? "",
      notes: base.notes ?? "",
      billingAddress: {
        ...EMPTY_ADDRESS_FALLBACK,
        ...((base.billingAddress && typeof base.billingAddress === "object")
          ? base.billingAddress
          : {}),
      },
      shippingAddress: {
        ...EMPTY_ADDRESS_FALLBACK,
        ...((base.shippingAddress && typeof base.shippingAddress === "object")
          ? base.shippingAddress
          : {}),
      },
    };
  }, [detail, vendor]);
  const summary = detail?.summary ?? {
    totalPurchases: current?.totalPurchases ?? 0,
    totalPaid: 0,
    totalBalance: current?.outstanding ?? 0,
    totalEntries: 0,
    unpaidEntries: 0,
    partialEntries: 0,
    paidEntries: 0,
    totalOrders: 0,
    draftOrders: 0,
    approvedOrders: 0,
    receivedOrders: 0,
    partialOrders: 0,
    cancelledOrders: 0,
    totalOrderedValue: 0,
    totalPayments: 0,
    totalPaymentAmount: 0,
  };
  const entries = detail?.purchaseEntries ?? [];
  const orders = detail?.purchaseOrders ?? [];
  const payments = detail?.payments ?? [];
  const pettyCash = detail?.pettyCash ?? [];

  const row = (label: string, value: string | number | null | undefined) =>
    value != null && value !== "" ? (
      <div className="flex justify-between py-2 border-b last:border-0 text-sm gap-4">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="font-medium text-right break-words">{value}</span>
      </div>
    ) : null;

  const addrLines = (a?: Partial<BillingAddress> | null) => {
    const safe = { ...EMPTY_ADDRESS_FALLBACK, ...(a ?? {}) };
    return [safe.attention, safe.addressLine1, safe.addressLine2, [safe.city, safe.state].filter(Boolean).join(", "), safe.zip, safe.country, safe.phone]
      .filter(Boolean);
  };

  const money = (value: number | undefined) =>
    `AED ${(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const shortMoney = (value: number | undefined) =>
    (value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  const fmtDate = (value: string | undefined | null) =>
    value
      ? new Date(value).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";
  const fmtDateTime = (value: string | undefined | null) =>
    value ? new Date(value).toLocaleString() : "—";
  const tabs = [
    { key: "overview", label: "Overview", icon: Building2 },
    { key: "comments", label: "Comments", icon: MessageSquare },
    { key: "transactions", label: "Transactions", icon: ReceiptText },
    { key: "mails", label: "Mails", icon: Send },
    { key: "statement", label: "Statement", icon: FileText },
  ] as const;

  const paginateRows = useCallback(<T,>(rows: T[], page: number, pageSize: number) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize),
      totalPages,
      safePage,
      start,
      end: Math.min(start + pageSize, rows.length),
    };
  }, []);

  const pagedEntries = useMemo(
    () => paginateRows(entries, entryPage, entryPageSize),
    [entries, entryPage, entryPageSize, paginateRows],
  );
  const pagedOrders = useMemo(
    () => paginateRows(orders, orderPage, orderPageSize),
    [orders, orderPage, orderPageSize, paginateRows],
  );
  const pagedPayments = useMemo(
    () => paginateRows(payments, paymentPage, paymentPageSize),
    [payments, paymentPage, paymentPageSize, paginateRows],
  );
  const pagedMails = useMemo(
    () =>
      paginateRows(
        orders.map((order) => ({
          id: order.id,
          documentNumber: order.poNumber,
          documentDate: order.orderDate,
          recipient: current?.email || "No vendor email",
          status: current?.email ? "Ready to send" : "Missing email",
          documentStatus: order.status,
        })),
        mailPage,
        mailPageSize,
      ),
    [orders, current?.email, mailPage, mailPageSize, paginateRows],
  );
  const pagedPettyCash = useMemo(
    () => paginateRows(pettyCash, pettyCashPage, pettyCashPageSize),
    [pettyCash, pettyCashPage, pettyCashPageSize, paginateRows],
  );

  const goTo = useCallback((path: string) => {
    window.location.href = path;
  }, []);

  const openEntryDetail = useCallback(async (entryId: number) => {
    setDetailLoadingType("entry");
    try {
      const data = await apiFetch(`${API_URL}/api/purchases/entries/${entryId}/`);
      setEntryDetail(data as PurchaseEntryDetailData);
    } catch (err) {
      toast({
        title: "Unable to open purchase entry",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDetailLoadingType(null);
    }
  }, [toast]);

  const openOrderDetail = useCallback(async (orderId: number) => {
    setDetailLoadingType("order");
    try {
      const data = await apiFetch(`${API_URL}/api/purchases/orders/${orderId}/`);
      setOrderDetail(data as PurchaseOrderDetailData);
    } catch (err) {
      toast({
        title: "Unable to open purchase order",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDetailLoadingType(null);
    }
  }, [toast]);

  const openPaymentDetail = useCallback((payment: PurchasePaymentSummary) => {
    setPaymentDetail(payment);
  }, []);

  const openPettyCashDetail = useCallback((entry: VendorPettyCashEntry) => {
    setPettyCashDetail(entry);
  }, []);

  const activityItems = useMemo(() => {
    const items = [
      {
        type: "vendor",
        title: "Vendor profile created",
        description: current?.createdAt
          ? `Vendor ${current.displayName} was created.`
          : "Vendor profile available.",
        date: current?.createdAt || "",
        accent: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      },
      ...orders.map((order) => ({
        type: "order",
        title: `Purchase Order ${order.poNumber}`,
        description: `${order.status} • ${money(order.totalAmount)} • ${order.itemCount} item(s)`,
        date: order.approvedAt || order.orderDate,
        accent: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
      })),
      ...entries.map((entry) => ({
        type: "entry",
        title: `Purchase Entry ${entry.entryNumber}`,
        description: `${entry.paymentStatus} • ${money(entry.totalAmount)} • ${entry.itemCount ?? 0} line(s)`,
        date: entry.receivedAt || entry.invoiceDate,
        accent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      })),
      ...payments.map((payment) => ({
        type: "payment",
        title: `Vendor payment for ${payment.entryNumber}`,
        description: `${money(payment.amount)} via ${payment.paymentMethod?.replace(/_/g, " ") || "—"}`,
        date: payment.paymentDate,
        accent: "bg-sky-500/10 text-sky-600 border-sky-500/20",
      })),
      ...pettyCash.map((entry) => ({
        type: "pettycash",
        title: `Petty cash ${entry.description}`,
        description: `${entry.type} • ${money(entry.amount)} • ${entry.categoryDisplay}`,
        date: entry.date,
        accent: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      })),
    ];

    return items
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [current?.createdAt, current?.displayName, entries, orders, payments, pettyCash]);

  const statementRows = useMemo(() => {
    const rows = [
      ...entries.map((entry) => ({
        date: entry.invoiceDate,
        type: "Purchase Entry",
        reference: entry.entryNumber,
        note: entry.purchaseOrderNo || entry.supplierInvoiceNo || "Purchase recorded",
        debit: entry.totalAmount,
        credit: 0,
      })),
      ...payments.map((payment) => ({
        date: payment.paymentDate,
        type: "Payment",
        reference: payment.entryNumber,
        note: payment.referenceNo || payment.paymentMethod || "Vendor payment",
        debit: 0,
        credit: payment.amount,
      })),
      ...pettyCash.map((entry) => ({
        date: entry.date,
        type: `Petty Cash (${entry.type})`,
        reference: entry.categoryDisplay,
        note: entry.description,
        debit: entry.type === "debit" ? entry.amount : 0,
        credit: entry.type === "credit" ? entry.amount : 0,
      })),
    ]
      .filter((row) => row.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    return rows.map((row) => {
      running += row.debit - row.credit;
      return { ...row, balance: running };
    });
  }, [entries, payments, pettyCash]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isoDaysAgo = useCallback((days: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - days);
    return dt.toISOString().slice(0, 10);
  }, []);

  const statementFilterFrom = useMemo(() => {
    if (statementRange === "custom") return statementDateFrom || "";
    if (statementRange === "last_day") return isoDaysAgo(1);
    if (statementRange === "last_week") return isoDaysAgo(7);
    if (statementRange === "last_month") return isoDaysAgo(30);
    return "";
  }, [statementRange, statementDateFrom, isoDaysAgo]);

  const statementFilterTo = useMemo(() => {
    if (statementRange === "custom") return statementDateTo || "";
    if (statementRange === "all") return "";
    return todayIso;
  }, [statementRange, statementDateTo, todayIso]);

  const filteredStatementRows = useMemo(() => {
    return statementRows.filter((row) => {
      const rowDate = String(row.date || "");
      if (!rowDate) return false;
      if (statementFilterFrom && rowDate < statementFilterFrom) return false;
      if (statementFilterTo && rowDate > statementFilterTo) return false;
      return true;
    });
  }, [statementRows, statementFilterFrom, statementFilterTo]);

  const statementDebits = useMemo(
    () => filteredStatementRows.reduce((sum, row) => sum + row.debit, 0),
    [filteredStatementRows],
  );
  const statementCredits = useMemo(
    () => filteredStatementRows.reduce((sum, row) => sum + row.credit, 0),
    [filteredStatementRows],
  );
  const statementCurrentBalance = useMemo(
    () => filteredStatementRows[filteredStatementRows.length - 1]?.balance ?? 0,
    [filteredStatementRows],
  );

  const downloadStatement = useCallback(
    async (format: "pdf" | "xlsx" | "csv") => {
      if (!current?.id) return;
      setStatementDownloading(format);
      try {
        const slug = (current.displayName || "supplier")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        await downloadBlobFile(
          "/api/reports/generate/",
          {
            report_type: "supplier-statement",
            format,
            date_from: statementFilterFrom || undefined,
            date_to: statementFilterTo || undefined,
            filters: {
              supplier_id: current.id,
            },
          },
          `${slug || "supplier"}-statement.${format === "xlsx" ? "xlsx" : format}`,
        );
      } catch (err) {
        toast({
          title: "Statement download failed",
          description: getApiErrorMessage(err),
          variant: "destructive",
        });
      } finally {
        setStatementDownloading(null);
      }
    },
    [current?.displayName, current?.id, statementFilterFrom, statementFilterTo, toast],
  );

  const renderSectionPagination = (
    total: number,
    page: number,
    totalPages: number,
    pageSize: number,
    setPage: (page: number) => void,
    setPageSize: (size: number) => void,
    start: number,
    end: number,
  ) => (
    <div className="flex flex-col gap-3 border-t bg-muted/10 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>{total ? `Showing ${start + 1} to ${end} of ${total}` : "No records"}</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-8 rounded-lg border bg-background px-2 text-xs"
          >
            {DETAIL_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="h-8 rounded-lg border px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="h-8 rounded-lg border px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  if (!open || !vendor || !current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-bold">{current.displayName}</h2>
              <p className="text-xs text-muted-foreground">
                {current.companyName || current.fullName || "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(current)}
              className="h-8 px-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] font-semibold text-amber-600 hover:bg-amber-500/15 flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            <button
              onClick={() => setActiveTab("transactions")}
              className="h-8 px-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/15 flex items-center gap-1.5"
            >
              <ReceiptText className="w-3 h-3" />
              Transactions
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex gap-2 px-5 pt-4 shrink-0 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5",
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && activeTab === "overview" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {[
                  { label: "Outstanding", value: current.outstanding },
                  { label: "Credit Limit", value: current.creditLimit },
                  { label: "Total Purchases", value: detail?.summary.totalPurchases ?? current.totalPurchases },
                  { label: "Collected", value: detail?.summary.totalPaymentAmount },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border p-4 bg-muted/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-xl font-bold">
                      {typeof stat.value === "number" && stat.label !== "Total Purchases"
                        ? money(stat.value)
                        : typeof stat.value === "number" && stat.label === "Total Purchases"
                          ? money(stat.value)
                          : stat.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4">
                  <SectionTitle>Vendor Profile</SectionTitle>
                  {row("Display Name", current.displayName)}
                  {row("Full Name", current.fullName)}
                  {row("Company Name", current.companyName)}
                  {row("Email", current.email)}
                  {row("Phone", current.phone)}
                  {row("Mobile", current.mobile)}
                  {row("Status", current.isActive ? "Active" : "Inactive")}
                  {row("Created At", current.createdAt ? new Date(current.createdAt).toLocaleString() : "—")}
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Tax & Finance</SectionTitle>
                  {row("Tax Treatment", current.taxTreatment?.replace(/_/g, " "))}
                  {row("TRN", current.trn)}
                  {row("PAN", current.pan)}
                  {row("Source of Supply", current.sourceOfSupply?.replace(/_/g, " "))}
                  {row("Currency", current.currency)}
                  {row("Payment Terms", current.paymentTerms?.replace(/_/g, " "))}
                  {row("Price List", current.priceList)}
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Billing Address</SectionTitle>
                  <div className="space-y-1 text-sm">
                    {addrLines(current.billingAddress).length > 0 ? (
                      addrLines(current.billingAddress).map((line) => (
                        <p key={line}>{line}</p>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No billing address</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Shipping Address</SectionTitle>
                  <div className="space-y-1 text-sm">
                    {addrLines(current.shippingAddress).length > 0 ? (
                      addrLines(current.shippingAddress).map((line) => (
                        <p key={line}>{line}</p>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No shipping address</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Bank Details</SectionTitle>
                  {row("Bank Name", current.bankName)}
                  {row("Account Number", current.bankAccount)}
                  {row("IFSC / SWIFT", current.bankIfsc)}
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Notes & Linked Summary</SectionTitle>
                  {row("Notes", current.notes)}
                  {detail && (
                    <>
                      {row("Purchase Entries", detail.summary.totalEntries)}
                      {row("Purchase Orders", detail.summary.totalOrders)}
                      {row("Payments", detail.summary.totalPayments)}
                      {row("Unpaid Entries", detail.summary.unpaidEntries)}
                      {row("Partial Entries", detail.summary.partialEntries)}
                      {row("Paid Entries", detail.summary.paidEntries)}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {!loading && activeTab === "comments" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-xl border p-4">
                <SectionTitle>Vendor Notes</SectionTitle>
                <div className="rounded-xl border border-dashed bg-muted/15 p-4 text-sm leading-6 text-muted-foreground min-h-[140px]">
                  {current.notes?.trim() ? current.notes : "No remarks added for this vendor yet."}
                </div>
              </div>
              <div className="rounded-xl border p-4">
                <SectionTitle>Recent Activity</SectionTitle>
                {activityItems.length ? (
                  <div className="space-y-3">
                    {activityItems.slice(0, 12).map((item, idx, arr) => (
                      <div key={`${item.type}-${item.title}-${item.date}-${idx}`} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className={cn("mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold", item.accent)}>
                            {item.type.slice(0, 1).toUpperCase()}
                          </span>
                          {idx !== arr.length - 1 && <span className="mt-2 h-full w-px bg-border" />}
                        </div>
                        <div className="pb-4">
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                          <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
                            {fmtDateTime(item.date)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No activity found for this vendor yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === "transactions" && (
            <div className="space-y-5">
              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-indigo-600" />
                    <p className="font-semibold">Purchase Entries</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>
                    <button
                      type="button"
                      onClick={() => goTo("/purchase-entries")}
                      className="h-8 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-500/15"
                    >
                      Open Entries
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Entry #", "PO #", "Invoice Date", "Due Date", "Total", "Paid", "Balance", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedEntries.rows.length ? pagedEntries.rows.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() => openEntryDetail(entry.id)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{entry.entryNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{entry.purchaseOrderNo || "—"}</td>
                        <td className="px-3 py-2">{fmtDate(entry.invoiceDate)}</td>
                        <td className="px-3 py-2">{fmtDate(entry.dueDate)}</td>
                        <td className="px-3 py-2 font-medium">{money(entry.totalAmount)}</td>
                        <td className="px-3 py-2">{money(entry.paidAmount)}</td>
                        <td className="px-3 py-2">{money(entry.balanceAmount)}</td>
                        <td className="px-3 py-2 capitalize">{entry.paymentStatus}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No purchase entries found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  entries.length,
                  pagedEntries.safePage,
                  pagedEntries.totalPages,
                  entryPageSize,
                  setEntryPage,
                  setEntryPageSize,
                  pagedEntries.start,
                  pagedEntries.end,
                )}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-blue-600" />
                    <p className="font-semibold">Purchase Orders</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{orders.length} order(s)</span>
                    <button
                      type="button"
                      onClick={() => goTo("/purchase-orders")}
                      className="h-8 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 text-[11px] font-semibold text-blue-600 hover:bg-blue-500/15"
                    >
                      Open Orders
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["PO #", "Reference", "Order Date", "Expected", "Total", "Status", "Items", "Entries"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedOrders.rows.length ? pagedOrders.rows.map((order) => (
                      <tr
                        key={order.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() => openOrderDetail(order.id)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{order.poNumber}</td>
                        <td className="px-3 py-2">{order.referenceNo || "—"}</td>
                        <td className="px-3 py-2">{fmtDate(order.orderDate)}</td>
                        <td className="px-3 py-2">{fmtDate(order.expectedDate)}</td>
                        <td className="px-3 py-2 font-medium">{money(order.totalAmount)}</td>
                        <td className="px-3 py-2 capitalize">{order.status}</td>
                        <td className="px-3 py-2">{order.itemCount}</td>
                        <td className="px-3 py-2">{order.entryCount}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No purchase orders found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  orders.length,
                  pagedOrders.safePage,
                  pagedOrders.totalPages,
                  orderPageSize,
                  setOrderPage,
                  setOrderPageSize,
                  pagedOrders.start,
                  pagedOrders.end,
                )}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <p className="font-semibold">Vendor Payments</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{payments.length} payment(s)</span>
                    <button
                      type="button"
                      onClick={() => goTo("/purchase-entries")}
                      className="h-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/15"
                    >
                      Open Payments
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Entry #", "Amount", "Method", "Reference", "Notes"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPayments.rows.length ? pagedPayments.rows.map((payment) => (
                      <tr
                        key={payment.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() => openPaymentDetail(payment)}
                      >
                        <td className="px-3 py-2">{fmtDate(payment.paymentDate)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{payment.entryNumber}</td>
                        <td className="px-3 py-2 font-medium">{money(payment.amount)}</td>
                        <td className="px-3 py-2 capitalize">{payment.paymentMethod?.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2">{payment.referenceNo || "—"}</td>
                        <td className="px-3 py-2">{payment.notes || "—"}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No payments found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  payments.length,
                  pagedPayments.safePage,
                  pagedPayments.totalPages,
                  paymentPageSize,
                  setPaymentPage,
                  setPaymentPageSize,
                  pagedPayments.start,
                  pagedPayments.end,
                )}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="h-4 w-4 text-sky-600" />
                    <p className="font-semibold">Vendor-linked Petty Cash</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{pettyCash.length} entr{pettyCash.length === 1 ? "y" : "ies"}</span>
                    <button
                      type="button"
                      onClick={() => goTo("/petty-cash")}
                      className="h-8 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 text-[11px] font-semibold text-sky-600 hover:bg-sky-500/15"
                    >
                      Open Petty Cash
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Description", "Type", "Category", "Amount", "Balance", "Approved By"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPettyCash.rows.length ? pagedPettyCash.rows.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() => openPettyCashDetail(entry)}
                      >
                        <td className="px-3 py-2">{fmtDate(entry.date)}</td>
                        <td className="px-3 py-2">{entry.description}</td>
                        <td className="px-3 py-2 capitalize">{entry.type}</td>
                        <td className="px-3 py-2">{entry.categoryDisplay}</td>
                        <td className="px-3 py-2 font-medium">{money(entry.amount)}</td>
                        <td className="px-3 py-2">{money(entry.balance)}</td>
                        <td className="px-3 py-2">{entry.approvedBy}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No petty cash entries found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  pettyCash.length,
                  pagedPettyCash.safePage,
                  pagedPettyCash.totalPages,
                  pettyCashPageSize,
                  setPettyCashPage,
                  setPettyCashPageSize,
                  pagedPettyCash.start,
                  pagedPettyCash.end,
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === "mails" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.75fr_1.25fr]">
              <div className="rounded-xl border p-4">
                <SectionTitle>Communication Profile</SectionTitle>
                {row("Primary Email", current.email || "Not available")}
                {row("Phone", current.phone)}
                {row("Mobile", current.mobile || "Not available")}
                {row(
                  "PO Email Readiness",
                  current.email ? "Vendor email is available" : "Vendor email is missing",
                )}
                {row("Approved Orders", summary.approvedOrders)}
                {row("Purchase Entries", summary.totalEntries)}
              </div>
              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-indigo-600" />
                    <p className="font-semibold">Document Mail Readiness</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{orders.length} document(s)</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Document", "Date", "Recipient", "Document Status", "Mail Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedMails.rows.length ? pagedMails.rows.map((mail) => (
                      <tr key={mail.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{mail.documentNumber}</td>
                        <td className="px-3 py-2">{fmtDate(mail.documentDate)}</td>
                        <td className="px-3 py-2">{mail.recipient}</td>
                        <td className="px-3 py-2 capitalize">{mail.documentStatus}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                              mail.status === "Ready to send"
                                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-600 border border-amber-500/20",
                            )}
                          >
                            {mail.status}
                          </span>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No document mail activity found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  orders.length,
                  pagedMails.safePage,
                  pagedMails.totalPages,
                  mailPageSize,
                  setMailPage,
                  setMailPageSize,
                  pagedMails.start,
                  pagedMails.end,
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === "statement" && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto_auto_auto_auto_auto] lg:items-end">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Statement Range
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        { value: "all", label: "All" },
                        { value: "last_day", label: "Last Day" },
                        { value: "last_week", label: "Last Week" },
                        { value: "last_month", label: "Last Month" },
                        { value: "custom", label: "Custom" },
                      ].map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setStatementRange(value as typeof statementRange)}
                          className={cn(
                            "h-9 rounded-xl border px-3 text-xs font-semibold",
                            statementRange === value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="space-y-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>From Date</span>
                    <input
                      type="date"
                      value={statementRange === "custom" ? statementDateFrom : statementFilterFrom}
                      disabled={statementRange !== "custom"}
                      onChange={(e) => setStatementDateFrom(e.target.value)}
                      className="h-9 rounded-xl border bg-background px-3 text-sm text-foreground disabled:opacity-50"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>To Date</span>
                    <input
                      type="date"
                      value={statementRange === "custom" ? statementDateTo : statementFilterTo}
                      disabled={statementRange !== "custom"}
                      onChange={(e) => setStatementDateTo(e.target.value)}
                      className="h-9 rounded-xl border bg-background px-3 text-sm text-foreground disabled:opacity-50"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => downloadStatement("pdf")}
                    disabled={statementDownloading !== null}
                    className="h-9 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-500/15 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {statementDownloading === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadStatement("xlsx")}
                    disabled={statementDownloading !== null}
                    className="h-9 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/15 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {statementDownloading === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                    Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadStatement("csv")}
                    disabled={statementDownloading !== null}
                    className="h-9 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 text-xs font-semibold text-sky-600 hover:bg-sky-500/15 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {statementDownloading === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                {[
                  { label: "Statement Debits", value: money(statementDebits) },
                  { label: "Statement Credits", value: money(statementCredits) },
                  { label: "Current Balance", value: money(statementCurrentBalance) },
                  { label: "Entries", value: filteredStatementRows.length },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border p-4 bg-muted/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 text-2xl font-bold">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Type", "Reference", "Note", "Debit", "Credit", "Balance"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStatementRows.length ? filteredStatementRows.map((rowItem, idx) => (
                      <tr key={`${rowItem.type}-${rowItem.reference}-${rowItem.date}-${idx}`} className="border-t">
                        <td className="px-3 py-2">{fmtDate(rowItem.date)}</td>
                        <td className="px-3 py-2">{rowItem.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{rowItem.reference}</td>
                        <td className="px-3 py-2">{rowItem.note}</td>
                        <td className="px-3 py-2">{rowItem.debit ? money(rowItem.debit) : "—"}</td>
                        <td className="px-3 py-2">{rowItem.credit ? money(rowItem.credit) : "—"}</td>
                        <td className="px-3 py-2 font-semibold">{money(rowItem.balance)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No statement rows found for the selected period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        {selectedDetail && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setSelectedDetail(null)}
          >
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative w-full max-w-lg rounded-2xl border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="font-bold">{selectedDetail.title}</h3>
                  {selectedDetail.subtitle && (
                    <p className="mt-1 text-xs text-muted-foreground">{selectedDetail.subtitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetail(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  {selectedDetail.sections.map((section) => (
                    <div key={section.title} className="rounded-xl border p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {section.title}
                      </p>
                      <div className="mt-3 space-y-0">
                        {section.rows.map((item) => row(item.label, item.value))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {detailLoadingType && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/35">
            <div className="rounded-2xl border bg-card px-5 py-4 shadow-2xl flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium">
                Loading {detailLoadingType === "entry" ? "purchase entry" : detailLoadingType === "order" ? "purchase order" : "details"}...
              </span>
            </div>
          </div>
        )}
        {orderDetail && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setOrderDetail(null)}>
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
            <div className="relative w-full max-w-[66rem] max-h-[86vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <div>
                  <h3 className="font-mono text-[1.45rem] font-bold leading-none">{orderDetail.poNumber}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{orderDetail.supplier?.name || current.displayName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-600">
                    {orderDetail.statusDisplay || orderDetail.status}
                  </span>
                  <button type="button" onClick={() => setOrderDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-3 p-3">
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
                  {[
                    ["Order Date", fmtDate(orderDetail.orderDate)],
                    ["Delivery Date", fmtDate(orderDetail.expectedDate)],
                    ["Reference #", orderDetail.referenceNo || "—"],
                    ["Payment Terms", orderDetail.paymentTerms?.replace(/_/g, " ") || "—"],
                    ["Shipment Preference", orderDetail.shipmentPreference || "—"],
                    ["Tax", orderDetail.taxExclusive ? "Tax Exclusive" : "Tax Inclusive"],
                    ["Tax Level", orderDetail.taxLevel || "—"],
                    ["Total", money(orderDetail.totalAmount)],
                    ["Notes", orderDetail.notes || "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                      <p className="mt-1 text-[14px] font-semibold leading-snug">{value}</p>
                    </div>
                  ))}
                  <div className="rounded-xl border px-3 py-2 lg:col-span-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Delivery Address</p>
                    <div className="mt-1 space-y-0.5 text-[12px] leading-4.5">{(orderDetail.deliveryAddress || "").split("\n").filter(Boolean).map((line) => <p key={line}>{line}</p>)}</div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border">
                  <div className="border-b bg-muted/20 px-3 py-1.5">
                    <p className="text-[12px] font-semibold">Asset Line Items</p>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead className="border-b bg-muted/30">
                      <tr>
                        {["Item", "Account", "Batch No", "Expiry", "Qty", "Unit Price", "Disc %", "Tax %", "Total"].map((h) => (
                          <th key={h} className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(orderDetail.items || []).map((item, idx) => (
                        <tr key={`${item.itemName}-${idx}`} className="border-t align-top">
                          <td className="px-3 py-2 font-semibold">{item.itemName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.account || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.batchNumber || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.expiryDate ? fmtDate(item.expiryDate) : "—"}</td>
                          <td className="px-3 py-2">{item.quantity}</td>
                          <td className="px-3 py-2">{money(item.unitPrice)}</td>
                          <td className="px-3 py-2">{item.discount}%</td>
                          <td className="px-3 py-2">{item.taxRate}%</td>
                          <td className="px-3 py-2 font-semibold">{money(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/10">
                      <tr>
                        <td colSpan={8} className="px-3 py-2 text-right text-[14px] font-bold">Grand Total</td>
                        <td className="px-3 py-2 text-right text-[14px] font-bold text-primary">{money(orderDetail.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
        {entryDetail && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setEntryDetail(null)}>
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
            <div className="relative w-full max-w-[66rem] max-h-[86vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-[1.45rem] font-bold leading-none">{entryDetail.entryNumber}</h3>
                    <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[9px] font-semibold text-rose-600">
                      {entryDetail.paymentStatusDisplay || entryDetail.paymentStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{entryDetail.supplier?.name || current.displayName} • PO: {entryDetail.purchaseOrderNo || "—"}</p>
                </div>
                <button type="button" onClick={() => setEntryDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-3">
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-5">
                  {[
                    ["Supplier", entryDetail.supplier?.name || "—"],
                    ["Linked PO", entryDetail.purchaseOrderNo || "—"],
                    ["Invoice Date", fmtDate(entryDetail.invoiceDate)],
                    ["Due Date", fmtDate(entryDetail.dueDate)],
                    ["Supplier Invoice No", entryDetail.supplierInvoiceNo || "—"],
                    ["Received At", entryDetail.receivedAt ? fmtDateTime(entryDetail.receivedAt) : "Not received"],
                    ["Payment Status", entryDetail.paymentStatusDisplay || entryDetail.paymentStatus],
                    ["Received By", entryDetail.receivedBy || "—"],
                    ["Invoice File", entryDetail.hasInvoiceFile ? "Uploaded" : "Not uploaded"],
                    ["Line Items", `${entryDetail.items?.length || 0} item(s)`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                      <p className="mt-1 text-[14px] font-semibold leading-snug">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
                  {[
                    ["Total", money(entryDetail.totalAmount), "text-foreground"],
                    ["Subtotal", money(entryDetail.subtotal), "text-muted-foreground"],
                    ["Tax", money(entryDetail.taxAmount), "text-muted-foreground"],
                    ["Paid", money(entryDetail.paidAmount), "text-emerald-600"],
                    ["Balance", money(entryDetail.balanceAmount), "text-rose-600"],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="rounded-xl border px-3 py-2 bg-muted/10">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                      <p className={cn("mt-1 text-[16px] font-bold", cls)}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="overflow-hidden rounded-xl border">
                  <div className="border-b bg-muted/20 px-3 py-1.5">
                    <p className="text-[12px] font-semibold">Line Items ({entryDetail.items?.length || 0})</p>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead className="border-b bg-muted/30">
                      <tr>
                        {["Item", "Account", "Batch No", "Expiry", "Qty", "Unit Price", "Disc %", "Tax %", "Line Total"].map((h) => (
                          <th key={h} className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(entryDetail.items || []).map((item, idx) => (
                        <tr key={`${item.itemName}-${idx}`} className="border-t align-top">
                          <td className="px-3 py-2">
                            <p className="font-semibold">{item.itemName}</p>
                            {item.assetCode ? <p className="mt-0.5 text-[10px] text-muted-foreground">{item.assetCode}</p> : null}
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Subtotal: {money(item.subtotal)} &nbsp; Discount: {money(item.discAmount)} &nbsp; Tax: {money(item.taxAmount)}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{item.account || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.batchNumber || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.expiryDate ? fmtDate(item.expiryDate) : "—"}</td>
                          <td className="px-3 py-2">{item.quantity}</td>
                          <td className="px-3 py-2">{money(item.unitPrice)}</td>
                          <td className="px-3 py-2">{item.discount}%</td>
                          <td className="px-3 py-2">{item.taxRate}%</td>
                          <td className="px-3 py-2 font-semibold">{money(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/10">
                      <tr>
                        <td colSpan={8} className="px-3 py-2 text-right text-[14px] font-bold">Grand Total</td>
                        <td className="px-3 py-2 text-right text-[14px] font-bold text-primary">{money(entryDetail.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="overflow-hidden rounded-xl border">
                  <div className="border-b bg-muted/20 px-3 py-1.5">
                    <p className="text-[12px] font-semibold">Payment History</p>
                  </div>
                  {(entryDetail.payments || []).length ? (
                    <table className="w-full text-[11px]">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          {["Date", "Method", "Reference", "Amount", "Notes"].map((h) => (
                            <th key={h} className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(entryDetail.payments || []).map((payment) => (
                          <tr key={payment.id} className="border-t">
                            <td className="px-3 py-2">{fmtDate(payment.paymentDate)}</td>
                            <td className="px-3 py-2">{payment.paymentMethod?.replace(/_/g, " ") || "—"}</td>
                            <td className="px-3 py-2">{payment.referenceNo || "—"}</td>
                            <td className="px-3 py-2 font-semibold">{money(payment.amount)}</td>
                            <td className="px-3 py-2">{payment.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-4 py-4 text-[11px] text-muted-foreground">No vendor payments recorded for this entry yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {paymentDetail && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setPaymentDetail(null)}>
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg rounded-2xl border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <div>
                  <h3 className="text-[1.35rem] font-bold leading-none">Vendor Payment</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{paymentDetail.entryNumber} • {current.displayName}</p>
                </div>
                <button type="button" onClick={() => setPaymentDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 p-3 md:grid-cols-2">
                {[
                  ["Payment Date", fmtDate(paymentDetail.paymentDate)],
                  ["Entry Number", paymentDetail.entryNumber],
                  ["Financial Year", paymentDetail.financialYear || "—"],
                  ["Amount", money(paymentDetail.amount)],
                  ["Method", paymentDetail.paymentMethod?.replace(/_/g, " ") || "—"],
                  ["Reference", paymentDetail.referenceNo || "—"],
                  ["Notes", paymentDetail.notes || "—"],
                  ["Linked Balance", (() => {
                    const linked = entries.find((entry) => entry.id === paymentDetail.entryId);
                    return linked ? money(linked.balanceAmount) : "—";
                  })()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <p className="mt-1 text-[14px] font-semibold leading-snug">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {pettyCashDetail && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setPettyCashDetail(null)}>
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg rounded-2xl border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <div>
                  <h3 className="text-[1.35rem] font-bold leading-none">{pettyCashDetail.description}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Vendor-linked petty cash</p>
                </div>
                <button type="button" onClick={() => setPettyCashDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 p-3 md:grid-cols-2">
                {[
                  ["Date", fmtDate(pettyCashDetail.date)],
                  ["Type", pettyCashDetail.type],
                  ["Category", pettyCashDetail.categoryDisplay],
                  ["Amount", money(pettyCashDetail.amount)],
                  ["Balance Snapshot", money(pettyCashDetail.balance)],
                  ["Related Type", pettyCashDetail.relatedPartyTypeDisplay],
                  ["Vendor", pettyCashDetail.vendorName || "—"],
                  ["Approved By", pettyCashDetail.approvedBy || "—"],
                  ["Created By", pettyCashDetail.createdBy || "—"],
                  ["Notes", pettyCashDetail.notes || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <p className="mt-1 text-[14px] font-semibold leading-snug">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({
  open,
  onClose,
  vendor,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  vendor: VendorData | null;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    if (!vendor) return;
    setLoading(true);
    try {
      await apiFetch(`${API_URL}/api/masters/suppliers/${vendor.id}/`, {
        method: "DELETE",
      });
      toast({ title: "Vendor deleted" });
      onDeleted();
      onClose();
    } catch (err: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open || !vendor) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h3 className="font-bold">Delete Vendor?</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Are you sure you want to delete{" "}
              <strong>{vendor.displayName}</strong>? This cannot be undone and
              will fail if linked records exist.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Purchase History Dialog ───────────────────────────────────────────────────

function PurchaseHistoryDialog({
  open,
  onClose,
  vendor,
}: {
  open: boolean;
  onClose: () => void;
  vendor: VendorData | null;
}) {
  const [data, setData] = useState<{
    entries: PurchaseEntry[];
    totalPurchases: number;
    vendor: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !vendor) return;
    setLoading(true);
    apiFetch(`${API_URL}/api/masters/suppliers/${vendor.id}/purchase-history/`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, vendor]);

  if (!open || !vendor) return null;

  const statusColor: Record<string, string> = {
    unpaid: "text-rose-600",
    partial: "text-amber-600",
    paid: "text-emerald-600",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="font-bold">Purchase History — {vendor.displayName}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && data && (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Total Purchases:{" "}
                <span className="font-semibold text-foreground">
                  {data.totalPurchases.toLocaleString()}
                </span>
              </p>
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No purchase records found.
                </p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        {[
                          "Entry #",
                          "Invoice #",
                          "Date",
                          "Total",
                          "Paid",
                          "Balance",
                          "Status",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((e) => (
                        <tr key={e.id} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">
                            {e.entryNumber}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {e.supplierInvoice || "—"}
                          </td>
                          <td className="px-3 py-2">{e.invoiceDate}</td>
                          <td className="px-3 py-2 font-medium">
                            {e.totalAmount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            {e.paidAmount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            {e.balanceAmount.toLocaleString()}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 font-medium capitalize",
                              statusColor[e.paymentStatus] || "",
                            )}
                          >
                            {e.paymentStatus}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {!loading && !data && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Failed to load purchase history.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Vendors() {
  const [vendors, setVendors] = useState<VendorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [selected, setSelected] = useState<VendorData | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VendorData | null>(null);
  const [viewTarget, setViewTarget] = useState<VendorData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorData | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<VendorData | null>(null);

  const { toast } = useToast();

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const data = await apiFetch(`${API_URL}/api/masters/suppliers/${params}`);
      setVendors(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchVendors, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchVendors]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(vendors.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = vendors.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage,
  );
  const from = vendors.length === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const to = Math.min(safePage * itemsPerPage, vendors.length);

  // Stats
  const stats = useMemo(
    () => ({
      total: vendors.length,
      outstanding: vendors.reduce((s, v) => s + v.outstanding, 0),
      totalPurchases: vendors.reduce((s, v) => s + (v.totalPurchases || 0), 0),
    }),
    [vendors],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your vendors / suppliers and purchase history
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Vendor
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            label: "Total Vendors",
            value: stats.total,
            cls: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
          },
          {
            label: "Total Outstanding",
            value: stats.outstanding.toLocaleString(),
            cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
          },
          {
            label: "Total Purchases",
            value: stats.totalPurchases.toLocaleString(),
            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-2xl border p-4", s.cls)}>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">
              {s.label}
            </p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by display name or company…"
            className="w-full h-9 pl-9 pr-8 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <button
          onClick={fetchVendors}
          disabled={loading}
          className="h-9 px-3 rounded-xl border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />{" "}
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-600 flex-1">{error}</p>
          <button
            onClick={fetchVendors}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium"
          >
            <RefreshCw className="w-3 h-3 inline mr-1" /> Retry
          </button>
        </div>
      )}

      {/* Table */}
      {loading && !error ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Building2 className="w-12 h-12 text-muted-foreground opacity-30" />
              <p className="text-sm font-semibold">No vendors found</p>
              <p className="text-xs text-muted-foreground">
                {search ? "Try a different search." : "Add your first vendor."}
              </p>
              {!search && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> New Vendor
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    {[
                      "Vendor",
                      "Contact",
                      "Tax / TRN",
                      "Outstanding",
                      "Status",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setViewTarget(v)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold">{v.displayName}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.companyName || v.fullName || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <Mail className="w-3 h-3 text-muted-foreground" />{" "}
                            {v.email || "—"}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Phone className="w-3 h-3 text-muted-foreground" />{" "}
                            {v.phone || "—"}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium">
                          {v.taxTreatment?.replace(/_/g, " ")}
                        </p>
                        {v.trn && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {v.trn}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {v.outstanding.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Limit: {v.creditLimit.toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                            v.isActive
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              : "bg-muted/50 text-muted-foreground border-border",
                          )}
                        >
                          {v.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(v);
                            }}
                            title="Edit"
                            className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPurchaseTarget(v);
                            }}
                            title="Purchase History"
                            className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-600"
                          >
                            <ReceiptText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(v);
                            }}
                            title="Delete"
                            className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && vendors.length > 0 && (
        <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Showing {from} to {to} of {vendors.length} vendors
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="h-10 w-[110px] rounded-2xl border bg-background px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="h-8 px-3 rounded-xl border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium">
              Page {safePage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="h-8 px-3 rounded-xl border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 flex items-center gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <VendorFormDialog
        open={formOpen || !!editTarget}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        initial={editTarget}
        onSaved={fetchVendors}
      />
      <ViewVendorDialog
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        vendor={viewTarget}
        onEdit={(vendor) => {
          setViewTarget(null);
          setEditTarget(vendor);
        }}
        onDelete={(vendor) => {
          setViewTarget(null);
          setDeleteTarget(vendor);
        }}
      />
      <DeleteConfirm
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        vendor={deleteTarget}
        onDeleted={fetchVendors}
      />
      <PurchaseHistoryDialog
        open={!!purchaseTarget}
        onClose={() => setPurchaseTarget(null)}
        vendor={purchaseTarget}
      />
    </div>
  );
}
