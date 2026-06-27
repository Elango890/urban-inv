// =============================================================================
// Dashboard.tsx
//
// Fully self-contained dashboard page.
// All dashboard finance components are inlined for this page.
//
// FIXES vs original:
//   1. No imports from @/components/dashboard/* (those files don't exist)
//   2. Monthly spending shows AED — this is a UAE business system
//   3. All charts built with recharts (available in the project)
//   4. Proper loading/error states per section (not one global loader)
// =============================================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Coins,
  Loader2,
  FileText,
  ArrowUpRight,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalAssets: number;
  assetsChange: number;
  activeUsers: number;
  usersChange: number;
  pendingOrders: number;
  ordersChange: number;
  expiringLicenses: number;
  lowStockItems: number;
  assetUtilization: number;
  utilizationChange: number;
  monthlySpending: number;
  spendingChange: number;
  complianceRate: number;
  complianceChange: number;
  salesTotalInvoiced: number;
  salesTotalCollected: number;
  salesOutstanding: number;
  financialYearLabel: string;
  receivables: {
    total: number;
    current: number;
    overdue: number;
  };
  payables: {
    total: number;
    current: number;
    overdue: number;
  };
  cashFlowSummary: {
    openingCash: number;
    incomingCash: number;
    outgoingCash: number;
    closingCash: number;
  };
  cashFlowSeries: Array<{
    month: string;
    balance: number;
  }>;
  incomeExpenseSummary: {
    totalIncome: number;
    totalExpenses: number;
  };
  incomeExpenseSeries: Array<{
    month: string;
    income: number;
    expenses: number;
  }>;
  topExpenses: Array<{
    name: string;
    amount: number;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user?.access_token || ""}`,
  };
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) {
    window.sessionStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const formatCurrency = (value: number) =>
  `AED ${Number(value || 0).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatShortCurrency = (value: number) => {
  const absolute = Math.abs(value || 0);
  if (absolute >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `AED ${(value / 1_000).toFixed(0)}K`;
  return formatCurrency(value);
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  change,
  changePositive,
  icon: Icon,
  iconBg,
  description,
  onClick,
}: {
  title: string;
  value: string | number;
  change: string;
  changePositive: boolean;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`transition-all duration-200 ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        <div className="text-xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 flex items-center gap-1 text-[11px]">
          {changePositive ? (
            <TrendingUp className="h-3 w-3 text-green-500" />
          ) : (
            <TrendingDown className="h-3 w-3 text-destructive" />
          )}
          <span
            className={`text-xs font-medium ${
              changePositive ? "text-green-600" : "text-destructive"
            }`}
          >
            {change}
          </span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceProgressCard({
  title,
  subtitle,
  total,
  current,
  overdue,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  total: number;
  current: number;
  overdue: number;
  actionLabel: string;
  onAction?: () => void;
}) {
  const safeTotal = Math.max(total, 0);
  const currentPct = safeTotal > 0 ? Math.max(0, Math.min(100, (current / safeTotal) * 100)) : 0;
  const overduePct = safeTotal > 0 ? Math.max(0, Math.min(100, (overdue / safeTotal) * 100)) : 0;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-[1.2rem] font-semibold tracking-tight text-slate-900">
              {title}
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-slate-700" onClick={onAction}>
            <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
            {actionLabel}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div>
          <p className="text-xs text-slate-500">{subtitle}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            {formatCurrency(total)}
          </p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="flex h-full w-full">
            <div className="bg-blue-600" style={{ width: `${currentPct}%` }} />
            <div className="bg-orange-500" style={{ width: `${overduePct}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />
            <span>Current : <span className="font-semibold">{formatCurrency(current)}</span></span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
            <span>Overdue : <span className="font-semibold">{formatCurrency(overdue)}</span></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CashFlowPanel({
  financialYearLabel,
  summary,
  data,
}: {
  financialYearLabel: string;
  summary: DashboardStats["cashFlowSummary"];
  data: DashboardStats["cashFlowSeries"];
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-[1.2rem] font-semibold tracking-tight text-slate-900">
            Cash Flow
          </CardTitle>
          <Badge variant="outline" className="rounded-full border-slate-200 px-2.5 py-0.5 text-xs text-slate-600">
            {financialYearLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,2fr)_260px]">
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="cashFlowFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatShortCurrency} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v), "Balance"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: "12px" }}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#cashFlowFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <div>
            <p className="text-xs text-slate-500">Cash as on start of year</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.openingCash)}</p>
          </div>
          <div>
            <p className="text-xs text-emerald-600">Incoming</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.incomingCash)} <span className="text-base">( + )</span></p>
          </div>
          <div>
            <p className="text-xs text-rose-600">Outgoing</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(summary.outgoingCash)} <span className="text-base">( - )</span></p>
          </div>
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs text-blue-600">Cash as on end of year</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(summary.closingCash)} <span className="text-base">( = )</span></p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IncomeExpensePanel({
  financialYearLabel,
  summary,
  data,
}: {
  financialYearLabel: string;
  summary: DashboardStats["incomeExpenseSummary"];
  data: DashboardStats["incomeExpenseSeries"];
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-[1.2rem] font-semibold tracking-tight text-slate-900">
            Income and Expense
          </CardTitle>
          <Badge variant="outline" className="rounded-full border-slate-200 px-2.5 py-0.5 text-xs text-slate-600">
            {financialYearLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 py-5">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            <span className="shrink-0">Total Income</span>
            <span className="truncate font-semibold">{formatCurrency(summary.totalIncome)}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-slate-700 sm:justify-end">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
            <span className="shrink-0">Total Expenses</span>
            <span className="truncate font-semibold">{formatCurrency(summary.totalExpenses)}</span>
          </div>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatShortCurrency} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number, name: string) => [formatCurrency(v), name === "income" ? "Income" : "Expenses"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: "12px" }}
              />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="income" fill="#22c55e" radius={[5, 5, 0, 0]} maxBarSize={20} />
              <Bar dataKey="expenses" fill="#f43f5e" radius={[5, 5, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function TopExpensesPanel({
  financialYearLabel,
  data,
}: {
  financialYearLabel: string;
  data: DashboardStats["topExpenses"];
}) {
  const chartData = data.map((item, index) => ({
    ...item,
    color: ["#22c55e", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444"][index % 5],
  }));
  const total = chartData.reduce((sum, item) => sum + item.amount, 0);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-[1.2rem] font-semibold tracking-tight text-slate-900">
            Top Expenses
          </CardTitle>
          <Badge variant="outline" className="rounded-full border-slate-200 px-2.5 py-0.5 text-xs text-slate-600">
            {financialYearLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 py-5 lg:grid-cols-[210px_minmax(0,1fr)] lg:items-center">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} dataKey="amount" innerRadius={50} outerRadius={82} paddingAngle={2}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Expense"]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
            <p className="text-xs text-slate-500">All Expenses</p>
            <p className="mt-1 max-w-full break-words text-xl font-semibold leading-tight text-slate-900">
              {formatCurrency(total)}
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {chartData.length === 0 ? (
            <p className="text-sm text-slate-500">No expense data available for this financial year.</p>
          ) : (
            chartData.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: item.color }} />
                  <p className="truncate text-sm font-medium text-slate-700">{item.name}</p>
                </div>
                <p className="shrink-0 text-base font-semibold text-slate-900">{formatCurrency(item.amount)}</p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Dashboard Page ──────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, selectedFY } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fyQuery = selectedFY ? `?financialYearId=${selectedFY.id}` : "";
    apiFetch<DashboardStats>(`${API_URL}/api/dashboard/stats/${fyQuery}`)
      .then(setStats)
      .catch((e) => {
        if (e.message !== "Unauthorized") {
          toast({
            title: "Dashboard",
            description: "Could not load finance dashboard right now.",
            variant: "destructive",
          });
        }
      })
      .finally(() => setLoading(false));
  }, [selectedFY?.id, toast]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Welcome back, {user?.name?.split(" ")[0] || "there"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Finance, receivables, payables, and cash movement for {selectedFY?.yearName || "the active financial year"}.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-4">
                <div className="h-6 w-48 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-10 w-56 rounded bg-muted" />
                <div className="h-4 w-full rounded bg-muted" />
                <div className="h-4 w-2/3 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <FinanceProgressCard
              title="Total Receivables"
              subtitle="Total unpaid invoices"
              total={stats.receivables.total}
              current={stats.receivables.current}
              overdue={stats.receivables.overdue}
              actionLabel="New"
              onAction={() => navigate("/sales-billing")}
            />
            <FinanceProgressCard
              title="Total Payables"
              subtitle="Total unpaid bills"
              total={stats.payables.total}
              current={stats.payables.current}
              overdue={stats.payables.overdue}
              actionLabel="New"
              onAction={() => navigate("/purchase-entries")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Invoiced"
              value={formatCurrency(stats.salesTotalInvoiced)}
              change="Sales billing"
              changePositive={true}
              icon={FileText}
              iconBg="bg-indigo-500/10 text-indigo-600"
              description="all active invoices"
              onClick={() => navigate("/sales-history")}
            />
            <StatCard
              title="Total Collected"
              value={formatCurrency(stats.salesTotalCollected)}
              change="Receipts posted"
              changePositive={true}
              icon={Coins}
              iconBg="bg-emerald-500/10 text-emerald-600"
              description="customer payments"
              onClick={() => navigate("/sales-history")}
            />
            <StatCard
              title="Outstanding"
              value={formatCurrency(stats.salesOutstanding)}
              change={stats.salesOutstanding > 0 ? "Needs follow-up" : "All clear"}
              changePositive={stats.salesOutstanding <= 0}
              icon={Activity}
              iconBg="bg-rose-500/10 text-rose-600"
              description="sales receivables"
              onClick={() => navigate("/sales-history")}
            />
            <StatCard
              title="Low Stock Items"
              value={stats.lowStockItems}
              change={stats.lowStockItems === 0 ? "All stocked" : `${stats.lowStockItems} items`}
              changePositive={stats.lowStockItems === 0}
              icon={AlertTriangle}
              iconBg="bg-destructive/10 text-destructive"
              description="below threshold"
              onClick={() => navigate("/stock")}
            />
          </div>

          <CashFlowPanel
            financialYearLabel={stats.financialYearLabel}
            summary={stats.cashFlowSummary}
            data={stats.cashFlowSeries}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <IncomeExpensePanel
              financialYearLabel={stats.financialYearLabel}
              summary={stats.incomeExpenseSummary}
              data={stats.incomeExpenseSeries}
            />
            <TopExpensesPanel
              financialYearLabel={stats.financialYearLabel}
              data={stats.topExpenses}
            />
          </div>
        </>
      ) : null}

    </div>
  );
}
