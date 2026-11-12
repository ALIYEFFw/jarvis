# JARVIS — Claude-a bağlı şəxsi səsli köməkçi

Brauzerdə açılan, səninlə yazışan və **danışan** köməkçi. Beyni Claude-dur (Anthropic), yaddaşı Supabase-dədir, sayt GitHub Pages-də açılır.

**Nə bacarır:**

- Yazılı və səsli söhbət (mikrofonla danışırsan, cavabı səsli oxuyur)
- Kod yazır: rəngli kod blokları, “Kopyala” və “Yüklə” düymələri
- Hava: “Bu gün Bakıda hava necədir?” (Open-Meteo, pulsuz)
- Tapşırıqlar və xatırlatmalar: “Sabah saat 10-da imtahanı xatırlat”, vaxtı çatanda səsli xəbər verir
- Şəkil göndərmək (məs. xətanın ekran görüntüsü) — yapışdır (Ctrl+V) və ya sancaq düyməsi ilə əlavə et
- Söhbət tarixçəsi bazada saxlanılır, telefondan da, kompüterdən də eyni söhbət
- 3 rejim: **Sürətli** (Haiku), **Ağıllı** (Sonnet), **Dərin** (Opus)

```
Sən (brauzer)  ──►  GitHub Pages: index.html, app.js
                         │  giriş + mesaj
                         ▼
                Supabase Edge Function "jarvis"  ──►  Claude API
                         │  tarixçə, tapşırıqlar          (gizli açar burada saxlanılır)
                         ▼
                Supabase verilənlər bazası
```

> Anthropic açarı **heç vaxt** sayt fayllarında olmur. O, yalnız Supabase-in gizli ayarlarında (Secrets) saxlanılır.

---

## Fayllar

| Fayl | Nə üçündür |
|---|---|
| `index.html`, `style.css`, `app.js` | Saytın özü (interfeys) |
| `config.js` | Supabase ünvanı və açıq açar — **bunu sən doldurursan** |
| `supabase/schema.sql` | Cədvəllər: `messages`, `tasks` |
| `supabase/functions/jarvis/index.ts` | Claude-a qoşulan server funksiyası |

Quraşdırmadan əvvəl görmək istəsən: saytı açıb ünvanın sonuna `?demo` yaz (məs. `.../jarvis/?demo`).

---

## Addım 1. Anthropic API açarı (Claude-a bağlantı)

