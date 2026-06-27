// src/components/layout/Header.tsx
// =============================================================================
// Header with:
//   • Financial year badge + switcher dropdown (always visible)
//   • FY change also updates sessionStorage via setSelectedFY
//   • User menu with logout
//   • Search bar
// =============================================================================

import { useState } from "react";
import {
  Bell,
  Search,
  Menu,
  LogOut,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, FinancialYear } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const {
    user,
    logout,
    selectedFY,
    setSelectedFY,
    financialYears,
    fetchFinancialYears,
    loadingFY,
  } = useAuth();
  const navigate = useNavigate();
  const [switchingFY, setSwitchingFY] = useState(false);
  const [fyOpen, setFyOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // Open FY dropdown — fetch fresh list each time
  const handleFYOpen = async (open: boolean) => {
    setFyOpen(open);
    if (open && financialYears.length === 0) {
      await fetchFinancialYears();
    }
  };

  const handleSelectFY = (fy: FinancialYear) => {
    setSelectedFY(fy);
    setFyOpen(false);
    // Brief visual feedback
    setSwitchingFY(true);
    setTimeout(() => setSwitchingFY(false), 600);
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-AE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card px-4 md:px-6">
      {/* Mobile Menu */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Search */}
      {/* <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search assets, vendors, invoices..."
          className="pl-10 bg-secondary/50 border-0 focus-visible:ring-1"
        />
      </div> */}

      <div className="flex items-center gap-2 ml-auto">
        {/* ── Financial Year Switcher ─────────────────────────────────────── */}
        <DropdownMenu open={fyOpen} onOpenChange={handleFYOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2 h-9 px-3 rounded-xl border transition-all text-sm",
                selectedFY
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10",
              )}
            >
              {switchingFY ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="font-semibold text-xs hidden sm:inline">
                {selectedFY ? selectedFY.yearName : "No FY Selected"}
              </span>
              {/* <ChevronDown className="w-3 h-3 shrink-0 opacity-60" /> */}
            </button>
          </DropdownMenuTrigger>

          {/* <DropdownMenuContent align="end" className="w-72 p-2" sideOffset={8}>
            <DropdownMenuLabel className="px-2 pb-2">
              <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider">
                Financial Year
              </p>
              {selectedFY && (
                <p className="text-xs text-muted-foreground mt-0.5 font-normal">
                  {fmt(selectedFY.startDate)} → {fmt(selectedFY.endDate)}
                </p>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator /> */}

          {/* {loadingFY ? (
              <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading…</span>
              </div>
            ) : financialYears.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground">
                  No financial years found.
                </p>
                <button
                  onClick={() => {
                    setFyOpen(false);
                    navigate("/financial-years");
                  }}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Create one →
                </button>
              </div>
            ) : (
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {financialYears.map((fy) => {
                  const isSelected = selectedFY?.id === fy.id;
                  return (
                    <button
                      key={fy.id}
                      onClick={() => handleSelectFY(fy)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between transition-colors",
                        isSelected
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-accent text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={cn(
                            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <CalendarDays className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold">
                              {fy.yearName}
                            </span>
                            {fy.isActive && (
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {fmt(fy.startDate)} → {fmt(fy.endDate)}
                          </p>
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )} */}

          {/* <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs justify-center text-primary cursor-pointer"
              onClick={() => {
                setFyOpen(false);
                navigate("/financial-years");
              }}
            >
              Manage financial years →
            </DropdownMenuItem>
          </DropdownMenuContent> */}
        </DropdownMenu>

        {/* ── User Menu ──────────────────────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-semibold">{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {user?.email}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary mt-0.5">
                  {user?.role}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
