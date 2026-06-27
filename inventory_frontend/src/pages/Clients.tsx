// src/pages/Customers.tsx
// Aligned to updated backend:
//   - Customer fields: displayName (required), firstName, lastName, salutation,
//     companyName, customerType (business/individual), customerLanguage,
//     taxTreatment, trn, pan, placeOfSupply, currency, paymentTerms, priceList,
//     creditLimit, outstanding, billingAddress{...}, shippingAddress{...}, notes, isActive
//   - OLD fields removed: name, clientType, contactPerson, address, city, state,
//     pincode, gstin (→ trn), shippingAddress (flat string)
//   - Invoices: GET /customers/<id>/invoices/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  FileSpreadsheet,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  PiggyBank,
  Send,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  User,
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

interface AddressBlock {
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

export interface CustomerData {
  id: number;
  salutation: string;
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  displayName: string;
  customerType: "business" | "individual";
  customerLanguage: string;
  email: string | null;
  phone: string;
  mobile: string;
  taxTreatment: string;
  trn: string;
  pan: string;
  placeOfSupply: string;
  currency: string;
  paymentTerms: string;
  priceList: string;
  creditLimit: number;
  outstanding: number;
  billingAddress: AddressBlock;
  shippingAddress: AddressBlock;
  notes: string;
  isActive: boolean;
  createdAt: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: string;
  financialYear: string;
  createdAt: string;
  grossTotalAmount?: number;
  returnAmount?: number;
  rawPaidAmount?: number;
  refundableAmount?: number;
  salespersonName?: string;
  status?: string;
}

interface InvoiceDetailItem {
  id?: number;
  itemType?: string;
  itemName: string;
  itemDescription?: string;
  batchNumber?: string;
  expiryDate?: string | null;
  quantity: number;
  rspInclVat?: number;
  rspWithoutVat?: number;
  discount?: number;
  discountType?: "amount" | "percent";
  amountPerUnit?: number;
  taxRate?: number;
  lineTotal?: number;
}

interface InvoiceDetailPayment {
  id: number;
  paymentDate: string;
  amount: number;
  transactionType?: "payment" | "refund";
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
}

interface InvoiceDetailData extends Invoice {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerGst?: string;
  customerOutstanding?: number;
  salespersonId?: number | null;
  statusDisplay?: string;
  paymentStatusDisplay?: string;
  termsAndConditions?: string;
  notes?: string;
  items?: InvoiceDetailItem[];
  payments?: InvoiceDetailPayment[];
}

interface CustomerPayment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  paymentDate: string;
  financialYear: string | null;
  amount: number;
  transactionType?: "payment" | "refund";
  paymentMethod: string;
  referenceNo: string;
  notes: string;
}

interface CustomerReturn {
  id: number;
  returnNumber: string;
  returnDate: string;
  salesInvoiceId: number | null;
  invoiceNumber: string;
  invoiceNumbers: string[];
  customerId: number | null;
  customerName: string;
  warehouseId: number | null;
  warehouseName: string;
  reason: string;
  notes: string;
  status: string;
  statusDisplay: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  stockPosted: boolean;
  createdBy: string;
  createdAt?: string;
  items?: {
    id: number;
    invoiceNumber?: string;
    itemName: string;
    quantity: number;
    lineTotal: number;
    disposition?: "restock" | "damaged" | "expired";
  }[];
}

interface CustomerPettyCashEntry {
  id: number;
  date: string;
  description: string;
  type: "credit" | "debit";
  amount: number;
  balance: number;
  category: string;
  categoryDisplay: string;
  financialYear: string | null;
  approvedBy: string;
  createdBy: string;
  notes?: string;
  relatedPartyType: "own" | "customer" | "vendor";
  relatedPartyTypeDisplay: string;
  customerId?: number | null;
  customerName?: string | null;
  vendorId?: number | null;
  vendorName?: string | null;
}

interface CustomerDetailData extends CustomerData {
  summary: {
    totalInvoices: number;
    grossAmount: number;
    rawPaid: number;
    outstanding: number;
    unpaidInvoices: number;
    partialInvoices: number;
    paidInvoices: number;
    totalPayments: number;
    totalCollected: number;
    totalReturns: number;
    confirmedReturns: number;
    draftReturns: number;
    cancelledReturns: number;
    totalReturnAmount: number;
  };
  invoices: Invoice[];
  payments: CustomerPayment[];
  returns: CustomerReturn[];
  pettyCash: CustomerPettyCashEntry[];
}

const DETAIL_PAGE_SIZE_OPTIONS = [5, 10, 25];

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

