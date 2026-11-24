"use client";
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";

// Sign-in page. Once signed in, the learner goes straight to the full coach (public/coach.html).
async function enter(session) {
  // Every learner has a plan row (free by default); the coach function reads it for daily limits.
  const s = sb();
  const { data } = await s.from("profiles").select("id").eq("id", session.user.id).maybeSingle();
  if (!data) await s.from("profiles").insert({ id: session.user.id });
  window.location.replace("/coach.html");
}

export default function SignIn() {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = sb();
    s.auth.getSession().then(({ data }) => { if (data.session) enter(data.session); else setChecking(false); });
    const { data: sub } = s.auth.onAuthStateChange((_e, sess) => { if (sess) enter(sess); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function send(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setMsg(/rate|seconds/i.test(error.message) ? "Too many sign-in emails just now. Please wait a minute and try again." : error.message);
    else setSent(true);
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg("That code didn't work. Use the newest email, or just tap the link in it.");
  }

  if (checking) return <div className="wrap"><p className="muted">Opening your coach…</p></div>;

  return (
    <div className="wrap">
      <div className="card center" style={{ marginTop: 24 }}>
        <div className="ar" lang="ar">أهلاً وسهلاً</div>
        <h1>Arabic Coach</h1>
        <p className="muted">Speak Saudi Arabic with your customers and staff. 1,000 core words, real conversations, car lessons, explained in Hindi or English.</p>
      </div>
      {!sent ? (
        <form className="card" onSubmit={send}>
          <label htmlFor="em">Your email</label>
          <input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <button className="btn wide" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
          {msg && <p className="err small">{msg}</p>}
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <p>We sent a sign-in email to <b>{email}</b>. <b>Tap the link in it</b> to open your coach.</p>
          <p className="small muted">If the email shows a 6-digit code instead, enter it here:</p>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
          <button className="btn wide" disabled={busy || code.trim().length < 6}>{busy ? "Checking…" : "Sign in with code"}</button>
          <button type="button" className="btn ghost small" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
          {msg && <p className="err small">{msg}</p>}
        </form>
      )}
    </div>
  );
}
