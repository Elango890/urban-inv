import { useState, useEffect } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  User,
  Package,
  Settings,
  LogIn,
  LogOut,
  Edit,
  Trash,
  Plus,
  Download,
  Eye,
  Loader2,
  Wrench,
  ShoppingCart,
  Building2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  userId: number;
  action: "create" | "update" | "delete" | "login" | "logout" | "view";
  resource: string;
  resourceType:
    | "asset"
    | "user"
    | "license"
    | "purchase"
    | "vendor"
    | "maintenance"
    | "system";
  resourceId?: number;
  details: string;
  ipAddress: string;
  userAgent?: string;
  changes?: { field: string; oldValue: string; newValue: string }[];
}

interface Stats {
  today_logs: number;
  total_logs: number;
  active_users: number;
  changes_today: number;
}

function authHeaders() {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user.access_token || ""}`,
  };
}

const actionConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  create: { icon: Plus, color: "bg-success/10 text-success" },
  update: { icon: Edit, color: "bg-info/10 text-info" },
  delete: { icon: Trash, color: "bg-destructive/10 text-destructive" },
  login: { icon: LogIn, color: "bg-primary/10 text-primary" },
  logout: { icon: LogOut, color: "bg-muted text-muted-foreground" },
  view: { icon: Eye, color: "bg-warning/10 text-warning" },
};

const resourceTypeIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  asset: Package,
  user: User,
  license: FileText,
  purchase: ShoppingCart,
  vendor: Building2,
  maintenance: Wrench,
  system: Settings,
};

export default function Audit() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<Stats>({
    today_logs: 0,
    total_logs: 0,
    active_users: 0,
    changes_today: 0,
  });
  const [loading, setLoading] = useState(true);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (user?.role === "admin") {
      fetchLogs();
      fetchStats();
    }
  }, [user]);

  async function fetchLogs() {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/audit/`, {
        headers: authHeaders(),
      });

      if (response.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch audit logs");
      }

      setLogs(data.results || data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const response = await fetch(`${API_URL}/api/audit/stats/`, {
        headers: authHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  }

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const handleExportLogs = () => {
    const csvContent = [
      [
        "Timestamp",
        "User",
        "Action",
        "Resource Type",
        "Resource",
        "Details",
        "IP Address",
      ].join(","),
      ...logs.map((log) =>
        [
          log.timestamp,
          log.user,
          log.action,
          log.resourceType,
          log.resource,
          log.details,
          log.ipAddress,
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();

    toast({
      title: "Export Complete",
      description: "Audit logs have been exported successfully.",
    });
  };

  const handleViewLog = (log: AuditLog) => {
    setSelectedLog(log);
    setViewDialogOpen(true);
  };

  const columns = [
    {
      key: "timestamp",
      header: "Timestamp",
      render: (log: AuditLog) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {new Date(log.timestamp).toLocaleString()}
        </span>
      ),
    },
    {
      key: "user",
      header: "User",
      render: (log: AuditLog) => (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
            {log.user
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </div>
          <span className="font-medium">{log.user}</span>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (log: AuditLog) => {
        const config = actionConfig[log.action] || {
          icon: Edit,
          color: "bg-muted text-muted-foreground",
        };
        const Icon = config.icon;
        return (
          <div className="flex items-center gap-2">
            <div className={`rounded p-1 ${config.color}`}>
              <Icon className="h-3 w-3" />
            </div>
            <Badge variant="outline" className="capitalize">
              {log.action}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "resource",
      header: "Resource",
      render: (log: AuditLog) => {
        const Icon = resourceTypeIcons[log.resourceType] || FileText;
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{log.resource}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {log.resourceType}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "details",
      header: "Details",
      render: (log: AuditLog) => (
        <span className="text-sm text-muted-foreground">{log.details}</span>
      ),
    },
    {
      key: "ipAddress",
      header: "IP Address",
      render: (log: AuditLog) => (
        <code className="text-xs bg-muted px-2 py-1 rounded">
          {log.ipAddress || "N/A"}
        </code>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (log: AuditLog) => (
        <Button variant="ghost" size="icon" onClick={() => handleViewLog(log)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Audit Logs"
        description="Track all user actions and system changes"
      >
        <Button variant="outline" onClick={handleExportLogs}>
          <Download className="mr-2 h-4 w-4" />
          Export Logs
        </Button>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.today_logs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Logs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_logs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active_users}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Changes Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.changes_today}</div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={logs}
        columns={columns}
        searchPlaceholder="Search logs..."
        filterOptions={[
          {
            key: "action",
            label: "Action",
            options: [
              { value: "create", label: "Create" },
              { value: "update", label: "Update" },
              { value: "delete", label: "Delete" },
              { value: "login", label: "Login" },
              { value: "logout", label: "Logout" },
              { value: "view", label: "View" },
            ],
          },
          {
            key: "resourceType",
            label: "Resource",
            options: [
              { value: "asset", label: "Asset" },
              { value: "user", label: "User" },
              { value: "license", label: "License" },
              { value: "purchase", label: "Purchase" },
              { value: "vendor", label: "Vendor" },
              { value: "maintenance", label: "Maintenance" },
              { value: "system", label: "System" },
            ],
          },
        ]}
      />

      {/* View Log Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              Complete information about this action
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Timestamp</p>
                  <p className="font-medium">
                    {new Date(selectedLog.timestamp).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">User</p>
                  <p className="font-medium">{selectedLog.user}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Action</p>
                  <Badge variant="outline" className="capitalize mt-1">
                    {selectedLog.action}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Resource Type</p>
                  <Badge variant="outline" className="capitalize mt-1">
                    {selectedLog.resourceType}
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Resource</p>
                <p className="font-medium">{selectedLog.resource}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Details</p>
                <p className="text-sm">{selectedLog.details}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">IP Address</p>
                <code className="text-sm bg-muted px-2 py-1 rounded">
                  {selectedLog.ipAddress || "N/A"}
                </code>
              </div>
              {selectedLog.changes && selectedLog.changes.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Changes Made
                  </p>
                  <div className="space-y-2">
                    {selectedLog.changes.map((change, index) => (
                      <div
                        key={index}
                        className="rounded-lg bg-muted p-3 text-sm"
                      >
                        <p className="font-medium capitalize">{change.field}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-destructive line-through">
                            {change.oldValue}
                          </span>
                          <span>→</span>
                          <span className="text-success">
                            {change.newValue}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
