// components/projects/ViewProjectAssetsDialog.tsx
import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  RotateCcw,
  Search,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type ProjectData } from "./AddProjectDialog";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${JSON.parse(window.sessionStorage.getItem("user") || "{}")?.access_token}`,
  };
}

interface AllocatedAsset {
  allocation_id: number;
  asset_id: number;
  asset_code: string;
  asset_name: string;
  category: string;
  asset_type: string;
  purchase_cost: number;
  condition: string;
  warehouse?: { id: number; name: string } | null;
  allocated_date: string;
  allocated_by: string;
}

interface AvailableAsset {
  id: number;
  asset_code: string;
  name: string;
  category: string;
  category_id: number;
  asset_type: string;
  purchase_cost: number;
  condition: string;
  warehouses: {
    warehouse_id: number;
    warehouse_name: string;
    available: number;
    total: number;
    damaged: number;
    allocated: number;
  }[];
  total_available: number;
  within_budget: boolean;
}

interface ProjectAssetState {
  project_id: number;
  project_name: string;
  budget: number;
  budget_used: number;
  budget_remaining: number;
  budget_pct: number;
  assets: AllocatedAsset[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectData | null;
  onBudgetChange?: (budgetUsed: number) => void;
}

export function ViewProjectAssetsDialog({
  open,
  onOpenChange,
  project,
  onBudgetChange,
}: Props) {
  const { toast } = useToast();
  const [view, setView] = useState<"allocated" | "add">("allocated");
  const [state, setState] = useState<ProjectAssetState | null>(null);
  const [available, setAvailable] = useState<AvailableAsset[]>([]);
  const [budgetRemaining, setBudgetRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [working, setWorking] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [allocating, setAllocating] = useState<number | null>(null);
  const [warehouseChoice, setWarehouseChoice] = useState<Record<number, string>>(
    {},
  );

  const fetchAllocated = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/projects/${project.id}/assets/`, {
        headers: authHeaders(),
      });
      const d = await r.json();
      setState(d);
      onBudgetChange?.(d.budget_used);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  const fetchAvailable = useCallback(async () => {
    if (!project?.id) return;
    setLoadingAvail(true);
    try {
      const r = await fetch(
        `${API_URL}/api/projects/${project.id}/assets/available/?search=${encodeURIComponent(search)}`,
        { headers: authHeaders() },
      );
      const ct = r.headers.get("content-type") || "";
      if (!r.ok) {
        const text = ct.includes("application/json")
          ? JSON.stringify(await r.json())
          : await r.text();
        throw new Error(`Failed to load available assets (${r.status}). ${text}`);
      }
      const d = ct.includes("application/json") ? await r.json() : { assets: [] };
      setAvailable(d.assets ?? []);
      setBudgetRemaining(d.budget_remaining ?? 0);
    } finally {
      setLoadingAvail(false);
    }
  }, [project?.id, search]);

  useEffect(() => {
    if (open && project?.id) {
      fetchAllocated();
      setView("allocated");
      setSearch("");
    }
  }, [open, project?.id]);

  useEffect(() => {
    if (view === "add") fetchAvailable();
  }, [view, fetchAvailable]);

  // Debounce search
  useEffect(() => {
    if (view !== "add") return;
    const t = setTimeout(fetchAvailable, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!available.length) return;
    setWarehouseChoice((prev) => {
      const next = { ...prev };
      for (const a of available) {
        if (!next[a.id]) {
          const first = a.warehouses.find((w) => w.available > 0);
          if (first) next[a.id] = String(first.warehouse_id);
        }
      }
      return next;
    });
  }, [available]);

  async function handleReturn(allocId: number, assetName: string) {
    setWorking(allocId);
    try {
      const r = await fetch(
        `${API_URL}/api/projects/${project!.id}/assets/${allocId}/return/`,
        { method: "POST", headers: authHeaders(), body: JSON.stringify({}) },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to return asset");
      toast({
        title: "Asset returned",
        description: `${assetName} returned to free pool`,
      });
      // Update state inline for instant feedback
      setState((s) =>
        s
          ? {
              ...s,
              budget_used: d.budget_used,
              budget_remaining: d.budget_remaining,
              budget_pct: d.budget_pct,
              assets: s.assets.filter((a) => a.allocation_id !== allocId),
            }
          : s,
      );
      onBudgetChange?.(d.budget_used);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWorking(null);
    }
  }

  async function handleAllocate(asset: AvailableAsset) {
    setAllocating(asset.id);
    try {
      const whId =
        warehouseChoice[asset.id] ||
        asset.warehouses.find((w) => w.available > 0)?.warehouse_id;
      if (!whId) {
        throw new Error("Select a warehouse with available stock.");
      }
      const r = await fetch(
        `${API_URL}/api/projects/${project!.id}/assets/allocate/`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ asset_id: asset.id, warehouse_id: Number(whId) }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to allocate asset");

      toast({
        title: d.over_budget ? "Allocated (over budget)" : "Asset allocated",
        description: `${asset.name} added to project${d.over_budget ? " — budget exceeded" : ""}`,
        variant: d.over_budget ? "destructive" : "default",
      });

      // Refresh both views
      await fetchAllocated();
      await fetchAvailable();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAllocating(null);
    }
  }

  const s = state;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{project?.name} — Asset Management</DialogTitle>
        </DialogHeader>

        {/* Budget Bar */}
        {s && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Budget Utilization</span>
              <span
                className={`font-semibold ${s.budget_pct >= 100 ? "text-destructive" : s.budget_pct >= 80 ? "text-warning" : "text-success"}`}
              >
                {s.budget_pct}%
              </span>
            </div>
            <Progress
              value={s.budget_pct}
              className={`h-2 ${s.budget_pct >= 100 ? "[&>div]:bg-destructive" : s.budget_pct >= 80 ? "[&>div]:bg-amber-500" : ""}`}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Used: AED {s.budget_used.toLocaleString()}</span>
              <span>Remaining: AED {s.budget_remaining.toLocaleString()}</span>
              <span>Total: AED {s.budget.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={view === "allocated" ? "default" : "outline"}
            onClick={() => setView("allocated")}
          >
            Allocated Assets {s && `(${s.assets.length})`}
          </Button>
          <Button
            size="sm"
            variant={view === "add" ? "default" : "outline"}
            onClick={() => setView("add")}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Asset
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {/* ── ALLOCATED LIST ── */}
          {view === "allocated" && (
            <>
              {loading && (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && s?.assets.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No assets allocated. Click "Add Asset" to get started.
                </p>
              )}
              {!loading &&
                s?.assets.map((a) => (
                  <div
                    key={a.allocation_id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {a.asset_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.asset_code} · {a.category} · {a.condition}
                      </p>
                      {a.warehouse && (
                        <p className="text-xs text-muted-foreground">
                          Warehouse: {a.warehouse.name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Since {a.allocated_date}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <span className="text-sm font-semibold whitespace-nowrap">
                        AED {a.purchase_cost.toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={working === a.allocation_id}
                        onClick={() =>
                          handleReturn(a.allocation_id, a.asset_name)
                        }
                      >
                        {working === a.allocation_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Return
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}

              {!loading && s && s.assets.length > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm font-semibold px-1">
                    <span>Total Asset Value</span>
                    <span>AED {s.budget_used.toLocaleString()}</span>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── ADD ASSET ── */}
          {view === "add" && (
            <>
              <div className="flex items-center gap-2 sticky top-0 bg-background py-1">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8"
                />
              </div>

              {s && (
                <p className="text-xs text-muted-foreground px-1">
                  Budget remaining:{" "}
                  <span className="font-medium">
                    AED {s.budget_remaining.toLocaleString()}
                  </span>
                  {s.budget_remaining <= 0 && (
                    <span className="ml-2 text-destructive flex items-center gap-1 inline-flex">
                      <AlertTriangle className="h-3 w-3" /> Budget exhausted
                    </span>
                  )}
                </p>
              )}

              {loadingAvail && (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loadingAvail && available.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No available assets found.
                </p>
              )}

              {!loadingAvail &&
                available.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        {a.within_budget ? (
                          <CheckCircle className="h-3 w-3 text-success flex-shrink-0" />
                        ) : (
                          <AlertTriangle
                            className="h-3 w-3 text-amber-500 flex-shrink-0"
                            title="Exceeds remaining budget"
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.asset_code} · {a.category} · {a.condition}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <select
                        className="h-8 px-2 rounded-md border border-border bg-background text-xs"
                        value={warehouseChoice[a.id] || ""}
                        onChange={(e) =>
                          setWarehouseChoice((p) => ({
                            ...p,
                            [a.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Warehouse…</option>
                        {a.warehouses.map((w) => (
                          <option
                            key={w.warehouse_id}
                            value={w.warehouse_id}
                            disabled={w.available <= 0}
                          >
                            {w.warehouse_name} ({w.available})
                          </option>
                        ))}
                      </select>
                      <span
                        className={`text-sm font-semibold whitespace-nowrap ${!a.within_budget ? "text-amber-600" : ""}`}
                      >
                        AED {a.purchase_cost.toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant={a.within_budget ? "default" : "outline"}
                        disabled={allocating === a.id}
                        onClick={() => handleAllocate(a)}
                      >
                        {allocating === a.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>

        <div className="pt-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
