// src/pages/PurchaseEntries.tsx  — COMPLETE VERSION WITH PAGINATION
//
// BUGS FIXED:
//   1. 401 on invoice view/download  → fetch() with Bearer token + blob URL
//   2. Paid AED 0.00 shown while status=Partial → detail panel re-fetches live data
//   3. No detail view  → full DetailPanel (items, payments, delete payment, download)
//   4. Outstanding sync → payment calls trigger supplier.sync_outstanding()
//   5. Pending Receive = 0 even when not received → fixed isReceived check
//
// NEW:
//   6. SearchDropdown<T> generic component for searchable asset selection
//   7. ★ PAGINATION — client-side pagination matching the Licenses page style

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  getApiErrorMessage,
  getApiErrorSummary,
  getApiFieldErrors,
  getApiItemErrors,
} from "@/lib/apiErrors";
import { useAuth, useFYParam } from "@/contexts/AuthContext";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Supplier {
  id: number;
  name: string;
  outstanding?: number;
  paymentTerms?: string;
}
interface Asset {
  id: number;
  name: string;
  code: string;
  category: string;
  purchasePrice?: number;
  purchaseCost?: number;
}
interface ApprovedPO {
  id: number;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  paymentTerms?: string;
  supplier: { id: number; name: string };
  totalAmount: number;
  entryCount: number;
  receivedCount: number;
  needsEntry: boolean;
  items: {
    assetId: number;
    itemName: string;
    assetCode: string | null;
    category: string | null;
    purchasePrice?: number;
    purchaseCost: number;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRate: number;
  }[];
}

interface EntryItem {
  id?: number;
  itemName: string;
  assetId?: number | null;
  serviceId?: number | null;
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
  batchLines?: {
    batchId: number;
    batchNumber: string;
    expiryDate: string | null;
    receivedQty: number;
    availableQty: number;
    warehouseId: number;
    warehouseName: string;
  }[];
  notes?: string;
}
interface Payment {
  id: number;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
  createdAt?: string;
}
interface PurchaseEntry {
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
  items?: EntryItem[];
  payments?: Payment[];
}
interface WarehouseOpt {
  id: number;
  name: string;
  location: string;
}

// ─── API ───────────────────────────────────────────────────────────────────────

