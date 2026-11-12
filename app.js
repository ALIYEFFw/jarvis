// ============================================================
//  JARVIS — brauzer tərəfi
//  Giriş, söhbət, səsli danışıq, kod blokları, tapşırıqlar, xatırlatmalar.
// ============================================================

const CFG = Object.assign(
  { SUPABASE_URL: "", SUPABASE_KEY: "", FUNCTION_NAME: "jarvis", ASSISTANT_NAME: "JARVIS", USER_NAME: "", CITY: "Baku" },
  window.JARVIS_CONFIG || {},
);
const CONFIGURED =
  /^https:\/\//.test(CFG.SUPABASE_URL) &&
  !/SENIN-LAYIHEN/i.test(CFG.SUPABASE_URL) &&
  !!CFG.SUPABASE_KEY &&
  !/BURAYA/i.test(CFG.SUPABASE_KEY);
const FORCE_DEMO = new URLSearchParams(location.search).has("demo");
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Baku";

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';

// ------------------------------------------------------------
//  Ayarlar (bu brauzerdə saxlanılır)
// ------------------------------------------------------------
const settings = Object.assign(
  { mode: "smart", voiceOn: true, handsFree: false, voiceURI: "", lang: "az-AZ", rate: 1 },
  readStore("jarvis.settings") || {},
);
function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("jarvis.settings", JSON.stringify(settings));
  } catch { /* yaddaş bağlıdır */ }
}

