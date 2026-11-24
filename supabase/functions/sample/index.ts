// Arabic Coach: "sample" function. The full coach page sends a prompt (or a short conversation) and gets JSON back from Claude.
// Checks the learner's sign-in and daily limit, logs token use, and never exposes the Claude API key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELS: Record<string, string> = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5" };
const MAX_TOKENS: Record<string, number> = { quick: 1500, default: 4000 };
const DAILY_LIMIT: Record<string, number> = { free: 40, pro: 500, company: 500 };
const DAILY_OUTPUT_TOKENS: Record<string, number> = { free: 60000, pro: 600000, company: 600000 }; // cost ceiling per learner per day
const MAX_CHARS = 24000; // total prompt size accepted from the phone (the longest coach prompt is about 12,000)

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
  const limit = DAILY_LIMIT[plan] ?? DAILY_LIMIT.free;
  // Reserve this call first, in one atomic step, so parallel requests can't slip past the daily limit.
  const { data: used, error: resErr } = await db.rpc("reserve_call", { p_user: user.id, p_day: day, p_limit: limit, p_max_out: DAILY_OUTPUT_TOKENS[plan] ?? DAILY_OUTPUT_TOKENS.free });
  if (resErr) { console.error("reserve_call", resErr.message); return json({ code: "unavailable", error: "The coach is busy. Please try again in a moment." }, 503); }
  if (used == null) {
    return json({ code: "rate_limited", limit: true, error: plan === "free"
      ? "You've used today's free coach practice. Come back tomorrow, or upgrade to Pro for more."
      : "Daily limit reached. Try again tomorrow." }, 429);
  }
  const refund = () => db.rpc("refund_call", { p_user: user.id, p_day: day });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { console.error("ANTHROPIC_API_KEY is not set"); await refund(); return json({ code: "unavailable", error: "The coach isn't set up yet. Please try again later." }, 503); }

  let billed = false; // once Claude has answered, the call has cost money and is never refunded
  const callClaude = async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELS[tier],
        max_tokens: MAX_TOKENS[tier],
        system: "You are the AI coach inside Arabic Coach, an app that teaches spoken Saudi Arabic. Follow the user's instructions exactly. Reply with ONLY valid JSON, no markdown fences and no text before or after it. Escape every double quote inside JSON strings.",
        messages,
      }),
    });
    if (!r.ok) { const t = (await r.text()).slice(0, 400); throw Object.assign(new Error("anthropic " + r.status + " " + t), { status: r.status }); }
    const d = await r.json();
    billed = true;
    const u = d.usage || {};
    await db.rpc("add_tokens", { p_user: user.id, p_day: day, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0 });
    return (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  };

  let text = "";
  try {
    text = await callClaude();
    try { return json({ result: parseJson(text), left: limit - used }); } catch { /* garbled JSON: one retry below */ }
    console.warn("non-json reply, retrying once", text.slice(0, 160));
    text = await callClaude();
    return json({ result: parseJson(text), left: limit - used });
  } catch (e) {
    console.error("coach failed", (e as Error).message, text.slice(0, 160));
    if (!billed) await refund();
    const status = (e as any).status;
    return json({ code: status === 429 ? "rate_limited" : text ? "invalid_json" : "unavailable",
      error: text ? "The coach's answer came back garbled. Try again." : "The coach is busy. Please try again in a moment." }, 502);
  }
});
