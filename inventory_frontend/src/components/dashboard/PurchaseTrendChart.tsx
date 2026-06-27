import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

interface TrendData {
  month: string;
  purchases: number;
  budget: number;
}

function authHeaders() {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user.access_token || ""}`,
  };
}

export function PurchaseTrendChart() {
  const [data, setData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchPurchaseTrends();
  }, []);

  async function fetchPurchaseTrends() {
    try {
      const response = await fetch(
        `${API_URL}/api/dashboard/purchase-trends/`,
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
        throw new Error("Failed to fetch purchase trends");
      }

      const result = await response.json();
      setData(result);
    } catch (error: any) {
      console.error("Failed to fetch purchase trends:", error);
      toast({
        title: "Error",
        description: "Failed to load purchase trends",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Purchase Trends</h3>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">Purchases</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
            <span className="text-muted-foreground">Budget</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No purchase data available
          </p>
        </div>
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(234, 89%, 58%)"
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(234, 89%, 58%)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value) => `AED ${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                formatter={(value: number) => [
                  `$${value.toLocaleString()}`,
                  "",
                ]}
              />
              <Area
                type="monotone"
                dataKey="budget"
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.3}
                strokeDasharray="5 5"
                fill="none"
              />
              <Area
                type="monotone"
                dataKey="purchases"
                stroke="hsl(234, 89%, 58%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPurchases)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
