// ============================================================
//  JARVIS — Supabase Edge Function (Google Gemini)
//  Sayt bura mesaj göndərir → bu funksiya Gemini API-yə müraciət edir
//  → cavabı canlı (stream) olaraq geri qaytarır.
//
//  Lazım olan sirlər (Edge Functions → Secrets):
//    GEMINI_API_KEY      — aistudio.google.com-dan aldığın açar (MƏCBURİ)
//    ALLOWED_EMAILS      — icazəli e-poçtlar, vergüllə (tövsiyə olunur)
//    ALLOWED_ORIGIN      — saytının ünvanı, məs. https://ad.github.io (istəyə bağlı)
//    GEMINI_MODEL_QUICK / GEMINI_MODEL_SMART / GEMINI_MODEL_DEEP
//                        — modeli dəyişmək istəsən (istəyə bağlı)
// ============================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Gemini-nin OpenAI-uyğun ünvanı
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// Saytdakı "Rejim" seçiminə uyğun modellər (pulsuz planda mövcud olanlar)
const MODELS: Record<string, string> = {
  quick: Deno.env.get("GEMINI_MODEL_QUICK") || "gemini-3.1-flash-lite", // ən sürətli
  smart: Deno.env.get("GEMINI_MODEL_SMART") || "gemini-3.5-flash", // balanslı — kod və çox iş
  deep: Deno.env.get("GEMINI_MODEL_DEEP") || "gemini-3.5-flash", // eyni model, daha çox düşünür
};
const REASONING: Record<string, string | undefined> = { quick: undefined, smart: undefined, deep: "high" };
const HISTORY_LIMIT = 30; // modelə göndərilən son mesaj sayı
const MAX_ROUNDS = 6; // bir cavabda alət çağırışı dövrlərinin sayı

const ALLOWED_EMAILS = (Deno.env.get("ALLOWED_EMAILS") ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ------------------------------------------------------------
//  Modelin istifadə edə biləcəyi alətlər
// ------------------------------------------------------------
const fn = (name: string, description: string, parameters: Record<string, unknown>) => ({
  type: "function",
  function: { name, description, parameters },
});

const TOOLS = [
  fn(
    "get_weather",
    "Gets the current weather and a 3-day forecast for a city (Open-Meteo). Returns temperature in °C, feels-like, humidity, wind in km/h, rain chance and a description in Azerbaijani. Use for any weather question. Pass the city name in English, e.g. 'Baku', 'Ganja', 'Istanbul'.",
    {
      type: "object",
      properties: { city: { type: "string", description: "City name in English" } },
      required: ["city"],
    },
  ),
  fn(
    "list_tasks",
    "Lists the user's saved tasks and reminders. Returns id, title, due_at (ISO 8601, UTC) and done for each, plus the current time. Use before completing or deleting a task to find its id.",
    {
      type: "object",
      properties: { include_done: { type: "boolean", description: "Also return finished tasks" } },
    },
  ),
  fn(
    "add_task",
    "Saves a new task or reminder for the user. If the user gives a time ('sabah saat 10-da'), convert it to an ISO 8601 datetime WITH the user's timezone offset, e.g. 2026-11-13T10:00:00+04:00. The website will announce it when it is due. Returns the saved task.",
    {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task text in the user's language" },
        due_at: { type: "string", description: "Optional ISO 8601 datetime with offset" },
      },
      required: ["title"],
    },
  ),
  fn("complete_task", "Marks a task as done (or not done with done=false). Returns the updated task.", {
    type: "object",
    properties: { id: { type: "integer" }, done: { type: "boolean" } },
    required: ["id"],
  }),
  fn("delete_task", "Deletes a task permanently. Only use when the user clearly asks to delete it.", {
    type: "object",
    properties: { id: { type: "integer" } },
    required: ["id"],
  }),
];
const TASK_TOOLS = new Set(["add_task", "complete_task", "delete_task"]);

