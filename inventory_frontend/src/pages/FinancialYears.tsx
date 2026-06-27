import { useEffect, useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarDays,
  MoreHorizontal,
  Plus,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCcw,
  Pencil,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinancialYear {
  id: number;
  yearName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

type FormData = {
  yearName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user?.access_token || ""}`,
  };
}

const EMPTY_FORM: FormData = {
  yearName: "",
  startDate: "",
  endDate: "",
  isActive: false,
};

function validate(form: FormData): FormErrors {
  const errors: FormErrors = {};
  if (!form.yearName.trim()) errors.yearName = "Year name is required";
  else if (form.yearName.trim().length < 4)
    errors.yearName = "Year name must be at least 4 characters";
  if (!form.startDate) errors.startDate = "Start date is required";
  if (!form.endDate) errors.endDate = "End date is required";
  if (form.startDate && form.endDate && form.endDate <= form.startDate)
    errors.endDate = "End date must be after start date";
  return errors;
}

// ─── FY Form Dialog ───────────────────────────────────────────────────────────

function FYFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: FinancialYear | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          yearName: initial.yearName,
          startDate: initial.startDate,
          endDate: initial.endDate,
          isActive: initial.isActive,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, initial]);

  function set<K extends keyof FormData>(k: K, v: FormData[K]) {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
  }

  async function handleSave() {
    const errs = validate(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    try {
      const url = initial
        ? `${API_URL}/api/masters/financial-years/${initial.id}/`
        : `${API_URL}/api/masters/financial-years/`;
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast({
        title: initial ? "Financial year updated" : "Financial year created",
      });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit Financial Year" : "Add Financial Year"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>
              Year Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. 2024-25 or FY2024"
              value={form.yearName}
              onChange={(e) => set("yearName", e.target.value)}
              className={errors.yearName ? "border-destructive" : ""}
            />
            {errors.yearName && (
              <p className="text-xs text-destructive">{errors.yearName}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>
                Start Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                className={errors.startDate ? "border-destructive" : ""}
              />
              {errors.startDate && (
                <p className="text-xs text-destructive">{errors.startDate}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>
                End Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                className={errors.endDate ? "border-destructive" : ""}
              />
              {errors.endDate && (
                <p className="text-xs text-destructive">{errors.endDate}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <input
              id="isActive"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <div>
              <Label htmlFor="isActive" className="cursor-pointer font-medium">
                Set as Active Year
              </Label>
              <p className="text-xs text-muted-foreground">
                This will deactivate the current active year
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initial ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Activate Confirm ─────────────────────────────────────────────────────────

function ActivateConfirm({
  open,
  onOpenChange,
  fy,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fy: FinancialYear | null;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleActivate() {
    if (!fy) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/masters/financial-years/${fy.id}/activate/`,
        { method: "PUT", headers: authHeaders() },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Activation failed");
      toast({ title: `${fy.yearName} is now the active financial year` });
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activate {fy?.yearName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will set <strong>{fy?.yearName}</strong> as the active
            financial year. All other years will be deactivated. New
            transactions will be recorded under this year.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleActivate} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Activate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialYears() {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FinancialYear | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchYears();
  }, []);

  async function fetchYears() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_URL}/api/masters/financial-years/`, {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load financial years");
      setYears(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const active = years.find((y) => y.isActive);

  function durationLabel(start: string, end: string) {
    const s = new Date(start);
    const e = new Date(end);
    const months = Math.round(
      (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30),
    );
    return `${months} months`;
  }

  if (loading) {
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
        <Button variant="outline" onClick={fetchYears}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Financial Years"
        description="Manage financial year periods for scoping transactions and reports"
        action={{
          label: "Add Financial Year",
          onClick: () => {
            setSelected(null);
            setFormOpen(true);
          },
        }}
      />

      {/* Active Year Banner */}
      {active && (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              Active Year: {active.yearName}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(active.startDate).toLocaleDateString("en-AE", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              →{" "}
              {new Date(active.endDate).toLocaleDateString("en-AE", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <Badge className="ml-auto bg-success text-success-foreground">
            Active
          </Badge>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: "Total Years",
            value: years.length,
            icon: CalendarDays,
            color: "text-primary",
          },
          {
            label: "Active Year",
            value: active?.yearName ?? "None",
            icon: CheckCircle2,
            color: "text-success",
          },
          {
            label: "Inactive",
            value: years.filter((y) => !y.isActive).length,
            icon: Clock,
            color: "text-muted-foreground",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 pt-5">
              <s.icon className={`h-8 w-8 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Year Cards */}
      {years.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed">
          <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No financial years found. Create one to get started.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSelected(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Financial Year
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {years.map((fy) => (
            <Card
              key={fy.id}
              className={`relative transition-shadow hover:shadow-card-hover ${
                fy.isActive ? "border-success/50 bg-success/5" : ""
              }`}
            >
              {fy.isActive && (
                <div className="absolute right-3 top-3">
                  <Badge className="bg-success text-success-foreground text-xs">
                    Active
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        fy.isActive
                          ? "bg-success/20 text-success"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{fy.yearName}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {durationLabel(fy.startDate, fy.endDate)}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 mt-0.5"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelected(fy);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      {!fy.isActive && (
                        <DropdownMenuItem
                          onClick={() => {
                            setSelected(fy);
                            setActivateOpen(true);
                          }}
                          className="text-success"
                        >
                          <Zap className="mr-2 h-4 w-4" /> Set as Active
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Start</span>
                  <span className="font-medium">
                    {new Date(fy.startDate).toLocaleDateString("en-AE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">End</span>
                  <span className="font-medium">
                    {new Date(fy.endDate).toLocaleDateString("en-AE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {!fy.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-1"
                    onClick={() => {
                      setSelected(fy);
                      setActivateOpen(true);
                    }}
                  >
                    <Zap className="mr-2 h-3 w-3" /> Activate
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FYFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={selected}
        onSaved={fetchYears}
      />
      <ActivateConfirm
        open={activateOpen}
        onOpenChange={setActivateOpen}
        fy={selected}
        onDone={fetchYears}
      />
    </div>
  );
}
