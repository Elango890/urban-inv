// src/pages/SalesHistory.tsx
// Added server-side pagination + searchable asset dropdown for invoice editing

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  X,
  XCircle,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { useAuth, useFYParam } from "@/contexts/AuthContext";

type InvStatus = "draft" | "confirmed" | "cancelled";
type PayStatus = "unpaid" | "partial" | "paid";

interface Customer {
  id: number;
  name: string;
  phone?: string;
  outstanding?: number;
}
interface Asset {
  id: number;
  name: string;
  code: string;
  category: string;
  sellingPrice: number;
  availableStock: number;
  batchNumber?: string;
  expiryDate?: string | null;
  warehouses?: {
    warehouseId: number;
    warehouseName: string;
    available: number;
  }[];
}
interface SalespersonOption {
  id: number;
  name: string;
  email: string;
  department?: string;
}
interface InvItem {
  id?: number;
  itemType: string;
  assetId?: number | null;
  serviceId?: number | null;
  itemName: string;
  itemDescription?: string;
  batchNumber?: string;
  expiryDate?: string | null;
  quantity: number;
  unitPrice: number;
  rspInclVat?: number;
  rspWithoutVat?: number;
  discountType?: "amount" | "percent";
  discount: number;
  taxRate: number;
  amountPerUnit?: number;
  netAmount?: number;
  lineTotal?: number;
  batchAllocations?: {
    batchId: number;
    batchNumber: string;
    expiryDate: string | null;
    warehouseId: number;
    warehouseName: string;
    quantity: number;
  }[];
}
interface Payment {
  id: number;
  paymentDate: string;
  amount: number;
  transactionType?: "payment" | "refund";
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
}
interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerId: number | null;
  salespersonId?: number | null;
  salespersonName?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerGst?: string;
  customerOutstanding?: number;
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  grossTotalAmount?: number;
  returnAmount?: number;
  rawPaidAmount?: number;
  refundableAmount?: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: InvStatus;
  statusDisplay: string;
  paymentStatus: PayStatus;
  paymentStatusDisplay: string;
  notes: string;
  termsAndConditions: string;
  items?: InvItem[];
  payments?: Payment[];
}
interface Stats {
  totalInvoiced: number;
  totalPaid: number;
  totalBalance: number;
  unpaidCount: number;
  partialCount: number;
  paidCount: number;
  overdueCount: number;
  overdueAmount: number;
  monthlyRevenue: number;
  monthlyInvoices: number;
}
interface PaginatedInvoices {
  results: Invoice[];
  count: number;
  next: string | null;
  previous: string | null;
}

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function getToken() {
  try {
    return (
      JSON.parse(window.sessionStorage.getItem("user") || "{}")?.access_token ??
      ""
    );
  } catch {
    return "";
  }
}
function authHdrs(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}
async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}/api/sales${path}`, {
    ...opts,
    headers: { ...authHdrs(), ...(opts.headers ?? {}) },
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
      status: res.status,
      body,
    });
  return body;
}
async function apiFetchUsers(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}/api/users${path}`, {
    ...opts,
    headers: { ...authHdrs(), ...(opts.headers ?? {}) },
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
      status: res.status,
      body,
    });
  return body;
}

async function downloadPDF(invoiceId: number, invoiceNumber: string) {
  try {
    const res = await fetch(
      `${API_URL}/api/sales/invoices/${invoiceId}/pdf/?download=true`,
      {
        headers: { Authorization: `Bearer ${getToken()}` },
      },
    );
    if (res.status === 401) {
      window.sessionStorage.clear();
      window.location.href = "/login";
      return;
    }
    if (!res.ok) {
      toast({
        title: "PDF generation failed",
        description: `Status ${res.status}`,
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice_${invoiceNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    toast({
      title: "Download failed",
      description: getApiErrorMessage(err),
      variant: "destructive",
    });
  }
}

async function viewPDF(invoiceId: number) {
  try {
    const res = await fetch(`${API_URL}/api/sales/invoices/${invoiceId}/pdf/`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (res.status === 401) {
      window.sessionStorage.clear();
      window.location.href = "/login";
      return;
    }
    if (!res.ok) {
      toast({
        title: "PDF generation failed",
        description: `Status ${res.status}`,
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err: any) {
    toast({
      title: "Open failed",
      description: getApiErrorMessage(err),
      variant: "destructive",
    });
  }
}

const fmt = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(v);
const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("en-AE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
];

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
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
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none",
      className,
    )}
  >
    {children}
  </select>
);
const Field = ({
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
    <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
      {label}
      {required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-xs text-rose-500 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {error}
      </p>
    )}
  </div>
);

const PAY_CFG: Record<string, { label: string; cls: string }> = {
  unpaid: {
    label: "Unpaid",
    cls: "bg-rose-500/15 text-rose-600 border-rose-500/20 dark:text-rose-400",
  },
  partial: {
    label: "Partial",
    cls: "bg-amber-500/15 text-amber-600 border-amber-500/20 dark:text-amber-400",
  },
  paid: {
    label: "Paid",
    cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  },
};
const INV_CFG: Record<string, { label: string; cls: string }> = {
  draft: {
    label: "Draft",
    cls: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
  },
  confirmed: {
    label: "Completed",
    cls: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  },
};
const Chip = ({ label, cls }: { label: string; cls: string }) => (
  <span
    className={cn(
      "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
      cls,
    )}
  >
    {label}
  </span>
);

type ItemType = "asset";
type DiscountType = "amount" | "percent";
type VatChoice = "5" | "0" | "new" | "custom";
interface ItemRow {
  type: ItemType;
  assetId: string;
  serviceId: string;
  itemName: string;
  itemDescription: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  rspInclVat: string;
  rspWithoutVat: string;
  discountType: DiscountType;
  discount: string;
  taxRate: string;
  notes: string;
  availableStock?: number;
}
const emptyRow = (): ItemRow => ({
  type: "asset",
  assetId: "",
  serviceId: "",
  itemName: "",
  itemDescription: "",
  batchNumber: "",
  expiryDate: "",
  quantity: "1",
  rspInclVat: "0",
  rspWithoutVat: "0",
  discountType: "amount",
  discount: "0",
  taxRate: "5",
  notes: "",
});
const toTwo = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
const normalizeVatInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(Number(digits), 100));
};
const normalizeWholeNumberInput = (value: string, max?: number) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits);
  return String(typeof max === "number" ? Math.min(n, max) : n);
};
function amountPerUnit(r: ItemRow) {
  const rspWithoutVat = Number(r.rspWithoutVat) || 0;
  const discount = Number(r.discount) || 0;
  const discountPerUnit =
    r.discountType === "percent"
      ? (rspWithoutVat * Math.min(discount, 100)) / 100
      : Math.min(discount, rspWithoutVat);
  return Math.max(rspWithoutVat - discountPerUnit, 0);
}
function rowTotal(r: ItemRow) {
  const net = (Number(r.quantity) || 0) * amountPerUnit(r);
  return Math.round(net * 100) / 100;
}
function totals(rows: ItemRow[]) {
  let s = 0,
    d = 0,
    t = 0;
  rows.forEach((r) => {
    const qty = Number(r.quantity) || 0;
    const sub = qty * amountPerUnit(r);
    const price = Number(r.rspWithoutVat) || 0;
    const rawDiscount = Number(r.discount) || 0;
    const discPerUnit =
      r.discountType === "percent"
        ? (price * Math.min(rawDiscount, 100)) / 100
        : Math.min(rawDiscount, price);
    const disc = qty * discPerUnit;
    const tax = (sub * (Number(r.taxRate) || 0)) / 100;
    s += sub;
    d += disc;
    t += tax;
  });
  return {
    sub: Math.round(s * 100) / 100,
    disc: Math.round(d * 100) / 100,
    tax: Math.round(t * 100) / 100,
    total: Math.round((s + t) * 100) / 100,
  };
}
function buildItemPayload(rows: ItemRow[]) {
  return rows.map((r) => ({
    itemType: "asset",
    assetId: Number(r.assetId) || undefined,
    itemName: r.itemName,
    itemDescription: r.itemDescription,
    batchNumber: r.batchNumber,
    expiryDate: r.expiryDate || null,
    quantity: Number(r.quantity || 0),
    unitPrice: Number(r.rspWithoutVat || 0),
    rspInclVat: Number(r.rspInclVat || 0),
    rspWithoutVat: Number(r.rspWithoutVat || 0),
    discountType: r.discountType,
    discount: Number(r.discount || 0),
    taxRate: Number(r.taxRate || 0),
    notes: r.notes,
  }));
}

// ─── Searchable Asset Dropdown ─────────────────────────────────────────────────
function AssetSearchDropdown({
  assets,
  value,
  onChange,
  error,
}: {
  assets: Asset[];
  value: string;
  onChange: (assetId: string, asset: Asset | undefined) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = assets.find((a) => String(a.id) === value);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [assets, query]);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-9 px-3 rounded-lg border bg-background text-sm text-left flex items-center justify-between transition-colors",
          open ? "border-primary ring-2 ring-primary/30" : "border-border",
          error ? "border-rose-500" : "",
        )}
      >
        {selected ? (
          <span className="truncate text-foreground">
            {selected.name}{" "}
            <span className="text-muted-foreground text-xs">
              (Stock: {selected.availableStock} · AED 
              {selected.sellingPrice.toLocaleString()})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select asset…</span>
        )}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full border border-border rounded-xl shadow-xl overflow-hidden">
          {/* Search bar */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, code, category…"
                className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Asset list — scrollable */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No assets found.
              </div>
            ) : (
              filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onChange(String(a.id), a);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-2.5 text-left hover:bg-primary/5 flex items-center justify-between gap-3 transition-colors border-b border-border/40 last:border-0",
                    String(a.id) === value && "bg-primary/10",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {a.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.code} · {a.category}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      AED {a.sellingPrice.toLocaleString()}
                    </p>
                    <p
                      className={cn(
                        "text-[11px] font-medium",
                        a.availableStock > 0
                          ? "text-emerald-600"
                          : "text-rose-500",
                      )}
                    >
                      Stock: {a.availableStock}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer count */}
          <div className="px-3 py-1.5 border-t border-border bg-muted/30">
            <p className="text-[10px] text-muted-foreground">
              {filtered.length} of {assets.length} assets
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[10px] text-rose-500 mt-0.5 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  desc,
  btnLabel,
  btnCls,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  desc: string;
  btnLabel: string;
  btnCls: string;
  loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex-1 h-9 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50",
              btnCls,
            )}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Invoice Form Dialog ──────────────────────────────────────────────────────