// ------------------------------------------------------------
//  Nüvə animasiyası (canvas)
// ------------------------------------------------------------
class Core {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.energy = 0;
    this.running = true;
    this.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    this.colors = { accent: v("--accent"), ok: v("--ok"), warm: v("--warm"), danger: v("--danger"), line: v("--line-strong") };
    this.t0 = performance.now();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.max(1, Math.round(r.width * this.dpr));
    this.c.height = Math.max(1, Math.round(r.height * this.dpr));
  }
  setState(s) { this.state = s; }
  pulse(v = 1) { this.energy = Math.min(1.4, this.energy + v); }
  stop() { this.running = false; }
  loop(now) {
    if (!this.running) return;
    this.draw((now - this.t0) / 1000);
    requestAnimationFrame(this.loop);
  }
  draw(t) {
    const { ctx, dpr } = this;
    const w = this.c.width, hgt = this.c.height;
    ctx.clearRect(0, 0, w, hgt);
    const cx = w / 2, cy = hgt / 2, R = Math.min(w, hgt) / 2 - 2 * dpr;
    const s = this.state;
    const col = s === "listening" ? this.colors.ok
      : s === "thinking" || s === "speaking" ? this.colors.warm
      : s === "error" ? this.colors.danger : this.colors.accent;
    const k = this.reduce ? 0.15 : 1;
    const spin = (s === "thinking" ? 1.8 : s === "listening" ? 0.7 : 0.25) * k;
    this.energy *= 0.9;
    let amp;
    if (s === "speaking") amp = 0.05 + this.energy * 0.1 + 0.03 * Math.abs(Math.sin(t * 7)) * k;
    else if (s === "listening") amp = 0.04 + 0.03 * Math.sin(t * 3) * k;
    else if (s === "thinking") amp = 0.025;
    else amp = 0.012 + 0.006 * Math.sin(t * 1.2) * k;
    const TAU = Math.PI * 2;

    // 1) xarici bölgü halqası
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.05 * spin);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const long = i % 10 === 0;
      const r1 = R * (long ? 0.86 : 0.905), r2 = R * 0.95;
      ctx.strokeStyle = long ? rgba(col, 0.85) : rgba(this.colors.line, 0.9);
      ctx.lineWidth = (long ? 1.6 : 1) * dpr;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();

    // 2) fırlanan seqmentlər
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.45 * spin);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = rgba(col, 0.85);
    for (let i = 0; i < 5; i++) {
      const start = (i / 5) * TAU + 0.12;
      const len = TAU / 5 - 0.35 - (i % 2) * 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.78, start, start + len);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.7, 0, TAU);
    ctx.strokeStyle = rgba(col, 0.22);
    ctx.lineWidth = dpr;
    ctx.stroke();

    // 3) dalğa halqası
    const base = R * 0.56;
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * TAU;
      const n = Math.sin(a * 6 + t * 2.2) * 0.5 + Math.sin(a * 11 - t * 3.1) * 0.3 + Math.sin(a * 3 + t * 1.3) * 0.2;
      const r = base * (1 + amp * n);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(col, 0.95);
    ctx.lineWidth = 1.6 * dpr;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14 * dpr;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 4) parlayan mərkəz
    const coreR = R * (0.3 + amp * 0.7);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.5);
    g.addColorStop(0, rgba(col, 0.95));
    g.addColorStop(0.35, rgba(col, 0.32));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.38, 0, TAU);
    ctx.fillStyle = "rgba(236, 250, 255, 0.9)";
    ctx.fill();
  }
}
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(79,209,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ------------------------------------------------------------
//  Elementlər və ümumi vəziyyət
// ------------------------------------------------------------
const el = {
  app: $("#app"), gate: $("#gate"), gateTitle: $("#gateTitle"), gateSub: $("#gateSub"),
  loginForm: $("#loginForm"), loginEmail: $("#loginEmail"), loginPass: $("#loginPass"),
  loginBtn: $("#loginBtn"), loginError: $("#loginError"), setupBox: $("#setupBox"), demoBtn: $("#demoBtn"),
  brandName: $("#brandName"), brandSub: $(".brand-sub"), chip: $("#statusChip"),
  clockTime: $("#clockTime"), clockDate: $("#clockDate"), caption: $("#stageCaption"),
  log: $("#log"), composer: $("#composer"), input: $("#input"), micBtn: $("#micBtn"),
  sendBtn: $("#sendBtn"), stopBtn: $("#stopBtn"), attachBtn: $("#attachBtn"), fileInput: $("#fileInput"),
  attachments: $("#attachments"), side: $("#side"), sideBackdrop: $("#sideBackdrop"), panelToggle: $("#panelToggle"),
  taskForm: $("#taskForm"), taskInput: $("#taskInput"), taskDue: $("#taskDue"), taskList: $("#taskList"),
  taskCount: $("#taskCount"), modeGroup: $("#modeGroup"), optVoice: $("#optVoice"), optHands: $("#optHands"),
  optVoiceName: $("#optVoiceName"), optLang: $("#optLang"), optRate: $("#optRate"), rateOut: $("#rateOut"),
  sysList: $("#sysList"), notifyBtn: $("#notifyBtn"), clearWrap: $("#clearWrap"), logoutBtn: $("#logoutBtn"),
};

let backend = null;
let core = null;
let gateCore = null;
let busy = false;
let ctl = null;
let tasks = [];
let pendingImages = [];
let uiState = "idle";
let claudeStatus = { text: "gözləyir", cls: "" };
let accountEmail = "";

const STATE_LABEL = { idle: "HAZIR", listening: "DİNLƏYİRƏM", thinking: "DÜŞÜNÜRƏM", speaking: "DANIŞIRAM", error: "XƏTA" };
const STATE_CAPTION = {
  idle: "Yaz və ya mikrofona toxun",
  listening: "Dinləyirəm…",
  thinking: "Düşünürəm…",
  speaking: "Danışıram · Esc — dayandır",
  error: "Xəta baş verdi",
};
const TOOL_LABEL = {
  get_weather: "Hava məlumatı alınır",
  list_tasks: "Tapşırıqlara baxılır",
  add_task: "Tapşırıq yazılır",
  complete_task: "Tapşırıq yenilənir",
  delete_task: "Tapşırıq silinir",
  web_search: "İnternetdə axtarılır",
};

function setState(s, caption) {
  uiState = s;
  el.chip.dataset.state = s;
  el.chip.textContent = STATE_LABEL[s] || s.toUpperCase();
  core?.setState(s);
  el.caption.textContent = caption ?? STATE_CAPTION[s] ?? "";
  refreshControls();
}
function flashError(msg) {
  setState("error", msg);
  setTimeout(() => { if (uiState === "error") setState("idle"); }, 4000);
}

// ------------------------------------------------------------
//  Backend: real (Supabase) və demo
// ------------------------------------------------------------
async function createRealBackend() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (!error) return;
      const m = error.message || "";
      if (/invalid login/i.test(m)) throw new Error("E-poçt və ya şifrə yanlışdır.");
      if (/not confirmed/i.test(m)) throw new Error("E-poçt təsdiqlənməyib. Supabase-də istifadəçini “Auto Confirm” ilə yarat.");
      throw new Error(m);
    },
    async signOut() { await sb.auth.signOut(); },
    onSignedOut(cb) {
      sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") cb(); });
    },
    async history(limit = 40) {
      const rows = must(await sb.from("messages").select("id, role, content, created_at").order("id", { ascending: false }).limit(limit));
      return rows.reverse();
    },
    async clearHistory() {
      const s = await this.session();
      if (!s) throw new Error("Sessiya bitib.");
      must(await sb.from("messages").delete().eq("user_id", s.user.id));
    },
    tasks: {
      async list() {
        return must(
          await sb.from("tasks").select("id, title, due_at, done, notified")
            .order("done").order("due_at", { ascending: true, nullsFirst: false }).order("id").limit(100),
        );
      },
      async add(title, due_at) { must(await sb.from("tasks").insert({ title, due_at })); },
      async update(id, patch) { must(await sb.from("tasks").update(patch).eq("id", id)); },
      async remove(id) { must(await sb.from("tasks").delete().eq("id", id)); },
    },
    async chat(payload, { signal, onEvent }) {
      const s = await this.session();
      if (!s) throw new Error("Sessiya bitib, səhifəni yenilə və yenidən daxil ol.");
      const res = await fetch(`${CFG.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${CFG.FUNCTION_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}`, apikey: CFG.SUPABASE_KEY },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        let msg = `Server xətası (${res.status}).`;
        try {
          const j = await res.json();
          msg = j.error || j.message || j.msg || msg;
        } catch { /* JSON deyil */ }
        if (res.status === 404) msg = `“${CFG.FUNCTION_NAME}” funksiyası tapılmadı. Edge Function yerləşdirilib?`;
        if (res.status === 401 && !/Giriş|Sessiya/.test(msg)) msg += " Yenidən daxil olmağa çalış.";
        throw new Error(msg);
      }
      await readSSE(res.body, onEvent);
    },
  };
}

