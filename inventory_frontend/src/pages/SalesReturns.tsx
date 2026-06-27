import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getApiErrorMessage, getApiErrorSummary } from "@/lib/apiErrors";
import { useAuth } from "@/contexts/AuthContext";

const API_URL =
  (window as Window & { __APP_API_URL__?: string }).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

interface WarehouseOption {
  id: number;
  name: string;
}

interface CustomerOption {
  id: number;
  displayName: string;
}

interface InvoiceOption {
  id: number;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  totalAmount: number;
  balanceAmount?: number;
}

interface InvoiceItem {
  id: number;
  itemName: string;
  quantity: number;
  returnedQty?: number;
  remainingReturnQty?: number;
  amountPerUnit?: number;
  taxRate: number;
  lineTotal: number;
}

interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerId: number | null;
  items: InvoiceItem[];
}

interface ReturnItem {
  invoiceId: number;
  invoiceNumber: string;
  salesInvoiceItemId: number;
  itemName: string;
  soldQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  quantity: string;
  unitPrice: number;
  taxRate: number;
  disposition: "restock" | "damaged" | "expired";
  reason: string;
}

interface SalesReturn {
  id: number;
  returnNumber: string;
  returnDate: string;
  invoiceNumber: string;
  customerName: string;
  warehouseName: string;
  reason: string;
  notes: string;
  status: "draft" | "confirmed" | "cancelled";
  statusDisplay: string;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  items?: {
    id: number;
    invoiceNumber?: string;
    itemName: string;
    quantity: number;
    lineTotal: number;
    disposition?: "restock" | "damaged" | "expired";
  }[];
}

interface SalesReturnListResponse {
  results: SalesReturn[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  summary?: {
    total: number;
    confirmed: number;
    draft: number;
    cancelled: number;
    value: number;
  };
}

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

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(opts.headers ?? {}),
    },
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
  if (!res.ok) {
    throw Object.assign(new Error((body as { error?: string })?.error || "Request failed"), {
      status: res.status,
      body,
    });
  }
  return body;
}

