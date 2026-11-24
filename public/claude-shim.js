/* Arabic Coach: connects the coach page to this app's own backend.
   The coach page was first built to run inside Claude, where it asks for window.claude.use("db") and use("sample").
   This file provides those two services from Supabase: "db" = the learner's private saved data (table public.docs),
   "sample" = the Supabase Edge Function "sample", which asks Claude and returns JSON. */
(function () {
  var SUPABASE_URL = "https://nrfuhihmnnsnijhhbvdp.supabase.co";
  var SUPABASE_KEY = "sb_publishable_a6ZdN1Z57DKP9vvRF-k1uw_KrfUfEKh";
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.acSupabase = sb;

  var CACHE_KEYS = ["arabiccoach.cache.v1", "arabiccoach.v1", "ac.xp"];
  var userId = null;

  // Wait for a signed-in learner; otherwise go to the sign-in page.
  var ready = sb.auth.getSession().then(function (r) {
    var s = r.data && r.data.session;
    if (!s) { location.replace("/"); return new Promise(function () {}); }
    userId = s.user.id;
    // A different learner on this phone must never see the previous learner's saved copy.
    try {
      if (localStorage.getItem("ac.owner") !== userId) {
        CACHE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        localStorage.setItem("ac.owner", userId);
      }
    } catch (e) {}
    return s;
  });
  sb.auth.onAuthStateChange(function (event) { if (event === "SIGNED_OUT") location.replace("/"); });

  function fail(error) {
    var e = new Error((error && error.message) || "database error");
    e.code = (error && error.code) || "db_error";
    throw e;
  }
  function docRef(path) {
    return {
      get: function () {
        return sb.from("docs").select("data").eq("path", path).maybeSingle().then(function (r) {
          if (r.error) fail(r.error);
          var d = r.data ? r.data.data : null;
          return { id: path.split("/").pop(), exists: !!r.data, data: function () { return d; } };
        });
      },
      set: function (obj) {
        return sb.from("docs").upsert({ user_id: userId, path: path, data: obj == null ? {} : obj, updated_at: new Date().toISOString() })
          .then(function (r) { if (r.error) fail(r.error); });
      },
      delete: function () {
        return sb.from("docs").delete().eq("path", path).then(function (r) { if (r.error) fail(r.error); });
      },
    };
  }
  function listDocs(name, n) {
    var q = sb.from("docs").select("path,data").like("path", name.replace(/[%_\\]/g, "\\$&") + "/%").order("path");
    if (n) q = q.limit(n);
    return q.then(function (r) {
      if (r.error) fail(r.error);
      var docs = (r.data || []).map(function (row) {
        return { id: row.path.slice(name.length + 1), exists: true, data: function () { return row.data; } };
      });
      return { docs: docs, size: docs.length, empty: docs.length === 0 };
    });
  }
  var db = {
    doc: docRef,
    collection: function (name) {
      return {
        doc: function (id) { return docRef(name + "/" + id); },
        limit: function (n) { return { get: function () { return listDocs(name, Math.min(n, 1000)); } }; },
        get: function () { return listDocs(name, 1000); },
      };
    },
  };

  var sample = {
    json: function (input, opts) {
      var tier = opts && opts.modelTier === "quick" ? "quick" : "default";
      return sb.functions.invoke("sample", { body: { input: input, tier: tier } }).then(async function (r) {
        if (r.error) {
          var info = {};
          try { info = await r.error.context.json(); } catch (e) {}
          var err = new Error(info.error || "Something went wrong.");
          err.code = info.code || "unavailable";
          err.error = info.error || "";
          throw err;
        }
        return r.data && r.data.result;
      });
    },
  };

  window.claude = {
    use: function (name) {
      return ready.then(function () {
        if (name === "db") return db;
        if (name === "sample") return sample;
        return null;
      });
    },
  };

  // A small account bar: who is signed in, and a sign-out button.
  document.addEventListener("DOMContentLoaded", function () {
    ready.then(function (s) {
      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;justify-content:flex-end;align-items:center;gap:8px;font-size:.8rem;opacity:.8;padding:6px 12px 0";
      var who = document.createElement("span"); who.textContent = s.user.email || "";
      var out = document.createElement("button");
      out.type = "button"; out.textContent = "Sign out";
      out.style.cssText = "background:none;border:1px solid currentColor;border-radius:8px;padding:2px 8px;color:inherit;font:inherit;cursor:pointer";
      out.onclick = function () {
        try { CACHE_KEYS.forEach(function (k) { localStorage.removeItem(k); }); localStorage.removeItem("ac.owner"); } catch (e) {}
        sb.auth.signOut();
      };
      bar.append(who, out);
      document.body.prepend(bar);
    });
  });
})();
