import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let currentSession: Session | null = null;
let unsubscribeAuthListener: (() => void) | null = null;

function handleAuthChange(_event: AuthChangeEvent, session: Session | null): void {
  currentSession = session;
}

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  if (client) {
    return client;
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  const authSubscription = client.auth.onAuthStateChange(handleAuthChange);
  unsubscribeAuthListener = () => authSubscription.data.subscription.unsubscribe();

  return client;
}

export function destroySupabase(): void {
  unsubscribeAuthListener?.();
  unsubscribeAuthListener = null;
  client = null;
  currentSession = null;
}

export function getClient(): SupabaseClient {
  if (!client) {
    throw new Error("Supabase client is not initialized.");
  }

  return client;
}

export async function restoreSession(): Promise<Session | null> {
  const { data, error } = await getClient().auth.getSession();
  if (error) {
    throw new Error(`Failed to restore session: ${error.message}`);
  }

  currentSession = data.session;
  return currentSession;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await getClient().auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(error?.message ?? "Sign-in failed.");
  }

  currentSession = data.session;
  return data.session;
}

export async function requestEmailOtp(email: string): Promise<void> {
  const { error } = await getClient().auth.signInWithOtp({
    email,
  });

  if (error) {
    throw new Error(`Failed to send email code: ${error.message}`);
  }
}

function extractEmailOtpToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Email code is required.");
  }

  if (!trimmed.includes("://") && !trimmed.includes("?")) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid email code or URL.");
  }

  const token = parsed.searchParams.get("token");
  if (!token) {
    throw new Error("URL does not contain an OTP token.");
  }

  return token;
}

async function verifyEmailOtpWithType(
  email: string,
  token: string,
  type: "signup" | "email" | "magiclink",
): Promise<Session | null> {
  const { data, error } = await getClient().auth.verifyOtp({
    email,
    token,
    type,
  });

  if (error || !data.session) {
    return null;
  }

  currentSession = data.session;
  return data.session;
}

export async function completeEmailOtp(input: string, email: string): Promise<Session> {
  const token = extractEmailOtpToken(input);
  const session =
    (await verifyEmailOtpWithType(email, token, "signup")) ??
    (await verifyEmailOtpWithType(email, token, "email")) ??
    (await verifyEmailOtpWithType(email, token, "magiclink"));

  if (!session) {
    throw new Error("Email code is invalid or expired.");
  }

  currentSession = session;
  return session;
}

export async function signOut(): Promise<void> {
  const { error } = await getClient().auth.signOut();
  if (error) {
    throw new Error(`Failed to sign out: ${error.message}`);
  }

  currentSession = null;
}

export function getSession(): Session | null {
  return currentSession;
}
