import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Server-only helpers. The secret keys below exist only on the server (Vercel environment variables).
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

export const MODELS = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" };

// AI requests allowed per day, by plan.
export const DAILY_LIMIT = { free: 25, pro: 400, company: 400 };

export function riyadhDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

// Pull the first JSON object out of a model reply.
export function parseJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no_json");
  return JSON.parse(text.slice(a, b + 1));
}

export async function ask({ model, system, messages, maxTokens = 900 }) {
  const r = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages });
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  return { text, usage: r.usage || { input_tokens: 0, output_tokens: 0 } };
}