function InvoiceFormDialog({
  open,
  onClose,
  onSaved,
  initial,
  customers,
  salespersons,
  assets,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: Invoice | null;
  customers: Customer[];
  salespersons: SalespersonOption[];
  assets: Asset[];
}) {
  const { selectedFY } = useAuth();
  const isEdit = !!initial;
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [custId, setCustId] = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [invDate, setID] = useState("");
  const [dueDate, setDD] = useState("");
  const [notes, setN] = useState("");
  const [terms, setT] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [offerEnabled, setOfferEnabled] = useState(false);
  const [offerText, setOfferText] = useState("");
  const [vatChoice, setVatChoice] = useState<VatChoice>("5");
  const [newVatRate, setNewVatRate] = useState("5");
  const [customVatRate, setCustomVatRate] = useState("5");

  const applyInitialVatMode = (items: { taxRate?: number | string | null }[] = []) => {
    const rates = items.map((item) => String(item.taxRate ?? 5));
    const firstRate = normalizeVatInput(rates[0] || "5") || "0";
    const allSame = rates.every((rate) => (normalizeVatInput(rate) || "0") === firstRate);
    if (allSame && (firstRate === "5" || firstRate === "0")) {
      setVatChoice(firstRate as "5" | "0");
      setNewVatRate("5");
      setCustomVatRate(firstRate);
    } else if (allSame) {
      setVatChoice("new");
      setNewVatRate(firstRate);
      setCustomVatRate(firstRate);
    } else {
      setVatChoice("custom");
      setNewVatRate(firstRate);
      setCustomVatRate(firstRate);
    }
  };

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initial) {
      setCustId(initial.customerId ? String(initial.customerId) : "");
      setSalespersonId(initial.salespersonId ? String(initial.salespersonId) : "");
      setID(initial.invoiceDate || "");
      setDD(initial.dueDate || "");
      setN(initial.notes || "");
      setT(initial.termsAndConditions || "");
      setOfferText("");
      setOfferEnabled(false);
      setRows(
        (initial.items || []).map((i) => ({
          type: "asset",
          assetId: i.assetId ? String(i.assetId) : "",
          serviceId: "",
          itemName: i.itemName || "",
          itemDescription: i.itemDescription || "",
          batchNumber: i.batchNumber || "",
          expiryDate: i.expiryDate || "",
          quantity: String(i.quantity ?? 1),
          rspInclVat: String(i.rspInclVat ?? i.unitPrice ?? 0),
          rspWithoutVat: String(i.rspWithoutVat ?? i.unitPrice ?? 0),
          discountType: i.discountType || "amount",
          discount: String(i.discount ?? 0),
          taxRate: String(i.taxRate ?? 0),
          notes: "",
        })),
      );
      applyInitialVatMode(initial.items || []);
      if (!initial.items || initial.items.length === 0) {
        setLoadingItems(true);
        apiFetch(`/invoices/${initial.id}/`)
          .then((full: any) => {
            if (full?.items?.length) {
              setRows(
                full.items.map((i: any) => ({
                  type: "asset",
                  assetId: i.assetId ? String(i.assetId) : "",
                  serviceId: "",
                  itemName: i.itemName || "",
                  itemDescription: i.itemDescription || "",
                  batchNumber: i.batchNumber || "",
                  expiryDate: i.expiryDate || "",
                  quantity: String(i.quantity ?? 1),
                  rspInclVat: String(i.rspInclVat ?? i.unitPrice ?? 0),
                  rspWithoutVat: String(i.rspWithoutVat ?? i.unitPrice ?? 0),
                  discountType: i.discountType || "amount",
                  discount: String(i.discount ?? 0),
                  taxRate: String(i.taxRate ?? 0),
                  notes: "",
                })),
              );
              applyInitialVatMode(full.items || []);
            }
          })
          .finally(() => setLoadingItems(false));
      }
    } else {
      setCustId("");
      setSalespersonId("");
      setID("");
      setDD("");
      setN("");
      setT("");
      setOfferEnabled(false);
      setOfferText("");
      setVatChoice("5");
      setNewVatRate("5");
      setCustomVatRate("5");
      setRows([emptyRow()]);
    }
  }, [open, initial]);

  const upd = (i: number, p: Partial<ItemRow>) =>
    setRows((r) => {
      const n = [...r];
      n[i] = { ...n[i], ...p };
      return n;
    });

  const selectedVatRate =
    vatChoice === "new"
      ? Number(newVatRate) || 0
      : vatChoice === "custom"
        ? Number(customVatRate) || 0
        : Number(vatChoice) || 0;

  useEffect(() => {
    if (vatChoice === "custom") return;
    setRows((current) =>
      current.map((row) => {
        const rspWithout = Number(row.rspWithoutVat) || 0;
        const rspIncl = rspWithout * (1 + selectedVatRate / 100);
        return {
          ...row,
          taxRate: String(selectedVatRate),
          rspInclVat: toTwo(rspIncl),
        };
      }),
    );
  }, [selectedVatRate, vatChoice]);

  const selectAssetForRow = (idx: number, assetId: string, asset?: Asset) => {
    setRows((current) =>
      current.map((row, rowIdx) => {
        if (rowIdx !== idx) return row;
        const rowVatRate =
          vatChoice === "custom"
            ? Number(normalizeVatInput(customVatRate || row.taxRate)) || 0
            : selectedVatRate;
        const rspIncl = asset?.sellingPrice ?? 0;
        const rspWithout =
          rowVatRate > 0 ? rspIncl / (1 + rowVatRate / 100) : rspIncl;
        return {
          ...row,
          assetId,
          itemName: asset?.name || "",
          batchNumber: asset?.batchNumber || "",
          expiryDate: asset?.expiryDate || "",
          rspInclVat: toTwo(rspIncl),
          rspWithoutVat: toTwo(rspWithout),
          taxRate: String(rowVatRate),
          discountType: "amount",
          availableStock: asset?.availableStock,
        };
      }),
    );
  };

  const updateRspIncl = (idx: number, value: string) => {
    const rspIncl = Number(value) || 0;
    const rspWithout =
      selectedVatRate > 0 ? rspIncl / (1 + selectedVatRate / 100) : rspIncl;
    upd(idx, { rspInclVat: value, rspWithoutVat: toTwo(rspWithout) });
  };

  const updateRspWithout = (idx: number, value: string) => {
    const rspWithout = Number(value) || 0;
    const rspIncl = rspWithout * (1 + selectedVatRate / 100);
    upd(idx, { rspWithoutVat: value, rspInclVat: toTwo(rspIncl) });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!custId) e.custId = "Customer is required.";
    if (!invDate) e.invDate = "Invoice date is required.";
    if (!rows.length) e.items = "At least one line item is required.";
    rows.forEach((r, i) => {
      if (!r.assetId) e[`r${i}`] = "Select an asset.";
      const qty = Number(r.quantity) || 0;
      if (!Number.isInteger(qty)) e[`r${i}_qty`] = "Qty must be a whole number.";
      else if (qty <= 0) e[`r${i}_qty`] = "Qty > 0.";
      if ((Number(r.rspWithoutVat) || 0) < 0) e[`r${i}_rspWithout`] = "RSP without VAT >= 0.";
      if ((Number(r.rspInclVat) || 0) < 0) e[`r${i}_rspIncl`] = "RSP incl VAT >= 0.";
      const discount = Number(r.discount) || 0;
      if (!Number.isInteger(discount)) e[`r${i}_disc`] = "Discount must be a whole number.";
      else if (discount < 0) e[`r${i}_disc`] = "Discount >= 0.";
      else if (r.discountType === "percent" && discount > 100)
        e[`r${i}_disc`] = "Percentage discount cannot exceed 100.";
      else if (r.discountType === "amount" && discount > (Number(r.rspWithoutVat) || 0))
        e[`r${i}_disc`] = "Discount cannot exceed RSP without VAT.";
      const tax = Number(r.taxRate) || 0;
      if (!Number.isInteger(tax)) e[`r${i}_tax`] = "VAT must be a whole number.";
      else if (tax < 0 || tax > 100) e[`r${i}_tax`] = "VAT must be between 0 and 100.";
    });
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    if (!selectedFY) {
      toast({
        title: "Select a financial year",
        description: "Please pick a financial year before saving.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customerId: Number(custId),
        salespersonId: salespersonId ? Number(salespersonId) : null,
        financial_year: selectedFY.id,
        invoiceDate: invDate,
        dueDate: dueDate || null,
        notes,
        termsAndConditions: terms,
        taxEnabled: rows.some((row) => (Number(row.taxRate) || 0) > 0),
        gstType: "vat",
        discountEnabled: true,
        discountMode: "fixed",
        discountValue: 0,
        offerEnabled,
        offerText,
        items: buildItemPayload(rows),
      };
      if (isEdit)
        await apiFetch(`/invoices/${initial!.id}/update/`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      else
        await apiFetch("/invoices/create/", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      toast({ title: isEdit ? "Invoice updated" : "Invoice created." });
      onSaved();
      onClose();
    } catch (err: any) {
      const body = err.body;
      if (body?.fieldErrors) setErrors(body.fieldErrors);
      else if (body?.itemErrors?.length)
        toast({
          title: "Validation error",
          description: body.itemErrors.join("; "),
          variant: "destructive",
        });
      else
        toast({
          title: "Failed",
          description: getApiErrorMessage(err),
          variant: "destructive",
        });
    } finally {
      setSaving(false);
    }
  };

  const t = useMemo(() => totals(rows), [rows]);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-[28px] shadow-2xl w-full max-w-7xl max-h-[94vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">
                {isEdit ? "Edit Invoice" : "New Sales Invoice"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? initial?.invoiceNumber
                  : "Create a new customer invoice"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="border-b border-border px-5 py-4">
                  <h3 className="text-lg font-bold text-foreground">
                    Customer & Invoice Details
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Update customer, dates, salesperson, notes, and invoice instructions.
                  </p>
                </div>
                <div className="p-5 space-y-5">
                  <div className="grid gap-4 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <Field label="Customer" error={errors.custId} required>
                        <div className="relative">
                          <Sel value={custId} onChange={(e) => setCustId(e.target.value)}>
                            <option value="">Select customer…</option>
                            {customers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </Sel>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                        </div>
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <Field label="Invoice Date" error={errors.invDate} required>
                        <Inp
                          type="date"
                          value={invDate}
                          onChange={(e) => setID(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-4">
                      <Field label="Due Date">
                        <Inp
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDD(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-4">
                      <Field label="Salesperson">
                        <div className="relative">
                          <Sel
                            value={salespersonId}
                            onChange={(e) => setSalespersonId(e.target.value)}
                          >
                            <option value="">Select salesperson…</option>
                            {salespersons.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </Sel>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                        </div>
                      </Field>
                    </div>
                    <div className="md:col-span-8">
                      <Field label="Notes">
                        <Inp
                          value={notes}
                          onChange={(e) => setN(e.target.value)}
                          placeholder="Internal notes..."
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-5">
                      <Field label="Terms & Conditions">
                        <textarea
                          value={terms}
                          onChange={(e) => setT(e.target.value)}
                          rows={4}
                          placeholder="e.g. Net 30, warranty, return policy..."
                          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-7">
                      <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-4">
                        <div>
                          <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
                            Tax & Commercial Settings
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Keep VAT and commercial notes aligned with the sales billing page.
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="rounded-xl border border-border bg-background px-4 py-3 flex flex-col gap-1">
                            <span className="text-sm font-semibold text-foreground">VAT Rate</span>
                            <span className="text-xs text-muted-foreground">
                              Applied to each asset line
                            </span>
                          </label>
                          <label className="rounded-xl border border-border bg-background px-4 py-3 flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={offerEnabled}
                              onChange={(e) => setOfferEnabled(e.target.checked)}
                              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                            />
                            <span className="flex flex-col">
                              <span className="text-sm font-semibold text-foreground">Offer Enabled</span>
                              <span className="text-xs text-muted-foreground">
                                Show promotional note
                              </span>
                            </span>
                          </label>
                          <Field label="VAT Rate">
                            <div className="space-y-2">
                              <div className="relative">
                                <Sel
                                  value={vatChoice}
                                  onChange={(e) => setVatChoice(e.target.value as VatChoice)}
                                >
                                  <option value="5">5%</option>
                                  <option value="0">0%</option>
                                  <option value="new">New VAT Percentage</option>
                                  <option value="custom">User Defined</option>
                                </Sel>
                                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                              </div>
                              {vatChoice === "new" && (
                                <div className="space-y-1">
                                  <Inp
                                    type="text"
                                    inputMode="numeric"
                                    value={newVatRate}
                                    onChange={(e) =>
                                      setNewVatRate(normalizeVatInput(e.target.value))
                                    }
                                    placeholder="New VAT percentage"
                                  />
                                  <p className="text-[11px] text-muted-foreground">
                                    Applies this VAT percentage to all item lines.
                                  </p>
                                </div>
                              )}
                              {vatChoice === "custom" && (
                                <div className="space-y-1">
                                  <Inp
                                    type="text"
                                    inputMode="numeric"
                                    value={customVatRate}
                                    onChange={(e) =>
                                      setCustomVatRate(normalizeVatInput(e.target.value))
                                    }
                                    placeholder="Default VAT percentage"
                                  />
                                  <p className="text-[11px] text-muted-foreground">
                                    Used as the default. Edit VAT % on each item line.
                                  </p>
                                </div>
                              )}
                            </div>
                          </Field>
                          <Field label="Offer Text">
                            <Inp
                              value={offerText}
                              onChange={(e) => setOfferText(e.target.value)}
                              placeholder="Extra allowance..."
                              disabled={!offerEnabled}
                            />
                          </Field>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Item Table</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Update assets, quantities, pricing, and row totals before saving.
                    </p>
                  </div>
                  <button
                    onClick={() => setRows((r) => [...r, emptyRow()])}
                    className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                  >
                    + Add Item
                  </button>
                </div>

                {errors.items && (
                  <div className="px-5 pt-4">
                    <p className="text-xs text-rose-500">{errors.items}</p>
                  </div>
                )}

                <div className="space-y-4 px-5 py-5">
                  {rows.map((r, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl border border-border bg-muted/10 p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Line Item {idx + 1}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Select the asset and update pricing, stock details, and totals.
                          </p>
                        </div>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRows((p) => p.filter((_, i) => i !== idx))}
                            className="h-9 w-9 rounded-xl border border-border text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                            title="Delete row"
                          >
                            <X className="mx-auto h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
                        <Field label="Item Details" error={errors[`r${idx}`]}>
                          <div className="space-y-2">
                            <AssetSearchDropdown
                              assets={assets}
                              value={r.assetId}
                              onChange={(assetId, asset) =>
                                selectAssetForRow(idx, assetId, asset)
                              }
                              error={errors[`r${idx}`]}
                            />
                            <Inp
                              value={r.itemDescription}
                              onChange={(e) =>
                                upd(idx, { itemDescription: e.target.value })
                              }
                              placeholder="Description (optional)"
                              className="h-9"
                            />
                          </div>
                        </Field>
                        <Field label="Notes">
                          <Inp
                            value={r.notes}
                            onChange={(e) => upd(idx, { notes: e.target.value })}
                            placeholder="Optional note"
                            className="h-9"
                          />
                        </Field>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Field label="Batch No.">
                          <Inp
                            value={r.batchNumber}
                            readOnly
                            disabled
                            placeholder="Batch"
                            className="h-9 bg-muted/30 text-muted-foreground cursor-not-allowed"
                          />
                        </Field>
                        <Field label="Expiry Date">
                          <Inp
                            type="date"
                            value={r.expiryDate}
                            readOnly
                            disabled
                            className="h-9 bg-muted/30 text-muted-foreground cursor-not-allowed"
                          />
                        </Field>
                        <Field label="Quantity" error={errors[`r${idx}_qty`]}>
                          <Inp
                            type="text"
                            inputMode="numeric"
                            value={r.quantity}
                            onChange={(e) =>
                              upd(idx, {
                                quantity: normalizeWholeNumberInput(
                                  e.target.value,
                                  r.availableStock,
                                ),
                              })
                            }
                            className="h-9"
                          />
                        </Field>
                        <Field label="VAT %" error={errors[`r${idx}_tax`]}>
                          <div className="flex items-center gap-2">
                            <Inp
                              type="text"
                              inputMode="numeric"
                              value={
                                vatChoice === "custom"
                                  ? r.taxRate
                                  : String(selectedVatRate)
                              }
                              onChange={(e) => {
                                const nextVat = normalizeVatInput(e.target.value);
                                const rspIncl = Number(r.rspInclVat) || 0;
                                const rate = Number(nextVat) || 0;
                                const rspWithout =
                                  rate > 0 ? rspIncl / (1 + rate / 100) : rspIncl;
                                upd(idx, {
                                  taxRate: nextVat,
                                  rspWithoutVat: toTwo(rspWithout),
                                });
                              }}
                              readOnly={vatChoice !== "custom"}
                              disabled={vatChoice !== "custom"}
                              className={cn(
                                "h-9 text-right",
                                vatChoice !== "custom" &&
                                  "bg-muted/30 text-muted-foreground cursor-not-allowed",
                              )}
                            />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                        </Field>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Field label="RSP Incl VAT" error={errors[`r${idx}_rspIncl`]}>
                          <Inp
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.rspInclVat}
                            readOnly
                            disabled
                            className="h-9 bg-muted/30 text-muted-foreground cursor-not-allowed"
                          />
                        </Field>
                        <Field label="RSP Without VAT" error={errors[`r${idx}_rspWithout`]}>
                          <Inp
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.rspWithoutVat}
                            readOnly
                            disabled
                            className="h-9 bg-muted/30 text-muted-foreground cursor-not-allowed"
                          />
                        </Field>
                        <Field label="Discount" error={errors[`r${idx}_disc`]}>
                          <div className="flex gap-2">
                            <Inp
                              type="text"
                              inputMode="numeric"
                              value={r.discount}
                              onChange={(e) =>
                                upd(idx, {
                                  discount: normalizeWholeNumberInput(
                                    e.target.value,
                                    r.discountType === "percent" ? 100 : undefined,
                                  ),
                                })
                              }
                              className="h-9"
                            />
                            <Sel
                              value={r.discountType}
                              onChange={(e) =>
                                upd(idx, { discountType: e.target.value as DiscountType })
                              }
                              className="h-9 w-[86px]"
                            >
                              <option value="amount">AED</option>
                              <option value="percent">%</option>
                            </Sel>
                          </div>
                        </Field>
                        <Field label="Amount / Unit">
                          <div className="flex h-9 items-center rounded-xl border border-border bg-muted/30 px-3 text-sm font-semibold text-foreground tabular-nums">
                            AED {toTwo(amountPerUnit(r))}
                          </div>
                        </Field>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                              Line Total
                            </p>
                            <p className="mt-1 text-lg font-bold text-foreground tabular-nums">
                              {fmt(rowTotal(r))}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                              Formula
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {toTwo(amountPerUnit(r))} x {Number(r.quantity) || 0}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                              Stock Status
                            </p>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {typeof r.availableStock === "number"
                                ? `${r.availableStock} available`
                                : "Select asset"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Invoice Summary
                </p>
                <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                    Grand Total
                  </p>
                  <p className="mt-2 text-3xl font-bold text-primary tabular-nums">
                    AED {t.total.toFixed(2)}
                  </p>
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{fmt(t.sub)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="tabular-nums">- {fmt(t.disc)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Tax (VAT)</span>
                    <span className="tabular-nums">+ {fmt(t.tax)}</span>
                  </div>
                  <div className="border-t border-border pt-3 flex items-center justify-between">
                    <span className="text-lg font-bold text-foreground">Total</span>
                    <span className="text-xl font-bold text-primary tabular-nums">
                      {fmt(t.total)}
                    </span>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Customer
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {customers.find((c) => String(c.id) === custId)?.name || "Not selected"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Line Items
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {rows.length} row{rows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      VAT
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {toTwo(selectedVatRate)}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Assets
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {rows.filter((row) => row.assetId).length}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5 border-t border-border pt-4">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Dialog ───────────────────────────────────────────────────────────
function PaymentDialog({
  open,
  onClose,
  invoice,
  mode,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  mode: "payment" | "refund";
  onSaved: () => Promise<void> | void;
}) {
  const [amount, setAmt] = useState("");
  const [payDate, setPD] = useState(new Date().toISOString().split("T")[0]);
  const [method, setM] = useState("cash");
  const [refNo, setRef] = useState("");
  const [notes, setN] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !invoice) return;
    setAmt(
      String(
        mode === "refund"
          ? invoice.refundableAmount || 0
          : invoice.balanceAmount,
      ),
    );
    setPD(new Date().toISOString().split("T")[0]);
    setM("cash");
    setRef("");
    setN("");
    setErr("");
  }, [open, invoice, mode]);

  const submit = async () => {
    setErr("");
    const amt = Number(amount || 0);
    if (amt <= 0) {
      setErr("Enter a valid amount > 0.");
      return;
    }
    if (invoice && mode === "payment" && amt > invoice.balanceAmount + 0.01) {
      setErr(`Exceeds balance ${fmt(invoice.balanceAmount)}.`);
      return;
    }
    if (
      invoice &&
      mode === "refund" &&
      amt > (invoice.refundableAmount || 0) + 0.01
    ) {
      setErr(
        `Exceeds refundable amount ${fmt(invoice.refundableAmount || 0)}.`,
      );
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/invoices/${invoice!.id}/payments/`, {
        method: "POST",
        body: JSON.stringify({
          amount: amt,
          transactionType: mode,
          paymentDate: payDate,
          paymentMethod: method,
          referenceNo: refNo,
          notes,
        }),
      });
      toast({
        title: mode === "refund" ? "Refund recorded" : "Payment recorded",
        description:
          mode === "refund" ? `${fmt(amt)} refunded.` : `${fmt(amt)} received.`,
      });
      await Promise.resolve(onSaved());
      onClose();
    } catch (err: any) {
      setErr(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open || !invoice) return null;
  const amt = Number(amount || 0);
  const limit =
    mode === "refund"
      ? invoice.refundableAmount || 0
      : invoice.balanceAmount;
  const isPartial = amt > 0 && amt < limit - 0.01;
  const isFull = amt >= limit - 0.01 && amt > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center",
                mode === "refund"
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-emerald-500/10 text-emerald-500",
              )}
            >
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">
                {mode === "refund" ? "Record Refund" : "Receive Payment"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {invoice.invoiceNumber} ·{" "}
                {mode === "refund"
                  ? `Refundable ${fmt(invoice.refundableAmount || 0)}`
                  : `Balance ${fmt(invoice.balanceAmount)}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Total", invoice.totalAmount, "text-foreground"],
              [
                "Paid",
                invoice.paidAmount,
                "text-emerald-600 dark:text-emerald-400",
              ],
              [
                mode === "refund" ? "Refundable" : "Balance",
                mode === "refund"
                  ? invoice.refundableAmount || 0
                  : invoice.balanceAmount,
                mode === "refund"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-600 dark:text-rose-400",
              ],
            ].map(([l, v, c]) => (
              <div
                key={String(l)}
                className="rounded-xl bg-muted/30 border border-border p-3 text-center"
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {l}
                </p>
                <p className={cn("text-sm font-bold tabular-nums", c)}>
                  {fmt(Number(v))}
                </p>
              </div>
            ))}
          </div>
          <Field
            label={mode === "refund" ? "Amount to Refund" : "Amount to Receive"}
            error={err}
            required
          >
            <div className="space-y-2">
              <Inp
                type="number"
                min="0.01"
                step="0.01"
                max={limit}
                value={amount}
                onChange={(e) => {
                  setAmt(e.target.value);
                  setErr("");
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setAmt(String(limit))}
                  className={cn(
                    "flex-1 h-7 rounded-lg border text-xs font-semibold transition-colors",
                    isFull
                      ? mode === "refund"
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-emerald-600 text-white border-emerald-600"
                      : mode === "refund"
                        ? "border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                        : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
                  )}
                >
                  Full {fmt(limit)}
                </button>
                <button
                  onClick={() =>
                    setAmt(
                      String(
                        Math.round((limit / 2) * 100) / 100,
                      ),
                    )
                  }
                  className="flex-1 h-7 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent"
                >
                  50%
                </button>
                <button
                  onClick={() =>
                    setAmt(
                      String(
                        Math.round((limit / 4) * 100) / 100,
                      ),
                    )
                  }
                  className="flex-1 h-7 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent"
                >
                  25%
                </button>
              </div>
            </div>
          </Field>
          {amt > 0 && !err && (
            <div
              className={cn(
                "p-3 rounded-xl border text-xs flex items-center gap-2",
                isPartial
                  ? "bg-amber-500/10 border-amber-500/20"
                  : mode === "refund"
                    ? "bg-amber-500/10 border-amber-500/20"
                    : "bg-emerald-500/10 border-emerald-500/20",
              )}
            >
              {isPartial ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <CheckCircle
                  className={cn(
                    "w-4 h-4 shrink-0",
                    mode === "refund" ? "text-amber-500" : "text-emerald-500",
                  )}
                />
              )}
              <span
                className={
                  isPartial
                    ? "text-amber-600 dark:text-amber-400"
                    : mode === "refund"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {mode === "refund"
                  ? isPartial
                    ? `Partial refund — ${fmt(limit - amt)} will still be refundable`
                    : "Full refund — refundable amount will be cleared"
                  : isPartial
                    ? `Partial — ${fmt(invoice.balanceAmount - amt)} will remain due`
                    : "Full payment — invoice will be marked Paid"}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Date">
              <Inp
                type="date"
                value={payDate}
                onChange={(e) => setPD(e.target.value)}
              />
            </Field>
            <Field label="Method">
              <div className="relative">
                <Sel value={method} onChange={(e) => setM(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </Field>
          </div>
          <Field label="Reference No">
            <Inp
              value={refNo}
              onChange={(e) => setRef(e.target.value)}
              placeholder="UTR / Cheque / Txn ID"
            />
          </Field>
          <Field label="Notes">
            <Inp value={notes} onChange={(e) => setN(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "flex-1 h-10 rounded-xl text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2",
              mode === "refund"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700",
            )}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === "refund" ? "Refund" : "Receive"} {amt > 0 ? fmt(amt) : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Payment Dialog ──────────────────────────────────────────────────────
function BulkPaymentDialog({
  open,
  onClose,
  customers,
  onSaved,
  withFY,
  initialCustomerId,
}: {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onSaved: () => void;
  withFY: (path: string) => string;
  initialCustomerId?: string;
}) {
  const [custId, setCustId] = useState("");
  const [invList, setInvList] = useState<Invoice[]>([]);
  const [selIds, setSelIds] = useState<number[]>([]);
  const [amount, setAmt] = useState("");
  const [payDate, setPD] = useState(new Date().toISOString().split("T")[0]);
  const [method, setM] = useState("cash");
  const [refNo, setRef] = useState("");
  const [notes, setN] = useState("");
  const [loading, setLoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setCustId("");
      setInvList([]);
      setSelIds([]);
      setAmt("");
      setErrors({});
    } else {
      setPD(new Date().toISOString().split("T")[0]);
      if (initialCustomerId) {
        setCustId(initialCustomerId);
        fetchInvoices(initialCustomerId);
      }
    }
  }, [open, initialCustomerId]);

  const fetchInvoices = async (id: string) => {
    if (!id) return;
    setLoad(true);
    try {
      const data = await apiFetch(withFY(`/invoices/?customerId=${id}`));
      const list: Invoice[] = Array.isArray(data) ? data : (data.results ?? []);
      const openInvs = list
        .filter(
          (i) =>
            i.balanceAmount > 0 &&
            i.paymentStatus !== "paid" &&
            i.status !== "cancelled",
        )
        .sort((a, b) => {
          const d = a.invoiceDate.localeCompare(b.invoiceDate);
          return d !== 0 ? d : a.id - b.id;
        });
      setInvList(openInvs);
      setSelIds(openInvs.map((i) => i.id));
    } catch (err: any) {
      toast({
        title: "Failed to load invoices",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoad(false);
    }
  };

  const alloc = useMemo(() => {
    const amt = Number(amount || 0);
    if (amt <= 0 || !selIds.length) return [];
    const selected = invList
      .filter((i) => selIds.includes(i.id))
      .sort(
        (a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id - b.id,
      );
    let rem = amt;
    const result: {
      id: number;
      number: string;
      allocated: number;
      remaining: number;
    }[] = [];
    for (const inv of selected) {
      if (rem <= 0) break;
      const pay = Math.min(rem, inv.balanceAmount);
      result.push({
        id: inv.id,
        number: inv.invoiceNumber,
        allocated: Math.round(pay * 100) / 100,
        remaining: Math.round((inv.balanceAmount - pay) * 100) / 100,
      });
      rem -= pay;
    }
    return result;
  }, [amount, selIds, invList]);

  const totalOutstanding = useMemo(
    () =>
      invList
        .filter((i) => selIds.includes(i.id))
        .reduce((s, i) => s + i.balanceAmount, 0),
    [invList, selIds],
  );

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!custId) e.custId = "Select a customer.";
    if (!selIds.length) e.selIds = "Select at least one invoice.";
    const amt = Number(amount || 0);
    if (amt <= 0) e.amount = "Enter a valid amount.";
    if (amt > totalOutstanding + 0.01)
      e.amount = `Exceeds total outstanding ${fmt(totalOutstanding)}.`;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    let successCount = 0;
    try {
      for (const a of alloc) {
        await apiFetch(`/invoices/${a.id}/payments/`, {
          method: "POST",
          body: JSON.stringify({
            amount: a.allocated,
            paymentDate: payDate,
            paymentMethod: method,
            referenceNo: refNo,
            notes,
          }),
        });
        successCount++;
      }
      toast({
        title: "Bulk payment recorded",
        description: `${fmt(Number(amount))} applied across ${successCount} invoice(s).`,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({
        title: `Failed after ${successCount} payment(s)`,
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const amt = Number(amount || 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <ArrowRightLeft className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">
                Bulk Customer Payment
              </h2>
              <p className="text-xs text-muted-foreground">
                Pay multiple invoices via FIFO allocation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Step 1 — Select Customer
              </p>
            </div>
            <div className="p-4">
              <div className="relative w-72">
                <Sel
                  value={custId}
                  onChange={(e) => {
                    setCustId(e.target.value);
                    fetchInvoices(e.target.value);
                    setErrors({});
                  }}
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
              {errors.custId && (
                <p className="text-xs text-rose-500 flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3" />
                  {errors.custId}
                </p>
              )}
            </div>
          </div>
          {custId && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Step 2 — Select Invoices
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {selIds.length}/{invList.length} selected · Outstanding:{" "}
                    <strong className="text-foreground">
                      {fmt(totalOutstanding)}
                    </strong>
                  </span>
                  <button
                    onClick={() => setSelIds(invList.map((i) => i.id))}
                    className="text-primary hover:underline"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelIds([])}
                    className="text-muted-foreground hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              {errors.selIds && (
                <div className="px-4 py-2 bg-rose-500/10">
                  <p className="text-xs text-rose-500">{errors.selIds}</p>
                </div>
              )}
              {loading ? (
                <div className="p-5 flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading invoices…
                </div>
              ) : invList.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground text-center">
                  No open invoices for this customer.
                </div>
              ) : (
                <div className="divide-y divide-border max-h-56 overflow-y-auto">
                  {invList.map((inv) => {
                    const isOverdue =
                      inv.dueDate && new Date(inv.dueDate) < new Date();
                    const allocEntry = alloc.find((a) => a.id === inv.id);
                    return (
                      <label
                        key={inv.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selIds.includes(inv.id)}
                          onChange={(e) =>
                            setSelIds((p) =>
                              e.target.checked
                                ? [...p, inv.id]
                                : p.filter((x) => x !== inv.id),
                            )
                          }
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-sm font-mono">
                              {inv.invoiceNumber}
                            </span>
                            <Chip
                              {...(PAY_CFG[inv.paymentStatus] ??
                                PAY_CFG.unpaid)}
                            />
                            {isOverdue && (
                              <span className="text-[10px] text-rose-600 font-semibold">
                                OVERDUE
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Invoice {fmtDate(inv.invoiceDate)}
                            {inv.dueDate
                              ? ` · Due ${fmtDate(inv.dueDate)}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                            {fmt(inv.balanceAmount)}
                          </p>
                          {allocEntry && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                              Pay {fmt(allocEntry.allocated)}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {selIds.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Step 3 — Payment Details
                </p>
              </div>
              <div className="p-4 space-y-4">
                <Field
                  label="Total Amount to Pay"
                  error={errors.amount}
                  required
                >
                  <div className="space-y-2">
                    <Inp
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => {
                        setAmt(e.target.value);
                        setErrors((er) => {
                          const n = { ...er };
                          delete n.amount;
                          return n;
                        });
                      }}
                      placeholder={String(
                        Math.round(totalOutstanding * 100) / 100,
                      )}
                    />
                    <button
                      onClick={() =>
                        setAmt(String(Math.round(totalOutstanding * 100) / 100))
                      }
                      className={cn(
                        "w-full h-7 rounded-lg border text-xs font-semibold transition-colors",
                        amt >= totalOutstanding - 0.01 && amt > 0
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
                      )}
                    >
                      Pay All Outstanding {fmt(totalOutstanding)}
                    </button>
                  </div>
                </Field>
                {alloc.length > 0 && (
                  <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-emerald-500/15">
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                        FIFO Allocation Preview
                      </p>
                    </div>
                    <div className="divide-y divide-emerald-500/10">
                      {alloc.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-3 px-3 py-2"
                        >
                          <span className="font-mono text-xs font-semibold text-foreground w-28 shrink-0">
                            {a.number}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{
                                width: `${Math.min(100, (a.allocated / (a.allocated + a.remaining)) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {fmt(a.allocated)}
                          </span>
                          {a.remaining > 0.01 ? (
                            <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">
                              {fmt(a.remaining)} remains
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold w-24 text-right">
                              ✓ Full
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t border-emerald-500/15 flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        Total allocated:
                      </span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {fmt(alloc.reduce((s, a) => s + a.allocated, 0))}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Payment Date">
                    <Inp
                      type="date"
                      value={payDate}
                      onChange={(e) => setPD(e.target.value)}
                    />
                  </Field>
                  <Field label="Method">
                    <div className="relative">
                      <Sel
                        value={method}
                        onChange={(e) => setM(e.target.value)}
                      >
                        {METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </Sel>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                  <Field label="Reference No">
                    <Inp
                      value={refNo}
                      onChange={(e) => setRef(e.target.value)}
                      placeholder="UTR / Cheque"
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <Inp
                    value={notes}
                    onChange={(e) => setN(e.target.value)}
                    placeholder="Optional remarks"
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 pb-5 border-t border-border pt-4">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={
              saving || !selIds.length || !amount || Number(amount) <= 0
            }
            className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {amount && Number(amount) > 0
              ? `Pay ${fmt(Number(amount))} across ${alloc.length} invoices`
              : "Pay Selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  invoice,
  onClose,
  onPay,
  onRefund,
  onConfirm,
  onDeletePayment,
}: {
  invoice: Invoice;
  onClose: () => void;
  onPay: () => void;
  onRefund: () => void;
  onConfirm: () => void;
  onDeletePayment: (p: { id: number; amount: number }) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const handlePDF = async () => {
    setDownloading(true);
    await downloadPDF(invoice.id, invoice.invoiceNumber);
    setDownloading(false);
  };
  const handleViewPDF = async () => {
    setOpeningPdf(true);
    await viewPDF(invoice.id);
    setOpeningPdf(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-[26px] shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-xl text-foreground font-mono tracking-tight">
                {invoice.invoiceNumber}
                </h2>
                <Chip {...(INV_CFG[invoice.status] ?? INV_CFG.draft)} />
                <Chip {...(PAY_CFG[invoice.paymentStatus] ?? PAY_CFG.unpaid)} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{invoice.customerName}</span>
                {invoice.salespersonName && <span>Salesperson: {invoice.salespersonName}</span>}
                <span>Invoice Date: {fmtDate(invoice.invoiceDate)}</span>
                {invoice.dueDate && <span>Due: {fmtDate(invoice.dueDate)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {invoice.status === "draft" && (
                <button
                  onClick={onConfirm}
                  className="h-9 px-4 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Confirm & Send
                </button>
              )}
              {invoice.status === "confirmed" &&
                invoice.paymentStatus !== "paid" && (
                  <button
                    onClick={onPay}
                    className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    Receive Payment
                  </button>
                )}
              {invoice.status === "confirmed" &&
                (invoice.refundableAmount || 0) > 0 && (
                  <button
                    onClick={onRefund}
                    className="h-9 px-4 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 flex items-center gap-2"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Refund Payment
                  </button>
                )}
              <button
                onClick={handleViewPDF}
                disabled={openingPdf}
                className="h-9 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent flex items-center gap-2 disabled:opacity-50"
              >
                {openingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                View PDF
              </button>
              <button
                onClick={handlePDF}
                disabled={downloading}
                className="h-9 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent flex items-center gap-2 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                PDF
              </button>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-xl hover:bg-accent flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Invoice Details
                </p>
              </div>
              <div className="p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Customer", invoice.customerName],
                    ["Salesperson", invoice.salespersonName || "—"],
                    ["Phone", invoice.customerPhone || "—"],
                    ["Email", invoice.customerEmail || "—"],
                    ["TRN / GST No.", invoice.customerGst || "—"],
                    ["Invoice Date", fmtDate(invoice.invoiceDate)],
                    ["Due Date", fmtDate(invoice.dueDate)],
                    ["Status", invoice.statusDisplay],
                    ["Payment Status", invoice.paymentStatusDisplay],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-xl border border-border bg-muted/20 px-4 py-3"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        {k}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground break-words">
                        {v}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                  Grand Total
                </p>
                <p className="mt-2 text-3xl font-bold text-primary tabular-nums">
                  {fmt(invoice.totalAmount)}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  ["Paid", invoice.paidAmount, "text-emerald-600 dark:text-emerald-400"],
                  [
                    "Balance",
                    invoice.balanceAmount,
                    invoice.balanceAmount > 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  ],
                  [
                    "Customer Outstanding",
                    invoice.customerOutstanding ?? 0,
                    (invoice.customerOutstanding ?? 0) > 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  ],
                ].map(([l, v, c]) => (
                  <div
                    key={String(l)}
                    className="rounded-xl border border-border bg-muted/20 px-4 py-3"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      {l}
                    </p>
                    <p className={cn("mt-1 text-xl font-bold tabular-nums", c)}>
                      {fmt(Number(v))}
                    </p>
                  </div>
                ))}
              </div>
            </aside>
          </div>
          {invoice.items && invoice.items.length > 0 && (
            <div className="rounded-2xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="px-4 py-3 bg-muted/30 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Line Items
                </p>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    {[
                      "Item",
                      "Type",
                      "Qty",
                      "Batch",
                      "Expiry",
                      "RSP Incl VAT",
                      "RSP Without VAT",
                      "Discount",
                      "Amount / Unit",
                      "Tax%",
                      "Total",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.16em] text-left whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((i, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-border/50 hover:bg-muted/20"
                    >
                      <td className="px-3 py-3 align-top">
                        <p className="font-semibold text-foreground leading-5">
                          {i.itemName}
                        </p>
                        {i.itemDescription && (
                          <p className="mt-1 text-[11px] text-muted-foreground leading-4">
                            {i.itemDescription}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground capitalize">
                          {i.itemType}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums">{i.quantity}</td>
                      <td className="px-3 py-3 align-top tabular-nums">
                        <div className="space-y-1">
                          <div>{i.batchNumber || "—"}</div>
                          {i.batchAllocations && i.batchAllocations.length > 0 && (
                            <div className="space-y-1 text-[10px] leading-4 text-muted-foreground">
                              {i.batchAllocations.map((batch) => (
                                <div key={batch.batchId}>
                                  {(batch.batchNumber || "No Batch") +
                                    ` · Qty ${batch.quantity}`}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums">
                        <div className="space-y-1">
                          <div>{i.expiryDate ? fmtDate(i.expiryDate) : "—"}</div>
                          {i.batchAllocations && i.batchAllocations.length > 0 && (
                            <div className="space-y-1 text-[10px] leading-4 text-muted-foreground">
                              {i.batchAllocations.map((batch) => (
                                <div key={`${batch.batchId}-expiry`}>
                                  {batch.expiryDate ? fmtDate(batch.expiryDate) : "No Expiry"}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums whitespace-nowrap">
                        {fmt(i.rspInclVat ?? i.unitPrice)}
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums whitespace-nowrap">
                        {fmt(i.rspWithoutVat ?? i.unitPrice)}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground tabular-nums whitespace-nowrap">
                        {i.discountType === "percent"
                          ? `${i.discount}%`
                          : fmt(i.discount)}
                      </td>
                      <td className="px-3 py-3 align-top tabular-nums whitespace-nowrap">
                        {fmt(
                          i.amountPerUnit ??
                            ((i.rspWithoutVat ?? i.unitPrice) -
                              (i.discountType === "percent"
                                ? ((i.rspWithoutVat ?? i.unitPrice) *
                                    i.discount) /
                                  100
                                : i.discount)),
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground whitespace-nowrap">
                        {i.taxRate}%
                      </td>
                      <td className="px-3 py-3 align-top font-semibold tabular-nums whitespace-nowrap">
                        {fmt(i.lineTotal ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30">
                    <td
                      colSpan={10}
                      className="px-3 py-3 text-sm font-bold text-right"
                    >
                      Total
                    </td>
                    <td className="px-3 py-3 text-sm font-bold text-primary tabular-nums whitespace-nowrap">
                      {fmt(invoice.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          )}
          {invoice.payments && invoice.payments.length > 0 && (
            <div className="rounded-2xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="px-4 py-3 bg-muted/30 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Payment History
                </p>
              </div>
              <div className="divide-y divide-border">
                {invoice.payments.map((p) => {
                  const isRefund =
                    p.transactionType === "refund" || p.amount < 0;
                  return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20"
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        isRefund
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-emerald-500/10 text-emerald-500",
                      )}
                    >
                      <Wallet className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            isRefund
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {isRefund ? "-" : "+"}
                          {fmt(Math.abs(p.amount))}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground capitalize">
                          {isRefund ? "Refund" : "Payment"}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground capitalize">
                          {p.paymentMethod.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(p.paymentDate)}
                        {p.referenceNo ? ` · ${p.referenceNo}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        onDeletePayment({ id: p.id, amount: p.amount })
                      }
                      className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {invoice.notes && (
            <div className="rounded-2xl bg-muted/20 border border-border p-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.18em] mb-1.5">
                Notes
              </p>
              <p className="text-sm leading-6 text-foreground">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function SalesHistory() {
  const { selectedFY } = useAuth();
  const fyParam = useFYParam();
  const withFY = useCallback(
    (path: string) =>
      fyParam
        ? path.includes("?")
          ? `${path}&${fyParam}`
          : `${path}?${fyParam}`
        : path,
    [fyParam],
  );

  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCust] = useState<Customer[]>([]);
  const [salespersons, setSalespersons] = useState<SalespersonOption[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [payFilt, setPayFilt] = useState("");
  const [stFilt, setStFilt] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [custFilt, setCustFilt] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editTarget, setEditTarget] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [paymentMode, setPaymentMode] = useState<"payment" | "refund">(
    "payment",
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInitialCustomerId, setBulkInitialCustomerId] = useState("");
  const [viewTarget, setViewTarget] = useState<Invoice | null>(null);
  const [dlProgress, setDlProgress] = useState<number | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    desc: "",
    btnLabel: "",
    btnCls: "",
    onConfirm: () => {},
    loading: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("newPayment") === "1") {
      setBulkInitialCustomerId(params.get("customerId") || "");
      setBulkOpen(true);
      params.delete("newPayment");
      params.delete("customerId");
      const next = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}`,
      );
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const d = await apiFetch(withFY("/stats/"));
      setStats((d as any).summary ?? null);
    } catch {}
  }, [withFY]);

  const fetchInvoices = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedFY) params.set("financialYearId", String(selectedFY.id));
        if (search) params.set("search", search);
        if (payFilt) params.set("paymentStatus", payFilt);
        if (stFilt) params.set("status", stFilt);
        if (overdueOnly) params.set("overdueOnly", "true");
        if (custFilt) params.set("customerId", custFilt);
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        params.set("page", String(page));
        params.set("page_size", String(pageSize));

        const data = await apiFetch(`/invoices/?${params}`);
        if (Array.isArray(data)) {
          setInvoices(data);
          setTotalRecords(data.length);
          setTotalPages(1);
        } else {
          setInvoices(data.results ?? []);
          const total = data.count ?? data.results?.length ?? 0;
          const tPages = Math.max(1, Math.ceil(total / pageSize));
          setTotalRecords(total);
          setTotalPages(tPages);
        }
        setCurrentPage(page);
      } catch (err: any) {
        setError(getApiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [search, payFilt, stFilt, overdueOnly, custFilt, dateFrom, dateTo, selectedFY, pageSize],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchInvoices(currentPage), fetchStats()]);
  }, [fetchInvoices, fetchStats, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
    fetchInvoices(1);
  }, [search, payFilt, stFilt, overdueOnly, custFilt, dateFrom, dateTo, selectedFY, pageSize]);
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);
  useEffect(() => {
    apiFetch("/customers/?limit=200")
      .then((d) => setCust(d as Customer[]))
      .catch(() => {});
    apiFetch("/assets/?limit=200")
      .then((d) => setAssets(d as Asset[]))
      .catch(() => {});
    apiFetchUsers("/users/?role=salesperson&isActive=true")
      .then((d) => setSalespersons(d as SalespersonOption[]))
      .catch(() => {});
  }, []);

  const openDetail = async (inv: Invoice) => {
    try {
      setViewTarget((await apiFetch(`/invoices/${inv.id}/`)) as Invoice);
    } catch {
      setViewTarget(inv);
    }
  };

  const afterMutation = useCallback(
    async (detailId?: number, refreshDetail = false) => {
      await refreshAll();
      if (detailId && refreshDetail) {
        try {
          setViewTarget((await apiFetch(`/invoices/${detailId}/`)) as Invoice);
        } catch {
          setViewTarget(null);
        }
      }
    },
    [refreshAll],
  );

  const doAction = async (
    path: string,
    method: string,
    ok: string,
    fail: string,
  ) => {
    setConfirm((c) => ({ ...c, loading: true }));
    try {
      await apiFetch(path, { method });
      toast({ title: ok });
      setConfirm((c) => ({ ...c, open: false, loading: false }));
      await refreshAll();
    } catch (err: any) {
      toast({
        title: fail,
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      setConfirm((c) => ({ ...c, loading: false }));
    }
  };

  const confirmInvoice = async (invoice: Invoice) => {
    setConfirm((c) => ({ ...c, loading: true }));
    try {
      const res = await apiFetch(`/invoices/${invoice.id}/confirm/`, {
        method: "POST",
      });
      toast({
        title: "Invoice confirmed",
        description:
          (res as any).message ||
          `${invoice.invoiceNumber} confirmed successfully.`,
      });
      setConfirm((c) => ({ ...c, open: false, loading: false }));
      await refreshAll();
      if (viewTarget?.id === invoice.id) {
        setViewTarget((await apiFetch(`/invoices/${invoice.id}/`)) as Invoice);
      }
    } catch (err: any) {
      toast({
        title: "Confirm failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
      setConfirm((c) => ({ ...c, loading: false }));
    }
  };

  const hasFilters =
    search || payFilt || stFilt || overdueOnly || custFilt || dateFrom || dateTo;
  const showFrom = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const showTo = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Sales Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Billing history, payments, and receivables
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBulkOpen(true)}
            className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center gap-2"
          >
            <ArrowRightLeft className="w-4 h-4" />
            Bulk Payment
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              label: "Unpaid",
              value: stats.unpaidCount,
              cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
              icon: XCircle,
            },
            {
              label: "Partial",
              value: stats.partialCount,
              cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
              icon: AlertTriangle,
            },
            {
              label: "Paid",
              value: stats.paidCount,
              cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
              icon: CheckCircle,
            },
          ].map((s) => (
            <div
              key={s.label}
              className={cn(
                "rounded-2xl border p-3 flex items-center gap-3",
                s.cls,
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <s.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
                  {s.label}
                </p>
                <p className="text-xl font-bold tabular-nums">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && stats.overdueCount > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-600 dark:text-rose-400">
            <strong>{stats.overdueCount}</strong> invoice
            {stats.overdueCount !== 1 ? "s are" : " is"} past due, totalling{" "}
            <strong className="tabular-nums">{fmt(stats.overdueAmount)}</strong>
            .
          </p>
          <button
            onClick={() => {
              setOverdueOnly(true);
              setPayFilt("");
              setStFilt("");
            }}
            className="ml-auto text-xs font-semibold text-rose-600 hover:underline shrink-0"
          >
            View overdue →
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice or customer…"
            className="w-full h-9 pl-9 pr-8 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
        <div className="relative">
          <Sel
            value={custFilt}
            onChange={(e) => setCustFilt(e.target.value)}
            className="w-40 h-9"
          >
            <option value="">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <div className="relative">
          <Sel
            value={payFilt}
            onChange={(e) => {
              setOverdueOnly(false);
              setPayFilt(e.target.value);
            }}
            className="w-36 h-9"
          >
            <option value="">All Payment</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <div className="relative">
          <Sel
            value={stFilt}
            onChange={(e) => {
              setOverdueOnly(false);
              setStFilt(e.target.value);
            }}
            className="w-32 h-9"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <Inp
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-36 h-9"
        />
        <Inp
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-36 h-9"
        />
        <button
          onClick={() => fetchInvoices(currentPage)}
          disabled={loading}
          className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setPayFilt("");
              setStFilt("");
              setOverdueOnly(false);
              setCustFilt("");
              setDateFrom("");
              setDateTo("");
            }}
            className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">
              Failed to load invoices
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={() => fetchInvoices(currentPage)}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium hover:bg-rose-500/25 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <FileText className="w-8 h-8 text-muted-foreground opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  No invoices found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {hasFilters
                    ? "Try adjusting your filters."
                    : "Create your first invoice to get started."}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    {[
                      "Invoice / Customer",
                      "Date",
                      "Amount",
                      "Paid",
                      "Balance",
                      "Status",
                      "Payment",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const isOverdue =
                      inv.dueDate &&
                      new Date(inv.dueDate) < new Date() &&
                      inv.paymentStatus !== "paid" &&
                      inv.status !== "cancelled";
                    return (
                      <tr
                        key={inv.id}
                        className={cn(
                          "border-b border-border/50 hover:bg-muted/20 transition-colors group cursor-pointer",
                          isOverdue && "bg-rose-500/5",
                        )}
                        onClick={() => openDetail(inv)}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground font-mono text-xs">
                            {inv.invoiceNumber}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inv.customerName}
                          </p>
                          {inv.salespersonName && (
                            <p className="text-[11px] text-muted-foreground">
                              Salesperson: {inv.salespersonName}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(inv.invoiceDate)}
                          </p>
                          <p
                            className={cn(
                              "text-xs",
                              isOverdue
                                ? "text-rose-600 dark:text-rose-400 font-semibold"
                                : "text-muted-foreground",
                            )}
                          >
                            Due: {fmtDate(inv.dueDate)}
                            {isOverdue ? " ⚠" : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-foreground tabular-nums">
                            {fmt(inv.totalAmount)}
                          </p>
                          {inv.returnAmount && inv.returnAmount > 0 ? (
                            <div className="space-y-0.5 text-xs text-muted-foreground">
                              <p>Original: {fmt(inv.grossTotalAmount ?? inv.totalAmount)}</p>
                              <p>Returned: {fmt(inv.returnAmount)}</p>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Sub: {fmt(inv.subtotal)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p
                            className={cn(
                              "text-sm font-bold tabular-nums",
                              inv.paidAmount > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {fmt(inv.paidAmount)}
                          </p>
                          {inv.refundableAmount &&
                          inv.refundableAmount > 0 &&
                          inv.totalAmount > 0 ? (
                            <p className="text-xs text-amber-600">
                              Refund due: {fmt(inv.refundableAmount)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p
                            className={cn(
                              "text-sm font-bold tabular-nums",
                              inv.balanceAmount > 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-emerald-600 dark:text-emerald-400",
                            )}
                          >
                            {fmt(inv.balanceAmount)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Chip {...(INV_CFG[inv.status] ?? INV_CFG.draft)} />
                        </td>
                        <td className="px-4 py-3">
                          <Chip
                            {...(PAY_CFG[inv.paymentStatus] ?? PAY_CFG.unpaid)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {inv.status === "confirmed" &&
                              inv.paymentStatus !== "paid" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPaymentMode("payment");
                                    setPayTarget(inv);
                                  }}
                                  title="Pay"
                                  className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-500"
                                >
                                  <Wallet className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {inv.status === "confirmed" &&
                              (inv.refundableAmount || 0) > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPaymentMode("refund");
                                    setPayTarget(inv);
                                  }}
                                  title="Refund"
                                  className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-600"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {inv.status === "draft" && (
                              <button
                                title="Confirm & Send"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirm({
                                    open: true,
                                    loading: false,
                                    title: "Confirm Invoice",
                                    desc: `Confirm ${inv.invoiceNumber}, mark it completed, and send email to the customer?`,
                                    btnLabel: "Confirm & Send",
                                    btnCls: "bg-sky-600 hover:bg-sky-700",
                                    onConfirm: () => confirmInvoice(inv),
                                  });
                                }}
                                className="w-7 h-7 rounded-lg hover:bg-sky-500/10 flex items-center justify-center text-muted-foreground hover:text-sky-600"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {inv.status === "draft" &&
                              inv.paymentStatus === "unpaid" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditTarget(inv);
                                  }}
                                  title="Edit"
                                  className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                setDlProgress(inv.id);
                                await viewPDF(inv.id);
                                setDlProgress(null);
                              }}
                              title="View PDF"
                              disabled={dlProgress === inv.id}
                              className="w-7 h-7 rounded-lg hover:bg-sky-500/10 flex items-center justify-center text-muted-foreground hover:text-sky-500 disabled:opacity-50"
                            >
                              {dlProgress === inv.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                setDlProgress(inv.id);
                                await downloadPDF(inv.id, inv.invoiceNumber);
                                setDlProgress(null);
                              }}
                              title="Download PDF"
                              disabled={dlProgress === inv.id}
                              className="w-7 h-7 rounded-lg hover:bg-violet-500/10 flex items-center justify-center text-muted-foreground hover:text-violet-500 disabled:opacity-50"
                            >
                              {dlProgress === inv.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {inv.status !== "cancelled" &&
                              inv.paidAmount <= 0 && (
                                <button
                                  title="Cancel"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirm({
                                      open: true,
                                      loading: false,
                                      title: "Cancel Invoice",
                                      desc: `Cancel ${inv.invoiceNumber}?`,
                                      btnLabel: "Cancel Invoice",
                                      btnCls: "bg-amber-600 hover:bg-amber-700",
                                      onConfirm: () =>
                                        doAction(
                                          `/invoices/${inv.id}/cancel/`,
                                          "PUT",
                                          "Invoice cancelled",
                                          "Cancel failed",
                                        ),
                                    });
                                  }}
                                  className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* ── Pagination footer ──────────────────────────────────────── */}
              <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-muted-foreground">
                  Showing{" "}
                  <span className="font-semibold text-foreground">
                    {showFrom}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold text-foreground">
                    {showTo}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-foreground">
                    {totalRecords}
                  </span>{" "}
                  invoice{totalRecords !== 1 ? "s" : ""}
                  <span className="ml-4 gap-4 hidden sm:inline-flex">
                    <span>
                      · Paid:{" "}
                      <strong className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {fmt(
                          invoices
                            .filter((i) => i.status !== "cancelled")
                            .reduce((s, i) => s + i.paidAmount, 0),
                        )}
                      </strong>
                    </span>
                    <span>
                      {" "}
                      · Outstanding:{" "}
                      <strong className="text-rose-600 dark:text-rose-400 tabular-nums">
                        {fmt(
                          invoices
                            .filter((i) => i.status !== "cancelled")
                            .reduce((s, i) => s + i.balanceAmount, 0),
                        )}
                      </strong>
                    </span>
                  </span>
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-10 w-[110px] rounded-2xl border border-border bg-background px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => fetchInvoices(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    ‹ Prev
                  </button>
                  <span className="text-sm font-medium text-foreground whitespace-nowrap">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => fetchInvoices(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <InvoiceFormDialog
        open={!!editTarget}
        onClose={() => {
          setEditTarget(null);
        }}
        onSaved={refreshAll}
        initial={editTarget}
        customers={customers}
        salespersons={salespersons}
        assets={assets}
      />
      <PaymentDialog
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        invoice={payTarget}
        mode={paymentMode}
        onSaved={async () => {
          const id = payTarget?.id;
          const shouldRefreshDetail = !!(
            id &&
            viewTarget &&
            viewTarget.id === id
          );
          setPayTarget(null);
          try {
            await afterMutation(id, shouldRefreshDetail);
          } catch (err: any) {
            toast({
              title: "Refresh failed",
              description: getApiErrorMessage(err),
              variant: "destructive",
            });
          }
        }}
      />
      <BulkPaymentDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        customers={customers}
        onSaved={refreshAll}
        withFY={withFY}
        initialCustomerId={bulkInitialCustomerId}
      />
      {viewTarget && (
        <DetailPanel
          invoice={viewTarget}
          onClose={() => setViewTarget(null)}
          onPay={() => {
            setPaymentMode("payment");
            setPayTarget(viewTarget);
          }}
          onRefund={() => {
            setPaymentMode("refund");
            setPayTarget(viewTarget);
          }}
          onConfirm={() =>
            setConfirm({
              open: true,
              loading: false,
              title: "Confirm Invoice",
              desc: `Confirm ${viewTarget.invoiceNumber}, mark it completed, and send email to the customer?`,
              btnLabel: "Confirm & Send",
              btnCls: "bg-sky-600 hover:bg-sky-700",
              onConfirm: () => confirmInvoice(viewTarget),
            })
          }
          onDeletePayment={({ id, amount }) =>
            setConfirm({
              open: true,
              loading: false,
              title: amount < 0 ? "Delete Refund" : "Delete Payment",
              desc: `${
                amount < 0 ? "Remove refund" : "Remove payment"
              } of ${fmt(Math.abs(amount))}?`,
              btnLabel: "Delete",
              btnCls: "bg-rose-600 hover:bg-rose-700",
              onConfirm: async () => {
                setConfirm((c) => ({ ...c, loading: true }));
                try {
                  await apiFetch(`/payments/${id}/delete/`, {
                    method: "DELETE",
                  });
                  toast({ title: "Payment deleted" });
                  setConfirm((c) => ({ ...c, open: false, loading: false }));
                  await afterMutation(viewTarget.id, true);
                } catch (err: any) {
                  toast({
                    title: "Delete failed",
                    description: getApiErrorMessage(err),
                    variant: "destructive",
                  });
                  setConfirm((c) => ({ ...c, loading: false }));
                }
              },
            })
          }
        />
      )}
      <Confirm
        {...confirm}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  );
}
