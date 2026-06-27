import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { navigationGroups } from '@/config/navigation';
import { hasRoleAccess } from '@/lib/access';
import { SidebarLogo } from './sidebar/SidebarLogo';
import { SidebarNavGroup } from './sidebar/SidebarNavGroup';
import { SidebarFooter } from './sidebar/SidebarFooter';

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const { user } = useAuth();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar transition-all duration-300 flex flex-col',
        collapsed ? 'w-[70px]' : 'w-[260px]'
      )}
    >
      <SidebarLogo collapsed={collapsed} />

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-3">
          {navigationGroups
            .filter((group) => hasRoleAccess(user?.role, group.allowedRoles))
            .map((group) => (
              <SidebarNavGroup
                key={group.label}
                group={group}
                collapsed={collapsed}
                userRole={user?.role}
              />
            ))}
        </nav>
      </ScrollArea>

      <SidebarFooter collapsed={collapsed} />

      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="absolute -right-3 top-20 h-6 w-6 rounded-full border bg-card shadow-sm hover:bg-accent"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>
    </aside>
  );
}
