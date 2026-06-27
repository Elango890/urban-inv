import type { UserRole } from "@/contexts/AuthContext";

export const ALL_ROLES: UserRole[] = [
  "admin",
  "staff",
  "salesperson",
];

export const ADMIN_ONLY_ROLES: UserRole[] = ["admin"];
export const OPERATIONS_ROLES: UserRole[] = ["admin", "staff"];
export const SALES_ROLES: UserRole[] = ["admin", "staff", "salesperson"];
export const CUSTOMER_ROLES: UserRole[] = ["admin", "staff", "salesperson"];

export function hasRoleAccess(
  userRole: UserRole | undefined,
  allowedRoles?: UserRole[],
) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}
