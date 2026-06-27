import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NavGroup } from '@/config/navigation';
import type { UserRole } from '@/contexts/AuthContext';
import { hasRoleAccess } from '@/lib/access';

interface SidebarNavGroupProps {
  group: NavGroup;
  collapsed: boolean;
  userRole: UserRole | undefined;
}

export function SidebarNavGroup({ group, collapsed, userRole }: SidebarNavGroupProps) {
  const location = useLocation();

  const visibleItems = group.items.filter(
    (item) => hasRoleAccess(userRole, item.allowedRoles)
  );

  const hasActiveChild = visibleItems.some(
    (item) => location.pathname === item.href
  );

  const [open, setOpen] = useState(hasActiveChild);

  // Don't render group if no visible items
  if (visibleItems.length === 0) return null;

  // Collapsed mode: show only icons with tooltips
  if (collapsed) {
    return (
      <div className="flex flex-col gap-1">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;

          return (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.href}
                  className={cn(
                    'flex items-center justify-center rounded-lg p-2.5 transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {item.title}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  // Expanded mode: collapsible group
  const GroupIcon = group.icon;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
          hasActiveChild
            ? 'text-sidebar-primary'
            : 'text-sidebar-muted hover:text-sidebar-foreground'
        )}
      >
        <GroupIcon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>

      <div
        className={cn(
          'flex flex-col gap-0.5 overflow-hidden transition-all duration-200',
          open ? 'max-h-96 opacity-100 mt-0.5' : 'max-h-0 opacity-0'
        )}
      >
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 pl-9 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              <span>{item.title}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
