import { useNavigate } from "react-router-dom";
import { Settings, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="border-t border-sidebar-border p-3">
      {/* User info (expanded only) */}
      {!collapsed && (
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-accent/50 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-sm font-medium">
            {user?.name?.charAt(0) || "U"}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.name}
            </p>
            <p className="truncate text-xs text-sidebar-muted capitalize">
              {user?.role}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-1">
        {collapsed ? (
          <>
            {/* <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/settings")}
                  className="h-10 w-10 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mx-auto"
                >
                  <Settings className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              {/* <TooltipContent side="right">Settings</TooltipContent> */}
            {/* </Tooltip> */}
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="h-10 w-10 text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground mx-auto"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Logout</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            {/* <Button
              variant="ghost"
              onClick={() => navigate("/settings")}
              className="justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Settings className="mr-3 h-5 w-5" />
              Settings
            </Button> */}
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="justify-start text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Logout
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
