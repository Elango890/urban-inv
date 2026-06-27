// src/App.tsx
// =============================================================================
// Auth flow (no separate /select-fy needed):
//   1. /login — shows credentials form (step 1) then FY picker (step 2)
//   2. After FY is chosen → navigate to /
//   3. AuthenticateUser checks sessionStorage token on every protected render
//   4. ProtectedRoute checks isAuthenticated + fySelected; redirects to /login
//      for either failure (Login auto-shows step 2 when user is already authed)
// =============================================================================

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";

import Dashboard from "./pages/Dashboard";
import Assets from "./pages/Assets";
import Vendors from "./pages/Vendors";

import Users from "./pages/Users";
import { ProtectedRoute } from "@/components/common/ProtectedRoute";

import FinancialYear from "./pages/FinancialYears";
import PurchaseEntries from "./pages/PurchaseEntries";
import PurchaseOrders from "./pages/PurchaseOrders";
import Stock from "./pages/Stock";

import Clients from "./pages/Clients";
import Warehouse from "./pages/Warehouse";
import SalesBilling from "./pages/SalesBilling";
import SalesHistory from "./pages/SalesHistory";
import SalesReturns from "./pages/SalesReturns";
import PettyCash from "./pages/PettyCash";
import Reports from "./pages/Reports";

import Audit from "./pages/Audit";
import Notifications from "./pages/Notifications";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import AuthenticateUser from "./authenticate user/AuthenticateUser";
import {
  ADMIN_ONLY_ROLES,
  ALL_ROLES,
  CUSTOMER_ROLES,
  OPERATIONS_ROLES,
  SALES_ROLES,
} from "@/lib/access";

const queryClient = new QueryClient();

const Router =
  window.location.protocol === "file:" ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Router>
        <AuthProvider>
          <Routes>
            {/* ── Public ──────────────────────────────────────────────────── */}
            {/*
             * /login handles BOTH steps:
             *   Step 1 — email + password
             *   Step 2 — financial year picker
             * No /select-fy needed; Login renders step 2 automatically
             * when the user is authenticated but fySelected = false.
             */}
            <Route path="/login" element={<Login />} />

            {/* ── Protected (needs auth + FY) ──────────────────────────────── */}
            <Route
              element={
                <AuthenticateUser>
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                </AuthenticateUser>
              }
            >
              {/* Dashboard */}
              <Route path="/" element={<ProtectedRoute allowedRoles={ALL_ROLES}><Dashboard /></ProtectedRoute>} />

              {/* Masters */}
              <Route path="/assets" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><Assets /></ProtectedRoute>} />
              <Route path="/vendors" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><Vendors /></ProtectedRoute>} />

              <Route path="/clients" element={<ProtectedRoute allowedRoles={CUSTOMER_ROLES}><Clients /></ProtectedRoute>} />

              <Route path="/financial-year" element={<ProtectedRoute allowedRoles={ADMIN_ONLY_ROLES}><FinancialYear /></ProtectedRoute>} />

              {/* Sales */}
              <Route path="/sales-billing" element={<ProtectedRoute allowedRoles={SALES_ROLES}><SalesBilling /></ProtectedRoute>} />
              <Route path="/sales-returns" element={<ProtectedRoute allowedRoles={SALES_ROLES}><SalesReturns /></ProtectedRoute>} />
              <Route path="/sales-history" element={<ProtectedRoute allowedRoles={SALES_ROLES}><SalesHistory /></ProtectedRoute>} />

              {/* Licenses */}

              {/* Petty Cash */}
              <Route path="/pettycash" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><PettyCash /></ProtectedRoute>} />

              {/* Users */}
              <Route path="/users" element={<ProtectedRoute allowedRoles={ADMIN_ONLY_ROLES}><Users /></ProtectedRoute>} />

              {/* Purchases */}
              <Route path="/purchase-orders" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><PurchaseOrders /></ProtectedRoute>} />
              <Route path="/purchase-entries" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><PurchaseEntries /></ProtectedRoute>} />

              {/* Stock & Warehouse */}
              <Route path="/stock" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><Stock /></ProtectedRoute>} />
              <Route path="/warehouse" element={<ProtectedRoute allowedRoles={OPERATIONS_ROLES}><Warehouse /></ProtectedRoute>} />

              {/* Assets & Maintenance */}

              {/* Reports & Admin */}
              <Route path="/reports" element={<ProtectedRoute allowedRoles={SALES_ROLES}><Reports /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute allowedRoles={ADMIN_ONLY_ROLES}><Audit /></ProtectedRoute>} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/profile" element={<ProtectedRoute allowedRoles={ALL_ROLES}><Profile /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute allowedRoles={ADMIN_ONLY_ROLES}><Settings /></ProtectedRoute>} />
            </Route>

            {/* ── 404 ──────────────────────────────────────────────────────── */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