async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        onEvent(ev);
      }
    }
  }
}

function createDemoBackend() {
  const at = (days, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  let nextId = 4;
  const list = [
    { id: 1, title: "İmtahana hazırlaş (nümunə)", due_at: at(1, 10), done: false, notified: false },
    { id: 2, title: "Layihə hesabatını göndər (nümunə)", due_at: null, done: false, notified: false },
    { id: 3, title: "Kitabxanaya kitabı qaytar (nümunə)", due_at: null, done: true, notified: false },
  ];
  const DEMO_CODE = [
    "Budur sadə kalkulyator:",
    "",
    "```python",
    "def hesabla(a, op, b):",
    '    if op == "+": return a + b',
    '    if op == "-": return a - b',
    '    if op == "*": return a * b',
    '    if op == "/":',
    '        return "Sıfıra bölmək olmaz" if b == 0 else a / b',
    '    return "Naməlum əməliyyat"',
    "",
    'a = float(input("Birinci ədəd: "))',
    'op = input("Əməliyyat (+ - * /): ")',
    'b = float(input("İkinci ədəd: "))',
    'print("Nəticə:", hesabla(a, op, b))',
    "```",
    "",
    "Faylı `kalkulyator.py` kimi saxla və `python kalkulyator.py` ilə işə sal. _(Bu, demo cavabdır.)_",
  ].join("\n");

  return {
    demo: true,
    async history() { return []; },
    async clearHistory() {},
    tasks: {
      async list() {
        return [...list].sort((a, b) => a.done - b.done || (a.due_at ? 0 : 1) - (b.due_at ? 0 : 1) || a.id - b.id);
      },
      async add(title, due_at) { list.push({ id: nextId++, title, due_at, done: false, notified: false }); },
      async update(id, patch) { Object.assign(list.find((t) => t.id === id) || {}, patch); },
      async remove(id) { const i = list.findIndex((t) => t.id === id); if (i >= 0) list.splice(i, 1); },
    },
    async chat(payload, { signal, onEvent }) {
      const wait = (ms) => new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      const q = payload.message.toLowerCase();
      let reply;
      let tasksChanged = false;
      await wait(700);
      if (/hava|weather/.test(q)) {
        onEvent({ type: "tool", name: "get_weather", input: { city: CFG.CITY } });
        await wait(800);
        reply = "Demo rejimdə real hava məlumatı yoxdur. Gemini qoşulandan sonra burada canlı temperatur, külək və üç günlük proqnoz olacaq.";
      } else if (/kod|code|python|kalkulyator|javascript|html/.test(q)) {
        reply = DEMO_CODE;
      } else if (/xatırlat|tapşırıq|remind/.test(q)) {
        onEvent({ type: "tool", name: "add_task", input: {} });
        await wait(500);
        const title = payload.message.replace(/xatırlat\.?/i, "").trim() || "Yeni tapşırıq";
        list.push({ id: nextId++, title, due_at: /sabah/i.test(q) ? at(1, 10) : null, done: false, notified: false });
        tasksChanged = true;
        reply = `Yazdım: “${title}”. Demo rejimdə tapşırıq yalnız bu səhifə açıq olduqca qalır.`;
      } else {
        reply = "Demo rejimdəyəm, Gemini hələ qoşulmayıb. config.js faylını doldurub Supabase funksiyasını yerləşdirəndən sonra istənilən suala real cavab verəcəyəm.";
      }
      for (let i = 0; i < reply.length; i += 4) {
        await wait(14);
        onEvent({ type: "text", text: reply.slice(i, i + 4) });
      }
      onEvent({ type: "done", tasksChanged, model: "demo" });
    },
  };
}

// ------------------------------------------------------------
//  Səs: danışığı tanıma (mikrofon)
// ------------------------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const Listener = {
  supported: !!SR,
  rec: null,
  active: false,
  base: "",
  finalText: "",
  error: null,
  cancelled: false,
  start() {
    if (!this.supported || this.active || busy) return;
    Voice.stop(true);
    const rec = new SR();
    rec.lang = settings.lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    this.base = el.input.value.trim();
    this.finalText = "";
    this.error = null;
    this.cancelled = false;
    this.rec = rec;
    this.active = true;

    rec.onstart = () => {
      el.micBtn.setAttribute("aria-pressed", "true");
      setState("listening");
    };
    rec.onresult = (e) => {
      let fin = "", interim = "";
      for (const r of e.results) {
        if (r.isFinal) fin += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.finalText = fin;
      const spoken = `${fin} ${interim}`.trim();
      el.input.value = [this.base, spoken].filter(Boolean).join(" ");
      el.input.classList.toggle("interim", !!interim);
      autoGrow();
    };
    rec.onerror = (e) => { this.error = e.error; };
    rec.onend = () => {
      this.active = false;
      this.rec = null;
      el.micBtn.setAttribute("aria-pressed", "false");
      el.input.classList.remove("interim");
      const err = this.error;
      if (err && err !== "aborted" && err !== "no-speech") {
        flashError(SPEECH_ERRORS[err] || `Səs tanıma xətası: ${err}`);
        return;
      }
      if (!this.cancelled && this.finalText.trim()) {
        send(el.input.value);
      } else if (!busy && uiState === "listening") {
        setState("idle", err === "no-speech" ? "Səs eşidilmədi" : undefined);
      }
    };
    try {
      rec.start();
    } catch (e) {
      this.active = false;
      flashError("Mikrofonu açmaq olmadı.");
    }
  },
  stop() { this.rec?.stop(); },
  cancel() {
    this.cancelled = true;
    this.rec?.abort();
  },
};
const SPEECH_ERRORS = {
  "not-allowed": "Mikrofona icazə verilmədi. Ünvan sətrindəki kilid nişanından icazə ver.",
  "service-not-allowed": "Bu brauzer səs tanımaya icazə vermir. Chrome və ya Edge istifadə et.",
  "audio-capture": "Mikrofon tapılmadı.",
  network: "Səs tanıma xidmətinə qoşulmaq olmadı. İnterneti yoxla.",
  "language-not-supported": "Bu brauzer seçilmiş dili tanımır. Paneldə başqa danışıq dili seç.",
};

// ------------------------------------------------------------
//  Səs: cavabları oxuma (TTS)
// ------------------------------------------------------------
const Voice = {
  supported: "speechSynthesis" in window,
  voices: [],
  speaking: false,
  onDone: null,
  token: 0,
  init() {
    if (!this.supported) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices();
      fillVoiceSelect();
      updateSys();
    };
    load();
    speechSynthesis.addEventListener?.("voiceschanged", load);
  },
  pick() {
    const v = this.voices;
    if (settings.voiceURI) {
      const f = v.find((x) => x.voiceURI === settings.voiceURI);
      if (f) return f;
    }
    return v.find((x) => /^az/i.test(x.lang)) || v.find((x) => /^tr/i.test(x.lang)) || v.find((x) => x.default) || v[0] || null;
  },
  speak(text, onDone) {
    if (!this.supported) { onDone?.(); return; }
    this.stop(true);
    const chunks = splitForSpeech(toSpeech(text));
    if (!chunks.length) { onDone?.(); return; }
    const voice = this.pick();
    const my = ++this.token;
    this.speaking = true;
    this.onDone = onDone || null;
    setState("speaking");
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "az-AZ"; }
      u.rate = settings.rate;
      u.onstart = () => core?.pulse(0.6);
      u.onboundary = () => core?.pulse(0.45);
      if (i === chunks.length - 1) u.onend = () => { if (my === this.token) this.finish(); };
      u.onerror = (e) => {
        if (my !== this.token || e.error === "interrupted" || e.error === "canceled") return;
        if (i === chunks.length - 1 || e.error === "not-allowed") this.finish();
      };
      speechSynthesis.speak(u);
    });
  },
  finish() {
    this.speaking = false;
    const cb = this.onDone;
    this.onDone = null;
    if (!busy && !Listener.active) setState("idle");
    cb?.();
  },
  stop(silent) {
    if (!this.supported) return;
    this.token++;
    const was = this.speaking;
    this.speaking = false;
    this.onDone = null;
    speechSynthesis.cancel();
    if (was && !silent && !busy && !Listener.active) setState("idle");
    refreshControls();
  },
};

