import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAnonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function createUserClient(url: string, anonKey: string, userJwt: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function throwIfError<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) {
    throw new Error(`Supabase error: ${result.error.message}`);
  }
  return result.data;
}
