/* Arabic Coach: engagement layer (version 0.3).
   Adds a "Today" card with a daily XP goal, streak protection (streak freezes), levels, badges, combos,
   celebrations, sounds and sharing. It hooks into the coach page's own functions (applyGrade, finishChat, ...)
   by wrapping them, so the learning logic itself is unchanged. Any error here is caught: it must never
   break a lesson. Saved per learner in the document "coach/xp". */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DAY = function () { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()); };
  var addDay = function (d, n) { var x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  var safe = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { console.warn("engage", e); } }; };

  /* ---------- levels and badges ---------- */
  var LEVELS = [
    [0, "Mubtadi", "مبتدئ", "Beginner"], [100, "Talib", "طالب", "Student"], [300, "Mutakallim", "متكلم", "Speaker"],
    [700, "Shatir", "شاطر", "Clever"], [1500, "Mahir", "ماهر", "Skilled"], [3000, "Ustadh", "أستاذ", "Master"],
    [6000, "Khabeer", "خبير", "Expert"], [10000, "Najm", "نجم", "Star"],
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
  var db = null, saveT = 0, loaded = false;
  var LS = "ac.xp";
  try { var c = JSON.parse(localStorage.getItem(LS) || "null"); if (c && typeof c.total === "number") X = Object.assign(X, c); } catch (e) {}

  function persist() {
    try { localStorage.setItem(LS, JSON.stringify(X)); } catch (e) {}
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (!db || !loaded) return;
      // keep the last 60 days of daily XP
      var keys = Object.keys(X.days).sort(); while (keys.length > 60) delete X.days[keys.shift()];
      db.doc("coach/xp").set(JSON.parse(JSON.stringify(X))).catch(function (e) { console.warn("xp save", e); });
    }, 1200);
  }
  if (window.claude && window.claude.use) {
    window.claude.use("db").then(function (d) {
      db = d;
      return d.doc("coach/xp").get().then(function (s) {
        if (s.exists && s.data()) {
          var r = s.data();
          // keep whichever copy has more progress (another phone may have played meanwhile)
          if ((r.total || 0) >= X.total) X = Object.assign(X, r);
          Object.keys(r.days || {}).forEach(function (k) { X.days[k] = Math.max(X.days[k] || 0, r.days[k]); });
          X.badges = Object.assign({}, r.badges || {}, X.badges);
        }
        loaded = true; persist(); render();
      });
    }).catch(function (e) { console.warn("xp load", e); loaded = true; });
  }

  var levelOf = function (xp) { var i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++; return i; };
  var todayXP = function () { return X.days[DAY()] || 0; };

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
  var sfx = {
    right: function () { tone([880, 1320], 0.07); try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} },
    wrong: function () { tone([220], 0.12, "triangle"); },
    combo: function () { tone([660, 880, 1100], 0.06); },
    level: function () { tone([523, 659, 784, 1046], 0.12, "triangle"); try { navigator.vibrate && navigator.vibrate([30, 40, 30]); } catch (e) {} },
    goal: function () { tone([784, 988, 1175, 1568], 0.1); },
  };
  function confetti(n) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = document.createElement("canvas"); cv.className = "eg-confetti"; document.body.append(cv);
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

  /* ---------- Ustadh Sami: the animated coach ---------- */
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
  var lastSay = null;
  var hindi = function () { try { return typeof profile === "object" && profile && profile.explain === "Hindi"; } catch (e) { return false; } };
  function samiLine(p) { return '<b>' + p[0] + '</b> <span>' + (hindi() ? p[1] : p[2]) + '</span>'; }
  function samiSay(p, mood) {
    lastSay = p;
    var say = $("egSay"), body = $("egSami");
    if (say) { say.innerHTML = samiLine(p); say.classList.remove("pop"); void say.offsetWidth; say.classList.add("pop"); }
    if (body) { body.classList.remove("cheer", "sad"); void body.offsetWidth; body.classList.add(mood || "cheer"); }
  }
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  /* ---------- toasts and celebration sheet ---------- */
  function toast(html, ms) {
    var wrap = $("egToasts"); if (!wrap) { wrap = document.createElement("div"); wrap.id = "egToasts"; wrap.setAttribute("aria-live", "polite"); document.body.append(wrap); }
    var t = document.createElement("div"); t.className = "eg-toast"; t.innerHTML = html; wrap.append(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 400); }, ms || 1600);
  }
  function celebrate(emoji, title, text, shareText) {
    sfx.level(); confetti(120);
    var bg = document.createElement("div"); bg.className = "eg-sheet-bg";
    bg.innerHTML = '<div class="eg-sheet" role="dialog" aria-modal="true" aria-label="' + title.replace(/"/g, "") + '"><div class="eg-big">' + emoji + '</div><h2>' + title + '</h2><p>' + text + '</p><div class="eg-row"></div></div>';
    var row = bg.querySelector(".eg-row");
    if (shareText) {
      var sh = document.createElement("button"); sh.type = "button"; sh.className = "btn"; sh.textContent = "Share 📤";
      sh.onclick = function () { share(shareText); };
      row.append(sh);
    }
    var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn ghost"; ok.textContent = "Yalla, continue";
    ok.onclick = function () { bg.remove(); };
    row.append(ok);
    bg.onclick = function (e) { if (e.target === bg) bg.remove(); };
    document.body.append(bg); ok.focus();
  }
  function share(text) {
    var url = location.origin;
    var msg = text + " " + url;
    if (navigator.share) navigator.share({ title: "Arabic Coach", text: text, url: url }).catch(function () {});
    else window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank");
  }

  /* ---------- XP ---------- */
  function award(n, why, quiet) {
    if (!n) return;
    var beforeLevel = levelOf(X.total), beforeToday = todayXP();
    X.total += n; X.days[DAY()] = beforeToday + n;
    if (!quiet) toast('<b>+' + n + ' XP</b>' + (why ? ' · ' + why : ''), 1300);
    if (beforeToday < X.goal && todayXP() >= X.goal) {
      X.goalsHit = (X.goalsHit || 0) + (X.lastGoalDay === DAY() ? 0 : 1); X.lastGoalDay = DAY();
      setTimeout(function () { sfx.goal(); confetti(70); toast("🎯 <b>Daily goal reached!</b> Your streak is safe today.", 2600); samiSay(["Ya salaam!", "आज का लक्ष्य पूरा! कल फिर मिलते हैं", "Today's goal done! See you tomorrow"], "cheer"); }, 400);
      if (X.goalsHit >= 7) badge("goal_7");
    }
    var after = levelOf(X.total);
    if (after > beforeLevel) {
      var L = LEVELS[after];
      setTimeout(function () {
        celebrate("⭐", "Level up: " + L[1], 'You are now <b>' + L[1] + ' <span lang="ar" style="font-family:var(--arabic)">' + L[2] + '</span></b> (' + L[3] + '). ' + (LEVELS[after + 1] ? 'Next level at ' + LEVELS[after + 1][0] + ' XP.' : 'The top level!'),
          "I just reached level " + L[1] + " (" + L[3] + ") learning Saudi Arabic on Arabic Coach 🇸🇦");
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
        setTimeout(function () { toast("🧊 <b>Streak freeze used</b><br>You missed yesterday, but your " + profile.streak + "-day streak is safe.", 3500); }, 600);
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
        if (s % 7 === 0 && X.freezes < 2) { X.freezes++; }
        persist();
        setTimeout(function () {
          celebrate("🔥", s + "-day streak!", "You've practised Saudi Arabic " + s + " days in a row. " + (s % 7 === 0 ? "You earned a 🧊 streak freeze: it protects your streak if you miss a day." : "Keep it going tomorrow!"),
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
      var args = arguments, self = this;
      try { before && before.apply(self, args); } catch (e) { console.warn("engage before", name, e); }
      var r = orig.apply(self, args);
      var done = function (v) { try { after && after.call(self, v, args); } catch (e) { console.warn("engage after", name, e); } return v; };
      return r && typeof r.then === "function" ? r.then(done) : done(r);
    };
  }
  function install() {
    wrap("touchStreak", function () { protectStreak(); }, function () { afterStreak(); });
    // Every word card answered (new words, reviews, matching, speaking)
    wrap("applyGrade", null, function (_v, a) {
      var ok = a[1], isNew = a[2];
      if (ok) {
        X.combo = (X.combo || 0) + 1; X.bestCombo = Math.max(X.bestCombo || 0, X.combo);
        sfx.right(); award(isNew ? 10 : 5, null, true);
        if (X.combo === 1 || X.combo % 3 === 0) samiSay(pick(PRAISE), "cheer");
        if (X.combo === 3 || X.combo === 5 || X.combo % 10 === 0) { sfx.combo(); award(X.combo >= 10 ? 15 : 5, "🔥 " + X.combo + " in a row!"); }
        if (X.combo >= 10) badge("combo_10");
      } else { X.combo = 0; sfx.wrong(); award(1, null, true); samiSay(pick(CHEER_WRONG), "sad"); }
      checkWordBadges();
    });
    wrap("endCore", null, function () { award(20, "today's words done"); });
    wrap("endSpeed", function () { try { window.__egSpeed = (window.SP && SP.score) || (typeof SP === "object" && SP ? SP.score : 0); } catch (e) { window.__egSpeed = 0; } }, function () {
      var s = window.__egSpeed || 0; if (s) award(Math.min(s * 2, 60), "60-second challenge"); if (s >= 15) badge("speed_15");
    });
    wrap("finishLesson", null, function () { award(50, "lesson complete"); badge("first_lesson"); });
    wrap("finishTest", null, function () { award(40, "level check done"); });
    wrap("finishDrive", null, function () { award(40, "car lesson done"); badge("drive_1"); });
    wrap("finishChat", null, function () {
      award(30, "conversation done"); badge("first_chat");
      try { if (Object.keys(chatsP.done || {}).length >= 10) badge("chats_10"); } catch (e) {}
    });
    wrap("talkTurn", null, function () { award(5, "spoke Arabic"); });
    wrap("explainSentence", null, function () { award(2, null, true); });
    wrap("buildOwn", null, function () { award(3, null, true); });
    // each time the page refreshes its numbers, refresh the Today card too
    wrap("stats", null, function () { render(); });
  }

  /* ---------- the Today card ---------- */
  function nextStep() {
    try {
      var due = typeof coreDue === "function" ? coreDue().length : 0;
      var newLeft = (typeof core === "object" && core) ? Math.max(0, (core.perDay || 20) - (core.day === DAY() ? (core.newToday || 0) : 0)) : 0;
      if (due > 0 || newLeft > 0) return { label: due ? "Review " + due + " word" + (due === 1 ? "" : "s") + " + new words" : "Learn today's new words", tab: "words", go: function () { var b = $("cStart"); if (b) b.click(); } };
      var doneToday = (typeof chatsP === "object" && chatsP && chatsP.done) ? Object.values(chatsP.done).filter(function (d) { return d === DAY(); }).length : 0;
      if (!doneToday) return { label: "Do today's conversation", tab: "chats" };
      return { label: "Talk with your coach", tab: "talk" };
    } catch (e) { return { label: "Start practising", tab: "words" }; }
  }
  function ring(pct) {
    var r = 34, C = 2 * Math.PI * r, off = C * (1 - Math.min(1, pct));
    return '<svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true"><circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--chip)" stroke-width="9"/><circle cx="42" cy="42" r="' + r + '" fill="none" stroke="' + (pct >= 1 ? "var(--gold)" : "var(--accent)") + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 42 42)" style="transition:stroke-dashoffset .6s"/></svg>';
  }
  function week() {
    var t = DAY(), out = [], max = 1;
    for (var i = 6; i >= 0; i--) { var d = addDay(t, -i); var v = X.days[d] || 0; max = Math.max(max, v, X.goal); out.push([d, v]); }
    var names = ["S", "M", "T", "W", "T", "F", "S"];
    return '<div class="eg-week" aria-label="XP for the last 7 days">' + out.map(function (p) {
      var dow = new Date(p[0] + "T12:00:00Z").getUTCDay();
      return '<div class="eg-day' + (p[0] === t ? " today" : "") + '"><i style="height:' + Math.max(4, Math.round(p[1] / max * 44)) + 'px" class="' + (p[1] >= X.goal ? "hit" : "") + '"></i><span>' + names[dow] + '</span></div>';
    }).join("") + "</div>";
  }
  var rendering = false;
  function render() {
    if (rendering) return; rendering = true;
    try {
      var card = $("egToday");
      var main = document.querySelector("main"), statsEl = $("stats");
      if (!main || !statsEl) return;
      if (typeof profile !== "object" || !profile) { if (card) card.hidden = true; return; }
      if (!card) { card = document.createElement("section"); card.id = "egToday"; card.className = "card eg-card"; statsEl.before(card); }
      card.hidden = false;
      var t = todayXP(), pct = t / X.goal, lv = levelOf(X.total), L = LEVELS[lv], N = LEVELS[lv + 1];
      var lvPct = N ? (X.total - L[0]) / (N[0] - L[0]) : 1;
      var streak = profile.streak || 0, step = nextStep();
      var got = BADGES.filter(function (b) { return X.badges[b[0]]; });
      if (!lastSay) lastSay = pick(GREETS);
      card.innerHTML =
        '<div class="eg-sami" id="egSami">' + SAMI + '<div class="eg-say" id="egSay">' + samiLine(lastSay) + '</div></div>' +
        '<div class="eg-top">' +
          '<div class="eg-ring">' + ring(pct) + '<div class="eg-ring-txt"><b>' + t + '</b><span>/' + X.goal + ' XP</span></div></div>' +
          '<div class="eg-info">' +
            '<div class="eg-line"><span class="eg-flame' + (profile.lastDay === DAY() ? " lit" : "") + '">🔥 ' + streak + '</span><span class="eg-pill" title="Streak freezes">🧊 ' + X.freezes + '</span><span class="eg-pill">⭐ ' + X.total + ' XP</span></div>' +
            '<div class="eg-level"><b>' + L[1] + '</b> <span lang="ar">' + L[2] + '</span> · ' + L[3] + '</div>' +
            '<div class="eg-bar"><i style="width:' + Math.round(lvPct * 100) + '%"></i></div>' +
            '<div class="eg-sub">' + (N ? (N[0] - X.total) + ' XP to ' + N[1] : 'Top level reached') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="eg-msg">' + (pct >= 1 ? "🎯 Daily goal done. Anything more is a bonus!" : profile.lastDay === DAY() ? "Streak safe today ✓ · " + (X.goal - t) + " XP to your goal" : streak ? "Practise today to keep your 🔥 " + streak + "-day streak" : "Start your streak today: one activity is enough") + '</div>' +
        '<button type="button" class="btn eg-go" id="egGo">▶ ' + step.label + '</button>' +
        week() +
        '<details class="eg-more"><summary>🏅 Badges ' + got.length + '/' + BADGES.length + ' · settings</summary>' +
          '<div class="eg-badges">' + BADGES.map(function (b) { return '<div class="eg-badge' + (X.badges[b[0]] ? "" : " locked") + '" title="' + b[3] + '"><span>' + b[1] + '</span><small>' + b[2] + '</small></div>'; }).join("") + '</div>' +
          '<div class="eg-set"><label>Daily goal <select id="egGoal"><option value="20">Easy · 20 XP (~3 min)</option><option value="50">Regular · 50 XP (~7 min)</option><option value="100">Serious · 100 XP (~15 min)</option><option value="200">Intense · 200 XP (~30 min)</option></select></label>' +
          '<label class="eg-check"><input type="checkbox" id="egMute"' + (X.muted ? " checked" : "") + '> Mute sounds</label>' +
          '<button type="button" class="btn ghost small" id="egShare">Share my progress 📤</button></div>' +
        '</details>';
      var g = $("egGoal"); g.value = String(X.goal);
      g.onchange = function () { X.goal = +g.value || 50; persist(); render(); };
      $("egMute").onchange = function (e) { X.muted = e.target.checked; persist(); };
      $("egShare").onclick = function () { share("I'm learning Saudi Arabic on Arabic Coach: level " + L[1] + ", " + X.total + " XP, 🔥 " + streak + "-day streak."); };
      $("egGo").onclick = function () {
        try { showTab(step.tab); } catch (e) {}
        if (step.go) setTimeout(step.go, 50);
        var tabsEl = $("tabs"); if (tabsEl) tabsEl.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    } finally { rendering = false; }
  }

  /* ---------- styles ---------- */
  var css = document.createElement("style");
  css.textContent = [
    ".eg-card{gap:12px;border:2px solid var(--accent-soft)}",
    ".eg-sami{display:flex;align-items:flex-end;gap:10px}",
    ".eg-sami-svg{flex:none;animation:egbob 3s ease-in-out infinite;transform-origin:50% 100%}",
    ".eg-sami .eg-eyes{animation:egblink 4.5s infinite;transform-origin:60px 55px}",
    ".eg-sami .eg-arm{transform-origin:96px 112px;animation:egwave 2.6s ease-in-out 1}",
    ".eg-sami.cheer .eg-sami-svg{animation:egjump .7s ease-out}.eg-sami.cheer .eg-arm{animation:egwave .7s ease-in-out 2}",
    ".eg-sami.sad .eg-sami-svg{animation:egtilt .8s ease-in-out}",
    ".eg-say{position:relative;background:var(--accent-soft);border-radius:16px 16px 16px 4px;padding:9px 12px;font-size:.95rem;line-height:1.35;margin-bottom:22px}",
    ".eg-say b{color:var(--accent);margin-right:4px}.eg-say.pop{animation:egpop .35s}",
    "@keyframes egbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
    "@keyframes egblink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}",
    "@keyframes egwave{0%,100%{transform:rotate(0)}25%{transform:rotate(-18deg)}75%{transform:rotate(12deg)}}",
    "@keyframes egjump{0%{transform:translateY(0)}35%{transform:translateY(-14px) scale(1.04)}70%{transform:translateY(0) scale(.98,1.02)}100%{transform:none}}",
    "@keyframes egtilt{0%,100%{transform:rotate(0)}30%{transform:rotate(-6deg)}60%{transform:rotate(4deg)}}",
    ".eg-top{display:flex;gap:14px;align-items:center}",
    ".eg-ring{position:relative;width:84px;height:84px;flex:none}",
    ".eg-ring-txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}",
    ".eg-ring-txt b{font-size:1.35rem}.eg-ring-txt span{font-size:.72rem;color:var(--muted)}",
    ".eg-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
    ".eg-line{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".eg-flame{font-weight:700;font-size:1.15rem;filter:grayscale(1);opacity:.6}.eg-flame.lit{filter:none;opacity:1;animation:egpop .6s}",
    ".eg-pill{background:var(--chip);border-radius:99px;padding:1px 9px;font-size:.85rem}",
    ".eg-level{font-size:.95rem}.eg-level span{font-family:var(--arabic);color:var(--accent)}",
    ".eg-bar{height:8px;background:var(--chip);border-radius:99px;overflow:hidden}.eg-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--gold));transition:width .6s}",
    ".eg-sub{font-size:.78rem;color:var(--muted)}",
    ".eg-msg{font-size:.95rem}",
    ".eg-go{width:100%;font-size:1.05rem;padding:14px;animation:egpulse 2.4s infinite}",
    ".eg-week{display:flex;justify-content:space-between;align-items:flex-end;height:64px;padding:0 4px}",
    ".eg-day{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:.7rem;color:var(--muted)}",
    ".eg-day i{display:block;width:18px;border-radius:5px;background:var(--line)}.eg-day i.hit{background:var(--accent)}.eg-day.today span{color:var(--ink);font-weight:700}",
    ".eg-more summary{cursor:pointer;color:var(--muted);font-size:.9rem}",
    ".eg-badges{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}",
    ".eg-badge{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;background:var(--chip);border-radius:12px;padding:8px 4px}.eg-badge span{font-size:1.5rem}.eg-badge small{font-size:.68rem;line-height:1.2}",
    ".eg-badge.locked{opacity:.35;filter:grayscale(1)}",
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
    "@media (prefers-reduced-motion:reduce){.eg-go,.eg-flame.lit,.eg-sheet,.eg-toast,.eg-sami-svg,.eg-sami *{animation:none!important}}",
  ].join("\n");
  document.head.append(css);

  install();
  // The coach page renders its data a moment after loading; draw the Today card when it does, and once a second for the first few seconds as a fallback.
  var tries = 0, iv = setInterval(function () { render(); if (++tries > 8) clearInterval(iv); }, 1000);
  window.egAward = award; // for testing and future features
})();
