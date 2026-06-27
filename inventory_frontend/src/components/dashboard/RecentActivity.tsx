import { useEffect, useState } from "react";
import {
  Package,
  UserCheck,
  ShoppingCart,
  Key,
  Wrench,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Activity {
  id: string;
  type: "asset" | "allocation" | "purchase" | "license" | "maintenance";
  title: string;
  description: string;
  time: string;
  user: string;
}

const iconMap = {
  asset: Package,
  allocation: UserCheck,
  purchase: ShoppingCart,
  license: Key,
  maintenance: Wrench,
};

const colorMap = {
  asset: "bg-primary/10 text-primary",
  allocation: "bg-success/10 text-success",
  purchase: "bg-info/10 text-info",
  license: "bg-warning/10 text-warning",
  maintenance: "bg-chart-5/10 text-chart-5",
};

function authHeaders() {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user.access_token || ""}`,
  };
}

export function RecentActivity() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchRecentActivity();
  }, []);

  async function fetchRecentActivity() {
    try {
      const response = await fetch(
        `${API_URL}/api/dashboard/recent-activity/`,
        {
          headers: authHeaders(),
        },
      );

      if (response.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch recent activity");
      }

      const data = await response.json();
      setActivities(data);
    } catch (error: any) {
      console.error("Failed to fetch recent activity:", error);
      toast({
        title: "Error",
        description: "Failed to load recent activity",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-card">
      <div className="border-b px-6 py-4">
        <h3 className="font-semibold">Recent Activity</h3>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activities.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </div>
      ) : (
        <>
          <div className="divide-y">
            {activities.map((activity) => {
              const Icon = iconMap[activity.type];
              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  <div
                    className={cn("rounded-lg p-2", colorMap[activity.type])}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{activity.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {activity.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {activity.time}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activity.user}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t px-6 py-3">
            <button className="text-sm text-primary hover:underline font-medium">
              View all activity
            </button>
          </div>
        </>
      )}
    </div>
  );
}
