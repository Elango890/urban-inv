// src/contexts/AuthContext.tsx
// =============================================================================
// AuthContext — user auth + financial year selection
//
// FLOW:
//   1. User logs in → tokens saved to sessionStorage
//   2. Financial year selector shown → user picks FY
//   3. Selected FY saved to sessionStorage as "selectedFY"
//   4. All pages read FY from context; pass financialYearId in API calls
//   5. Header shows current FY with a switcher dropdown
// =============================================================================

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";

export type UserRole = "admin" | "staff" | "salesperson";

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole | undefined;
  avatar?: string;
};

export type FinancialYear = {
  id: number;
  yearName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

type AuthContextType = {
  user: User | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  setUser: (user: User | null) => void;

  // ── Financial Year ────────────────────────────────────────────────────────
  selectedFY: FinancialYear | null;
  setSelectedFY: (fy: FinancialYear) => void;
  financialYears: FinancialYear[];
  loadingFY: boolean;
  fetchFinancialYears: () => Promise<FinancialYear[]>;
  fySelected: boolean; // true once FY has been chosen (gates dashboard access)
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUserState] = useState<User | null>(null);
  const [selectedFY, setFYState] = useState<FinancialYear | null>(null);
  const [financialYears, setFYList] = useState<FinancialYear[]>([]);
  const [loadingFY, setLoadingFY] = useState(false);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    const userData = window.sessionStorage.getItem("user");
    if (userData) {
      try {
        const data = JSON.parse(userData);
        setUserState({ ...data, role: data.role?.toLowerCase() });
      } catch {
        /* corrupt storage */
      }
    }

    const fyData = window.sessionStorage.getItem("selectedFY");
    if (fyData) {
      try {
        setFYState(JSON.parse(fyData));
      } catch {
        /* corrupt storage */
      }
    }
  }, []);

  // ── User setter (also stores to sessionStorage) ───────────────────────────
  const setUser = (u: User | null) => {
    setUserState(u);
    if (!u) window.sessionStorage.removeItem("user");
  };

  // ── FY setter (persists to sessionStorage) ────────────────────────────────
  const setSelectedFY = useCallback((fy: FinancialYear) => {
    setFYState(fy);
    window.sessionStorage.setItem("selectedFY", JSON.stringify(fy));
  }, []);

  // ── Fetch financial years from API ────────────────────────────────────────
  const fetchFinancialYears = useCallback(async (): Promise<
    FinancialYear[]
  > => {
    const userData = window.sessionStorage.getItem("user");
    if (!userData) return [];

    const token = JSON.parse(userData)?.access_token;
    if (!token) return [];

    setLoadingFY(true);
    try {
      const res = await fetch(`${API_URL}/api/masters/financial-years/`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      const data: FinancialYear[] = await res.json();
      setFYList(data);
      setFYState((current) => {
        const matchedCurrent = current
          ? data.find((fy) => fy.id === current.id) || null
          : null;
        const activeFY = data.find((fy) => fy.isActive) || null;
        const nextFY = matchedCurrent || activeFY;
        if (nextFY) {
          window.sessionStorage.setItem("selectedFY", JSON.stringify(nextFY));
          return nextFY;
        }
        return current;
      });
      return data;
    } catch {
      return [];
    } finally {
      setLoadingFY(false);
    }
  }, []);

  // ── Auth helpers ──────────────────────────────────────────────────────────
  const login = () => window.sessionStorage.getItem("user");

  const closeSession = async () => {
    const userData = window.sessionStorage.getItem("user");
    if (!userData) return;
    const token = JSON.parse(userData)?.access_token;
    if (!token) return;
    try {
      await fetch(`${API_URL}/api/users/logout/`, {
        method: "POST",
        headers: authHeaders(token),
      });
    } catch {
      /* ignore */
    }
  };

  const logout = async () => {
    await closeSession();
    window.sessionStorage.clear();
    setUserState(null);
    setFYState(null);
    setFYList([]);
    navigate("/login");
  };

  const fySelected = selectedFY !== null;

  useEffect(() => {
    if (!user) return;
    if (financialYears.length > 0) return;
    fetchFinancialYears();
  }, [user, financialYears.length, fetchFinancialYears]);

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated: user !== null && user?.role !== undefined,
        login,
        logout,
        selectedFY,
        setSelectedFY,
        financialYears,
        loadingFY,
        fetchFinancialYears,
        fySelected,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined)
    throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

// ── Convenience hook for FY-aware API params ──────────────────────────────────
export function useFYParam(): string {
  const { selectedFY } = useAuth();
  return selectedFY ? `financialYearId=${selectedFY.id}` : "";
}
