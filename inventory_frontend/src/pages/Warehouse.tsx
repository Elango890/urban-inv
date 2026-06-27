// src/pages/Warehouse.tsx
// Warehouse management — list, create, edit, deactivate, view stock per warehouse

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  ChevronDown,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  Warehouse as WHIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarehouseData {
  id: number;
  name: string;
  location: string;
  is_active: boolean;
  stock_count: number;
  total_qty: number;
  low_count: number;
  manager: string | null;
  created_at: string | null;
}
interface StockItem {
  stock_id: number;
  asset_name: string;
  asset_code: string;
  category: string;
  asset_type: string;
  total_quantity: number;
  damaged_quantity: number;
  assigned: number;
  available: number;
  minimum_stock: number;
  is_low_stock: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";
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

// ─── Warehouse Form Dialog ─────────────────────────────────────────────────────

function WarehouseFormDialog({
  open,
  onClose,
  onSaved,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: WarehouseData | null;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initial) {
      setName(initial.name);
      setLocation(initial.location || "");
      setIsActive(initial.is_active);
    } else {
      setName("");
      setLocation("");
      setIsActive(true);
    }
  }, [open, initial]);

  const submit = async () => {
    if (!name.trim()) {
      setErrors({ name: "Name is required." });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await apiFetch(`/warehouses/${initial!.id}/`, {
          method: "PUT",
          body: JSON.stringify({
            name: name.trim(),
            location: location.trim(),
            is_active: isActive,
          }),
        });
        toast({ title: "Warehouse updated" });
      } else {
        await apiFetch("/warehouses/create/", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            location: location.trim(),
          }),
        });
        toast({ title: "Warehouse created" });
      }
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

  if (!open) return null;
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
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <WHIcon className="w-4 h-4 text-primary" />
            </div>
            <h2 className="font-bold">
              {isEdit ? "Edit Warehouse" : "New Warehouse"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Warehouse Name" error={errors.name} required>
            <Inp
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors({});
              }}
              placeholder="e.g. Main Store, IT Room, Server Room"
              className={errors.name ? "border-rose-400" : ""}
            />
          </Field>
          <Field
            label="Location / Address"
            hint="Building, floor, room number, or address"
          >
            <Inp
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Building A, Floor 2"
            />
          </Field>
          {isEdit && (
            <Field label="Status">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsActive(true)}
                  className={cn(
                    "h-9 px-3 rounded-lg border text-xs font-semibold",
                    isActive
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setIsActive(false)}
                  className={cn(
                    "h-9 px-3 rounded-lg border text-xs font-semibold",
                    !isActive
                      ? "bg-rose-600 text-white border-rose-600"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  Inactive
                </button>
              </div>
            </Field>
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
            onClick={submit}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Warehouse"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Warehouse Detail Dialog ────────────────────────────────────────────────

function WarehouseDetailDialog({
  open,
  onClose,
  warehouse,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  warehouse: WarehouseData | null;
  onEdit: (w: WarehouseData) => void;
}) {
  const [detail, setDetail] = useState<
    (WarehouseData & { stock_items?: StockItem[] }) | null
  >(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !warehouse) return;
    setLoading(true);
    apiFetch(`/warehouses/${warehouse.id}/`)
      .then((d) => setDetail(d))
      .catch(() => setDetail({ ...warehouse }))
      .finally(() => setLoading(false));
  }, [open, warehouse]);

  if (!open || !warehouse) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <WHIcon className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <h2 className="font-bold">{warehouse.name}</h2>
              <p className="text-xs text-muted-foreground">
                {warehouse.location || "No location set"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => warehouse && onEdit(warehouse)}
              className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Stock Items",
                value: warehouse.stock_count,
                cls: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
              },
              {
                label: "Total Units",
                value: warehouse.total_qty,
                cls: "bg-sky-500/10 text-sky-600 border-sky-500/20",
              },
              {
                label: "Low Stock",
                value: warehouse.low_count,
                cls:
                  warehouse.low_count > 0
                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                    : "bg-muted/30 text-muted-foreground border-border",
              },
            ].map((s) => (
              <div
                key={s.label}
                className={cn("rounded-xl border p-3 text-center", s.cls)}
              >
                <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
                  {s.label}
                </p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Stock table */}
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading stock…</span>
            </div>
          ) : detail?.stock_items && detail.stock_items.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Stock in this Warehouse
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b">
                    {[
                      "Item",
                      "Available",
                      "Total",
                      "Damaged",
                      "Min",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.stock_items.map((s) => (
                    <tr
                      key={s.stock_id}
                      className={cn(
                        "border-b/50 hover:bg-muted/20",
                        s.is_low_stock && "bg-amber-500/5",
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-sm">{s.asset_name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {s.asset_code}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {s.available}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {s.total_quantity}
                      </td>
                      <td className="px-3 py-2.5 text-amber-600 tabular-nums">
                        {s.damaged_quantity}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {s.minimum_stock}
                      </td>
                      <td className="px-3 py-2.5">
                        {s.is_low_stock ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">
                            ⚠ Low
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
                            ✓ OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No stock items in this warehouse yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Deactivate Confirm ────────────────────────────────────────────────────────

function DeactivateConfirm({
  open,
  onClose,
  warehouse,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  warehouse: WarehouseData | null;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDeactivate = async () => {
    if (!warehouse) return;
    setLoading(true);
    try {
      await apiFetch(`/warehouses/${warehouse.id}/`, { method: "DELETE" });
      toast({ title: "Warehouse deactivated" });
      onDone();
      onClose();
    } catch (err: any) {
      toast({
        title: "Failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open || !warehouse) return null;
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
            <h3 className="font-bold">Deactivate Warehouse?</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Deactivate <strong>{warehouse.name}</strong>? It will no longer
              appear in dropdowns. Existing stock records are preserved.
            </p>
            {warehouse.total_qty > 0 && (
              <p className="text-xs text-rose-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> This warehouse still has{" "}
                {warehouse.total_qty} units. Transfer or adjust to zero first.
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border text-sm text-muted-foreground hover:bg-accent"
          >
            Keep
          </button>
          <button
            onClick={handleDeactivate}
            disabled={loading || warehouse.total_qty > 0}
            className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{" "}
            Deactivate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Activate Confirm ─────────────────────────────────────────────────────────

function ActivateConfirm({
  open,
  onClose,
  warehouse,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  warehouse: WarehouseData | null;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    if (!warehouse) return;
    setLoading(true);
    try {
      await apiFetch(`/warehouses/${warehouse.id}/`, {
        method: "PUT",
        body: JSON.stringify({ is_active: true }),
      });
      toast({ title: "Warehouse activated" });
      onDone();
      onClose();
    } catch (err: any) {
      toast({
        title: "Failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open || !warehouse) return null;
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
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-bold">Activate Warehouse?</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Activate <strong>{warehouse.name}</strong>? It will appear in
              dropdowns and stock operations.
            </p>
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
            onClick={handleActivate}
            disabled={loading}
            className="flex-1 h-9 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Warehouse() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WarehouseData | null>(null);
  const [viewTarget, setViewTarget] = useState<WarehouseData | null>(null);
  const [deactivateTgt, setDeactivateTgt] = useState<WarehouseData | null>(
    null,
  );
  const [toggleTarget, setToggleTarget] = useState<WarehouseData | null>(null);

  const fetchWarehouses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = showInactive ? "?showInactive=true" : "";
      setWarehouses(await apiFetch(`/warehouses/${params}`));
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return warehouses.filter(
      (w) =>
        !q ||
        w.name.toLowerCase().includes(q) ||
        w.location.toLowerCase().includes(q),
    );
  }, [warehouses, search]);

  const stats = useMemo(
    () => ({
      total: warehouses.length,
      active: warehouses.filter((w) => w.is_active).length,
      totalQty: warehouses.reduce((s, w) => s + w.total_qty, 0),
      lowTotal: warehouses.reduce((s, w) => s + w.low_count, 0),
    }),
    [warehouses],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Warehouses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage physical storage locations for item stock
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Warehouse
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Total",
            value: stats.total,
            cls: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
            icon: WHIcon,
          },
          {
            label: "Active",
            value: stats.active,
            cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
            icon: CheckCircle,
          },
          {
            label: "Total Units",
            value: stats.totalQty,
            cls: "bg-sky-500/10 text-sky-600 border-sky-500/20",
            icon: Package,
          },
          {
            label: "Low Stock",
            value: stats.lowTotal,
            cls:
              stats.lowTotal > 0
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : "bg-muted/30 text-muted-foreground border-border",
            icon: AlertTriangle,
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

      {/* Low stock alert */}
      {stats.lowTotal > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>{stats.lowTotal}</strong> item(s) across your warehouses are
            below minimum stock levels. Visit <strong>Stock Management</strong>{" "}
            to reorder or adjust.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or location…"
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
        <button
          onClick={fetchWarehouses}
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
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">{error}</p>
          </div>
          <button
            onClick={fetchWarehouses}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 rounded-2xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Cards */}
      {!loading &&
        !error &&
        (filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-2xl border border-dashed">
            <WHIcon className="w-12 h-12 text-muted-foreground opacity-30" />
            <div className="text-center">
              <p className="text-sm font-semibold">No warehouses found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {search
                  ? "Try a different search."
                  : "Create your first warehouse."}
              </p>
            </div>
            {!search && (
              <button
                onClick={() => setFormOpen(true)}
                className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> New Warehouse
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((wh) => (
              <div
                key={wh.id}
                className={cn(
                  "rounded-2xl border bg-card p-5 space-y-4 hover:shadow-md transition-all group",
                  !wh.is_active && "opacity-60",
                )}
              >
                {/* Card header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        wh.is_active ? "bg-primary/10" : "bg-muted/50",
                      )}
                    >
                      <WHIcon
                        className={cn(
                          "w-5 h-5",
                          wh.is_active
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground">{wh.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {wh.location || "No location"}
                      </p>
                    </div>
                  </div>
                  {wh.is_active ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
                      Active
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border">
                      Inactive
                    </span>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label: "Items",
                      value: wh.stock_count,
                      color: "text-foreground",
                    },
                    {
                      label: "Units",
                      value: wh.total_qty,
                      color: "text-sky-600 dark:text-sky-400",
                    },
                    {
                      label: "Low ⚠",
                      value: wh.low_count,
                      color:
                        wh.low_count > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl bg-muted/30 border border-border/50 p-2.5 text-center"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {s.label}
                      </p>
                      <p className={cn("text-xl font-bold", s.color)}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Low stock mini-bar */}
                {wh.total_qty > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Stock health</span>
                      <span>
                        {wh.low_count > 0
                          ? `${wh.low_count} item(s) need reorder`
                          : "All items OK"}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          wh.low_count === 0
                            ? "bg-emerald-500"
                            : wh.low_count / Math.max(wh.stock_count, 1) < 0.3
                              ? "bg-amber-400"
                              : "bg-rose-500",
                        )}
                        style={{
                          width: `${wh.stock_count > 0 ? Math.round(((wh.stock_count - wh.low_count) / wh.stock_count) * 100) : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div
                  className="flex items-center gap-2 pt-1 border-t border-border/50 cursor-pointer"
                  onClick={() => setViewTarget(wh)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditTarget(wh);
                    }}
                    className="flex-1 h-8 rounded-lg hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setToggleTarget(wh);
                    }}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                      wh.is_active
                        ? "hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500"
                        : "hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600",
                    )}
                    title={wh.is_active ? "Deactivate" : "Activate"}
                  >
                    {wh.is_active ? (
                      <Trash2 className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* Dialogs */}
      <WarehouseFormDialog
        open={formOpen || !!editTarget}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        onSaved={fetchWarehouses}
        initial={editTarget}
      />
      <WarehouseDetailDialog
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        warehouse={viewTarget}
        onEdit={(w) => {
          setViewTarget(null);
          setEditTarget(w);
        }}
      />
      <DeactivateConfirm
        open={!!deactivateTgt}
        onClose={() => setDeactivateTgt(null)}
        warehouse={deactivateTgt}
        onDone={fetchWarehouses}
      />
      <ActivateConfirm
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        warehouse={toggleTarget}
        onDone={fetchWarehouses}
      />
    </div>
  );
}
