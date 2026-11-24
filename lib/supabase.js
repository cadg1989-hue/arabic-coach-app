"use client";
import { createClient } from "@supabase/supabase-js";

// Browser client: uses only the public "anon" key. Row-level security keeps each learner to their own data.
let client;
export function sb() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
