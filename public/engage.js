/* Arabic Coach: engagement layer (version 0.3.1).
   Adds the "Today" card (daily XP goal, streak and streak freezes, levels, badges, combos, celebrations, sounds,
   sharing) and Ustadh Sami, the animated coach. It hooks into the coach page's own functions by wrapping them,
   so the learning logic is unchanged. Every hook is wrapped in try/catch: it must never break a lesson.
   Saved per learner in the document "coach/xp". Dates use the coach page's own calendar (today(), addDaysTo()). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DAY = function () { try { return today(); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  var addDay = function (d, n) { try { return addDaysTo(d, n); } catch (e) { var x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); } };
  var hindi = function () { try { return typeof profile === "object" && profile && profile.explain === "Hindi"; } catch (e) { return false; } };
  var T = function (en, hi) { return hindi() && hi ? hi : en; };

  /* ---------- levels and badges ---------- */
  var LEVELS = [
    [0, "Mubtadi", "مبتدئ", "Beginner", "शुरुआत"], [100, "Talib", "طالب", "Student", "विद्यार्थी"], [300, "Mutakallim", "متكلم", "Speaker", "बोलने वाला"],
    [700, "Shatir", "شاطر", "Clever", "होशियार"], [1500, "Mahir", "ماهر", "Skilled", "माहिर"], [3000, "Ustadh", "أستاذ", "Master", "उस्ताद"],
    [6000, "Khabeer", "خبير", "Expert", "एक्सपर्ट"], [10000, "Najm", "نجم", "Star", "स्टार"],
  ];
  var BADGES = [
    ["first_word", "🌱", "First word", "Learned your first Saudi word"],
    ["words_50", "📗", "50 words", "50 core words known"],
    ["words_100", "📘", "100 words", "100 core words known"],
    ["words_250", "📙", "250 words", "250 core words known"],
    ["words_500", "📚", "500 words", "Half of the 1,000 words"],
    ["words_1000", "🏆", "1,000 words", "All 1,000 core words known"],
    ["first_chat", "💬", "First chat", "Finished your first conversation"],
    ["chats_10", "🗣️", "Talker", "Finished 10 conversations"],
    ["first_lesson", "🎓", "First lesson", "Finished a full lesson"],
    ["drive_1", "🚗", "Road scholar", "Finished a hands-free car lesson"],
    ["combo_10", "⚡", "On fire", "10 right answers in a row"],
    ["speed_15", "⏱️", "Quick tongue", "15 words in the 60-second challenge"],
    ["streak_3", "🔥", "3-day streak", "Practised 3 days in a row"],
    ["streak_7", "🔥", "Week streak", "Practised 7 days in a row"],
    ["streak_30", "💎", "Month streak", "Practised 30 days in a row"],
    ["goal_7", "🎯", "Goal getter", "Hit your daily goal 7 times"],
  ];
  var STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

  /* ---------- state ---------- */
  var X = { total: 0, days: {}, goal: 50, freezes: 1, badges: {}, combo: 0, bestCombo: 0, muted: false, goalsHit: 0, lastGoalDay: "" };
  var pending = { total: 0, days: {} }; // XP earned on this phone that the account copy does not have yet
  var db = null, saveT = 0, loaded = false;
  var LS = "ac.xp";

  function persist() {
    try { localStorage.setItem(LS, JSON.stringify(X)); } catch (e) {}
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (!db || !loaded) return; // never overwrite the account's copy before it has been read
      var keys = Object.keys(X.days).sort(); while (keys.length > 60) delete X.days[keys.shift()];
      var sent = JSON.parse(JSON.stringify(pending));
      db.doc("coach/xp").set(JSON.parse(JSON.stringify(X))).then(function () {
        pending.total -= sent.total; Object.keys(sent.days).forEach(function (k) { pending.days[k] = (pending.days[k] || 0) - sent.days[k]; });
      }).catch(function (e) { console.warn("xp save", e); });
    }, 1200);
  }
  function merge(r) {
    if (!r) return;
    // The account copy is the truth; add what this phone earned that the account hasn't seen yet.
    X.total = (r.total || 0) + pending.total;
    var days = {}; Object.keys(r.days || {}).forEach(function (k) { days[k] = r.days[k] || 0; });
    Object.keys(pending.days).forEach(function (k) { days[k] = (days[k] || 0) + pending.days[k]; });
    X.days = days;
    X.badges = Object.assign({}, r.badges || {}, X.badges);
    ["goal", "muted"].forEach(function (k) { if (r[k] != null && !loaded) X[k] = r[k]; });
    X.freezes = Math.max(0, Math.min(2, r.freezes != null ? r.freezes : X.freezes));
    X.goalsHit = Math.max(X.goalsHit || 0, r.goalsHit || 0); X.bestCombo = Math.max(X.bestCombo || 0, r.bestCombo || 0);
    if ((r.lastGoalDay || "") > (X.lastGoalDay || "")) X.lastGoalDay = r.lastGoalDay;
  }
  function load(attempt) {
    if (!window.claude || !window.claude.use) return;
    window.claude.use("db").then(function (d) {
      db = d;
      // The shim has now checked who is signed in (and cleared another learner's copy), so the local copy is safe to read.
      if (!loaded) { try { var c = JSON.parse(localStorage.getItem(LS) || "null"); if (c && typeof c.total === "number") X = Object.assign(X, c); } catch (e) {} }
      return d.doc("coach/xp").get().then(function (s) {
        if (s.exists) merge(s.data());
        loaded = true; persist(); render();
      });
    }).catch(function (e) {
      console.warn("xp load", e);
      if ((attempt || 0) < 3) setTimeout(function () { load((attempt || 0) + 1); }, 4000 * ((attempt || 0) + 1));
    });
  }
  load(0);

  var levelOf = function (xp) { var i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++; return i; };
  var todayXP = function () { return X.days[DAY()] || 0; };

  /* ---------- Ustadh Sami ---------- */
  var SAMI = '<svg class="eg-sami-svg" viewBox="0 0 120 140" width="78" height="91" role="img" aria-label="Ustadh Sami, your coach">' +
    '<ellipse cx="60" cy="134" rx="34" ry="5" fill="rgba(0,0,0,.12)"/>' +
    '<path d="M22 132 Q24 92 60 88 Q96 92 98 132 Z" fill="#f7f7f2" stroke="#d6d6cc" stroke-width="1.5"/>' +           // thobe
    '<path d="M60 92 L60 120" stroke="#d6d6cc" stroke-width="1.5"/><circle cx="60" cy="100" r="1.8" fill="#bdbdb2"/>' +
    '<path d="M18 70 Q14 20 60 14 Q106 20 102 70 L96 104 Q80 84 60 84 Q40 84 24 104 Z" fill="#fff" stroke="#d9d9d0" stroke-width="1.2"/>' + // shemagh
    '<g stroke="#c8102e" stroke-width="2.2" opacity=".85"><path d="M26 40 L94 40"/><path d="M22 52 L98 52"/><path d="M20 64 L100 64"/><path d="M36 22 L30 96"/><path d="M50 16 L46 88"/><path d="M70 16 L74 88"/><path d="M84 22 L90 96"/></g>' +
    '<ellipse cx="60" cy="31" rx="31" ry="6" fill="none" stroke="#1d1d1d" stroke-width="5"/>' +                    // agal
    '<ellipse cx="60" cy="58" rx="24" ry="27" fill="#d9a77a"/>' +                                                     // face
    '<path d="M38 64 Q40 88 60 90 Q80 88 82 64 Q78 78 60 80 Q42 78 38 64 Z" fill="#2b2016"/>' +                     // beard
    '<path d="M48 68 Q60 74 72 68" stroke="#2b2016" stroke-width="3" fill="none" stroke-linecap="round"/>' +       // moustache
    '<path class="eg-mouth" d="M51 74 Q60 82 69 74" stroke="#7a2e1f" stroke-width="2.6" fill="#fff" stroke-linecap="round"/>' +
    '<g class="eg-eyes"><ellipse cx="50" cy="55" rx="3.4" ry="4" fill="#1d1d1d"/><ellipse cx="70" cy="55" rx="3.4" ry="4" fill="#1d1d1d"/>' +
    '<circle cx="51.2" cy="53.6" r="1.1" fill="#fff"/><circle cx="71.2" cy="53.6" r="1.1" fill="#fff"/></g>' +
    '<path d="M44 47 Q50 44 55 47 M65 47 Q70 44 76 47" stroke="#2b2016" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="42" cy="64" rx="4" ry="2.4" fill="#e58f7a" opacity=".45"/><ellipse cx="78" cy="64" rx="4" ry="2.4" fill="#e58f7a" opacity=".45"/>' +
    '<g class="eg-arm"><path d="M96 112 Q112 96 108 78" stroke="#f7f7f2" stroke-width="11" fill="none" stroke-linecap="round"/><circle cx="108" cy="76" r="6" fill="#d9a77a"/></g>' +
    '</svg>';
  var PRAISE = [
    ["Shaatir!", "शाबाश, बहुत बढ़िया!", "Clever!"], ["Mumtaaz!", "एकदम बढ़िया!", "Excellent!"], ["Kafu!", "वाह, कमाल!", "Well done!"],
    ["Ya salaam!", "क्या बात है!", "Wonderful!"], ["Ahsant!", "बहुत अच्छा किया!", "Great job!"], ["Zain!", "अच्छा है!", "Good!"],
  ];
  var CHEER_WRONG = [["Ma 'alaih!", "कोई बात नहीं, फिर से कोशिश करो!", "No problem, try again!"], ["Shway shway", "धीरे-धीरे सीख जाओगे", "Little by little"]];
  var GREETS = [
    ["Ahlan! Yalla nibda?", "चलो शुरू करें? आज बस थोड़ा सा!", "Shall we start? Just a little today!"],
    ["Sabaah al-khair!", "आज का लक्ष्य पूरा करते हैं", "Let's hit today's goal"],
    ["Wainak? Ishtagt lak!", "कहाँ थे? याद आ रही थी!", "Where were you? I missed you!"],
  ];
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var lastSay = pick(GREETS);
  function samiLine(p) { return '<b>' + p[0] + '</b> <span>' + (hindi() ? p[1] : p[2]) + '</span>'; }
  function samiSay(p, mood) {
    lastSay = p;
    var say = $("egSay"), body = $("egSami");
    if (say) { say.innerHTML = samiLine(p); say.classList.remove("pop"); void say.offsetWidth; say.classList.add("pop"); }
    if (body) { body.classList.remove("cheer", "sad"); void body.offsetWidth; body.classList.add(mood || "cheer"); }
  }

  /* ---------- sound, haptics, confetti ---------- */
  var actx = null;
  function tone(freqs, dur, type) {
    if (X.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var t = actx.currentTime;
      freqs.forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = type || "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * dur); g.gain.exponentialRampToValueAtTime(0.18, t + i * dur + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (i + 1) * dur);
        o.connect(g); g.connect(actx.destination); o.start(t + i * dur); o.stop(t + (i + 1) * dur + 0.02);
      });
    } catch (e) {}
  }
  var buzz = function (p) { try { if (!X.muted && navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  var sfx = {
    right: function () { tone([880, 1320], 0.07); buzz(15); },
    wrong: function () { tone([220], 0.12, "triangle"); },
    combo: function () { tone([660, 880, 1100], 0.06); },
    level: function () { tone([523, 659, 784, 1046], 0.12, "triangle"); buzz([30, 40, 30]); },
    goal: function () { tone([784, 988, 1175, 1568], 0.1); },
  };
  var reduced = function () { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; };
  function confetti(n) {
    if (reduced()) return;
    var cv = document.createElement("canvas"); cv.className = "eg-confetti"; cv.setAttribute("aria-hidden", "true"); document.body.append(cv);
    var W = cv.width = innerWidth, H = cv.height = innerHeight, ctx = cv.getContext("2d");
    var cols = ["#0d6b57", "#e5a95c", "#4cc3a3", "#e63946", "#ffd166", "#118ab2"];
    var P = Array.from({ length: n || 90 }, function () {
      return { x: W / 2 + (Math.random() - .5) * 80, y: H * .35, vx: (Math.random() - .5) * 9, vy: -Math.random() * 11 - 4, r: Math.random() * 6 + 4, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6 };
    });
    var t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      P.forEach(function (p) { p.vy += .32; p.x += p.vx; p.y += p.vy; p.a += .15; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
      if (t - t0 < 2200) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  /* ---------- toasts and one-at-a-time celebration dialog ---------- */
  function toast(html, ms) {
    var wrap = $("egToasts"); if (!wrap) { wrap = document.createElement("div"); wrap.id = "egToasts"; wrap.setAttribute("aria-live", "polite"); document.body.append(wrap); }
    while (wrap.children.length >= 3) wrap.firstChild.remove();
    var t = document.createElement("div"); t.className = "eg-toast"; t.innerHTML = html; wrap.append(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 400); }, ms || 1600);
  }
  var queue = [], open = null;
  function celebrate(emoji, title, text, shareText) { queue.push([emoji, title, text, shareText]); if (!open) nextDialog(); }
  function nextDialog() {
    var d = queue.shift(); if (!d) { open = null; return; }
    var back = document.activeElement;
    sfx.level(); confetti(120);
    var bg = document.createElement("div"); bg.className = "eg-sheet-bg";
    var sheet = document.createElement("div"); sheet.className = "eg-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "egDlgTitle");
    sheet.innerHTML = '<div class="eg-big" aria-hidden="true">' + d[0] + '</div><h2 id="egDlgTitle">' + d[1] + '</h2><p>' + d[2] + '</p><div class="eg-row"></div>';
    var row = sheet.querySelector(".eg-row");
    var close = function () {
      document.removeEventListener("keydown", onKey, true); bg.remove(); open = null;
      try { back && back.focus && back.focus(); } catch (e) {}
      setTimeout(nextDialog, 250);
    };
    if (d[3]) { var sh = document.createElement("button"); sh.type = "button"; sh.className = "btn"; sh.textContent = T("Share 📤", "शेयर करें 📤"); sh.onclick = function () { share(d[3]); }; row.append(sh); }
    var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn ghost"; ok.textContent = T("Yalla, continue", "चलो, आगे बढ़ें"); ok.onclick = close; row.append(ok);
    var onKey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") { // keep focus inside the dialog
        var f = [].slice.call(sheet.querySelectorAll("button")); if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (i < 0) { e.preventDefault(); f[0].focus(); return; }
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    bg.onclick = function (e) { if (e.target === bg) close(); };
    bg.append(sheet); document.body.append(bg); open = bg; ok.focus();
  }
  function share(text) {
    var url = location.origin;
    if (navigator.share) navigator.share({ title: "Arabic Coach", text: text, url: url }).catch(function () {});
    else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  }

  /* ---------- XP ---------- */
  function award(n, why, quiet) {
    if (!n) return;
    var beforeLevel = levelOf(X.total), beforeToday = todayXP();
    X.total += n; X.days[DAY()] = beforeToday + n;
    pending.total += n; pending.days[DAY()] = (pending.days[DAY()] || 0) + n;
    if (!quiet) toast('<b>+' + n + ' XP</b>' + (why ? ' · ' + why : ''), 1300);
    if (beforeToday < X.goal && todayXP() >= X.goal && X.lastGoalDay !== DAY()) {
      X.goalsHit = (X.goalsHit || 0) + 1; X.lastGoalDay = DAY();
      setTimeout(function () {
        sfx.goal(); confetti(70);
        toast(T("🎯 <b>Daily goal reached!</b> See you tomorrow for your streak.", "🎯 <b>आज का लक्ष्य पूरा!</b> कल फिर मिलते हैं।"), 2600);
        samiSay(["Ya salaam!", "आज का लक्ष्य पूरा! कल फिर मिलते हैं", "Today's goal done! See you tomorrow"], "cheer");
      }, 400);
      if (X.goalsHit >= 7) badge("goal_7");
    }
    var after = levelOf(X.total);
    if (after > beforeLevel) {
      var L = LEVELS[after];
      setTimeout(function () {
        celebrate("⭐", T("Level " + (after + 1) + ": " + L[3] + "!", "लेवल " + (after + 1) + ": " + L[4] + "!"),
          T('You are now <b>' + L[1] + ' <span lang="ar" style="font-family:var(--arabic)">' + L[2] + '</span></b>, Arabic for "' + L[3] + '". ', 'अब आप <b>' + L[1] + ' <span lang="ar" style="font-family:var(--arabic)">' + L[2] + '</span></b> हैं, यानी "' + L[4] + '"। ') +
          (LEVELS[after + 1] ? T("Next level at " + LEVELS[after + 1][0] + " XP.", "अगला लेवल " + LEVELS[after + 1][0] + " XP पर।") : T("The top level!", "सबसे ऊँचा लेवल!")),
          "I just reached level " + (after + 1) + " (" + L[3] + ") learning Saudi Arabic on Arabic Coach 🇸🇦");
      }, 700);
    }
    persist(); render();
  }
  function badge(id) {
    if (X.badges[id]) return;
    var b = BADGES.find(function (x) { return x[0] === id; }); if (!b) return;
    X.badges[id] = DAY(); persist();
    setTimeout(function () { sfx.combo(); toast(b[1] + " <b>Badge: " + b[2] + "</b><br>" + b[3], 2800); }, 900);
    render();
  }
  function checkWordBadges() {
    try {
      var k = typeof coreKnown === "function" ? coreKnown() : 0;
      var started = typeof core === "object" && core && core.p ? Object.keys(core.p).length : 0;
      if (started >= 1) badge("first_word");
      [[50, "words_50"], [100, "words_100"], [250, "words_250"], [500, "words_500"], [1000, "words_1000"]].forEach(function (p) { if (k >= p[0]) badge(p[1]); });
    } catch (e) {}
  }

  /* ---------- streak protection ---------- */
  function protectStreak() {
    try {
      if (typeof profile !== "object" || !profile || !profile.lastDay) return;
      var t = DAY(), y = addDay(t, -1), missed = addDay(t, -2);
      // Missed exactly one day and own a freeze: count yesterday as practised, so today continues the streak.
      if (profile.lastDay === missed && (profile.streak || 0) > 0 && X.freezes > 0) {
        X.freezes--; profile.lastDay = y; persist();
        setTimeout(function () { toast(T("🧊 <b>Streak freeze used</b><br>You missed yesterday, but your " + profile.streak + "-day streak is safe.", "🧊 <b>स्ट्रीक फ्रीज़ इस्तेमाल हुआ</b><br>कल छूट गया, पर आपकी " + profile.streak + " दिन की स्ट्रीक बच गई।"), 3500); }, 600);
      }
    } catch (e) {}
  }
  function afterStreak() {
    try {
      var s = (typeof profile === "object" && profile && profile.streak) || 0;
      if (s >= 3) badge("streak_3"); if (s >= 7) badge("streak_7"); if (s >= 30) badge("streak_30");
      var key = "streak_m_" + s;
      if (STREAK_MILESTONES.indexOf(s) >= 0 && !X.badges[key]) {
        X.badges[key] = DAY();
        var earned = s % 7 === 0 && X.freezes < 2;
        if (earned) X.freezes++;
        persist();
        setTimeout(function () {
          celebrate("🔥", T(s + "-day streak!", s + " दिन की स्ट्रीक!"),
            T("You've practised Saudi Arabic " + s + " days in a row. ", "आपने लगातार " + s + " दिन सऊदी अरबी का अभ्यास किया। ") +
            (earned ? T("You earned a 🧊 streak freeze: it protects your streak if you miss a day.", "आपको एक 🧊 स्ट्रीक फ्रीज़ मिला: एक दिन छूटे तो भी स्ट्रीक बचेगी।") : T("Keep it going tomorrow!", "कल भी जारी रखें!")),
            "🔥 " + s + " days in a row learning Saudi Arabic on Arabic Coach!");
        }, 900);
      }
      render();
    } catch (e) {}
  }

  /* ---------- hooks into the coach page ---------- */
  function wrap(name, before, after) {
    var orig = window[name];
    if (typeof orig !== "function") { console.warn("engage: missing", name); return; }
    window[name] = function () {
      var args = arguments, self = this, ctx = {};
      try { before && before.call(ctx, args); } catch (e) { console.warn("engage before", name, e); }
      var r = orig.apply(self, args);
      var done = function (v) { try { after && after.call(ctx, v, args); } catch (e) { console.warn("engage after", name, e); } return v; };
      return r && typeof r.then === "function" ? r.then(done) : done(r);
    };
  }
  function install() {
    wrap("touchStreak", function () { protectStreak(); }, function () { afterStreak(); });
    wrap("applyGrade", null, function (_v, a) {
      var ok = a[1], isNew = a[2];
      if (ok) {
        X.combo = (X.combo || 0) + 1; X.bestCombo = Math.max(X.bestCombo || 0, X.combo);
        sfx.right(); award(isNew ? 10 : 5, null, true);
        if (X.combo === 1 || X.combo % 3 === 0) samiSay(pick(PRAISE), "cheer");
        if (X.combo === 3 || X.combo === 5 || X.combo % 10 === 0) { sfx.combo(); award(X.combo >= 10 ? 15 : 5, "🔥 " + X.combo + T(" in a row!", " लगातार सही!")); }
        if (X.combo >= 10) badge("combo_10");
      } else { X.combo = 0; sfx.wrong(); samiSay(pick(CHEER_WRONG), "sad"); }
      checkWordBadges();
    });
    wrap("endCore", null, function () { award(20, T("today's words done", "आज के शब्द पूरे")); });
    wrap("endSpeed", function () { try { this.score = SP ? SP.score : 0; } catch (e) { this.score = 0; } }, function () {
      var s = this.score || 0; if (s) award(Math.min(s * 2, 60), T("60-second challenge", "60 सेकंड चैलेंज")); if (s >= 15) badge("speed_15");
    });
    wrap("finishLesson", null, function () { award(50, T("lesson complete", "पाठ पूरा")); badge("first_lesson"); });
    wrap("finishTest", null, function () { award(40, T("level check done", "टेस्ट पूरा")); });
    wrap("finishDrive", null, function () { award(40, T("car lesson done", "कार वाला पाठ पूरा")); badge("drive_1"); });
    wrap("finishChat", null, function () {
      award(30, T("conversation done", "बातचीत पूरी")); badge("first_chat");
      try { if (Object.keys(chatsP.done || {}).length >= 10) badge("chats_10"); } catch (e) {}
    });
    // XP only when the coach actually answered (the reply is added to the conversation)
    wrap("talkTurn", function () { try { this.n = turns.length; } catch (e) { this.n = -1; } }, function () {
      try { if (this.n >= 0 && turns.length >= this.n + 2) award(5, T("spoke Arabic", "अरबी बोली")); } catch (e) {}
    });
    // XP only for a new explanation, not for reopening one already saved
    wrap("explainSentence", function () { this.n = window.__acSampleCalls || 0; }, function () {
      if ((window.__acSampleCalls || 0) > this.n) award(2, null, true); // only when the coach wrote a new explanation
    });
    wrap("stats", null, function () { render(); });
  }

  /* ---------- the Today card: built once, then only its numbers are updated ---------- */
  function nextStep() {
    try {
      var due = typeof coreDue === "function" ? coreDue().length : 0;
      var newLeft = (typeof core === "object" && core) ? Math.max(0, (core.perDay || 20) - (core.day === DAY() ? (core.newToday || 0) : 0)) : 0;
      if (due > 0 || newLeft > 0) return { label: due ? T("Review " + due + " word" + (due === 1 ? "" : "s") + " + new words", due + " शब्द दोहराएँ + नए शब्द") : T("Learn today's new words", "आज के नए शब्द सीखें"), tab: "words", go: function () { var b = $("cStart"); if (b) b.click(); } };
      var doneToday = (typeof chatsP === "object" && chatsP && chatsP.done) ? Object.values(chatsP.done).filter(function (d) { return d === DAY(); }).length : 0;
      if (!doneToday) return { label: T("Do today's conversation", "आज की बातचीत करें"), tab: "chats" };
      return { label: T("Talk with your coach", "कोच से बात करें"), tab: "talk" };
    } catch (e) { return { label: T("Start practising", "अभ्यास शुरू करें"), tab: "words" }; }
  }
  function ringSVG() {
    return '<svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true"><circle cx="42" cy="42" r="34" fill="none" stroke="var(--chip)" stroke-width="9"/><circle id="egRingArc" cx="42" cy="42" r="34" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="213.6" stroke-dashoffset="213.6" transform="rotate(-90 42 42)" style="transition:stroke-dashoffset .6s,stroke .3s"/></svg>';
  }
  function weekHTML() {
    var t = DAY(), out = [], max = 1;
    for (var i = 6; i >= 0; i--) { var d = addDay(t, -i); var v = X.days[d] || 0; max = Math.max(max, v, X.goal); out.push([d, v]); }
    var names = hindi() ? ["र", "सो", "मं", "बु", "गु", "शु", "श"] : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    return out.map(function (p) {
      var dow = new Date(p[0] + "T12:00:00").getDay();
      return '<div class="eg-day' + (p[0] === t ? " today" : "") + '" title="' + p[1] + ' XP"><i style="height:' + Math.max(4, Math.round(p[1] / max * 40)) + 'px" class="' + (p[1] >= X.goal ? "hit" : "") + '"></i><span>' + names[dow] + '</span></div>';
    }).join("");
  }
  var built = false, rendering = false;
  function build(card) {
    card.innerHTML =
      '<div class="eg-sami" id="egSami">' + SAMI + '<div class="eg-say" id="egSay"></div></div>' +
      '<div class="eg-top">' +
        '<div class="eg-ring">' + ringSVG() + '<div class="eg-ring-txt"><b id="egToday"></b><span id="egGoalTxt"></span></div></div>' +
        '<div class="eg-info">' +
          '<div class="eg-chips">' +
            '<div class="eg-chip" id="egStreakChip"><b id="egStreak"></b><span id="egStreakLbl"></span></div>' +
            '<div class="eg-chip"><b id="egFreeze"></b><span id="egFreezeLbl"></span></div>' +
            '<div class="eg-chip"><b id="egTotal"></b><span>XP</span></div>' +
          '</div>' +
          '<div class="eg-level" id="egLevel"></div>' +
          '<div class="eg-bar"><i id="egLevelBar"></i></div>' +
          '<div class="eg-sub" id="egNext"></div>' +
        '</div>' +
      '</div>' +
      '<div class="eg-msg" id="egMsg"></div>' +
      '<button type="button" class="btn eg-go" id="egGo"></button>' +
      '<div class="eg-weekwrap"><div class="eg-weekttl" id="egWeekTtl"></div><div class="eg-week" id="egWeek"></div></div>' +
      '<details class="eg-more" id="egMore"><summary id="egMoreSum"></summary>' +
        '<p class="eg-help" id="egHelp"></p>' +
        '<div class="eg-badges" id="egBadges"></div>' +
        '<div class="eg-set"><label><span id="egGoalLbl"></span> <select id="egGoal"><option value="20">20 XP (~3 min)</option><option value="50">50 XP (~7 min)</option><option value="100">100 XP (~15 min)</option><option value="200">200 XP (~30 min)</option></select></label>' +
        '<label class="eg-check"><input type="checkbox" id="egMute"> <span id="egMuteLbl"></span></label>' +
        '<button type="button" class="btn ghost small" id="egShare"></button></div>' +
      '</details>';
    $("egGoal").onchange = function (e) { X.goal = +e.target.value || 50; persist(); render(); };
    $("egMute").onchange = function (e) { X.muted = e.target.checked; persist(); };
    $("egShare").onclick = function () {
      var lv = levelOf(X.total);
      share("I'm learning Saudi Arabic on Arabic Coach: level " + (lv + 1) + " (" + LEVELS[lv][3] + "), " + X.total + " XP, 🔥 " + ((profile && profile.streak) || 0) + "-day streak.");
    };
    $("egGo").onclick = function () {
      var step = nextStep();
      try { showTab(step.tab); } catch (e) {}
      if (step.go) setTimeout(step.go, 50);
      var tabsEl = $("tabs"); if (tabsEl) tabsEl.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    };
    $("egSay").innerHTML = samiLine(lastSay);
    built = true;
  }
  var setText = function (id, v) { var el = $(id); if (el && el.textContent !== String(v)) el.textContent = v; };
  function render() {
    if (rendering) return; rendering = true;
    try {
      var main = document.querySelector("main"), statsEl = $("stats"), card = $("egCard");
      if (!main || !statsEl) return;
      if (typeof profile !== "object" || !profile) { if (card) card.hidden = true; return; }
      if (!card) { card = document.createElement("section"); card.id = "egCard"; card.className = "card eg-card"; card.setAttribute("aria-label", "Today"); statsEl.before(card); built = false; }
      if (!built) build(card);
      card.hidden = false;
      var t = todayXP(), pct = Math.min(1, t / X.goal), lv = levelOf(X.total), L = LEVELS[lv], N = LEVELS[lv + 1];
      var streak = profile.streak || 0, safeToday = profile.lastDay === DAY();
      var arc = $("egRingArc"); arc.setAttribute("stroke-dashoffset", (213.6 * (1 - pct)).toFixed(1)); arc.setAttribute("stroke", pct >= 1 ? "var(--gold)" : "var(--accent)");
      setText("egToday", t); setText("egGoalTxt", "/" + X.goal + " XP");
      setText("egStreak", "🔥 " + streak); setText("egStreakLbl", T(streak === 1 ? "day streak" : "day streak", "दिन लगातार"));
      $("egStreakChip").classList.toggle("lit", safeToday);
      setText("egFreeze", "🧊 " + X.freezes); setText("egFreezeLbl", T(X.freezes === 1 ? "freeze" : "freezes", "फ्रीज़"));
      setText("egTotal", "⭐ " + X.total);
      $("egLevel").innerHTML = T("<b>Level " + (lv + 1) + "</b> · " + L[3], "<b>लेवल " + (lv + 1) + "</b> · " + L[4]) + ' <span lang="ar">' + L[2] + "</span>";
      $("egLevelBar").style.width = Math.round((N ? (X.total - L[0]) / (N[0] - L[0]) : 1) * 100) + "%";
      setText("egNext", N ? T((N[0] - X.total) + " XP to level " + (lv + 2), "लेवल " + (lv + 2) + " तक " + (N[0] - X.total) + " XP") : T("Top level reached", "सबसे ऊँचा लेवल"));
      setText("egMsg", pct >= 1 ? T("🎯 Daily goal done. Anything more is a bonus!", "🎯 आज का लक्ष्य पूरा। अब जो करें, बोनस है!")
        : safeToday ? T("Streak safe today ✓ · " + (X.goal - t) + " XP to your daily goal", "आज की स्ट्रीक पक्की ✓ · लक्ष्य तक " + (X.goal - t) + " XP")
        : streak ? T("Practise today to keep your " + streak + "-day streak", "अपनी " + streak + " दिन की स्ट्रीक बचाने के लिए आज अभ्यास करें")
        : T("Start your streak today: one activity is enough", "आज से स्ट्रीक शुरू करें: एक अभ्यास काफ़ी है"));
      setText("egGo", "▶ " + nextStep().label);
      setText("egWeekTtl", T("XP this week", "इस हफ़्ते के XP"));
      var wk = weekHTML(); var wEl = $("egWeek"); if (wEl.innerHTML !== wk) wEl.innerHTML = wk;
      var got = BADGES.filter(function (b) { return X.badges[b[0]]; }).length;
      setText("egMoreSum", T("🏅 Badges " + got + "/" + BADGES.length + " · goal and sound settings", "🏅 बैज " + got + "/" + BADGES.length + " · लक्ष्य और आवाज़"));
      setText("egHelp", T("Earn XP from every answer, lesson, conversation and car lesson. Hit your daily goal to fill the ring; any practice keeps your streak. 🧊 Freezes (earned every 7 days) save your streak if you miss one day.",
        "हर सही जवाब, पाठ, बातचीत और कार वाले पाठ से XP मिलते हैं। रोज़ का लक्ष्य पूरा करें; कोई भी अभ्यास स्ट्रीक बचाता है। 🧊 फ्रीज़ (हर 7 दिन पर) एक दिन छूटने पर स्ट्रीक बचाता है।"));
      var bh = BADGES.map(function (b) { return '<div class="eg-badge' + (X.badges[b[0]] ? "" : " locked") + '"><span aria-hidden="true">' + b[1] + '</span><small>' + b[2] + '</small><em>' + b[3] + '</em></div>'; }).join("");
      var bEl = $("egBadges"); if (bEl.innerHTML !== bh) bEl.innerHTML = bh;
      var g = $("egGoal"); if (document.activeElement !== g) g.value = String(X.goal);
      $("egMute").checked = !!X.muted;
      setText("egGoalLbl", T("Daily goal", "रोज़ का लक्ष्य")); setText("egMuteLbl", T("Mute sounds and vibration", "आवाज़ और वाइब्रेशन बंद"));
      setText("egShare", T("Share my progress 📤", "अपनी प्रगति शेयर करें 📤"));
    } catch (e) { console.warn("engage render", e); } finally { rendering = false; }
  }

  /* ---------- styles ---------- */
  var css = document.createElement("style");
  css.textContent = [
    ".eg-card{gap:12px;border:2px solid var(--accent-soft)}",
    ".eg-sami{display:flex;align-items:flex-end;gap:10px}",
    ".eg-sami-svg{flex:none;animation:egbob 3s ease-in-out infinite;transform-origin:50% 100%}",
    ".eg-sami .eg-eyes{animation:egblink 4.5s infinite;transform-origin:60px 55px}",
    ".eg-sami.cheer .eg-sami-svg{animation:egjump .7s ease-out}.eg-sami.cheer .eg-arm{transform-origin:96px 112px;animation:egwave .7s ease-in-out 2}",
    ".eg-sami.sad .eg-sami-svg{animation:egtilt .8s ease-in-out}",
    ".eg-say{position:relative;background:var(--accent-soft);border-radius:16px 16px 16px 4px;padding:9px 12px;font-size:.95rem;line-height:1.4;margin-bottom:22px}",
    ".eg-say b{color:var(--accent);margin-right:4px}.eg-say.pop{animation:egpop .35s}",
    ".eg-top{display:flex;gap:14px;align-items:center}",
    ".eg-ring{position:relative;width:84px;height:84px;flex:none}",
    ".eg-ring-txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}",
    ".eg-ring-txt b{font-size:1.35rem}.eg-ring-txt span{font-size:.72rem;color:var(--muted)}",
    ".eg-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}",
    ".eg-chips{display:flex;gap:6px;flex-wrap:wrap}",
    ".eg-chip{display:flex;flex-direction:column;align-items:center;background:var(--chip);border-radius:12px;padding:3px 9px;line-height:1.2}",
    ".eg-chip b{font-size:1rem}.eg-chip span{font-size:.68rem;color:var(--muted)}",
    "#egStreakChip:not(.lit) b{filter:grayscale(1);opacity:.65}#egStreakChip.lit{background:var(--gold-soft)}",
    ".eg-level{font-size:.95rem}.eg-level span{font-family:var(--arabic);color:var(--accent)}",
    ".eg-bar{height:8px;background:var(--chip);border-radius:99px;overflow:hidden}.eg-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--gold));transition:width .6s}",
    ".eg-sub{font-size:.78rem;color:var(--muted)}",
    ".eg-msg{font-size:.95rem}",
    ".eg-go{width:100%;font-size:1.05rem;padding:14px;animation:egpulse 2.4s infinite}",
    ".eg-weekttl{font-size:.72rem;color:var(--muted);margin-bottom:2px}",
    ".eg-week{display:flex;justify-content:space-between;align-items:flex-end;height:58px;padding:0 4px}",
    ".eg-day{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:.7rem;color:var(--muted)}",
    ".eg-day i{display:block;width:18px;border-radius:5px;background:var(--line)}.eg-day i.hit{background:var(--accent)}.eg-day.today span{color:var(--ink);font-weight:700}",
    ".eg-more summary{cursor:pointer;color:var(--muted);font-size:.9rem;padding:4px 0}",
    ".eg-help{font-size:.85rem;color:var(--muted);margin:8px 0}",
    ".eg-badges{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}",
    ".eg-badge{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;background:var(--chip);border-radius:12px;padding:8px 4px}.eg-badge span{font-size:1.5rem}.eg-badge small{font-size:.7rem;line-height:1.2;font-weight:600}.eg-badge em{font-style:normal;font-size:.62rem;line-height:1.2;color:var(--muted)}",
    ".eg-badge.locked{opacity:.4}.eg-badge.locked span{filter:grayscale(1)}",
    ".eg-set{display:flex;flex-direction:column;gap:8px}.eg-set select{margin-left:6px}.eg-check{display:flex;gap:6px;align-items:center}",
    "#egToasts{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:60;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;width:min(92vw,420px)}",
    ".eg-toast{background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);font-size:.92rem;text-align:center;animation:egin .25s ease-out}",
    ".eg-toast.out{opacity:0;transform:translateY(-8px);transition:all .35s}",
    ".eg-confetti{position:fixed;inset:0;pointer-events:none;z-index:70}",
    ".eg-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:65;display:flex;align-items:center;justify-content:center;padding:20px}",
    ".eg-sheet{background:var(--surface);color:var(--ink);border-radius:20px;padding:24px 20px;max-width:380px;width:100%;text-align:center;display:flex;flex-direction:column;gap:10px;animation:egpop .35s}",
    ".eg-sheet h2{margin:0}.eg-sheet p{margin:0}.eg-big{font-size:3.4rem;line-height:1}",
    ".eg-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px}",
    "@keyframes egpop{0%{transform:scale(.7);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}",
    "@keyframes egin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}",
    "@keyframes egpulse{0%,100%{box-shadow:0 0 0 0 rgba(13,107,87,.35)}50%{box-shadow:0 0 0 8px rgba(13,107,87,0)}}",
    "@keyframes egbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
    "@keyframes egblink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}",
    "@keyframes egwave{0%,100%{transform:rotate(0)}25%{transform:rotate(-18deg)}75%{transform:rotate(12deg)}}",
    "@keyframes egjump{0%{transform:translateY(0)}35%{transform:translateY(-14px) scale(1.04)}70%{transform:translateY(0) scale(.98,1.02)}100%{transform:none}}",
    "@keyframes egtilt{0%,100%{transform:rotate(0)}30%{transform:rotate(-6deg)}60%{transform:rotate(4deg)}}",
    "@media (prefers-reduced-motion:reduce){.eg-go,.eg-sheet,.eg-toast,.eg-sami-svg,.eg-sami *,.eg-say.pop{animation:none!important}}",
  ].join("\n");
  document.head.append(css);

  install();
  // The coach page draws its data a moment after loading; draw the card as soon as the learner's profile is there.
  var tries = 0, iv = setInterval(function () { render(); if ((built && typeof profile === "object" && profile) || ++tries > 20) clearInterval(iv); }, 500);
  window.egAward = award; // used by tests
})();
