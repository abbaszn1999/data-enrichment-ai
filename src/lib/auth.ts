import { createClient } from "@/lib/supabase-browser";

export async function signUp(email: string, password: string, fullName: string, redirectTo?: string) {
  const supabase = createClient();
  const callbackBase = `${window.location.origin}/auth/callback`;
  const callbackUrl = redirectTo
    ? `${callbackBase}?next=${encodeURIComponent(redirectTo)}`
    : `${callbackBase}?next=/workspaces`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: callbackUrl,
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle(redirectTo?: string) {
  const supabase = createClient();
  const callbackBase = `${window.location.origin}/auth/callback`;
  const callbackUrl = redirectTo
    ? `${callbackBase}?next=${encodeURIComponent(redirectTo)}`
    : `${callbackBase}?next=/workspaces`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?next=/reset-password/confirm`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
}

export async function getUser() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

export async function getSession() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
