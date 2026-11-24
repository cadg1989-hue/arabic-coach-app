import { admin, ask, parseJson, MODELS, DAILY_LIMIT, riyadhDay } from "../../../lib/server";
import { CHATS } from "../../../lib/chats";

export const runtime = "nodejs";

const LANG_NOTE = {
  Hindi: "very simple everyday spoken Hindi in Devanagari script, like explaining to a friend over chai; keep Arabic words in English letters; no grammar jargon (say काम वाला शब्द, चीज़, किसको instead of verb, noun, object)",
  Urdu: "very simple everyday spoken Urdu in Urdu script; keep Arabic words in English letters; no grammar jargon",
  English: "very simple everyday English; no grammar jargon",
};

const json = (data, status = 200) => Response.json(data, { status });
const clip = (s, n) => String(s ?? "").slice(0, n);

export async function POST(req) {
  const db = admin();

  // 1. Who is asking? The phone sends its Supabase login token.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please sign in again." }, 401);
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth?.user) return json({ error: "Please sign in again." }, 401);
  const user = auth.user;

  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return json({ error: "Finish setup first." }, 400);
  const lang = LANG_NOTE[profile.explain_lang] ? profile.explain_lang : "English";

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  // 2. Shared explanations are free once cached.
  if (body.kind === "explain") {
    const key = `${lang}:${clip(body.ar, 300).trim()}`;
    const { data: hit } = await db.from("explain_cache").select("data").eq("key", key).maybeSingle();
    if (hit) return json({ result: hit.data, cached: true });
  }

  // 3. Daily limit by plan.
  const day = riyadhDay();
  const { data: use } = await db.from("usage").select("calls").eq("user_id", user.id).eq("day", day).maybeSingle();
  const limit = DAILY_LIMIT[profile.plan] ?? DAILY_LIMIT.free;
  if ((use?.calls || 0) >= limit) {
    return json({ error: profile.plan === "free" ? "You've used today's free AI practice. Come back tomorrow, or upgrade to Pro for unlimited practice." : "Daily limit reached. Try again tomorrow.", limit: true }, 429);
  }

  let out, usage;
  try {
    if (body.kind === "chat") ({ out, usage } = await chat(body, profile, lang));
    else if (body.kind === "explain") ({ out, usage } = await explain(body, lang));
    else return json({ error: "Unknown request." }, 400);
  } catch (e) {
    console.error("ai error", e?.message || e);
    return json({ error: "The coach is busy. Please try again in a moment." }, 502);
  }

  await db.rpc("add_usage", { p_user: user.id, p_day: day, p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0 });
  if (body.kind === "explain") {
    await db.from("explain_cache").upsert({ key: `${lang}:${clip(body.ar, 300).trim()}`, data: out });
  }
  return json({ result: out, left: limit - (use?.calls || 0) - 1 });
}

async function chat(body, profile, lang) {
  const sc = CHATS[Number(body.scenario)] || CHATS[0];
  const script = sc.lines.map((l) => `${l.who === "t" ? "Them" : "Learner"}: ${l.ar} (${l.tr}) = ${l.en}`).join("\n");
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(-16).map((t) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: clip(t.text, 600) || "...",
  }));
  if (!turns.length || turns[turns.length - 1].role !== "user") return Promise.reject(new Error("no_user_turn"));
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

  const { text, usage } = await ask({ model: "claude-haiku-5-5", system, messages: turns, maxTokens: 600 });
  const r = parseJson(text);
  return {
    out: {
      ar: clip(r.ar, 300), tr: clip(r.tr, 300), en: clip(r.en, 300),
      fix: r.fix && r.fix.better ? { said: clip(r.fix.said, 300), better: clip(r.fix.better, 300), tr: clip(r.fix.tr, 300), why: clip(r.fix.why, 600) } : null,
      words: (Array.isArray(r.words) ? r.words : []).slice(0, 3).map((w) => ({ ar: clip(w.ar, 100), tr: clip(w.tr, 100), en: clip(w.en, 100) })),
      done: !!r.done,
    },
    usage,
  };
}

async function explain(body, lang) {
  const ar = clip(body.ar, 300), tr = clip(body.tr, 300), en = clip(body.en, 300);
  const system = `You teach Saudi spoken Arabic to expat workers and professionals in Riyadh. Explain how a sentence is BUILT so the learner can make new ones. Write every explanation in ${LANG_NOTE[lang]}. Short sentences.`;
  const prompt = `Sentence: ${ar} (${tr}) = "${en}"
Reply with ONLY JSON:
{"pattern":"the pattern in a few plain words","simple":"3-4 very short sentences explaining it${lang === "English" ? "" : `, comparing with ${lang} word order`}","map":"${lang === "English" ? "the English sentence" : `the ${lang} sentence with the same meaning`}, then the Arabic word order mirrored word by word, e.g. 'X → A + B + C'","parts":[{"ar":"","tr":"","meaning":"","role":"what this word does, 1-4 plain words"}],"examples":[{"src":"${lang === "English" ? "an everyday English office sentence" : `an everyday ${lang} office sentence`}","ar":"Saudi Arabic","tr":"transliteration"}],"tip":"one short memory trick"}
parts in sentence order. examples = 3 new sentences with the SAME pattern, using common work words. Use Saudi spoken forms.`;
  const { text, usage } = await ask({ model: "claude-sonnet-5-5", system, messages: [{ role: "user", content: prompt }], maxTokens: 1200 });
  const r = parseJson(text);
  if (!r.pattern) throw new Error("bad_explain");
  return { out: r, usage };
}
