// ============================================================
//  JARVIS — Supabase Edge Function
//  Sayt bura mesaj göndərir → bu funksiya Claude API-yə müraciət edir
//  → cavabı canlı (stream) olaraq geri qaytarır.
//
//  Lazım olan sirlər (Edge Functions → Secrets):
//    ANTHROPIC_API_KEY   — console.anthropic.com-dan aldığın açar (MƏCBURİ)
//    ALLOWED_EMAILS      — icazəli e-poçtlar, vergüllə (tövsiyə olunur)
//    ENABLE_WEB_SEARCH   — "true" yazsan, internetdə axtarış açılır (ödənişli)
//    ALLOWED_ORIGIN      — saytının ünvanı, məs. https://ad.github.io (istəyə bağlı)
// ============================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2026-10-21";

// Saytdakı "Rejim" seçiminə uyğun modellər
const MODELS: Record<string, string> = {
  quick: "claude-haiku-5-5", // ən sürətli və ən ucuz — gündəlik söhbət
  smart: "claude-sonnet-5-5", // balanslı — kod və çox iş üçün
  deep: "claude-opus-5-5", // ən güclü — çətin tapşırıqlar
};
const MAX_TOKENS: Record<string, number> = { quick: 4096, smart: 8192, deep: 8192 };
const HISTORY_LIMIT = 30; // Claude-a göndərilən son mesaj sayı
const MAX_ROUNDS = 6; // bir cavabda alət çağırışı dövrlərinin sayı

const WEB_SEARCH = (Deno.env.get("ENABLE_WEB_SEARCH") ?? "").toLowerCase() === "true";
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
//  Claude-un istifadə edə biləcəyi alətlər
// ------------------------------------------------------------
const TOOLS: Record<string, unknown>[] = [
  {
    name: "get_weather",
    description:
      "Gets the current weather and a 3-day forecast for a city (Open-Meteo). Returns temperature in °C, feels-like, humidity, wind in km/h, rain chance and a description in Azerbaijani. Use for any weather question. Pass the city name in English, e.g. 'Baku', 'Ganja', 'Istanbul'.",
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "City name in English" } },
      required: ["city"],
    },
  },
  {
    name: "list_tasks",
    description:
      "Lists the user's saved tasks and reminders. Returns id, title, due_at (ISO 8601, UTC) and done for each, plus the current time. Use before completing or deleting a task to find its id.",
    input_schema: {
      type: "object",
      properties: { include_done: { type: "boolean", description: "Also return finished tasks" } },
    },
  },
  {
    name: "add_task",
    description:
      "Saves a new task or reminder for the user. If the user gives a time ('sabah saat 10-da'), convert it to an ISO 8601 datetime WITH the user's timezone offset, e.g. 2026-11-13T10:00:00+04:00. The website will announce it when it is due. Returns the saved task.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task text in the user's language" },
        due_at: { type: "string", description: "Optional ISO 8601 datetime with offset" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Marks a task as done (or not done with done=false). Returns the updated task.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" }, done: { type: "boolean" } },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Deletes a task permanently. Only use when the user clearly asks to delete it.",
    input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
];
const TASK_TOOLS = new Set(["add_task", "complete_task", "delete_task"]);