function toSpeech(md) {
  let t = String(md)
    .replace(/```[\s\S]*?(```|$)/g, " Kodu ekranda göstərdim. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "keçid")
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, "")
    .replace(/[|#>*_~]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 1200) {
    const cut = t.slice(0, 1200);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = `${end > 400 ? cut.slice(0, end + 1) : cut} Qalanını ekranda oxuya bilərsən.`;
  }
  return t;
}
function splitForSpeech(text) {
  const out = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?…])\s+/)) {
    const parts = s.length > 200 ? s.split(/(?<=[,;:])\s+/) : [s];
    for (const p of parts) {
      if ((cur + " " + p).trim().length > 200 && cur) {
        out.push(cur.trim());
        cur = p;
      } else cur = `${cur} ${p}`;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ------------------------------------------------------------
//  Söhbət jurnalı
// ------------------------------------------------------------
const timeFmt = new Intl.DateTimeFormat("az", { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtTime = (d) => timeFmt.format(d ? new Date(d) : new Date());

function nearBottom() {
  return el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 140;
}
function scrollDown(force) {
  if (force || nearBottom()) el.log.scrollTop = el.log.scrollHeight;
}
function hideWelcome() { $(".welcome", el.log)?.remove(); }

function showWelcome() {
  const w = h("div", "welcome");
  w.append(h("h1", null, `Salam${CFG.USER_NAME ? `, ${CFG.USER_NAME}` : ""}.`));
  w.append(
    h("p", null, backend?.demo
      ? "Demo rejimdəsən: cavablar nümunədir, Gemini hələ qoşulmayıb. Quraşdırma addımları README faylındadır."
      : "Bütün sistemlər işləkdir. Mənə yaz və ya mikrofona toxunub danış: kod yazdıra, hava soruşa, xatırlatma qoya bilərsən."),
  );
  const chips = h("div", "chips");
  for (const s of ["Bu gün Bakıda hava necədir?", "Python-da sadə kalkulyator yaz", "Sabah saat 10-da imtahanı xatırlat", "Bu həftə hansı tapşırıqlarım var?"]) {
    const b = h("button", "chip", s);
    b.type = "button";
    b.dataset.say = s;
    chips.append(b);
  }
  w.append(chips);
  el.log.append(w);
}

function addUser(text, imgUrls = [], time) {
  hideWelcome();
  const m = h("div", "msg user");
  const meta = h("div", "msg-meta", "Sən ");
  meta.append(h("time", null, fmtTime(time)));
  const bubble = h("div", "bubble");
  if (imgUrls.length) {
    const box = h("div", "bubble-imgs");
    for (const u of imgUrls) {
      const img = h("img");
      img.src = u;
      img.alt = "Əlavə edilmiş şəkil";
      box.append(img);
    }
    bubble.append(box);
  }
  bubble.append(document.createTextNode(text || ""));
  m.append(meta, bubble);
  el.log.append(m);
  scrollDown(true);
}

function addBot(time, kind = "bot", label = CFG.ASSISTANT_NAME) {
  hideWelcome();
  const m = h("div", `msg ${kind}`);
  const meta = h("div", "msg-meta", `${label} `);
  meta.append(h("time", null, fmtTime(time)));
  const tools = h("div", "tools");
  const body = h("div", "body");
  m.append(meta, tools, body);
  el.log.append(m);
  scrollDown(true);
  return { el: m, body, tools };
}

function thinkingDots() {
  const d = h("span", "thinking-dots");
  d.setAttribute("aria-label", "Düşünür");
  d.append(h("i"), h("i"), h("i"));
  return d;
}

function renderMarkdown(target, text, final) {
  if (window.marked && window.DOMPurify) {
    target.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text));
  } else {
    target.textContent = text;
    target.style.whiteSpace = "pre-wrap";
  }
  target.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  enhanceCode(target, final);
  if (!final) target.lastElementChild?.classList.add("cursor");
}

function enhanceCode(root, final) {
  root.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (pre.parentElement?.classList.contains("code")) return;
    const lang = (code.className.match(/language-([\w+#.-]+)/) || [])[1] || "";
    const wrap = h("div", "code");
    const head = h("div", "code-head");
    head.append(h("span", "code-lang", lang || "kod"));
    const actions = h("div", "code-actions");
    for (const [act, label] of [["copy", "Kopyala"], ["download", "Yüklə"]]) {
      const b = h("button", null, label);
      b.type = "button";
      b.dataset.act = act;
      b.dataset.lang = lang;
      actions.append(b);
    }
    head.append(actions);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
    if (final && window.hljs) {
      try { window.hljs.highlightElement(code); } catch { /* rəngləmə alınmadı */ }
    }
  });
}

const EXT = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", html: "html", css: "css",
  json: "json", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", bash: "sh", sh: "sh",
  shell: "sh", sql: "sql", go: "go", rust: "rs", php: "php", kotlin: "kt", swift: "swift", jsx: "jsx", tsx: "tsx",
  markdown: "md", md: "md", yaml: "yml", yml: "yml", xml: "xml",
};

function addToolLine(view, ev) {
  const extra = ev.input?.city || ev.input?.query || ev.input?.title || "";
  view.tools.append(h("p", "tool-line", `${TOOL_LABEL[ev.name] || ev.name}${extra ? `: ${extra}` : ""}`));
  scrollDown();
}
function addNote(view, text) { view.el.append(h("p", "note", text)); scrollDown(); }
function addError(view, text) { view.el.append(h("div", "err-box", text)); scrollDown(); }

// ------------------------------------------------------------
//  Mesaj göndərmək
// ------------------------------------------------------------
async function send(raw) {
  const text = String(raw ?? el.input.value).trim();
  if (busy || (!text && !pendingImages.length)) return;
  if (Listener.active) Listener.cancel();
  Voice.stop(true);

  busy = true;
  const imgs = pendingImages.splice(0);
  renderAttachments();
  el.input.value = "";
  autoGrow();
  addUser(text, imgs.map((i) => i.url));
  const view = addBot(new Date());
  view.body.append(thinkingDots());
  setState("thinking");

  ctl = new AbortController();
  let full = "";
  let failed = false;
  let aborted = false;
  let tasksChanged = false;
  let pending = false;
  const paint = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (busy) {
        renderMarkdown(view.body, full, false);
        scrollDown();
      }
    });
  };

  try {
    await backend.chat(
      {
        message: text,
        images: imgs.map(({ media_type, data }) => ({ media_type, data })),
        mode: settings.mode,
        userName: CFG.USER_NAME,
        assistantName: CFG.ASSISTANT_NAME,
        timezone: TZ,
        city: CFG.CITY,
      },
      {
        signal: ctl.signal,
        onEvent(ev) {
          if (ev.type === "text") {
            if (!full) setState("thinking", "Cavab yazılır…");
            full += ev.text;
            paint();
          } else if (ev.type === "tool") {
            addToolLine(view, ev);
            el.caption.textContent = `${TOOL_LABEL[ev.name] || ev.name}…`;
          } else if (ev.type === "notice") {
            addNote(view, ev.message);
          } else if (ev.type === "error") {
            failed = true;
            tasksChanged ||= !!ev.tasksChanged;
            addError(view, ev.message);
          } else if (ev.type === "done") {
            tasksChanged ||= !!ev.tasksChanged;
            claudeStatus = backend.demo ? { text: "demo", cls: "warn" } : { text: ev.model || "qoşulub", cls: "ok" };
          }
        },
      },
    );
  } catch (e) {
    if (e?.name === "AbortError") {
      aborted = true;
      addNote(view, "Dayandırıldı.");
    } else {
      failed = true;
      addError(view, e?.message || String(e));
      if (!backend.demo) claudeStatus = { text: "xəta", cls: "bad" };
    }
  } finally {
    ctl = null;
    busy = false;
    if (full) renderMarkdown(view.body, full, true);
    else view.body.replaceChildren();
    scrollDown();
    updateSys();
    if (tasksChanged) refreshTasks();
  }

  if (aborted) return setState("idle");
  if (failed && !full) return flashError("Cavab alınmadı");
  if (full && settings.voiceOn && Voice.supported) Voice.speak(full, afterReply);
  else {
    setState("idle");
    afterReply();
  }
}

