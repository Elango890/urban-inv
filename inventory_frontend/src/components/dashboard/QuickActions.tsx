import {
  Plus,
  Upload,
  UserCheck,
  FileText,
  ShoppingCart,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface QuickAction {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  adminOnly?: boolean;
  path: string;
}

const actions: QuickAction[] = [
  {
    title: "Add Asset",
    icon: Plus,
    description: "Register new hardware or software",
    path: "/assets",
  },
  {
    title: "Create PO",
    icon: ShoppingCart,
    description: "New purchase order",
    path: "/purchase-orders",
  },
  {
    title: "Assign Asset",
    icon: UserCheck,
    description: "Allocate to staff",
    path: "/allocations",
  },
  {
    title: "Add License",
    icon: Key,
    description: "Register new license",
    path: "/licenses",
  },
  {
    title: "Upload Invoice",
    icon: Upload,
    description: "Attach purchase invoice",
    path: "/purchase-entries",
  },
  {
    title: "Generate Report",
    icon: FileText,
    description: "Create custom report",
    adminOnly: true,
    path: "/reports",
  },
];

export function QuickActions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  const filteredActions = actions.filter(
    (action) => !action.adminOnly || isAdmin,
  );

  return (
    <div className="rounded-xl border bg-card p-6 shadow-card">
      <h3 className="font-semibold mb-4">Quick Actions</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {filteredActions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.title}
              variant="outline"
              onClick={() => navigate(action.path)}
              className="h-auto flex-col gap-2 p-4 hover:bg-primary hover:text-primary-foreground hover:border-primary group transition-colors"
            >
              <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">{action.title}</p>
                <p className="text-xs text-muted-foreground group-hover:text-primary-foreground/80 hidden sm:block">
                  {action.description}
                </p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
