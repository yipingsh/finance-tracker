import { createClient, type User } from "npm:@supabase/supabase-js@2.117.3";

// Service-role client: bypasses RLS, so it never leaves the server and every call that
// uses it must act on the user id taken from a verified token, never from the request body.
export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Verifies the caller's access token with the auth server (rejects expired, forged or
// signed-out sessions) and returns the user, or null.
export async function getUser(req: Request): Promise<User | null> {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) return null;
  return data.user;
}
