// Arabic Coach: the only place that talks to Claude.
// Runs as a Supabase Edge Function. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase;
// ANTHROPIC_API_KEY is a secret the owner adds in the Supabase dashboard (Edge Functions -> Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELS = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" };
const DAILY_LIMIT: Record<string, number> = { free: 25, pro: 400, company: 400 };

const LANG_NOTE: Record<string, string> = {
  Hindi: "very simple everyday spoken Hindi in Devanagari script, like explaining to a friend over chai; keep Arabic words in English letters; no grammar jargon (say काम वाला शब्द, चीज़, किसको instead of verb, noun, object)",
  Urdu: "very simple everyday spoken Urdu in Urdu script; keep Arabic words in English letters; no grammar jargon",
  English: "very simple everyday English; no grammar jargon",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const riyadhDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

function parseJson(text: string) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no_json");
  return JSON.parse(text.slice(a, b + 1));
}

async function ask(model: string, system: string, messages: { role: string; content: string }[], maxTokens = 900) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("missing_anthropic_key");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const text = (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return { text, usage: d.usage || { input_tokens: 0, output_tokens: 0 } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. Who is asking?
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth?.user) return json({ error: "Please sign in again." }, 401);
  const user = auth.user;

  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return json({ error: "Finish setup first." }, 400);
  const lang = LANG_NOTE[profile.explain_lang] ? profile.explain_lang : "English";

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  // Keyed on everything the explanation is built from, so a cached answer always matches its request.
  const cacheKey = `${lang}|${clip(body.ar, 300).trim()}|${clip(body.tr, 300).trim()}|${clip(body.en, 300).trim()}`;

  // 2. Shared explanations are free once cached.
  if (body.kind === "explain") {
    const { data: hit } = await db.from("explain_cache").select("data").eq("key", cacheKey).maybeSingle();
    if (hit) return json({ result: hit.data, cached: true });
  }

  // 3. Daily limit by plan.
  const day = riyadhDay();
  const { data: use } = await db.from("usage").select("calls").eq("user_id", user.id).eq("day", day).maybeSingle();
  const limit = DAILY_LIMIT[profile.plan] ?? DAILY_LIMIT.free;
  if ((use?.calls || 0) >= limit) {
    return json({
      error: profile.plan === "free"
        ? "You've used today's free AI practice. Come back tomorrow, or upgrade to Pro for unlimited practice."
        : "Daily limit reached. Try again tomorrow.",
      limit: true,
    }, 429);
  }

  let out: any, usage: any;
  try {
    if (body.kind === "chat") ({ out, usage } = await chat(body, profile, lang));
    else if (body.kind === "explain") ({ out, usage } = await explain(body, lang));
    else return json({ error: "Unknown request." }, 400);
  } catch (e) {
    console.error("ai error", (e as Error)?.message || e);
    return json({ error: "The coach is busy. Please try again in a moment." }, 502);
  }

  await db.rpc("add_usage", { p_user: user.id, p_day: day, p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0 });
  if (body.kind === "explain") await db.from("explain_cache").upsert({ key: cacheKey, data: out });
  return json({ result: out, left: limit - (use?.calls || 0) - 1 });
});

async function chat(body: any, profile: any, lang: string) {
  // The phone sends the scene it is practising (title, setup, model lines); sizes are capped.
  const raw = body.scene || {};
  const sc = {
    title: clip(raw.title, 80), setup: clip(raw.setup, 200),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 10).map((l: any) => ({ who: l?.who === "y" ? "y" : "t", ar: clip(l?.ar, 150), tr: clip(l?.tr, 150), en: clip(l?.en, 150) })),
  };
  const script = sc.lines.map((l: any) => `${l.who === "t" ? "Them" : "Learner"}: ${l.ar} (${l.tr}) = ${l.en}`).join("\n");
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(-16).map((t: any) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: clip(t.text, 600) || "...",
  }));
  if (!turns.length || turns[turns.length - 1].role !== "user") throw new Error("no_user_turn");
  if (turns[0].role !== "user") turns.unshift({ role: "user", content: "(start)" });

  const system = `You are a friendly Saudi role-play partner helping an expat professional in Riyadh practise spoken Saudi Arabic (Najdi/Riyadh everyday speech, not formal MSA). Their goal: talking with ${profile.goal === "staff" ? "their employees and staff" : "their customers"}.
Scene: "${sc.title}" — ${sc.setup}
Model script for this scene (stay close to its words and level; the learner is a beginner):
${script}
Rules:
- You play "Them". Reply with ONE short natural line (max 10 words), using simple words from the script where possible. Keep the scene moving; after about 6 exchanges, wrap up politely and set "done": true.
- The learner may write Arabic script, Arabic in English letters, or English when stuck. Their text may come from speech-to-text, so ignore spelling and transcription slips. Only correct real language mistakes (wrong word, wrong form, English used instead of Arabic).
- Explanations ("why") must be in ${LANG_NOTE[lang]}.
Reply with ONLY JSON:
{"ar":"your line in Arabic script","tr":"easy transliteration","en":"English meaning","fix":null or {"said":"what they wrote","better":"natural Saudi Arabic","tr":"transliteration of better","why":"short reason"},"words":[{"ar":"","tr":"","en":""}],"done":false}
"words" = up to 3 useful new words from your line.`;

  const { text, usage } = await ask(MODELS.fast, system, turns, 600);
  const r = parseJson(text);
  return {
    out: {
      ar: clip(r.ar, 300), tr: clip(r.tr, 300), en: clip(r.en, 300),
      fix: r.fix && r.fix.better ? { said: clip(r.fix.said, 300), better: clip(r.fix.better, 300), tr: clip(r.fix.tr, 300), why: clip(r.fix.why, 600) } : null,
      words: (Array.isArray(r.words) ? r.words : []).slice(0, 3).map((w: any) => ({ ar: clip(w.ar, 100), tr: clip(w.tr, 100), en: clip(w.en, 100) })),
      done: !!r.done,
    },
    usage,
  };
}

async function explain(body: any, lang: string) {
  const ar = clip(body.ar, 300), tr = clip(body.tr, 300), en = clip(body.en, 300);
  const system = `You teach Saudi spoken Arabic to expat workers and professionals in Riyadh. Explain how a sentence is BUILT so the learner can make new ones. Write every explanation in ${LANG_NOTE[lang]}. Short sentences.`;
  const same = lang === "English" ? "the English sentence" : `the ${lang} sentence with the same meaning`;
  const prompt = `Sentence: ${ar} (${tr}) = "${en}"
Reply with ONLY JSON:
{"pattern":"the pattern in a few plain words","simple":"3-4 very short sentences explaining it${lang === "English" ? "" : `, comparing with ${lang} word order`}","map":"${same}, then the Arabic word order mirrored word by word, e.g. 'X → A + B + C'","parts":[{"ar":"","tr":"","meaning":"","role":"what this word does, 1-4 plain words"}],"examples":[{"src":"an everyday ${lang} office sentence","ar":"Saudi Arabic","tr":"transliteration"}],"tip":"one short memory trick"}
parts in sentence order. examples = 3 new sentences with the SAME pattern, using common work words. Use Saudi spoken forms.`;
  const { text, usage } = await ask(MODELS.smart, system, [{ role: "user", content: prompt }], 1200);
  const r = parseJson(text);
  if (!r.pattern) throw new Error("bad_explain");
  return { out: r, usage };
}