// ------------------------------------------------------------
//  Əsas sorğu emalçısı
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Yalnız POST sorğusu qəbul olunur." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY sirri təyin edilməyib (Edge Functions → Secrets)." }, 500);
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

  const messages = buildHistory((rows ?? []).reverse());
  if (images.length) {
    const last = messages[messages.length - 1];
    last.content = [
      ...images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      })),
      { type: "text", text: typeof last.content === "string" ? last.content : "Şəkilə bax." },
    ];
  }

  // 4) Claude-a göndər və cavabı canlı ötür
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
        await runClaude(
          {
            apiKey,
            model: MODELS[mode],
            maxTokens: MAX_TOKENS[mode],
            system: systemPrompt(ctx),
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
//  Claude ilə dövr: cavab → alət çağırışı → nəticə → cavab ...
// ------------------------------------------------------------
type Ctx = { userName: string; assistantName: string; timezone: string; city: string };
type RunState = { text: string; tasksChanged: boolean };
type Msg = { role: "user" | "assistant"; content: unknown };
type RunOpts = {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  messages: Msg[];
  supabase: SupabaseClient;
  userId: string;
  ctx: Ctx;
  send: (obj: Record<string, unknown>) => void;
  signal: AbortSignal;
};

async function runClaude(o: RunOpts, state: RunState) {
  const tools: Record<string, unknown>[] = [...TOOLS];
  if (WEB_SEARCH) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
      user_location: { type: "approximate", city: o.ctx.city, country: "AZ", timezone: o.ctx.timezone },
    });
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS - 1;
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${o.apiKey}`,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system,
        messages: o.messages,
        tools,
        ...(lastRound ? { tool_choice: { type: "none" } } : {}),
        stream: true,
      }),
      signal: o.signal,
    });
    if (!res.ok || !res.body) {
      throw new UpstreamError(res.status, await res.text().catch(() => ""));
    }

    const { content, stopReason } = await readAnthropicStream(
      res.body,
      (delta) => {
        state.text += delta;
        o.send({ type: "text", text: delta });
      },
      o.send,
    );
    o.messages.push({ role: "assistant", content });

    if (stopReason === "tool_use") {
      const results: Record<string, unknown>[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const name = String(block.name);
        o.send({ type: "tool", name, input: block.input });
        let out: unknown;
        let isError = false;
        try {
          out = await runTool(name, (block.input ?? {}) as Record<string, unknown>, o);
          if (TASK_TOOLS.has(name)) state.tasksChanged = true;
        } catch (e) {
          out = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof out === "string" ? out : JSON.stringify(out),
          ...(isError ? { is_error: true } : {}),
        });
      }
      o.messages.push({ role: "user", content: results });
      if (state.text && !state.text.endsWith("\n\n")) {
        const sep = state.text.endsWith("\n") ? "\n" : "\n\n";
        state.text += sep;
        o.send({ type: "text", text: sep });
      }
      continue;
    }
    if (stopReason === "pause_turn") continue; // internet axtarışı davam edir
    if (stopReason === "max_tokens") {
      o.send({ type: "notice", message: "Cavab uzunluq limitinə çatdı və kəsildi. \"Davam et\" yaza bilərsən." });
    }
    return;
  }
}

// Claude-un SSE axınını oxuyur, mətn parçalarını dərhal ötürür,
// bütöv məzmun bloklarını (mətn, alət çağırışı və s.) yığır.
async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onText: (t: string) => void,
  send: (obj: Record<string, unknown>) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [];
  const jsonBuf = new Map<number, string>();
  let stopReason: string | null = null;
  let buf = "";

  // deno-lint-ignore no-explicit-any
  const handle = (data: any) => {
    switch (data.type) {
      case "content_block_start": {
        const b = { ...data.content_block };
        if (b.type === "tool_use" || b.type === "server_tool_use") jsonBuf.set(data.index, "");
        if (b.type === "text") b.text = b.text ?? "";
        blocks[data.index] = b;
        break;
      }
      case "content_block_delta": {
        const b = blocks[data.index];
        const d = data.delta ?? {};
        if (!b) break;
        if (d.type === "text_delta") {
          b.text += d.text;
          onText(d.text);
        } else if (d.type === "input_json_delta") {
          jsonBuf.set(data.index, (jsonBuf.get(data.index) ?? "") + (d.partial_json ?? ""));
        } else if (d.type === "thinking_delta") {
          b.thinking = (b.thinking ?? "") + d.thinking;
        } else if (d.type === "signature_delta") {
          b.signature = (b.signature ?? "") + d.signature;
        } else if (d.type === "citations_delta") {
          b.citations = [...(b.citations ?? []), d.citation];
        }
        break;
      }
      case "content_block_stop": {
        const b = blocks[data.index];
        if (b && jsonBuf.has(data.index)) {
          const raw = jsonBuf.get(data.index) ?? "";
          try {
            b.input = raw ? JSON.parse(raw) : {};
          } catch {
            b.input = {};
          }
          if (b.type === "server_tool_use") send({ type: "tool", name: b.name, input: b.input });
        }
        break;
      }
      case "message_delta":
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        break;
      case "error":
        throw new UpstreamError(Number(data.error?.status) || 500, JSON.stringify(data));
    }
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
        if (payload) handle(JSON.parse(payload));
      }
    }
  }

  const content = blocks.filter((b) => {
    if (!b) return false;
    if (b.type === "text") {
      if (!b.citations?.length) delete b.citations;
      return b.text.length > 0;
    }
    return true;
  });
  return { content, stopReason };
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
    `You are ${ctx.assistantName}, the personal AI assistant of ${who}, in the spirit of a film-style AI butler: calm, capable, quick, with a touch of dry wit, never servile or flattering. You run on Claude, made by Anthropic; if asked what you are, say so plainly.`,
    `Language: reply in the language the user writes in. Default to Azerbaijani in Latin script with correct letters (ə, ğ, ı, ö, ü, ç, ş). ${ctx.userName ? `Address the user as ${ctx.userName} now and then, not in every reply.` : ""}`,
    "Your replies are often read aloud. For casual conversation answer in 1-3 short spoken-style sentences with no markdown. Use markdown (lists, headings, tables, fenced code blocks with a language tag) only when it really helps: code, step-by-step instructions, comparisons.",
    "When asked for code, give complete, runnable code in fenced blocks with a language tag, then a short explanation of how to run it. Prefer clear, beginner-friendly code with brief comments.",
    `Current local date and time: ${nowInZone(ctx.timezone)}. The user's city: ${ctx.city}.`,
    "Tools: use get_weather for weather. Use list_tasks, add_task, complete_task and delete_task for the user's tasks and reminders; when a time is mentioned, store due_at with the user's timezone offset. After using a tool, confirm briefly what you did. Never invent tool results.",
    WEB_SEARCH
      ? "You can search the web with web_search for news, prices and other current facts. Search only when the answer depends on current information, and mention where it came from."
      : "You have no web access. For live news, prices or events, say you can't check them right now instead of guessing.",
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
    super(`Anthropic API ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof UpstreamError) {
    let msg = "";
    try {
      msg = JSON.parse(err.body)?.error?.message ?? "";
    } catch { /* JSON deyil */ }
    const lower = msg.toLowerCase();
    if (err.status === 401) return "Anthropic API açarı yanlışdır. Supabase Secrets-də ANTHROPIC_API_KEY-i yoxla.";
    if (lower.includes("credit balance")) return "Anthropic hesabında kredit qalmayıb: console.anthropic.com → Billing.";
    if (err.status === 403) return `API açarının bu əməliyyata icazəsi yoxdur. ${msg}`;
    if (err.status === 404) return `Model tapılmadı. index.ts faylında MODELS siyahısını yoxla. ${msg}`;
    if (err.status === 429) return "Çox sorğu göndərildi. Bir dəqiqə gözlə və yenidən yoxla.";
    if (err.status === 529 || lower.includes("overloaded")) return "Claude hazırda çox yüklüdür. Bir azdan yenidən yoxla.";
    if (err.status >= 500) return "Claude serverində müvəqqəti xəta oldu. Yenidən yoxla.";
    return `Claude sorğunu qəbul etmədi (${err.status}): ${msg || err.body.slice(0, 200)}`;
  }
  const m = err instanceof Error ? err.message : String(err);
  return `Claude-a qoşulmaq olmadı: ${m}`;
}