function afterReply() {
  if (settings.handsFree && Listener.supported && !busy) setTimeout(() => Listener.start(), 300);
}

function stopAll() {
  ctl?.abort();
  Voice.stop();
  if (Listener.active) Listener.cancel();
}

function refreshControls() {
  const showStop = busy || Voice.speaking;
  el.sendBtn.hidden = showStop;
  el.stopBtn.hidden = !showStop;
  el.micBtn.disabled = !Listener.supported || (busy && !Listener.active);
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 180)}px`;
}

// Şəkillər
async function prepImage(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return { url, media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}
async function addFiles(files) {
  for (const f of files) {
    if (pendingImages.length >= 3) break;
    if (!/^image\//.test(f.type)) continue;
    try { pendingImages.push(await prepImage(f)); } catch { flashError("Şəkli oxumaq olmadı."); }
  }
  renderAttachments();
}
function renderAttachments() {
  el.attachments.replaceChildren();
  el.attachments.hidden = !pendingImages.length;
  pendingImages.forEach((p, i) => {
    const a = h("div", "att");
    const img = h("img");
    img.src = p.url;
    img.alt = "Göndəriləcək şəkil";
    const x = h("button", null, "×");
    x.type = "button";
    x.setAttribute("aria-label", "Şəkli sil");
    x.onclick = () => { pendingImages.splice(i, 1); renderAttachments(); };
    a.append(img, x);
    el.attachments.append(a);
  });
}

// ------------------------------------------------------------
//  Tapşırıqlar və xatırlatmalar
// ------------------------------------------------------------
const AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const AZ_DAYS = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];
function fmtDue(iso) {
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  const prefix = diff === 0 ? "Bu gün" : diff === 1 ? "Sabah" : diff === -1 ? "Dünən" : `${d.getDate()} ${AZ_MONTHS[d.getMonth()].slice(0, 3)}`;
  return `${prefix}, ${timeFmt.format(d)}`;
}

async function refreshTasks() {
  try {
    tasks = await backend.tasks.list();
    renderTasks();
    checkReminders();
  } catch (e) {
    el.taskList.replaceChildren(h("li", "tasks-empty", `Tapşırıqlar yüklənmədi: ${e.message}`));
  }
}

function renderTasks() {
  el.taskList.replaceChildren();
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done).slice(0, 8);
  el.taskCount.textContent = String(open.length);
  if (!tasks.length) {
    el.taskList.append(h("li", "tasks-empty", "Hələ tapşırıq yoxdur."));
    return;
  }
  for (const t of [...open, ...done]) {
    const li = h("li", `task${t.done ? " done" : ""}`);
    const cb = h("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.setAttribute("aria-label", "Tamamlandı");
    cb.onchange = async () => {
      try {
        await backend.tasks.update(t.id, { done: cb.checked });
        refreshTasks();
      } catch (e) { flashError(e.message); }
    };
    const info = h("div");
    info.append(h("span", "task-title", t.title));
    if (t.due_at) {
      const overdue = !t.done && new Date(t.due_at) < new Date();
      info.append(h("span", `task-due${overdue ? " overdue" : ""}`, fmtDue(t.due_at)));
    }
    const del = h("button", "task-del");
    del.type = "button";
    del.setAttribute("aria-label", "Sil");
    del.innerHTML = ICON_TRASH;
    del.onclick = async () => {
      try {
        await backend.tasks.remove(t.id);
        refreshTasks();
      } catch (e) { flashError(e.message); }
    };
    li.append(cb, info, del);
    el.taskList.append(li);
  }
}

function checkReminders() {
  const now = Date.now();
  for (const t of tasks) {
    if (t.done || t.notified || !t.due_at || new Date(t.due_at).getTime() > now) continue;
    t.notified = true;
    backend.tasks.update(t.id, { notified: true }).catch(() => {});
    const v = addBot(t.due_at, "reminder", "Xatırlatma");
    v.body.textContent = t.title;
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification(`${CFG.ASSISTANT_NAME}: xatırlatma`, { body: t.title }); } catch { /* bildiriş alınmadı */ }
    }
    if (settings.voiceOn && !busy && !Listener.active) Voice.speak(`Xatırlatma: ${t.title}`);
  }
  renderTasks();
}

// ------------------------------------------------------------
//  Panel: rejim, səs, sistem
// ------------------------------------------------------------
function fillVoiceSelect() {
  const sel = el.optVoiceName;
  sel.replaceChildren();
  const auto = h("option", null, "Avtomatik (az → tr)");
  auto.value = "";
  sel.append(auto);
  const sorted = [...Voice.voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  for (const v of sorted) {
    const o = h("option", null, `${v.name} · ${v.lang}`);
    o.value = v.voiceURI;
    sel.append(o);
  }
  sel.value = settings.voiceURI && Voice.voices.some((v) => v.voiceURI === settings.voiceURI) ? settings.voiceURI : "";
  function rank(v) { return /^az/i.test(v.lang) ? 0 : /^tr/i.test(v.lang) ? 1 : /^(en|ru)/i.test(v.lang) ? 2 : 3; }
}

function updateSys() {
  const rows = [];
  rows.push(["Gemini", claudeStatus.text, claudeStatus.cls]);
  rows.push(["Mikrofon", Listener.supported ? "dəstəklənir" : "bu brauzerdə yoxdur", Listener.supported ? "ok" : "warn"]);
  if (Voice.supported) {
    const az = Voice.voices.some((v) => /^az/i.test(v.lang));
    rows.push(["Səs", az ? "azərbaycan səsi var" : `${Voice.voices.length} səs, az yoxdur`, az ? "ok" : "warn"]);
  } else rows.push(["Səs", "dəstəklənmir", "bad"]);
  if ("Notification" in window) {
    const p = Notification.permission;
    rows.push(["Bildirişlər", p === "granted" ? "açıq" : p === "denied" ? "bağlı" : "soruşulmayıb", p === "granted" ? "ok" : p === "denied" ? "bad" : ""]);
    el.notifyBtn.hidden = p !== "default";
  } else el.notifyBtn.hidden = true;
  rows.push(["Hesab", backend?.demo ? "demo" : accountEmail || "—", ""]);
  el.sysList.replaceChildren();
  for (const [k, v, cls] of rows) {
    el.sysList.append(h("dt", null, k));
    el.sysList.append(h("dd", cls || null, v));
  }
}

function syncModeButtons() {
  for (const b of el.modeGroup.querySelectorAll("button")) {
    b.setAttribute("aria-checked", String(b.dataset.mode === settings.mode));
  }
}

function resetClearButton() {
  el.clearWrap.replaceChildren();
  const b = h("button", "btn small ghost", "Söhbəti təmizlə");
  b.type = "button";
  b.onclick = askClear;
  el.clearWrap.append(b);
}
function askClear() {
  el.clearWrap.replaceChildren();
  const yes = h("button", "btn small danger", "Bəli, sil");
  const no = h("button", "btn small ghost", "Xeyr");
  yes.type = no.type = "button";
  el.clearWrap.append(h("span", "confirm-q", "Bütün söhbət silinsin?"), yes, no);
  no.onclick = resetClearButton;
  yes.onclick = async () => {
    try {
      await backend.clearHistory();
      el.log.replaceChildren();
      showWelcome();
    } catch (e) { flashError(e.message); }
    resetClearButton();
  };
}

function togglePanel(open) {
  const isOpen = open ?? !el.side.classList.contains("open");
  el.side.classList.toggle("open", isOpen);
  el.sideBackdrop.hidden = !isOpen;
  el.panelToggle.setAttribute("aria-expanded", String(isOpen));
}

// ------------------------------------------------------------
//  Saat
// ------------------------------------------------------------
function tick() {
  const d = new Date();
  el.clockTime.textContent = timeFmt.format(d);
  el.clockDate.textContent = `${d.getDate()} ${AZ_MONTHS[d.getMonth()]}, ${AZ_DAYS[d.getDay()]}`;
}

// ------------------------------------------------------------
//  Hadisələr
// ------------------------------------------------------------
function bindEvents() {
  el.composer.addEventListener("submit", (e) => { e.preventDefault(); send(); });
  el.input.addEventListener("input", () => { el.input.classList.remove("interim"); autoGrow(); });
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  el.input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  el.micBtn.addEventListener("click", () => (Listener.active ? Listener.stop() : Listener.start()));
  el.stopBtn.addEventListener("click", stopAll);
  el.attachBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => { addFiles([...el.fileInput.files]); el.fileInput.value = ""; });

  el.log.addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-say]");
    if (chip) return send(chip.dataset.say);
    const btn = e.target.closest(".code-actions button");
    if (!btn) return;
    const code = btn.closest(".code").querySelector("pre code").textContent;
    if (btn.dataset.act === "copy") {
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Kopyalandı";
      } catch {
        btn.textContent = "Alınmadı";
      }
      setTimeout(() => { btn.textContent = "Kopyala"; }, 1600);
    } else {
      const ext = EXT[(btn.dataset.lang || "").toLowerCase()] || "txt";
      const a = h("a");
      a.href = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
      a.download = `jarvis-kod.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyM") {
      e.preventDefault();
      Listener.active ? Listener.stop() : Listener.start();
    } else if (e.key === "Escape") {
      if (el.side.classList.contains("open")) togglePanel(false);
      else if (Voice.speaking || busy || Listener.active) stopAll();
    }
  });

  el.taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = el.taskInput.value.trim();
    if (!title) return;
    const due = el.taskDue.value ? new Date(el.taskDue.value).toISOString() : null;
    try {
      await backend.tasks.add(title, due);
      el.taskInput.value = "";
      el.taskDue.value = "";
      refreshTasks();
    } catch (err) { flashError(err.message); }
  });

  el.modeGroup.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    settings.mode = b.dataset.mode;
    saveSettings();
    syncModeButtons();
  });
  el.optVoice.addEventListener("change", () => {
    settings.voiceOn = el.optVoice.checked;
    if (!settings.voiceOn) Voice.stop();
    saveSettings();
  });
  el.optHands.addEventListener("change", () => { settings.handsFree = el.optHands.checked; saveSettings(); });
  el.optVoiceName.addEventListener("change", () => {
    settings.voiceURI = el.optVoiceName.value;
    saveSettings();
    Voice.speak("Səs dəyişdirildi.");
  });
  el.optLang.addEventListener("change", () => { settings.lang = el.optLang.value; saveSettings(); });
  el.optRate.addEventListener("input", () => {
    settings.rate = Number(el.optRate.value);
    el.rateOut.textContent = `${settings.rate.toFixed(1)}×`;
    saveSettings();
  });

  el.notifyBtn.addEventListener("click", async () => {
    try { await Notification.requestPermission(); } catch { /* dəstəklənmir */ }
    updateSys();
  });
  el.logoutBtn.addEventListener("click", async () => {
    if (backend.demo) return location.replace(location.pathname);
    await backend.signOut();
    location.reload();
  });
  el.panelToggle.addEventListener("click", () => togglePanel());
  el.sideBackdrop.addEventListener("click", () => togglePanel(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && backend) refreshTasks(); });
}

