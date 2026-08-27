"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminJson } from "@/lib/platform-admin/client-api";

export function SignInAsButton({
  userId,
  email,
  size = "sm",
}: {
  userId: string;
  email: string;
  size?: "sm" | "xs" | "default";
}) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      const data = await adminJson<{ redirectTo: string }>(
        `/api/platform-admin/users/${userId}/impersonate`,
        { method: "POST" }
      );
      toast.success(`Signed in as ${email}`);
      window.location.assign(data.redirectTo || "/workspaces");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign in as this user");
      setLoading(false);
    }
  };

  return (
    <Button type="button" variant="outline" size={size} disabled={loading} onClick={() => void onClick()}>
      {loading ? "Entering…" : "Sign in as user"}
    </Button>
  );
}
