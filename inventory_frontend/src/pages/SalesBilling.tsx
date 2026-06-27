// src/pages/SalesBilling.tsx
//
// Layout:
//   ① Sticky top bar (back + title + save button)
//   ② TOP SECTION — two columns: [Customer/Invoice form] | [Invoice Summary sidebar, sticky]
//   ③ ITEM TABLE — FULL WIDTH, all 9 columns always visible:
//       Item Details | Batch No | Expiry Date | Qty | Rate | Discount | Tax | Amount | ×
//   ④ AMOUNT SUMMARY — inside item table card, bottom-right (Sub Total / Discount / Tax / Total)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  FileText,
  Loader2,
  Package,
  Plus,
  Save,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  getApiErrorMessage,
  getApiErrorSummary,
  getApiFieldErrors,
  getApiItemErrors,
} from "@/lib/apiErrors";
import { useAuth } from "@/contexts/AuthContext";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  outstanding: number;
  creditLimit: number;
  paymentTerms?: string;
}
interface AssetBatchOption {
  batchId: number;
  batchNumber: string;
  expiryDate?: string | null;
  availableQty: number;
  warehouseId: number;
  warehouseName: string;
}
interface AssetOption {
  id: number;
  name: string;
  code: string;
  category: string;
  assetType: string;
  sellingPrice: number;
  purchaseCost: number;
  availableStock: number;
  batchNumber?: string;
  expiryDate?: string | null;
  warehouses: {
    warehouseId: number;
    warehouseName: string;
    available: number;
  }[];
  batches: AssetBatchOption[];
}
interface SalespersonOption {
  id: number;
  name: string;
  email: string;
  department: string;
}

type ItemType = "asset";
type DiscountType = "amount" | "percent";
type VatChoice = "5" | "0" | "new" | "custom";

interface ItemRow {
  _key: string;
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
  subtotal: number;
  discAmount: number;
  taxAmount: number;
  amountPerUnit: number;
  netAmount: number;
  lineTotal: number;
  availableStock?: number;
  batchAvailableStock?: number;
  batchGroupKey: string;
}

