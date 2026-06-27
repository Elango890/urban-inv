// src/pages/PurchaseOrders.tsx
//
// Purchase Orders — Assets Only
// Unit price auto-fills from asset catalogue purchase cost.
// Duplicate asset detection with inline warning.
// Full client-side validation mirroring server-side rules.
// SearchDropdown<T> — reusable generic searchable dropdown for asset selection.
// Pagination matches the Licenses page style (Showing X to Y of Z | Prev | Page N of M | Next)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  ChevronDown,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Address {
  attention?: string;
  country?: string;
  addressLine1?: string;
  addressLine2?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  fax?: string;
}
interface Supplier {
  id: number;
  name: string;
  phone?: string;
  gstin?: string;
  email?: string | null;
  paymentTerms?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
}
interface OrganizationAddress {
  id: number;
  name: string;
  attention?: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  phone?: string;
  isDefault?: boolean;
  formatted: string;
}
interface Asset {
  id: number;
  name: string;
  code: string;
  category: string;
  purchasePrice?: number;
  purchaseCost: number;
  sellingPriceInclVat?: number;
  sellingPrice: number;
  purchaseAccount?: string;
  taxRate?: number;
}
interface POItem {
  id?: number;
  itemName: string;
  assetId?: number | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal?: number;
  notes?: string;
  account?: string;
}
interface PurchaseOrder {
  id: number;
  poNumber: string;
  referenceNo?: string;
  orderDate: string;
  expectedDate: string | null;
  supplier: { id: number; name: string };
  deliveryAddressType?: "organization" | "customer";
  deliveryCustomerId?: number | null;
  deliveryCustomer?: { id: number; name: string } | null;
  deliveryAddress?: string;
  shipmentPreference?: string;
  paymentTerms?: string;
  taxExclusive?: boolean;
  taxLevel?: "item" | "transaction";
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  statusDisplay: string;
  notes: string;
  items?: POItem[];
  createdBy?: string;
  createdAt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
function authHdrs(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
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

async function apiMasterFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}/api/masters${path}`, {
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

const fmt = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(v);
const fmtWholeCurrency = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(v);
const assetPurchasePrice = (asset?: Asset | null) =>
  asset?.purchasePrice ?? asset?.purchaseCost ?? 0;
const normalizeWholeNumberInput = (value: string) => {
  const digits = value.replace(/[^\d]/g, "");
  return digits;
};
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
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const normalizeAsset = (asset: Asset): Asset => ({
  ...asset,
});
const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("en-AE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

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

const TAX_LEVEL_OPTIONS = [
  { value: "item", label: "Item Level" },
  { value: "transaction", label: "Transaction Level" },
];

const ORGANIZATION_DELIVERY = {
  name: "Urban Health Food Supplements Trading LLC",
  lines: [
    "WH 06, Plot No 66, Al Wasl",
    "Al Qusais Ind Fourth",
    "Dubai, Dubai",
    "United Arab Emirates",
    "+971 542668865",
  ],
};

const ITEM_GRID =
  "grid min-w-[860px] grid-cols-[minmax(220px,2.3fr)_minmax(124px,1fr)_70px_96px_76px_76px_102px_32px]";

const formatAddress = (addr?: Address) => {
  if (!addr) return "";
  return [
    addr.attention,
    addr.addressLine1 || addr.line1,
    addr.addressLine2 || addr.line2,
    [addr.city, addr.state].filter(Boolean).join(", "),
    addr.zip,
    addr.country,
    addr.phone,
  ]
    .filter(Boolean)
    .join("\n");
};

const organizationDeliveryAddress = () =>
  [ORGANIZATION_DELIVERY.name, ...ORGANIZATION_DELIVERY.lines].join("\n");

const formatOrganizationAddress = (address?: OrganizationAddress | null) =>
  address?.formatted ||
  [
    address?.name,
    address?.attention,
    address?.addressLine1,
    address?.addressLine2,
    [address?.city, address?.state].filter(Boolean).join(", "),
    address?.country,
    address?.zip,
    address?.phone,
  ]
    .filter(Boolean)
    .join("\n");

// ─── UI atoms ─────────────────────────────────────────────────────────────────

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-8.5 px-2.5 rounded-lg border border-border bg-background text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
      p.readOnly && "bg-muted/40 cursor-not-allowed",
      className,
    )}
  />
);
const TxtArea = ({
  className,
  ...p
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...p}
    className={cn(
      "w-full min-h-[72px] px-2.5 py-2 rounded-lg border border-border bg-background text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
      p.readOnly && "bg-muted/40 cursor-not-allowed",
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
      "w-full h-8.5 px-2.5 rounded-lg border border-border bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none",
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

const FormRow = ({
  label,
  required,
  children,
  alignTop = false,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  alignTop?: boolean;
}) => (
  <div
    className={cn(
      "grid grid-cols-1 gap-1.5 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-5",
      alignTop ? "lg:items-start" : "lg:items-center",
    )}
  >
    <label
      className={cn(
        "text-[13px] font-medium lg:pt-0",
        required ? "text-rose-600" : "text-foreground",
      )}
    >
      {label}
      {required && <span className="text-rose-500">*</span>}
    </label>
    <div className="min-w-0">{children}</div>
  </div>
);

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: {
    label: "Draft",
    cls: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
  },
  submitted: {
    label: "Submitted",
    cls: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  },
  approved: {
    label: "Approved",
    cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  },
  partial: {
    label: "Partial",
    cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  received: {
    label: "Received",
    cls: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  },
};
const StatusBadge = ({ status }: { status: string }) => {
  const c = STATUS[status] ?? STATUS.draft;
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

// ─── Row helpers ──────────────────────────────────────────────────────────────

interface ItemRow {
  assetId: string;
  itemName: string;
  account: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  notes: string;
}
const emptyRow = (): ItemRow => ({
  assetId: "",
  itemName: "",
  account: "",
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
    assetId: Number(r.assetId),
    itemName: r.itemName,
    account: r.account,
    quantity: Number(r.quantity || 0),
    unitPrice: Number(r.unitPrice || 0),
    discount: Number(r.discount || 0),
    taxRate: Number(r.taxRate || 0),
    notes: r.notes,
  }));
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface Errors {
  supplierId?: string;
  orderDate?: string;
  items?: string;
  rows: Record<string, string>;
}

function validate(
  supplierId: string,
  orderDate: string,
  rows: ItemRow[],
): Errors {
  const e: Errors = { rows: {} };
  if (!supplierId) e.supplierId = "Supplier is required.";
  if (!orderDate) e.orderDate = "Order date is required.";
  if (rows.length === 0) e.items = "At least one line item is required.";

  const seen: Record<string, number> = {};
  rows.forEach((r, i) => {
    if (!r.assetId) e.rows[`r${i}_asset`] = "Select an asset.";
    if (r.assetId) seen[r.assetId] = (seen[r.assetId] || 0) + 1;
    if (!r.quantity || Number(r.quantity) <= 0)
      e.rows[`r${i}_qty`] = "Qty must be > 0.";
    else if (!Number.isInteger(Number(r.quantity)))
      e.rows[`r${i}_qty`] = "Qty must be a whole number.";
    if (r.unitPrice === "" || Number(r.unitPrice) < 0)
      e.rows[`r${i}_price`] = "Enter a valid price >= 0.";
    const disc = Number(r.discount);
    if (isNaN(disc) || disc < 0 || disc > 100)
      e.rows[`r${i}_disc`] = "Must be 0-100.";
    else if (!Number.isInteger(disc))
      e.rows[`r${i}_disc`] = "Must be a whole number.";
    const tax = Number(r.taxRate);
    if (isNaN(tax) || tax < 0 || tax > 100)
      e.rows[`r${i}_tax`] = "Must be 0-100.";
    else if (!Number.isInteger(tax))
      e.rows[`r${i}_tax`] = "Must be a whole number.";
  });
  rows.forEach((r, i) => {
    if (r.assetId && seen[r.assetId] > 1)
      e.rows[`r${i}_dup`] = "Duplicate asset - merge rows instead.";
  });
  return e;
}
function hasErrors(e: Errors) {
  return !!(
    e.supplierId ||
    e.orderDate ||
    e.items ||
    Object.keys(e.rows).length > 0
  );
}

// =============================================================================
// GENERIC SEARCHABLE DROPDOWN
// =============================================================================

interface DropdownGroup<T> {
  label: string;
  filter: (item: T) => boolean;
}

interface SearchDropdownProps<T extends { id: number | string }> {
  items: T[];
  value: number | string | "";
  onChange: (item: T | null) => void;
  getLabel: (item: T) => string;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  filterFn: (item: T, query: string) => boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  isItemDisabled?: (item: T) => boolean;
  groups?: DropdownGroup<T>[];
}

function SearchDropdown<T extends { id: number | string }>({
  items,
  value,
  onChange,
  getLabel,
  renderItem,
  filterFn,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled = false,
  error = false,
  className,
  isItemDisabled,
  groups,
}: SearchDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selectedItem = useMemo(
    () => items.find((i) => String(i.id) === String(value)) ?? null,
    [items, value],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuRect({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const filtered = useMemo(
    () => (query.trim() ? items.filter((i) => filterFn(i, query)) : items),
    [items, query, filterFn],
  );

  const handleSelect = (item: T) => {
    if (isItemDisabled?.(item)) return;
    onChange(item);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  };

  const renderList = () => {
    if (!groups || groups.length === 0) {
      return filtered.map((item) => {
        const isSelected = String(item.id) === String(value);
        const isDisabled = isItemDisabled?.(item) ?? false;
        return (
          <div
            key={item.id}
            onMouseDown={() => handleSelect(item)}
            className={cn(
              "px-2.5 py-2 cursor-pointer transition-colors rounded-lg mx-1",
              isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent",
              isSelected && "bg-primary/10",
            )}
          >
            {renderItem(item, isSelected)}
          </div>
        );
      });
    }

    return groups.map((group) => {
      const groupItems = filtered.filter(group.filter);
      if (groupItems.length === 0) return null;
      return (
        <div key={group.label}>
          <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {group.label}
          </p>
          {groupItems.map((item) => {
            const isSelected = String(item.id) === String(value);
            const isDisabled = isItemDisabled?.(item) ?? false;
            return (
              <div
                key={item.id}
                onMouseDown={() => handleSelect(item)}
                className={cn(
                  "px-2.5 py-2 cursor-pointer transition-colors rounded-lg mx-1",
                  isDisabled
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-accent",
                  isSelected && "bg-primary/10",
                )}
              >
                {renderItem(item, isSelected)}
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "w-full h-8.5 px-2.5 rounded-lg border bg-background text-[13px] text-left flex items-center justify-between gap-2 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
          error ? "border-rose-400 ring-1 ring-rose-400/30" : "border-border",
          disabled && "opacity-50 cursor-not-allowed",
          open && "ring-2 ring-primary/30 border-primary",
        )}
      >
        <span
          className={cn(
            "truncate",
            selectedItem ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {selectedItem ? getLabel(selectedItem) : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selectedItem && !disabled && (
            <span
              onMouseDown={handleClear}
              className="p-0.5 rounded hover:bg-muted cursor-pointer"
            >
              <X className="w-2.5 h-2.5 text-muted-foreground" />
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-3 h-3 text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {open &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[80] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            style={{
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              maxHeight: Math.max(180, window.innerHeight - menuRect.top - 16),
            }}
          >
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full h-8 pl-8 pr-8 rounded-lg border border-border bg-background text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                {query && (
                  <button
                    onMouseDown={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto py-1 space-y-0.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-xs text-center text-muted-foreground">
                  No results for &quot;{query}&quot;
                </p>
              ) : (
                renderList()
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

const EMPTY_ORG_ADDRESS = {
  name: "",
  attention: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  country: "United Arab Emirates",
  zip: "",
  phone: "",
  isDefault: false,
};

function OrganizationAddressDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (address: OrganizationAddress) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_ORG_ADDRESS });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_ORG_ADDRESS });
    setErrors({});
    setSaving(false);
  }, [open]);

  const set = (
    key: keyof typeof EMPTY_ORG_ADDRESS,
    value: string | boolean,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "Address name is required.";
    if (!form.addressLine1.trim())
      nextErrors.addressLine1 = "Address line 1 is required.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      const address = (await apiMasterFetch("/organization-addresses/", {
        method: "POST",
        body: JSON.stringify(form),
      })) as OrganizationAddress;
      toast({ title: "Organization address created" });
      onSaved(address);
      onClose();
    } catch (err: any) {
      toast({
        title: "Failed to save address",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[720px] rounded-2xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-bold">New Organization Address</h3>
              <p className="text-[11px] text-muted-foreground">
                Save a reusable delivery destination for purchase orders.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Address Name" error={errors.name} required>
            <Inp
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Main Warehouse"
            />
          </Field>
          <Field label="Attention">
            <Inp
              value={form.attention}
              onChange={(e) => set("attention", e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address Line 1" error={errors.addressLine1} required>
              <Inp
                value={form.addressLine1}
                onChange={(e) => set("addressLine1", e.target.value)}
                placeholder="Building, plot, street"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Address Line 2">
              <Inp
                value={form.addressLine2}
                onChange={(e) => set("addressLine2", e.target.value)}
                placeholder="Area, floor, landmark"
              />
            </Field>
          </div>
          <Field label="City">
            <Inp
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <Field label="State / Emirate">
            <Inp
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
            />
          </Field>
          <Field label="Country">
            <Inp
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Inp
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+971..."
            />
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2 rounded-xl border bg-muted/20 p-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set("isDefault", e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Make this the default organization delivery address
          </label>
        </div>

        <div className="flex gap-2.5 border-t px-4 py-3.5">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-xl border text-[13px] font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 flex-1 rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Address
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ORDER FORM DIALOG
// =============================================================================

function OrderFormDialog({
  open,
  onClose,
  onSaved,
  initial,
  suppliers,
  assets,
  organizationAddresses,
  onOrganizationAddressCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: PurchaseOrder | null;
  suppliers: Supplier[];
  assets: Asset[];
  organizationAddresses: OrganizationAddress[];
  onOrganizationAddressCreated: (address: OrganizationAddress) => void;
}) {
  const { selectedFY } = useAuth();
  const isEdit = !!initial;
  const [savingAction, setSavingAction] = useState<"draft" | "send" | null>(
    null,
  );
  const [errors, setErrors] = useState<Errors>({ rows: {} });
  const [supplierId, setSupId] = useState("");
  const [orderDate, setOD] = useState("");
  const [expDate, setED] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [organizationAddressId, setOrganizationAddressId] = useState("");
  const [orgAddressSelectorOpen, setOrgAddressSelectorOpen] = useState(false);
  const [orgAddressDialogOpen, setOrgAddressDialogOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [shipmentPreference, setShipmentPreference] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [taxExclusive, setTaxExclusive] = useState(true);
  const [taxLevel, setTaxLevel] = useState<"item" | "transaction">("item");
  const [notes, setN] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const saving = savingAction !== null;
  const orgAddressSelectorRef = useRef<HTMLDivElement | null>(null);
  const orgAddressToggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({ rows: {} });
    if (initial) {
      setSupId(String(initial.supplier.id));
      setOD(initial.orderDate || "");
      setED(initial.expectedDate || "");
      setReferenceNo(initial.referenceNo || "");
      setDeliveryAddress(
        initial.deliveryAddress || organizationDeliveryAddress(),
      );
      setShipmentPreference(initial.shipmentPreference || "");
      setPaymentTerms(initial.paymentTerms || "");
      setTaxExclusive(initial.taxExclusive ?? true);
      setTaxLevel(initial.taxLevel || "item");
      setN(initial.notes || "");
      setRows(
        (initial.items || []).map((i) => ({
          assetId: i.assetId ? String(i.assetId) : "",
          itemName: i.itemName || "",
          account: i.account || "",
          quantity: String(i.quantity ?? 1),
          unitPrice: String(i.unitPrice ?? 0),
          discount: String(i.discount ?? 0),
          taxRate: String(i.taxRate ?? 0),
          notes: i.notes || "",
        })),
      );
    } else {
      setSupId("");
      setOD(new Date().toISOString().split("T")[0]);
      setED("");
      setReferenceNo("");
      setOrganizationAddressId("");
      setDeliveryAddress(organizationDeliveryAddress());
      setShipmentPreference("");
      setPaymentTerms("");
      setTaxExclusive(true);
      setTaxLevel("item");
      setN("");
      setRows([emptyRow()]);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open || organizationAddresses.length === 0 || organizationAddressId) {
      return;
    }
    const defaultAddress =
      organizationAddresses.find((address) => address.isDefault) ||
      organizationAddresses[0];
    setOrganizationAddressId(String(defaultAddress.id));
    setDeliveryAddress(formatOrganizationAddress(defaultAddress));
  }, [open, organizationAddresses, organizationAddressId]);

  useEffect(() => {
    if (!orgAddressSelectorOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        orgAddressSelectorRef.current?.contains(target) ||
        orgAddressToggleRef.current?.contains(target)
      ) {
        return;
      }
      setOrgAddressSelectorOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [orgAddressSelectorOpen]);

  useEffect(() => {
    if (orgAddressDialogOpen) {
      setOrgAddressSelectorOpen(false);
    }
  }, [orgAddressDialogOpen]);

  const upd = (i: number, p: Partial<ItemRow>) =>
    setRows((r) => {
      const n = [...r];
      n[i] = { ...n[i], ...p };
      return n;
    });

  const handleAssetChange = (idx: number, asset: Asset | null) => {
    const normalizedAsset = asset ? normalizeAsset(asset) : null;
    upd(idx, {
      assetId: normalizedAsset ? String(normalizedAsset.id) : "",
      itemName: normalizedAsset?.name || "",
      unitPrice: normalizedAsset
        ? String(assetPurchasePrice(normalizedAsset))
        : "0",
      account: normalizedAsset?.purchaseAccount || "",
      taxRate:
        normalizedAsset && typeof normalizedAsset.taxRate === "number"
          ? String(normalizedAsset.taxRate)
          : "0",
    });
    setErrors((p) => {
      const n = { ...p.rows };
      delete n[`r${idx}_asset`];
      delete n[`r${idx}_dup`];
      return { ...p, rows: n };
    });
  };

  useEffect(() => {
    if (!supplierId) return;
    const sup = suppliers.find((s) => String(s.id) === String(supplierId));
    if (!sup) return;
    if (sup.paymentTerms) {
      setPaymentTerms(String(sup.paymentTerms));
    }
  }, [supplierId, suppliers]);

  useEffect(() => {
    const selected = organizationAddresses.find(
      (address) => String(address.id) === String(organizationAddressId),
    );
    setDeliveryAddress(
      selected
        ? formatOrganizationAddress(selected)
        : organizationDeliveryAddress(),
    );
  }, [organizationAddressId, organizationAddresses]);

  const save = async (mode: "draft" | "send") => {
    const e = validate(supplierId, orderDate, rows);
    if (hasErrors(e)) {
      setErrors(e);
      toast({
        title: "Please review the purchase order details",
        description:
          "Complete the required fields and fix the highlighted line items before saving.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedFY) {
      toast({
        title: "Select a financial year",
        description: "Please pick a financial year before saving this order.",
        variant: "destructive",
      });
      return;
    }
    if (mode === "send") {
      const sup = suppliers.find((s) => String(s.id) === supplierId);
      if (!sup?.email) {
        toast({
          title: "Supplier email missing",
          description:
            "Add a supplier email before sending this purchase order.",
          variant: "destructive",
        });
        return;
      }
    }
    setSavingAction(mode);
    try {
      const payload = {
        supplierId: Number(supplierId),
        financial_year: selectedFY.id,
        orderDate,
        expectedDate: expDate || null,
        referenceNo,
        deliveryAddressType: "organization",
        deliveryCustomerId: null,
        deliveryAddress,
        shipmentPreference,
        paymentTerms,
        taxExclusive,
        taxLevel,
        notes,
        items: buildPayload(rows),
        submit: mode === "send",
        sendEmail: mode === "send",
      };
      const result = isEdit
        ? await apiFetch(`/orders/${initial!.id}/`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : await apiFetch("/orders/create/", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      toast({
        title:
          mode === "send"
            ? result?.emailSent
              ? "Order sent"
              : "Order saved"
            : isEdit
              ? "Order updated"
              : "Order created",
        description:
          mode === "send" && !result?.emailSent
            ? result?.emailError || result?.message
            : undefined,
        variant:
          mode === "send" && !result?.emailSent ? "destructive" : undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      const fieldErrors = getApiFieldErrors(err);
      const itemErrors = getApiItemErrors(err);
      if (Object.keys(fieldErrors).length || itemErrors.length) {
        setErrors((prev) => ({
          ...prev,
          supplierId: fieldErrors.supplierId || prev.supplierId,
          orderDate: fieldErrors.orderDate || prev.orderDate,
          items: itemErrors.length
            ? "Please correct the highlighted line items."
            : prev.items,
          rows: prev.rows,
        }));
      }
      toast({
        title: "Unable to save the purchase order",
        description: getApiErrorSummary(err),
        variant: "destructive",
      });
    } finally {
      setSavingAction(null);
    }
  };

  const t = useMemo(() => totals(rows), [rows]);
  const selectedOrganizationAddress =
    organizationAddresses.find(
      (address) => String(address.id) === String(organizationAddressId),
    ) || organizationAddresses.find((address) => address.isDefault);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[96vh] sm:max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b sticky top-0 bg-card z-10">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShoppingCart className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold">
                {isEdit ? "Edit Purchase Order" : "New Purchase Order"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Assets only — services billed separately via Purchase Entry
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

        {/* Info banner */}
        <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20">
          <Package className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <p className="text-[11px] leading-5 text-sky-700 dark:text-sky-400">
            Purchase Orders contain <strong>items</strong>. Unit prices
            auto-fill from the item master (purchase cost) — override if needed.{" "}
            <strong>
              Stock is updated only when you click &quot;Receive Package&quot;
              on the linked Purchase Entry.
            </strong>
          </p>
        </div>

        <div className="p-4 space-y-4">
          {/* Meta fields */}
          <div className="rounded-2xl border bg-card p-4 space-y-3.5">
            <FormRow label="Vendor Name" required>
              <div className="relative max-w-[860px]">
                <Sel
                  value={supplierId}
                  onChange={(e) => {
                    setSupId(e.target.value);
                    setErrors((p) => ({ ...p, supplierId: undefined }));
                  }}
                >
                  <option value="">Select a vendor</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
              {errors.supplierId && (
                <p className="mt-1 text-xs text-rose-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {errors.supplierId}
                </p>
              )}
            </FormRow>

            <FormRow label="Delivery Address" required alignTop>
              <div className="max-w-[860px] space-y-3">
                <div className="space-y-3">
                  <div className="max-w-[760px] overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-background via-background to-primary/5 shadow-sm">
                    <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/10">
                          <Building2 className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-semibold text-foreground">
                              {selectedOrganizationAddress?.name ||
                                ORGANIZATION_DELIVERY.name}
                            </p>
                            {selectedOrganizationAddress?.isDefault && (
                              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                            Delivery Destination
                          </p>
                          <div className="mt-1.5 space-y-1 text-[12px] leading-5 text-muted-foreground">
                            {(selectedOrganizationAddress
                              ? formatOrganizationAddress(
                                  selectedOrganizationAddress,
                                )
                                  .split("\n")
                                  .slice(1)
                              : ORGANIZATION_DELIVERY.lines
                            ).map((line, index) => (
                              <p key={`${line}-${index}`}>{line}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        ref={orgAddressToggleRef}
                        type="button"
                        onClick={() => setOrgAddressSelectorOpen((v) => !v)}
                        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
                      >
                        {orgAddressSelectorOpen
                          ? "Close destinations"
                          : "Change destination"}
                      </button>
                    </div>
                    <div className="border-t border-primary/10 bg-primary/[0.03] px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Purchase orders always deliver to your organization
                          location.
                        </span>
                        <span>
                          Select the destination that should receive this order.
                        </span>
                      </div>
                    </div>
                  </div>
                  {orgAddressSelectorOpen && (
                    <div
                      ref={orgAddressSelectorRef}
                      className="max-w-[760px] overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-black/5"
                    >
                      <div className="border-b bg-muted/30 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold text-foreground">
                              Choose Delivery Address
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Pick the organization location that should receive
                              this purchase order.
                            </p>
                          </div>
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                            {organizationAddresses.length} saved
                          </span>
                        </div>
                      </div>
                      <div className="max-h-72 space-y-2 overflow-y-auto p-2.5">
                        {organizationAddresses.map((address) => {
                          const selected =
                            String(address.id) ===
                            String(selectedOrganizationAddress?.id);
                          return (
                            <button
                              key={address.id}
                              type="button"
                              onClick={() => {
                                setOrganizationAddressId(String(address.id));
                                setDeliveryAddress(
                                  formatOrganizationAddress(address),
                                );
                                setOrgAddressSelectorOpen(false);
                              }}
                              className={cn(
                                "w-full rounded-xl border p-2.5 text-left transition-all",
                                selected
                                  ? "border-primary bg-primary/10 shadow-sm"
                                  : "bg-background hover:border-primary/20 hover:bg-muted/30",
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-foreground">
                                      {address.name}
                                    </p>
                                    {address.isDefault && (
                                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-muted-foreground">
                                    {formatOrganizationAddress(address)
                                      .split("\n")
                                      .slice(1)
                                      .map((line, index) => (
                                        <p key={`${address.id}-${index}`}>
                                          {line}
                                        </p>
                                      ))}
                                  </div>
                                </div>
                                {selected && (
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t bg-background/90 p-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setOrgAddressSelectorOpen(false);
                            setOrgAddressDialogOpen(true);
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] p-2.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/10"
                        >
                          <Plus className="h-4 w-4" />
                          New Address
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </FormRow>
            <OrganizationAddressDialog
              open={orgAddressDialogOpen}
              onClose={() => {
                setOrgAddressDialogOpen(false);
                setOrgAddressSelectorOpen(false);
              }}
              onSaved={(address) => {
                onOrganizationAddressCreated(address);
                setOrganizationAddressId(String(address.id));
                setDeliveryAddress(formatOrganizationAddress(address));
                setOrgAddressSelectorOpen(false);
              }}
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-5">
              <div />
              <div className="grid max-w-[1100px] grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Purchase Order #" required>
                    <Inp value={initial?.poNumber || "Auto"} readOnly />
                  </Field>
                  <Field label="Reference #">
                    <Inp
                      value={referenceNo}
                      onChange={(e) => setReferenceNo(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                  <Field label="Date" required error={errors.orderDate}>
                    <Inp
                      type="date"
                      value={orderDate}
                      onChange={(e) => {
                        setOD(e.target.value);
                        setErrors((p) => ({ ...p, orderDate: undefined }));
                      }}
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  <Field label="Delivery Date">
                    <Inp
                      type="date"
                      value={expDate}
                      min={orderDate}
                      onChange={(e) => setED(e.target.value)}
                    />
                  </Field>
                  <Field label="Payment Terms">
                    <div className="relative">
                      <Sel
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                      >
                        <option value="">Select terms</option>
                        {PAYMENT_TERMS_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Sel>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                  <Field label="Shipment Preference">
                    <Inp
                      value={shipmentPreference}
                      onChange={(e) => setShipmentPreference(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>

                <div className="xl:col-span-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Field label="Tax">
                    <div className="relative">
                      <Sel
                        value={taxExclusive ? "exclusive" : "inclusive"}
                        onChange={(e) =>
                          setTaxExclusive(e.target.value === "exclusive")
                        }
                      >
                        <option value="exclusive">Tax Exclusive</option>
                        <option value="inclusive">Tax Inclusive</option>
                      </Sel>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                  <Field label="Tax Level">
                    <div className="relative">
                      <Sel
                        value={taxLevel}
                        onChange={(e) =>
                          setTaxLevel(e.target.value as "item" | "transaction")
                        }
                      >
                        {TAX_LEVEL_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Sel>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          </div>

          <Field label="Notes">
            <TxtArea
              value={notes}
              onChange={(e) => setN(e.target.value)}
              placeholder="Optional"
              className="min-h-[84px]"
            />
          </Field>

          {/* Line items table */}
          <div className="rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-muted/30 border-b rounded-t-2xl">
              <div>
                <p className="text-[15px] font-bold text-foreground">
                  Item Table
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Select catalogue items, verify purchase rate, and adjust tax
                  or discount.
                </p>
                {errors.items && (
                  <p className="text-xs text-rose-500 mt-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {errors.items}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setRows((r) => [...r, emptyRow()]);
                  setErrors((p) => ({ ...p, items: undefined }));
                }}
                className="h-8.5 px-3.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 flex items-center gap-1.5 shadow-sm shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            <div className="overflow-x-auto pb-1">
              {/* Column headers */}
              <div
                className={cn(
                  ITEM_GRID,
                  "gap-2.5 px-4 py-2.5 bg-muted/10 text-[9px] font-bold text-muted-foreground uppercase tracking-[0.16em] border-b",
                )}
              >
                <div>Item Details</div>
                <div>Account</div>
                <div>Qty</div>
                <div>Rate (AED)</div>
                <div>Disc %</div>
                <div>Tax %</div>
                <div>Amount</div>
                <div />
              </div>

              {rows.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No items. Click <strong>Add Item</strong> to begin.
                </div>
              )}

              {rows.map((r, idx) => {
                const selectedAsset = assets.find(
                  (a) => String(a.id) === r.assetId,
                );
                const isDup = errors.rows[`r${idx}_dup`];

                return (
                  <div
                    key={idx}
                    className={cn(
                      ITEM_GRID,
                      "gap-2.5 px-4 py-3 border-b/50 hover:bg-muted/10 items-start",
                      isDup && "bg-amber-500/5",
                    )}
                  >
                    {/* Item SearchDropdown */}
                    <div className="space-y-0.5">
                      <SearchDropdown<Asset>
                        items={assets}
                        value={r.assetId}
                        placeholder="-- Select item --"
                        searchPlaceholder="Search by name or code..."
                        error={!!errors.rows[`r${idx}_asset`]}
                        filterFn={(a, q) => {
                          const lq = q.toLowerCase();
                          return (
                            a.name.toLowerCase().includes(lq) ||
                            a.code.toLowerCase().includes(lq)
                          );
                        }}
                        getLabel={(a) => `[${a.code}] ${a.name}`}
                        renderItem={(a, isSelected) => (
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "text-[13px] font-medium truncate leading-tight",
                                  isSelected
                                    ? "text-primary"
                                    : "text-foreground",
                                )}
                              >
                                {a.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-mono leading-tight">
                                [{a.code}]{a.category ? ` - ${a.category}` : ""}
                              </p>
                            </div>
                            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground shrink-0 mt-0.5">
                              {fmt(assetPurchasePrice(a))}
                            </span>
                          </div>
                        )}
                        onChange={(a) => handleAssetChange(idx, a)}
                      />

                      {errors.rows[`r${idx}_asset`] && (
                        <p className="text-[10px] text-rose-500">
                          {errors.rows[`r${idx}_asset`]}
                        </p>
                      )}
                      {isDup && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {isDup}
                        </p>
                      )}
                      {selectedAsset && (
                        <p className="text-[10px] leading-4 text-muted-foreground">
                          {selectedAsset.category} - Catalogue:{" "}
                          {fmt(assetPurchasePrice(selectedAsset))}
                        </p>
                      )}
                    </div>

                    {/* Account */}
                    <div>
                      <Inp
                        value={r.account}
                        onChange={(e) => upd(idx, { account: e.target.value })}
                        placeholder="Account"
                      />
                    </div>

                    {/* Qty */}
                    <div className="space-y-0.5">
                      <Inp
                        type="number"
                        min="1"
                        step="1"
                        value={r.quantity}
                        onChange={(e) => {
                          upd(idx, {
                            quantity: normalizeWholeNumberInput(e.target.value),
                          });
                          setErrors((p) => {
                            const n = { ...p.rows };
                            delete n[`r${idx}_qty`];
                            return { ...p, rows: n };
                          });
                        }}
                        className={
                          errors.rows[`r${idx}_qty`] ? "border-rose-400" : ""
                        }
                      />
                      {errors.rows[`r${idx}_qty`] && (
                        <p className="text-[10px] text-rose-500">
                          {errors.rows[`r${idx}_qty`]}
                        </p>
                      )}
                    </div>

                    {/* Unit price */}
                    <div className="space-y-0.5">
                      <Inp
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.unitPrice}
                        onChange={(e) => {
                          upd(idx, { unitPrice: e.target.value });
                          setErrors((p) => {
                            const n = { ...p.rows };
                            delete n[`r${idx}_price`];
                            return { ...p, rows: n };
                          });
                        }}
                        className={
                          errors.rows[`r${idx}_price`] ? "border-rose-400" : ""
                        }
                      />
                      {errors.rows[`r${idx}_price`] && (
                        <p className="text-[10px] text-rose-500">
                          {errors.rows[`r${idx}_price`]}
                        </p>
                      )}
                      {selectedAsset &&
                        Number(r.unitPrice) !==
                          assetPurchasePrice(selectedAsset) && (
                          <p className="text-[10px] text-amber-600">
                            ≠ catalogue {fmt(assetPurchasePrice(selectedAsset))}
                          </p>
                        )}
                    </div>

                    {/* Discount */}
                    <div className="space-y-0.5">
                      <Inp
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={r.discount}
                        onChange={(e) => {
                          upd(idx, {
                            discount: normalizeWholeNumberInput(e.target.value),
                          });
                          setErrors((p) => {
                            const n = { ...p.rows };
                            delete n[`r${idx}_disc`];
                            return { ...p, rows: n };
                          });
                        }}
                        className={
                          errors.rows[`r${idx}_disc`] ? "border-rose-400" : ""
                        }
                      />
                      {errors.rows[`r${idx}_disc`] && (
                        <p className="text-[10px] text-rose-500">
                          {errors.rows[`r${idx}_disc`]}
                        </p>
                      )}
                    </div>

                    {/* Tax */}
                    <div className="space-y-0.5">
                      <Inp
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={r.taxRate}
                        onChange={(e) => {
                          upd(idx, {
                            taxRate: normalizeWholeNumberInput(e.target.value),
                          });
                          setErrors((p) => {
                            const n = { ...p.rows };
                            delete n[`r${idx}_tax`];
                            return { ...p, rows: n };
                          });
                        }}
                        className={
                          errors.rows[`r${idx}_tax`] ? "border-rose-400" : ""
                        }
                      />
                      {errors.rows[`r${idx}_tax`] && (
                        <p className="text-[10px] text-rose-500">
                          {errors.rows[`r${idx}_tax`]}
                        </p>
                      )}
                    </div>

                    {/* Line total */}
                    <div className="flex items-center justify-end">
                      <span className="text-[12px] font-semibold tabular-nums">
                        {fmt(rowTotal(r))}
                      </span>
                    </div>

                    {/* Remove row */}
                    <div className="flex items-center justify-center">
                      {rows.length > 1 && (
                        <button
                          onClick={() => {
                            setRows((p) => p.filter((_, i) => i !== idx));
                            setErrors((p) => {
                              const n = { ...p.rows };
                              Object.keys(n)
                                .filter((k) => k.startsWith(`r${idx}_`))
                                .forEach((k) => delete n[k]);
                              return { ...p, rows: n };
                            });
                          }}
                          className="w-6.5 h-6.5 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals panel */}
          <div className="flex justify-stretch sm:justify-end">
            <div className="w-full max-w-[280px] rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 to-background p-3.5 shadow-sm space-y-2">
              <div className="flex justify-between text-[13px] text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{fmt(t.sub)}</span>
              </div>
              <div className="flex justify-between text-[13px] text-muted-foreground">
                <span>Discount</span>
                <span className="tabular-nums text-rose-500">
                  - {fmt(t.disc)}
                </span>
              </div>
              <div className="flex justify-between text-[13px] text-muted-foreground">
                <span>Tax</span>
                <span className="tabular-nums text-emerald-600">
                  + {fmt(t.tax)}
                </span>
              </div>
              <div className="flex justify-between text-[14px] font-bold border-t border-primary/20 pt-2">
                <span>Grand Total</span>
                <span className="text-primary tabular-nums">
                  {fmt(t.total)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground text-right">
                {rows.filter((r) => r.assetId).length} asset(s) —{" "}
                {rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0)}{" "}
                unit(s)
              </p>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 z-10 grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 pb-4 border-t pt-3 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <button
            onClick={onClose}
            className="h-10 rounded-xl border border-border text-[13px] text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => save("draft")}
            disabled={saving}
            className="h-10 rounded-xl border border-border text-[13px] font-semibold hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingAction === "draft" && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            Save Draft
          </button>
          <button
            onClick={() => save("send")}
            disabled={saving}
            className="h-10 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingAction === "send" && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            Save & Send Email
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function OrderDetailPanel({
  order,
  onClose,
  onEdit,
  onApprove,
  onCancel,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onEdit: (order: PurchaseOrder) => void;
  onApprove: (order: PurchaseOrder) => void;
  onCancel: (order: PurchaseOrder) => void;
}) {
  const detailCards = [
    ["Order Date", fmtDate(order.orderDate)],
    ["Delivery Date", fmtDate(order.expectedDate)],
    ["Reference #", order.referenceNo || "-"],
    ["Payment Terms", order.paymentTerms?.replace(/_/g, " ") || "-"],
    ["Shipment Preference", order.shipmentPreference || "-"],
    ["Tax", order.taxExclusive ? "Tax Exclusive" : "Tax Inclusive"],
    [
      "Tax Level",
      order.taxLevel === "transaction" ? "Transaction Level" : "Item Level",
    ],
    ["Total", fmt(order.totalAmount)],
    ["Notes", order.notes || "-"],
    ["Delivery Address", order.deliveryAddress || "-"],
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-[24px] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-[14px] md:text-[15px] font-bold font-mono tracking-tight text-foreground">
              {order.poNumber}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-1">
              {order.supplier.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} />
            {["draft", "submitted"].includes(order.status) && (
              <button
                onClick={() => onEdit(order)}
                className="h-8 px-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] font-semibold text-amber-600 hover:bg-amber-500/15 flex items-center gap-1.5"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
            {!["approved", "received", "cancelled"].includes(order.status) && (
              <button
                onClick={() => onApprove(order)}
                className="h-8 px-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/15 flex items-center gap-1.5"
              >
                <CheckCircle className="w-3 h-3" />
                Approve
              </button>
            )}
            {!["cancelled", "received"].includes(order.status) && (
              <button
                onClick={() => onCancel(order)}
                className="h-8 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/15 flex items-center gap-1.5"
              >
                <XCircle className="w-3 h-3" />
                Cancel
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
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
            {detailCards.map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl bg-muted/25 border border-border p-3",
                  label === "Notes" || label === "Delivery Address"
                    ? "xl:col-span-1 min-h-[108px]"
                    : "min-h-[74px]",
                )}
              >
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.16em] mb-1">
                  {label}
                </p>
                <p
                  className={cn(
                    "text-[11px] leading-5 text-foreground whitespace-pre-line break-words",
                    label === "Total"
                      ? "font-bold text-[13px]"
                      : "font-semibold",
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
          {order.items && order.items.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/35 border-b border-border flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Asset Line Items
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-[12px]">
                  <thead>
                    <tr className="border-b bg-muted/20">
                      {[
                        "Item",
                        "Account",
                        "Qty",
                        "Unit Price",
                        "Disc %",
                        "Tax %",
                        "Total",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-[9px] font-bold text-muted-foreground uppercase tracking-[0.16em] text-left whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((i, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-border/60 hover:bg-muted/20 align-top"
                      >
                        <td className="px-3 py-3.5 min-w-[210px]">
                          <p className="text-[12px] font-semibold leading-5 text-foreground break-words">
                            {i.itemName}
                          </p>
                        </td>
                        <td className="px-3 py-3.5 text-[11px] leading-5 text-muted-foreground min-w-[130px] break-words">
                          {i.account || "-"}
                        </td>
                        <td className="px-3 py-3.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                          {i.quantity}
                        </td>
                        <td className="px-3 py-3.5 text-[11px] tabular-nums whitespace-nowrap">
                          {fmt(i.unitPrice)}
                        </td>
                        <td className="px-3 py-3.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {i.discount}%
                        </td>
                        <td className="px-3 py-3.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {i.taxRate}%
                        </td>
                        <td className="px-3 py-3.5 text-[12px] font-bold text-foreground tabular-nums whitespace-nowrap">
                          {fmt(i.lineTotal ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30">
                      <td
                        colSpan={6}
                        className="px-3 py-3 text-[13px] font-bold text-right text-foreground"
                      >
                        Grand Total
                      </td>
                      <td className="px-3 py-3 text-[13px] font-bold text-primary tabular-nums whitespace-nowrap">
                        {fmt(order.totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

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
        className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h3 className="font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
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

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function PurchaseOrders() {
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

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [organizationAddresses, setOrganizationAddresses] = useState<
    OrganizationAddress[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stFilt, setStFilt] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PurchaseOrder | null>(null);
  const [viewTarget, setViewTarget] = useState<PurchaseOrder | null>(null);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    desc: "",
    btnLabel: "",
    btnCls: "",
    onConfirm: () => {},
    loading: false,
  });

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await apiFetch(withFY("/orders/")));
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [withFY]);

  useEffect(() => {
    fetchOrders();
    apiFetch("/suppliers/")
      .then(setSuppliers)
      .catch(() => {});
    apiFetch("/assets/")
      .then((data) =>
        setAssets(
          Array.isArray(data)
            ? data.map((asset) => normalizeAsset(asset as Asset))
            : [],
        ),
      )
      .catch(() => {});
    apiMasterFetch("/organization-addresses/")
      .then((data) => setOrganizationAddresses(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [fetchOrders]);

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        (!q ||
          o.poNumber.toLowerCase().includes(q) ||
          o.supplier.name.toLowerCase().includes(q)) &&
        (!stFilt || o.status === stFilt),
    );
  }, [orders, search, stFilt]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [search, stFilt, pageSize]);

  // ── Pagination derived values ───────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // "Showing X to Y of Z" values
  const showingFrom = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, filtered.length);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      total: orders.length,
      draft: orders.filter((o) => o.status === "draft").length,
      pending: orders.filter((o) => o.status === "submitted").length,
      approved: orders.filter((o) => ["approved", "partial"].includes(o.status))
        .length,
      received: orders.filter((o) => o.status === "received").length,
      value: orders.reduce((s, o) => s + o.totalAmount, 0),
    }),
    [orders],
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
      fetchOrders();
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
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Asset procurement — approve PO → create Entry → Receive Package →
            stock updated
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Purchase Order
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            label: "Value",
            value: fmtWholeCurrency(stats.value),
            cls: "bg-sky-500/10 text-sky-600 border-sky-500/20",
          },
          {
            label: "Draft",
            value: stats.draft,
            cls: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
          },
          {
            label: "Pending",
            value: stats.pending,
            cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
          },
          {
            label: "Approved",
            value: stats.approved,
            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          },
          {
            label: "Received",
            value: stats.received,
            cls: "bg-teal-500/10 text-teal-600 border-teal-500/20",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={cn(
              "rounded-2xl border p-3 flex items-center gap-2",
              s.cls,
            )}
          >
            <div>
              <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
                {s.label}
              </p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO number or supplier..."
            className="w-full h-9 pl-9 pr-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            value={stFilt}
            onChange={(e) => setStFilt(e.target.value)}
            className="w-40 h-9"
          >
            <option value="">All Status</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="h-9 px-3 rounded-xl border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />{" "}
          Refresh
        </button>
        {(search || stFilt) && (
          <button
            onClick={() => {
              setSearch("");
              setStFilt("");
            }}
            className="h-9 px-3 rounded-xl border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">{error}</p>
          </div>
          <button
            onClick={fetchOrders}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium hover:bg-rose-500/25 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
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

      {/* ── Orders table ────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <ShoppingCart className="w-12 h-12 text-muted-foreground opacity-30" />
              <p className="text-sm font-semibold">No purchase orders found</p>
              {!search && !stFilt && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> New Order
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      {[
                        "PO / Supplier",
                        "Dates",
                        "Items",
                        "Amount",
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
                    {paginatedOrders.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b/50 hover:bg-muted/20 group cursor-pointer"
                        onClick={async () => {
                          const d = await apiFetch(`/orders/${o.id}/`);
                          setViewTarget({ ...o, ...d });
                        }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold font-mono text-xs">
                            {o.poNumber}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {o.supplier.name}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-muted-foreground">
                            Order: {fmtDate(o.orderDate)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Exp: {fmtDate(o.expectedDate)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Package className="w-3 h-3" />{" "}
                            {o.items?.length ?? "-"} asset(s)
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold tabular-nums">
                            {fmt(o.totalAmount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Tax: {fmt(o.taxAmount)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 group-hover:opacity-100 transition-opacity">
                            {/* Edit */}
                            {["draft", "submitted"].includes(o.status) && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const d = await apiFetch(
                                      `/orders/${o.id}/`,
                                    );
                                    setEditTarget({ ...o, ...d });
                                  } catch (err: any) {
                                    toast({
                                      title: "Unable to load purchase order",
                                      description: getApiErrorMessage(err),
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                title="Edit"
                                className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Approve */}
                            {!["approved", "received", "cancelled"].includes(
                              o.status,
                            ) && (
                              <button
                                title="Approve"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirm({
                                    open: true,
                                    loading: false,
                                    title: "Approve Order",
                                    desc: `Approve ${o.poNumber}? Stock updates when you receive goods in Purchase Entries.`,
                                    btnLabel: "Approve",
                                    btnCls:
                                      "bg-emerald-600 hover:bg-emerald-700",
                                    onConfirm: () =>
                                      doAction(
                                        `/orders/${o.id}/approve/`,
                                        "PUT",
                                        "Order approved",
                                        "Approval failed",
                                      ),
                                  });
                                }}
                                className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-500"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Cancel */}
                            {!["cancelled", "received"].includes(o.status) && (
                              <button
                                title="Cancel"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirm({
                                    open: true,
                                    loading: false,
                                    title: "Cancel Order",
                                    desc: `Cancel ${o.poNumber}? This cannot be undone.`,
                                    btnLabel: "Cancel Order",
                                    btnCls: "bg-rose-600 hover:bg-rose-700",
                                    onConfirm: () =>
                                      doAction(
                                        `/orders/${o.id}/cancel/`,
                                        "PUT",
                                        "Order cancelled",
                                        "Cancel failed",
                                      ),
                                  });
                                }}
                                className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Pagination footer — matches Licenses page style ─────────── */}
              <div className="px-4 py-3 border-t bg-muted/20 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                {/* Left: "Showing X to Y of Z licenses" */}
                <span>
                  Showing{" "}
                  <strong className="text-foreground">{showingFrom}</strong>
                  {" to "}
                  <strong className="text-foreground">{showingTo}</strong>
                  {" of "}
                  <strong className="text-foreground">{filtered.length}</strong>
                  {" purchase order"}
                  {filtered.length !== 1 ? "s" : ""}
                </span>

                {/* Right: Prev | Page N of M | Next */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span>Rows</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-10 w-[110px] rounded-2xl border bg-background px-4 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-3 rounded-lg border text-xs disabled:opacity-40 hover:bg-accent flex items-center gap-1"
                  >
                    ‹ Prev
                  </button>

                  <span className="px-2 text-xs font-medium text-foreground">
                    Page {page} of {totalPages}
                  </span>

                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8 px-3 rounded-lg border text-xs disabled:opacity-40 hover:bg-accent flex items-center gap-1"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Dialogs — rendered OUTSIDE the table, at root level ────────────── */}
      <OrderFormDialog
        open={formOpen || !!editTarget}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        onSaved={fetchOrders}
        initial={editTarget}
        suppliers={suppliers}
        assets={assets}
        organizationAddresses={organizationAddresses}
        onOrganizationAddressCreated={(address) =>
          setOrganizationAddresses((prev) => {
            const withoutDuplicate = prev.filter(
              (item) => item.id !== address.id,
            );
            const next = address.isDefault
              ? withoutDuplicate.map((item) => ({ ...item, isDefault: false }))
              : withoutDuplicate;
            return [address, ...next];
          })
        }
      />

      {viewTarget && (
        <OrderDetailPanel
          order={viewTarget}
          onClose={() => setViewTarget(null)}
          onEdit={(order) => {
            setViewTarget(null);
            setEditTarget(order);
          }}
          onApprove={(order) =>
            setConfirm({
              open: true,
              loading: false,
              title: "Approve Order",
              desc: `Approve ${order.poNumber}? Stock updates when you receive goods in Purchase Entries.`,
              btnLabel: "Approve",
              btnCls: "bg-emerald-600 hover:bg-emerald-700",
              onConfirm: () =>
                doAction(
                  `/orders/${order.id}/approve/`,
                  "PUT",
                  "Order approved",
                  "Approval failed",
                ),
            })
          }
          onCancel={(order) =>
            setConfirm({
              open: true,
              loading: false,
              title: "Cancel Order",
              desc: `Cancel ${order.poNumber}? This cannot be undone.`,
              btnLabel: "Cancel Order",
              btnCls: "bg-rose-600 hover:bg-rose-700",
              onConfirm: () =>
                doAction(
                  `/orders/${order.id}/cancel/`,
                  "PUT",
                  "Order cancelled",
                  "Cancel failed",
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