// ------------------------------------------------------------
//  Əsas sorğu emalçısı
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Yalnız POST sorğusu qəbul olunur." }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: "GEMINI_API_KEY sirri təyin edilməyib (Edge Functions → Secrets)." }, 500);
  }

  // 1) İstifadəçini yoxla
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const projectKey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || !projectKey) return json({ error: "Giriş tələb olunur." }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, projectKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "Sessiya etibarsızdır, yenidən daxil ol." }, 401);
  if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes((user.email ?? "").toLowerCase())) {
    return json({ error: "Bu hesabın JARVIS-dən istifadəyə icazəsi yoxdur." }, 403);
  }

  // 2) Sorğunu oxu
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Sorğu JSON formatında deyil." }, 400);
  }
  const text = String(body.message ?? "").trim().slice(0, 20000);
  const images = parseImages(body.images);
  if (!text && !images.length) return json({ error: "Boş mesaj göndərilə bilməz." }, 400);

  const mode = typeof body.mode === "string" && body.mode in MODELS ? body.mode : "smart";
  const ctx: Ctx = {
    userName: clean(body.userName, 60),
    assistantName: clean(body.assistantName, 40) || "JARVIS",
    timezone: validTimeZone(clean(body.timezone, 60)) ?? "Asia/Baku",
    city: clean(body.city, 80) || "Baku",
  };

  // 3) İstifadəçinin mesajını yadda saxla, son söhbəti oxu
  const stored = images.length
    ? `${text || "(şəkil)"}\n\n[${images.length} şəkil əlavə edilib]`
    : text;
  const { error: insErr } = await supabase
    .from("messages")
    .insert({ user_id: user.id, role: "user", content: stored });
  if (insErr) {
    return json({ error: `Bazaya yazmaq olmadı: ${insErr.message}. schema.sql işə salınıb?` }, 500);
  }

  const { data: rows, error: histErr } = await supabase
    .from("messages")
    .select("role, content")
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (histErr) return json({ error: `Söhbət tarixçəsi oxunmadı: ${histErr.message}` }, 500);

  const messages: Msg[] = [{ role: "system", content: systemPrompt(ctx) }, ...buildHistory((rows ?? []).reverse())];
  if (images.length) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "text", text: typeof last.content === "string" ? last.content : "Şəkilə bax." },
      ...images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.media_type};base64,${img.data}` },
      })),
    ];
  }

  // 4) Gemini-yə göndər və cavabı canlı ötür
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  const state: RunState = { text: "", tasksChanged: false };
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await runModel(
          {
            apiKey,
            model: MODELS[mode],
            reasoning: REASONING[mode],
            messages,
            supabase,
            userId: user.id,
            ctx,
            send,
            signal: upstream.signal,
          },
          state,
        );
        send({ type: "done", tasksChanged: state.tasksChanged, model: MODELS[mode] });
      } catch (err) {
        console.error("jarvis error:", err);
        if (!upstream.signal.aborted) {
          send({ type: "error", message: friendlyError(err), tasksChanged: state.tasksChanged });
        }
      } finally {
        let finalText = state.text.trim();
        if (finalText && upstream.signal.aborted) finalText += "\n\n_(dayandırıldı)_";
        if (finalText) {
          await supabase.from("messages").insert({ user_id: user.id, role: "assistant", content: finalText });
        }
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch { /* artıq bağlanıb */ }
        }
      }
    },
    cancel() {
      closed = true;
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
  });
});

// ------------------------------------------------------------
//  Model ilə dövr: cavab → alət çağırışı → nəticə → cavab ...
// ------------------------------------------------------------
type Ctx = { userName: string; assistantName: string; timezone: string; city: string };
type RunState = { text: string; tasksChanged: boolean };
// deno-lint-ignore no-explicit-any
type Msg = { role: "system" | "user" | "assistant" | "tool"; content: any; [k: string]: unknown };
// deno-lint-ignore no-explicit-any
type ToolCall = { id: string; type: string; function: { name: string; arguments: string }; [k: string]: any };
type RunOpts = {
  apiKey: string;
  model: string;
  reasoning?: string;
  messages: Msg[];
  supabase: SupabaseClient;
  userId: string;
  ctx: Ctx;
  send: (obj: Record<string, unknown>) => void;
  signal: AbortSignal;
};

async function runModel(o: RunOpts, state: RunState) {
  let reasoning = o.reasoning;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS - 1;
    const request = () =>
      fetch(GEMINI_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model,
          messages: o.messages,
          tools: TOOLS,
          tool_choice: lastRound ? "none" : "auto",
          ...(reasoning ? { reasoning_effort: reasoning } : {}),
          stream: true,
        }),
        signal: o.signal,
      });

    let res = await request();
    // Model "reasoning_effort"-i qəbul etmirsə, onsuz yenidən yoxla
    if (res.status === 400 && reasoning) {
      const errText = await res.text().catch(() => "");
      if (/reasoning|thinking/i.test(errText)) {
        reasoning = undefined;
        res = await request();
      } else {
        throw new UpstreamError(400, errText);
      }
    }
    if (!res.ok || !res.body) {
      throw new UpstreamError(res.status, await res.text().catch(() => ""));
    }

    const { content, toolCalls, finish } = await readChatStream(res.body, (delta) => {
      state.text += delta;
      o.send({ type: "text", text: delta });
    });

    if (toolCalls.length) {
      o.messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch { /* boş arqumentlər */ }
        o.send({ type: "tool", name, input: args });
        let out: unknown;
        try {
          out = await runTool(name, args, o);
          if (TASK_TOOLS.has(name)) state.tasksChanged = true;
        } catch (e) {
          out = { error: e instanceof Error ? e.message : String(e) };
        }
        o.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: typeof out === "string" ? out : JSON.stringify(out),
        });
      }
      if (state.text && !state.text.endsWith("\n\n")) {
        const sep = state.text.endsWith("\n") ? "\n" : "\n\n";
        state.text += sep;
        o.send({ type: "text", text: sep });
      }
      continue;
    }

    if (finish === "length") {
      o.send({ type: "notice", message: "Cavab uzunluq limitinə çatdı və kəsildi. \"Davam et\" yaza bilərsən." });
    }
    return;
  }
}

// OpenAI formatlı SSE axınını oxuyur: mətn parçalarını dərhal ötürür,
// alət çağırışlarını (tool_calls) parça-parça yığır.
async function readChatStream(body: ReadableStream<Uint8Array>, onText: (t: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls: ToolCall[] = [];
  let content = "";
  let finish: string | null = null;
  let buf = "";

  // deno-lint-ignore no-explicit-any
  const handle = (data: any) => {
    if (data?.error) throw new UpstreamError(Number(data.error.code) || 500, JSON.stringify(data));
    const choice = data?.choices?.[0];
    if (!choice) return;
    const d = choice.delta ?? {};
    if (typeof d.content === "string" && d.content) {
      content += d.content;
      onText(d.content);
    }
    if (Array.isArray(d.tool_calls)) {
      d.tool_calls.forEach((tc: ToolCall & { index?: number }, j: number) => {
        const i = typeof tc.index === "number" ? tc.index : calls.length > j ? j : calls.length;
        const cur = calls[i] ?? (calls[i] = { id: "", type: "function", function: { name: "", arguments: "" } });
        // Gemini-nin əlavə sahələrini (məs. düşüncə imzası) olduğu kimi saxla
        for (const [k, v] of Object.entries(tc)) {
          if (k !== "index" && k !== "function" && v != null && v !== "") cur[k] = v;
        }
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) {
          const a = tc.function.arguments;
          cur.function.arguments += typeof a === "string" ? a : JSON.stringify(a);
        }
      });
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        handle(data);
      }
    }
  }

  const toolCalls = calls.filter((c) => c && c.function.name);
  toolCalls.forEach((c, n) => {
    if (!c.id) c.id = `call_${Date.now()}_${n}`;
    c.type = "function";
  });
  return { content, toolCalls, finish };
}

// ------------------------------------------------------------
//  Alətlərin icrası
// ------------------------------------------------------------
async function runTool(name: string, input: Record<string, unknown>, o: RunOpts): Promise<unknown> {
  const db = o.supabase;
  switch (name) {
    case "get_weather":
      return await getWeather(String(input.city ?? o.ctx.city));

    case "list_tasks": {
      let q = db
        .from("tasks")
        .select("id, title, due_at, done")
        .order("done")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(50);
      if (!input.include_done) q = q.eq("done", false);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { now: new Date().toISOString(), tasks: data };
    }

    case "add_task": {
      const title = String(input.title ?? "").trim().slice(0, 300);
      if (!title) throw new Error("Tapşırığın mətni boşdur.");
      let due_at: string | null = null;
      if (input.due_at) {
        const d = new Date(String(input.due_at));
        if (isNaN(d.getTime())) throw new Error("due_at düzgün ISO 8601 tarix deyil.");
        due_at = d.toISOString();
      }
      const { data, error } = await db
        .from("tasks")
        .insert({ user_id: o.userId, title, due_at })
        .select("id, title, due_at")
        .single();
      if (error) throw new Error(error.message);
      return { saved: data };
    }

    case "complete_task": {
      const id = Number(input.id);
      const { data, error } = await db
        .from("tasks")
        .update({ done: input.done !== false })
        .eq("id", id)
        .select("id, title, done");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error(`${id} nömrəli tapşırıq tapılmadı.`);
      return { updated: data[0] };
    }

    case "delete_task": {
      const id = Number(input.id);
      const { data, error } = await db.from("tasks").delete().eq("id", id).select("id, title");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error(`${id} nömrəli tapşırıq tapılmadı.`);
      return { deleted: data[0] };
    }

    default:
      throw new Error(`Naməlum alət: ${name}`);
  }
}

async function getWeather(city: string) {
  const geocode = async (name: string) => {
    const g = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
    );
    return g?.results?.[0];
  };
  let place = await geocode(city);
  if (!place && foldAz(city) !== city) place = await geocode(foldAz(city));
  if (!place) throw new Error(`"${city}" adlı şəhər tapılmadı. Adı ingiliscə yaz (məs. Baku, Ganja).`);

  const w = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=auto&forecast_days=3",
  );
  const c = w.current;
  return {
    place: [place.name, place.country].filter(Boolean).join(", "),
    current: {
      local_time: c.time,
      description: wmo(c.weather_code),
      temperature_c: c.temperature_2m,
      feels_like_c: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m,
      precipitation_mm: c.precipitation,
      wind_kmh: c.wind_speed_10m,
    },
    days: (w.daily.time as string[]).map((date, i) => ({
      date,
      description: wmo(w.daily.weather_code[i]),
      min_c: w.daily.temperature_2m_min[i],
      max_c: w.daily.temperature_2m_max[i],
      rain_chance_pct: w.daily.precipitation_probability_max?.[i] ?? null,
    })),
    source: "Open-Meteo",
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Hava xidməti cavab vermədi (${res.status}).`);
  return await res.json();
}