interface FormErrors {
  customer?: string;
  invDate?: string;
  items?: string;
  rows: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
async function apiFetchUsers(path: string) {
  const res = await fetch(`${API_URL}/api/users${path}`, {
    headers: authHdrs(),
  });
  if (res.status === 401) {
    window.sessionStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const body = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(body?.error ?? "Request failed"), {
      status: res.status,
      body,
    });
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

function compute(r: ItemRow): ItemRow {
  const qty = Number(r.quantity) || 0;
  const price = Number(r.rspWithoutVat) || 0;
  const rawDisc = Number(r.discount) || 0;
  const discPerUnit =
    r.discountType === "percent"
      ? (price * Math.min(rawDisc, 100)) / 100
      : Math.min(rawDisc, price);
  const netPerUnit = Math.max(price - discPerUnit, 0);
  const sub = qty * price;
  const disc = qty * discPerUnit;
  const net = qty * netPerUnit;
  const tax = (net * (Number(r.taxRate) || 0)) / 100;
  return {
    ...r,
    amountPerUnit: round2(netPerUnit),
    subtotal: round2(sub),
    discAmount: round2(disc),
    netAmount: round2(net),
    taxAmount: round2(tax),
    lineTotal: round2(net),
  };
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function normalizeDateInput(value: unknown) {
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
}
function addDaysToIsoDate(value: string, days: number) {
  const base = normalizeDateInput(value);
  if (!base) return "";
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function endOfMonthIsoDate(value: string) {
  const base = normalizeDateInput(value);
  if (!base) return "";
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
}
function dueDateFromPaymentTerms(invoiceDate: string, paymentTerms?: string) {
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
}
function normalizeVatInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(Number(digits), 100));
}
function normalizeWholeNumberInput(value: string, max?: number) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits);
  return String(typeof max === "number" ? Math.min(n, max) : n);
}
function makeKey() {
  return Math.random().toString(36).slice(2);
}
function rowQty(row: ItemRow) {
  return Number(row.quantity) || 0;
}
function buildBatchSplitRows(
  baseRow: ItemRow,
  asset: AssetOption,
  requestedQty: number,
  existingRows: ItemRow[],
) {
  const groupKey = baseRow.batchGroupKey || existingRows[0]?._key || makeKey();
  const rows: ItemRow[] = [];
  const batches =
    asset.batches?.length > 0
      ? asset.batches
      : [
          {
            batchId: 0,
            batchNumber: asset.batchNumber || "",
            expiryDate: asset.expiryDate || null,
            availableQty: asset.availableStock,
            warehouseId: 0,
            warehouseName: "",
          },
        ];
  let remaining = Math.min(Math.max(requestedQty, 0), asset.availableStock);

  for (const batch of batches) {
    if (remaining <= 0) break;
    const availableQty = Number(batch.availableQty) || 0;
    if (availableQty <= 0) continue;
    const allocatedQty = Math.min(availableQty, remaining);
    const seedRow = existingRows[rows.length];
    rows.push(
      compute({
        ...baseRow,
        _key: seedRow?._key || makeKey(),
        batchGroupKey: groupKey,
        batchNumber: batch.batchNumber || "",
        expiryDate: normalizeDateInput(batch.expiryDate),
        quantity: String(allocatedQty),
        availableStock: asset.availableStock,
        batchAvailableStock: availableQty,
      }),
    );
    remaining -= allocatedQty;
  }

  if (rows.length > 0) {
    return rows;
  }

  return [
    compute({
      ...baseRow,
      _key: existingRows[0]?._key || baseRow._key || makeKey(),
      batchGroupKey: groupKey,
      batchNumber: asset.batchNumber || "",
      expiryDate: normalizeDateInput(asset.expiryDate),
      quantity: baseRow.quantity,
      availableStock: asset.availableStock,
      batchAvailableStock: asset.availableStock,
    }),
  ];
}
function emptyRow(): ItemRow {
  return {
    _key: makeKey(),
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
    discountType: "percent",
    discount: "0",
    taxRate: "5",
    notes: "",
    subtotal: 0,
    discAmount: 0,
    taxAmount: 0,
    amountPerUnit: 0,
    netAmount: 0,
    lineTotal: 0,
    batchGroupKey: makeKey(),
  };
}
const fmt = (n: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(n);

const PAGE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function validateForm(
  customer: Customer | null,
  invDate: string,
  rows: ItemRow[],
): FormErrors {
  const e: FormErrors = { rows: {} };
  const seenAssetGroups = new Map<string, string>();
  const firstRowIndexByAsset = new Map<string, number>();
  if (!customer) e.customer = "Customer is required.";
  if (!invDate) e.invDate = "Invoice date is required.";
  if (!rows.length) e.items = "Add at least one item.";
  rows.forEach((r, i) => {
    if (r.type === "asset") {
      const maxAvailable = r.batchAvailableStock ?? r.availableStock;
      if (!r.assetId) {
        e.rows[`r${i}_item`] = "Select an item.";
      } else {
        const existingGroup = seenAssetGroups.get(r.assetId);
        if (!existingGroup) {
          seenAssetGroups.set(r.assetId, r.batchGroupKey);
          firstRowIndexByAsset.set(r.assetId, i);
        } else if (existingGroup !== r.batchGroupKey) {
          const firstIndex = firstRowIndexByAsset.get(r.assetId);
          const message = "This item is already added to the invoice.";
          if (typeof firstIndex === "number") {
            e.rows[`r${firstIndex}_item`] =
              e.rows[`r${firstIndex}_item`] || message;
          }
          e.rows[`r${i}_item`] = message;
        }
      }
      if (
        maxAvailable !== undefined &&
        (Number(r.quantity) || 0) > maxAvailable
      )
        e.rows[`r${i}_qty`] = `Only ${maxAvailable} in stock.`;
    }
    const qty = Number(r.quantity) || 0;
    if (!Number.isInteger(qty))
      e.rows[`r${i}_qty`] = "Qty must be a whole number.";
    else if (qty <= 0) e.rows[`r${i}_qty`] = e.rows[`r${i}_qty`] || "Qty > 0.";
    const d = Number(r.discount) || 0;
    if (!Number.isInteger(d))
      e.rows[`r${i}_disc`] = "Discount must be a whole number.";
    else if (d < 0) e.rows[`r${i}_disc`] = "Discount ≥ 0.";
    else if (r.discountType === "percent" && d > 100)
      e.rows[`r${i}_disc`] = "Max 100%.";
    const t = Number(r.taxRate) || 0;
    if (!Number.isInteger(t))
      e.rows[`r${i}_tax`] = "Tax must be a whole number.";
    else if (t < 0 || t > 100) e.rows[`r${i}_tax`] = "Tax 0–100.";
  });
  return e;
}
function hasErrors(e: FormErrors) {
  return !!(e.customer || e.invDate || e.items || Object.keys(e.rows).length);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLE TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const INP =
  "w-full h-8 px-2.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-colors";
const SEL =
  "w-full h-8 px-2 rounded-md border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-colors appearance-none";
const LBL =
  "block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1";

// ─────────────────────────────────────────────────────────────────────────────
// TABLE COLUMN GRID
// 9 columns — MUST match between header and every row
// ─────────────────────────────────────────────────────────────────────────────
//  [Item Details]  [Batch]  [Expiry]  [Qty]  [Rate]  [Discount]  [Tax]  [Amount]  [×]
const GRID =
  "grid grid-cols-[minmax(210px,2fr)_82px_96px_58px_92px_98px_118px_96px_72px_76px_24px]";

// ─────────────────────────────────────────────────────────────────────────────
// FIELD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={LBL}>
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[10px] text-rose-500 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER PICKER
// ─────────────────────────────────────────────────────────────────────────────

function CustomerPicker({
  customers,
  selected,
  onSelect,
  error,
  onSearch,
  onLoadMore,
  hasMore,
  loading,
}: {
  customers: Customer[];
  selected: Customer | null;
  onSelect: (c: Customer | null) => void;
  error?: string;
  onSearch?: (q: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const list = onSearch
    ? customers
    : customers.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.phone.includes(q),
      );

  useEffect(() => {
    if (!onSearch || !open) return;
    const t = setTimeout(() => onSearch(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q, onSearch, open]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className={LBL}>
        Customer<span className="text-rose-500 ml-0.5">*</span>
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-8 px-2.5 rounded-md border bg-background text-sm text-left flex items-center justify-between transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25",
          error ? "border-rose-400" : "border-border",
          open && "border-primary ring-2 ring-primary/25",
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground truncate">
              {selected.name}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/70 flex items-center gap-2">
            <User className="w-3.5 h-3.5" />
            Select customer…
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
      </button>
      {error && (
        <p className="mt-1 text-[10px] text-rose-500 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" />
          {error}
        </p>
      )}

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[280px] bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search customers…"
                className="w-full h-7 pl-7 pr-3 rounded border border-border bg-background text-xs focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
                setQ("");
              }}
              className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 flex items-center gap-2"
            >
              <User className="w-3 h-3" />
              Walk-in Customer
            </button>
            {loading && list.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">
                Loading…
              </p>
            )}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setQ("");
                }}
                className={cn(
                  "w-full px-3 py-2 text-left hover:bg-muted/40 transition-colors",
                  selected?.id === c.id && "bg-primary/5",
                )}
              >
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {c.phone}
                  {c.gstin ? ` · TRN: ${c.gstin}` : ""}
                </p>
                {c.outstanding > 0 && (
                  <p className="text-[10px] text-amber-600 font-medium">
                    Outstanding: {fmt(c.outstanding)}
                  </p>
                )}
              </button>
            ))}
            {!loading && list.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">
                No customers found
              </p>
            )}
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full py-2 text-xs text-center text-primary hover:bg-muted/40 border-t border-border"
              >
                {loading ? "Loading…" : "Load more →"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM SEARCH DROPDOWN (inside table Item Details cell)
// ─────────────────────────────────────────────────────────────────────────────

function ItemCellDropdown({
  row,
  assets,
  blockedAssetIds,
  hasError,
  onSelectAsset,
  onAssetSearch,
  onLoadMoreAssets,
  assetHasMore,
  assetLoading,
}: {
  row: ItemRow;
  assets: AssetOption[];
  blockedAssetIds: string[];
  hasError?: boolean;
  onSelectAsset: (a: AssetOption) => void;
  onAssetSearch: (q: string) => void;
  onLoadMoreAssets: () => void;
  assetHasMore: boolean;
  assetLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const closeDropdown = () => {
    setOpen(false);
    setQ("");
    onAssetSearch("");
  };

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onAssetSearch(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q, open, onAssetSearch]);

  useEffect(() => {
    if (!open) return;
    const syncPanel = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelStyle({
        top: rect.bottom + 10,
        left: rect.left,
        width: Math.max(rect.width, 460),
      });
    };
    syncPanel();
    window.addEventListener("resize", syncPanel);
    window.addEventListener("scroll", syncPanel, true);
    return () => {
      window.removeEventListener("resize", syncPanel);
      window.removeEventListener("scroll", syncPanel, true);
    };
  }, [open]);

  const selAsset = assets.find((a) => String(a.id) === row.assetId) ?? null;
  const selectedAssetDisplay =
    selAsset ??
    (row.assetId
      ? {
          id: Number(row.assetId),
          name: row.itemName || "Selected asset",
          availableStock: row.availableStock ?? 0,
        }
      : null);
  const visibleAssets = assets.filter(
    (asset) =>
      String(asset.id) === row.assetId ||
      !blockedAssetIds.includes(String(asset.id)),
  );

  return (
    <div ref={ref} className="relative min-w-0 w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) {
            closeDropdown();
            return;
          }
          setQ("");
          onAssetSearch("");
          setOpen(true);
        }}
        className={cn(
          "w-full h-8 px-2 rounded border bg-background text-xs text-left flex items-center gap-1.5 transition-colors hover:border-primary/50",
          hasError ? "border-rose-400" : "border-border",
          open && "border-primary ring-1 ring-primary/30",
        )}
      >
        {selectedAssetDisplay ? (
          <>
            <Package className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="truncate font-medium text-foreground">
              {selectedAssetDisplay.name}
            </span>
            <span
              className={cn(
                "ml-auto text-[10px] font-bold shrink-0",
                selectedAssetDisplay.availableStock <= 0
                  ? "text-rose-500"
                  : selectedAssetDisplay.availableStock <= 5
                    ? "text-amber-500"
                    : "text-emerald-600",
              )}
            >
              {selectedAssetDisplay.availableStock}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground/60 text-xs flex items-center gap-1">
            <Package className="w-3 h-3" />
            Click to select asset...
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 ml-auto" />
      </button>

      {open &&
        panelStyle &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-[90] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            style={{
              top: panelStyle.top,
              left: panelStyle.left,
              width: Math.min(
                panelStyle.width,
                Math.max(window.innerWidth - panelStyle.left - 24, 320),
              ),
            }}
          >
            <div className="p-2 border-b border-border bg-muted/20">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search assets..."
                  className="w-full h-7 pl-7 pr-3 rounded border border-border bg-background text-xs focus:outline-none"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground bg-muted/20">
                Assets
              </div>
              {assetLoading && visibleAssets.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  Loading...
                </p>
              ) : visibleAssets.length > 0 ? (
                visibleAssets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onSelectAsset(a);
                      closeDropdown();
                    }}
                    className={cn(
                      "w-full px-3 py-3 text-left hover:bg-primary/5 border-b border-border/30 last:border-0 transition-colors",
                      String(row.assetId) === String(a.id) && "bg-primary/8",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground break-words leading-5">
                          {a.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 leading-4">
                          SKU: {a.code} · RSP Incl VAT: AED{" "}
                          {a.sellingPrice.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-[0.14em]">
                          Stock on Hand
                        </p>
                        <p
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            a.availableStock <= 5
                              ? "text-amber-500"
                              : "text-emerald-600",
                          )}
                        >
                          {a.availableStock.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {a.warehouses.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1 leading-4">
                        {a.warehouses
                          .map((w) => `${w.warehouseName}: ${w.available}`)
                          .join(" · ")}
                      </p>
                    )}
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  No assets available
                </p>
              )}

              {assetHasMore && (
                <button
                  type="button"
                  onClick={onLoadMoreAssets}
                  className="w-full py-2 text-xs text-center text-primary hover:bg-muted/40 border-t border-border"
                >
                  {assetLoading ? "Loading..." : "Load more ->"}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE HEADER ROW  (must use same GRID as LineItemRow)
// ─────────────────────────────────────────────────────────────────────────────

function TableHeader() {
  const h =
    "text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground select-none";
  return (
    <div
      className={cn(
        GRID,
        "px-3 py-2 bg-muted/50 border-b border-border gap-x-1.5 items-center",
      )}
    >
      <div className={h}>Item Details</div>
      <div className={cn(h, "text-center leading-snug")}>
        Batch
        <br />
        No.
      </div>
      <div className={cn(h, "text-center")}>Expiry Date</div>
      <div className={cn(h, "text-right")}>Qty</div>
      <div className={cn(h, "text-right leading-snug")}>
        RSP Incl
        <br />
        <span className="font-normal normal-case text-[9px]">VAT</span>
      </div>
      <div className={cn(h, "text-right leading-snug")}>
        RSP Without
        <br />
        <span className="font-normal normal-case text-[9px]">VAT</span>
      </div>
      <div className={cn(h, "text-center")}>Discount</div>
      <div className={cn(h, "text-right leading-snug")}>
        Amount
        <br />
        <span className="font-normal normal-case text-[9px]">/ Unit</span>
      </div>
      <div className={cn(h, "text-center")}>VAT %</div>
      <div className={cn(h, "text-right")}>Amount</div>
      <div />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE ITEM ROW
// ─────────────────────────────────────────────────────────────────────────────

function LineItemRow({
  row,
  idx,
  assets,
  blockedAssetIds,
  errors,
  onChange,
  onRemove,
  canRemove,
  appliedVatRate,
  isCustomVat,
  customVatRate,
  onAssetSearch,
  onLoadMoreAssets,
  assetHasMore,
  assetLoading,
  maxQuantity,
  groupRowCount,
}: {
  row: ItemRow;
  idx: number;
  assets: AssetOption[];
  blockedAssetIds: string[];
  errors: FormErrors;
  onChange: (p: Partial<ItemRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
  appliedVatRate: number;
  isCustomVat: boolean;
  customVatRate: string;
  onAssetSearch: (q: string) => void;
  onLoadMoreAssets: () => void;
  assetHasMore: boolean;
  assetLoading: boolean;
  maxQuantity?: number;
  groupRowCount: number;
}) {
  const upd = (patch: Partial<ItemRow>) => {
    const m = { ...row, ...patch };
    onChange({ ...patch, ...compute(m) });
  };

  const onAssetSel = (a: AssetOption) => {
    if (blockedAssetIds.includes(String(a.id))) {
      toast({
        title: "Item already added",
        description:
          "This item is already in the invoice. Update its existing row instead of adding it again.",
        variant: "destructive",
      });
      return;
    }
    const tr = isCustomVat
      ? Number(normalizeVatInput(customVatRate || row.taxRate)) || 0
      : appliedVatRate;
    const inclVat = a.sellingPrice;
    const exclVat = tr > 0 ? inclVat / (1 + tr / 100) : inclVat;
    upd({
      type: "asset",
      assetId: String(a.id),
      serviceId: "",
      itemName: a.name,
      rspInclVat: inclVat.toFixed(2),
      rspWithoutVat: exclVat.toFixed(2),
      taxRate: String(tr),
      discount: "0",
      discountType: "percent",
      availableStock: a.availableStock,
      batchNumber: "",
      expiryDate: "",
      batchAvailableStock: undefined,
    });
  };

  const ie = errors.rows[`r${idx}_item`];
  const qe = errors.rows[`r${idx}_qty`];
  const de = errors.rows[`r${idx}_disc`];
  const te = errors.rows[`r${idx}_tax`];
  const vatRate = isCustomVat ? row.taxRate : String(appliedVatRate);

  const setLineVatRate = (value: string) => {
    const normalized = normalizeVatInput(value);
    const nextRate = Number(normalized) || 0;
    const incl = Number(row.rspInclVat) || 0;
    const excl = nextRate > 0 ? incl / (1 + nextRate / 100) : incl;
    upd({
      taxRate: normalized,
      rspWithoutVat: excl.toFixed(2),
    });
  };

  return (
    <div
      className={cn(
        "relative border-b border-border/50 last:border-0 group transition-colors",
        ie || qe || de || te ? "bg-rose-500/4" : "hover:bg-muted/20",
      )}
    >
      <div className={cn(GRID, "px-3 py-2 gap-x-1.5 items-start")}>
        {/* ① Item Details */}
        <div className="flex flex-col gap-1 min-w-0">
          <ItemCellDropdown
            row={row}
            assets={assets}
            blockedAssetIds={blockedAssetIds}
            hasError={!!ie}
            onSelectAsset={onAssetSel}
            onAssetSearch={onAssetSearch}
            onLoadMoreAssets={onLoadMoreAssets}
            assetHasMore={assetHasMore}
            assetLoading={assetLoading}
          />
          <input
            value={row.itemDescription}
            onChange={(e) => upd({ itemDescription: e.target.value })}
            placeholder="Description (optional)"
            className="h-5 w-full px-1.5 rounded border border-transparent bg-transparent text-[10px] text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-border focus:bg-background transition-colors"
          />
          {ie && (
            <p className="text-[10px] text-rose-500 flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" />
              {ie}
            </p>
          )}
          {groupRowCount > 1 && (
            <p className="text-[10px] text-sky-600">
              Auto split by expiry batch in this invoice.
            </p>
          )}
          {row.type === "asset" &&
            (row.availableStock ?? 0) <= 5 &&
            (row.availableStock ?? 0) > 0 && (
              <p className="text-[10px] text-amber-600 flex items-center gap-0.5">
                <AlertTriangle className="w-2.5 h-2.5" />
                Low stock: {row.availableStock} left
              </p>
            )}
        </div>

        {/* ② Batch Number */}
        <div>
          <input
            value={row.batchNumber}
            readOnly
            disabled
            placeholder="—"
            className={cn(
              INP,
              "h-7 px-2 text-center text-[11px] bg-muted/30 text-muted-foreground cursor-not-allowed",
            )}
          />
        </div>

        {/* ③ Expiry Date */}
        <div>
          <input
            type="date"
            value={row.expiryDate}
            readOnly
            disabled
            className={cn(
              INP,
              "h-7 px-2 text-[11px] bg-muted/30 text-muted-foreground cursor-not-allowed",
            )}
          />
        </div>

        {/* ④ Qty */}
        <div>
          <input
            type="text"
            inputMode="numeric"
            value={row.quantity}
            onChange={(e) =>
              upd({
                quantity: normalizeWholeNumberInput(e.target.value, maxQuantity),
              })
            }
            className={cn(
              INP,
              "h-7 px-2 text-right text-[11px] tabular-nums",
              qe && "border-rose-400",
            )}
          />
          {qe && (
            <p className="text-[10px] text-rose-500 text-right mt-0.5">{qe}</p>
          )}
        </div>

        {/* ⑤ RSP incl VAT */}
        <div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={row.rspInclVat}
            readOnly
            disabled
            className={cn(
              INP,
              "h-7 px-2 text-right text-[11px] tabular-nums bg-muted/30 text-muted-foreground cursor-not-allowed",
            )}
          />
        </div>

        {/* ⑥ RSP without VAT */}
        <div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={row.rspWithoutVat}
            readOnly
            disabled
            className={cn(
              INP,
              "h-7 px-2 text-right text-[11px] tabular-nums bg-muted/30 text-muted-foreground cursor-not-allowed",
            )}
          />
        </div>

        {/* ⑦ Discount */}
        <div className="flex gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={row.discount}
            onChange={(e) =>
              upd({
                discount: normalizeWholeNumberInput(
                  e.target.value,
                  row.discountType === "percent" ? 100 : undefined,
                ),
              })
            }
            className={cn(
              INP,
              "h-7 px-2 text-right text-[11px] tabular-nums flex-1 w-0",
              de && "border-rose-400",
            )}
          />
          <div className="relative shrink-0">
            <select
              value={row.discountType}
              onChange={(e) =>
                upd({ discountType: e.target.value as DiscountType })
              }
              className={cn(SEL, "h-7 w-[40px] text-[11px] px-1 text-center")}
            >
              <option value="percent">%</option>
              <option value="amount">AED</option>
            </select>
            <ChevronDown className="absolute right-0.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none text-muted-foreground" />
          </div>
        </div>

        {/* ⑧ Amount / Unit */}
        <div>
          <input
            value={row.amountPerUnit.toFixed(2)}
            readOnly
            className={cn(
              INP,
              "h-7 px-2 text-right text-[11px] tabular-nums bg-muted/30",
            )}
          />
        </div>

        {/* ⑨ VAT */}
        <div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              value={vatRate}
              readOnly={!isCustomVat}
              disabled={!isCustomVat}
              onChange={(e) => setLineVatRate(e.target.value)}
              className={cn(
                INP,
                "h-7 px-2 text-right text-[11px] tabular-nums flex-1 w-0",
                !isCustomVat &&
                  "bg-muted/30 text-muted-foreground cursor-not-allowed",
                te && "border-rose-400",
              )}
            />
            <span className="text-xs text-muted-foreground shrink-0">%</span>
          </div>
          {te && <p className="text-[10px] text-rose-500 mt-0.5">{te}</p>}
        </div>

        {/* ⑩ Amount */}
        <div className="text-right pt-0.5">
          <p className="text-[15px] font-bold text-foreground tabular-nums">
            {row.netAmount.toFixed(2)}
          </p>
          <p className="text-[9px] text-muted-foreground tabular-nums leading-tight">
            {row.amountPerUnit.toFixed(2)} x {Number(row.quantity) || 0}
          </p>
        </div>

        {/* ⑪ Delete */}
        <div className="flex items-start justify-center pt-0.5">
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              aria-label="Delete line item"
              title="Delete line item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════════════════════

export default function SalesBilling() {
  const { selectedFY } = useAuth();
  const navigate = useNavigate();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [salespersons, setSalespersons] = useState<SalespersonOption[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [custQuery, setCustQuery] = useState("");
  const [custPage, setCustPage] = useState(1);
  const [custMore, setCustMore] = useState(false);
  const [custLoading, setCustLoading] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetPage, setAssetPage] = useState(1);
  const [assetMore, setAssetMore] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);

  // ── Form ──────────────────────────────────────────────────────────────────
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [selectedSalesperson, setSelectedSalesperson] =
    useState<SalespersonOption | null>(null);
  const [invDate, setInvDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [dueDate, setDueDate] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [vatChoice, setVatChoice] = useState<VatChoice>("5");
  const [newVatRate, setNewVatRate] = useState("5");
  const [customVatRate, setCustomVatRate] = useState("5");
  const [offerEnabled, setOfferEnabled] = useState(false);
  const [offerText, setOfferText] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [errors, setErrors] = useState<FormErrors>({ rows: {} });
  const [savingAction, setSavingAction] = useState<"draft" | "confirm" | null>(
    null,
  );
  const [srvErrors, setSrvErrors] = useState<string[]>([]);

  // ── Fetch helpers ─────────────────────────────────────────────────────────
  const fetchCustomers = useCallback(
    async (q: string, page: number, append: boolean) => {
      setCustLoading(true);
      try {
        const p = new URLSearchParams();
        if (q) p.set("search", q);
        p.set("page", String(page));
        p.set("page_size", String(PAGE));
        const data = await apiFetch(`/customers/?${p}`);
        const list = Array.isArray(data) ? data : ((data as any).results ?? []);
        const tp = (data as any).total_pages ?? 1;
        setCustomers((prev) => (append ? [...prev, ...list] : list));
        setCustMore(page < tp);
      } catch {
        /* handled by toast in apiFetch */
      } finally {
        setCustLoading(false);
      }
    },
    [],
  );

  const fetchAssets = useCallback(
    async (q: string, page: number, append: boolean) => {
      setAssetLoading(true);
      try {
        const p = new URLSearchParams();
        if (q) p.set("search", q);
        p.set("page", String(page));
        p.set("page_size", String(PAGE));
        const data = await apiFetch(`/assets/?${p}`);
        const list = Array.isArray(data) ? data : ((data as any).results ?? []);
        const tp = (data as any).total_pages ?? 1;
        setAssets((prev) => (append ? [...prev, ...list] : list));
        setAssetMore(page < tp);
      } catch {
      } finally {
        setAssetLoading(false);
      }
    },
    [],
  );

  const initialLoad = useRef(true);
  useEffect(() => {
    fetchCustomers(custQuery, custPage, custPage > 1);
  }, [custQuery, custPage]);
  useEffect(() => {
    fetchAssets(assetQuery, assetPage, assetPage > 1);
  }, [assetQuery, assetPage]);
  useEffect(() => {
    apiFetchUsers("/users/?role=salesperson&isActive=true")
      .then(setSalespersons)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!initialLoad.current) return;
    if (!custLoading && !assetLoading) {
      setLoading(false);
      initialLoad.current = false;
    }
  }, [custLoading, assetLoading]);

  useEffect(() => {
    if (!selectedCust || !invDate || dueDateTouched) return;
    setDueDate(dueDateFromPaymentTerms(invDate, selectedCust.paymentTerms));
  }, [selectedCust, invDate, dueDateTouched]);

  // ── Row update ────────────────────────────────────────────────────────────
  const updRow = useCallback((key: string, patch: Partial<ItemRow>) => {
    setRows((prev) => {
      const rowIndex = prev.findIndex((r) => r._key === key);
      if (rowIndex === -1) return prev;

      const currentRow = prev[rowIndex];
      const mergedRow = compute({ ...currentRow, ...patch });
      const updatedRows = prev.map((r) =>
        r._key === key ? { ...r, ...patch } : r,
      );

      if (
        patch.quantity !== undefined &&
        String(mergedRow.quantity ?? "").trim() === ""
      ) {
        return updatedRows;
      }

      if (mergedRow.type !== "asset" || !mergedRow.assetId) {
        return updatedRows;
      }

      const asset = assets.find((a) => String(a.id) === mergedRow.assetId);
      if (!asset) {
        return updatedRows;
      }

      const groupKey = mergedRow.batchGroupKey || currentRow.batchGroupKey;
      const groupRows = prev.filter((r) => r.batchGroupKey === groupKey);
      const firstGroupIndex = prev.findIndex((r) => r.batchGroupKey === groupKey);
      const anchorRow = groupRows[0] || currentRow;
      const requestedQty = groupRows.reduce((sum, row) => {
        if (row._key === key) return sum + rowQty(mergedRow);
        return sum + rowQty(row);
      }, 0);
      const baseRow: ItemRow = {
        ...anchorRow,
        ...mergedRow,
        _key: anchorRow._key,
        batchGroupKey: groupKey,
        type: "asset",
        serviceId: "",
        itemName: mergedRow.itemName || asset.name,
        availableStock: asset.availableStock,
      };
      const rebuiltGroup = buildBatchSplitRows(
        baseRow,
        asset,
        requestedQty,
        groupRows,
      );
      const nextRows = prev.filter((r) => r.batchGroupKey !== groupKey);
      nextRows.splice(firstGroupIndex, 0, ...rebuiltGroup);
      return nextRows;
    });
    setSrvErrors([]);
  }, [assets]);

  const appliedVatRate = useMemo(() => {
    if (vatChoice === "new") {
      return Number(newVatRate) || 0;
    }
    if (vatChoice === "custom") {
      return Math.max(Number(customVatRate) || 0, 0);
    }
    return Number(vatChoice) || 0;
  }, [customVatRate, newVatRate, vatChoice]);

  const taxEnabled =
    vatChoice === "custom"
      ? rows.some((r) => (Number(r.taxRate) || 0) > 0)
      : appliedVatRate > 0;

  useEffect(() => {
    if (vatChoice === "custom") return;
    setRows((prev) =>
      prev.map((r) => {
        const excl = Number(r.rspWithoutVat) || 0;
        const incl = excl * (1 + appliedVatRate / 100);
        return compute({
          ...r,
          taxRate: String(appliedVatRate),
          rspInclVat: incl.toFixed(2),
        });
      }),
    );
  }, [appliedVatRate, vatChoice]);

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const sub = rows.reduce((s, r) => s + r.netAmount, 0);
    const disc = rows.reduce((s, r) => s + r.discAmount, 0);
    const tax = rows.reduce((s, r) => s + r.taxAmount, 0);
    return {
      sub: round2(sub),
      disc: round2(disc),
      tax: round2(tax),
      total: round2(sub + tax),
    };
  }, [rows]);

  const groupQtyMap = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.batchGroupKey] = (acc[row.batchGroupKey] || 0) + rowQty(row);
      return acc;
    }, {});
  }, [rows]);

  const groupCountMap = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.batchGroupKey] = (acc[row.batchGroupKey] || 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async (mode: "draft" | "confirm" = "draft") => {
    setSrvErrors([]);
    const e = validateForm(selectedCust, invDate, rows);
    if (hasErrors(e)) {
      setErrors(e);
      toast({
        title: "Please review the highlighted fields",
        description: "Complete the required invoice details and fix the line item errors below.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedFY) {
      toast({
        title: "Select a financial year first.",
        variant: "destructive",
      });
      return;
    }
    setSavingAction(mode);
    try {
      const res = await apiFetch("/invoices/create/", {
        method: "POST",
        body: JSON.stringify({
          customerId: selectedCust!.id,
          salespersonId: selectedSalesperson?.id ?? null,
          financial_year: selectedFY.id,
          invoiceDate: invDate,
          dueDate: dueDate || null,
          notes: notes.trim(),
          termsAndConditions: terms.trim(),
          taxEnabled,
          gstType: "gst",
          discountEnabled: true,
          discountMode: "fixed",
          discountValue: 0,
          offerEnabled,
          offerText: offerText.trim(),
          items: rows.map((r) => ({
            itemType: "asset",
            assetId: Number(r.assetId),
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
          })),
        }),
      });
      if (mode === "confirm" && (res as any).invoiceId) {
        await apiFetch(`/invoices/${(res as any).invoiceId}/confirm/`, {
          method: "POST",
        });
      }
      toast({
        title:
          mode === "confirm"
            ? "Invoice completed and sent"
            : "Invoice created! 🎉",
        description: `${(res as any).invoiceNumber} — ${fmt((res as any).totalAmount)}`,
      });
      navigate("/sales-history");
    } catch (err: any) {
      const itemErrors = getApiItemErrors(err);
      const fieldErrors = getApiFieldErrors(err);
      setSrvErrors(itemErrors);
      const ne: FormErrors = { rows: {} };
      if (fieldErrors.customerId) ne.customer = fieldErrors.customerId;
      if (fieldErrors.invoiceDate) ne.invDate = fieldErrors.invoiceDate;
      if (fieldErrors.salespersonId) ne.items = fieldErrors.salespersonId;
      if (itemErrors.length) ne.items = "Please correct the highlighted line items.";
      setErrors(ne);
      toast({
        title: "Unable to save the sales invoice",
        description: getApiErrorSummary(err),
        variant: "destructive",
      });
    } finally {
      setSavingAction(null);
    }
  };

  // ── Loading splash ────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading catalogue…</span>
      </div>
    );

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-background">
      {/* ─── Sticky top bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-3 sm:px-6 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-foreground leading-none">
                New Sales Invoice
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rows.length} line item{rows.length !== 1 ? "s" : ""} · Grand
                Total:{" "}
                <span className="font-semibold text-primary">
                  {fmt(totals.total)}
                </span>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-auto">
            <button
              onClick={() => navigate(-1)}
              className="h-10 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Discard
            </button>
            <button
              onClick={() => handleSave("draft")}
              disabled={!!savingAction}
              className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {savingAction === "draft" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {savingAction === "draft" ? "Saving…" : "Save Draft"}
            </button>
            <button
              onClick={() => handleSave("confirm")}
              disabled={!!savingAction}
              className="h-10 px-5 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {savingAction === "confirm" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              {savingAction === "confirm" ? "Saving & Sending…" : "Save & Send"}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Page body ──────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-6 py-4 sm:py-5 space-y-5">
        {/* Server errors */}
        {srvErrors.length > 0 && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 space-y-1">
            <p className="text-sm font-semibold text-rose-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Validation errors:
            </p>
            {srvErrors.map((e, i) => (
              <p key={i} className="text-xs text-rose-600 ml-6">
                • {e}
              </p>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TOP SECTION — [Customer / Invoice form]  |  [Summary sidebar]
            Sidebar is sticky; below xl it stacks below the form.
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid gap-5 xl:grid-cols-[1fr_288px] xl:items-start">
          {/* ── Customer & Invoice Details card ─────────────────────── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-bold text-foreground">
                Customer & Invoice Details
              </h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Row 1: Customer picker (wide) + Invoice Date + Due Date */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
                <div className="relative">
                  <CustomerPicker
                    customers={customers}
                    selected={selectedCust}
                    error={errors.customer}
                    onSelect={(c) => {
                      setSelectedCust(c);
                      setDueDateTouched(false);
                      setErrors((e) => ({ ...e, customer: undefined }));
                    }}
                    onSearch={(q) => {
                      setCustQuery(q);
                      setCustPage(1);
                    }}
                    onLoadMore={() => setCustPage((p) => p + 1)}
                    hasMore={custMore}
                    loading={custLoading}
                  />
                </div>
                <Field label="Invoice Date" error={errors.invDate} required>
                  <input
                    type="date"
                    value={invDate}
                    onChange={(e) => {
                      setInvDate(e.target.value);
                      setDueDateTouched(false);
                      setErrors((er) => ({ ...er, invDate: undefined }));
                    }}
                    className={cn(INP, errors.invDate && "border-rose-400")}
                  />
                </Field>
                <Field label="Due Date">
                  <input
                    type="date"
                    value={dueDate}
                    min={invDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      setDueDateTouched(true);
                    }}
                    className={INP}
                  />
                </Field>
              </div>

              {/* Customer info strip */}
              {selectedCust && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  {[
                    { label: "Phone", value: selectedCust.phone || "—" },
                    {
                      label: "TRN",
                      value: selectedCust.gstin || "—",
                      mono: true,
                    },
                    {
                      label: "Outstanding",
                      value: fmt(selectedCust.outstanding),
                      cls:
                        selectedCust.outstanding > 0
                          ? "text-rose-600"
                          : "text-emerald-600",
                    },
                  ].map(({ label, value, mono, cls }) => (
                    <div key={label}>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        {label}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-xs font-semibold truncate",
                          mono && "font-mono",
                          cls,
                        )}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Row 2: Salesperson + Notes */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr]">
                <Field label="Salesperson">
                  <div className="relative">
                    <select
                      value={selectedSalesperson?.id?.toString() ?? ""}
                      onChange={(e) =>
                        setSelectedSalesperson(
                          salespersons.find(
                            (s) => String(s.id) === e.target.value,
                          ) ?? null,
                        )
                      }
                      className={SEL}
                    >
                      <option value="">Select salesperson…</option>
                      {salespersons.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-muted-foreground" />
                  </div>
                </Field>
                <Field label="Notes">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Internal notes…"
                    className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 resize-none"
                  />
                </Field>
              </div>

              {/* Row 3: Terms + Tax settings */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
                <Field label="Terms & Conditions">
                  <textarea
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    rows={3}
                    placeholder="e.g. Net 30, warranty, return policy…"
                    className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 resize-none"
                  />
                </Field>
                <div className="rounded-xl border border-border bg-muted/10 p-3.5 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Tax & Commercial Settings
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="text-xs font-semibold">VAT Rate</p>
                      <p className="text-[10px] text-muted-foreground">
                        Applied to each asset line
                      </p>
                    </div>
                    <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted/20 transition-colors">
                      <input
                        type="checkbox"
                        checked={offerEnabled}
                        onChange={(e) => setOfferEnabled(e.target.checked)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <div>
                        <p className="text-xs font-semibold">Offer Enabled</p>
                        <p className="text-[10px] text-muted-foreground">
                          Promotional note
                        </p>
                      </div>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className={LBL}>VAT Rate</label>
                      <div className="relative">
                        <select
                          value={vatChoice}
                          onChange={(e) =>
                            setVatChoice(e.target.value as VatChoice)
                          }
                          className={SEL}
                        >
                          <option value="5">5%</option>
                          <option value="0">0%</option>
                          <option value="new">New VAT Percentage</option>
                          <option value="custom">User Defined</option>
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-muted-foreground" />
                      </div>
                      {vatChoice === "new" && (
                        <div className="mt-2">
                          <label className={LBL}>New VAT Percentage</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={newVatRate}
                              onChange={(e) =>
                                setNewVatRate(normalizeVatInput(e.target.value))
                              }
                              className={cn(INP, "text-right")}
                            />
                            <span className="text-xs text-muted-foreground">
                              %
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Applies this VAT percentage to all item lines.
                          </p>
                        </div>
                      )}
                      {vatChoice === "custom" && (
                        <div className="mt-2">
                          <label className={LBL}>User Defined VAT %</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={customVatRate}
                              onChange={(e) =>
                                setCustomVatRate(
                                  normalizeVatInput(e.target.value),
                                )
                              }
                              className={cn(INP, "text-right")}
                            />
                            <span className="text-xs text-muted-foreground">
                              %
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Used as the default. Edit VAT % on each item line.
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className={LBL}>Offer Text</label>
                      <input
                        value={offerText}
                        onChange={(e) => setOfferText(e.target.value)}
                        disabled={!offerEnabled}
                        placeholder="Extra allowance…"
                        className={cn(INP, !offerEnabled && "opacity-40")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* /form body */}
          </div>
          {/* /form card */}

          {/* ── Invoice Summary sidebar (sticky) ────────────────────── */}
          <div className="xl:sticky xl:top-[64px] space-y-3">
            <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Invoice Summary
              </p>
              {/* Grand total hero */}
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 flex items-center justify-between">
                <p className="text-xs font-bold text-primary/70 uppercase tracking-wider">
                  Grand Total
                </p>
                <p className="text-xl font-bold text-primary tabular-nums">
                  {fmt(totals.total)}
                </p>
              </div>
              {/* Breakdown */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium">
                    {fmt(totals.sub)}
                  </span>
                </div>
                {totals.disc > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Discount</span>
                    <span className="tabular-nums font-medium">
                      −{fmt(totals.disc)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax (VAT)</span>
                  <span className="tabular-nums font-medium text-sky-600">
                    +{fmt(totals.tax)}
                  </span>
                </div>
              </div>
              {/* Meta pills */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border">
                {[
                  {
                    label: "Customer",
                    value: selectedCust?.name || "Not selected",
                  },
                  {
                    label: "Line Items",
                    value: `${rows.length} row${rows.length !== 1 ? "s" : ""}`,
                  },
                  { label: "VAT", value: `${appliedVatRate}%` },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border bg-muted/20 px-2.5 py-2"
                  >
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground truncate">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            {/* Action buttons */}
            <div className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-2">
              <button
                onClick={() => handleSave("draft")}
                disabled={!!savingAction}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {savingAction === "draft" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {savingAction === "draft" ? "Creating Invoice…" : "Save Draft"}
              </button>
              <button
                onClick={() => handleSave("confirm")}
                disabled={!!savingAction}
                className="w-full h-11 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {savingAction === "confirm" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                {savingAction === "confirm"
                  ? "Saving & Sending…"
                  : "Save & Send"}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
        {/* /top section grid */}

        {/* ═══════════════════════════════════════════════════════════════
            ITEM TABLE — FULL WIDTH
            All 9 columns visible; overflow-x scrolls on narrow screens.
        ════════════════════════════════════════════════════════════════ */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-visible">
          {/* Table toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-3.5 border-b border-border bg-muted/10">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Item Table
              </h2>
              {errors.items && (
                <p className="text-xs text-rose-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {errors.items}
                </p>
              )}
            </div>
          </div>

          {/* No-stock warning */}
          {assets.length === 0 && !assetLoading && !assetQuery.trim() && (
            <div className="mx-4 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  No items in stock
                </p>
                <p className="text-[11px] text-amber-600/80 mt-0.5">
                  Receive a Purchase Entry first so the asset list becomes
                  available for billing.
                </p>
              </div>
            </div>
          )}

          {/* Scrollable table — min-width forces all 9 columns to be visible */}
          <div className="overflow-x-auto overflow-y-visible">
            <div className="min-w-[920px]">
              <TableHeader />
              {rows.map((r, idx) => (
                <LineItemRow
                  key={r._key}
                  row={r}
                  idx={idx}
                  assets={assets}
                  blockedAssetIds={rows
                    .filter(
                      (otherRow) =>
                        otherRow.batchGroupKey !== r.batchGroupKey &&
                        !!otherRow.assetId,
                    )
                    .map((otherRow) => otherRow.assetId)}
                  errors={errors}
                  onChange={(patch) => updRow(r._key, patch)}
                  onRemove={() =>
                    setRows((prev) =>
                      prev.filter((x) => x.batchGroupKey !== r.batchGroupKey),
                    )
                  }
                  canRemove={rows.length > 1}
                  appliedVatRate={appliedVatRate}
                  isCustomVat={vatChoice === "custom"}
                  customVatRate={customVatRate}
                  maxQuantity={
                    typeof r.availableStock === "number"
                      ? Math.max(
                          r.availableStock -
                            ((groupQtyMap[r.batchGroupKey] || 0) - rowQty(r)),
                          0,
                        )
                      : undefined
                  }
                  groupRowCount={groupCountMap[r.batchGroupKey] || 1}
                  onAssetSearch={(q) => {
                    setAssetQuery(q);
                    setAssetPage(1);
                  }}
                  onLoadMoreAssets={() => setAssetPage((p) => p + 1)}
                  assetHasMore={assetMore}
                  assetLoading={assetLoading}
                />
              ))}
              {/* Add another line */}
              <div className="px-4 py-3 border-t border-dashed border-border/50">
                <button
                  onClick={() => {
                    setRows((r) => [...r, emptyRow()]);
                    setErrors((e) => ({ ...e, items: undefined }));
                  }}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/75 font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Another Line
                </button>
              </div>
            </div>
          </div>

          {/* ── Amount summary — bottom-right of item table ── */}
          <div className="border-t border-border bg-muted/10 px-5 py-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              {/* Left: row count info */}
              <p className="text-xs text-muted-foreground">
                {rows.length} line item{rows.length !== 1 ? "s" : ""}
                {" · "}
                {rows.filter((r) => r.type === "asset").length} asset
                {rows.filter((r) => r.type === "asset").length !== 1 ? "s" : ""}
              </p>

              {/* Right: totals */}
              <div className="space-y-1.5 min-w-[240px]">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sub Total</span>
                  <span className="tabular-nums font-medium">
                    {fmt(totals.sub)}
                  </span>
                </div>
                {totals.disc > 0 && (
                  <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                    <span>Discount</span>
                    <span className="tabular-nums font-medium">
                      −{fmt(totals.disc)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tax (VAT)</span>
                  <span className="tabular-nums font-medium text-sky-600">
                    +{fmt(totals.tax)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border text-base font-bold text-foreground">
                  <span>Total (AED)</span>
                  <span className="tabular-nums text-primary text-lg">
                    {fmt(totals.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* /item table card */}

        <div className="h-8" />
      </div>
      {/* /page body */}
    </div>
  );
}
