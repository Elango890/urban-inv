import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// StatusType is widened to string so any page can pass arbitrary status values
// without TypeScript errors. Known values get styled; unknowns get a neutral style.
export type StatusType =
  | "active"
  | "inactive"
  | "expired"
  | "pending"
  | "warning"
  | "error"
  | "success"
  | "info"
  // allocation / asset statuses
  | "allocated"
  | "returned"
  | "transferred"
  | "revoked"
  | "in_repair"
  | "disposed"
  // payment statuses
  | "unpaid"
  | "partial"
  | "paid"
  | "cancelled"
  // maintenance statuses (frontend-mapped)
  | "on_hold"
  // catch-all — accepts any string without TS error
  | (string & {}); // ← widens to string while keeping autocomplete

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  className?: string;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface BadgeConfig {
  variant: BadgeVariant;
  className: string;
}

// ─── Style map ────────────────────────────────────────────────────────────────
// Keys are lowercased at lookup time so "Active", "ACTIVE", "active" all match.
const STATUS_CONFIG: Record<string, BadgeConfig> = {
  // Generic
  active: {
    variant: "default",
    className: "bg-green-600 hover:bg-green-700 text-white",
  },
  inactive: {
    variant: "secondary",
    className: "bg-muted text-muted-foreground",
  },
  pending: {
    variant: "outline",
    className: "border-yellow-500 text-yellow-600",
  },
  expired: { variant: "destructive", className: "" },
  warning: {
    variant: "outline",
    className: "border-yellow-500 bg-yellow-500/10 text-yellow-600",
  },
  error: { variant: "destructive", className: "" },
  success: {
    variant: "default",
    className: "bg-green-600 hover:bg-green-700 text-white",
  },
  info: {
    variant: "outline",
    className: "border-blue-500 bg-blue-500/10 text-blue-600",
  },

  // Allocation
  allocated: {
    variant: "default",
    className: "bg-green-600 hover:bg-green-700 text-white",
  },
  returned: {
    variant: "secondary",
    className: "bg-muted text-muted-foreground",
  },
  transferred: {
    variant: "outline",
    className: "border-blue-500 text-blue-600",
  },
  revoked: { variant: "destructive", className: "" },

  // Asset status
  in_repair: {
    variant: "outline",
    className: "border-orange-500 bg-orange-500/10 text-orange-600",
  },
  disposed: {
    variant: "secondary",
    className: "bg-muted text-muted-foreground line-through",
  },

  // Payment / invoice
  unpaid: { variant: "destructive", className: "" },
  partial: {
    variant: "outline",
    className: "border-yellow-500 text-yellow-600",
  },
  paid: {
    variant: "default",
    className: "bg-green-600 hover:bg-green-700 text-white",
  },
  cancelled: {
    variant: "secondary",
    className: "bg-muted text-muted-foreground",
  },

  // Maintenance
  on_hold: {
    variant: "outline",
    className: "border-orange-500 bg-orange-500/10 text-orange-600",
  },
};

// ─── Fallback labels for known keys ───────────────────────────────────────────
const DEFAULT_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  pending: "Pending",
  warning: "Warning",
  error: "Error",
  success: "Success",
  expired: "Expired",
  info: "Info",
  allocated: "Allocated",
  returned: "Returned",
  transferred: "Transferred",
  revoked: "Revoked",
  in_repair: "In Repair",
  disposed: "Disposed",
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

const FALLBACK_CONFIG: BadgeConfig = {
  variant: "outline",
  className: "border-muted-foreground/40 text-muted-foreground",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const key = (status ?? "").toString().toLowerCase();
  const config = STATUS_CONFIG[key] ?? FALLBACK_CONFIG;

  // Derive display label: prop > known map > title-case the raw value
  const displayLabel =
    label ??
    DEFAULT_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {displayLabel}
    </Badge>
  );
}
