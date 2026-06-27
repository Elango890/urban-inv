import { useEffect, useState, useMemo } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  PlusCircle,
  MinusCircle,
  Loader2,
  Pencil,
  Trash2,
  RefreshCcw,
  BarChart3,
  ArrowUpCircle,
  ArrowDownCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isBlank, isPositiveNumber } from "@/lib/validation";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PettyCashEntry {
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
  customerId?: number | null;
  customerName?: string | null;
  vendorId?: number | null;
  vendorName?: string | null;
  financialYear: string | null;
  approvedBy: string;
  createdBy: string;
  notes?: string;
  receiptFile?: string | null;
  createdAt: string;
}

interface PettyCashStats {
  currentBalance: number;
  totalCredits: number;
  totalDebits: number;
  monthlyCredits: number;
  monthlyDebits: number;
  categorySpending: {
    category: string;
    categoryDisplay: string;
    total: number;
  }[];
  recentLargeTransactions: {
    date: string;
    description: string;
    amount: number;
    type: string;
  }[];
  monthlyTrend: { month: string; credits: number; debits: number }[];
}

interface CategoryOption {
  value: string;
  label: string;
}

interface RelatedPartyOption {
  id: number;
  displayName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user?.access_token || ""}`,
  };
}

const DEFAULT_CATEGORIES: CategoryOption[] = [
  { value: "fund", label: "Fund Replenishment" },
  { value: "office", label: "Office Supplies" },
  { value: "logistics", label: "Logistics & Courier" },
  { value: "hospitality", label: "Hospitality" },
  { value: "travel", label: "Travel & Transport" },
  { value: "maintenance", label: "Maintenance" },
  { value: "utilities", label: "Utilities" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM = {
  type: "debit" as "credit" | "debit",
  amount: "",
  description: "",
  category: "other",
  relatedPartyType: "own" as "own" | "customer" | "vendor",
  customerId: "",
  vendorId: "",
  date: new Date().toISOString().split("T")[0],
  notes: "",
};

// ─── Add / Edit Dialog  (scrollable inside dialog) ───────────────────────────

function EntryFormDialog({
  open,
  onOpenChange,
  initial,
  categories,
  currentBalance,
  customers,
  vendors,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: PettyCashEntry | null;
  categories: CategoryOption[];
  currentBalance: number;
  customers: RelatedPartyOption[];
  vendors: RelatedPartyOption[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<{
    description?: string;
    amount?: string;
    date?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (initial) {
      setForm({
        type: initial.type,
        amount: String(initial.amount),
        description: initial.description,
        category: initial.category,
        relatedPartyType: initial.relatedPartyType,
        customerId: initial.customerId ? String(initial.customerId) : "",
        vendorId: initial.vendorId ? String(initial.vendorId) : "",
        date: initial.date,
        notes: initial.notes || "",
      });
    } else {
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().split("T")[0] });
    }
    setErrors({});
  }, [initial, open]);

  function set(k: string, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!p[k as "description" | "amount" | "date"]) return p;
      const n = { ...p };
      delete n[k as "description" | "amount" | "date"];
      return n;
    });
  }

  const parsedAmount = parseFloat(form.amount) || 0;
  const isInsufficient =
    form.type === "debit" && !initial && parsedAmount > currentBalance;

  async function handleSave() {
    const nextErrors: { description?: string; amount?: string; date?: string } = {};
    if (isBlank(form.description)) nextErrors.description = "Description is required.";
    if (!isPositiveNumber(form.amount)) nextErrors.amount = "Amount must be greater than zero.";
    if (isBlank(form.date)) nextErrors.date = "Date is required.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast({ title: "Please fix the errors", variant: "destructive" });
      return;
    }
    if (isInsufficient) {
      toast({
        title: `Insufficient balance. Available: AED ${currentBalance.toLocaleString()}`,
        variant: "destructive",
      });
      return;
    }
    if (form.relatedPartyType === "customer" && !form.customerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    if (form.relatedPartyType === "vendor" && !form.vendorId) {
      toast({ title: "Please select a vendor", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = initial
        ? `${API_URL}/api/pettycash/update/${initial.id}/`
        : `${API_URL}/api/pettycash/create/`;
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          ...form,
          amount: parsedAmount,
          customerId: form.relatedPartyType === "customer" ? Number(form.customerId) : null,
          vendorId: form.relatedPartyType === "vendor" ? Number(form.vendorId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast({
        title: initial ? "Entry updated" : "Entry created",
        description: `New balance: AED ${data.newBalance?.toLocaleString()}`,
      });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Error", description: getApiErrorMessage(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ✅ max-h + flex column so content scrolls, footer stays pinned */}
      <DialogContent className="max-w-md flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{initial ? "Edit Entry" : "Add Petty Cash Entry"}</DialogTitle>
        </DialogHeader>

        {/* scrollable body */}
        <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
          {/* Type toggle */}
          <div className="space-y-1">
            <Label>Transaction Type</Label>
            <div className="flex gap-2">
              {(["debit", "credit"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("type", t)}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-all ${
                    form.type === t
                      ? t === "debit"
                        ? "bg-destructive text-destructive-foreground border-destructive"
                        : "bg-green-600 text-white border-green-600"
                      : "bg-background border-input text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t === "debit" ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <ArrowDownCircle className="h-4 w-4" /> Debit (Expense)
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5">
                      <ArrowUpCircle className="h-4 w-4" /> Credit (Top-up)
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label>Amount (AED) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              className={isInsufficient || errors.amount ? "border-destructive" : ""}
              placeholder="0.00"
            />
            {isInsufficient && (
              <p className="text-xs text-destructive">
                Available balance: AED {currentBalance.toLocaleString()}
              </p>
            )}
            {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label>Description *</Label>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What is this for?"
              className={errors.description ? "border-destructive" : ""}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description}</p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Related To</Label>
            <Select
              value={form.relatedPartyType}
              onValueChange={(v) =>
                setForm((p) => ({
                  ...p,
                  relatedPartyType: v as "own" | "customer" | "vendor",
                  customerId: v === "customer" ? p.customerId : "",
                  vendorId: v === "vendor" ? p.vendorId : "",
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="own">Own</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.relatedPartyType === "customer" && (
            <div className="space-y-1">
              <Label>Customer *</Label>
              <Select value={form.customerId} onValueChange={(v) => set("customerId", v)}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.relatedPartyType === "vendor" && (
            <div className="space-y-1">
              <Label>Vendor *</Label>
              <Select value={form.vendorId} onValueChange={(v) => set("vendorId", v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date */}
          <div className="space-y-1">
            <Label>Date</Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className={errors.date ? "border-destructive" : ""}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional remarks…"
            />
          </div>
        </div>

        {/* pinned footer */}
        <DialogFooter className="shrink-0 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || isInsufficient}
            className={form.type === "credit" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initial ? "Update" : form.type === "credit" ? "Add Credit" : "Add Debit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

function DeleteEntryDialog({
  open,
  onOpenChange,
  entry,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: PettyCashEntry | null;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleDelete() {
    if (!entry) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/pettycash/delete/${entry.id}/`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast({
        title: "Entry deleted",
        description: `New balance: AED ${data.newBalance?.toLocaleString()}`,
      });
      onDeleted();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Error", description: getApiErrorMessage(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete Entry?</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            This will permanently delete the{" "}
            <strong className={entry?.type === "credit" ? "text-green-600" : "text-destructive"}>
              {entry?.type === "credit" ? "credit" : "debit"} of AED {entry?.amount.toLocaleString()}
            </strong>{" "}
            for <strong>{entry?.description}</strong>.
          </p>
          <p className="text-xs">The fund balance will be reversed automatically.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stats Dialog ─────────────────────────────────────────────────────────────

