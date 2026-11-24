"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { CORE } from "../lib/core";
import { CHATS } from "../lib/chats";

/* ---------- small helpers ---------- */
const GAPS = [0, 1, 3, 7, 16, 35]; // days until the next review, by box
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const addDays = (n, from = today()) => { const d = new Date(from + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function speak(text) {
  try {
    const synth = window.speechSynthesis; if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = synth.getVoices().find((x) => /^ar(-SA)?/i.test(x.lang) && /SA/i.test(x.lang)) || synth.getVoices().find((x) => /^ar/i.test(x.lang));
    if (v) u.voice = v; u.lang = v ? v.lang : "ar-SA"; u.rate = 0.85;
    synth.speak(u);
  } catch {}
}
const Speak = ({ text }) => <button className="btn ghost small" type="button" onClick={() => speak(text)} aria-label="Listen">🔊</button>;

async function callAI(payload) {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({ error: "Network problem. Please try again." }));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

const T = {
  Hindi: { why: "🧠 हिंदी में समझें", easy: "आसान भाषा में", tip: "याद रखने का तरीका" },
  Urdu: { why: "🧠 اردو میں سمجھیں", easy: "آسان زبان میں", tip: "یاد رکھنے کا طریقہ" },
  English: { why: "🧠 Why does it work?", easy: "In simple words", tip: "Memory trick" },
};

/* ---------- app ---------- */
export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState({}); // word -> {box, due}
  const [tab, setTab] = useState("learn");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    const s = sb();
    s.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = s.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); setProgress({}); return; }
    (async () => {
      try {
        const s = sb();
        const [{ data: p, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
          s.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
          s.from("progress").select("word,box,due").eq("user_id", session.user.id).limit(1000),
        ]);
        if (e1 || e2) throw e1 || e2;
        setProfile(p || false);
        const m = {}; (rows || []).forEach((r) => { m[r.word] = { box: r.box, due: r.due }; }); setProgress(m);
      } catch (e) { setLoadErr("Couldn't load your progress. Check your connection and reopen the app."); }
    })();
  }, [session]);

  async function touchStreak() {
    if (!profile) return;
    const t = today(); if (profile.last_day === t) return;
    const streak = profile.last_day === addDays(-1) ? (profile.streak || 0) + 1 : 1;
    const next = { ...profile, streak, last_day: t }; setProfile(next);
    await sb().from("profiles").update({ streak, last_day: t }).eq("id", profile.id);
  }

  async function saveWord(word, box) {
    const due = addDays(GAPS[box] ?? 35);
    setProgress((p) => ({ ...p, [word]: { box, due } }));
    await sb().from("progress").upsert({ user_id: session.user.id, word, box, due, updated_at: new Date().toISOString() });
    touchStreak();
  }

  if (!ready) return <div className="wrap"><p className="muted">Loading…</p></div>;
  if (!session) return <Login />;
  if (loadErr) return <div className="wrap"><p className="err">{loadErr}</p></div>;
  if (profile === null) return <div className="wrap"><p className="muted">Loading your progress…</p></div>;
  if (profile === false) return <Setup userId={session.user.id} onDone={setProfile} />;

  return (
    <>
      <div className="wrap">
        {tab === "learn" && <Learn profile={profile} progress={progress} saveWord={saveWord} />}
        {tab === "review" && <Review profile={profile} progress={progress} saveWord={saveWord} />}
        {tab === "chat" && <Chats profile={profile} onActive={touchStreak} />}
        {tab === "me" && <Me profile={profile} setProfile={setProfile} progress={progress} />}
      </div>
      <nav className="tabs" role="tablist">
        {[["learn", "📚", "Learn"], ["review", "🔁", "Review"], ["chat", "💬", "Talk"], ["me", "👤", "Me"]].map(([k, i, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}><span>{i}</span>{l}</button>
        ))}
      </nav>
    </>
  );
}

