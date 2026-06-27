// components/projects/ViewProjectDialog.tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Users,
  Package,
  Coins,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { type ProjectData } from "./AddProjectDialog";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${JSON.parse(window.sessionStorage.getItem("user") || "{}")?.access_token}`,
  };
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success text-success-foreground",
  completed: "bg-primary text-primary-foreground",
  on_hold: "bg-warning text-warning-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

interface DetailProject {
  id: number;
  name: string;
  code: string;
  description: string;
  status: string;
  budget: number;
  budget_used: number;
  budget_remaining: number;
  budget_pct: number;
  team_size: number;
  assets_count: number;
  start_date: string;
  end_date: string | null;
  is_overdue: boolean;
  notes: string;
  assets: {
    allocation_id: number;
    asset_id: number;
    asset_code: string;
    asset_name: string;
    category: string;
    purchase_cost: number;
    condition: string;
    allocated_date: string;
    allocated_by: string;
  }[];
  members: {
    member_id: number;
    user_id: number;
    user_name: string;
    user_email: string;
    role: string;
    role_label: string;
    joined_at: string;
  }[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectData | null;
}

export function ViewProjectDialog({ open, onOpenChange, project }: Props) {
  const [detail, setDetail] = useState<DetailProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "assets" | "members">("overview");
  const { toast } = useToast();

  useEffect(() => {
    if (open && project?.id) {
      setLoading(true);
      setDetail(null);
      fetch(`${API_URL}/api/projects/details/${project.id}/`, {
        headers: authHeaders(),
      })
        .then(async (r) => {
          const ct = r.headers.get("content-type") || "";
          if (!r.ok) {
            const text = ct.includes("application/json")
              ? JSON.stringify(await r.json())
              : await r.text();
            throw new Error(
              `Failed to load project details (${r.status}). ${text}`,
            );
          }
          return ct.includes("application/json") ? r.json() : Promise.reject(
            new Error("Server returned non-JSON response."),
          );
        })
        .then((d) => setDetail(d))
        .catch((e: any) => {
          toast({
            title: "Failed to load project details",
            description: e.message,
            variant: "destructive",
          });
        })
        .finally(() => setLoading(false));
    }
  }, [open, project?.id, toast]);

  const p = detail;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>{p?.name ?? project?.name}</DialogTitle>
            {p && (
              <Badge className={STATUS_COLORS[p.status] ?? "bg-muted"}>
                {p.status.replace("_", " ")}
              </Badge>
            )}
            {p?.is_overdue && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </Badge>
            )}
          </div>
          {p && (
            <p className="text-xs text-muted-foreground font-mono">{p.code}</p>
          )}
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["overview", "assets", "members"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px
                ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t}
              {t === "assets" && p && (
                <span className="ml-1 text-xs">({p.assets_count})</span>
              )}
              {t === "members" && p && (
                <span className="ml-1 text-xs">({p.team_size})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* ── OVERVIEW ── */}
          {!loading && p && tab === "overview" && (
            <div className="space-y-5 py-4">
              {p.description && (
                <p className="text-sm text-muted-foreground">{p.description}</p>
              )}

              {/* Budget */}
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Coins className="h-4 w-4" /> Budget Overview
                </h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Used</span>
                    <span className="font-medium">{p.budget_pct}%</span>
                  </div>
                  <Progress
                    value={p.budget_pct}
                    className={`h-2 ${p.budget_pct >= 90 ? "[&>div]:bg-destructive" : p.budget_pct >= 70 ? "[&>div]:bg-warning" : ""}`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Used: AED {p.budget_used.toLocaleString()}</span>
                    <span>Total: AED {p.budget.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Remaining: AED {p.budget_remaining.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <Package className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold">{p.assets_count}</p>
                  <p className="text-xs text-muted-foreground">Assets</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold">{p.team_size}</p>
                  <p className="text-xs text-muted-foreground">Members</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Calendar className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-2xl font-bold">
                    {p.end_date
                      ? Math.max(
                          0,
                          Math.ceil(
                            (new Date(p.end_date).getTime() - Date.now()) /
                              86400000,
                          ),
                        )
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Days left</p>
                </div>
              </div>

              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Start:</span>{" "}
                  {p.start_date}
                </div>
                <div>
                  <span className="text-muted-foreground">End:</span>{" "}
                  {p.end_date ?? "—"}
                </div>
              </div>
              {p.notes && (
                <div className="text-sm text-muted-foreground border rounded p-3">
                  {p.notes}
                </div>
              )}
            </div>
          )}

          {/* ── ASSETS ── */}
          {!loading && p && tab === "assets" && (
            <div className="py-4 space-y-3">
              {p.assets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No assets allocated to this project.
                </p>
              ) : (
                p.assets.map((a) => (
                  <div
                    key={a.allocation_id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{a.asset_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.asset_code} · {a.category} · {a.condition}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Allocated on {a.allocated_date} by {a.allocated_by}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-right">
                      AED {a.purchase_cost.toLocaleString()}
                    </p>
                  </div>
                ))
              )}
              <Separator />
              <div className="flex justify-between text-sm font-semibold px-1">
                <span>Total Asset Value</span>
                <span>AED {p.budget_used.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* ── MEMBERS ── */}
          {!loading && p && tab === "members" && (
            <div className="py-4 space-y-3">
              {p.members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No members in this project.
                </p>
              ) : (
                p.members.map((m) => (
                  <div
                    key={m.member_id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{m.user_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.user_email}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{m.role_label}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        Since {m.joined_at}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
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
