// src/pages/Stock.tsx
// Full stock management: dashboard, add, adjust, transfer, set minimum, view history

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TrendingDown,
  TrendingUp,
  Warehouse,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockItem {
  stock_id: number;
  asset_id: number;
  asset_name: string;
  asset_code: string;
  asset_type: string;
  asset_status: string;
  total_quantity: number;
  damaged_quantity: number;
  expired_quantity: number;
  available: number;
  minimum_stock: number;
  warehouse_id: number;
  warehouse_name: string;
  location: string;
  status: string;
  is_low_stock: boolean;
  updated_at: string | null;
}
interface StockSummary {
  total_items: number;
  available_stock: number;
  damaged: number;
  expired: number;
  low_stock_items: number;
  total_quantity: number;
}
interface StockBatchDetail {
  batch_id: number;
  batch_number: string;
  expiry_date: string | null;
  quantity_received: number;
  quantity_available: number;
  quantity_sold: number;
  is_expired: boolean;
  warehouse_id: number;
  warehouse_name: string;
  created_at: string | null;
}
interface HistoryEntry {
  id: number;
  movement_type: string;
  type_label: string;
  quantity: number;
  balance_after: number;
  reference_type: string;
  reference_id: number | null;
  batch_number?: string;
  expiry_date?: string | null;
  reason: string;
  performed_by: string;
  adjustment_id: number | null;
  can_restore: boolean;
  is_restored: boolean;
  restored_at: string | null;
  restored_by: string;
  restore_reason: string;
  created_at: string | null;
}
interface StockDetailPayload {
  stock: StockItem;
  batches: StockBatchDetail[];
  recent_history: HistoryEntry[];
}
interface WarehouseOption {
  id: number;
  name: string;
  location: string;
}
interface AssetOption {
  id: number;
  name: string;
  asset_code: string;
  asset_type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const res = await fetch(`${API_URL}/api/stock${path}`, {
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
      body,
    });
  return body;
}

const MOVE_COLOR: Record<string, string> = {
  purchase_receipt:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  add: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  remove: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
  damaged:
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  expired:
    "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20",
  dmg_out:
    "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  exp_out:
    "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/20",
  restored:
    "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
  transfer_in: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20",
  transfer_out:
    "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  allocated:
    "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
  returned:
    "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
  opening:
    "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
};
const IN_TYPES = new Set([
  "purchase_receipt",
  "add",
  "restored",
  "transfer_in",
  "returned",
  "opening",
]);
const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-AE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

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
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none",
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
  hint,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
      {label}
      {required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    {children}
    {hint && !error && (
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    )}
    {error && (
      <p className="text-xs text-rose-500 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {error}
      </p>
    )}
  </div>
);

// ─── Dialog shell ─────────────────────────────────────────────────────────────