// ------------------------------------------------------------
//  Başlanğıc
// ------------------------------------------------------------
function applySettingsToUI() {
  syncModeButtons();
  el.optVoice.checked = settings.voiceOn;
  el.optHands.checked = settings.handsFree;
  el.optLang.value = settings.lang;
  el.optRate.value = String(settings.rate);
  el.rateOut.textContent = `${Number(settings.rate).toFixed(1)}×`;
  el.optHands.disabled = !Listener.supported;
}

async function enterApp() {
  el.gate.hidden = true;
  el.app.hidden = false;
  gateCore?.stop();
  core = new Core($("#core"));
  if (backend.demo) {
    el.brandSub.textContent = "demo rejim";
    claudeStatus = { text: "demo", cls: "warn" };
  } else {
    const s = await backend.session();
    accountEmail = s?.user?.email || "";
    claudeStatus = { text: "hazır", cls: "ok" };
  }
  applySettingsToUI();
  setState("idle");
  tick();
  setInterval(tick, 10000);
  updateSys();

  try {
    const rows = await backend.history(40);
    if (!rows.length) showWelcome();
    for (const r of rows) {
      if (r.role === "user") addUser(r.content, [], r.created_at);
      else renderMarkdown(addBot(r.created_at).body, r.content, true);
    }
    scrollDown(true);
  } catch (e) {
    showWelcome();
    const v = addBot(new Date(), "bot");
    addError(v, `Söhbət tarixçəsi yüklənmədi: ${e.message}. Supabase-də schema.sql işə salınıb?`);
  }
  await refreshTasks();
  setInterval(checkReminders, 20000);
  setInterval(refreshTasks, 120000);
  el.input.focus({ preventScroll: true });
}

