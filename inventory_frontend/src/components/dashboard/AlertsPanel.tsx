import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Package,
  Key,
  Wrench,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Alert {
  id: string;
  type: "warning" | "error" | "info";
  category: "license" | "stock" | "maintenance" | "expiry";
  title: string;
  description: string;
  daysLeft?: number;
}

const iconMap = {
  license: Key,
  stock: Package,
  maintenance: Wrench,
  expiry: Clock,
};

function authHeaders() {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user.access_token || ""}`,
  };
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    try {
      const response = await fetch(`${API_URL}/api/dashboard/alerts/`, {
        headers: authHeaders(),
      });

      if (response.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch alerts");
      }

      const data = await response.json();
      setAlerts(data);
    } catch (error: any) {
      console.error("Failed to fetch alerts:", error);
      toast({
        title: "Error",
        description: "Failed to load alerts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const criticalCount = alerts.filter((a) => a.type === "error").length;

  return (
    <div className="rounded-xl border bg-card shadow-card">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h3 className="font-semibold">Critical Alerts</h3>
        {criticalCount > 0 && (
          <Badge variant="destructive" className="font-medium">
            {criticalCount} Critical
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No alerts at this time
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y">
            {alerts.map((alert) => {
              const Icon = iconMap[alert.category];
              return (
                <div
                  key={alert.id}
                  className={cn(
                    "flex items-start gap-4 px-6 py-4 transition-colors",
                    alert.type === "error" && "bg-destructive/5",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-lg p-2",
                      alert.type === "error" &&
                        "bg-destructive/10 text-destructive",
                      alert.type === "warning" && "bg-warning/10 text-warning",
                      alert.type === "info" && "bg-info/10 text-info",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{alert.title}</p>
                      {alert.daysLeft !== undefined &&
                        alert.daysLeft !== null && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              alert.daysLeft <= 0 &&
                                "border-destructive text-destructive",
                              alert.daysLeft > 0 &&
                                alert.daysLeft <= 7 &&
                                "border-warning text-warning",
                              alert.daysLeft > 7 && "border-info text-info",
                            )}
                          >
                            {alert.daysLeft <= 0
                              ? `${Math.abs(alert.daysLeft)} days overdue`
                              : `${alert.daysLeft} days left`}
                          </Badge>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {alert.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t px-6 py-3">
            <button className="text-sm text-primary hover:underline font-medium">
              View all alerts
            </button>
          </div>
        </>
      )}
    </div>
  );
}
