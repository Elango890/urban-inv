// src/authenticate user/AuthenticateUser.tsx
// =============================================================================
// Wraps all protected routes. Checks sessionStorage for a valid user token.
// If missing, redirects to /login. Shows a spinner while checking.
// =============================================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface AuthenticateUserProps {
  children: React.ReactNode;
}

const AuthenticateUser = ({ children }: AuthenticateUserProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const userData = window.sessionStorage.getItem("user");

    // Small delay lets AuthContext restore from sessionStorage first
    const timer = setTimeout(() => {
      if (!userData || !user) {
        navigate("/login", { replace: true });
      }
      setIsChecking(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [user, navigate]);

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthenticateUser;