const fmt = (value: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(value || 0);

const Inp = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={cn(
      "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
      props.className,
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

const Txt = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={cn(
      "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none",
      props.className,
    )}
  />
);

const StatusBadge = ({ status }: { status: SalesReturn["status"] }) => {
  const cls = {
    draft: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    cancelled: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  }[status];
  return (
    <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize", cls)}>
      {status}
    </span>
  );
};

function CustomerPicker({
  customers,
  selected,
  onSelect,
}: {
  customers: CustomerOption[];
  selected: CustomerOption | null;
  onSelect: (customer: CustomerOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((customer) =>
      customer.displayName.toLowerCase().includes(q),
    );
  }, [customers, query]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">Customer</label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "mt-1.5 w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-left text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
          open && "border-primary ring-2 ring-primary/20",
        )}
      >
        <span className="flex items-center justify-between gap-3">
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.displayName || "Select customer"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-2 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer..."
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {filteredCustomers.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No customers found
              </div>
            ) : (
              filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => {
                    onSelect(customer);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors",
                    selected?.id === customer.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted/40",
                  )}
                >
                  {customer.displayName}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReturnDialog({
  open,
  onClose,
  onSaved,
  fyId,
  customers,
  warehouses,
  initialCustomerId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  fyId: number | null;
  customers: CustomerOption[];
  warehouses: WarehouseOption[];
  initialCustomerId?: string;
}) {
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<number[]>([]);
  const [invoiceDetails, setInvoiceDetails] = useState<Record<number, InvoiceDetail>>({});
  const [items, setItems] = useState<ReturnItem[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState<"draft" | "confirmed" | "">("");

  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === customerId) ?? null,
    [customers, customerId],
  );

  useEffect(() => {
    if (!open) return;
    setCustomerId(initialCustomerId || "");
    setWarehouseId("");
    setReturnDate(new Date().toISOString().slice(0, 10));
    setReason("");
    setNotes("");
    setInvoices([]);
    setSelectedInvoiceIds([]);
    setInvoiceDetails({});
    setItems([]);
    setSaving("");
  }, [open, initialCustomerId]);

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    const loadInvoices = async () => {
      setLoadingInvoices(true);
      try {
        const params = new URLSearchParams();
        params.set("status", "confirmed");
        params.set("customerId", customerId);
        params.set("page", "1");
        params.set("page_size", "200");
        if (fyId) params.set("financialYearId", String(fyId));
        const invoiceData = (await apiFetch(`/api/sales/invoices/?${params}`)) as
          | { results?: InvoiceOption[] }
          | InvoiceOption[];
        if (cancelled) return;
        const invoiceRows = Array.isArray(invoiceData)
          ? invoiceData
          : (invoiceData.results ?? []);
        setInvoices(
          invoiceRows.map((invoice) => ({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customerName,
            invoiceDate: invoice.invoiceDate,
            totalAmount: invoice.totalAmount,
            balanceAmount: invoice.balanceAmount,
          })),
        );
        setSelectedInvoiceIds([]);
        setInvoiceDetails({});
        setItems([]);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: "Failed to load customer invoices",
            description: getApiErrorMessage(err),
            variant: "destructive",
          });
          setInvoices([]);
          setSelectedInvoiceIds([]);
          setInvoiceDetails({});
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoadingInvoices(false);
      }
    };
    loadInvoices();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, fyId]);

  useEffect(() => {
    if (!open || selectedInvoiceIds.length === 0) {
      setItems([]);
      return;
    }
    const missingIds = selectedInvoiceIds.filter((id) => !invoiceDetails[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    const loadDetails = async () => {
      setLoadingItems(true);
      try {
        const detailRows = await Promise.all(
          missingIds.map((id) => apiFetch(`/api/sales/invoices/${id}/`) as Promise<InvoiceDetail>),
        );
        if (cancelled) return;
        setInvoiceDetails((current) => {
          const next = { ...current };
          detailRows.forEach((detail) => {
            next[detail.id] = detail;
          });
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          toast({
            title: "Failed to load invoice items",
            description: getApiErrorMessage(err),
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    };
    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [open, selectedInvoiceIds, invoiceDetails]);

  useEffect(() => {
    if (!open) return;
    const selectedSet = new Set(selectedInvoiceIds);
    const currentById = new Map(items.map((item) => [item.salesInvoiceItemId, item]));
    const nextItems: ReturnItem[] = [];
    selectedInvoiceIds.forEach((invoiceId) => {
      const detail = invoiceDetails[invoiceId];
      if (!detail || !selectedSet.has(invoiceId)) return;
      (detail.items || []).forEach((item) => {
        const existing = currentById.get(item.id);
        nextItems.push({
          invoiceId: detail.id,
          invoiceNumber: detail.invoiceNumber,
          salesInvoiceItemId: item.id,
          itemName: item.itemName,
          soldQuantity: item.quantity,
          returnedQuantity: item.returnedQty ?? 0,
          remainingQuantity: item.remainingReturnQty ?? 0,
          quantity: existing?.quantity ?? "",
          unitPrice: item.amountPerUnit ?? item.lineTotal / Math.max(item.quantity, 1),
          taxRate: item.taxRate ?? 0,
          disposition: existing?.disposition ?? "restock",
          reason: existing?.reason ?? "",
        });
      });
    });
    setItems(nextItems);
  }, [open, selectedInvoiceIds, invoiceDetails]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => {
      const qty = Number(item.quantity || 0);
      if (qty <= 0) return sum;
      const subtotal = qty * item.unitPrice;
      const tax = subtotal * (item.taxRate / 100);
      return sum + subtotal + tax;
    }, 0);
  }, [items]);

  const selectedLineCount = useMemo(
    () => items.filter((item) => Number(item.quantity || 0) > 0).length,
    [items],
  );

  const updateQty = (idx: number, value: string) => {
    setItems((current) =>
      current.map((item, itemIdx) => {
        if (itemIdx !== idx) return item;
        const numeric = value.replace(/\D/g, "");
        return { ...item, quantity: numeric };
      }),
    );
  };

  const updateDisposition = (idx: number, disposition: ReturnItem["disposition"]) => {
    setItems((current) =>
      current.map((item, itemIdx) => (itemIdx === idx ? { ...item, disposition } : item)),
    );
  };

  const updateLineReason = (idx: number, lineReason: string) => {
    setItems((current) =>
      current.map((item, itemIdx) => (itemIdx === idx ? { ...item, reason: lineReason } : item)),
    );
  };

  const toggleInvoice = (invoiceId: number) => {
    setSelectedInvoiceIds((current) =>
      current.includes(invoiceId)
        ? current.filter((id) => id !== invoiceId)
        : [...current, invoiceId],
    );
  };

  const submit = async (status: "draft" | "confirmed") => {
    if (!customerId || !warehouseId) {
      toast({
        title: "Please complete the required return details",
        description: "Select a customer, choose a warehouse, and then enter at least one valid return line.",
        variant: "destructive",
      });
      return;
    }
    setSaving(status);
    try {
      await apiFetch("/api/sales/returns/create/", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId),
          salesInvoiceId: selectedInvoiceIds.length === 1 ? selectedInvoiceIds[0] : undefined,
          warehouseId: Number(warehouseId),
          returnDate,
          reason,
          notes,
          status,
          financialYearId: fyId,
          items: items.map((item) => ({
            salesInvoiceItemId: item.salesInvoiceItemId,
            quantity: Number(item.quantity || 0),
            disposition: item.disposition,
            reason: item.reason || reason,
          })),
        }),
      });
      toast({
        title: status === "confirmed" ? "Sales return confirmed" : "Sales return saved",
      });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: "Unable to save the sales return",
        description: getApiErrorSummary(err),
        variant: "destructive",
      });
    } finally {
      setSaving("");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-7xl max-h-[96vh] sm:max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-base sm:text-lg text-foreground">New Sales Return</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Create a return against one or more confirmed sales invoices
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 sm:space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <CustomerPicker
                customers={customers}
                selected={selectedCustomer}
                onSelect={(customer) => setCustomerId(customer ? String(customer.id) : "")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">Return Warehouse</label>
              <div className="relative">
                <Sel value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Sel>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">Return Date</label>
              <Inp type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">Customer Invoices</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose one or more confirmed invoices for this return.
                </p>
              </div>
              {loadingInvoices && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {!customerId ? (
              <div className="p-6 text-sm text-muted-foreground">Select a customer to load confirmed invoices.</div>
            ) : invoices.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No confirmed invoices found for this customer.</div>
            ) : (
              <div className="p-3 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                {invoices.map((invoice) => {
                  const checked = selectedInvoiceIds.includes(invoice.id);
                  return (
                    <label
                      key={invoice.id}
                      className={cn(
                        "rounded-xl border p-3 sm:p-4 flex items-start gap-3 cursor-pointer transition-colors min-w-0",
                        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInvoice(invoice.id)}
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground break-words">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {invoice.invoiceDate} • {fmt(invoice.totalAmount)}
                        </p>
                        {typeof invoice.balanceAmount === "number" && (
                          <p className="text-xs text-muted-foreground">Balance: {fmt(invoice.balanceAmount)}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">Reason</label>
              <Txt rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the customer returning this sale?" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">Notes</label>
              <Txt rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
            </div>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground">Return Items</h3>
                {items.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {items.length} lines loaded • {selectedLineCount} lines selected for return
                  </p>
                )}
              </div>
              {loadingItems && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                {selectedInvoiceIds.length > 0
                  ? "No returnable items found for the selected invoices."
                  : "Select one or more invoices to load sold items."}
              </div>
            ) : (
              <>
                <div className="lg:hidden p-3 space-y-3">
                  {items.map((item, idx) => {
                    const qty = Number(item.quantity || 0);
                    const credit = qty > 0 ? qty * item.unitPrice * (1 + item.taxRate / 100) : 0;
                    return (
                      <div key={item.salesInvoiceItemId} className="rounded-xl border border-border p-3 sm:p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{item.invoiceNumber}</p>
                            <p className="text-sm font-semibold text-foreground break-words">{item.itemName}</p>
                          </div>
                          <p className="text-sm font-semibold text-foreground whitespace-nowrap">{fmt(credit)}</p>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="rounded-lg bg-muted/30 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sold</p>
                            <p className="mt-1 text-foreground">{item.soldQuantity}</p>
                          </div>
                          <div className="rounded-lg bg-muted/30 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Returned</p>
                            <p className="mt-1 text-foreground">{item.returnedQuantity}</p>
                          </div>
                          <div className="rounded-lg bg-muted/30 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Remaining</p>
                            <p className="mt-1 text-foreground">{item.remainingQuantity}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Return Qty</label>
                            <Inp
                              type="number"
                              min="0"
                              max={item.remainingQuantity}
                              step="1"
                              value={item.quantity}
                              onChange={(e) => updateQty(idx, e.target.value)}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Action</label>
                            <div className="relative">
                              <Sel
                                value={item.disposition}
                                onChange={(e) => updateDisposition(idx, e.target.value as ReturnItem["disposition"])}
                              >
                                <option value="restock">Restock</option>
                                <option value="damaged">Damaged</option>
                                <option value="expired">Expired</option>
                              </Sel>
                              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Line Reason</label>
                            <Inp
                              value={item.reason}
                              onChange={(e) => updateLineReason(idx, e.target.value)}
                              placeholder="Optional"
                            />
                          </div>
                          <div className="rounded-lg bg-muted/30 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount</p>
                            <p className="mt-1 text-sm text-foreground whitespace-nowrap">{fmt(item.unitPrice)} + {item.taxRate}%</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      {["Invoice", "Item", "Sold Qty", "Returned", "Remaining", "Return Qty", "Amount", "Action", "Line Reason", "Credit"].map((head) => (
                        <th key={head} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const qty = Number(item.quantity || 0);
                      const credit = qty > 0 ? qty * item.unitPrice * (1 + item.taxRate / 100) : 0;
                      return (
                        <tr key={item.salesInvoiceItemId} className="border-b border-border/50">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{item.invoiceNumber}</td>
                          <td className="px-4 py-3 font-medium text-foreground min-w-[220px]">{item.itemName}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{item.soldQuantity}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{item.returnedQuantity}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{item.remainingQuantity}</td>
                          <td className="px-4 py-3 min-w-[120px]">
                            <Inp
                              type="number"
                              min="0"
                              max={item.remainingQuantity}
                              step="1"
                              value={item.quantity}
                              onChange={(e) => updateQty(idx, e.target.value)}
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground min-w-[150px]">
                            {fmt(item.unitPrice)} + {item.taxRate}%
                          </td>
                          <td className="px-4 py-3 min-w-[160px]">
                            <div className="relative">
                              <Sel
                                value={item.disposition}
                                onChange={(e) => updateDisposition(idx, e.target.value as ReturnItem["disposition"])}
                              >
                                <option value="restock">Restock</option>
                                <option value="damaged">Damaged</option>
                                <option value="expired">Expired</option>
                              </Sel>
                              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                          </td>
                          <td className="px-4 py-3 min-w-[180px]">
                            <Inp
                              value={item.reason}
                              onChange={(e) => updateLineReason(idx, e.target.value)}
                              placeholder="Optional"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{fmt(credit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 border-t border-border flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-muted-foreground">
            Estimated credit: <span className="font-semibold text-foreground">{fmt(totalAmount)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-auto">
            <button onClick={onClose} className="h-10 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => submit("draft")}
              disabled={!!saving}
              className="h-10 px-4 rounded-xl border border-border text-sm text-foreground hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving === "draft" && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Draft
            </button>
            <button
              onClick={() => submit("confirmed")}
              disabled={!!saving}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving === "confirmed" && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm Return
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SalesReturns() {
  const { selectedFY } = useAuth();
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({
    total: 0,
    confirmed: 0,
    draft: 0,
    cancelled: 0,
    value: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialCustomerId, setDialogInitialCustomerId] = useState("");
  const [viewing, setViewing] = useState<SalesReturn | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("newReturn") === "1") {
      setDialogInitialCustomerId(params.get("customerId") || "");
      setDialogOpen(true);
      params.delete("newReturn");
      params.delete("customerId");
      const next = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}`,
      );
    }
  }, []);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (selectedFY?.id) params.set("financialYearId", String(selectedFY.id));
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      const data = (await apiFetch(`/api/sales/returns/?${params}`)) as SalesReturnListResponse;
      setReturns(data.results || []);
      setTotalCount(data.count || 0);
      setTotalPages(data.total_pages || 1);
      setSummary(
        data.summary || {
          total: data.count || 0,
          confirmed: 0,
          draft: 0,
          cancelled: 0,
          value: 0,
        },
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
      setReturns([]);
      setTotalCount(0);
      setTotalPages(1);
      setSummary({ total: 0, confirmed: 0, draft: 0, cancelled: 0, value: 0 });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, selectedFY?.id, page, pageSize]);

  const fetchLookups = useCallback(async () => {
    try {
      const [customerData, warehouseData] = await Promise.all([
        apiFetch("/api/masters/customers/?isActive=true"),
        apiFetch("/api/stock/warehouses/"),
      ]);
      setCustomers(
        ((customerData as any[]) || []).map((customer) => ({
          id: customer.id,
          displayName: customer.displayName,
        })),
      );
      setWarehouses(
        ((warehouseData as any[]) || []).map((warehouse) => ({
          id: warehouse.id,
          name: warehouse.name,
        })),
      );
    } catch {
      setCustomers([]);
      setWarehouses([]);
    }
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, selectedFY?.id, pageSize]);

  useEffect(() => {
    fetchLookups();
  }, [fetchLookups]);

  const loadDetail = async (id: number) => {
    try {
      const data = (await apiFetch(`/api/sales/returns/${id}/`)) as SalesReturn;
      setViewing(data);
    } catch (err) {
      toast({
        title: "Failed to load return",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const confirmReturn = async (id: number) => {
    try {
      await apiFetch(`/api/sales/returns/${id}/confirm/`, { method: "POST" });
      toast({ title: "Sales return confirmed" });
      fetchReturns();
    } catch (err) {
      toast({
        title: "Confirm failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const cancelReturn = async (id: number) => {
    try {
      await apiFetch(`/api/sales/returns/${id}/cancel/`, { method: "PUT" });
      toast({ title: "Sales return cancelled" });
      fetchReturns();
    } catch (err) {
      toast({
        title: "Cancel failed",
        description: getApiErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const stats = useMemo(
    () => ({
      total: summary.total,
      confirmed: summary.confirmed,
      draft: summary.draft,
      value: summary.value,
    }),
    [summary],
  );

  const showFrom = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const showTo = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Sales Returns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Record customer returns, restore stock, and reduce receivables correctly
          </p>
        </div>
        <button
          onClick={() => {
            setDialogInitialCustomerId("");
            setDialogOpen(true);
          }}
          className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Return
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border p-4 bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Total Returns</p>
          <p className="text-xl font-bold">{stats.total}</p>
        </div>
        <div className="rounded-2xl border p-4 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Confirmed</p>
          <p className="text-xl font-bold">{stats.confirmed}</p>
        </div>
        <div className="rounded-2xl border p-4 bg-amber-500/10 text-amber-600 border-amber-500/20">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Draft</p>
          <p className="text-xl font-bold">{stats.draft}</p>
        </div>
        <div className="rounded-2xl border p-4 bg-sky-500/10 text-sky-600 border-sky-500/20">
          <p className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Return Value</p>
          <p className="text-xl font-bold">{fmt(stats.value)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Inp value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search return, invoice, or customer..." className="pl-9 pr-8" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="relative">
          <Sel value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </Sel>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
        <button
          onClick={() => fetchReturns()}
          disabled={loading}
          className="h-9 px-3 rounded-xl border border-border text-muted-foreground hover:bg-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-600">Failed to load sales returns</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {!error && (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-14 rounded-xl bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : returns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                <RotateCcw className="w-8 h-8 text-muted-foreground opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">No sales returns yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create your first return from a confirmed invoice.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    {["Return #", "Date", "Invoice / Customer", "Warehouse", "Total", "Status", "Actions"].map((head) => (
                      <th key={head} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {returns.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => loadDetail(row.id)}
                    >
                      <td className="px-4 py-3 font-semibold text-foreground">{row.returnNumber}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.returnDate}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{row.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{row.customerName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.warehouseName}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{fmt(row.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {row.status === "draft" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmReturn(row.id);
                              }}
                              className="w-7 h-7 rounded-lg hover:bg-emerald-500/10 flex items-center justify-center text-muted-foreground hover:text-emerald-500"
                              title="Confirm"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {row.status !== "cancelled" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelReturn(row.id);
                              }}
                              className="w-7 h-7 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-muted-foreground hover:text-rose-500"
                              title="Cancel"
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
          )}

          {!loading && !error && totalCount > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {showFrom} to {showTo} of {totalCount} returns
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Rows</span>
                  <div className="relative">
                    <Sel
                      value={String(pageSize)}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-9 w-24 pr-8"
                    >
                      {[10, 20, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </Sel>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page === 1}
                    className="h-9 px-3 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </button>
                  <span className="text-sm font-medium text-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page >= totalPages}
                    className="h-9 px-3 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
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

      <ReturnDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          fetchReturns();
          fetchLookups();
        }}
        fyId={selectedFY?.id ?? null}
        customers={customers}
        warehouses={warehouses}
        initialCustomerId={dialogInitialCustomerId}
      />

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
              <div>
                <h2 className="font-bold text-foreground">{viewing.returnNumber}</h2>
                <p className="text-xs text-muted-foreground">
                  {viewing.invoiceNumber} • {viewing.customerName}
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="w-8 h-8 rounded-lg hover:bg-accent flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-muted-foreground">Date</p><p className="font-medium text-foreground">{viewing.returnDate}</p></div>
                <div><p className="text-muted-foreground">Warehouse</p><p className="font-medium text-foreground">{viewing.warehouseName}</p></div>
                <div><p className="text-muted-foreground">Status</p><StatusBadge status={viewing.status} /></div>
                <div><p className="text-muted-foreground">Total</p><p className="font-medium text-foreground">{fmt(viewing.totalAmount)}</p></div>
              </div>
              <div>
                <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider mb-2">Reason</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{viewing.reason || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider mb-2">Items</p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        {["Invoice", "Item", "Qty", "Action", "Credit"].map((head) => (
                          <th key={head} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-left">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(viewing.items || []).map((item) => (
                        <tr key={item.id} className="border-b border-border/50">
                          <td className="px-4 py-3">{item.invoiceNumber || viewing.invoiceNumber}</td>
                          <td className="px-4 py-3">{item.itemName}</td>
                          <td className="px-4 py-3">{item.quantity}</td>
                          <td className="px-4 py-3 capitalize">{item.disposition || "restock"}</td>
                          <td className="px-4 py-3">{fmt(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