const API_URL =
  (window as any).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

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
function authHdrs(ct = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  if (ct) h["Content-Type"] = "application/json";
  return h;
}
async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}/api/purchases${path}`, {
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

// ★ Authenticated file fetch (fixes 401 on invoice view/download)
async function fetchFileAuthenticated(url: string): Promise<Blob> {
  const res = await fetch(url, { headers: authHdrs(false) });
  if (res.status === 401) {
    window.sessionStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`File not found (${res.status})`);
  return res.blob();
}

// ★ View file in new tab with auth
async function viewFileAuth(entryId: number) {
  try {
    const blob = await fetchFileAuthenticated(
      `${API_URL}/api/purchases/entries/${entryId}/invoice/`,
    );
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e: any) {
    toast({
      title: "Cannot open file",
      description: getApiErrorMessage(e),
      variant: "destructive",
    });
  }
}

// ★ Download file with auth
async function downloadFileAuth(entryId: number, filename: string) {
  try {
    const blob = await fetchFileAuthenticated(
      `${API_URL}/api/purchases/entries/${entryId}/invoice/?download=true`,
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e: any) {
    toast({
      title: "Download failed",
      description: getApiErrorMessage(e),
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
const assetPurchasePrice = (asset?: Asset | null) =>
  asset?.purchasePrice ?? asset?.purchaseCost ?? 0;
const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("en-AE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtDateTime = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-AE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
];

const ENTRY_ITEM_GRID =
  "grid min-w-[1100px] grid-cols-[minmax(320px,2.2fr)_minmax(140px,1fr)_minmax(150px,1fr)_80px_110px_82px_82px_126px]";

const normalizeDateInput = (value: unknown) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
};

const addDaysToIsoDate = (value: string, days: number) => {
  const base = normalizeDateInput(value);
  if (!base) return "";
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const endOfMonthIsoDate = (value: string) => {
  const base = normalizeDateInput(value);
  if (!base) return "";
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
};

const dueDateFromPaymentTerms = (
  invoiceDate: string,
  paymentTerms?: string,
) => {
  switch (paymentTerms) {
    case "due_on_receipt":
    case "cod":
      return normalizeDateInput(invoiceDate);
    case "net_15":
      return addDaysToIsoDate(invoiceDate, 15);
    case "net_30":
      return addDaysToIsoDate(invoiceDate, 30);
    case "net_45":
      return addDaysToIsoDate(invoiceDate, 45);
    case "net_60":
      return addDaysToIsoDate(invoiceDate, 60);
    case "consignment_30":
      return addDaysToIsoDate(invoiceDate, 30);
    case "end_of_month":
      return endOfMonthIsoDate(invoiceDate);
    default:
      return "";
  }
};

// ─── UI atoms ──────────────────────────────────────────────────────────────────

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
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
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none",
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
  <div className="space-y-1">
    <label className="text-[11px] font-bold text-foreground/70 uppercase tracking-[0.14em]">
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

const PAY: Record<string, { label: string; cls: string }> = {
  unpaid: {
    label: "Unpaid",
    cls: "bg-rose-500/10   text-rose-600   border-rose-500/20",
  },
  partial: {
    label: "Partial",
    cls: "bg-amber-500/10  text-amber-600  border-amber-500/20",
  },
  paid: {
    label: "Paid",
    cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
};
const PayBadge = ({ status }: { status: string }) => {
  const c = PAY[status] ?? PAY.unpaid;
  return (
    <span
      className={cn(
        "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
        c.cls,
      )}
    >
      {c.label}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ★ PAGINATION COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (perPage: number) => void;
  filteredCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ PAGINATION COMPONENT — matches Licenses page style
// ═══════════════════════════════════════════════════════════════════════════════

function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  filteredCount,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (perPage: number) => void;
  filteredCount: number;
}) {
  const startItem =
    filteredCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, filteredCount);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card">
      {/* Left: Showing X to Y of Z */}
      <p className="text-sm text-muted-foreground">
        Showing <strong className="text-foreground">{startItem}</strong> to{" "}
        <strong className="text-foreground">{endItem}</strong> of{" "}
        <strong className="text-foreground">{filteredCount}</strong> purchase
        entries
        {filteredCount !== totalItems && (
          <span className="text-muted-foreground/60">
            {" "}
            (filtered from {totalItems})
          </span>
        )}
      </p>

      {/* Right: Prev | Page X of Y | Next */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows</span>
          <select
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
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
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Prev
        </button>

        <span className="text-sm font-semibold text-foreground">
          Page {currentPage} of {totalPages}
        </span>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════════
// ★ GENERIC SEARCHABLE DROPDOWN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface SearchDropdownProps<T extends { id: number | string }> {
  items: T[];
  value: string;
  onChange: (id: string, item: T | null) => void;
  getLabel: (item: T) => string;
  getSelectedLabel: (item: T) => string;
  getSearchFields: (item: T) => string[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  renderOption?: (
    item: T,
    isSelected: boolean,
    query: string,
  ) => React.ReactNode;
  disabled?: boolean;
}

function SearchDropdown<T extends { id: number | string }>({
  items,
  value,
  onChange,
  getLabel,
  getSelectedLabel,
  getSearchFields,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
  renderOption,
  disabled = false,
}: SearchDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(
    () => items.find((i) => String(i.id) === value) ?? null,
    [items, value],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) =>
      getSearchFields(item).some((field) => field?.toLowerCase().includes(q)),
    );
  }, [items, query, getSearchFields]);

  const highlight = (text: string, q: string) => {
    if (!q.trim()) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return (
      <span>
        {text.slice(0, idx)}
        <mark className="bg-primary/20 text-primary rounded px-0.5 font-semibold">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </span>
    );
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && filtered[activeIdx]) {
      e.preventDefault();
      const item = filtered[activeIdx];
      onChange(String(item.id), item);
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full", className)}
        onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        className={cn(
          "w-full h-9 px-3 rounded-lg border border-border bg-background text-[13px] text-left flex items-center justify-between gap-2",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
          disabled && "opacity-50 cursor-not-allowed",
          open && "ring-2 ring-primary/30 border-primary",
        )}
      >
        <span
          className={cn(
            "flex-1 truncate",
            !selectedItem && "text-muted-foreground",
          )}
        >
          {selectedItem ? getSelectedLabel(selectedItem) : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border bg-muted/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-8 pl-8 pr-8 rounded-lg bg-background border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {selectedItem && (
            <button
              type="button"
              onClick={() => {
                onChange("", null);
                setOpen(false);
                setQuery("");
              }}
              className="w-full px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:bg-muted/40 flex items-center gap-2 border-b border-border/50"
            >
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              Clear selection
            </button>
          )}

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                No results for "
                <span className="font-semibold text-foreground">{query}</span>"
              </div>
            ) : (
              filtered.map((item, idx) => {
                const isSelected = String(item.id) === value;
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={String(item.id)}
                    type="button"
                    onClick={() => {
                      onChange(String(item.id), item);
                      setOpen(false);
                      setQuery("");
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      "w-full px-2.5 py-2 text-left text-[13px] flex items-center gap-2 transition-colors",
                      isActive && !isSelected && "bg-muted/50",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/40 text-foreground",
                    )}
                  >
                    {renderOption ? (
                      renderOption(item, isSelected, query)
                    ) : (
                      <span className="flex-1 truncate">
                        {highlight(getLabel(item), query)}
                      </span>
                    )}
                    {isSelected && (
                      <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0 ml-auto" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {filtered.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {filtered.length} of {items.length} asset
                {items.length !== 1 ? "s" : ""}
              </span>
              <span className="text-[10px] text-muted-foreground">
                ↑↓ navigate · Enter select · Esc close
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item form helpers ──────────────────────────────────────────────────────────

interface ItemRow {
  assetId: string;
  itemName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  notes: string;
}
const emptyRow = (): ItemRow => ({
  assetId: "",
  itemName: "",
  batchNumber: "",
  expiryDate: "",
  quantity: "1",
  unitPrice: "0",
  discount: "0",
  taxRate: "0",
  notes: "",
});

function rowTotal(r: ItemRow) {
  const sub = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
  const disc = (sub * (Number(r.discount) || 0)) / 100;
  const tax = ((sub - disc) * (Number(r.taxRate) || 0)) / 100;
  return Math.round((sub - disc + tax) * 100) / 100;
}
function totals(rows: ItemRow[]) {
  let sub = 0,
    disc = 0,
    tax = 0;
  rows.forEach((r) => {
    const s = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
    const d = (s * (Number(r.discount) || 0)) / 100;
    const t = ((s - d) * (Number(r.taxRate) || 0)) / 100;
    sub += s;
    disc += d;
    tax += t;
  });
  return {
    sub: Math.round(sub * 100) / 100,
    disc: Math.round(disc * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round((sub - disc + tax) * 100) / 100,
  };
}
function buildPayload(rows: ItemRow[]) {
  return rows.map((r) => ({
    assetId: Number(r.assetId) || undefined,
    itemName: r.itemName,
    batchNumber: r.batchNumber.trim() || undefined,
    expiryDate: r.expiryDate || undefined,
    quantity: Number(r.quantity || 0),
    unitPrice: Number(r.unitPrice || 0),
    discount: Number(r.discount || 0),
    taxRate: Number(r.taxRate || 0),
    notes: r.notes,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// ★ DETAIL PANEL — Items + Payments + File download
// ═══════════════════════════════════════════════════════════════════════════════

function DetailPanel({
  entry,
  onClose,
  onPaymentDeleted,
  onRefresh,
  onPay,
  onEdit,
  onUpload,
  onReceive,
  onDelete,
}: {
  entry: PurchaseEntry;
  onClose: () => void;
  onPaymentDeleted: () => void;
  onRefresh: () => void;
  onPay: (entry: PurchaseEntry) => void;
  onEdit: (entry: PurchaseEntry) => void;
  onUpload: (entry: PurchaseEntry) => void;
  onReceive: (entry: PurchaseEntry) => void;
  onDelete: (entry: PurchaseEntry) => void;
}) {
  const [full, setFull] = useState<PurchaseEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [confirm, setConfirm] = useState({
    open: false,
    paymentId: 0,
    amount: 0,
  });

  useEffect(() => {
    apiFetch(`/entries/${entry.id}/`)
      .then(setFull)
      .catch(() => setFull(entry))
      .finally(() => setLoading(false));
  }, [entry.id]);

  const e = full ?? entry;

  const handleView = async () => {
    setViewing(true);
    await viewFileAuth(e.id);
    setViewing(false);
  };
  const handleDownload = async () => {
    setDownloading(true);
    await downloadFileAuth(e.id, `invoice-${e.entryNumber}.pdf`);
    setDownloading(false);
  };

  const deletePayment = async (paymentId: number) => {
    try {
      await apiFetch(`/payments/${paymentId}/delete/`, { method: "DELETE" });
      toast({ title: "Payment deleted" });
      const updated = await apiFetch(`/entries/${e.id}/`);
      setFull(updated);
      onPaymentDeleted();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[15px] font-bold text-foreground font-mono tracking-tight">
                {e.entryNumber}
              </h2>
              <PayBadge status={e.paymentStatus} />
              {e.isReceived && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 border border-teal-500/20 font-semibold">
                  <CheckCircle className="w-3 h-3" />
                  Stock Updated
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {e.supplier.name}
              {e.purchaseOrderNo ? ` · PO: ${e.purchaseOrderNo}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!e.isReceived && (
              <button
                onClick={() => onReceive(e)}
                className="h-8 px-3 rounded-lg bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 transition-colors flex items-center gap-1.5"
              >
                <Package className="w-3 h-3" />
                Receive Package
              </button>
            )}
            {e.paymentStatus !== "paid" && (
              <button
                onClick={() => onPay(e)}
                className="h-8 px-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/15 transition-colors flex items-center gap-1.5"
              >
                <Wallet className="w-3 h-3" />
                Pay
              </button>
            )}
            {!e.isReceived && e.paymentStatus !== "paid" && (
              <button
                onClick={() => onEdit(e)}
                className="h-8 px-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] font-semibold text-amber-600 hover:bg-amber-500/15 transition-colors flex items-center gap-1.5"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
            <button
              onClick={() => onUpload(e)}
              className="h-8 px-3 rounded-lg border border-violet-500/20 bg-violet-500/10 text-[11px] font-semibold text-violet-600 hover:bg-violet-500/15 transition-colors flex items-center gap-1.5"
            >
              <Upload className="w-3 h-3" />
              {e.hasInvoiceFile ? "Replace Invoice" : "Upload Invoice"}
            </button>
            {e.hasInvoiceFile && (
              <>
                <button
                  onClick={handleView}
                  disabled={viewing}
                  className="h-8 px-3 rounded-lg border border-border text-[11px] text-muted-foreground hover:bg-accent flex items-center gap-1.5 disabled:opacity-50"
                >
                  {viewing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Eye className="w-3 h-3" />
                  )}
                  View Invoice
                </button>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="h-8 px-3 rounded-lg border border-border text-[11px] text-muted-foreground hover:bg-accent flex items-center gap-1.5 disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  Download
                </button>
              </>
            )}
            {e.paidAmount <= 0 && !e.isReceived && (
              <button
                onClick={() => onDelete(e)}
                className="h-8 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/15 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading details…
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
              {[
                ["Supplier", e.supplier.name],
                ["Linked PO", e.purchaseOrderNo || "—"],
                ["Invoice Date", fmtDate(e.invoiceDate)],
                ["Due Date", fmtDate(e.dueDate)],
                ["Supplier Invoice No", e.supplierInvoiceNo || "—"],
                [
                  "Received At",
                  e.receivedAt ? fmtDateTime(e.receivedAt) : "Not received",
                ],
                [
                  "Payment Status",
                  e.paymentStatusDisplay || e.paymentStatus.replace("_", " "),
                ],
                ["Received By", e.receivedBy || "—"],
                [
                  "Invoice File",
                  e.hasInvoiceFile ? "Attached" : "Not uploaded",
                ],
                ["Line Items", `${e.items?.length ?? 0} item(s)`],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl bg-muted/30 border border-border p-3.5 min-h-[88px]"
                >
                  <p className="text-[9px] text-muted-foreground uppercase tracking-[0.16em] mb-1.5">
                    {label}
                  </p>
                  <p className="text-[13px] leading-6 font-semibold text-foreground whitespace-pre-line break-words">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {[
                ["Total", e.totalAmount, "text-foreground"],
                ["Subtotal", e.subtotal, "text-muted-foreground"],
                ["Tax", e.taxAmount, "text-muted-foreground"],
                [
                  "Paid",
                  e.paidAmount,
                  "text-emerald-600 dark:text-emerald-400",
                ],
                [
                  "Balance",
                  e.balanceAmount,
                  e.balanceAmount > 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400",
                ],
              ].map(([label, value, valueClass]) => (
                <div
                  key={String(label)}
                  className="rounded-xl bg-muted/30 border border-border p-3.5 text-center min-h-[82px] flex flex-col justify-center"
                >
                  <p className="text-[9px] text-muted-foreground uppercase tracking-[0.16em] mb-1">
                    {label}
                  </p>
                  <p
                    className={cn(
                      "text-[20px] md:text-[22px] leading-tight font-bold tabular-nums break-words",
                      valueClass,
                    )}
                  >
                    {fmt(Number(value))}
                  </p>
                </div>
              ))}
            </div>

            {e.notes && (
              <div className="rounded-xl bg-muted/30 border border-border p-3.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-[0.16em] mb-2">
                  Notes
                </p>
                <p className="text-[13px] leading-6 text-foreground whitespace-pre-line break-words">
                  {e.notes}
                </p>
              </div>
            )}

            {e.items && e.items.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Line Items ({e.items.length})
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-muted/20 border-b border-border">
                        {[
                          "Item",
                          "Account",
                          "Batch No",
                          "Expiry",
                          "Qty",
                          "Unit Price",
                          "Disc%",
                          "Tax%",
                          "Line Total",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-[9px] font-bold text-muted-foreground uppercase tracking-[0.16em] text-left"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {e.items.map((item, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-border/50 hover:bg-muted/20"
                        >
                          <td className="px-4 py-3.5 min-w-[280px]">
                            <p className="text-[13px] font-semibold text-foreground leading-6">
                              {item.itemName}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {item.assetId && (
                                <p className="text-[11px] text-muted-foreground">
                                  Asset #{item.assetId}
                                </p>
                              )}
                              {item.assetCode && (
                                <p className="text-[11px] text-muted-foreground font-mono">
                                  {item.assetCode}
                                </p>
                              )}
                              {item.serviceId && (
                                <p className="text-[11px] text-muted-foreground">
                                  Service #{item.serviceId}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                              <p className="text-[11px] text-muted-foreground">
                                Subtotal:{" "}
                                <span className="font-medium text-foreground">
                                  {fmt(item.subtotal ?? 0)}
                                </span>
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Discount:{" "}
                                <span className="font-medium text-foreground">
                                  {fmt(item.discAmount ?? 0)}
                                </span>
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Tax:{" "}
                                <span className="font-medium text-foreground">
                                  {fmt(item.taxAmount ?? 0)}
                                </span>
                              </p>
                            </div>
                            {item.notes && (
                              <p className="text-[11px] leading-5 text-muted-foreground mt-2 break-words">
                                {item.notes}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground leading-6 min-w-[150px]">
                            {item.account || "—"}
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                            <div className="space-y-1">
                              <div>{item.batchNumber || "—"}</div>
                              {item.batchLines && item.batchLines.length > 0 && (
                                <div className="space-y-1 text-[10px] leading-4 text-muted-foreground/90">
                                  {item.batchLines.map((batch) => (
                                    <div key={batch.batchId}>
                                      {(batch.batchNumber || "No Batch") +
                                        ` · Rec ${batch.receivedQty} · Avl ${batch.availableQty}`}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                            <div className="space-y-1">
                              <div>{item.expiryDate ? fmtDate(item.expiryDate) : "—"}</div>
                              {item.batchLines && item.batchLines.length > 0 && (
                                <div className="space-y-1 text-[10px] leading-4 text-muted-foreground/90">
                                  {item.batchLines.map((batch) => (
                                    <div key={`${batch.batchId}-expiry`}>
                                      {batch.expiryDate ? fmtDate(batch.expiryDate) : "No Expiry"}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground tabular-nums whitespace-nowrap">
                            {item.quantity}
                          </td>
                          <td className="px-4 py-3.5 tabular-nums whitespace-nowrap">
                            {fmt(item.unitPrice)}
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                            {item.discount}%
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                            {item.taxRate}%
                          </td>
                          <td className="px-4 py-3.5 text-[13px] font-bold text-foreground tabular-nums whitespace-nowrap">
                            {fmt(item.lineTotal ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30">
                        <td
                          colSpan={8}
                          className="px-4 py-3 text-[13px] font-bold text-right text-foreground"
                        >
                          Grand Total
                        </td>
                        <td className="px-4 py-3 text-[13px] font-bold text-primary tabular-nums whitespace-nowrap">
                          {fmt(e.totalAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Payment History
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Paid:{" "}
                  <strong className="text-emerald-600">
                    {fmt(e.paidAmount)}
                  </strong>{" "}
                  · Balance:{" "}
                  <strong
                    className={
                      e.balanceAmount > 0 ? "text-rose-600" : "text-emerald-600"
                    }
                  >
                    {fmt(e.balanceAmount)}
                  </strong>
                </p>
              </div>
              {!e.payments || e.payments.length === 0 ? (
                <div className="p-8 text-[13px] text-muted-foreground text-center">
                  No payments recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {e.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20"
                    >
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <Wallet className="w-3 h-3 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {fmt(p.amount)}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground capitalize">
                            {p.paymentMethod.replace("_", " ")}
                          </span>
                          {p.referenceNo && (
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {p.referenceNo}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {fmtDate(p.paymentDate)}
                        </p>
                        {p.notes && (
                          <p className="text-[11px] leading-5 text-muted-foreground break-words">
                            {p.notes}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          setConfirm({
                            open: true,
                            paymentId: p.id,
                            amount: p.amount,
                          })
                        }
                        className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            {e.notes && (
              <div className="rounded-xl bg-muted/30 border border-border p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  Notes
                </p>
                <p className="text-sm text-foreground">{e.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <Confirm
        open={confirm.open}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={() => {
          deletePayment(confirm.paymentId);
          setConfirm((c) => ({ ...c, open: false }));
        }}
        title="Delete Payment"
        desc={`Remove payment of ${fmt(confirm.amount)}? This will increase the outstanding balance.`}
        btnLabel="Delete Payment"
        btnCls="bg-rose-600 hover:bg-rose-700"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY FORM DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function EntryFormDialog({
  open,
  onClose,
  onSaved,
  initial,
  suppliers,
  assets,
  approvedPOs,
  prefillPO,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: PurchaseEntry | null;
  suppliers: Supplier[];
  assets: Asset[];
  approvedPOs: ApprovedPO[];
  prefillPO?: ApprovedPO | null;
}) {
  const { selectedFY } = useAuth();
  const isEdit = !!initial;
  const [saving, setSaving] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [supId, setSupId] = useState("");
  const [invDate, setID] = useState("");
  const [dueDate, setDD] = useState("");
  const [supInvNo, setSIN] = useState("");
  const [poId, setPoId] = useState("");
  const [notes, setN] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [dueDateTouched, setDueDateTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const applyEntry = (entry: PurchaseEntry) => {
      setSupId(String(entry.supplier.id));
      setID(entry.invoiceDate || "");
      setDD(entry.dueDate || "");
      setDueDateTouched(Boolean(entry.dueDate));
      setSIN(entry.supplierInvoiceNo || "");
      setPoId(entry.purchaseOrderId ? String(entry.purchaseOrderId) : "");
      setN(entry.notes || "");
      const nextRows = (entry.items || []).map((i) => ({
        assetId: i.assetId ? String(i.assetId) : "",
        itemName: i.itemName || "",
        batchNumber: i.batchNumber || "",
        expiryDate: i.expiryDate || "",
        quantity: String(i.quantity ?? 1),
        unitPrice: String(i.unitPrice ?? 0),
        discount: String(i.discount ?? 0),
        taxRate: String(i.taxRate ?? 0),
        notes: i.notes || "",
      }));
      setRows(nextRows.length > 0 ? nextRows : [emptyRow()]);
    };

    const applyPrefillPO = () => {
      if (!prefillPO) return;
      setSupId(String(prefillPO.supplier.id));
      setID(new Date().toISOString().split("T")[0]);
      setPoId(String(prefillPO.id));
      setDD("");
      setSIN("");
      setN("");
      setDueDateTouched(false);
      setRows(
        prefillPO.items.map((i) => ({
          assetId: String(i.assetId),
          itemName: i.itemName,
          batchNumber: i.batchNumber || "",
          expiryDate: i.expiryDate || "",
          quantity: String(i.quantity),
          unitPrice: String(i.unitPrice),
          discount: String(i.discount),
          taxRate: String(i.taxRate),
          notes: "",
        })),
      );
    };

    const resetBlank = () => {
      setSupId("");
      setID(new Date().toISOString().split("T")[0]);
      setDD("");
      setSIN("");
      setPoId("");
      setN("");
      setDueDateTouched(false);
      setRows([emptyRow()]);
    };

    const load = async () => {
      setErrors({});
      if (initial) {
        setLoadingInitial(true);
        try {
          const fullEntry = await apiFetch(`/entries/${initial.id}/`);
          if (!cancelled) applyEntry(fullEntry as PurchaseEntry);
        } catch {
          if (!cancelled) applyEntry(initial);
        } finally {
          if (!cancelled) setLoadingInitial(false);
        }
        return;
      }

      setLoadingInitial(false);
      if (prefillPO) {
        applyPrefillPO();
      } else {
        resetBlank();
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, initial, prefillPO]);

  useEffect(() => {
    if (!open || isEdit || dueDateTouched || !invDate) return;
    const selectedPO = approvedPOs.find((po) => String(po.id) === String(poId));
    const selectedSupplier = suppliers.find(
      (supplier) => String(supplier.id) === String(supId),
    );
    const nextDueDate = dueDateFromPaymentTerms(
      invDate,
      selectedPO?.paymentTerms || selectedSupplier?.paymentTerms,
    );
    setDD(nextDueDate);
  }, [
    open,
    isEdit,
    dueDateTouched,
    invDate,
    poId,
    supId,
    approvedPOs,
    suppliers,
  ]);

  const upd = (i: number, p: Partial<ItemRow>) =>
    setRows((r) => {
      const n = [...r];
      n[i] = { ...n[i], ...p };
      return n;
    });

  const hasLinkedPO = Boolean(prefillPO || poId || initial?.purchaseOrderId);
  const isHeaderLocked = hasLinkedPO;
  const isItemSelectionLocked = hasLinkedPO;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!supId) e.supId = "Supplier is required.";
    if (!invDate) e.invDate = "Invoice date is required.";
    rows.forEach((r, i) => {
      const qty = Number(r.quantity || 0);
      if (!r.assetId) e[`r${i}`] = "Select an item.";
      if (!r.batchNumber.trim()) e[`r${i}_batch`] = "Batch number is required.";
      if (!r.expiryDate) e[`r${i}_expiry`] = "Expiry date is required.";
      if (!Number.isFinite(qty) || qty <= 0) e[`r${i}_qty`] = "Qty must be greater than 0.";
    });
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      toast({
        title: "Please review the purchase entry details",
        description:
          "Complete the required fields and fix the highlighted line items before saving.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedFY) {
      toast({
        title: "Select a financial year",
        description: "Please pick a financial year before saving this entry.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        supplierId: Number(supId),
        financial_year: selectedFY.id,
        supplierInvoiceNo: supInvNo,
        invoiceDate: invDate,
        dueDate: dueDate || null,
        purchaseOrderId: poId ? Number(poId) : null,
        notes,
        items: buildPayload(rows),
      };
      if (isEdit)
        await apiFetch(`/entries/${initial!.id}/`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      else
        await apiFetch("/entries/create/", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      toast({
        title: isEdit ? "Entry updated" : "Entry created",
        description: isEdit
          ? undefined
          : "Click 'Receive Package' to update stock.",
      });
      onSaved();
      onClose();
    } catch (err: any) {
      const fieldErrors = getApiFieldErrors(err);
      const itemErrors = getApiItemErrors(err);
      if (Object.keys(fieldErrors).length || itemErrors.length) {
        setErrors((prev) => ({
          ...prev,
          supId: fieldErrors.supplierId || prev.supId,
          invDate: fieldErrors.invoiceDate || prev.invDate,
        }));
      }
      toast({
        title: "Unable to save the purchase entry",
        description: getApiErrorSummary(err),
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
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 xl:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[1320px] max-h-[96vh] sm:max-h-[94vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-sky-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">
                {isEdit ? "Edit Purchase Entry" : "New Purchase Entry"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {prefillPO
                  ? `Pre-filled from ${prefillPO.poNumber}`
                  : isEdit
                    ? initial?.entryNumber
                    : "Record supplier invoice → Receive → stock updated"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {!isEdit && (
          <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <Package className="w-3.5 h-3.5 text-teal-500 shrink-0" />
            <p className="text-[11px] leading-5 text-teal-700 dark:text-teal-400">
              After saving, click <strong>"Receive Package"</strong> on the row
              to update warehouse stock.
            </p>
          </div>
        )}

        <div className="p-5 space-y-5">
          {loadingInitial && (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading purchase entry items…
            </div>
          )}

          <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Supplier" error={errors.supId} required>
                <div className="relative">
                  <Sel
                    value={supId}
                    onChange={(e) => {
                      setSupId(e.target.value);
                      setDueDateTouched(false);
                    }}
                    disabled={isHeaderLocked}
                    className={
                      isHeaderLocked
                        ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                        : ""
                    }
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Sel>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
              <Field label="Invoice Date" error={errors.invDate} required>
                <Inp
                  type="date"
                  value={invDate}
                  onChange={(e) => {
                    setID(e.target.value);
                    setDueDateTouched(false);
                  }}
                  disabled={isHeaderLocked}
                  className={
                    isHeaderLocked
                      ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                      : ""
                  }
                />
              </Field>
              <Field label="Due Date">
                <Inp
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDD(e.target.value);
                    setDueDateTouched(true);
                  }}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="space-y-3">
                <Field label="Supplier Invoice No">
                  <Inp
                    value={supInvNo}
                    onChange={(e) => setSIN(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Linked PO">
                  <div className="relative">
                    <Sel
                      value={poId}
                      onChange={(e) => {
                        setPoId(e.target.value);
                        setDueDateTouched(false);
                      }}
                      disabled={isHeaderLocked}
                      className={
                        isHeaderLocked
                          ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                          : ""
                      }
                    >
                      <option value="">None</option>
                      {approvedPOs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.poNumber} — {o.supplier.name}
                        </option>
                      ))}
                    </Sel>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  </div>
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setN(e.target.value)}
                  placeholder="Optional"
                  disabled={isHeaderLocked}
                  className={cn(
                    "w-full min-h-[84px] px-2.5 py-2 rounded-lg border border-border bg-background text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-none",
                    isHeaderLocked &&
                      "bg-muted/35 text-muted-foreground cursor-not-allowed",
                  )}
                />
              </Field>
            </div>

            {poId && (
              <div className="rounded-xl border bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground">
                This entry is linked to the approved purchase order. The{" "}
                <strong>item selection</strong>, supplier, and PO link stay
                fixed, but you can enter the actual <strong>batch number</strong>,
                <strong> expiry date</strong>, and invoice reference values
                here before saving. <strong>Qty</strong>, <strong>Unit Price</strong>,
                <strong> Discount</strong>, and <strong>Tax</strong> stay locked
                from the PO. Stock updates only after{" "}
                <strong>Receive Package</strong>.
              </div>
            )}
          </div>

          {/* Items */}
          <div className="rounded-2xl border border-border overflow-hidden bg-card shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-muted/30 border-b border-border">
              <div>
                <p className="text-[15px] font-bold text-foreground">
                  Line Items
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {hasLinkedPO
                    ? "Items are inherited from the linked purchase order. Enter the actual batch number and expiry date before saving."
                    : "Record received items, update batch, expiry, quantity, and invoice values before saving."}
                </p>
              </div>
              {!hasLinkedPO && (
                <button
                  onClick={() => setRows((r) => [...r, emptyRow()])}
                  className="h-8.5 px-3.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 flex items-center gap-1.5 shadow-sm shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <div
                className={cn(
                  ENTRY_ITEM_GRID,
                  "gap-2 px-4 py-3 bg-muted/10 text-[9px] font-bold text-muted-foreground uppercase tracking-[0.16em] border-b border-border items-center",
                )}
              >
                <div>Item</div>
                <div className="text-center">Batch No</div>
                <div className="text-center">Expiry Date</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Unit Price</div>
                <div className="text-right">Disc%</div>
                <div className="text-right">Tax%</div>
                <div className="text-right">Total</div>
              </div>
              {isEdit &&
                !loadingInitial &&
                rows.length === 1 &&
                !rows[0].assetId &&
                !rows[0].itemName && (
                  <div className="px-4 py-6 text-center text-[13px] text-muted-foreground border-b border-border/50">
                    No line items were found for this purchase entry.
                  </div>
                )}
              {!loadingInitial &&
                rows.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      ENTRY_ITEM_GRID,
                      "gap-2 px-4 py-3.5 border-b border-border/50 hover:bg-muted/10 items-start",
                    )}
                  >
                    <div className="min-w-0">
                      <SearchDropdown<Asset>
                        items={assets}
                        value={r.assetId}
                        disabled={isItemSelectionLocked}
                        placeholder="Select asset…"
                        searchPlaceholder="Search by name or code…"
                        onChange={(id, asset) => {
                          const purchasePrice = assetPurchasePrice(asset);
                          upd(idx, {
                            assetId: id,
                            itemName: asset?.name ?? "",
                            unitPrice: purchasePrice
                              ? String(purchasePrice)
                              : r.unitPrice,
                          });
                        }}
                        getLabel={(a) => `[${a.code}] ${a.name}`}
                        getSelectedLabel={(a) => `[${a.code}] ${a.name}`}
                        getSearchFields={(a) => [
                          a.name,
                          a.code,
                          a.category ?? "",
                        ]}
                        renderOption={(a, isSelected, query) => {
                          const highlightText = (text: string) => {
                            if (!query.trim()) return <span>{text}</span>;
                            const q = query.toLowerCase();
                            const idx2 = text.toLowerCase().indexOf(q);
                            if (idx2 === -1) return <span>{text}</span>;
                            return (
                              <span>
                                {text.slice(0, idx2)}
                                <mark className="bg-primary/20 text-primary rounded px-0.5 font-semibold not-italic">
                                  {text.slice(idx2, idx2 + q.length)}
                                </mark>
                                {text.slice(idx2 + q.length)}
                              </span>
                            );
                          };
                          return (
                            <div className="flex items-center gap-2 w-0 flex-1">
                              <span className="shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                {highlightText(a.code)}
                              </span>
                              <span className="truncate text-[13px] text-foreground">
                                {highlightText(a.name)}
                              </span>
                              {a.category && (
                                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                  {a.category}
                                </span>
                              )}
                            </div>
                          );
                        }}
                      />
                      {errors[`r${idx}`] && (
                        <p className="text-[10px] text-rose-500 mt-0.5">
                          {errors[`r${idx}`]}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <Inp
                        value={r.batchNumber}
                        onChange={(e) =>
                          upd(idx, { batchNumber: e.target.value })
                        }
                        placeholder="Enter batch number"
                        className={
                          cn(
                            "text-center",
                            errors[`r${idx}_batch`] ? "border-rose-400" : "",
                          )
                        }
                      />
                      {errors[`r${idx}_batch`] && (
                        <p className="text-[10px] text-rose-500 mt-0.5">
                          {errors[`r${idx}_batch`]}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <Inp
                        type="date"
                        value={r.expiryDate}
                        onChange={(e) =>
                          upd(idx, { expiryDate: e.target.value })
                        }
                        className={
                          cn(
                            "text-center",
                            errors[`r${idx}_expiry`] ? "border-rose-400" : "",
                          )
                        }
                      />
                      {errors[`r${idx}_expiry`] && (
                        <p className="text-[10px] text-rose-500 mt-0.5">
                          {errors[`r${idx}_expiry`]}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <Inp
                        type="number"
                        min="0"
                        step="1"
                        value={r.quantity}
                        onChange={(e) => upd(idx, { quantity: e.target.value })}
                        disabled={hasLinkedPO}
                        className={
                          cn(
                            "text-right tabular-nums",
                            errors[`r${idx}_qty`] ? "border-rose-400" : "",
                            hasLinkedPO
                              ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                              : "",
                          )
                        }
                      />
                      {errors[`r${idx}_qty`] && (
                        <p className="text-[10px] text-rose-500 mt-0.5">
                          {errors[`r${idx}_qty`]}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Inp
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.unitPrice}
                        onChange={(e) =>
                          upd(idx, { unitPrice: e.target.value })
                        }
                        disabled={hasLinkedPO}
                        className={
                          cn(
                            "text-right tabular-nums",
                            hasLinkedPO
                              ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                              : "",
                          )
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <Inp
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.discount}
                        onChange={(e) => upd(idx, { discount: e.target.value })}
                        disabled={hasLinkedPO}
                        className={
                          cn(
                            "text-right tabular-nums",
                            hasLinkedPO
                              ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                              : "",
                          )
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <Inp
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.taxRate}
                        onChange={(e) => upd(idx, { taxRate: e.target.value })}
                        disabled={hasLinkedPO}
                        className={
                          cn(
                            "text-right tabular-nums",
                            hasLinkedPO
                              ? "bg-muted/35 text-muted-foreground cursor-not-allowed"
                              : "",
                          )
                        }
                      />
                    </div>
                    <div className="flex h-9 items-center justify-end text-[13px] font-semibold tabular-nums">
                      {fmt(rowTotal(r))}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-stretch sm:justify-end">
            <div className="w-full max-w-[280px] rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 to-background p-3.5 shadow-sm space-y-2">
              {[
                ["Subtotal", fmt(t.sub)],
                ["Discount", `− ${fmt(t.disc)}`],
                ["Tax", `+ ${fmt(t.tax)}`],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="flex justify-between text-[13px] text-muted-foreground"
                >
                  <span>{l}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="flex justify-between text-[14px] font-bold text-foreground border-t border-primary/20 pt-2">
                <span>Total</span>
                <span className="text-primary">{fmt(t.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 grid grid-cols-1 sm:grid-cols-2 gap-2 px-4 pb-4 border-t border-border pt-3 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <button
            onClick={onClose}
            className="h-10 rounded-xl border border-border text-[13px] text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="h-10 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIVE PACKAGE DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function ReceivePackageDialog({
  open,
  onClose,
  entry,
  onReceived,
}: {
  open: boolean;
  onClose: () => void;
  entry: PurchaseEntry | null;
  onReceived: () => void;
}) {
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [receiving, setReceiving] = useState(false);

  useEffect(() => {
    if (!open) {
      setWarehouseId("");
      return;
    }
    fetch(`${API_URL}/api/stock/warehouses/`, { headers: authHdrs() })
      .then((r) => r.json())
      .then(setWarehouses)
      .catch(() => {});
  }, [open]);

  const assetItems = useMemo(
    () => (entry?.items || []).filter((i) => i.assetId),
    [entry],
  );
  const totalUnits = assetItems.reduce((s, i) => s + i.quantity, 0);

  const handleReceive = async () => {
    if (!entry) return;
    setReceiving(true);
    try {
      const payload = warehouseId ? { warehouseId: Number(warehouseId) } : {};
      const res = await apiFetch(`/entries/${entry.id}/receive/`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast({ title: "📦 Goods Received!", description: (res as any).message });
      onReceived();
      onClose();
    } catch (err: any) {
      toast({
        title: "Receive failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setReceiving(false);
    }
  };

  if (!open || !entry) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-teal-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Receive Package</h2>
              <p className="text-xs text-muted-foreground">
                {entry.entryNumber} · {entry.supplier.name}
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
        <div className="p-3 space-y-2">
          <div className="rounded-xl bg-teal-500/10 border border-teal-500/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-teal-700 dark:text-teal-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              What this does
            </p>
            <ul className="text-xs text-teal-700/80 dark:text-teal-400/80 space-y-1 ml-6 list-disc">
              <li>
                Adds <strong>{totalUnits}</strong> unit(s) across{" "}
                <strong>{assetItems.length}</strong> asset type(s) to stock
              </li>
              <li>Creates StockHistory record (purchase_receipt)</li>
              <li>Marks entry as received — prevents duplicate receipt</li>
              <li>Updates linked PO status → received / partial</li>
              <li>Stock immediately available for sales</li>
            </ul>
          </div>
          {assetItems.length > 0 ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Items
              </div>
              <div className="divide-y divide-border">
                {assetItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {item.itemName}
                    </span>
                    <span className="font-bold text-teal-600 dark:text-teal-400">
                      +{item.quantity} unit(s)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                No asset items — service/custom items don't affect stock.
              </p>
            </div>
          )}
          <Field label="Receive Into Warehouse">
            <div className="relative">
              <Sel
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">
                  {warehouses.length > 0
                    ? "Default (first active warehouse)"
                    : "Loading warehouses…"}
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.location ? ` — ${w.location}` : ""}
                  </option>
                ))}
              </Sel>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
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
            onClick={handleReceive}
            disabled={receiving || assetItems.length === 0}
            className="flex-1 h-10 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {receiving && <Loader2 className="w-4 h-4 animate-spin" />}
            <Package className="w-4 h-4" />
            Receive → Update Stock
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function PaymentDialog({
  open,
  onClose,
  entry,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  entry: PurchaseEntry | null;
  onSaved: () => void;
}) {
  const [amount, setAmt] = useState("");
  const [payDate, setPD] = useState(new Date().toISOString().split("T")[0]);
  const [method, setM] = useState("cash");
  const [refNo, setRef] = useState("");
  const [notes, setN] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !entry) return;
    setAmt(String(entry.balanceAmount));
    setPD(new Date().toISOString().split("T")[0]);
    setM("cash");
    setRef("");
    setN("");
  }, [open, entry]);

  const submit = async () => {
    const amt = Number(amount || 0);
    if (amt <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    if (entry && amt > entry.balanceAmount + 0.01) {
      toast({
        title: "Amount exceeds balance",
        description: fmt(entry.balanceAmount),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/entries/${entry!.id}/payments/`, {
        method: "POST",
        body: JSON.stringify({
          amount: amt,
          paymentDate: payDate,
          paymentMethod: method,
          referenceNo: refNo,
          notes,
        }),
      });
      toast({ title: "Payment recorded", description: `${fmt(amt)} paid.` });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({
        title: "Payment failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open || !entry) return null;
  const amt = Number(amount || 0);
  const isPartial = amt > 0 && amt < entry.balanceAmount;
  const isFull = amt >= entry.balanceAmount - 0.01 && amt > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Record Payment</h2>
              <p className="text-xs text-muted-foreground">
                {entry.entryNumber} · Balance {fmt(entry.balanceAmount)}
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
              ["Total", entry.totalAmount, "text-foreground"],
              [
                "Paid",
                entry.paidAmount,
                "text-emerald-600 dark:text-emerald-400",
              ],
              [
                "Balance",
                entry.balanceAmount,
                "text-rose-600 dark:text-rose-400",
              ],
            ].map(([l, v, c]) => (
              <div
                key={String(l)}
                className="rounded-xl bg-muted/30 border border-border p-3 text-center"
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {l}
                </p>
                <p className={cn("text-base font-bold", c)}>{fmt(Number(v))}</p>
              </div>
            ))}
          </div>
          <Field label="Amount to Pay" required>
            <div className="space-y-2">
              <Inp
                type="number"
                min="0.01"
                step="0.01"
                max={entry.balanceAmount}
                value={amount}
                onChange={(e) => setAmt(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setAmt(String(entry.balanceAmount))}
                  className={cn(
                    "flex-1 h-7 rounded-lg border text-xs font-semibold transition-colors",
                    isFull
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
                  )}
                >
                  Full {fmt(entry.balanceAmount)}
                </button>
                <button
                  onClick={() =>
                    setAmt(
                      String(Math.round((entry.balanceAmount / 2) * 100) / 100),
                    )
                  }
                  className="flex-1 h-7 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  50%
                </button>
                <button
                  onClick={() =>
                    setAmt(
                      String(Math.round((entry.balanceAmount / 4) * 100) / 100),
                    )
                  }
                  className="flex-1 h-7 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  25%
                </button>
              </div>
            </div>
          </Field>
          {amt > 0 && (
            <div
              className={cn(
                "p-3 rounded-xl border text-xs flex items-center gap-2",
                isPartial
                  ? "bg-amber-500/10 border-amber-500/20"
                  : "bg-emerald-500/10 border-emerald-500/20",
              )}
            >
              {isPartial ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              )}
              <span
                className={
                  isPartial
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {isPartial
                  ? `Partial — ${fmt(entry.balanceAmount - amt)} remains due`
                  : "Full payment — entry marked as Paid"}
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
            className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}Pay{" "}
            {amt > 0 ? fmt(amt) : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BULK PAYMENT DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function BulkPaymentDialog({
  open,
  onClose,
  suppliers,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  onSaved: () => void;
}) {
  const [supId, setSupId] = useState("");
  const [entries, setEnts] = useState<PurchaseEntry[]>([]);
  const [selIds, setSelIds] = useState<number[]>([]);
  const [amount, setAmt] = useState("");
  const [payDate, setPD] = useState(new Date().toISOString().split("T")[0]);
  const [method, setM] = useState("cash");
  const [refNo, setRef] = useState("");
  const [notes, setN] = useState("");
  const [loading, setLoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocPreview, setAlloc] = useState<
    { entryId: number; entryNumber: string; allocated: number }[]
  >([]);

  const fyParam = useFYParam();
  const withFYLocal = useCallback(
    (path: string) =>
      fyParam
        ? path.includes("?")
          ? `${path}&${fyParam}`
          : `${path}?${fyParam}`
        : path,
    [fyParam],
  );

  useEffect(() => {
    if (!open) {
      setSupId("");
      setEnts([]);
      setSelIds([]);
      setAmt("");
      setM("cash");
      setRef("");
      setN("");
      setAlloc([]);
    }
  }, [open]);

  const fetchEntries = async (id: string) => {
    if (!id) return;
    setLoad(true);
    try {
      const list = (await apiFetch(
        withFYLocal(`/entries/?supplierId=${id}`),
      )) as PurchaseEntry[];
      const openList = list
        .filter(
          (e) =>
            e.balanceAmount > 0 &&
            ["unpaid", "partial"].includes(e.paymentStatus),
        )
        .sort((a, b) =>
          (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? ""),
        );
      setEnts(openList);
      setSelIds(openList.map((e) => e.id));
    } catch (err: any) {
      toast({
        title: "Failed to load entries",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoad(false);
    }
  };

  const selectedEntries = useMemo(
    () => entries.filter((e) => selIds.includes(e.id)),
    [entries, selIds],
  );
  const totalOutstanding = useMemo(
    () => selectedEntries.reduce((s, e) => s + e.balanceAmount, 0),
    [selectedEntries],
  );

  useEffect(() => {
    const amt = Number(amount || 0);
    if (amt <= 0 || !selectedEntries.length) {
      setAlloc([]);
      return;
    }
    let rem = amt;
    const preview = [];
    for (const e of selectedEntries) {
      if (rem <= 0) break;
      const pay = Math.min(rem, e.balanceAmount);
      preview.push({
        entryId: e.id,
        entryNumber: e.entryNumber,
        allocated: Math.round(pay * 100) / 100,
      });
      rem -= pay;
    }
    setAlloc(preview);
  }, [amount, selectedEntries]);

  const submit = async () => {
    const amt = Number(amount || 0);
    if (!supId) {
      toast({ title: "Select a supplier", variant: "destructive" });
      return;
    }
    if (!selIds.length) {
      toast({ title: "Select at least one entry", variant: "destructive" });
      return;
    }
    if (amt <= 0) {
      toast({ title: "Enter a positive amount", variant: "destructive" });
      return;
    }
    if (amt > totalOutstanding + 0.01) {
      toast({
        title: "Amount exceeds outstanding",
        description: fmt(totalOutstanding),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/payments/bulk/", {
        method: "POST",
        body: JSON.stringify({
          supplierId: Number(supId),
          entryIds: selIds,
          amount: amt,
          paymentDate: payDate,
          paymentMethod: method,
          referenceNo: refNo,
          notes,
        }),
      });
      toast({
        title: "Bulk payment recorded",
        description: (res as any).message,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({
        title: "Bulk payment failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
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
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <ArrowRightLeft className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">
                Bulk Supplier Payment
              </h2>
              <p className="text-xs text-muted-foreground">
                FIFO allocation across multiple entries
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
                Step 1 — Select Supplier
              </p>
            </div>
            <div className="p-4">
              <div className="relative w-64">
                <Sel
                  value={supId}
                  onChange={(e) => {
                    setSupId(e.target.value);
                    fetchEntries(e.target.value);
                  }}
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
          {supId && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Step 2 — Select Entries
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {selIds.length}/{entries.length} selected · Outstanding:{" "}
                    <strong className="text-foreground">
                      {fmt(totalOutstanding)}
                    </strong>
                  </span>
                  <button
                    onClick={() => setSelIds(entries.map((e) => e.id))}
                    className="text-primary hover:underline"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelIds([])}
                    className="hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading…
                </div>
              ) : entries.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground text-center">
                  No open entries.
                </div>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {entries.map((e) => {
                    const alloc = allocPreview.find((a) => a.entryId === e.id);
                    return (
                      <label
                        key={e.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selIds.includes(e.id)}
                          onChange={(ev) =>
                            setSelIds((p) =>
                              ev.target.checked
                                ? [...p, e.id]
                                : p.filter((x) => x !== e.id),
                            )
                          }
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-sm font-mono">
                              {e.entryNumber}
                            </span>
                            <PayBadge status={e.paymentStatus} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {e.supplier.name} · {fmtDate(e.invoiceDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-rose-600 dark:text-rose-400">
                            {fmt(e.balanceAmount)}
                          </p>
                          {alloc && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                              Pay {fmt(alloc.allocated)}
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
          {selectedEntries.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Step 3 — Payment Details
                </p>
              </div>
              <div className="p-4 space-y-4">
                <Field label="Amount" required>
                  <div className="space-y-2">
                    <Inp
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmt(e.target.value)}
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
                      Pay All {fmt(totalOutstanding)}
                    </button>
                  </div>
                </Field>
                {allocPreview.length > 0 && (
                  <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-emerald-500/15">
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                        FIFO Allocation Preview
                      </p>
                    </div>
                    {allocPreview.map((a) => {
                      const e = entries.find((x) => x.id === a.entryId);
                      const remaining = e
                        ? Math.round((e.balanceAmount - a.allocated) * 100) /
                          100
                        : 0;
                      return (
                        <div
                          key={a.entryId}
                          className="flex items-center gap-3 px-3 py-2 border-b border-emerald-500/10"
                        >
                          <span className="font-mono text-xs text-foreground font-semibold w-28 shrink-0">
                            {a.entryNumber}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{
                                width: `${e ? Math.min(100, (a.allocated / e.balanceAmount) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                            {fmt(a.allocated)}
                          </span>
                          {remaining > 0.001 ? (
                            <span className="text-xs text-muted-foreground w-24 text-right">
                              {fmt(remaining)} left
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold w-24 text-right">
                              ✓ Full
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <div className="px-3 py-2 flex justify-between text-xs">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {fmt(Math.min(amt, totalOutstanding))}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Date">
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
                  <Field label="Reference">
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
                    placeholder="Optional"
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
              ? `Pay ${fmt(Number(amount))} across ${allocPreview.length} entries`
              : "Pay Selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload Invoice ─────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  entry,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  entry: PurchaseEntry | null;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDrag] = useState(false);
  const [uploading, setUp] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setErr(null);
      setDrag(false);
    }
  }, [open]);

  const pick = (f: File) => {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(f.type)) {
      setErr("Allowed: PDF, PNG, JPG");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErr("Max 10 MB");
      return;
    }
    setFile(f);
    setErr(null);
  };

  const upload = async () => {
    if (!file || !entry) return;
    setUp(true);
    try {
      const fd = new FormData();
      fd.append("invoice_file", file);
      const res = await fetch(
        `${API_URL}/api/purchases/entries/${entry.id}/upload/`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        },
      );
      if (res.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "Upload failed");
      toast({ title: "Invoice uploaded" });
      onUploaded();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Upload failed.");
    } finally {
      setUp(false);
    }
  };

  if (!open || !entry) return null;
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
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Upload className="w-4 h-4 text-violet-500" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Upload Invoice</h2>
              <p className="text-xs text-muted-foreground">
                {entry.entryNumber}
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
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) pick(f);
            }}
            onClick={() => document.getElementById("pe-file-input")?.click()}
            className={cn(
              "rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all",
              dragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            <input
              id="pe-file-input"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick(f);
              }}
            />
            {file ? (
              <div className="space-y-1">
                <FileText className="w-8 h-8 text-primary mx-auto" />
                <p className="text-sm font-semibold text-foreground">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
                <p className="text-sm font-medium text-foreground">
                  Drop or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  PDF, PNG, JPG — max 10 MB
                </p>
              </div>
            )}
          </div>
          {err && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <p className="text-sm text-rose-600">{err}</p>
            </div>
          )}
          {entry.hasInvoiceFile && !file && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-600">
                Uploading will replace the existing invoice.
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={upload}
            disabled={!file || uploading}
            className="flex-1 h-10 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function PurchaseEntries() {
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

  const [entries, setEntries] = useState<PurchaseEntry[]>([]);
  const [approvedPOs, setApprovedPOs] = useState<ApprovedPO[]>([]);
  const [suppliers, setSup] = useState<Supplier[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [payFilt, setPayFilt] = useState("");
  const [supFilt, setSupFilt] = useState("");

  // ★ Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PurchaseEntry | null>(null);
  const [prefillPO, setPrefillPO] = useState<ApprovedPO | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseEntry | null>(
    null,
  );
  const [payTarget, setPayTarget] = useState<PurchaseEntry | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [uploadTgt, setUploadTgt] = useState<PurchaseEntry | null>(null);
  const [detailEntry, setDetailEntry] = useState<PurchaseEntry | null>(null);
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    desc: "",
    btnLabel: "",
    btnCls: "",
    onConfirm: () => {},
    loading: false,
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesData, posData] = await Promise.all([
        apiFetch(withFY("/entries/")),
        apiFetch(withFY("/approved-pos/")),
      ]);
      setEntries(entriesData);
      setApprovedPOs(posData);
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [withFY]);

  const openReceive = async (e: PurchaseEntry) => {
    try {
      const full = await apiFetch(`/entries/${e.id}/`);
      setReceiveTarget({ ...e, ...full });
    } catch {
      setReceiveTarget(e);
    }
  };

  useEffect(() => {
    fetchAll();
    apiFetch("/suppliers/")
      .then(setSup)
      .catch(() => {});
    apiFetch("/assets/")
      .then(setAssets)
      .catch(() => {});
  }, [fetchAll]);

  // ★ Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, payFilt, supFilt, itemsPerPage]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const toTime = (value?: string | null) => {
      if (!value) return 0;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const actionPriority = (entry: PurchaseEntry) => {
      const isOverdue =
        !!entry.dueDate &&
        new Date(entry.dueDate).getTime() < Date.now() &&
        entry.paymentStatus !== "paid";

      if (!entry.isReceived) return isOverdue ? 0 : 1;
      if (entry.paymentStatus === "unpaid") return isOverdue ? 2 : 3;
      if (entry.paymentStatus === "partial") return isOverdue ? 4 : 5;
      return 6;
    };

    return entries
      .filter(
        (e) =>
          (!q ||
            e.entryNumber.toLowerCase().includes(q) ||
            e.supplier.name.toLowerCase().includes(q) ||
            e.supplierInvoiceNo.toLowerCase().includes(q)) &&
          (!payFilt || e.paymentStatus === payFilt) &&
          (!supFilt || String(e.supplier.id) === supFilt),
      )
      .sort((a, b) => {
        const priorityDiff = actionPriority(a) - actionPriority(b);
        if (priorityDiff !== 0) return priorityDiff;

        const timeDiff =
          toTime((b as PurchaseEntry & { updatedAt?: string }).updatedAt) -
            toTime((a as PurchaseEntry & { updatedAt?: string }).updatedAt) ||
          toTime(b.createdAt) - toTime(a.createdAt) ||
          toTime(b.invoiceDate) - toTime(a.invoiceDate);
        if (timeDiff !== 0) return timeDiff;

        return b.id - a.id;
      });
  }, [entries, search, payFilt, supFilt]);

  // ★ Pagination derived values
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage, itemsPerPage]);

  // ★ Clamp page if filtered results shrink
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const stats = useMemo(
    () => ({
      total: entries.length,
      unpaid: entries.filter((e) => e.paymentStatus === "unpaid").length,
      partial: entries.filter((e) => e.paymentStatus === "partial").length,
      paid: entries.filter((e) => e.paymentStatus === "paid").length,
      balance: entries.reduce((s, e) => s + e.balanceAmount, 0),
      invoiced: entries.reduce((s, e) => s + e.totalAmount, 0),
      pendingReceive: entries.filter((e) => !e.isReceived).length,
    }),
    [entries],
  );

  const overdueEntries = entries.filter(
    (e) =>
      e.dueDate &&
      new Date(e.dueDate) < new Date() &&
      e.paymentStatus !== "paid",
  );
  const readyForEntryPOs = useMemo(
    () =>
      approvedPOs
        .filter(
          (po) =>
            (po.status === "approved" || po.status === "partial") &&
            po.needsEntry,
        )
        .sort((a, b) => {
          const statusPriority = (po: ApprovedPO) =>
            po.status === "partial" ? 0 : 1;
          const priorityDiff = statusPriority(a) - statusPriority(b);
          if (priorityDiff !== 0) return priorityDiff;

          const toTime = (value?: string | null) => {
            if (!value) return 0;
            const parsed = new Date(value).getTime();
            return Number.isNaN(parsed) ? 0 : parsed;
          };

          const timeDiff =
            toTime((b as ApprovedPO & { updatedAt?: string }).updatedAt) -
              toTime((a as ApprovedPO & { updatedAt?: string }).updatedAt) ||
            toTime((b as ApprovedPO & { createdAt?: string }).createdAt) -
              toTime((a as ApprovedPO & { createdAt?: string }).createdAt) ||
            toTime(b.orderDate) - toTime(a.orderDate);
          if (timeDiff !== 0) return timeDiff;

          return b.id - a.id;
        }),
    [approvedPOs],
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
      fetchAll();
    } catch (err: any) {
      toast({
        title: fail,
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setConfirm((c) => ({ ...c, open: false, loading: false }));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Purchase Entries
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Supplier invoices → Receive Package → stock updated → pay
          </p>
        </div>
        <button
          onClick={() => setBulkOpen(true)}
          className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center gap-2"
        >
          <ArrowRightLeft className="w-4 h-4" />
          Bulk Payment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Unpaid",
            value: parseInt(String(Number(stats.unpaid))),
            cls: "bg-rose-500/10    text-rose-600    border-rose-500/20",
          },
          {
            label: "Partial",
            value: stats.partial,
            cls: "bg-amber-500/10   text-amber-600   border-amber-500/20",
          },
          {
            label: "Paid",
            value: stats.paid,
            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          },
          {
            label: "Pending Receive",
            value: stats.pendingReceive,
            cls: "bg-teal-500/10    text-teal-600    border-teal-500/20",
          },
        ].map((s) => (
          <div key={s.label} className={cn("rounded-2xl border p-3", s.cls)}>
            <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
              {s.label}
            </p>
            <p className="text-xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Banners */}
      {stats.pendingReceive > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
          <Package className="w-5 h-5 text-teal-500 shrink-0" />
          <p className="text-sm text-teal-700 dark:text-teal-400">
            <strong>{stats.pendingReceive}</strong>{" "}
            {stats.pendingReceive === 1 ? "entry" : "entries"} pending goods
            receipt. Click <strong>"Receive Package"</strong> on the row to
            update stock.
          </p>
        </div>
      )}
      {overdueEntries.length > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-600 dark:text-rose-400">
            <strong>{overdueEntries.length}</strong>{" "}
            {overdueEntries.length === 1 ? "entry is" : "entries are"} past due
            date.
          </p>
          <button
            onClick={() => setPayFilt("unpaid")}
            className="ml-auto text-xs font-semibold text-rose-600 hover:underline"
          >
            View unpaid →
          </button>
        </div>
      )}

      {readyForEntryPOs.length > 0 && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sky-500/10">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Approved Purchase Orders Ready for Entry
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create a purchase entry from an approved PO, then use{" "}
                <strong>Receive Package</strong> to update stock.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-600">
              {readyForEntryPOs.length} ready
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {readyForEntryPOs.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between gap-4 px-4 py-3 bg-background/80"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-semibold text-sm text-foreground font-mono">
                      {po.poNumber}
                    </p>
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      {po.status === "partial"
                        ? "Partially received"
                        : "Approved"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {po.supplier.name} · Order {fmtDate(po.orderDate)} · Total{" "}
                    {fmt(po.totalAmount)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {po.items.length} {po.items.length === 1 ? "item" : "items"}{" "}
                    · Entries created: {po.entryCount} · Received entries:{" "}
                    {po.receivedCount}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPrefillPO(po);
                    setEditTarget(null);
                    setFormOpen(true);
                  }}
                  className="shrink-0 h-8.5 px-3.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Entry
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entry, supplier, invoice…"
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            value={supFilt}
            onChange={(e) => setSupFilt(e.target.value)}
            className="w-44 h-9"
          >
            <option value="">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        {/* ★ Payment status filter buttons */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/40 border border-border">
          {[
            { value: "", label: "All" },
            { value: "unpaid", label: "Unpaid" },
            { value: "partial", label: "Partial" },
            { value: "paid", label: "Paid" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPayFilt(opt.value)}
              className={cn(
                "h-7 px-3 rounded-lg text-xs font-medium transition-colors",
                payFilt === opt.value
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
        {(search || payFilt || supFilt) && (
          <button
            onClick={() => {
              setSearch("");
              setPayFilt("");
              setSupFilt("");
            }}
            className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Error / Loading */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">Failed to load</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={fetchAll}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium hover:bg-rose-500/25 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}
      {loading && !error && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* ★ Table with Pagination */}
      {!loading && !error && (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <FileText className="w-12 h-12 text-muted-foreground opacity-30" />
              <p className="text-sm font-semibold text-foreground">
                No purchase entries found
              </p>
              <p className="text-xs text-muted-foreground">
                {search || payFilt || supFilt
                  ? "Try adjusting filters."
                  : "No purchase entries are available yet."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      {[
                        "Entry / Supplier",
                        "Dates",
                        "Amount",
                        "Paid / Balance",
                        "Payment",
                        "★ Stock",
                        "Invoice",
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
                    {paginatedEntries.map((e) => {
                      const isOverdue =
                        e.dueDate &&
                        new Date(e.dueDate) < new Date() &&
                        e.paymentStatus !== "paid";
                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/20 group transition-colors cursor-pointer",
                            isOverdue && "bg-rose-500/5",
                          )}
                          onClick={() => setDetailEntry(e)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground font-mono text-xs">
                              {e.entryNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {e.supplier.name}
                            </p>
                            {e.supplierInvoiceNo && (
                              <p className="text-[10px] text-muted-foreground/70">
                                Inv: {e.supplierInvoiceNo}
                              </p>
                            )}
                            {e.purchaseOrderNo && (
                              <p className="text-[10px] text-sky-600 font-medium">
                                PO: {e.purchaseOrderNo}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <p className="font-semibold text-foreground font-medium text-xs w-max">
                              Invoice: {fmtDate(e.invoiceDate)}
                            </p>
                            <p
                              className={cn(
                                "text-xs",
                                isOverdue
                                  ? "text-rose-600 dark:text-rose-400 font-semibold"
                                  : "text-muted-foreground",
                              )}
                            >
                              Due: {fmtDate(e.dueDate)}
                              {isOverdue ? " ⚠" : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-bold text-foreground tabular-nums">
                              {fmt(e.totalAmount)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Tax: {fmt(e.taxAmount)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                              Paid: {fmt(e.paidAmount)}
                            </p>
                            <p
                              className={cn(
                                "text-xs font-semibold tabular-nums",
                                e.balanceAmount > 0
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              Bal: {fmt(e.balanceAmount)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <PayBadge status={e.paymentStatus} />
                          </td>

                          {/* Receive */}
                          <td className="px-4 py-3">
                            {e.isReceived ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 border border-teal-500/20">
                                  <CheckCircle className="w-3 h-3" />
                                  Stock Updated
                                </span>
                                {e.receivedAt && (
                                  <p className="text-[10px] text-muted-foreground">
                                    {fmtDate(e.receivedAt)}
                                  </p>
                                )}
                                {e.receivedBy && (
                                  <p className="text-[10px] text-muted-foreground">
                                    by {e.receivedBy}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  openReceive(e);
                                }}
                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap"
                              >
                                <Package className="w-3.5 h-3.5" />
                                Receive Package
                              </button>
                            )}
                          </td>

                          {/* Invoice file */}
                          <td className="px-4 py-3">
                            {e.hasInvoiceFile ? (
                              <div
                                className="flex items-center gap-1.5"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20 font-medium">
                                  <FileText className="w-3 h-3" />
                                  Attached
                                </span>
                                <button
                                  onClick={() => viewFileAuth(e.id)}
                                  title="View"
                                  className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500/20"
                                >
                                  <Eye className="w-3 h-3 text-emerald-600" />
                                </button>
                                <button
                                  onClick={() =>
                                    downloadFileAuth(
                                      e.id,
                                      `invoice-${e.entryNumber}.pdf`,
                                    )
                                  }
                                  title="Download"
                                  className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500/20"
                                >
                                  <Download className="w-3 h-3 text-emerald-600" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setUploadTgt(e);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 font-medium hover:bg-amber-500/20"
                              >
                                <Upload className="w-3 h-3" />
                                Upload
                              </button>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div
                              className="flex items-center gap-1 group-hover:opacity-100 transition-opacity"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {e.paymentStatus !== "paid" && (
                                <button
                                  onClick={() => setPayTarget(e)}
                                  title="Pay"
                                  className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-500"
                                >
                                  <Wallet className="w-3 h-3" />
                                </button>
                              )}
                              {!e.isReceived && e.paymentStatus !== "paid" && (
                                <button
                                  onClick={() => setEditTarget(e)}
                                  title="Edit"
                                  className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={() => setUploadTgt(e)}
                                title="Upload invoice"
                                className="w-7 h-7 rounded-lg hover:bg-violet-500/10 flex items-center justify-center text-muted-foreground hover:text-violet-500"
                              >
                                <Upload className="w-3 h-3" />
                              </button>
                              {e.paidAmount <= 0 && !e.isReceived && (
                                <button
                                  title="Delete"
                                  onClick={() =>
                                    setConfirm({
                                      open: true,
                                      loading: false,
                                      title: "Delete Entry",
                                      desc: `Delete ${e.entryNumber}? This cannot be undone.`,
                                      btnLabel: "Delete",
                                      btnCls: "bg-rose-600 hover:bg-rose-700",
                                      onConfirm: () =>
                                        doAction(
                                          `/entries/${e.id}/delete/`,
                                          "DELETE",
                                          "Entry deleted",
                                          "Delete failed",
                                        ),
                                    })
                                  }
                                  className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ★ PAGINATION FOOTER */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={entries.length}
                itemsPerPage={itemsPerPage}
                filteredCount={filtered.length}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onItemsPerPageChange={(perPage) => {
                  setItemsPerPage(perPage);
                  setCurrentPage(1);
                }}
              />
            </>
          )}
        </div>
      )}

      {/* Dialogs */}
      <EntryFormDialog
        open={formOpen || !!editTarget || !!prefillPO}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
          setPrefillPO(null);
        }}
        onSaved={fetchAll}
        initial={editTarget}
        suppliers={suppliers}
        assets={assets}
        approvedPOs={approvedPOs}
        prefillPO={prefillPO}
      />
      <ReceivePackageDialog
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        entry={receiveTarget}
        onReceived={fetchAll}
      />
      <PaymentDialog
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        entry={payTarget}
        onSaved={fetchAll}
      />
      <BulkPaymentDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        suppliers={suppliers}
        onSaved={fetchAll}
      />
      <UploadDialog
        open={!!uploadTgt}
        onClose={() => setUploadTgt(null)}
        entry={uploadTgt}
        onUploaded={fetchAll}
      />

      {/* Detail Panel */}
      {detailEntry && (
        <DetailPanel
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onPaymentDeleted={fetchAll}
          onRefresh={fetchAll}
          onPay={(entry) => setPayTarget(entry)}
          onEdit={(entry) => setEditTarget(entry)}
          onUpload={(entry) => setUploadTgt(entry)}
          onReceive={(entry) => openReceive(entry)}
          onDelete={(entry) =>
            setConfirm({
              open: true,
              loading: false,
              title: "Delete Entry",
              desc: `Delete ${entry.entryNumber}? This cannot be undone.`,
              btnLabel: "Delete",
              btnCls: "bg-rose-600 hover:bg-rose-700",
              onConfirm: () =>
                doAction(
                  `/entries/${entry.id}/delete/`,
                  "DELETE",
                  "Entry deleted",
                  "Delete failed",
                ),
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
