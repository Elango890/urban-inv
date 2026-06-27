// =============================================================================
// Users.tsx
//
// Fully self-contained Users & Roles page.
// All 6 dialog components are inlined — no external @/components/users/* imports.
//
// Dialogs:
//   AddUserDialog        — register new user (admin/staff/salesperson)
//   ViewProfileDialog    — read-only user detail panel
//   EditUserDialog       — update name/email/department/role/status
//   ResetPasswordDialog  — admin sets a new password for any user
//   DeleteUserDialog     — confirm permanent deletion
//
// FIXES vs original:
//   1. No imports from @/components/users/* (those files don't exist)
//   2. Proper loading + error states per action
//   3. fetchUsers URL corrected to /api/users/users/ (consistent with urls.py)
//   4. All API responses use authHeaders() helper
//   5. Avatar initials always upper-cased
//   6. Role badge shows 3 tiers: admin / staff / salesperson
// =============================================================================

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  User,
  Eye,
  Edit,
  KeyRound,
  Trash2,
  Loader2,
  RefreshCcw,
  UserCheck,
  Building2,
  Clock,
  CheckCircle,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isBlank, isEmail } from "@/lib/validation";
import { getApiErrorMessage } from "@/lib/apiErrors";

const API_URL = (window as any).__APP_API_URL__ || import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserDataType {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff" | "salesperson";
  department: string;
  status: "active" | "inactive";
  last_login: string | null;
  is_active: boolean;
  created_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const user = JSON.parse(window.sessionStorage.getItem("user") || "{}");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${user?.access_token || ""}`,
  };
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const ROLE_CONFIG: Record<string, { label: string; cls: string }> = {
  admin: {
    label: "Admin",
    cls: "bg-primary/10 text-primary border-primary/30",
  },
  staff: {
    label: "Staff",
    cls: "bg-blue-500/10 text-blue-600 border-blue-300",
  },
  salesperson: {
    label: "Salesperson",
    cls: "bg-emerald-500/10 text-emerald-600 border-emerald-300",
  },
};

const DEPARTMENTS = [
  "IT",
  "HR",
  "Finance",
  "Sales",
  "Marketing",
  "Operations",
  "Admin",
  "Other",
];

// ─── Add User Dialog ──────────────────────────────────────────────────────────

function AddUserDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    department: "",
  });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function set(k: string, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!p[k as "name" | "email"]) return p;
      const n = { ...p };
      delete n[k as "name" | "email"];
      return n;
    });
  }

  useEffect(() => {
    if (!open)
      setForm({ name: "", email: "", role: "staff", department: "" });
    if (!open) setErrors({});
  }, [open]);

  async function handleSave() {
    const nextErrors: { name?: string; email?: string } = {};
    if (isBlank(form.name)) nextErrors.name = "Name is required.";
    if (isBlank(form.email)) nextErrors.email = "Email is required.";
    else if (!isEmail(form.email))
      nextErrors.email = "Enter a valid email.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast({ title: "Please fix the errors", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/users/register/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      toast({
        title: "User created",
        description: data.password_sent
          ? "Credentials sent by email"
          : "User added without password",
      });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Full Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="John Smith"
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Email *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="john@company.com"
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="salesperson">Salesperson</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {form.role && (
              <p className="text-xs text-muted-foreground">
                Credentials will be emailed to this user.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Department</Label>
            <Select
              value={form.department}
              onValueChange={(v) => set("department", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── View Profile Dialog ──────────────────────────────────────────────────────

function ViewProfileDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserDataType | null;
}) {
  if (!user) return null;
  const roleCfg = ROLE_CONFIG[user.role] || ROLE_CONFIG.staff;

  const row = (label: string, value: string | number | null | undefined) => (
    <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Profile</DialogTitle>
        </DialogHeader>
        {/* Avatar + name header */}
        <div className="flex items-center gap-4 py-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
            {initials(user.name)}
          </div>
          <div>
            <p className="text-lg font-semibold">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <Badge variant="outline" className={`mt-1 text-xs ${roleCfg.cls}`}>
              {roleCfg.label}
            </Badge>
          </div>
        </div>
        <div className="mt-2 space-y-0">
          {row("Department", user.department || "—")}
          {row("Status", user.is_active ? "Active" : "Inactive")}
          {row(
            "Last Login",
            user.last_login
              ? new Date(user.last_login).toLocaleString()
              : "Never",
          )}
          {row(
            "Created",
            user.created_at
              ? new Date(user.created_at).toLocaleDateString()
              : "—",
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit User Dialog ─────────────────────────────────────────────────────────

function EditUserDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserDataType | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    department: "",
    status: "active",
  });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department || "",
        status: user.status,
      });
      setErrors({});
    }
  }, [user, open]);

  function set(k: string, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!p[k as "name" | "email"]) return p;
      const n = { ...p };
      delete n[k as "name" | "email"];
      return n;
    });
  }

  async function handleSave() {
    if (!user) return;
    const nextErrors: { name?: string; email?: string } = {};
    if (isBlank(form.name)) nextErrors.name = "Name is required.";
    if (isBlank(form.email)) nextErrors.email = "Email is required.";
    else if (!isEmail(form.email))
      nextErrors.email = "Enter a valid email.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast({ title: "Please fix the errors", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/users/update/${user.id}/`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast({
        title: "User updated",
        description: data.temporary_password_sent
          ? "New temporary password sent by email"
          : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User — {user?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Full Name</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
            {form.email !== user?.email && (
              <p className="text-xs text-muted-foreground">
                Changing email will generate a new temporary password.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salesperson">Salesperson</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Department</Label>
            <Select
              value={form.department}
              onValueChange={(v) => set("department", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset Password Dialog ────────────────────────────────────────────────────

function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserDataType | null;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirm("");
    }
  }, [open]);

  const mismatch = password && confirm && password !== confirm;
  const tooShort = password && password.length < 8;

  async function handleSave() {
    if (!user || !password) return;
    if (mismatch) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (tooShort) {
      toast({
        title: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/users/reset-password/${user.id}/`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ new_password: password }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      toast({ title: "Password reset successfully" });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password — {user?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>New Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className={tooShort ? "border-destructive" : ""}
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                At least 8 characters required
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              className={mismatch ? "border-destructive" : ""}
            />
            {mismatch && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !password || !!mismatch || !!tooShort}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete User Dialog ───────────────────────────────────────────────────────

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserDataType | null;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleDelete() {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/users/delete/${user.id}/`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast({ title: `${user.name} deleted` });
      onDeleted();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete User?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <strong>{user?.name}</strong>? This action cannot be undone.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Users() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserDataType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserDataType | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [viewProfileOpen, setViewProfileOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPassOpen, setResetPassOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  useEffect(() => {
    fetchUsers();
  }, []);

  function closeAllDialogs() {
    setViewProfileOpen(false);
    setEditOpen(false);
    setResetPassOpen(false);
    setDeleteOpen(false);
  }

  function handleDialogChange(
    setter: (value: boolean) => void,
    isOpen: boolean,
  ) {
    setter(isOpen);
    if (!isOpen) {
      setSelected(null);
    }
  }

  async function fetchUsers() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_URL}/api/users/users/`, {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        window.sessionStorage.clear();
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch users");
      const data: UserDataType[] = await res.json();
      setUsers(
        data.map((u) => ({
          ...u,
          department: u.department || "—",
          role: u.role.toLowerCase() as UserDataType["role"],
          status: u.status.toLowerCase() as UserDataType["status"],
        })),
      );
    } catch (e: any) {
      setError(e.message);
      toast({
        title: "Error",
        description: getApiErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function openAction(action: string, user: UserDataType) {
    closeAllDialogs();
    setSelected(user);
    switch (action) {
      case "view":
        setViewProfileOpen(true);
        break;
      case "edit":
        setEditOpen(true);
        break;
      case "reset":
        setResetPassOpen(true);
        break;
      case "delete":
        setDeleteOpen(true);
        break;
    }
  }

  // ── Summary stats strip ───────────────────────────────────────────────────
  const totalUsers = users.length;
  const activeCount = users.filter((u) => u.is_active).length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const staffCount = users.filter((u) => u.role === "staff").length;
  const salespersonCount = users.filter((u) => u.role === "salesperson").length;

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = [
    {
      key: "name",
      header: "User",
      headerClassName: "min-w-[280px]",
      cellClassName: "min-w-[280px]",
      render: (u: UserDataType) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
            {initials(u.name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{u.name}</p>
            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      headerClassName: "w-[160px]",
      cellClassName: "w-[160px]",
      render: (u: UserDataType) => {
        const cfg = ROLE_CONFIG[u.role] || ROLE_CONFIG.staff;
        return (
          <Badge variant="outline" className={`gap-1 ${cfg.cls}`}>
            {u.role === "admin" ? (
              <Shield className="h-3 w-3" />
            ) : u.role === "staff" ? (
              <UserCheck className="h-3 w-3" />
            ) : u.role === "salesperson" ? (
              <Building2 className="h-3 w-3" />
            ) : null}
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: "department",
      header: "Department",
      headerClassName: "min-w-[150px]",
      cellClassName: "min-w-[150px]",
      render: (u: UserDataType) => (
        <div className="flex items-center gap-1.5 text-sm">
          <Building2 className="h-3 w-3 text-muted-foreground" />
          {u.department}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      headerClassName: "w-[130px]",
      cellClassName: "w-[130px]",
      render: (u: UserDataType) => <StatusBadge status={u.status} />,
    },
    {
      key: "last_login",
      header: "Last Login",
      headerClassName: "w-[150px]",
      cellClassName: "w-[150px]",
      render: (u: UserDataType) => (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" />
          {u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}
        </div>
      ),
    },
/* =========================================================
   ACTION COLUMN - DIRECT ICON BUTTONS
========================================================= */

{
  key: "actions",
  header: "Actions",
  headerClassName: "w-[170px] text-right",
  cellClassName: "w-[170px]",

  render: (u: UserDataType) => (
    <div className="flex items-center justify-end gap-2">

      {/* View Profile */}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="h-8 w-8 hover:bg-sky-500/10 transition-colors"
        onClick={() => openAction("view", u)}
      >
        <Eye className="h-4 w-4 text-sky-600" />
      </Button>

      {/* Edit User */}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="h-8 w-8 hover:bg-primary/10 transition-colors"
        onClick={() => openAction("edit", u)}
      >
        <Edit className="h-4 w-4 text-primary" />
      </Button>

      {/* Reset Password */}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="h-8 w-8 hover:bg-amber-500/10 transition-colors"
        onClick={() => openAction("reset", u)}
      >
        <KeyRound className="h-4 w-4 text-amber-600" />
      </Button>
      {/* Delete User */}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="h-8 w-8 hover:bg-destructive/10 transition-colors"
        onClick={() => openAction("delete", u)}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

    </div>
  ),
},
  ];
  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={fetchUsers}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Users & Roles"
        description="Manage user accounts, roles and asset assignments"
        action={{ label: "Add User", onClick: () => setAddOpen(true) }}
      />

      {/* ── Summary strip ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Total Users",
            value: totalUsers,
            icon: User,
            cls: "bg-primary/10 text-primary",
          },
          {
            label: "Active",
            value: activeCount,
            icon: CheckCircle,
            cls: "bg-green-500/10 text-green-600",
          },
          {
            label: "Admins",
            value: adminCount,
            icon: Shield,
            cls: "bg-primary/10 text-primary",
          },
          {
            label: "Staff",
            value: staffCount,
            icon: UserCheck,
            cls: "bg-blue-500/10 text-blue-600",
          },
          {
            label: "Salespersons",
            value: salespersonCount,
            icon: Building2,
            cls: "bg-emerald-500/10 text-emerald-600",
          },
        ].map((stat) => (
          <Card key={stat.label} className="h-full">
            <CardContent className="flex h-full items-center gap-3 p-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${stat.cls}`}
              >
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <DataTable
        data={users}
        columns={columns}
        searchPlaceholder="Search by name, email or department…"
        filterOptions={[
          {
            key: "role",
            label: "Role",
            options: [
              { value: "admin", label: "Admin" },
              { value: "staff", label: "Staff" },
              { value: "salesperson", label: "Salesperson" },
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
          {
            key: "department",
            label: "Department",
            options: DEPARTMENTS.map((d) => ({ value: d, label: d })),
          },
        ]}
      />

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={fetchUsers}
      />
      <ViewProfileDialog
        key={`view-${selected?.id ?? "none"}`}
        open={viewProfileOpen}
        onOpenChange={(open) => handleDialogChange(setViewProfileOpen, open)}
        user={selected}
      />
      <EditUserDialog
        key={`edit-${selected?.id ?? "none"}`}
        open={editOpen}
        onOpenChange={(open) => handleDialogChange(setEditOpen, open)}
        user={selected}
        onSaved={fetchUsers}
      />
      <ResetPasswordDialog
        key={`reset-${selected?.id ?? "none"}`}
        open={resetPassOpen}
        onOpenChange={(open) => handleDialogChange(setResetPassOpen, open)}
        user={selected}
      />
      <DeleteUserDialog
        key={`delete-${selected?.id ?? "none"}`}
        open={deleteOpen}
        onOpenChange={(open) => handleDialogChange(setDeleteOpen, open)}
        user={selected}
        onDeleted={fetchUsers}
      />
    </div>
  );
}
