// src/pages/Assets.tsx
// Backend model alignment: masters.Item (previously Asset)

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Barcode,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL =
  (window as Window & { __APP_API_URL__?: string }).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

type ApiError = Error & {
  status?: number;
  body?: unknown;
};

function getBodyError(body: unknown) {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error?: unknown }).error || "Request failed")
    : "Request failed";
}

function getFieldErrors(body: unknown): FormErrors | null {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return null;
  }
  const errors = (body as { errors?: unknown }).errors;
  return typeof errors === "object" && errors !== null
    ? (errors as FormErrors)
    : null;
}

type ItemType = "goods" | "service";
type ItemStatus = "active" | "inactive" | "disposed";

interface WarehouseStock {
  warehouseId: number;
  warehouseName: string;
  available: number;
  total: number;
  damaged: number;
}

interface VendorOption {
  id: number;
  displayName: string;
}

interface Item {
  id: number;
  itemType: ItemType;
  name: string;
  sku: string;
  assetCode?: string;
  unit: string;
  barcode: string;
  isExciseProduct: boolean;
  trackInventory: boolean;
  sellingPrice: number;
  sellingPriceInclVat?: number;
  sellingPriceWithoutVat?: number;
  costPrice: number;
  purchasePrice?: number;
  purchaseCost?: number;
  salesAccount: string;
  purchaseAccount: string;
  salesDescription: string;
  purchaseDescription: string;
  taxRate: number;
  preferredVendor: VendorOption | null;
  status: ItemStatus;
  totalStock: number;
  damagedStock: number;
  inStock: boolean;
  warehouses: WarehouseStock[];
  createdAt: string;
}

interface ItemSummary {
  total: number;
  active: number;
  inStock: number;
  zeroStock: number;
}

interface FormState {
  sku: string;
  name: string;
  itemType: ItemType;
  unit: string;
  barcode: string;
  costPrice: string;
  rspInclVat: string;
  salesDescription: string;
  purchaseDescription: string;
  preferredVendorId: string;
  status: ItemStatus;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

const UNIT_OPTIONS = [
  { value: "pcs", label: "Pieces" },
  { value: "box", label: "Box" },
  { value: "kg", label: "Kilogram" },
  { value: "g", label: "Gram" },
  { value: "l", label: "Litre" },
  { value: "ml", label: "Millilitre" },
  { value: "m", label: "Metre" },
  { value: "cm", label: "Centimetre" },
  { value: "set", label: "Set" },
  { value: "pair", label: "Pair" },
  { value: "doz", label: "Dozen" },
  { value: "hr", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM: FormState = {
  sku: "",
  name: "",
  itemType: "goods",
  unit: "pcs",
  barcode: "",
  costPrice: "0",
  rspInclVat: "0",
  salesDescription: "",
  purchaseDescription: "",
  preferredVendorId: "",
  status: "active",
};

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

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
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
    throw Object.assign(new Error(getBodyError(body)), {
      status: res.status,
      body,
    } satisfies Partial<ApiError>);
  return body;
}

const fmt = (value: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(value || 0);

const rspWithoutVat = (rspInclVat: number) => rspInclVat / 1.05;
const getPurchasePrice = (item: Item) =>
  item.purchasePrice ?? item.costPrice ?? item.purchaseCost ?? 0;
const getSellingPriceInclVat = (item: Item) =>
  item.sellingPriceInclVat ?? item.sellingPrice ?? 0;
const getSellingPriceWithoutVat = (item: Item) =>
  item.sellingPriceWithoutVat ?? rspWithoutVat(getSellingPriceInclVat(item));

function validateForm(form: FormState, isEdit: boolean): FormErrors {
  const errors: FormErrors = {};

  if (!isEdit) {
    if (!form.sku.trim()) errors.sku = "SKU is required.";
    else if (form.sku.trim().length < 2)
      errors.sku = "SKU must be at least 2 characters.";
    else if (form.sku.trim().length > 50)
      errors.sku = "SKU must be 50 characters or less.";
    else if (!/^[A-Za-z0-9_-]+$/.test(form.sku.trim()))
      errors.sku = "Use only letters, numbers, hyphens, and underscores.";
  }

  if (!form.name.trim()) errors.name = "Item name is required.";
  else if (form.name.trim().length < 2)
    errors.name = "Name must be at least 2 characters.";

  if (!form.itemType) errors.itemType = "Item type is required.";
  if (!form.unit) errors.unit = "Unit is required.";

  if (Number.isNaN(Number(form.costPrice)) || Number(form.costPrice) < 0)
    errors.costPrice = "Purchase price must be a non-negative number.";
  if (Number.isNaN(Number(form.rspInclVat)) || Number(form.rspInclVat) < 0)
    errors.rspInclVat = "Selling price incl. VAT must be a non-negative number.";

  return errors;
}

const Field = ({
  label,
  error,
  children,
  required,
  hint,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
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
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        {error}
      </p>
    )}
  </div>
);

const Inp = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
      className,
    )}
  />
);

