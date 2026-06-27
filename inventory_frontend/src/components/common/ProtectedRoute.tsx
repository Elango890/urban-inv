// src/components/common/ProtectedRoute.tsx
// =============================================================================
// Guards routes that require:
//   1. A valid authenticated user
//   2. A selected financial year (picked during Login step 2)
//
// Both checks redirect to /login — Login handles credential + FY selection
// in a single 2-step page, so there's no need for a separate /select-fy route.
// =============================================================================

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/contexts/AuthContext";
import { hasRoleAccess } from "@/lib/access";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { isAuthenticated, fySelected, user } = useAuth();
  const location = useLocation();

  // Not logged in → Login (step 1)
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Logged in but no FY chosen → Login (step 2 will be shown automatically)
  if (!fySelected) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Optional role gate
  if (!hasRoleAccess(user?.role, allowedRoles)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
