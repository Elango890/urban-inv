// src/pages/Login.tsx
// =============================================================================
// STEP 1: Enter email + password → authenticate
// STEP 2: Pick financial year → go to dashboard
//
// Selected FY is saved to sessionStorage and the AuthContext so all pages
// can scope their API calls to the correct financial year.
// =============================================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { useAuth, FinancialYear } from "@/contexts/AuthContext";
import { isBlank, isEmail } from "@/lib/validation";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { cn } from "@/lib/utils";

const API_URL =
  (window as any).__APP_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000";

async function readApiBody(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text();
  const titleMatch = text.match(/<title>(.*?)<\/title>/i);
  return {
    error:
      titleMatch?.[1]?.trim() ||
      "The server returned an unexpected response. Please try again.",
  };
}

function getToken() {
  try {
    return (
      JSON.parse(window.sessionStorage.getItem("user") || "{}")?.access_token ??
      ""
    );
  } catch {
    return "";
  }
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

// ─── UI Atoms ─────────────────────────────────────────────────────────────────

const Inp = ({
  className,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...p}
    className={cn(
      "w-full h-11 px-4 rounded-xl border border-border bg-background text-sm text-foreground",
      "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
      "focus:border-primary transition-colors",
      className,
    )}
  />
);

// ─── Financial Year Card ──────────────────────────────────────────────────────

function FYCard({
  fy,
  selected,
  onClick,
}: {
  fy: FinancialYear;
  selected: boolean;
  onClick: () => void;
}) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-AE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-2xl border p-4 transition-all duration-150",
        "hover:border-primary/50 hover:bg-primary/5",
        selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              selected
                ? "bg-primary text-primary-foreground"
                : fy.isActive
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-foreground text-sm">{fy.yearName}</p>
              {fy.isActive && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmt(fy.startDate)} → {fmt(fy.endDate)}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
            selected ? "border-primary bg-primary" : "border-border",
          )}
        >
          {selected && (
            <svg
              viewBox="0 0 10 10"
              className="w-2.5 h-2.5 text-white"
              fill="none"
            >
              <path
                d="M2 5l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Main Login Page ──────────────────────────────────────────────────────────

export default function Login() {
  const { setUser, user, fetchFinancialYears, setSelectedFY, selectedFY } =
    useAuth();
  const navigate = useNavigate();

  // ── Step: "credentials" | "fy" ────────────────────────────────────────────
  const [step, setStep] = useState<"credentials" | "fy">("credentials");

  // ── Credentials form ──────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPwd] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  // ── FY selection ──────────────────────────────────────────────────────────
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loadingFY, setLoadingFY] = useState(false);
  const [pickedFY, setPickedFY] = useState<FinancialYear | null>(null);
  const [fyError, setFyError] = useState("");

  // ── Redirect if already fully authenticated ───────────────────────────────
  useEffect(() => {
    const userData = window.sessionStorage.getItem("user");
    const fyData = window.sessionStorage.getItem("selectedFY");
    if (userData && fyData && user) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  // ─── Step 1: Authenticate ─────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof fieldErrors = {};
    if (isBlank(email)) next.email = "Email is required.";
    else if (!isEmail(email)) next.email = "Enter a valid email.";
    if (isBlank(password)) next.password = "Password is required.";
    if (Object.keys(next).length) {
      setFieldErrors(next);
      setError("");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/users/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await readApiBody(res);
      if (!res.ok) throw new Error(data.error || "Login failed");

      // Persist tokens
      window.sessionStorage.setItem("user", JSON.stringify(data));
      setUser({ ...data, role: data.role?.toLowerCase() });

      // Move to FY selection
      setLoadingFY(true);
      const fys = await fetchFinancialYears();
      setYears(fys);

      // Auto-select the active FY if one exists
      const active = fys.find((f) => f.isActive);
      if (active) setPickedFY(active);

      setStep("fy");
    } catch (err: any) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
      setLoadingFY(false);
    }
  };

  // ─── Step 2: Choose FY then go to dashboard ───────────────────────────────
  const handleFYConfirm = async () => {
    if (!pickedFY) {
      setFyError("Please select a financial year to continue.");
      return;
    }
    setFyError("");
    try {
      if (!pickedFY.isActive) {
        const res = await fetch(
          `${API_URL}/api/masters/financial-years/${pickedFY.id}/activate/`,
          { method: "PUT", headers: authHeaders() },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Activation failed");
      }
      setSelectedFY({ ...pickedFY, isActive: true });
      navigate("/", { replace: true });
    } catch (err: any) {
      setFyError(getApiErrorMessage(err));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        {/* ── STEP 1: Credentials ─────────────────────────────────────────── */}
        {step === "credentials" && (
          <div className="bg-card border border-border rounded-3xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
                  <Package className="w-8 h-8 text-primary-foreground" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Welcome back
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Sign in to manage your inventory
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="px-8 pb-8 space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Inp
                    type="email"
                    placeholder="admin@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((p) => ({ ...p, email: undefined }));
                    }}
                    className={cn(
                      "pl-10",
                      fieldErrors.email &&
                        "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20",
                    )}
                    autoComplete="email"
                  />
                </div>
                {fieldErrors.email && (
                  <p className="text-xs text-rose-500">{fieldErrors.email}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Inp
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((p) => ({ ...p, password: undefined }));
                    }}
                    className={cn(
                      "pl-10 pr-10",
                      fieldErrors.password &&
                        "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20",
                    )}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="text-xs text-rose-500">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <span className="text-sm text-rose-600">{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign In <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 pt-2">
                <div className="w-6 h-1.5 rounded-full bg-primary" />
                <div className="w-6 h-1.5 rounded-full bg-muted" />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Step 1 of 2 — Sign in
              </p>
            </form>
          </div>
        )}

        {/* ── STEP 2: Financial Year Selection ────────────────────────────── */}
        {step === "fy" && (
          <div className="bg-card border border-border rounded-3xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg">
                  <CalendarDays className="w-8 h-8 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Select Financial Year
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose the financial year to work in. You can switch it later
                  from the header.
                </p>
              </div>
            </div>

            <div className="px-8 pb-8 space-y-4">
              {/* FY list */}
              {loadingFY ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Loading financial years…
                  </p>
                </div>
              ) : years.length === 0 ? (
                <div className="text-center py-10 space-y-3">
                  <CalendarDays className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm font-medium text-foreground">
                    No financial years found
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ask an admin to create a financial year first.
                  </p>
                  <button
                    onClick={() => {
                      setStep("credentials");
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    ← Go back
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                  {years.map((fy) => (
                    <FYCard
                      key={fy.id}
                      fy={fy}
                      selected={pickedFY?.id === fy.id}
                      onClick={() => {
                        setPickedFY(fy);
                        setFyError("");
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Error */}
              {fyError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <span className="text-sm text-rose-600">{fyError}</span>
                </div>
              )}

              {/* Actions */}
              {years.length > 0 && (
                <>
                  <button
                    onClick={handleFYConfirm}
                    disabled={!pickedFY}
                    className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {pickedFY
                      ? `Continue with ${pickedFY.yearName}`
                      : "Select a year to continue"}
                  </button>

                  <button
                    onClick={() => setStep("credentials")}
                    className="w-full h-9 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                  </button>
                </>
              )}

              {/* Step indicator */}
              <div className="flex items-center justify-center gap-2 pt-1">
                <div className="w-6 h-1.5 rounded-full bg-muted" />
                <div className="w-6 h-1.5 rounded-full bg-primary" />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Step 2 of 2 — Select financial year
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