function wmo(code: number): string {
  const map: Record<number, string> = {
    0: "açıq səma", 1: "əsasən açıq", 2: "qismən buludlu", 3: "buludlu",
    45: "duman", 48: "qırovlu duman",
    51: "zəif çiskin", 53: "çiskin", 55: "sıx çiskin", 56: "donan çiskin", 57: "donan çiskin",
    61: "zəif yağış", 63: "yağış", 65: "güclü yağış", 66: "donan yağış", 67: "güclü donan yağış",
    71: "zəif qar", 73: "qar", 75: "güclü qar", 77: "qar dənələri",
    80: "zəif leysan", 81: "leysan", 82: "güclü leysan", 85: "qar leysanı", 86: "güclü qar leysanı",
    95: "tufan", 96: "dolu ilə tufan", 99: "güclü dolu ilə tufan",
  };
  return map[code] ?? `kod ${code}`;
}

// ------------------------------------------------------------
//  Köməkçi funksiyalar
// ------------------------------------------------------------
function systemPrompt(ctx: Ctx): string {
  const who = ctx.userName ? `${ctx.userName}` : "the user";
  return [
    `You are ${ctx.assistantName}, the personal AI assistant of ${who}, in the spirit of a film-style AI butler: calm, capable, quick, with a touch of dry wit, never servile or flattering. You run on Google Gemini; if asked what you are, say so plainly.`,
    `Language: reply in the language the user writes in. Default to Azerbaijani in Latin script with correct letters (ə, ğ, ı, ö, ü, ç, ş). Write natural Azerbaijani, not Turkish. ${ctx.userName ? `Address the user as ${ctx.userName} now and then, not in every reply.` : ""}`,
    "Your replies are often read aloud. For casual conversation answer in 1-3 short spoken-style sentences with no markdown. Use markdown (lists, headings, tables, fenced code blocks with a language tag) only when it really helps: code, step-by-step instructions, comparisons.",
    "When asked for code, give complete, runnable code in fenced blocks with a language tag, then a short explanation of how to run it. Prefer clear, beginner-friendly code with brief comments.",
    `Current local date and time: ${nowInZone(ctx.timezone)}. The user's city: ${ctx.city}.`,
    "Tools: use get_weather for weather. Use list_tasks, add_task, complete_task and delete_task for the user's tasks and reminders; when a time is mentioned, store due_at with the user's timezone offset. After using a tool, confirm briefly what you did. Never invent tool results.",
    "You have no web access. For live news, prices or events, say you can't check them right now instead of guessing.",
  ].join("\n\n");
}