function StatsDialog({
  open,
  onOpenChange,
  stats,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stats: PettyCashStats | null;
}) {
  if (!stats) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Petty Cash Analytics</DialogTitle></DialogHeader>
        <div className="space-y-5 mt-2">
          {stats.categorySpending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Top Spending Categories
              </p>
              <div className="space-y-2">
                {stats.categorySpending.map((cat) => {
                  const pct = stats.totalDebits > 0
                    ? Math.round((cat.total / stats.totalDebits) * 100)
                    : 0;
                  return (
                    <div key={cat.category}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{cat.categoryDisplay}</span>
                        <span className="text-muted-foreground">
                          AED {cat.total.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-destructive/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.monthlyTrend.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Monthly Activity
              </p>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {["Month", "Credits", "Debits", "Net"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthlyTrend.map((row) => {
                      const net = row.credits - row.debits;
                      return (
                        <tr key={row.month} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2">{row.month}</td>
                          <td className="px-3 py-2 text-green-600">+AED {row.credits.toLocaleString()}</td>
                          <td className="px-3 py-2 text-destructive">-AED {row.debits.toLocaleString()}</td>
                          <td className={`px-3 py-2 font-medium ${net >= 0 ? "text-green-600" : "text-destructive"}`}>
                            {net >= 0 ? "+" : ""}AED {Math.abs(net).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {stats.recentLargeTransactions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Recent Large Transactions (≥ AED 500)
              </p>
              <div className="space-y-2">
                {stats.recentLargeTransactions.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between text-sm rounded-md border px-3 py-2">
                    <div>
                      <p className="font-medium">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">{tx.date}</p>
                    </div>
                    <span className={`font-semibold ${tx.type === "credit" ? "text-green-600" : "text-destructive"}`}>
                      {tx.type === "credit" ? "+" : "-"}AED {tx.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, icon: Icon, iconClass, valueClass,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClass || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClass || ""}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PettyCash() {
  const [entries, setEntries] = useState<PettyCashEntry[]>([]);
  const [stats, setStats] = useState<PettyCashStats | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>(DEFAULT_CATEGORIES);
  const [customers, setCustomers] = useState<RelatedPartyOption[]>([]);
  const [vendors, setVendors] = useState<RelatedPartyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PettyCashEntry | null>(null);

  // ── Search & Filter ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterRelatedType, setFilterRelatedType] = useState("all");

  // ── Pagination ──────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const { toast } = useToast();
  const currentBalance = stats?.currentBalance ?? 0;

  // ── Filter entries ──────────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const q = search.toLowerCase().trim();
    return entries.filter((e) => {
      const matchesSearch =
        !q ||
        e.description.toLowerCase().includes(q) ||
        e.categoryDisplay.toLowerCase().includes(q) ||
        e.approvedBy.toLowerCase().includes(q) ||
        String(e.amount).includes(q);
      const matchesType = filterType === "all" || e.type === filterType;
      const matchesCategory = filterCategory === "all" || e.category === filterCategory;
      const matchesRelatedType =
        filterRelatedType === "all" || e.relatedPartyType === filterRelatedType;
      return matchesSearch && matchesType && matchesCategory && matchesRelatedType;
    });
  }, [entries, search, filterType, filterCategory, filterRelatedType]);

  // ── Pagination computed ─────────────────────────────────────────────────────
  const totalPages = Math.ceil(filteredEntries.length / pageSize);
  const safeCurrentPage = Math.min(currentPage, totalPages || 1);
  const paginatedEntries = filteredEntries.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );
  const from = filteredEntries.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const to = Math.min(safeCurrentPage * pageSize, filteredEntries.length);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [search, filterType, filterCategory, filterRelatedType, entries.length, pageSize]);

  useEffect(() => {
    fetchAll();
    fetchCategories();
    fetchParties();
  }, []);

  async function fetchParties() {
    try {
      const [customersRes, vendorsRes] = await Promise.all([
        fetch(`${API_URL}/api/masters/customers/`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/masters/suppliers/`, { headers: authHeaders() }),
      ]);
      if (customersRes.ok) {
        const data = await customersRes.json();
        setCustomers(Array.isArray(data) ? data.map((c) => ({ id: c.id, displayName: c.displayName })) : []);
      }
      if (vendorsRes.ok) {
        const data = await vendorsRes.json();
        setVendors(Array.isArray(data) ? data.map((v) => ({ id: v.id, displayName: v.displayName })) : []);
      }
    } catch {
      // keep empty lists
    }
  }

  async function fetchAll() {
    await Promise.all([fetchEntries(), fetchStats()]);
  }

  async function fetchEntries() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_URL}/api/pettycash/list/`, { headers: authHeaders() });
      if (res.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch entries");
      setEntries(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(`${API_URL}/api/pettycash/stats/`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  }

  async function fetchCategories() {
    try {
      const res = await fetch(`${API_URL}/api/pettycash/categories/`, { headers: authHeaders() });
      if (res.ok) setCategories(await res.json());
    } catch { /* use defaults */ }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={fetchAll}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Petty Cash"
        description="Manage petty cash fund — credits, expenses and running balance"
        action={{ label: "Add Entry", onClick: () => setAddOpen(true) }}
      />

      {/* ── Stats Cards ───────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Current Balance"
            value={`AED ${stats.currentBalance.toLocaleString()}`}
            sub="Available in fund"
            icon={Wallet}
            iconClass="text-primary"
          />
          <StatCard
            title="Total Credits"
            value={`AED ${stats.totalCredits.toLocaleString()}`}
            sub={`This month: AED ${stats.monthlyCredits.toLocaleString()}`}
            icon={TrendingUp}
            iconClass="text-green-500"
            valueClass="text-green-600"
          />
          <StatCard
            title="Total Debits"
            value={`AED ${stats.totalDebits.toLocaleString()}`}
            sub={`This month: AED ${stats.monthlyDebits.toLocaleString()}`}
            icon={TrendingDown}
            iconClass="text-destructive"
            valueClass="text-destructive"
          />
          <Card
            className="cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => setStatsOpen(true)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Analytics</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{entries.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Click to view breakdown</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Fund Utilisation Bar ──────────────────────────────────────────── */}
      {stats && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground font-medium">Fund Utilisation</span>
            <span className="font-semibold">
              AED {stats.currentBalance.toLocaleString()} remaining of AED {stats.totalCredits.toLocaleString()} credited
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{
                width: stats.totalCredits > 0
                  ? `${Math.min(100, (stats.currentBalance / stats.totalCredits) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Search & Filter Bar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions…"
            className="pl-9 pr-8"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Type filter */}
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="credit">Credit (Top-up)</SelectItem>
            <SelectItem value="debit">Debit (Expense)</SelectItem>
          </SelectContent>
        </Select>

        {/* Category filter */}
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterRelatedType} onValueChange={setFilterRelatedType}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Related" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Related</SelectItem>
            <SelectItem value="own">Own</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear */}
        {(search || filterType !== "all" || filterCategory !== "all" || filterRelatedType !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(""); setFilterType("all"); setFilterCategory("all"); setFilterRelatedType("all"); }}
          >
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              {["Date", "Description", "Related", "Category", "Amount", "Balance", "Approved By", "Actions"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No transactions found.
                </td>
              </tr>
            ) : (
              paginatedEntries.map((e) => (
                <tr key={e.id} className="border-t hover:bg-muted/30 transition-colors">
                  {/* Date */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm tabular-nums">
                      {new Date(e.date).toLocaleDateString("en-AE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </td>

                  {/* Description */}
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {e.type === "credit" ? (
                        <PlusCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      ) : (
                        <MinusCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[220px]">{e.description}</p>
                        {e.notes && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{e.notes}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <Badge variant="outline" className="whitespace-nowrap">{e.relatedPartyTypeDisplay}</Badge>
                      <p className="text-xs text-muted-foreground">
                        {e.customerName || e.vendorName || "Own"}
                      </p>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="whitespace-nowrap">{e.categoryDisplay}</Badge>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`font-semibold tabular-nums ${e.type === "credit" ? "text-green-600" : "text-destructive"}`}>
                      {e.type === "credit" ? "+" : "−"}AED {e.amount.toLocaleString()}
                    </span>
                  </td>

                  {/* Balance */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-medium tabular-nums">AED {e.balance.toLocaleString()}</span>
                  </td>

                  {/* Approved By */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-muted-foreground">{e.approvedBy}</span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-primary/10"
                        onClick={() => { setSelected(e); setEditOpen(true); }}
                      >
                        <Pencil className="h-4 w-4 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-destructive/10"
                        onClick={() => { setSelected(e); setDeleteOpen(true); }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
<div className="flex items-center justify-between px-1 gap-3 flex-wrap">
  {/* Left: record count */}
  <p className="text-sm text-muted-foreground">
    {filteredEntries.length === 0
      ? "No transactions found"
      : `Showing ${from} to ${to} of ${filteredEntries.length} transactions`}
  </p>

  {/* Right: Prev / Page X of Y / Next — always visible */}
  <div className="flex items-center gap-2 flex-wrap">
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
    <Button
      variant="outline"
      size="sm"
      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
      disabled={safeCurrentPage === 1}
      className="h-8 px-3 gap-1"
    >
      <ChevronLeft className="h-4 w-4" />
      Prev
    </Button>

    <span className="text-sm font-medium px-2 whitespace-nowrap">
      Page {safeCurrentPage} of {totalPages || 1}
    </span>

    <Button
      variant="outline"
      size="sm"
      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
      disabled={safeCurrentPage >= totalPages}
      className="h-8 px-3 gap-1"
    >
      Next
      <ChevronRight className="h-4 w-4" />
    </Button>
  </div>
</div>
      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <EntryFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        currentBalance={currentBalance}
        customers={customers}
        vendors={vendors}
        onSaved={fetchAll}
      />
      <EntryFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={selected}
        categories={categories}
        currentBalance={currentBalance}
        customers={customers}
        vendors={vendors}
        onSaved={fetchAll}
      />
      <DeleteEntryDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entry={selected}
        onDeleted={fetchAll}
      />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} stats={stats} />
    </div>
  );
}