async function downloadBlobFile(
  path: string,
  payload: Record<string, unknown>,
  filename: string,
) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    throw new Error((body as any)?.error ?? body ?? "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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

// ─── Form state ───────────────────────────────────────────────────────────────

const EMPTY_ADDRESS: AddressBlock = {
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
  customerType: "business" as "business" | "individual",
  customerLanguage: "English",
  email: "",
  phone: "",
  mobile: "",
  taxTreatment: "vat_registered",
  trn: "",
  pan: "",
  placeOfSupply: "",
  currency: "AED",
  paymentTerms: "net_30",
  priceList: "",
  creditLimit: "",
  billingAddress: { ...EMPTY_ADDRESS },
  shippingAddress: { ...EMPTY_ADDRESS },
  notes: "",
  isActive: true,
};

type FormState = typeof EMPTY_FORM;
type FormErrors = Partial<Record<string, string>>;

// ─── Validation ───────────────────────────────────────────────────────────────

function validateCustomerForm(form: FormState): FormErrors {
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

// ─── Customer Form Dialog ─────────────────────────────────────────────────────

function CustomerFormDialog({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: CustomerData | null;
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
  const [activeTab, setActiveTab] = useState<"basic" | "tax" | "address">(
    "basic",
  );
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
        customerType: initial.customerType || "business",
        customerLanguage: initial.customerLanguage || "English",
        email: initial.email || "",
        phone: initial.phone || "",
        mobile: initial.mobile || "",
        taxTreatment: initial.taxTreatment || "vat_registered",
        trn: initial.trn || "",
        pan: initial.pan || "",
        placeOfSupply: initial.placeOfSupply || "",
        currency: initial.currency || "AED",
        paymentTerms: initial.paymentTerms || "net_30",
        priceList: initial.priceList || "",
        creditLimit: String(initial.creditLimit ?? ""),
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
      [type]: { ...(f[type] as AddressBlock), [k]: v },
    }));
  };

  useEffect(() => {
    if (shipSame)
      setForm((f) => ({
        ...f,
        shippingAddress: { ...(f.billingAddress as AddressBlock) },
      }));
  }, [shipSame, form.billingAddress]);

  const handleSave = async () => {
    const errs = validateCustomerForm(form);
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
        ? `${API_URL}/api/masters/customers/${initial!.id}/`
        : `${API_URL}/api/masters/customers/create/`;
      await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast({ title: isEdit ? "Customer updated" : "Customer created" });
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
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="font-bold">
              {isEdit ? "Edit Customer" : "New Customer"}
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
          {/* Basic */}
          {activeTab === "basic" && (
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
                    placeholder="+971…"
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
                <FieldRow label="Customer Type">
                  <Sel
                    value={form.customerType}
                    onChange={(e) =>
                      set(
                        "customerType",
                        e.target.value as "business" | "individual",
                      )
                    }
                  >
                    <option value="business">Business</option>
                    <option value="individual">Individual</option>
                  </Sel>
                </FieldRow>
                <FieldRow label="Language">
                  <Inp
                    value={form.customerLanguage}
                    onChange={(e) => set("customerLanguage", e.target.value)}
                    placeholder="English"
                  />
                </FieldRow>
                <FieldRow label="Email" error={errors.email}>
                  <Inp
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="customer@example.com"
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
                <FieldRow label="Place of Supply">
                  <Sel
                    value={form.placeOfSupply}
                    onChange={(e) => set("placeOfSupply", e.target.value)}
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
            {isEdit ? "Save Changes" : "Create Customer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── View Customer Dialog ─────────────────────────────────────────────────────

function ViewCustomerDialog({
  open,
  onClose,
  customer,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  customer: CustomerData | null;
  onEdit: (customer: CustomerData) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "comments" | "transactions" | "mails" | "statement"
  >("overview");
  const [selectedTransaction, setSelectedTransaction] = useState<{
    title: string;
    subtitle?: string;
    sections: Array<{
      title: string;
      rows: Array<{ label: string; value: string }>;
    }>;
  } | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceDialogLoading, setInvoiceDialogLoading] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetailData | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentDialogLoading, setPaymentDialogLoading] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<CustomerPayment | null>(null);
  const [paymentInvoiceDetail, setPaymentInvoiceDetail] = useState<InvoiceDetailData | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnDialogLoading, setReturnDialogLoading] = useState(false);
  const [returnDetail, setReturnDetail] = useState<CustomerReturn | null>(null);
  const [invoicePage, setInvoicePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [returnPage, setReturnPage] = useState(1);
  const [mailPage, setMailPage] = useState(1);
  const [pettyCashPage, setPettyCashPage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(5);
  const [paymentPageSize, setPaymentPageSize] = useState(5);
  const [returnPageSize, setReturnPageSize] = useState(5);
  const [mailPageSize, setMailPageSize] = useState(5);
  const [pettyCashPageSize, setPettyCashPageSize] = useState(5);
  const [statementRange, setStatementRange] = useState<
    "all" | "last_day" | "last_week" | "last_month" | "custom"
  >("all");
  const [statementDateFrom, setStatementDateFrom] = useState("");
  const [statementDateTo, setStatementDateTo] = useState("");
  const [statementDownloading, setStatementDownloading] = useState<null | "pdf" | "xlsx" | "csv">(null);

  useEffect(() => {
    if (!open || !customer) return;
    setActiveTab("overview");
    setInvoicePage(1);
    setPaymentPage(1);
    setReturnPage(1);
    setMailPage(1);
    setPettyCashPage(1);
    setStatementRange("all");
    setStatementDateFrom("");
    setStatementDateTo("");
    setLoading(true);
    apiFetch(`${API_URL}/api/masters/customers/${customer.id}/`)
      .then((data) => setDetail(data as CustomerDetailData))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [open, customer]);

  const current = detail ?? customer;
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
  const row = (label: string, value: string | number | null | undefined) =>
    value != null && value !== "" ? (
      <div className="flex justify-between py-2 border-b last:border-0 text-sm gap-4">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="font-medium text-right break-words">{value}</span>
      </div>
    ) : null;

  const addrLines = (a?: AddressBlock | null) =>
    [a?.attention, a?.addressLine1, a?.addressLine2, [a?.city, a?.state].filter(Boolean).join(", "), a?.zip, a?.country, a?.phone]
      .filter(Boolean);

  const tabs = [
    { key: "overview", label: "Overview", icon: User },
    { key: "comments", label: "Comments", icon: MessageSquare },
    { key: "transactions", label: "Transactions", icon: ReceiptText },
    { key: "mails", label: "Mails", icon: Send },
    { key: "statement", label: "Statement", icon: FileText },
  ] as const;

  const invoices = detail?.invoices ?? [];
  const payments = detail?.payments ?? [];
  const returns = detail?.returns ?? [];
  const confirmedReturns = returns.filter((ret) => ret.status === "confirmed");
  const pettyCash = detail?.pettyCash ?? [];
  const summary = detail?.summary ?? {
    totalInvoices: 0,
    grossAmount: 0,
    rawPaid: 0,
    outstanding: current?.outstanding ?? 0,
    totalCollected: 0,
    totalReturnAmount: 0,
    unpaidInvoices: 0,
    partialInvoices: 0,
    paidInvoices: 0,
    totalReturns: 0,
    pettyCashCount: 0,
    pettyCashNet: 0,
  };

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

  const pagedInvoices = useMemo(
    () => paginateRows(invoices, invoicePage, invoicePageSize),
    [invoices, invoicePage, invoicePageSize, paginateRows],
  );
  const pagedPayments = useMemo(
    () => paginateRows(payments, paymentPage, paymentPageSize),
    [payments, paymentPage, paymentPageSize, paginateRows],
  );
  const pagedReturns = useMemo(
    () => paginateRows(returns, returnPage, returnPageSize),
    [returns, returnPage, returnPageSize, paginateRows],
  );
  const pagedPettyCash = useMemo(
    () => paginateRows(pettyCash, pettyCashPage, pettyCashPageSize),
    [pettyCash, pettyCashPage, pettyCashPageSize, paginateRows],
  );

  const goTo = useCallback((path: string) => {
    window.location.href = path;
  }, []);

  const loadInvoiceDetail = useCallback(async (invoiceId: number) => {
    setInvoiceDialogOpen(true);
    setInvoiceDialogLoading(true);
    setInvoiceDetail(null);
    try {
      const data = (await apiFetch(`${API_URL}/api/sales/invoices/${invoiceId}/`)) as InvoiceDetailData;
      setInvoiceDetail(data);
    } catch (err) {
      toast({
        title: "Failed to load invoice details",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      setInvoiceDialogOpen(false);
    } finally {
      setInvoiceDialogLoading(false);
    }
  }, [toast]);

  const loadPaymentDetail = useCallback(async (payment: CustomerPayment) => {
    setSelectedPayment(payment);
    setPaymentDialogOpen(true);
    setPaymentDialogLoading(true);
    setPaymentInvoiceDetail(null);
    try {
      const data = (await apiFetch(`${API_URL}/api/sales/invoices/${payment.invoiceId}/`)) as InvoiceDetailData;
      setPaymentInvoiceDetail(data);
    } catch (err) {
      toast({
        title: "Failed to load payment details",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      setPaymentDialogOpen(false);
    } finally {
      setPaymentDialogLoading(false);
    }
  }, [toast]);

  const loadReturnDetail = useCallback(async (returnId: number) => {
    setReturnDialogOpen(true);
    setReturnDialogLoading(true);
    setReturnDetail(null);
    try {
      const data = (await apiFetch(`${API_URL}/api/sales/returns/${returnId}/`)) as CustomerReturn;
      setReturnDetail(data);
    } catch (err) {
      toast({
        title: "Failed to load sales return details",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      setReturnDialogOpen(false);
    } finally {
      setReturnDialogLoading(false);
    }
  }, [toast]);

  const openTransactionDetail = useCallback(
    (
      title: string,
      sections: Array<{
        title: string;
        rows: Array<{ label: string; value: string | number | null | undefined }>;
      }>,
      subtitle?: string,
    ) => {
      setSelectedTransaction({
        title,
        subtitle,
        sections: sections
          .map((section) => ({
            title: section.title,
            rows: section.rows
              .filter((item) => item.value != null && item.value !== "")
              .map((item) => ({ label: item.label, value: String(item.value) })),
          }))
          .filter((section) => section.rows.length > 0),
      });
    },
    [],
  );

  const activityItems = useMemo(() => {
    const items = [
      {
        type: "customer",
        title: "Customer profile created",
        description: current?.createdAt
          ? `Customer ${current.displayName} was created.`
          : "Customer profile available.",
        date: current?.createdAt || "",
        accent: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      },
      ...invoices.map((inv) => ({
        type: "invoice",
        title: `Invoice ${inv.invoiceNumber}`,
        description: `${inv.statusDisplay || inv.status || "Invoice"} • ${money(inv.totalAmount)} • ${inv.paymentStatusDisplay || inv.paymentStatus}`,
        date: inv.createdAt || inv.invoiceDate,
        accent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      })),
      ...payments.map((payment) => ({
        type: payment.transactionType === "refund" || payment.amount < 0 ? "refund" : "payment",
        title:
          payment.transactionType === "refund" || payment.amount < 0
            ? `Refund recorded for ${payment.invoiceNumber}`
            : `Payment received for ${payment.invoiceNumber}`,
        description: `${money(Math.abs(payment.amount))} via ${payment.paymentMethod?.replace(/_/g, " ") || "—"}`,
        date: payment.paymentDate,
        accent:
          payment.transactionType === "refund" || payment.amount < 0
            ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
            : "bg-sky-500/10 text-sky-600 border-sky-500/20",
      })),
      ...returns.map((ret) => ({
        type: "return",
        title: `Sales Return ${ret.returnNumber}`,
        description: `${ret.statusDisplay} • ${money(ret.totalAmount)} • ${ret.warehouseName || "No warehouse"}`,
        date: ret.createdAt || ret.returnDate,
        accent: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      })),
    ];

    return items
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [current?.createdAt, current?.displayName, invoices, payments, returns]);

  const statementRows = useMemo(() => {
    const rows = [
      ...invoices.map((inv) => ({
        date: inv.invoiceDate,
        type: "Invoice",
        reference: inv.invoiceNumber,
        note: inv.statusDisplay || inv.status || "Invoice posted",
        debit: inv.totalAmount,
        credit: 0,
      })),
      ...payments.map((payment) => ({
        date: payment.paymentDate,
        type:
          payment.transactionType === "refund" || payment.amount < 0
            ? "Refund"
            : "Payment",
        reference: payment.invoiceNumber,
        note: payment.referenceNo || payment.paymentMethod || "Payment received",
        debit:
          payment.transactionType === "refund" || payment.amount < 0
            ? Math.abs(payment.amount)
            : 0,
        credit:
          payment.transactionType === "refund" || payment.amount < 0
            ? 0
            : payment.amount,
      })),
      ...confirmedReturns.map((ret) => ({
        date: ret.returnDate,
        type: "Sales Return",
        reference: ret.returnNumber,
        note: ret.invoiceNumber || ret.invoiceNumbers.join(", ") || "Return confirmed",
        debit: 0,
        credit: ret.totalAmount,
      })),
    ]
      .filter((row) => row.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    return rows.map((row) => {
      running += row.debit - row.credit;
      return { ...row, balance: running };
    });
  }, [invoices, payments, confirmedReturns]);

  const mailRows = useMemo(
    () =>
      invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        recipient: current?.email || "No customer email",
        status: current?.email ? "Ready to send" : "Missing email",
        documentStatus: inv.statusDisplay || inv.status || "Draft",
      })),
    [current?.email, invoices],
  );
  const pagedMails = useMemo(
    () => paginateRows(mailRows, mailPage, mailPageSize),
    [mailRows, mailPage, mailPageSize, paginateRows],
  );

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
        const slug = (current.displayName || "customer")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        await downloadBlobFile(
          "/api/reports/generate/",
          {
            report_type: "customer-statement",
            format,
            date_from: statementFilterFrom || undefined,
            date_to: statementFilterTo || undefined,
            filters: {
              customer_id: current.id,
            },
          },
          `${slug || "customer"}-statement.${format === "xlsx" ? "xlsx" : format}`,
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

  if (!open || !customer || !current) return null;

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
      <span>
        {total ? `Showing ${start + 1} to ${end} of ${total}` : "No records"}
      </span>
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
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
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
                  { label: "Outstanding", value: money(current.outstanding) },
                  { label: "Credit Limit", value: money(current.creditLimit) },
                  { label: "Total Invoices", value: summary.totalInvoices },
                  { label: "Collected", value: money(summary.totalCollected) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border p-4 bg-muted/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-xl font-bold">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4">
                  <SectionTitle>Customer Profile</SectionTitle>
                  {row("Display Name", current.displayName)}
                  {row("Full Name", current.fullName)}
                  {row("Company Name", current.companyName)}
                  {row("Customer Type", current.customerType)}
                  {row("Language", current.customerLanguage)}
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
                  {row("Place of Supply", current.placeOfSupply?.replace(/_/g, " "))}
                  {row("Currency", current.currency)}
                  {row("Payment Terms", current.paymentTerms?.replace(/_/g, " "))}
                  {row("Price List", current.priceList)}
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Billing Address</SectionTitle>
                  <div className="space-y-1 text-sm">
                    {addrLines(current.billingAddress).length > 0 ? (
                      addrLines(current.billingAddress).map((line) => <p key={line}>{line}</p>)
                    ) : (
                      <p className="text-muted-foreground">No billing address</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <SectionTitle>Shipping Address</SectionTitle>
                  <div className="space-y-1 text-sm">
                    {addrLines(current.shippingAddress).length > 0 ? (
                      addrLines(current.shippingAddress).map((line) => <p key={line}>{line}</p>)
                    ) : (
                      <p className="text-muted-foreground">No shipping address</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4 lg:col-span-2">
                  <SectionTitle>Receivables & Linked Summary</SectionTitle>
                  {row("Notes", current.notes)}
                  {detail && (
                    <>
                      {row("Gross Invoice Amount", money(summary.grossAmount))}
                      {row("Collected Amount", money(summary.totalCollected))}
                      {row("Return Amount", money(summary.totalReturnAmount))}
                      {row("Unpaid Invoices", summary.unpaidInvoices)}
                      {row("Partial Invoices", summary.partialInvoices)}
                      {row("Paid Invoices", summary.paidInvoices)}
                      {row("Sales Returns", summary.totalReturns)}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {!loading && activeTab === "comments" && (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-2 rounded-xl border p-4">
                <SectionTitle>Customer Remarks</SectionTitle>
                <div className="rounded-xl bg-muted/20 border p-4 min-h-[180px]">
                  {current.notes ? (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{current.notes}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No internal remarks saved for this customer yet.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-xl border p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Contact Status
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {current.email ? "Reachable by email" : "Email missing"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Account Status
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {current.isActive ? "Active customer" : "Inactive customer"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-3 rounded-xl border p-4">
                <SectionTitle>Recent Activity</SectionTitle>
                {activityItems.length ? (
                  <div className="space-y-3">
                    {activityItems.slice(0, 12).map((item, idx) => (
                      <div key={`${item.type}-${idx}`} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={cn("w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-bold", item.accent)}>
                            {item.type[0].toUpperCase()}
                          </div>
                          {idx !== activityItems.slice(0, 12).length - 1 && (
                            <div className="w-px flex-1 bg-border mt-2" />
                          )}
                        </div>
                        <div className="flex-1 pb-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">{item.title}</p>
                            <p className="text-xs text-muted-foreground shrink-0">
                              {fmtDateTime(item.date)}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No activity available for this customer yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === "transactions" && (
            <div className="space-y-4">
              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ReceiptText className="w-4 h-4 text-primary" />
                    <p className="font-semibold">Invoices</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {invoices.length} invoice(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => goTo(`/sales-billing?customerId=${current.id}`)}
                      className="h-8 rounded-lg border border-primary/20 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
                    >
                      New Invoice
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Invoice #", "Date", "Due", "Gross", "Returned", "Net", "Paid", "Balance", "Payment", "Salesperson"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.length ? pagedInvoices.rows.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() =>
                          loadInvoiceDetail(inv.id)
                        }
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadInvoiceDetail(inv.id);
                            }}
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                          >
                            {inv.invoiceNumber}
                          </button>
                        </td>
                        <td className="px-3 py-2">{inv.invoiceDate}</td>
                        <td className="px-3 py-2">{inv.dueDate || "—"}</td>
                        <td className="px-3 py-2">{money(inv.grossTotalAmount ?? inv.totalAmount)}</td>
                        <td className="px-3 py-2">{money(inv.returnAmount)}</td>
                        <td className="px-3 py-2 font-medium">{money(inv.totalAmount)}</td>
                        <td className="px-3 py-2">{money(inv.paidAmount)}</td>
                        <td className="px-3 py-2">{money(inv.balanceAmount)}</td>
                        <td className="px-3 py-2 capitalize">{inv.paymentStatusDisplay || inv.paymentStatus}</td>
                        <td className="px-3 py-2">{inv.salespersonName || "—"}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No invoices found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  invoices.length,
                  pagedInvoices.safePage,
                  pagedInvoices.totalPages,
                  invoicePageSize,
                  setInvoicePage,
                  setInvoicePageSize,
                  pagedInvoices.start,
                  pagedInvoices.end,
                )}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-emerald-600" />
                    <p className="font-semibold">Customer Transactions</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {payments.length} transaction(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => goTo(`/sales-history?newPayment=1&customerId=${current.id}`)}
                      className="h-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/15"
                    >
                      New Payment
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Invoice #", "Type", "Amount", "Method", "Reference", "Notes"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length ? pagedPayments.rows.map((payment) => {
                      const isRefund =
                        payment.transactionType === "refund" || payment.amount < 0;
                      return (
                        <tr
                          key={payment.id}
                          className="border-t hover:bg-muted/20 cursor-pointer"
                          onClick={() =>
                            loadPaymentDetail(payment)
                          }
                        >
                          <td className="px-3 py-2">{payment.paymentDate}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadPaymentDetail(payment);
                              }}
                              className="font-mono text-xs font-semibold text-primary hover:underline"
                            >
                              {payment.invoiceNumber}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                isRefund
                                  ? "bg-amber-500/10 text-amber-600"
                                  : "bg-emerald-500/10 text-emerald-600",
                              )}
                            >
                              {isRefund ? "Refund" : "Payment"}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 font-medium",
                              isRefund ? "text-amber-600" : "text-emerald-600",
                            )}
                          >
                            {isRefund ? "-" : "+"}
                            {money(Math.abs(payment.amount))}
                          </td>
                          <td className="px-3 py-2 capitalize">{payment.paymentMethod?.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2">{payment.referenceNo || "—"}</td>
                          <td className="px-3 py-2">{payment.notes || "—"}</td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No transactions found.</td></tr>
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
                <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-amber-600" />
                    <p className="font-semibold">Sales Returns</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {returns.length} return(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => goTo(`/sales-returns?newReturn=1&customerId=${current.id}`)}
                      className="h-8 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 text-xs font-semibold text-amber-600 hover:bg-amber-500/15"
                    >
                      New Return
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Return #", "Date", "Invoice", "Warehouse", "Total", "Status", "Stock Posted", "Created By"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {returns.length ? pagedReturns.rows.map((ret) => (
                      <tr
                        key={ret.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() =>
                          loadReturnDetail(ret.id)
                        }
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadReturnDetail(ret.id);
                            }}
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                          >
                            {ret.returnNumber}
                          </button>
                        </td>
                        <td className="px-3 py-2">{ret.returnDate}</td>
                        <td className="px-3 py-2">{ret.invoiceNumber || ret.invoiceNumbers.join(", ") || "—"}</td>
                        <td className="px-3 py-2">{ret.warehouseName || "—"}</td>
                        <td className="px-3 py-2 font-medium">{money(ret.totalAmount)}</td>
                        <td className="px-3 py-2">{ret.statusDisplay}</td>
                        <td className="px-3 py-2">{ret.stockPosted ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{ret.createdBy}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No sales returns found.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  returns.length,
                  pagedReturns.safePage,
                  pagedReturns.totalPages,
                  returnPageSize,
                  setReturnPage,
                  setReturnPageSize,
                  pagedReturns.start,
                  pagedReturns.end,
                )}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-sky-600" />
                    <div>
                      <p className="font-semibold">Petty Cash</p>
                      <p className="text-[11px] text-muted-foreground">
                        Customer-linked petty cash entries
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {pettyCash.length} entry(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => goTo("/petty-cash")}
                      className="h-8 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 text-xs font-semibold text-sky-600 hover:bg-sky-500/15"
                    >
                      Open Petty Cash
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Description", "Type", "Category", "Amount", "Balance", "Approved By"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pettyCash.length ? (
                      pagedPettyCash.rows.map((entry) => (
                        <tr
                        key={entry.id}
                        className="border-t hover:bg-muted/20 cursor-pointer"
                        onClick={() =>
                            openTransactionDetail(
                              `Petty Cash ${entry.description}`,
                              [
                                {
                                  title: "Entry Summary",
                                  rows: [
                                    { label: "Date", value: entry.date },
                                    { label: "Description", value: entry.description },
                                    { label: "Type", value: entry.type },
                                    { label: "Category", value: entry.categoryDisplay },
                                    { label: "Amount", value: money(entry.amount) },
                                    { label: "Balance Snapshot", value: money(entry.balance) },
                                  ],
                                },
                                {
                                  title: "Linked Party",
                                  rows: [
                                    { label: "Related Type", value: entry.relatedPartyTypeDisplay },
                                    { label: "Customer", value: entry.customerName || current.displayName },
                                    { label: "Vendor", value: entry.vendorName || "—" },
                                  ],
                                },
                                {
                                  title: "Approval & Notes",
                                  rows: [
                                    { label: "Approved By", value: entry.approvedBy || "—" },
                                    { label: "Created By", value: entry.createdBy || "—" },
                                    { label: "Notes", value: entry.notes || "—" },
                                  ],
                                },
                              ],
                              current.companyName || current.displayName,
                            )
                          }
                        >
                          <td className="px-3 py-2">{entry.date}</td>
                          <td className="px-3 py-2">{entry.description}</td>
                          <td className="px-3 py-2 capitalize">{entry.type}</td>
                          <td className="px-3 py-2">{entry.categoryDisplay}</td>
                          <td className="px-3 py-2 font-medium">{money(entry.amount)}</td>
                          <td className="px-3 py-2">{money(entry.balance)}</td>
                          <td className="px-3 py-2">{entry.approvedBy || "—"}</td>
                        </tr>
                      ))
                    ) : (
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
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="rounded-xl border p-4 xl:col-span-1">
                <SectionTitle>Communication Profile</SectionTitle>
                {row("Primary Email", current.email || "Not available")}
                {row("Phone", current.phone || "Not available")}
                {row("Mobile", current.mobile || "Not available")}
                {row(
                  "Invoice Email Readiness",
                  current.email ? "Customer email is available" : "Add customer email to send invoices",
                )}
                {row(
                  "Confirmed Invoices",
                  invoices.filter((inv) => inv.status === "confirmed").length,
                )}
                {row(
                  "Draft Invoices",
                  invoices.filter((inv) => inv.status === "draft").length,
                )}
              </div>
              <div className="rounded-xl border overflow-hidden xl:col-span-2">
                <div className="px-4 py-3 border-b bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    <p className="font-semibold">Document Mail Readiness</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {mailRows.length} document(s)
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Document", "Date", "Recipient", "Document Status", "Mail Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mailRows.length ? pagedMails.rows.map((mail) => (
                      <tr key={mail.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-xs">{mail.invoiceNumber}</td>
                        <td className="px-3 py-2">{mail.invoiceDate}</td>
                        <td className="px-3 py-2">{mail.recipient}</td>
                        <td className="px-3 py-2">{mail.documentStatus}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                              mail.status === "Ready to send"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20",
                            )}
                          >
                            {mail.status}
                          </span>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No customer documents available for email.</td></tr>
                    )}
                  </tbody>
                </table>
                {renderSectionPagination(
                  mailRows.length,
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
              <div className="rounded-xl border p-4 bg-muted/10">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Statement Filters</p>
                    <p className="text-xs text-muted-foreground">
                      Filter the customer statement by a preset period or choose custom dates, then download it in the format you need.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      ["all", "All"],
                      ["last_day", "Last Day"],
                      ["last_week", "Last Week"],
                      ["last_month", "Last Month"],
                      ["custom", "Custom"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStatementRange(value as typeof statementRange)}
                        className={cn(
                          "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
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
                <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      From Date
                      <input
                        type="date"
                        value={statementRange === "custom" ? statementDateFrom : statementFilterFrom}
                        disabled={statementRange !== "custom"}
                        onChange={(e) => setStatementDateFrom(e.target.value)}
                        className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      To Date
                      <input
                        type="date"
                        value={statementRange === "custom" ? statementDateTo : statementFilterTo}
                        disabled={statementRange !== "custom"}
                        onChange={(e) => setStatementDateTo(e.target.value)}
                        className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadStatement("pdf")}
                      disabled={statementDownloading !== null}
                      className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {statementDownloading === "pdf" ? "Downloading..." : "PDF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadStatement("xlsx")}
                      disabled={statementDownloading !== null}
                      className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {statementDownloading === "xlsx" ? "Downloading..." : "Excel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadStatement("csv")}
                      disabled={statementDownloading !== null}
                      className="h-9 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {statementDownloading === "csv" ? "Downloading..." : "CSV"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {[
                  { label: "Statement Debits", value: money(statementDebits) },
                  { label: "Statement Credits", value: money(statementCredits) },
                  { label: "Current Balance", value: money(statementCurrentBalance) },
                  { label: "Entries", value: filteredStatementRows.length },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border p-4 bg-muted/10">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-lg font-bold">{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      {["Date", "Type", "Reference", "Note", "Debit", "Credit", "Balance"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStatementRows.length ? filteredStatementRows.map((rowItem, idx) => (
                      <tr key={`${rowItem.type}-${rowItem.reference}-${idx}`} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2">{rowItem.date}</td>
                        <td className="px-3 py-2">{rowItem.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{rowItem.reference}</td>
                        <td className="px-3 py-2">{rowItem.note}</td>
                        <td className="px-3 py-2">{rowItem.debit ? money(rowItem.debit) : "—"}</td>
                        <td className="px-3 py-2">{rowItem.credit ? money(rowItem.credit) : "—"}</td>
                        <td className="px-3 py-2 font-semibold">{money(rowItem.balance)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No statement activity found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        {selectedTransaction && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setSelectedTransaction(null)}
          >
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative w-full max-w-lg rounded-2xl border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="font-bold">{selectedTransaction.title}</h3>
                  {selectedTransaction.subtitle ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedTransaction.subtitle}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTransaction(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  {selectedTransaction.sections.map((section) => (
                    <div key={section.title} className="rounded-xl border p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {section.title}
                      </p>
                      <div className="mt-2 space-y-0">
                        {section.rows.map((item) => row(item.label, item.value))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {invoiceDialogOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setInvoiceDialogOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
                <div>
                  <h3 className="font-bold text-xl">
                    {invoiceDetail?.invoiceNumber || "Invoice Details"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {invoiceDetail?.customerName || current.displayName}
                    {invoiceDetail
                      ? ` · Invoice Date: ${fmtDate(invoiceDetail.invoiceDate)} · Due: ${fmtDate(invoiceDetail.dueDate)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInvoiceDialogOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                {invoiceDialogLoading && (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!invoiceDialogLoading && invoiceDetail && (
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <section className="rounded-2xl border overflow-hidden">
                        <div className="border-b px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Invoice Details
                          </p>
                        </div>
                        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                          {[
                            ["Customer", invoiceDetail.customerName],
                            ["Salesperson", invoiceDetail.salespersonName || "—"],
                            ["Phone", invoiceDetail.customerPhone || current.phone || "—"],
                            ["Email", invoiceDetail.customerEmail || current.email || "—"],
                            ["TRN / GST No.", invoiceDetail.customerGst || current.trn || "—"],
                            ["Invoice Date", fmtDate(invoiceDetail.invoiceDate)],
                            ["Due Date", fmtDate(invoiceDetail.dueDate)],
                            ["Status", invoiceDetail.statusDisplay || invoiceDetail.status || "—"],
                            ["Payment Status", invoiceDetail.paymentStatusDisplay || invoiceDetail.paymentStatus || "—"],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl border bg-muted/20 px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                {label}
                              </p>
                              <p className="mt-1 text-sm font-semibold break-words">{value}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                      <aside className="space-y-3 rounded-2xl border p-4">
                        {[
                          ["Grand Total", money(invoiceDetail.totalAmount), "text-primary"],
                          ["Paid", money(invoiceDetail.paidAmount), "text-emerald-600"],
                          ["Balance", money(invoiceDetail.balanceAmount), invoiceDetail.balanceAmount > 0 ? "text-rose-600" : "text-emerald-600"],
                          ["Customer Outstanding", money(invoiceDetail.customerOutstanding ?? current.outstanding), (invoiceDetail.customerOutstanding ?? current.outstanding) > 0 ? "text-rose-600" : "text-emerald-600"],
                        ].map(([label, value, valueClass]) => (
                          <div key={String(label)} className="rounded-2xl border bg-muted/20 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                              {label}
                            </p>
                            <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
                          </div>
                        ))}
                      </aside>
                    </div>

                    <div className="rounded-2xl border overflow-hidden">
                      <div className="border-b px-4 py-3">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          Line Items
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-sm">
                          <thead>
                            <tr className="bg-muted/20 border-b">
                              {["Item", "Type", "Qty", "Batch", "Expiry", "RSP Incl VAT", "RSP Without VAT", "Discount", "Amount / Unit", "Tax%", "Total"].map((head) => (
                                <th key={head} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">
                                  {head}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(invoiceDetail.items || []).map((item, idx) => (
                              <tr key={item.id ?? idx} className="border-b hover:bg-muted/20">
                                <td className="px-3 py-3">
                                  <p className="font-semibold">{item.itemName}</p>
                                  {item.itemDescription ? (
                                    <p className="mt-1 text-[11px] text-muted-foreground">{item.itemDescription}</p>
                                  ) : null}
                                </td>
                                <td className="px-3 py-3 capitalize">{item.itemType || "asset"}</td>
                                <td className="px-3 py-3">{item.quantity}</td>
                                <td className="px-3 py-3">{item.batchNumber || "—"}</td>
                                <td className="px-3 py-3">{item.expiryDate ? fmtDate(item.expiryDate) : "—"}</td>
                                <td className="px-3 py-3">{money(item.rspInclVat ?? item.amountPerUnit)}</td>
                                <td className="px-3 py-3">{money(item.rspWithoutVat ?? item.amountPerUnit)}</td>
                                <td className="px-3 py-3">
                                  {item.discountType === "percent" ? `${item.discount || 0}%` : money(item.discount)}
                                </td>
                                <td className="px-3 py-3">{money(item.amountPerUnit)}</td>
                                <td className="px-3 py-3">{item.taxRate ?? 0}%</td>
                                <td className="px-3 py-3 font-semibold">{money(item.lineTotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {(invoiceDetail.payments || []).length > 0 && (
                      <div className="rounded-2xl border overflow-hidden">
                        <div className="border-b px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Payment History
                          </p>
                        </div>
                        <div className="divide-y">
                          {invoiceDetail.payments!.map((payment) => {
                            const isRefund =
                              payment.transactionType === "refund" ||
                              payment.amount < 0;
                            return (
                              <div key={payment.id} className="flex items-center justify-between gap-4 px-4 py-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p
                                      className={cn(
                                        "font-semibold",
                                        isRefund ? "text-amber-600" : "text-emerald-600",
                                      )}
                                    >
                                      {isRefund ? "-" : "+"}
                                      {money(Math.abs(payment.amount))}
                                    </p>
                                    <span
                                      className={cn(
                                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        isRefund
                                          ? "bg-amber-500/10 text-amber-600"
                                          : "bg-emerald-500/10 text-emerald-600",
                                      )}
                                    >
                                      {isRefund ? "Refund" : "Payment"}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {fmtDate(payment.paymentDate)} · {(payment.paymentMethod || "—").replace(/_/g, " ")}
                                    {payment.referenceNo ? ` · ${payment.referenceNo}` : ""}
                                  </p>
                                </div>
                                <p className="text-sm text-muted-foreground">{payment.notes || "—"}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {paymentDialogOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setPaymentDialogOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
                <div>
                  <h3 className="font-bold text-xl">
                    {(selectedPayment?.transactionType === "refund" ||
                    (selectedPayment?.amount || 0) < 0
                      ? "Refund"
                      : "Payment")}{" "}
                    {selectedPayment?.invoiceNumber || ""}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {current.displayName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentDialogOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                {paymentDialogLoading && (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!paymentDialogLoading && selectedPayment && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          {selectedPayment.transactionType === "refund" ||
                          selectedPayment.amount < 0
                            ? "Refund Details"
                            : "Payment Details"}
                        </p>
                        <div className="mt-2 space-y-0">
                          {row("Customer", current.displayName)}
                          {row("Invoice Number", selectedPayment.invoiceNumber)}
                          {row("Payment Date", fmtDate(selectedPayment.paymentDate))}
                          {row(
                            "Transaction Type",
                            selectedPayment.transactionType === "refund" ||
                              selectedPayment.amount < 0
                              ? "Refund"
                              : "Payment",
                          )}
                          {row(
                            "Amount",
                            `${selectedPayment.transactionType === "refund" ||
                            selectedPayment.amount < 0
                              ? "-"
                              : "+"}${money(Math.abs(selectedPayment.amount))}`,
                          )}
                          {row("Method", (selectedPayment.paymentMethod || "—").replace(/_/g, " "))}
                          {row("Reference", selectedPayment.referenceNo || "—")}
                          {row("Financial Year", selectedPayment.financialYear || "—")}
                          {row("Notes", selectedPayment.notes || "—")}
                        </div>
                      </div>
                      <div className="rounded-2xl border p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          Linked Invoice Summary
                        </p>
                        <div className="mt-2 space-y-0">
                          {row("Invoice Number", paymentInvoiceDetail?.invoiceNumber || selectedPayment.invoiceNumber)}
                          {row("Invoice Date", fmtDate(paymentInvoiceDetail?.invoiceDate))}
                          {row("Due Date", fmtDate(paymentInvoiceDetail?.dueDate))}
                          {row("Grand Total", money(paymentInvoiceDetail?.totalAmount))}
                          {row("Paid Amount", money(paymentInvoiceDetail?.paidAmount))}
                          {row("Balance Amount", money(paymentInvoiceDetail?.balanceAmount))}
                          {row("Payment Status", paymentInvoiceDetail?.paymentStatusDisplay || paymentInvoiceDetail?.paymentStatus || "—")}
                        </div>
                      </div>
                    </div>
                    {paymentInvoiceDetail?.items?.length ? (
                      <div className="rounded-2xl border overflow-hidden">
                        <div className="border-b px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Linked Invoice Items
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] text-sm">
                            <thead>
                              <tr className="bg-muted/20 border-b">
                                {["Item", "Qty", "Batch", "Expiry", "Unit Price", "Tax%", "Total"].map((head) => (
                                  <th key={head} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    {head}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {paymentInvoiceDetail.items.map((item, idx) => (
                                <tr key={item.id ?? idx} className="border-b hover:bg-muted/20">
                                  <td className="px-3 py-3 font-semibold">{item.itemName}</td>
                                  <td className="px-3 py-3">{item.quantity}</td>
                                  <td className="px-3 py-3">{item.batchNumber || "—"}</td>
                                  <td className="px-3 py-3">{item.expiryDate ? fmtDate(item.expiryDate) : "—"}</td>
                                  <td className="px-3 py-3">{money(item.amountPerUnit)}</td>
                                  <td className="px-3 py-3">{item.taxRate ?? 0}%</td>
                                  <td className="px-3 py-3 font-semibold">{money(item.lineTotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {returnDialogOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setReturnDialogOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
                <div>
                  <h3 className="font-bold text-xl">
                    {returnDetail?.returnNumber || "Sales Return Details"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {current.displayName}
                    {returnDetail
                      ? ` · ${returnDetail.invoiceNumber || returnDetail.invoiceNumbers.join(", ") || "—"}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReturnDialogOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                {returnDialogLoading && (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!returnDialogLoading && returnDetail && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          Return Summary
                        </p>
                        <div className="mt-2 space-y-0">
                          {row("Return Number", returnDetail.returnNumber)}
                          {row("Customer", current.displayName)}
                          {row("Return Date", fmtDate(returnDetail.returnDate))}
                          {row("Invoice Number", returnDetail.invoiceNumber || returnDetail.invoiceNumbers.join(", ") || "—")}
                          {row("Warehouse", returnDetail.warehouseName || "—")}
                          {row("Status", returnDetail.statusDisplay)}
                          {row("Stock Posted", returnDetail.stockPosted ? "Yes" : "No")}
                          {row("Created By", returnDetail.createdBy)}
                        </div>
                      </div>
                      <div className="rounded-2xl border p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          Notes & Amounts
                        </p>
                        <div className="mt-2 space-y-0">
                          {row("Subtotal", money(returnDetail.subtotal))}
                          {row("Tax Amount", money(returnDetail.taxAmount))}
                          {row("Total Amount", money(returnDetail.totalAmount))}
                          {row("Reason", returnDetail.reason || "—")}
                          {row("Notes", returnDetail.notes || "—")}
                          {row("Created At", fmtDateTime(returnDetail.createdAt))}
                        </div>
                      </div>
                    </div>
                    {(returnDetail.items || []).length > 0 && (
                      <div className="rounded-2xl border overflow-hidden">
                        <div className="border-b px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Returned Items
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[760px] text-sm">
                            <thead>
                              <tr className="bg-muted/20 border-b">
                                {["Invoice", "Item", "Qty", "Disposition", "Line Total"].map((head) => (
                                  <th key={head} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    {head}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {returnDetail.items!.map((item) => (
                                <tr key={item.id} className="border-b hover:bg-muted/20">
                                  <td className="px-3 py-3">{item.invoiceNumber || returnDetail.invoiceNumber || "—"}</td>
                                  <td className="px-3 py-3 font-semibold">{item.itemName}</td>
                                  <td className="px-3 py-3">{item.quantity}</td>
                                  <td className="px-3 py-3 capitalize">{item.disposition || "restock"}</td>
                                  <td className="px-3 py-3 font-semibold">{money(item.lineTotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
  );
}

// ─── Invoices Dialog ───────────────────────────────────────────────────────────

function CustomerInvoicesDialog({
  open,
  onClose,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  customer: CustomerData | null;
}) {
  const [data, setData] = useState<{
    invoices: Invoice[];
    totalInvoices: number;
    totalAmount: number;
    totalPaid: number;
    totalBalance: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customer) return;
    setLoading(true);
    apiFetch(`${API_URL}/api/masters/customers/${customer.id}/invoices/`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, customer]);

  if (!open || !customer) return null;

  const statusCls: Record<string, string> = {
    unpaid: "text-rose-600",
    partial: "text-amber-600",
    paid: "text-emerald-600",
    cancelled: "text-muted-foreground",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="font-bold">Invoices — {customer.displayName}</h2>
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
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Total Invoices", value: data.totalInvoices },
                  {
                    label: "Total Amount",
                    value: data.totalAmount.toLocaleString(),
                  },
                  {
                    label: "Total Paid",
                    value: data.totalPaid.toLocaleString(),
                  },
                  {
                    label: "Balance Due",
                    value: data.totalBalance.toLocaleString(),
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="font-semibold mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>
              {data.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No invoices found.
                </p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        {[
                          "Invoice #",
                          "Date",
                          "Due",
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
                      {data.invoices.map((inv) => (
                        <tr key={inv.id} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">
                            {inv.invoiceNumber}
                          </td>
                          <td className="px-3 py-2">{inv.invoiceDate}</td>
                          <td className="px-3 py-2">{inv.dueDate || "—"}</td>
                          <td className="px-3 py-2 font-medium">
                            {inv.totalAmount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            {inv.paidAmount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            {inv.balanceAmount.toLocaleString()}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 font-medium capitalize",
                              statusCls[inv.paymentStatus] || "",
                            )}
                          >
                            {inv.paymentStatus}
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
              Failed to load invoices.
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

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerData | null>(null);
  const [viewTarget, setViewTarget] = useState<CustomerData | null>(null);
  const [invoicesTarget, setInvoicesTarget] = useState<CustomerData | null>(
    null,
  );

  const { toast } = useToast();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("customerType", typeFilter);
      if (activeFilter) params.set("isActive", activeFilter);
      const data = await apiFetch(
        `${API_URL}/api/masters/customers/?${params}`,
      );
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, activeFilter]);

  useEffect(() => {
    const t = setTimeout(fetchCustomers, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchCustomers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, activeFilter, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(customers.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = customers.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage,
  );
  const from = customers.length === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const to = Math.min(safePage * itemsPerPage, customers.length);

  const stats = useMemo(
    () => ({
      total: customers.length,
      active: customers.filter((c) => c.isActive).length,
      outstanding: customers.reduce((s, c) => s + c.outstanding, 0),
    }),
    [customers],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your customers and invoice history
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Customer
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            label: "Total Customers",
            value: stats.total,
            cls: "bg-blue-500/10 text-blue-600 border-blue-500/20",
          },
          {
            label: "Active",
            value: stats.active,
            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          },
          {
            label: "Total Outstanding",
            value: stats.outstanding.toLocaleString(),
            cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
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

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company…"
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
        >
          <option value="">All Types</option>
          <option value="business">Business</option>
          <option value="individual">Individual</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="h-9 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <button
          onClick={fetchCustomers}
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
            onClick={fetchCustomers}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium"
          >
            Retry
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
              <User className="w-12 h-12 text-muted-foreground opacity-30" />
              <p className="text-sm font-semibold">No customers found</p>
              <p className="text-xs text-muted-foreground">
                {search
                  ? "Try a different search."
                  : "Add your first customer."}
              </p>
              {!search && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> New Customer
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    {[
                      "Customer",
                      "Contact",
                      "Location",
                      "Type",
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
                  {paginated.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setViewTarget(c)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-semibold">{c.displayName}</p>
                            <p className="text-xs text-muted-foreground">
                              {c.companyName || c.fullName || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <Mail className="w-3 h-3 text-muted-foreground" />{" "}
                            {c.email || "—"}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Phone className="w-3 h-3 text-muted-foreground" />{" "}
                            {c.phone || "—"}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          {[c.billingAddress?.city, c.billingAddress?.state]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-border bg-muted/30 capitalize">
                          {c.customerType || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {c.outstanding.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Limit: {c.creditLimit.toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                            c.isActive
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              : "bg-muted/50 text-muted-foreground border-border",
                          )}
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(c);
                            }}
                            title="Edit"
                            className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInvoicesTarget(c);
                            }}
                            title="Invoices"
                            className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-600"
                          >
                            <ReceiptText className="w-3.5 h-3.5" />
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
      {!loading && customers.length > 0 && (
        <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Showing {from} to {to} of {customers.length} customers
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
      <CustomerFormDialog
        open={formOpen || !!editTarget}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        initial={editTarget}
        onSaved={fetchCustomers}
      />
      <ViewCustomerDialog
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        customer={viewTarget}
        onEdit={(customer) => {
          setViewTarget(null);
          setEditTarget(customer);
        }}
      />
      <CustomerInvoicesDialog
        open={!!invoicesTarget}
        onClose={() => setInvoicesTarget(null)}
        customer={invoicesTarget}
      />
    </div>
  );
}