const Sel = ({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  children: React.ReactNode;
}) => (
  <select
    {...props}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none",
      className,
    )}
  >
    {children}
  </select>
);

const Textarea = ({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={cn(
      "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none",
      className,
    )}
  />
);

const StatCard = ({
  label,
  value,
  sub,
  icon: Icon,
  cls,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  cls: string;
}) => (
  <div className={cn("rounded-2xl border p-4 flex items-center gap-3", cls)}>
    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const ItemTypeBadge = ({ type }: { type: string }) => {
  const cfg =
    type === "service"
      ? "bg-violet-500/10 text-violet-600 border-violet-500/20"
      : "bg-sky-500/10 text-sky-600 border-sky-500/20";
  return (
    <span
      className={cn(
        "text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize",
        cfg,
      )}
    >
      {type}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const cfg = {
    active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    inactive: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    disposed: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  };
  return (
    <span
      className={cn(
        "text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize",
        cfg[status as keyof typeof cfg] ?? cfg.inactive,
      )}
    >
      {status}
    </span>
  );
};

const Confirm = ({
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
}) => {
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
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center flex-shrink-0">
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
};

function ItemFormDialog({
  open,
  onClose,
  onSaved,
  initial,
  vendors,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: Item | null;
  vendors: VendorOption[];
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        sku: initial.sku || initial.assetCode || "",
        name: initial.name,
        itemType: initial.itemType,
        unit: initial.unit || "pcs",
        barcode: initial.barcode || "",
        costPrice: String(
          initial.purchasePrice ?? initial.costPrice ?? initial.purchaseCost ?? 0,
        ),
        rspInclVat: String(initial.sellingPriceInclVat ?? initial.sellingPrice ?? 0),
        salesDescription: initial.salesDescription || "",
        purchaseDescription: initial.purchaseDescription || "",
        preferredVendorId: initial.preferredVendor
          ? String(initial.preferredVendor.id)
          : "",
        status: initial.status,
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
    setErrors({});
  }, [open, initial]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = async () => {
    const nextErrors = validateForm(form, isEdit);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        itemType: form.itemType,
        unit: form.unit,
        barcode: form.barcode.trim(),
        purchasePrice: Number(form.costPrice || 0),
        sellingPriceInclVat: Number(form.rspInclVat || 0),
        salesDescription: form.salesDescription.trim(),
        purchaseDescription: form.purchaseDescription.trim(),
        taxRate: 5,
        preferredVendorId: form.preferredVendorId
          ? Number(form.preferredVendorId)
          : null,
        status: form.status,
      };
      const url = isEdit
        ? `/api/masters/assets/${initial!.id}/`
        : "/api/masters/assets/create/";
      const method = isEdit ? "PUT" : "POST";
      await apiFetch(url, { method, body: JSON.stringify(payload) });
      toast({ title: isEdit ? "Item updated" : "Item created" });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const fieldErrors = getFieldErrors((err as ApiError).body);
      if (fieldErrors) {
        setErrors(fieldErrors);
      } else {
        toast({
          title: "Failed",
          description: getApiErrorMessage(err),
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const goodsFieldsEnabled = form.itemType === "goods";

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
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Package className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">
                {isEdit ? "Edit Item" : "New Item"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isEdit ? form.sku : "Add goods or service to the catalogue"}
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
          <div className="rounded-xl border border-border p-4 space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Identity
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field
                label="SKU"
                error={errors.sku}
                required
                hint="Unique item code. Cannot be changed after creation."
              >
                <Inp
                  value={form.sku}
                  onChange={(e) => set("sku", e.target.value)}
                  disabled={isEdit}
                  placeholder="e.g. ITEM-001"
                  className={cn(
                    isEdit && "opacity-60 cursor-not-allowed",
                    errors.sku && "border-rose-500",
                  )}
                  maxLength={50}
                />
              </Field>
              <Field label="Item Name" error={errors.name} required>
                <Inp
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Dell Latitude Laptop"
                  className={errors.name ? "border-rose-500" : ""}
                  maxLength={200}
                />
              </Field>
              <Field label="Item Type" error={errors.itemType} required>
                <div className="relative">
                  <Sel
                    value={form.itemType}
                    onChange={(e) =>
                      set("itemType", e.target.value as ItemType)
                    }
                  >
                    <option value="goods">Goods</option>
                    <option value="service">Service</option>
                  </Sel>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Physical Details
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Unit" error={errors.unit} required>
                <div className="relative">
                  <Sel
                    value={form.unit}
                    onChange={(e) => set("unit", e.target.value)}
                  >
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </Sel>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
              <Field label="Barcode">
                <Inp
                  value={form.barcode}
                  onChange={(e) => set("barcode", e.target.value)}
                  disabled={!goodsFieldsEnabled}
                  placeholder="Barcode or EAN"
                />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Pricing
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field label="Purchase Price" error={errors.costPrice}>
                <Inp
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => set("costPrice", e.target.value)}
                  className={errors.costPrice ? "border-rose-500" : ""}
                />
              </Field>
              <Field label="Selling Price Incl. VAT" error={errors.rspInclVat}>
                <Inp
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rspInclVat}
                  onChange={(e) => set("rspInclVat", e.target.value)}
                  className={errors.rspInclVat ? "border-rose-500" : ""}
                />
              </Field>
              <Field label="Selling Price Excl. VAT">
                <Inp
                  type="number"
                  value={rspWithoutVat(Number(form.rspInclVat || 0)).toFixed(2)}
                  readOnly
                  className="bg-muted/40 text-muted-foreground"
                />
              </Field>
              <Field label="Preferred Vendor">
                <div className="relative">
                  <Sel
                    value={form.preferredVendorId}
                    onChange={(e) => set("preferredVendorId", e.target.value)}
                  >
                    <option value="">No preferred vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.displayName}
                      </option>
                    ))}
                  </Sel>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Descriptions
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Sales Description">
                <Textarea
                  value={form.salesDescription}
                  onChange={(e) => set("salesDescription", e.target.value)}
                  rows={3}
                  placeholder="Description printed on sales documents"
                />
              </Field>
              <Field label="Purchase Description">
                <Textarea
                  value={form.purchaseDescription}
                  onChange={(e) => set("purchaseDescription", e.target.value)}
                  rows={3}
                  placeholder="Description printed on purchase documents"
                />
              </Field>
            </div>
          </div>

          {isEdit && (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Status
              </p>
              <div className="flex gap-3">
                {(["active", "inactive", "disposed"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => set("status", status)}
                    className={cn(
                      "flex-1 h-9 rounded-xl text-xs font-semibold border transition-colors capitalize",
                      form.status === status
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {status}
                  </button>
                ))}
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
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  item,
  onClose,
  onEdit,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  const [tab, setTab] = useState<"info" | "stock">("info");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Package className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-foreground font-mono">
                  {item.sku || item.assetCode}
                </h2>
                <StatusBadge status={item.status} />
                <ItemTypeBadge type={item.itemType} />
              </div>
              <p className="text-xs text-muted-foreground">{item.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(item)}
              className="h-8 px-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] font-semibold text-amber-600 hover:bg-amber-500/15 flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            <button
              onClick={() => onDelete(item)}
              disabled={item.totalStock > 0}
              className="h-8 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/15 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-5 pt-4">
          {(["info", "stock"] as const).map((panel) => (
            <button
              key={panel}
              onClick={() => setTab(panel)}
              className={cn(
                "h-8 px-3.5 rounded-lg text-xs font-semibold border transition-colors capitalize",
                tab === panel
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {panel === "stock" ? "Stock Levels" : "Info"}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === "info" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Item Type", item.itemType],
                  ["Unit", item.unit || "-"],
                  ["Barcode", item.barcode || "-"],
                  ["Purchase Price", fmt(getPurchasePrice(item))],
                  ["Selling Price Incl. VAT", fmt(getSellingPriceInclVat(item))],
                  ["Selling Price Excl. VAT", fmt(getSellingPriceWithoutVat(item))],
                  ["Preferred Vendor", item.preferredVendor?.displayName || "-"],
                ].map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-xl bg-muted/30 border border-border p-3"
                  >
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                      {key}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              {(item.salesDescription || item.purchaseDescription) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {item.salesDescription && (
                    <div className="rounded-xl bg-muted/30 border border-border p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                        Sales Description
                      </p>
                      <p className="text-sm text-foreground">
                        {item.salesDescription}
                      </p>
                    </div>
                  )}
                  {item.purchaseDescription && (
                    <div className="rounded-xl bg-muted/30 border border-border p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                        Purchase Description
                      </p>
                      <p className="text-sm text-foreground">
                        {item.purchaseDescription}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "stock" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {[
                  [
                    "Available",
                    item.totalStock,
                    "text-emerald-600 dark:text-emerald-400",
                  ],
                  [
                    "Damaged",
                    item.damagedStock,
                    "text-amber-600 dark:text-amber-400",
                  ],
                  [
                    "Tracking",
                    item.trackInventory ? "On" : "Off",
                    "text-sky-600 dark:text-sky-400",
                  ],
                ].map(([label, value, cls]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl bg-muted/30 border border-border p-3 text-center"
                  >
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {label}
                    </p>
                    <p className={cn("text-2xl font-bold", cls)}>{value}</p>
                  </div>
                ))}
              </div>
              {item.warehouses?.length ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      By Warehouse
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {item.warehouses.map((warehouse) => (
                      <div
                        key={warehouse.warehouseId}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <Warehouse className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {warehouse.warehouseName}
                          </p>
                          <div className="w-full h-1.5 rounded-full bg-muted/50 mt-1 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{
                                width: `${
                                  warehouse.total > 0
                                    ? (warehouse.available / warehouse.total) *
                                      100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <p className="font-bold text-foreground">
                            {warehouse.available} avail
                          </p>
                          <p className="text-muted-foreground">
                            {warehouse.total} total
                            {warehouse.damaged > 0
                              ? ` / ${warehouse.damaged} damaged`
                              : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Warehouse className="w-8 h-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">
                    No stock in any warehouse yet.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Assets() {
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<ItemSummary | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Item | null>(null);
  const [viewTarget, setViewTarget] = useState<Item | null>(null);
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    desc: "",
    btnLabel: "",
    btnCls: "",
    onConfirm: () => {},
    loading: false,
  });

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("itemType", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("page", String(currentPage));
      params.set("page_size", String(pageSize));

      const data = (await apiFetch(`/api/masters/assets/?${params}`)) as
        | Item[]
        | {
            results: Item[];
            summary?: ItemSummary;
            count?: number;
            total_pages?: number;
          };

      if (Array.isArray(data)) {
        setItems(data);
        setSummary({
          total: data.length,
          active: data.filter((item) => item.status === "active").length,
          inStock: data.filter((item) => item.totalStock > 0).length,
          zeroStock: data.filter(
            (item) => item.status === "active" && item.totalStock === 0,
          ).length,
        });
        setTotalItems(data.length);
        setTotalPages(Math.max(1, Math.ceil(data.length / pageSize)));
      } else {
        setItems(data.results ?? []);
        setSummary(data.summary ?? null);
        setTotalItems(data.count ?? data.results?.length ?? 0);
        setTotalPages(data.total_pages ?? 1);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    apiFetch("/api/masters/suppliers/")
      .then((data) =>
        setVendors(
          (data as VendorOption[]).map((vendor) => ({
            id: vendor.id,
            displayName: vendor.displayName,
          })),
        ),
      )
      .catch(() => setVendors([]));
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, statusFilter, pageSize]);

  const openDetail = async (item: Item) => {
    try {
      setViewTarget((await apiFetch(`/api/masters/assets/${item.id}/`)) as Item);
    } catch {
      setViewTarget(item);
    }
  };

  const doDelete = (item: Item) => {
    setConfirm({
      open: true,
      loading: false,
      title: "Delete Item",
      desc: `Delete '${item.name}' (${item.sku || item.assetCode})? This cannot be undone. Stock must be cleared first.`,
      btnLabel: "Delete",
      btnCls: "bg-rose-600 hover:bg-rose-700",
      onConfirm: async () => {
        setConfirm((current) => ({ ...current, loading: true }));
        try {
          const result = (await apiFetch(`/api/masters/assets/${item.id}/`, {
            method: "DELETE",
          })) as { message?: string; archived?: boolean };
          toast({
            title: result?.archived ? "Item archived" : "Item deleted",
            description: result?.message,
          });
          fetchItems();
        } catch (err: unknown) {
          toast({
            title: "Delete failed",
            description: getApiErrorMessage(err),
            variant: "destructive",
          });
        } finally {
          setConfirm((current) => ({
            ...current,
            open: false,
            loading: false,
          }));
        }
      },
    });
  };

  const stats = useMemo(
    () => ({
      total: summary?.total ?? totalItems,
      active: summary?.active ?? 0,
      inStock: summary?.inStock ?? 0,
      zeroStock: summary?.zeroStock ?? 0,
      services: items.filter((item) => item.itemType === "service").length,
    }),
    [summary, totalItems, items],
  );

  const hasFilters = search || typeFilter || statusFilter;
  const startIndex = (currentPage - 1) * pageSize;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Items
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Goods and services catalogue with stock, pricing, accounts, and VAT
            defaults
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Item
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total Items"
          value={stats.total}
          icon={Package}
          cls="bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
        />
        <StatCard
          label="Active"
          value={stats.active}
          icon={CheckCircle}
          cls="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
        />
        <StatCard
          label="In Stock"
          value={stats.inStock}
          icon={Warehouse}
          cls="bg-sky-500/10 text-sky-600 border-sky-500/20"
          sub="Goods with units"
        />
        <StatCard
          label="Zero Stock"
          value={stats.zeroStock}
          icon={AlertTriangle}
          cls="bg-amber-500/10 text-amber-600 border-amber-500/20"
          sub="Active goods"
        />
        <StatCard
          label="Services"
          value={stats.services}
          icon={Barcode}
          cls="bg-violet-500/10 text-violet-600 border-violet-500/20"
        />
      </div>

      {stats.zeroStock > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <strong>{stats.zeroStock}</strong> active item
            {stats.zeroStock !== 1 ? "s have" : " has"} zero stock. Create a
            Purchase Entry to restock goods.
          </p>
          <button
            onClick={() => setStatusFilter("active")}
            className="ml-auto text-xs font-semibold text-amber-600 hover:underline flex-shrink-0"
          >
            Filter active
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SKU..."
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
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-32 h-9"
          >
            <option value="">All Types</option>
            <option value="goods">Goods</option>
            <option value="service">Service</option>
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <div className="relative">
          <Sel
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-32 h-9"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="disposed">Disposed</option>
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <button
          onClick={fetchItems}
          disabled={loading}
          className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />{" "}
          Refresh
        </button>
        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setTypeFilter("");
              setStatusFilter("");
            }}
            className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">
              Failed to load items
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={fetchItems}
            className="h-8 px-3 rounded-lg bg-rose-500/15 text-rose-600 text-xs font-medium hover:bg-rose-500/25 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-16 rounded-xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <Package className="w-8 h-8 text-muted-foreground opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  No items found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {hasFilters
                    ? "Try adjusting your filters."
                    : "Create your first item to get started."}
                </p>
              </div>
              {!hasFilters && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> New Item
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    {[
                      "Item / SKU",
                      "Type",
                      "Unit",
                      "Stock",
                      "Pricing",
                      "Status",
                      "Actions",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/20 transition-colors group cursor-pointer",
                        item.totalStock === 0 &&
                          item.status === "active" &&
                          item.trackInventory &&
                          "bg-amber-500/5",
                      )}
                      onClick={() => openDetail(item)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                              item.itemType === "service"
                                ? "bg-violet-500/10"
                                : "bg-sky-500/10",
                            )}
                          >
                            <Package
                              className={cn(
                                "w-4 h-4",
                                item.itemType === "service"
                                  ? "text-violet-500"
                                  : "text-sky-500",
                              )}
                            />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground text-sm">
                              {item.name}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs text-muted-foreground font-mono">
                                {item.sku || item.assetCode}
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ItemTypeBadge type={item.itemType} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border border-border font-medium">
                          {item.unit || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.trackInventory ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "text-sm font-bold",
                                  item.totalStock > 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-amber-600 dark:text-amber-400",
                                )}
                              >
                                {item.totalStock}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                available
                              </span>
                              {item.totalStock === 0 &&
                                item.status === "active" && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                )}
                            </div>
                            {item.damagedStock > 0 && (
                              <p className="text-xs text-amber-600 dark:text-amber-400">
                                {item.damagedStock} damaged
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not tracked
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                          Purchase:{" "}
                          <span className="font-medium text-foreground">
                            {fmt(getPurchasePrice(item))}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Selling incl. VAT:{" "}
                          <span className="font-medium text-foreground">
                            {fmt(getSellingPriceInclVat(item))}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Selling excl. VAT:{" "}
                          <span className="font-medium text-foreground">
                            {fmt(getSellingPriceWithoutVat(item))}
                          </span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(item);
                            }}
                            title="Edit"
                            className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-muted-foreground hover:text-amber-500"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              doDelete(item);
                            }}
                            title="Delete"
                            disabled={item.totalStock > 0}
                            className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-6 py-5 border-t border-border bg-muted/10">
                <p className="text-sm text-muted-foreground">
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {startIndex + 1}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium text-foreground">
                    {Math.min(startIndex + items.length, totalItems)}
                  </span>{" "}
                  of{" "}
                  <span className="font-medium text-foreground">
                    {totalItems}
                  </span>{" "}
                  records
                </p>

                <div className="flex items-center gap-4">
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
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="flex items-center gap-1 h-10 px-5 rounded-xl border border-border bg-background text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </button>

                  <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                    Page {currentPage} of {totalPages || 1}
                  </span>

                  <button
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="flex items-center gap-1 h-10 px-5 rounded-xl border border-border bg-background text-sm text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ItemFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchItems}
        vendors={vendors}
      />
      <ItemFormDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={fetchItems}
        initial={editTarget}
        vendors={vendors}
      />
      {viewTarget && (
        <DetailPanel
          item={viewTarget}
          onClose={() => setViewTarget(null)}
          onEdit={(item) => {
            setViewTarget(null);
            setEditTarget(item);
          }}
          onDelete={(item) => doDelete(item)}
        />
      )}
      <Confirm
        {...confirm}
        onClose={() => setConfirm((current) => ({ ...current, open: false }))}
      />
    </div>
  );
}
