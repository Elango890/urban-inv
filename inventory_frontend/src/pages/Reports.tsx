// src/pages/Reports.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Warehouse,
  X,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth, useFYParam } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportDef {
  id: string;
  name: string;
  description: string;
}
interface Category {
  title: string;
  icon: string;
  color: string;
  reports: ReportDef[];
}
interface Stats {
  totalAssets: number;
  purchaseOutstanding: number;
  salesOutstanding: number;
  totalSuppliers: number;
  lowStockItems: number;
  totalInvoices: number;
}
interface Preview {
  title: string;
  headers: string[];
  rows: string[][];
  total: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
}

type ColumnSelection = string[];
type FilterDef = {
  id: string;
  label: string;
  type: "select" | "text";
  options?: { value: string; label: string }[];
};

// ─── API ──────────────────────────────────────────────────────────────────────

const API_URL =
  (window as any).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

function getToken(): string {
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
  const res = await fetch(`${API_URL}/api/reports${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers ?? {}) },
  });

  if (res.status === 401) {
    window.sessionStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Request failed");
    return body;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || "Request failed");
  }
  return res;
}

async function downloadFile(
  path: string,
  payload: object,
  filename: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/reports${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = await res.json();
      throw new Error(b.error ?? "Download failed");
    }
    const text = await res.text();
    throw new Error(text || "Download failed");
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

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(v);

// ─── Filter definitions per report ───────────────────────────────────────────

const FILTER_DEFS: Record<string, FilterDef[]> = {
  "sales-summary": [
    {
      id: "payment_status",
      label: "Payment Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "unpaid", label: "Unpaid" },
        { value: "partial", label: "Partial" },
        { value: "paid", label: "Paid" },
      ],
    },
    { id: "customer_name", label: "Customer Name", type: "text" },
  ],
  "sales-by-customer": [
    { id: "search", label: "Customer Search", type: "text" },
  ],
  "sales-by-item": [{ id: "search", label: "Item Search", type: "text" }],
  "sales-by-salesperson": [
    { id: "salesperson_name", label: "Salesperson Search", type: "text" },
    {
      id: "payment_status",
      label: "Payment Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "unpaid", label: "Unpaid" },
        { value: "partial", label: "Partial" },
        { value: "paid", label: "Paid" },
      ],
    },
  ],
  "salesperson-collections": [
    { id: "salesperson_name", label: "Salesperson Search", type: "text" },
    {
      id: "payment_method",
      label: "Payment Method",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "cash", label: "Cash" },
        { value: "card", label: "Card" },
        { value: "bank_transfer", label: "Bank Transfer" },
        { value: "cheque", label: "Cheque" },
        { value: "credit", label: "Credit / Outstanding" },
        { value: "upi", label: "UPI" },
        { value: "other", label: "Other" },
      ],
    },
  ],
  "sales-returns": [
    { id: "search", label: "Customer / Return / Invoice", type: "text" },
    {
      id: "status",
      label: "Return Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "draft", label: "Draft" },
        { value: "confirmed", label: "Confirmed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],
  "sales-returns-by-customer": [
    { id: "search", label: "Customer Search", type: "text" },
    {
      id: "status",
      label: "Return Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "draft", label: "Draft" },
        { value: "confirmed", label: "Confirmed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],
  "payment-collection": [
    { id: "search", label: "Customer / Invoice / Ref", type: "text" },
  ],
  outstanding: [{ id: "search", label: "Customer Search", type: "text" }],
  "purchase-summary": [
    {
      id: "payment_status",
      label: "Payment Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "unpaid", label: "Unpaid" },
        { value: "partial", label: "Partial" },
        { value: "paid", label: "Paid" },
      ],
    },
    { id: "search", label: "Supplier Search", type: "text" },
  ],
  "purchase-by-supplier": [
    { id: "search", label: "Supplier Search", type: "text" },
  ],
  "purchase-entries": [
    { id: "search", label: "Supplier Search", type: "text" },
  ],
  "purchase-orders": [
    {
      id: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "draft", label: "Draft" },
        { value: "submitted", label: "Submitted" },
        { value: "approved", label: "Approved" },
        { value: "received", label: "Received" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ],
  "purchase-payments": [
    { id: "search", label: "Supplier / Entry / Ref", type: "text" },
  ],
  "supplier-outstanding": [
    { id: "search", label: "Supplier Search", type: "text" },
  ],
  "stock-summary": [
    { id: "warehouse", label: "Warehouse", type: "text" },
    { id: "search", label: "Asset Search", type: "text" },
  ],
  "stock-low": [
    { id: "warehouse", label: "Warehouse", type: "text" },
    { id: "search", label: "Asset Search", type: "text" },
  ],
  "stock-movement": [
    { id: "warehouse", label: "Warehouse", type: "text" },
    { id: "search", label: "Asset Search", type: "text" },
    {
      id: "movement_type",
      label: "Movement Type",
      type: "select",
      options: [
        { value: "", label: "All" },
        { value: "purchase_receipt", label: "Purchase Receipt" },
        { value: "add", label: "Manual Add" },
        { value: "remove", label: "Manual Remove" },
        { value: "damaged", label: "Damaged" },
        { value: "transfer_in", label: "Transfer In" },
        { value: "transfer_out", label: "Transfer Out" },
        { value: "allocated", label: "Allocated" },
        { value: "returned", label: "Returned" },
      ],
    },
  ],
  "supplier-list": [{ id: "search", label: "Supplier Search", type: "text" }],
  "supplier-detail": [{ id: "search", label: "Supplier Search", type: "text" }],
  "customer-list": [{ id: "search", label: "Customer Search", type: "text" }],
  "customer-detail": [{ id: "search", label: "Customer Search", type: "text" }],
};

const CAT_ICON_MAP: Record<string, React.ElementType> = {
  "Sales Reports": TrendingUp,
  "Purchase Reports": Package,
  "Inventory Reports": Warehouse,
  "Supplier & Customer": Users,
};

const STAT_COLORS = [
  "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
  "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  "bg-rose-500/10 text-rose-700 border-rose-500/20",
  "bg-sky-500/10 text-sky-700 border-sky-500/20",
  "bg-amber-500/10 text-amber-700 border-amber-500/20",
  "bg-teal-500/10 text-teal-700 border-teal-500/20",
];

// ─── Atoms ────────────────────────────────────────────────────────────────────

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground",
      "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
      "focus:border-primary transition-colors",
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
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground",
      "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
      "transition-colors appearance-none cursor-pointer",
      className,
    )}
  >
    {children}
  </select>
);

// ─── Download dialog ──────────────────────────────────────────────────────────

const FORMAT_OPTIONS = [
  {
    id: "pdf",
    label: "PDF Document",
    ext: "pdf",
    icon: FileText,
    cls: "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500",
    desc: "Formatted, print-ready report",
  },
  {
    id: "xlsx",
    label: "Excel Spreadsheet",
    ext: "xlsx",
    icon: FileSpreadsheet,
    cls: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500",
    desc: "Editable workbook with styling",
  },
  {
    id: "csv",
    label: "CSV File",
    ext: "csv",
    icon: Download,
    cls: "bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-500",
    desc: "Raw data for custom analysis",
  },
] as const;

type DownloadFormatId = (typeof FORMAT_OPTIONS)[number]["id"];

function DownloadDialog({
  open,
  onClose,
  onPreview,
  report,
}: {
  open: boolean;
  onClose: () => void;
  onPreview: (format: DownloadFormatId) => void;
  report: ReportDef | null;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open || !report) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Download report"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-bold text-foreground text-base">
              Download Report
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {report.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {FORMAT_OPTIONS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                onClick={() => {
                  onPreview(f.id);
                  onClose();
                }}
                className={cn(
                  "w-full h-14 rounded-xl text-white text-sm font-semibold",
                  "flex items-center gap-3 px-4 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  f.cls,
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <div className="text-left">
                  <div>Preview {f.label}</div>
                  <div className="text-[10px] opacity-70 font-normal">
                    Review before downloading
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DownloadPreviewDialog({
  open,
  onClose,
  report,
  format,
  preview,
  previewLoading,
  ensurePreview,
  onPrev,
  onNext,
  pageSize,
  onPageSizeChange,
  dateFrom,
  dateTo,
  extraFilters,
  financialYearId,
  selectedColumns,
}: {
  open: boolean;
  onClose: () => void;
  report: ReportDef | null;
  format: DownloadFormatId | null;
  preview: Preview | null;
  previewLoading: boolean;
  ensurePreview: () => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  dateFrom: string;
  dateTo: string;
  extraFilters: Record<string, string>;
  financialYearId?: number | null;
  selectedColumns: ColumnSelection;
}) {
  const [busy, setBusy] = useState(false);

  const formatOption =
    FORMAT_OPTIONS.find((option) => option.id === format) ?? null;
  const FormatIcon = formatOption?.icon;

  useEffect(() => {
    if (!open || !report || !formatOption || preview || previewLoading) return;
    void ensurePreview();
  }, [open, report, formatOption, preview, previewLoading, ensurePreview]);

  if (!open || !report || !formatOption || !FormatIcon) return null;

  const doDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadFile(
        "/generate/",
        {
          report_type: report.id,
          format: formatOption.id,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          filters: extraFilters,
          selected_columns: selectedColumns,
          financialYearId: financialYearId || undefined,
        },
        `${report.name.replace(/\s+/g, "_")}.${formatOption.ext}`,
      );
      toast({
        title: `${report.name} downloaded as ${formatOption.id.toUpperCase()}`,
      });
      onClose();
    } catch (e: any) {
      toast({
        title: "Download failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const activeFilters = Object.entries(extraFilters).filter(
    ([, value]) => value,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Download preview"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-foreground text-base">
              {formatOption.label} Preview
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {report.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Format
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatOption.label}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Period
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {dateFrom || "Start"} - {dateTo || "End"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Filters
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {activeFilters.length === 0
                  ? "No extra filters"
                  : `${activeFilters.length} applied`}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <PreviewTable
              preview={preview}
              loading={previewLoading}
              onPrev={onPrev}
              onNext={onNext}
              pageSize={pageSize}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={doDownload}
            disabled={busy || previewLoading}
            className={cn(
              "h-10 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50 transition-colors",
              formatOption.cls,
            )}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FormatIcon className="w-4 h-4" />
            )}
            Download {formatOption.ext.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnPicker({
  columns,
  selectedColumns,
  onToggle,
  onSelectAll,
}: {
  columns: string[];
  selectedColumns: ColumnSelection;
  onToggle: (column: string) => void;
  onSelectAll: () => void;
}) {
  if (columns.length === 0) return null;

  const allSelected = selectedColumns.length === columns.length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">Columns</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select only the columns you want in preview and downloads.
          </p>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {allSelected ? "Keep all" : "Select all"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {columns.map((column) => {
          const checked = selectedColumns.includes(column);
          return (
            <label
              key={column}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors cursor-pointer",
                checked
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent/50",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(column)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <span className="leading-tight">{column}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Preview table ────────────────────────────────────────────────────────────

function PreviewTable({
  preview,
  loading,
  onPrev,
  onNext,
  pageSize,
  onPageSizeChange,
}: {
  preview: Preview | null;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading preview…</span>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <BarChart3 className="w-8 h-8 opacity-20" />
        <p className="text-sm">
          Set filters and click <strong>Refresh</strong> to preview data
        </p>
      </div>
    );
  }

  const page = preview.page ?? 1;
  const currentPageSize = preview.page_size ?? preview.rows.length;
  const totalPages = preview.total_pages ?? 1;
  const showingFrom =
    preview.total === 0 ? 0 : (page - 1) * currentPageSize + 1;
  const showingTo = Math.min(page * currentPageSize, preview.total);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">{preview.title}</h3>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {preview.total.toLocaleString()} row
          {preview.total !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/80 border-b border-border">
                {preview.headers.map((h, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={preview.headers.length}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    <AlertCircle className="w-5 h-5 mx-auto mb-1 opacity-40" />
                    No data found for the selected filters.
                  </td>
                </tr>
              ) : (
                preview.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={cn(
                      "border-b border-border/50 transition-colors",
                      row.some((c) =>
                        String(c).trim().toUpperCase().startsWith("TOTAL"),
                      )
                        ? "bg-muted font-semibold"
                        : ri % 2 === 0
                          ? "bg-background hover:bg-muted/20"
                          : "bg-muted/10 hover:bg-muted/30",
                    )}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 text-foreground whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {preview.total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span>
              {totalPages > 1
                ? `Showing ${showingFrom}–${showingTo} of ${preview.total.toLocaleString()}`
                : `${preview.total.toLocaleString()} total rows`}
            </span>
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <div className="relative">
                <Sel
                  value={String(pageSize)}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="h-8 w-24 pr-8 text-xs rounded-lg"
                >
                  {[25, 50, 100, 200].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={onPrev}
                disabled={page <= 1}
                className="h-7 px-3 rounded-lg border border-border text-xs disabled:opacity-40 hover:bg-accent transition-colors"
              >
                ← Prev
              </button>
              <span className="px-1">
                {page} / {totalPages}
              </span>
              <button
                onClick={onNext}
                disabled={page >= totalPages}
                className="h-7 px-3 rounded-lg border border-border text-xs disabled:opacity-40 hover:bg-accent transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Quick download strip (below preview) ─────────────────────────────────────

function QuickDownload({
  onOpenPreview,
}: {
  onOpenPreview: (format: DownloadFormatId) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {[
        {
          fmt: "pdf",
          ext: "pdf",
          label: "PDF",
          cls: "bg-rose-600 hover:bg-rose-700 text-white",
          Icon: FileText,
        },
        {
          fmt: "xlsx",
          ext: "xlsx",
          label: "Excel",
          cls: "bg-emerald-600 hover:bg-emerald-700 text-white",
          Icon: FileSpreadsheet,
        },
        {
          fmt: "csv",
          ext: "csv",
          label: "CSV",
          cls: "bg-sky-600 hover:bg-sky-700 text-white",
          Icon: Download,
        },
      ].map(({ fmt, ext, label, cls, Icon }) => (
        <button
          key={fmt}
          onClick={() => onOpenPreview(fmt as DownloadFormatId)}
          className={cn(
            "h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5",
            "transition-colors",
            cls,
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string | number | undefined;
  colorClass: string;
}) {
  return (
    <div className={cn("rounded-2xl border p-3 transition-all", colorClass)}>
      <p className="text-[10px] font-bold opacity-60 uppercase tracking-wider leading-none mb-1">
        {label}
      </p>
      <p className="text-base font-bold leading-none">{value ?? "—"}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Reports() {
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(
    "Sales Reports",
  );
  const [sidebarSearch, setSidebarSearch] = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [extraFilters, setExtra] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedColumns, setSelectedColumns] = useState<ColumnSelection>([]);

  const [dlOpen, setDlOpen] = useState(false);
  const [downloadPreviewFormat, setDownloadPreviewFormat] =
    useState<DownloadFormatId | null>(null);

  // ── Load sidebar + stats ───────────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/types/")
      .then((d: any) => setCategories(d.categories || []))
      .catch(() => {});

    apiFetch(withFY("/stats/"))
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [withFY]);

  // ── Preview runner ─────────────────────────────────────────────────────────
  const runPreview = useCallback(
    async (page = 1) => {
      if (!selectedReport) return;
      setPreviewLoading(true);
      setPreviewPage(page);
      try {
        const data = await apiFetch("/preview/", {
          method: "POST",
          body: JSON.stringify({
            report_type: selectedReport.id,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            filters: extraFilters,
            selected_columns: selectedColumns,
            financialYearId: selectedFY?.id,
            page,
            page_size: pageSize,
          }),
        });
        setPreview(data as Preview);
      } catch (e: any) {
        toast({
          title: "Preview failed",
          description: e.message,
          variant: "destructive",
        });
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [
      selectedReport,
      dateFrom,
      dateTo,
      extraFilters,
      selectedColumns,
      selectedFY,
      pageSize,
    ],
  );

  // Reset page when filters change
  useEffect(() => {
    setPreviewPage(1);
    setPreview(null);
  }, [dateFrom, dateTo, extraFilters, selectedReport, pageSize]);

  const selectReport = (r: ReportDef) => {
    setSelectedReport(r);
    setPreview(null);
    setExtra({});
    setPreviewPage(1);
    setSelectedColumns([]);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setExtra({});
  };

  const hasActiveFilters =
    dateFrom || dateTo || Object.values(extraFilters).some(Boolean);

  const openDownloadPreview = (format: DownloadFormatId) => {
    setDownloadPreviewFormat(format);
  };

  useEffect(() => {
    if (!preview?.headers?.length) return;
    setSelectedColumns((current) => {
      if (current.length === 0) return preview.headers;
      const next = current.filter((column) => preview.headers.includes(column));
      return next.length > 0 ? next : preview.headers;
    });
  }, [preview?.headers]);

  const displayedPreview = useMemo(() => {
    if (!preview) return null;
    if (selectedColumns.length === 0) return preview;

    const keptHeaders = preview.headers.filter((header) =>
      selectedColumns.includes(header),
    );
    if (keptHeaders.length === 0) return preview;

    const keptIndices = keptHeaders.map((header) =>
      preview.headers.indexOf(header),
    );
    return {
      ...preview,
      headers: keptHeaders,
      rows: preview.rows.map((row) =>
        keptIndices.map((idx) =>
          idx >= 0 && idx < row.length ? row[idx] : "",
        ),
      ),
    };
  }, [preview, selectedColumns]);

  const toggleColumn = (column: string) => {
    setSelectedColumns((current) => {
      if (current.includes(column)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== column);
      }
      return [...current, column];
    });
  };

  // ── Filtered sidebar ───────────────────────────────────────────────────────
  const filteredCats = useMemo(() => {
    if (!sidebarSearch) return categories;
    const q = sidebarSearch.toLowerCase();
    return categories
      .map((c) => ({
        ...c,
        reports: c.reports.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.reports.length > 0);
  }, [categories, sidebarSearch]);

  const filterDefs: FilterDef[] = selectedReport
    ? FILTER_DEFS[selectedReport.id] || []
    : [];

  // ── Stats labels ───────────────────────────────────────────────────────────
  const STAT_LABELS = [
    {
      label: "Purchase Due",
      value: stats ? fmtCurrency(stats.purchaseOutstanding) : undefined,
    },
    {
      label: "Sales Due",
      value: stats ? fmtCurrency(stats.salesOutstanding) : undefined,
    },
    { label: "Total Invoices", value: stats?.totalInvoices },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">
          Reports & Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate, preview and download business reports
        </p>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
          {STAT_LABELS.map((s, i) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              colorClass={STAT_COLORS[i]}
            />
          ))}
        </div>
      )}
      {statsLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-muted/30 h-[62px] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── LEFT: Report picker ──────────────────────────────────────────── */}
        <div className="space-y-3 lg:col-span-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Search reports…"
              className="w-full h-9 pl-9 pr-8 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
            {sidebarSearch && (
              <button
                onClick={() => setSidebarSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Categories */}
          {filteredCats.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              No reports matching "{sidebarSearch}"
            </div>
          ) : (
            filteredCats.map((cat) => {
              const Icon = CAT_ICON_MAP[cat.title] ?? BarChart3;
              const isOpen = expandedCat === cat.title || !!sidebarSearch;

              return (
                <div
                  key={cat.title}
                  className="rounded-2xl border border-border overflow-hidden bg-card"
                >
                  <button
                    onClick={() =>
                      setExpandedCat(
                        isOpen && !sidebarSearch ? null : cat.title,
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                          cat.color,
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm font-bold text-foreground">
                        {cat.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {cat.reports.length}
                      </span>
                    </div>
                    <ChevronRight
                      className={cn(
                        "w-4 h-4 text-muted-foreground transition-transform duration-200",
                        isOpen && "rotate-90",
                      )}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-t border-border divide-y divide-border/50">
                      {cat.reports.map((r) => {
                        const active = selectedReport?.id === r.id;
                        return (
                          <button
                            key={r.id}
                            onClick={() => selectReport(r)}
                            className={cn(
                              "w-full flex items-start justify-between px-4 py-3",
                              "hover:bg-muted/30 transition-colors text-left",
                              active &&
                                "bg-primary/5 border-l-2 border-primary pl-[14px]",
                            )}
                          >
                            <div className="flex-1 min-w-0 mr-2">
                              <p
                                className={cn(
                                  "text-sm font-medium leading-tight",
                                  active ? "text-primary" : "text-foreground",
                                )}
                              >
                                {r.name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                                {r.description}
                              </p>
                            </div>
                            {active && (
                              <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── RIGHT: Filters + preview ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedReport ? (
            <div className="flex flex-col items-center justify-center h-72 rounded-2xl border border-dashed border-border bg-muted/10 gap-3">
              <BarChart3 className="w-12 h-12 text-muted-foreground opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  Select a report from the left panel
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Then set filters and preview or download
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Report header bar */}
              <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-foreground truncate">
                    {selectedReport.name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedReport.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => runPreview(1)}
                    disabled={previewLoading}
                    className="h-9 px-3 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw
                      className={cn(
                        "w-3.5 h-3.5",
                        previewLoading && "animate-spin",
                      )}
                    />
                    {preview ? "Refresh" : "Preview"}
                  </button>
                  <button
                    onClick={() => setDlOpen(true)}
                    className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </div>
              </div>

              {/* Filters card */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-bold text-foreground">Filters</h3>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <X className="w-3 h-3" />
                      Clear all
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Date range */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider">
                      From Date
                    </label>
                    <Inp
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider">
                      To Date
                    </label>
                    <Inp
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                  {/* Report-specific filters */}
                  {filterDefs.map((fd) => (
                    <div key={fd.id} className="space-y-1.5">
                      <label className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider">
                        {fd.label}
                      </label>
                      {fd.type === "select" ? (
                        <div className="relative">
                          <Sel
                            value={extraFilters[fd.id] ?? ""}
                            onChange={(e) =>
                              setExtra((p) => ({
                                ...p,
                                [fd.id]: e.target.value,
                              }))
                            }
                          >
                            {fd.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Sel>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                        </div>
                      ) : (
                        <Inp
                          type="text"
                          value={extraFilters[fd.id] ?? ""}
                          placeholder={`Filter by ${fd.label.toLowerCase()}…`}
                          onChange={(e) =>
                            setExtra((p) => ({
                              ...p,
                              [fd.id]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <ColumnPicker
                columns={preview?.headers ?? []}
                selectedColumns={selectedColumns}
                onToggle={toggleColumn}
                onSelectAll={() => setSelectedColumns(preview?.headers ?? [])}
              />

              {/* Preview card */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
                <PreviewTable
                  preview={displayedPreview}
                  loading={previewLoading}
                  onPrev={() => runPreview(Math.max(1, previewPage - 1))}
                  onNext={() => runPreview(previewPage + 1)}
                  pageSize={pageSize}
                  onPageSizeChange={(value) => setPageSize(value)}
                />

                {/* Quick download strip */}
                {selectedReport && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Quick download:
                    </p>
                    <QuickDownload onOpenPreview={openDownloadPreview} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Download dialog ─────────────────────────────────────────────────── */}
      <DownloadDialog
        open={dlOpen}
        onClose={() => setDlOpen(false)}
        report={selectedReport}
        onPreview={openDownloadPreview}
      />
      <DownloadPreviewDialog
        open={!!downloadPreviewFormat}
        onClose={() => setDownloadPreviewFormat(null)}
        report={selectedReport}
        format={downloadPreviewFormat}
        preview={displayedPreview}
        previewLoading={previewLoading}
        ensurePreview={() => runPreview(1)}
        onPrev={() => runPreview(Math.max(1, previewPage - 1))}
        onNext={() => runPreview(previewPage + 1)}
        pageSize={pageSize}
        onPageSizeChange={(value) => setPageSize(value)}
        dateFrom={dateFrom}
        dateTo={dateTo}
        extraFilters={extraFilters}
        financialYearId={selectedFY?.id ?? null}
        selectedColumns={selectedColumns}
      />
    </div>
  );
}