/* ---------- sign in ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setMsg(error.message); else setSent(true);
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg("That code didn't work. Check the latest email and try again.");
  }

  return (
    <div className="wrap">
      <div className="card center" style={{ marginTop: 24 }}>
        <div className="ar" lang="ar">أهلاً وسهلاً</div>
        <h1>Arabic Coach</h1>
        <p className="muted">Speak Saudi Arabic with your customers and staff. Explained in Hindi, Urdu or English.</p>
      </div>
      {!sent ? (
        <form className="card" onSubmit={send}>
          <label htmlFor="em">Your email</label>
          <input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <button className="btn wide" disabled={busy}>{busy ? "Sending…" : "Send me a sign-in code"}</button>
          {msg && <p className="err small">{msg}</p>}
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <p>We emailed a code to <b>{email}</b>. Enter it below, or tap the link in the email.</p>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
          <button className="btn wide" disabled={busy || code.trim().length < 6}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="btn ghost small" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
          {msg && <p className="err small">{msg}</p>}
        </form>
      )}
    </div>
  );
}

/* ---------- first-time setup ---------- */
function Setup({ userId, onDone }) {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("Hindi");
  const [goal, setGoal] = useState("customers");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e) {
    e.preventDefault(); setBusy(true);
    const row = { id: userId, name: name.trim().slice(0, 60), explain_lang: lang, goal };
    const { data, error } = await sb().from("profiles").insert(row).select().single();
    setBusy(false);
    if (error) setErr("Couldn't save. Please try again."); else onDone(data);
  }
  return (
    <form className="wrap" onSubmit={save}>
      <h1>Let's set up your coach</h1>
      <div className="card">
        <label htmlFor="nm">Your first name</label>
        <input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi" />
        <label htmlFor="lg">Explain things to me in</label>
        <select id="lg" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option>Hindi</option><option>Urdu</option><option>English</option>
        </select>
        <label htmlFor="gl">I mostly need Arabic to talk with</label>
        <select id="gl" value={goal} onChange={(e) => setGoal(e.target.value)}>
          <option value="customers">Customers</option><option value="staff">My staff and workers</option>
        </select>
      </div>
      <button className="btn wide" disabled={busy}>{busy ? "Saving…" : "Start learning"}</button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

/* ---------- learn new words ---------- */
function Learn({ profile, progress, saveWord }) {
  const t = today();
  const key = `ac.new.${t}`;
  const [doneToday, setDoneToday] = useState(0);
  useEffect(() => { try { setDoneToday(+localStorage.getItem(key) || 0); } catch {} }, [key]);
  const perDay = profile.plan === "free" ? 10 : Math.max(10, profile.new_per_day || 20);
  const next = useMemo(() => { for (let i = 0; i < CORE.w.length; i++) if (!progress[i]) return i; return -1; }, [progress]);
  const learned = Object.keys(progress).length;
  const due = Object.values(progress).filter((p) => p.due <= t).length;

  async function gotIt() {
    await saveWord(next, 1);
    const n = doneToday + 1; setDoneToday(n); try { localStorage.setItem(key, String(n)); } catch {}
  }

  const w = next >= 0 ? CORE.w[next] : null;
  return (
    <>
      <div className="row"><h1 className="grow">Ahlan{profile.name ? `, ${profile.name}` : ""}!</h1><span className="pill">🔥 {profile.streak || 0} day{profile.streak === 1 ? "" : "s"}</span></div>
      <div className="stats">
        <div className="stat"><b>{learned}</b><span className="small muted">of 1,000 words</span></div>
        <div className="stat"><b>{due}</b><span className="small muted">to review</span></div>
        <div className="stat"><b>{Math.min(doneToday, perDay)}/{perDay}</b><span className="small muted">new today</span></div>
      </div>
      <div className="bar" aria-hidden><i style={{ width: `${learned / 10}%` }} /></div>
      {!w ? (
        <div className="card center"><h2>All 1,000 words started! 🎉</h2><p className="muted">Keep reviewing and talking.</p></div>
      ) : doneToday >= perDay ? (
        <div className="card center">
          <h2>Today's new words are done ✓</h2>
          <p className="muted">{due ? `Now review ${due} word${due === 1 ? "" : "s"} in Review, then practise in Talk.` : "Practise them in Talk, then come back tomorrow."}</p>
        </div>
      ) : (
        <div className="card center">
          <h3>New word · {CORE.cats[w[3]]}</h3>
          <div className="ar" lang="ar">{w[0]}</div>
          <div className="tr">{w[1]}</div>
          <p>{w[2]}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Speak text={w[0]} />
            <button className="btn" onClick={gotIt}>Got it ✓</button>
          </div>
          <p className="small muted">Say it out loud 3 times before you tap.</p>
        </div>
      )}
    </>
  );
}

/* ---------- spaced review ---------- */
function Review({ progress, saveWord }) {
  const t = today();
  const queue = useMemo(() => Object.entries(progress).filter(([, p]) => p.due <= t).map(([k]) => +k).sort((a, b) => a - b), [progress, t]);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(0);
  const i = queue[0];
  if (i === undefined) return <div className="card center"><h2>Nothing to review right now ✓</h2><p className="muted">{done ? `You reviewed ${done} word${done === 1 ? "" : "s"}. ` : ""}Learn new words or practise in Talk.</p></div>;
  const w = CORE.w[i], p = progress[i];
  async function answer(knew) { setShow(false); setDone(done + 1); await saveWord(i, knew ? Math.min(5, p.box + 1) : 1); }
  return (
    <>
      <div className="row"><h1 className="grow">Review</h1><span className="pill">{queue.length} left</span></div>
      <div className="card center">
        <h3>Do you remember?</h3>
        <div className="ar" lang="ar">{w[0]}</div>
        <div className="tr">{w[1]}</div>
        {show ? <p style={{ fontSize: "1.2rem" }}>{w[2]}</p> : <button className="btn ghost" onClick={() => setShow(true)}>Show meaning</button>}
        <Speak text={w[0]} />
        {show && (
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn ghost" onClick={() => answer(false)}>✗ Forgot</button>
            <button className="btn" onClick={() => answer(true)}>✓ Knew it</button>
          </div>
        )}
        <p className="small muted">Box {p.box} of 5</p>
      </div>
    </>
  );
}

/* ---------- role-play chats ---------- */
function Chats({ profile, onActive }) {
  const [sc, setSc] = useState(null);
  const [showAll, setShowAll] = useState(false);
  if (sc !== null) return <ChatRoom profile={profile} index={sc} onBack={() => setSc(null)} onActive={onActive} />;
  const list = showAll ? CHATS : CHATS.slice(0, 12);
  return (
    <>
      <h1>Talk</h1>
      <p className="muted">Short real-life scenes. Type in Arabic or English letters, or use your keyboard's 🎤 mic.</p>
      <div className="list chat">
        {list.map((c, i) => (
          <button key={i} className="card" style={{ cursor: "pointer" }} onClick={() => setSc(i)}>
            <b>{i + 1}. {c.title}</b><span className="muted small">{c.setup}</span>
          </button>
        ))}
      </div>
      {!showAll && <button className="btn ghost" onClick={() => setShowAll(true)}>Show all {CHATS.length} scenes</button>}
    </>
  );
}

function ChatRoom({ profile, index, onBack, onActive }) {
  const sc = CHATS[index];
  const first = sc.lines[0];
  const opener = first.who === "t" ? { role: "them", ar: first.ar, tr: first.tr, en: first.en } : null;
  const [msgs, setMsgs] = useState(opener ? [opener] : []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  useEffect(() => { if (opener) speak(opener.ar); }, []); // eslint-disable-line

  const hint = useMemo(() => {
    const said = msgs.filter((m) => m.role === "me").length;
    const mine = sc.lines.filter((l) => l.who === "y");
    return mine[said] || null;
  }, [msgs, sc]);

  async function send(e) {
    e.preventDefault();
    const t = text.trim(); if (!t || busy) return;
    const next = [...msgs, { role: "me", text: t }];
    setMsgs(next); setText(""); setBusy(true); setErr("");
    const turns = next.filter((m) => m.role !== "fix").map((m) => m.role === "me" ? { role: "user", text: m.text } : { role: "assistant", text: `${m.ar} (${m.tr})` });
    try {
      const { result: r } = await callAI({ kind: "chat", scenario: index, turns });
      const add = [];
      if (r.fix) add.push({ role: "fix", ...r.fix });
      add.push({ role: "them", ar: r.ar, tr: r.tr, en: r.en });
      setMsgs((m) => [...m, ...add]); speak(r.ar);
      if (r.done) setDone(true);
      onActive();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="row"><button className="btn ghost small" onClick={onBack}>← Scenes</button><h2 className="grow">{sc.title}</h2></div>
      <p className="muted small">{sc.setup}</p>
      <div className="chat">
        {msgs.map((m, i) => m.role === "me" ? (
          <div key={i} className="bubble me">{m.text}</div>
        ) : m.role === "fix" ? (
          <div key={i} className="bubble fix">
            <span className="small">💡 Better: <span className="tr">{m.tr}</span></span>
            <div className="ar s" lang="ar">{m.better}</div>
            {m.why && <span className="small">{m.why}</span>}
            <div className="row"><Speak text={m.better} /><Explain profile={profile} ar={m.better} tr={m.tr} en={m.said} /></div>
          </div>
        ) : (
          <div key={i} className="bubble them">
            <div className="ar s" lang="ar">{m.ar}</div>
            <span className="tr">{m.tr}</span>
            <span className="small muted">{m.en}</span>
            <div className="row"><Speak text={m.ar} /><Explain profile={profile} ar={m.ar} tr={m.tr} en={m.en} /></div>
          </div>
        ))}
        {busy && <div className="bubble them muted small">…</div>}
        <div ref={end} />
      </div>
      {done ? (
        <div className="card center"><h2>Scene complete ✓</h2><button className="btn" onClick={onBack}>Next scene</button></div>
      ) : (
        <form className="card" onSubmit={send}>
          {hint && <p className="small muted">Stuck? Try: <span className="tr">{hint.tr}</span> ({hint.en})</p>}
          <textarea rows={2} dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your reply in Arabic or English letters…" />
          <button className="btn wide" disabled={busy || !text.trim()}>{busy ? "Coach is replying…" : "Send"}</button>
          {err && <p className="err small">{err}</p>}
        </form>
      )}
    </>
  );
}

/* ---------- explanation in the learner's language ---------- */
function Explain({ profile, ar, tr, en }) {
  const L = T[profile.explain_lang] || T.English;
  const [E, setE] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (E) { setE(null); return; }
    setBusy(true); setErr("");
    try { const { result } = await callAI({ kind: "explain", ar, tr, en }); setE(result); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ width: "100%" }}>
      <button className="btn ghost small" type="button" onClick={go} disabled={busy}>{busy ? "…" : L.why}</button>
      {err && <p className="err small">{err}</p>}
      {E && (
        <div className="explain" style={{ marginTop: 8 }}>
          <b>{E.pattern}</b>
          <p>{E.simple}</p>
          {E.map && <p style={{ fontWeight: 600 }}>{E.map}</p>}
          {Array.isArray(E.parts) && E.parts.length > 0 && (
            <div className="parts">{E.parts.map((x, i) => (
              <div key={i} className="part"><div className="ar s" lang="ar">{x.ar}</div><div className="tr small">{x.tr}</div><div className="small">{x.meaning}</div><div className="small muted">{x.role}</div></div>
            ))}</div>
          )}
          {Array.isArray(E.examples) && E.examples.map((x, i) => (
            <div key={i} className="row"><Speak text={x.ar} /><div className="grow"><div>{x.src}</div><div><span className="tr">{x.tr}</span> <span className="ar s" lang="ar">{x.ar}</span></div></div></div>
          ))}
          {E.tip && <p className="small">💡 {E.tip}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- profile and settings ---------- */
function Me({ profile, setProfile, progress }) {
  const [lang, setLang] = useState(profile.explain_lang);
  const [goal, setGoal] = useState(profile.goal);
  const [msg, setMsg] = useState("");
  const learned = Object.keys(progress).length;
  const strong = Object.values(progress).filter((p) => p.box >= 4).length;
  async function save() {
    const { error } = await sb().from("profiles").update({ explain_lang: lang, goal }).eq("id", profile.id);
    if (error) setMsg("Couldn't save."); else { setProfile({ ...profile, explain_lang: lang, goal }); setMsg("Saved ✓"); }
  }
  return (
    <>
      <h1>Me</h1>
      <div className="stats">
        <div className="stat"><b>{learned}</b><span className="small muted">words started</span></div>
        <div className="stat"><b>{strong}</b><span className="small muted">words strong</span></div>
        <div className="stat"><b>{profile.streak || 0}</b><span className="small muted">day streak</span></div>
      </div>
      <div className="card">
        <h3>Plan</h3>
        <p><b>{profile.plan === "free" ? "Free" : profile.plan === "pro" ? "Pro" : "Company"}</b> {profile.plan === "free" && <span className="muted small">· 10 new words and 25 coach replies a day</span>}</p>
        {profile.plan === "free" && <p className="small muted">Pro (unlimited practice) is coming soon.</p>}
      </div>
      <div className="card">
        <label htmlFor="lg2">Explain things to me in</label>
        <select id="lg2" value={lang} onChange={(e) => setLang(e.target.value)}><option>Hindi</option><option>Urdu</option><option>English</option></select>
        <label htmlFor="gl2">I mostly talk with</label>
        <select id="gl2" value={goal} onChange={(e) => setGoal(e.target.value)}><option value="customers">Customers</option><option value="staff">My staff and workers</option></select>
        <button className="btn" onClick={save}>Save</button>
        {msg && <p className="small ok">{msg}</p>}
      </div>
      <button className="btn ghost" onClick={() => sb().auth.signOut()}>Sign out</button>
      <p className="small muted center">Tip: add this app to your home screen from your browser's Share menu.</p>
    </>
  );
}