async function boot() {
  window.marked?.use({ gfm: true, breaks: true });
  for (const n of [el.brandName, el.gateTitle]) n.textContent = CFG.ASSISTANT_NAME;
  document.title = CFG.ASSISTANT_NAME;
  gateCore = new Core($("#gateCore"));
  bindEvents();
  Voice.init();
  resetClearButton();

  const startDemo = () => {
    backend = createDemoBackend();
    enterApp();
  };
  el.demoBtn.addEventListener("click", startDemo);

  if (FORCE_DEMO) return startDemo();
  if (!CONFIGURED) {
    el.gateSub.textContent = "Quraşdırma tamamlanmayıb";
    el.setupBox.hidden = false;
    return;
  }

  try {
    backend = await createRealBackend();
  } catch (e) {
    el.gateSub.textContent = `Supabase kitabxanası yüklənmədi: ${e.message}`;
    return;
  }
  backend.onSignedOut(() => location.reload());

  if (await backend.session()) return enterApp();

  el.gateSub.textContent = "Davam etmək üçün daxil ol";
  el.loginForm.hidden = false;
  el.loginEmail.focus();
  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.loginError.textContent = "";
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = "Yoxlanılır…";
    try {
      await backend.signIn(el.loginEmail.value.trim(), el.loginPass.value);
      await enterApp();
    } catch (err) {
      el.loginError.textContent = err.message;
    } finally {
      el.loginBtn.disabled = false;
      el.loginBtn.textContent = "Daxil ol";
    }
  });
}

boot();
