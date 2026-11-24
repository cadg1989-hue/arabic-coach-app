// Arabic Coach: "sample" function. The full coach page sends a prompt (or a short conversation) and gets JSON back from Claude.
// Checks the learner's sign-in and daily limit, logs token use, and never exposes the Claude API key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELS: Record<string, string> = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };
const MAX_TOKENS: Record<string, number> = { quick: 2000, default: 6000 };
const DAILY_LIMIT: Record<string, number> = { free: 60, pro: 1000, company: 1000 };
const MAX_CHARS = 60000; // total prompt size accepted from the phone

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const riyadhDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

function parseJson(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const firstObj = t.indexOf("{"), firstArr = t.indexOf("[");
  const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
  const end = start === firstArr ? t.lastIndexOf("]") : t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no_json");
  return JSON.parse(t.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ code: "bad_request", error: "Use POST." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth?.user) return json({ code: "session_expired", error: "Please sign in again." }, 401);
  const user = auth.user;

  let body: any;
  try { body = await req.json(); } catch { return json({ code: "bad_request", error: "Bad request." }, 400); }

  // Accept a prompt string or a list of {role, content} turns.
  let messages: { role: string; content: string }[] = [];
  if (typeof body.input === "string") messages = [{ role: "user", content: body.input }];
  else if (Array.isArray(body.input)) {
    messages = body.input.slice(-24).map((m: any) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""),
    }));
  }
  messages = messages.filter((m) => m.content.trim());
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ code: "bad_request", error: "Nothing to answer." }, 400);
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: "(start)" });
  const size = messages.reduce((n, m) => n + m.content.length, 0);
  if (size > MAX_CHARS) return json({ code: "bad_request", error: "That request is too long." }, 413);
  const tier = body.tier === "quick" ? "quick" : "default";

  // Daily limit by plan (profiles.plan; a learner without a profile row counts as free).
  const { data: profile } = await db.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  const plan = profile?.plan || "free";
  const day = riyadhDay();
  const { data: use } = await db.from("usage").select("calls").eq("user_id", user.id).eq("day", day).maybeSingle();
  const limit = DAILY_LIMIT[plan] ?? DAILY_LIMIT.free;
  if ((use?.calls || 0) >= limit) {
    return json({ code: "rate_limited", limit: true, error: plan === "free"
      ? "You've used today's free coach practice. Come back tomorrow, or upgrade to Pro for more."
      : "Daily limit reached. Try again tomorrow." }, 429);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { console.error("ANTHROPIC_API_KEY is not set"); return json({ code: "unavailable", error: "The coach isn't set up yet. Please try again later." }, 503); }

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELS[tier],
        max_tokens: MAX_TOKENS[tier],
        system: "You are the AI coach inside Arabic Coach, an app that teaches spoken Saudi Arabic. Follow the user's instructions exactly. Reply with ONLY valid JSON, no markdown fences and no text before or after it.",
        messages,
      }),
    });
  } catch (e) {
    console.error("anthropic fetch failed", (e as Error).message);
    return json({ code: "unavailable", error: "The coach is busy. Please try again in a moment." }, 502);
  }
  if (!r.ok) {
    console.error("anthropic error", r.status, (await r.text()).slice(0, 400));
    return json({ code: r.status === 429 ? "rate_limited" : "unavailable", error: "The coach is busy. Please try again in a moment." }, 502);
  }
  const d = await r.json();
  const usage = d.usage || { input_tokens: 0, output_tokens: 0 };
  await db.rpc("add_usage", { p_user: user.id, p_day: day, p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0 });

  const text = (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  try {
    return json({ result: parseJson(text), left: limit - (use?.calls || 0) - 1 });
  } catch {
    console.error("non-json reply", d.stop_reason, text.slice(0, 200));
    return json({ code: "invalid_json", error: "The coach's answer came back garbled. Try again." }, 502);
  }
});
