import {
  LayoutDashboard,
  Users,
  Package,
  Building2,
  ShoppingCart,
  Warehouse,
  UserCheck,
  Key,
  Wrench,
  BarChart3,
  FolderKanban,
  CheckSquare,
  FileText,
  Bell,
  Boxes,
  Truck,
  ShieldCheck,
  Home,
  CreditCard,
  UserCircle,
  Receipt,
  RotateCcw,
  BoldIcon,
} from "lucide-react";
import type { UserRole } from "@/contexts/AuthContext";
import {
  ADMIN_ONLY_ROLES,
  ALL_ROLES,
  CUSTOMER_ROLES,
  OPERATIONS_ROLES,
  SALES_ROLES,
} from "@/lib/access";

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles?: UserRole[];
}

export interface NavGroup {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  allowedRoles?: UserRole[];
}

export const navigationGroups: NavGroup[] = [
  {
    label: "General",
    icon: Home,
    allowedRoles: ALL_ROLES,
    items: [
      {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
        allowedRoles: ALL_ROLES,
      },
      {
        title: "Reports",
        href: "/reports",
        icon: BarChart3,
        allowedRoles: SALES_ROLES,
      },
      {
        title: "Stock",
        href: "/stock",
        icon: Warehouse,
        allowedRoles: OPERATIONS_ROLES,
      },
      // { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Masters",
    icon: BoldIcon,
    allowedRoles: SALES_ROLES,
    items: [
      {
        title: "Items",
        href: "/assets",
        icon: Package,
        allowedRoles: OPERATIONS_ROLES,
      },
      {
        title: "Financial Year",
        href: "/financial-year",
        icon: FolderKanban,
        allowedRoles: ADMIN_ONLY_ROLES,
      },
      {
        title: "Vendors",
        href: "/vendors",
        icon: Building2,
        allowedRoles: OPERATIONS_ROLES,
      },
      {
        title: "Customers",
        href: "/clients",
        icon: UserCircle,
        allowedRoles: CUSTOMER_ROLES,
      },
      {
        title: "Warehouse",
        href: "/warehouse",
        icon: Boxes,
        allowedRoles: OPERATIONS_ROLES,
      },
    ],
  },
  {
    label: "Purchases",
    icon: Truck,
    allowedRoles: OPERATIONS_ROLES,
    items: [
      {
        title: "Purchase Orders",
        href: "/purchase-orders",
        icon: ShoppingCart,
        allowedRoles: OPERATIONS_ROLES,
      },
      {
        title: "Purchase Entries",
        href: "/purchase-entries",
        icon: ShoppingCart,
        allowedRoles: OPERATIONS_ROLES,
      },
    ],
  },
  {
    label: "Sales",
    icon: Receipt,
    allowedRoles: SALES_ROLES,
    items: [
      {
        title: "Sales Billing",
        href: "/sales-billing",
        icon: FileText,
        allowedRoles: SALES_ROLES,
      },
      {
        title: "Sales Returns",
        href: "/sales-returns",
        icon: RotateCcw,
        allowedRoles: SALES_ROLES,
      },
      {
        title: "Sales History",
        href: "/sales-history",
        icon: FileText,
        allowedRoles: SALES_ROLES,
      },
      // { title: "Payments", href: "/payments", icon: CreditCard },
      {
        title: "Petty Cash",
        href: "/pettycash",
        icon: CreditCard,
        allowedRoles: OPERATIONS_ROLES,
      },
    ],
  },
  {
    label: "Administration",
    icon: ShieldCheck,
    items: [
      {
        title: "Users & Roles",
        href: "/users",
        icon: Users,
        allowedRoles: ADMIN_ONLY_ROLES,
      },
      {
        title: "Audit Logs",
        href: "/audit",
        icon: FileText,
        allowedRoles: ADMIN_ONLY_ROLES,
      },
      // { title: "Approvals", href: "/approvals", icon: CheckSquare },
    ],
    allowedRoles: ADMIN_ONLY_ROLES,
  },
];