1. [console.anthropic.com](https://console.anthropic.com) saytında qeydiyyatdan keç.
2. **Billing** bölməsində balansı yoxla. Yeni hesablara bəzən sınaq krediti verilir; yoxdursa, kartla kiçik məbləğ yüklə.
3. **API Keys → Create Key** → ad ver (məs. `jarvis`) → açarı kopyala. Açar `sk-ant-` ilə başlayır və **yalnız bir dəfə** göstərilir. Hələlik təhlükəsiz yerdə saxla.

Bu, Claude Pro abunəliyindən ayrı ödənişdir, istifadəyə görə hesablanır. Təxmini qiymət bir mesaj üçün (tarixçə ilə birlikdə):

| Rejim | Model | Təxmini qiymət |
|---|---|---|
| Sürətli | `claude-haiku-5-5` | ~0,1 sent |
| Ağıllı | `claude-sonnet-5-5` | ~1 sent |
| Dərin | `claude-opus-5-5` | ~2 sent |

Rəsmi qiymətlər: [Claude qiymətləri](https://platform.claude.com/docs/en/about-claude/pricing). Console-da **Limits** bölməsində aylıq xərc limiti qoymağı tövsiyə edirəm.

## Addım 2. Supabase layihəsi

1. [supabase.com](https://supabase.com) → **New project**. Region olaraq Frankfurt (`eu-central-1`) Bakıya yaxındır. Verilənlər bazası şifrəsini yadda saxla.
2. **SQL Editor → New query** → `supabase/schema.sql` faylının içini yapışdır → **Run**. “Success” görməlisən.
3. **Authentication → Sign In / Providers**: “Allow new users to sign up” seçimini **söndür**. Belə olsa, başqası qeydiyyatdan keçib sənin hesabına xərc yarada bilməz.
4. **Authentication → Users → Add user → Create new user**: e-poçtunu və şifrəni yaz, **Auto Confirm User** seçimini işarələ. Sayta bu məlumatla daxil olacaqsan.

> Menyu adları Supabase-in yeniləmələrinə görə bir az fərqli ola bilər.

## Addım 3. Edge Function (Claude-a qoşulan hissə)

1. **Edge Functions → Secrets** (və ya *Manage secrets*) bölməsinə bu sirləri əlavə et:

   | Ad | Dəyər |
   |---|---|
   | `ANTHROPIC_API_KEY` | Addım 1-də kopyaladığın `sk-ant-...` açarı |
   | `ALLOWED_EMAILS` | Sənin e-poçtun (bir neçəsi olsa, vergüllə) |
   | `ENABLE_WEB_SEARCH` | *(istəyə bağlı)* `true` — xəbər, qiymət kimi canlı məlumat üçün internet axtarışı. Hər 1000 axtarış ~10$ |
   | `ALLOWED_ORIGIN` | *(istəyə bağlı)* saytının ünvanı, məs. `https://istifadeciadi.github.io` |

2. **Edge Functions → Deploy a new function → Via Editor**.
3. Funksiyanın adını dəqiq **`jarvis`** yaz.
4. Redaktordakı nümunə kodu sil, `supabase/functions/jarvis/index.ts` faylının içini yapışdır → **Deploy**.
5. “Verify JWT” (JWT yoxlaması) açıq qalsın.

*Terminalı bilirsənsə*, bunu Supabase CLI ilə də edə bilərsən:

```bash
supabase login
supabase link --project-ref LAYIHE_ID
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_EMAILS=sen@gmail.com
supabase functions deploy jarvis
```

## Addım 4. `config.js` faylını doldur

**Project Settings → API Keys** (və ya *Data API*) bölməsindən götür:

```js
window.JARVIS_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",   // Project URL
  SUPABASE_KEY: "sb_publishable_xxxxxxxx",        // Publishable key (köhnə layihələrdə "anon" açarı)
  FUNCTION_NAME: "jarvis",
  ASSISTANT_NAME: "JARVIS",
  USER_NAME: "Vüqar",
  CITY: "Baku",
};
```

Publishable (açıq) açarı saytda görünməsi normaldır, o gizli deyil. Bazanı Row Level Security, bağlı qeydiyyat və `ALLOWED_EMAILS` qoruyur. **`secret`, `service_role` və ya Anthropic açarını bu fayla yazma.**

## Addım 5. GitHub Pages-ə yüklə

1. [github.com](https://github.com) → **New repository** → ad: `jarvis` → **Public** → **Create repository**.
2. “uploading an existing file” keçidinə bas → bütün faylları (qovluqlarla birlikdə) sürüklə → **Commit changes**.
3. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, qovluq = `/ (root)` → **Save**.
4. 1–2 dəqiqədən sonra sayt açılır: `https://istifadeciadi.github.io/jarvis/`

*Terminalla:*

```bash
cd jarvis
git init && git add . && git commit -m "JARVIS"
git branch -M main
git remote add origin https://github.com/ISTIFADECIADI/jarvis.git
git push -u origin main
```

Sonra hər dəyişiklikdə `git add . && git commit -m "yenilik" && git push` etmək kifayətdir, sayt özü yenilənir.

## Addım 6. Yoxla

1. Saytı **Chrome** və ya **Edge**-də aç → e-poçt və şifrə ilə daxil ol.
2. “Salam” yaz. Cavab gəlirsə, hər şey qoşulub.
3. Mikrofon düyməsinə bas, brauzer icazə istəyəndə **Allow** de, danış. Danışıb susanda mesaj özü göndərilir.

---

## Səs haqqında

- **Mikrofon** (danışığı yazıya çevirmək) Chrome və Edge-də işləyir. Firefox-da hələ yoxdur, Safari-də zəifdir.
- **Səsli cavab** brauzerin öz səslərindən istifadə edir. Azərbaycanca səs adətən **Microsoft Edge**-də olur (məs. Babək, Banu). Chrome-da azərbaycanca səs olmaya bilər, o zaman türkcə səs seçilir. Panelin **Səs** bölməsindən özün seçə bilərsən.
- **Əlləri sərbəst** rejimi: JARVIS cavabı bitirəndən sonra özü yenidən dinləməyə başlayır, düyməyə basmadan söhbət edə bilərsən.
- Qısayollar: `Alt+M` mikrofon, `Esc` dayandır, `Enter` göndər, `Shift+Enter` yeni sətir.

## Problemlər və həlli

| Görünən xəta | Səbəb və həll |
|---|---|
| “Quraşdırma tamamlanmayıb” | `config.js` doldurulmayıb (Addım 4). |
| “E-poçt və ya şifrə yanlışdır” | Addım 2.4-də yaratdığın məlumatı yoxla. |
| “jarvis funksiyası tapılmadı” | Funksiyanın adı dəqiq `jarvis` olmalıdır (Addım 3). |
| “ANTHROPIC_API_KEY sirri təyin edilməyib” | Secrets bölməsinə açarı əlavə et (Addım 3.1). |
| “Anthropic API açarı yanlışdır” | Açarı yenidən kopyala, boşluq qalmasın. |
| “Kredit qalmayıb” | console.anthropic.com → Billing. |
| “Bazaya yazmaq olmadı” | `schema.sql` işə salınmayıb (Addım 2.2). |
| “Bu hesabın icazəsi yoxdur” | `ALLOWED_EMAILS`-dəki e-poçt daxil olduğun e-poçtla eyni olmalıdır. |
| `401 Invalid JWT` | Çıxış et, yenidən daxil ol. Davam edərsə, funksiyanın ayarlarında “Verify JWT”-ni söndür. Funksiya istifadəçini özü də yoxlayır, təhlükəsizlik qalır. |
| Mikrofon işləmir | Chrome/Edge istifadə et, ünvan sətrindəki kilid nişanından mikrofona icazə ver. Sayt `https://` ilə açılmalıdır (GitHub Pages belədir). |
| Uzun cavab yarımçıq kəsilir | Supabase pulsuz planında funksiyanın işləmə vaxtı məhduddur. “Davam et” yaz və ya Ağıllı rejimdən istifadə et. |

**Logları görmək:** Supabase → Edge Functions → `jarvis` → **Logs**.

## Kompüterdə yoxlamaq

```bash
cd jarvis
python -m http.server 8000
```

Sonra brauzerdə `http://localhost:8000` aç. Mikrofon `localhost`-da da işləyir.

## Dəyişmək istəsən

- **Xarakter və davranış:** `index.ts` faylında `systemPrompt` funksiyası.
- **Modellər:** `index.ts` faylının əvvəlində `MODELS`.
- **Yeni bacarıq (alət):** `TOOLS` siyahısına təsvir əlavə et, `runTool` funksiyasında icrasını yaz. Məsələn: valyuta məzənnəsi, Google Calendar, Telegram-a mesaj.
- **Görünüş:** `style.css` faylının əvvəlindəki rənglər (`--accent`, `--warm` və s.).