function Modal({
  open,
  onClose,
  title,
  subtitle,
  iconCls = "bg-primary/10 text-primary",
  icon: Icon,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  iconCls?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center",
                iconCls,
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold">{title}</h2>
              {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="p-5 pt-0 border-t">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Stock level bar ──────────────────────────────────────────────────────────

function StockBar({ item }: { item: StockItem }) {
  const total = Math.max(item.total_quantity, 1);
  const aPct = Math.round((item.available / total) * 100);
  const dPct = Math.round((item.damaged_quantity / total) * 100);
  const ePct = Math.round((item.expired_quantity / total) * 100);
  return (
    <div className="space-y-2.5 w-[220px]">
      <div className="flex items-center justify-between text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "font-semibold",
              item.is_low_stock ? "text-rose-600" : "text-foreground",
            )}
          >
            {item.available} available
          </span>
          {item.damaged_quantity > 0 && (
            <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
              {item.damaged_quantity} damaged
            </span>
          )}
          {item.expired_quantity > 0 && (
            <span className="rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
              {item.expired_quantity} expired
            </span>
          )}
        </div>
        {item.is_low_stock && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}
      </div>
      <div className="h-2 rounded-full bg-muted/50 overflow-hidden flex gap-px">
        {aPct > 0 && (
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${aPct}%` }}
          />
        )}
        {dPct > 0 && (
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${dPct}%` }}
          />
        )}
        {ePct > 0 && (
          <div
            className="h-full bg-rose-500 transition-all"
            style={{ width: `${ePct}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          {item.available} avail
        </span>
        <span className="flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
          {item.total_quantity} total
        </span>
        {item.damaged_quantity > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
            {item.damaged_quantity} dmg
          </span>
        )}
        {item.expired_quantity > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
            {item.expired_quantity} exp
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD STOCK DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function AddStockDialog({
  open,
  onClose,
  onSaved,
  warehouses,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  warehouses: WarehouseOption[];
}) {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    asset_id: "",
    warehouse_id: "",
    total_quantity: "",
    minimum_stock: "0",
    reason: "",
  });

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };

  useEffect(() => {
    if (!open) {
      setForm({
        asset_id: "",
        warehouse_id: "",
        total_quantity: "",
        minimum_stock: "0",
        reason: "",
      });
      setErrors({});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch(
      `/asset-dropdown/${form.warehouse_id ? `?warehouse_id=${form.warehouse_id}` : ""}`,
    )
      .then((d) => setAssets(d))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [open, form.warehouse_id]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.warehouse_id) e.warehouse_id = "Select a warehouse.";
    if (!form.asset_id) e.asset_id = "Select an asset.";
    if (!form.total_quantity || Number(form.total_quantity) < 0)
      e.total_quantity = "Enter a valid quantity (≥ 0).";
    if (Number(form.minimum_stock) < 0) e.minimum_stock = "Cannot be negative.";
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/create/", {
        method: "POST",
        body: JSON.stringify({
          asset_id: Number(form.asset_id),
          warehouse_id: Number(form.warehouse_id),
          total_quantity: Number(form.total_quantity),
          minimum_stock: Number(form.minimum_stock),
          reason: form.reason.trim() || "Initial stock entry",
        }),
      });
      toast({ title: "Stock added successfully" });
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = getApiErrorMessage(err);
      if (msg?.includes("already exists")) setErrors({ asset_id: msg });
      else toast({ title: "Failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const warnLow =
    form.total_quantity &&
    Number(form.total_quantity) > 0 &&
    Number(form.minimum_stock) >= Number(form.total_quantity);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Stock Entry"
      subtitle="Register a new asset in a warehouse"
      icon={Plus}
      iconCls="bg-emerald-500/10 text-emerald-500"
      footer={
        <div className="flex gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add Stock
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Warehouse" error={errors.warehouse_id} required>
          <div className="relative">
            <Sel
              value={form.warehouse_id}
              onChange={(e) => set("warehouse_id", e.target.value)}
              className={errors.warehouse_id ? "border-rose-400" : ""}
            >
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.location ? ` — ${w.location}` : ""}
                </option>
              ))}
            </Sel>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </Field>
        <Field
          label="Asset"
          error={errors.asset_id}
          required
          hint={!form.warehouse_id ? "Select a warehouse first" : ""}
        >
          <div className="relative">
            <Sel
              value={form.asset_id}
              onChange={(e) => set("asset_id", e.target.value)}
              disabled={!form.warehouse_id}
              className={errors.asset_id ? "border-rose-400" : ""}
            >
              <option value="">
                {loading
                  ? "Loading assets…"
                  : form.warehouse_id
                    ? "Select asset…"
                    : "Select a warehouse first"}
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} [{a.asset_code}]
                </option>
              ))}
            </Sel>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          {form.warehouse_id && assets.length === 0 && !loading && (
            <p className="text-[10px] text-muted-foreground">
              All active assets already have stock in this warehouse.
            </p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total Quantity" error={errors.total_quantity} required>
            <Inp
              type="number"
              min="0"
              value={form.total_quantity}
              onChange={(e) => set("total_quantity", e.target.value)}
              placeholder="0"
              className={errors.total_quantity ? "border-rose-400" : ""}
            />
          </Field>
          <Field
            label="Minimum Stock"
            error={errors.minimum_stock}
            hint="Alert threshold"
          >
            <Inp
              type="number"
              min="0"
              value={form.minimum_stock}
              onChange={(e) => set("minimum_stock", e.target.value)}
              placeholder="0"
              className={errors.minimum_stock ? "border-rose-400" : ""}
            />
          </Field>
        </div>
        <Field label="Reason / Notes">
          <Inp
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Initial stock entry"
          />
        </Field>
        {warnLow && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Minimum ≥ total — this item will immediately show as low stock.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUST STOCK DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function AdjustStockDialog({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: StockItem | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    adjustment_type: "add",
    quantity: "",
    reason: "",
    reference_no: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  useEffect(() => {
    if (!open) {
      setForm({
        adjustment_type: "add",
        quantity: "",
        reason: "",
        reference_no: "",
      });
      setErrors({});
    }
  }, [open]);

  const TYPE_CFG = {
    add: { label: "Add", color: "bg-emerald-600 hover:bg-emerald-700" },
    remove: { label: "Remove", color: "bg-rose-600 hover:bg-rose-700" },
    damaged: { label: "Damage", color: "bg-amber-600 hover:bg-amber-700" },
    expired: { label: "Expire", color: "bg-rose-700 hover:bg-rose-800" },
    dmg_out: {
      label: "Remove Damaged",
      color: "bg-orange-600 hover:bg-orange-700",
    },
    exp_out: {
      label: "Remove Expired",
      color: "bg-slate-700 hover:bg-slate-800",
    },
  };
  const tc = TYPE_CFG[form.adjustment_type as keyof typeof TYPE_CFG];
  const quantityValue = Number(form.quantity) || 0;
  const maxQuantity = item
    ? form.adjustment_type === "add"
      ? undefined
      : form.adjustment_type === "remove" ||
          form.adjustment_type === "damaged" ||
          form.adjustment_type === "expired"
        ? item.available
        : form.adjustment_type === "dmg_out"
          ? item.damaged_quantity
          : item.expired_quantity
    : undefined;
  const previewLabel = item
    ? form.adjustment_type === "damaged" || form.adjustment_type === "dmg_out"
      ? "Damaged after:"
      : form.adjustment_type === "expired" || form.adjustment_type === "exp_out"
        ? "Expired after:"
        : "Available after:"
    : "Available after:";
  const previewValue = item
    ? form.adjustment_type === "add"
      ? item.available + quantityValue
      : form.adjustment_type === "remove"
        ? Math.max(0, item.available - quantityValue)
        : form.adjustment_type === "damaged"
          ? item.damaged_quantity + quantityValue
          : form.adjustment_type === "expired"
            ? item.expired_quantity + quantityValue
            : form.adjustment_type === "dmg_out"
              ? Math.max(0, item.damaged_quantity - quantityValue)
              : Math.max(0, item.expired_quantity - quantityValue)
    : 0;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!form.quantity || Number(form.quantity) <= 0)
      e.quantity = "Enter a positive quantity.";
    else if (
      typeof maxQuantity === "number" &&
      Number(form.quantity) > maxQuantity
    ) {
      e.quantity = `Maximum allowed is ${maxQuantity}.`;
    }
    if (!form.reason.trim()) e.reason = "Reason is required.";
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/adjust/", {
        method: "POST",
        body: JSON.stringify({
          stock_id: item!.stock_id,
          adjustment_type: form.adjustment_type,
          quantity: Number(form.quantity),
          reason: form.reason.trim(),
          reference_no: form.reference_no.trim(),
        }),
      });
      toast({ title: "Stock adjusted", description: (res as any).message });
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = getApiErrorMessage(err);
      if (msg?.includes("Cannot")) setErrors({ quantity: msg });
      else toast({ title: "Failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust Stock"
      subtitle={item ? `${item.asset_name} @ ${item.warehouse_name}` : ""}
      icon={Settings2}
      iconCls="bg-sky-500/10 text-sky-500"
      footer={
        <div className="flex gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "flex-1 h-10 rounded-xl text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2",
              tc.color,
            )}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {tc.label}{" "}
            Stock
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {item && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              {
                label: "Available",
                value: item.available,
                color: "text-emerald-600 dark:text-emerald-400",
              },
              {
                label: "Damaged",
                value: item.damaged_quantity,
                color: "text-amber-600 dark:text-amber-400",
              },
              {
                label: "Expired",
                value: item.expired_quantity,
                color: "text-rose-600 dark:text-rose-400",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border bg-muted/30 p-3 text-center"
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </p>
                <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
        <Field label="Adjustment Type" required>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              ["add", "remove", "damaged", "expired", "dmg_out", "exp_out"] as const
            ).map((t) => (
              <button
                key={t}
                onClick={() => set("adjustment_type", t)}
                disabled={
                  (t === "dmg_out" && (item?.damaged_quantity || 0) === 0) ||
                  (t === "exp_out" && (item?.expired_quantity || 0) === 0)
                }
                className={cn(
                  "h-9 rounded-lg text-xs font-semibold border transition-colors capitalize",
                  form.adjustment_type === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                  ((t === "dmg_out" && (item?.damaged_quantity || 0) === 0) ||
                    (t === "exp_out" && (item?.expired_quantity || 0) === 0)) &&
                    "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                {TYPE_CFG[t].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Quantity" error={errors.quantity} required>
          <Inp
            type="number"
            min="1"
            max={maxQuantity}
            value={form.quantity}
            onChange={(e) => {
              const raw = e.target.value;
              if (!raw) {
                set("quantity", raw);
                return;
              }
              const next = Math.max(0, Number(raw));
              if (Number.isNaN(next)) return;
              const capped =
                typeof maxQuantity === "number"
                  ? Math.min(next, maxQuantity)
                  : next;
              set("quantity", String(capped));
            }}
            placeholder="Enter quantity"
            className={errors.quantity ? "border-rose-400" : ""}
          />
        </Field>
        {typeof maxQuantity === "number" && (
          <p className="text-[11px] text-muted-foreground">
            Maximum allowed: <span className="font-semibold">{maxQuantity}</span>
          </p>
        )}
        {form.quantity && Number(form.quantity) > 0 && item && (
          <div
            className={cn(
              "flex items-center justify-between p-3 rounded-xl border",
              form.adjustment_type === "add" || form.adjustment_type === "remove"
                ? previewValue < item.minimum_stock
                  ? "bg-rose-500/10 border-rose-500/20"
                  : "bg-emerald-500/10 border-emerald-500/20"
                : "bg-muted/20 border-border",
            )}
          >
            <span className="text-xs text-muted-foreground">
              {previewLabel}
            </span>
            <span
              className={cn(
                "text-sm font-bold",
                form.adjustment_type === "add" || form.adjustment_type === "remove"
                  ? previewValue < item.minimum_stock
                    ? "text-rose-600"
                    : "text-emerald-600"
                  : form.adjustment_type === "damaged" ||
                      form.adjustment_type === "dmg_out"
                    ? "text-amber-600"
                    : "text-rose-600",
              )}
            >
              {previewValue} units{" "}
              {form.adjustment_type === "add" || form.adjustment_type === "remove"
                ? previewValue < item.minimum_stock
                  ? "⚠ Low"
                  : "✓"
                : "✓"}
            </span>
          </div>
        )}
        {(form.adjustment_type === "dmg_out" || form.adjustment_type === "exp_out") && (
          <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            This action permanently removes already marked{" "}
            {form.adjustment_type === "dmg_out" ? "damaged" : "expired"} stock
            from inventory and records a disposal entry in stock history.
          </div>
        )}
        <Field label="Reason" error={errors.reason} required>
          <textarea
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            rows={2}
            placeholder="Explain why this adjustment is being made…"
            className={cn(
              "w-full px-3 py-2 rounded-lg border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none",
              errors.reason ? "border-rose-400" : "border-border",
            )}
          />
        </Field>
        <Field label="Reference No. (optional)">
          <Inp
            value={form.reference_no}
            onChange={(e) => set("reference_no", e.target.value)}
            placeholder="e.g. WO-123, PO-2025-001"
          />
        </Field>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET MINIMUM DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function SetMinimumDialog({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: StockItem | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && item) {
      setValue(String(item.minimum_stock));
      setError("");
    }
  }, [open, item]);

  const num = parseInt(value, 10);
  const willBeLow = item && !isNaN(num) && num >= item.available;

  const submit = async () => {
    if (isNaN(num) || num < 0) {
      setError("Enter a valid non-negative integer.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/set-minimum/", {
        method: "POST",
        body: JSON.stringify({ stock_id: item!.stock_id, minimum_stock: num }),
      });
      toast({ title: "Minimum stock updated", description: `Set to ${num}.` });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({
        title: "Failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set Minimum Stock"
      subtitle={item ? `${item.asset_name} @ ${item.warehouse_name}` : ""}
      icon={Settings2}
      iconCls="bg-amber-500/10 text-amber-500"
      footer={
        <div className="flex gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
            Minimum
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {item && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/30 border p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Current Available
              </p>
              <p
                className={cn(
                  "text-2xl font-bold",
                  item.is_low_stock ? "text-rose-600" : "text-emerald-600",
                )}
              >
                {item.available}
              </p>
            </div>
            <div className="rounded-xl bg-muted/30 border p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Current Minimum
              </p>
              <p className="text-2xl font-bold text-amber-600">
                {item.minimum_stock}
              </p>
            </div>
          </div>
        )}
        <Field label="New Minimum Stock Level" error={error} required>
          <Inp
            type="number"
            min="0"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            placeholder="0"
          />
        </Field>
        {item && value && !isNaN(num) && (
          <div
            className={cn(
              "p-3 rounded-xl border text-xs",
              willBeLow
                ? "bg-amber-500/10 border-amber-500/20 text-amber-600"
                : "bg-muted/30 border-border text-muted-foreground",
            )}
          >
            {willBeLow
              ? `⚠ Setting minimum to ${num} — only ${item.available} available. Will flag as low stock.`
              : `✓ ${item.available} available ≥ ${num} minimum — stock level is healthy.`}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Items at or below this threshold are flagged as low stock in the
          dashboard.
        </p>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFER DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function TransferDialog({
  open,
  onClose,
  item,
  warehouses,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: StockItem | null;
  warehouses: WarehouseOption[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    to_warehouse_id: "",
    quantity: "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  useEffect(() => {
    if (!open) {
      setForm({ to_warehouse_id: "", quantity: "", reason: "" });
      setErrors({});
    }
  }, [open]);

  const available = warehouses.filter((w) => w.id !== item?.warehouse_id);
  const destWH = available.find((w) => String(w.id) === form.to_warehouse_id);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!form.to_warehouse_id) e.to_warehouse_id = "Select destination.";
    if (!form.quantity || Number(form.quantity) <= 0)
      e.quantity = "Enter a positive quantity.";
    if (item && Number(form.quantity) > item.available)
      e.quantity = `Cannot exceed ${item.available} available.`;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/transfer/", {
        method: "POST",
        body: JSON.stringify({
          stock_id: item!.stock_id,
          to_warehouse_id: Number(form.to_warehouse_id),
          quantity: Number(form.quantity),
          reason: form.reason.trim(),
        }),
      });
      toast({ title: "Transfer complete", description: (res as any).message });
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = getApiErrorMessage(err);
      if (msg?.includes("Insufficient")) setErrors({ quantity: msg });
      else
        toast({
          title: "Transfer failed",
          description: msg,
          variant: "destructive",
        });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transfer Stock"
      subtitle={item ? `From: ${item.warehouse_name}` : ""}
      icon={ArrowRightLeft}
      iconCls="bg-violet-500/10 text-violet-500"
      footer={
        <div className="flex gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Transfer
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {item && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/30 border p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                From
              </p>
              <p className="text-sm font-semibold">{item.warehouse_name}</p>
              <p className="text-xs text-muted-foreground">
                {item.available} available
              </p>
            </div>
            <div
              className={cn(
                "rounded-xl border p-3",
                form.to_warehouse_id
                  ? "bg-violet-500/10 border-violet-500/20"
                  : "bg-muted/30 border-border",
              )}
            >
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                To
              </p>
              <p className="text-sm font-semibold">{destWH?.name ?? "—"}</p>
              {destWH?.location && (
                <p className="text-xs text-muted-foreground">
                  {destWH.location}
                </p>
              )}
            </div>
          </div>
        )}
        <Field
          label="Destination Warehouse"
          error={errors.to_warehouse_id}
          required
        >
          <div className="relative">
            <Sel
              value={form.to_warehouse_id}
              onChange={(e) => set("to_warehouse_id", e.target.value)}
              className={errors.to_warehouse_id ? "border-rose-400" : ""}
            >
              <option value="">Select destination…</option>
              {available.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.location ? ` — ${w.location}` : ""}
                </option>
              ))}
            </Sel>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          {available.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No other active warehouses. Create one in Warehouse Management.
            </p>
          )}
        </Field>
        <Field
          label="Quantity to Transfer"
          error={errors.quantity}
          required
          hint={item ? `Max: ${item.available} units` : ""}
        >
          <Inp
            type="number"
            min="1"
            max={item?.available}
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            placeholder="0"
            className={errors.quantity ? "border-rose-400" : ""}
          />
        </Field>
        <Field label="Reason (optional)">
          <Inp
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="e.g. Rebalancing stock"
          />
        </Field>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function StockDetailDialog({
  open,
  onClose,
  item,
  onViewHistory,
}: {
  open: boolean;
  onClose: () => void;
  item: StockItem | null;
  onViewHistory: () => void;
}) {
  const [detail, setDetail] = useState<StockDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const visibleBatches = (detail?.batches ?? []).filter(
    (batch) => batch.quantity_available > 0,
  );

  useEffect(() => {
    if (!open || !item) return;
    setLoading(true);
    apiFetch(`/detail/${item.stock_id}/`)
      .then((data) => setDetail(data as StockDetailPayload))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [open, item]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock Details"
      subtitle={item ? `${item.asset_name} @ ${item.warehouse_name}` : ""}
      icon={Package}
      iconCls="bg-violet-500/10 text-violet-500"
      footer={
        <div className="flex gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Close
          </button>
          <button
            onClick={onViewHistory}
            className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center justify-center gap-2"
          >
            <History className="w-4 h-4" />
            View History
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading stock details…</span>
        </div>
      ) : !detail ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600">
          Unable to load the stock details for this row.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "Available",
                value: detail.stock.available,
                cls: "text-emerald-600",
              },
              {
                label: "Damaged",
                value: detail.stock.damaged_quantity,
                cls: "text-amber-600",
              },
              {
                label: "Expired",
                value: detail.stock.expired_quantity,
                cls: "text-rose-600",
              },
              {
                label: "Total",
                value: detail.stock.total_quantity,
                cls: "text-foreground",
              },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border bg-muted/25 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </p>
                <p className={cn("mt-1 text-2xl font-bold", card.cls)}>{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Asset Code
              </p>
              <p className="mt-1 text-sm font-semibold">{detail.stock.asset_code}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Warehouse
              </p>
              <p className="mt-1 text-sm font-semibold">{detail.stock.warehouse_name}</p>
              {detail.stock.location && (
                <p className="text-xs text-muted-foreground">{detail.stock.location}</p>
              )}
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Last Updated
              </p>
              <p className="mt-1 text-sm font-semibold">{fmtDate(detail.stock.updated_at)}</p>
            </div>
          </div>

          <div className="rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Batch Details</p>
                <p className="text-xs text-muted-foreground">
                  Batch number, expiry date, and current sellable quantity for this row.
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {visibleBatches.length} batch{visibleBatches.length !== 1 ? "es" : ""}
              </span>
            </div>
            {visibleBatches.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No batch rows found for this stock. This usually means legacy stock or an opening balance without batch tracking.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/10 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5">Batch</th>
                      <th className="px-4 py-2.5">Expiry</th>
                      <th className="px-4 py-2.5 text-right">Received</th>
                      <th className="px-4 py-2.5 text-right">Available</th>
                      <th className="px-4 py-2.5 text-right">Used</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatches.map((batch) => (
                      <tr key={batch.batch_id} className="border-b last:border-b-0">
                        <td className="px-4 py-3 font-medium">{batch.batch_number || "No Batch"}</td>
                        <td className="px-4 py-3">{fmtDate(batch.expiry_date)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{batch.quantity_received}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">
                          {batch.quantity_available}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{batch.quantity_sold}</td>
                        <td className="px-4 py-3">
                          {batch.is_expired ? (
                            <span className="inline-flex rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                              Expired
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border overflow-hidden">
            <div className="border-b bg-muted/30 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Recent Movements</p>
              <p className="text-xs text-muted-foreground">
                Latest activity for this stock row, including batch-linked movements.
              </p>
            </div>
            <div className="divide-y divide-border">
              {detail.recent_history.length === 0 ? (
                <div className="px-4 py-5 text-sm text-muted-foreground">
                  No recent stock movements.
                </div>
              ) : (
                detail.recent_history.map((entry) => (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              MOVE_COLOR[entry.movement_type] ??
                                "bg-muted text-muted-foreground border-border",
                            )}
                          >
                            {entry.type_label}
                          </span>
                          {entry.batch_number && (
                            <span className="text-[11px] text-muted-foreground">
                              Batch {entry.batch_number}
                            </span>
                          )}
                          {entry.expiry_date && (
                            <span className="text-[11px] text-muted-foreground">
                              Exp {fmtDate(entry.expiry_date)}
                            </span>
                          )}
                        </div>
                        {entry.reason && (
                          <p className="mt-1 text-xs text-muted-foreground">{entry.reason}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "text-sm font-bold",
                            IN_TYPES.has(entry.movement_type)
                              ? "text-emerald-600"
                              : "text-rose-600",
                          )}
                        >
                          {IN_TYPES.has(entry.movement_type) ? "+" : "−"}
                          {entry.quantity}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{entry.created_at || "—"}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function HistoryDialog({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: StockItem | null;
  onSaved: () => void;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const loadHistory = useCallback(() => {
    if (!item) return Promise.resolve();
    setLoading(true);
    return apiFetch(`/history/${item.stock_id}/`)
      .then((d: any) => setHistory(d.history ?? []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [item]);

  useEffect(() => {
    if (!open || !item) return;
    setFilter("");
    loadHistory();
  }, [open, item, loadHistory]);

  const filtered = history.filter((h) => !filter || h.movement_type === filter);

  const restoreAdjustment = async (entry: HistoryEntry) => {
    if (!entry.adjustment_id || !entry.can_restore) return;
    const confirmed = window.confirm(
      `Restore ${entry.quantity} unit(s) from this ${entry.type_label.toLowerCase()} entry?`,
    );
    if (!confirmed) return;

    setRestoringId(entry.adjustment_id);
    try {
      const res = await apiFetch(`/adjust/${entry.adjustment_id}/restore/`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: "Stock restored", description: (res as any).message });
      await loadHistory();
      onSaved();
    } catch (err: any) {
      toast({
        title: "Restore failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock History"
      subtitle={item ? `${item.asset_name} @ ${item.warehouse_name}` : ""}
      icon={History}
      iconCls="bg-indigo-500/10 text-indigo-500"
    >
      <div className="space-y-4">
        <div className="relative">
          <Sel value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All movements</option>
            {[
              ["purchase_receipt", "Purchase Receipt"],
              ["add", "Manual Add"],
              ["remove", "Manual Remove"],
              ["damaged", "Marked Damaged"],
              ["expired", "Marked Expired"],
              ["dmg_out", "Removed Damaged Stock"],
              ["exp_out", "Removed Expired Stock"],
              ["restored", "Restored"],
              ["transfer_in", "Transfer In"],
              ["transfer_out", "Transfer Out"],
              ["allocated", "Allocated"],
              ["returned", "Returned"],
              ["opening", "Opening Balance"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading history…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center">
              <History className="w-6 h-6 text-muted-foreground opacity-40" />
            </div>
            <p className="text-sm text-muted-foreground">No history entries.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filtered.map((h) => {
              const isIn = IN_TYPES.has(h.movement_type);
              return (
                <div
                  key={h.id}
                  className="flex items-start gap-3 p-3 rounded-xl border hover:bg-muted/30 transition-colors"
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                      MOVE_COLOR[h.movement_type] ??
                        "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {isIn ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                            MOVE_COLOR[h.movement_type] ??
                              "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {h.type_label}
                        </span>
                        {h.batch_number && (
                          <span className="text-[11px] text-muted-foreground">
                            Batch {h.batch_number}
                          </span>
                        )}
                        {h.expiry_date && (
                          <span className="text-[11px] text-muted-foreground">
                            Exp {fmtDate(h.expiry_date)}
                          </span>
                        )}
                        {h.is_restored && (
                          <span className="rounded-full border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-[11px] font-semibold text-teal-600">
                            Restored
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span
                          className={cn(
                            "text-sm font-bold",
                            isIn ? "text-emerald-600" : "text-rose-600",
                          )}
                        >
                          {isIn ? "+" : "−"}
                          {h.quantity}
                        </span>
                      </div>
                    </div>
                    {h.reason && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {h.reason}
                      </p>
                    )}
                    {h.restore_reason && (
                      <p className="text-[11px] text-teal-600 mt-1">
                        Restore note: {h.restore_reason}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/70">
                      <span>
                        Balance:{" "}
                        <strong className="text-foreground">
                          {h.balance_after}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>{h.performed_by}</span>
                      {h.created_at && (
                        <>
                          <span>·</span>
                          <span>{h.created_at}</span>
                        </>
                      )}
                    </div>
                    {h.can_restore && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => restoreAdjustment(h)}
                          disabled={restoringId === h.adjustment_id}
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 text-[11px] font-semibold text-teal-600 hover:bg-teal-500/15 disabled:opacity-50"
                        >
                          {restoringId === h.adjustment_id && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          Restore This Entry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {filtered.length} entries
          </p>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Stock() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Server-side pagination ─────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [stFilt, setStFilt] = useState("");
  const [whFilt, setWhFilt] = useState("");

  // ── Dialogs ────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<StockItem | null>(null);
  const [minTarget, setMinTarget] = useState<StockItem | null>(null);
  const [transferTarget, setTransferTarget] = useState<StockItem | null>(null);
  const [histTarget, setHistTarget] = useState<StockItem | null>(null);
  const [detailTarget, setDetailTarget] = useState<StockItem | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (whFilt) params.set("warehouse", whFilt);
      if (stFilt) params.set("status", stFilt);
      params.set("page", String(page));
      params.set("page_size", String(pageSize));

      const [dash, wh] = await Promise.all([
        apiFetch(`/dashboard/?${params}`),
        apiFetch("/warehouses/"),
      ]);

      const stockItems = (dash as any).stock_table ?? [];
      const pagination = (dash as any).pagination ?? {};
      const summaryData = (dash as any).summary ?? null;

      setItems(stockItems);
      setSummary(summaryData);
      setWarehouses(wh ?? []);

      // ✅ Fix: fallback to items length if pagination fields missing
      const total =
        pagination.total_count ??
        pagination.total ??
        pagination.count ??
        stockItems.length;
      const tPages =
        pagination.total_pages ??
        pagination.pages ??
        Math.ceil(total / pageSize) ??
        1;

      setTotalCount(total);
      setTotalPages(Math.max(1, tPages));

      // Debug — remove after fix confirmed
      console.log("pagination raw:", pagination);
      console.log(
        "total:",
        total,
        "tPages:",
        tPages,
        "items:",
        stockItems.length,
      );
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, whFilt, stFilt, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, whFilt, stFilt, pageSize]);
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // "Showing X to Y of Z stock items"
  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Stock Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track and manage asset inventory across all warehouses
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Stock
        </button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
          {[
            {
              label: "Total Items",
              value: summary.total_items,
              icon: Package,
              cls: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
            },
            {
              label: "Available",
              value: summary.available_stock,
              icon: CheckCircle,
              cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
            },
            {
              label: "Low Stock",
              value: summary.low_stock_items,
              icon: AlertTriangle,
              cls:
                summary.low_stock_items > 0
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                  : "bg-muted/30 text-muted-foreground border-border",
            },
            {
              label: "Expired",
              value: summary.expired,
              icon: TrendingDown,
              cls:
                summary.expired > 0
                  ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                  : "bg-muted/30 text-muted-foreground border-border",
            },
            {
              label: "Damaged",
              value: summary.damaged,
              icon: XCircle,
              cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
            },
          ].map((s) => (
            <div
              key={s.label}
              className={cn(
                "rounded-2xl border p-4 flex items-center gap-3",
                s.cls,
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
                  {s.label}
                </p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Low stock banner */}
      {summary && summary.low_stock_items > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>{summary.low_stock_items}</strong> item
            {summary.low_stock_items !== 1 ? "s are" : " is"} below minimum
            stock level and need restocking.
          </p>
          <button
            onClick={() => setStFilt("low_stock")}
            className="ml-auto text-xs font-semibold text-amber-600 hover:underline shrink-0"
          >
            View low stock →
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
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
          <select
            value={whFilt}
            onChange={(e) => setWhFilt(e.target.value)}
            className="w-44 h-9 px-3 pr-8 rounded-xl border border-border bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={stFilt}
            onChange={(e) => setStFilt(e.target.value)}
            className="w-36 h-9 px-3 pr-8 rounded-xl border border-border bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All Status</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="damaged">Damaged</option>
            <option value="expired">Expired</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        <button
          onClick={fetchAll}
          disabled={loading}
          className="h-9 px-3 rounded-xl border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />{" "}
          Refresh
        </button>
        {(search || stFilt || whFilt) && (
          <button
            onClick={() => {
              setSearch("");
              setStFilt("");
              setWhFilt("");
            }}
            className="h-9 px-3 rounded-xl border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <p className="text-sm font-medium text-rose-600 flex-1">{error}</p>
          <button
            onClick={fetchAll}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
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

      {/* Table */}
      {!loading && !error && (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Package className="w-12 h-12 text-muted-foreground opacity-30" />
              <div className="text-center">
                <p className="text-sm font-semibold">No stock items found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {search || stFilt || whFilt
                    ? "Try adjusting filters."
                    : "Add your first stock entry."}
                </p>
              </div>
              {!search && !stFilt && !whFilt && (
                <button
                  onClick={() => setAddOpen(true)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Stock
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      {[
                        "Asset",
                        "Stock Levels",
                        "Min. Stock",
                        "Warehouse",
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
                    {items.map((item) => (
                      <tr
                        key={item.stock_id}
                        className={cn(
                          "border-b last:border-b-0 hover:bg-muted/20 transition-colors group cursor-pointer",
                          item.is_low_stock && "bg-amber-500/5",
                        )}
                        onClick={() => setDetailTarget(item)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                                item.asset_type === "hardware"
                                  ? "bg-sky-500/10"
                                  : "bg-violet-500/10",
                              )}
                            >
                              <Package
                                className={cn(
                                  "w-4 h-4",
                                  item.asset_type === "hardware"
                                    ? "text-sky-500"
                                    : "text-violet-500",
                                )}
                              />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">
                                {item.asset_name}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {item.asset_code}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StockBar item={item} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "font-semibold",
                              item.is_low_stock
                                ? "text-rose-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {item.minimum_stock}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Warehouse className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-xs font-medium">
                                {item.warehouse_name}
                              </p>
                              {item.location && (
                                <p className="text-[10px] text-muted-foreground">
                                  {item.location}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {item.is_low_stock ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">
                              <AlertTriangle className="w-3 h-3" /> Low Stock
                            </span>
                          ) : item.expired_quantity > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 border border-rose-500/20">
                              <TrendingDown className="w-3 h-3" /> Has Expired
                            </span>
                          ) : item.damaged_quantity > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">
                              <XCircle className="w-3 h-3" /> Has Damaged
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
                              <CheckCircle className="w-3 h-3" /> In Stock
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            {[
                              {
                                title: "History",
                                icon: History,
                                cls: "hover:bg-indigo-500/10 hover:text-indigo-500",
                                fn: () => setHistTarget(item),
                              },
                              {
                                title: "Adjust",
                                icon: Settings2,
                                cls: "hover:bg-sky-500/10 hover:text-sky-500",
                                fn: () => setAdjustTarget(item),
                              },
                              {
                                title: "Transfer",
                                icon: ArrowRightLeft,
                                cls: "hover:bg-violet-500/10 hover:text-violet-500",
                                fn: () => setTransferTarget(item),
                                disabled: item.available === 0,
                              },
                              {
                                title: "Set Minimum",
                                icon: AlertTriangle,
                                cls: "hover:bg-amber-500/10 hover:text-amber-500",
                                fn: () => setMinTarget(item),
                              },
                            ].map((btn) => (
                              <button
                                key={btn.title}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  btn.fn();
                                }}
                                title={btn.title}
                                disabled={(btn as any).disabled}
                                className={cn(
                                  "w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground transition-colors",
                                  btn.cls,
                                  (btn as any).disabled &&
                                    "opacity-30 cursor-not-allowed",
                                )}
                              >
                                <btn.icon className="w-3.5 h-3.5" />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Pagination — matches screenshot style ── */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card">
                <p className="text-sm text-muted-foreground">
                  Showing {startItem} to {endItem} of {totalCount} stock items
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows</span>
                    <div className="relative">
                      <Sel
                        value={String(pageSize)}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        className="h-10 w-[110px] rounded-2xl pr-8"
                      >
                        {[10, 25, 50, 100].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </Sel>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="h-8 px-3 rounded-lg border border-border text-sm disabled:opacity-50 hover:bg-accent flex items-center gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" /> Prev
                  </button>
                  <span className="text-sm font-medium">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="h-8 px-3 rounded-lg border border-border text-sm disabled:opacity-50 hover:bg-accent flex items-center gap-1"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {/* Dialogs */}
      <AddStockDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={fetchAll}
        warehouses={warehouses}
      />
      <AdjustStockDialog
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        item={adjustTarget}
        onSaved={fetchAll}
      />
      <SetMinimumDialog
        open={!!minTarget}
        onClose={() => setMinTarget(null)}
        item={minTarget}
        onSaved={fetchAll}
      />
      <TransferDialog
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        item={transferTarget}
        warehouses={warehouses}
        onSaved={fetchAll}
      />
      <HistoryDialog
        open={!!histTarget}
        onClose={() => setHistTarget(null)}
        item={histTarget}
        onSaved={fetchAll}
      />
      <StockDetailDialog
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        item={detailTarget}
        onViewHistory={() => {
          setDetailTarget(null);
          setHistTarget(detailTarget);
        }}
      />
    </div>
  );
}
