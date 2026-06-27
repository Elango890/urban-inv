import { Package } from 'lucide-react';

interface SidebarLogoProps {
  collapsed: boolean;
}

export function SidebarLogo({ collapsed }: SidebarLogoProps) {
  return (
    <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
      {!collapsed ? (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <Package className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-sidebar-foreground">
            InvenTrack
          </span>
        </div>
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary mx-auto">
          <Package className="h-5 w-5 text-sidebar-primary-foreground" />
        </div>
      )}
    </div>
  );
}
