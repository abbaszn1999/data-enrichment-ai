"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Mail,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { updateProfile } from "@/lib/supabase";
import { updatePassword, signOut } from "@/lib/auth";

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, isLoading } = useAuth();

  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setError("");
    setSaving(true);
    try {
      await updateProfile(user.id, { full_name: fullName.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      await updatePassword(newPassword);
      setPasswordSaved(true);
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: any) {
      setPasswordError(err?.message || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSignOutAll = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const initials = fullName
    ? fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <User className="h-5 w-5" /> Profile
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your account settings
          </p>
        </div>

        {/* Avatar + Name */}
        <Card className="p-5 space-y-5">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center relative">
              <span className="text-xl font-bold text-primary">{initials}</span>
            </div>
            <div>
              <div className="text-sm font-medium">{fullName || "User"}</div>
              <div className="text-xs text-muted-foreground">{user?.email}</div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium">Full Name</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={user?.email || ""}
                disabled
                className="h-10 pl-9 bg-muted/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveProfile} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
        </Card>

        {/* Change Password */}
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4" /> Change Password
          </h2>

          {passwordError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5" /> {passwordError}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium">New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Confirm Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="h-9"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleChangePassword} disabled={passwordSaving} className="gap-1.5">
              {passwordSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Update Password
            </Button>
            {passwordSaved && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Updated
              </span>
            )}
          </div>
        </Card>

        {/* Session */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Session</h2>
          <p className="text-xs text-muted-foreground">
            Sign out from all devices
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={handleSignOutAll}
          >
            Sign Out
          </Button>
        </Card>
      </div>
    </div>
  );
}