function buildHistory(rows: { role: string; content: string }[]): Msg[] {
  const out: Msg[] = [];
  for (const r of rows) {
    const role = r.role === "assistant" ? "assistant" : "user";
    const text = String(r.content ?? "").trim();
    if (!text) continue;
    if (!out.length && role === "assistant") continue; // söhbət istifadəçi ilə başlamalıdır
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content}\n\n${text}`;
    else out.push({ role, content: text });
  }
  return out;
}

function parseImages(raw: unknown): { media_type: string; data: string }[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  return raw
    .slice(0, 3)
    .filter((i) => i && ok.has(String(i.media_type)) && typeof i.data === "string" && i.data.length < 7_000_000)
    .map((i) => ({ media_type: String(i.media_type), data: String(i.data) }));
}

function nowInZone(tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}, ${parts.weekday} (${tz}, ${parts.timeZoneName})`;
}

function validTimeZone(tz: string): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function foldAz(s: string): string {
  const m: Record<string, string> = { ə: "a", Ə: "A", ı: "i", İ: "I", ş: "s", Ş: "S", ç: "c", Ç: "C", ğ: "g", Ğ: "G", ö: "o", Ö: "O", ü: "u", Ü: "U" };
  return s.replace(/[əƏıİşŞçÇğĞöÖüÜ]/g, (ch) => m[ch] ?? ch);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

class UpstreamError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Gemini API ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof UpstreamError) {
    let msg = "";
    try {
      const j = JSON.parse(err.body);
      const e = Array.isArray(j) ? j[0]?.error : j?.error;
      msg = e?.message ?? "";
    } catch { /* JSON deyil */ }
    const lower = `${msg} ${err.body}`.toLowerCase();
    if (err.status === 401 || err.status === 403 || lower.includes("api key not valid") || lower.includes("api_key_invalid")) {
      return "Gemini API açarı yanlışdır. Supabase Secrets-də GEMINI_API_KEY-i yoxla.";
    }
    if (err.status === 429 || lower.includes("resource_exhausted") || lower.includes("quota")) {
      return "Gemini-nin pulsuz limiti doldu. Bir dəqiqə gözlə və ya “Sürətli” rejimə keç. Gündəlik limit gecə yarısı (ABŞ vaxtı ilə) yenilənir.";
    }
    if (err.status === 404 || lower.includes("not found")) {
      return `Model tapılmadı və ya sənin hesabında yoxdur. Secrets-də GEMINI_MODEL_SMART kimi başqa model yaz. ${msg}`;
    }
    if (lower.includes("location") && lower.includes("not supported")) {
      return "Gemini API bu regionda işləmir. Supabase layihəsinin regionunu yoxla (məs. Frankfurt).";
    }
    if (err.status === 503 || lower.includes("overloaded") || lower.includes("unavailable")) {
      return "Gemini hazırda çox yüklüdür. Bir azdan yenidən yoxla.";
    }
    if (err.status >= 500) return "Gemini serverində müvəqqəti xəta oldu. Yenidən yoxla.";
    return `Gemini sorğunu qəbul etmədi (${err.status}): ${msg || err.body.slice(0, 200)}`;
  }
  const m = err instanceof Error ? err.message : String(err);
  return `Gemini-yə qoşulmaq olmadı: ${m}`;
}
