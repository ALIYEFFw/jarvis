# JARVIS — Gemini-yə bağlı şəxsi səsli köməkçi

Brauzerdə açılan, səninlə yazışan və **danışan** köməkçi. Beyni Google Gemini-dir (pulsuz plan), yaddaşı Supabase-dədir, sayt GitHub Pages-də açılır.

**Nə bacarır:**

- Yazılı və səsli söhbət (mikrofonla danışırsan, cavabı səsli oxuyur)
- Kod yazır: rəngli kod blokları, “Kopyala” və “Yüklə” düymələri
- Hava: “Bu gün Bakıda hava necədir?” (Open-Meteo, pulsuz)
- Tapşırıqlar və xatırlatmalar: “Sabah saat 10-da imtahanı xatırlat”, vaxtı çatanda səsli xəbər verir
- Şəkil göndərmək (məs. xətanın ekran görüntüsü): yapışdır (Ctrl+V) və ya sancaq düyməsi ilə əlavə et
- Söhbət tarixçəsi bazada saxlanılır, telefondan da, kompüterdən də eyni söhbət
- 3 rejim: **Sürətli**, **Ağıllı**, **Dərin** (daha çox düşünür)

```
Sən (brauzer)  ──►  GitHub Pages: index.html, app.js
                         │  giriş + mesaj
                         ▼
                Supabase Edge Function "jarvis"  ──►  Gemini API
                         │  tarixçə, tapşırıqlar          (gizli açar burada saxlanılır)
                         ▼
                Supabase verilənlər bazası
```

> Gemini açarı **heç vaxt** sayt fayllarında olmur. O, yalnız Supabase-in gizli ayarlarında (Secrets) saxlanılır.

---

## Fayllar

| Fayl | Nə üçündür |
|---|---|
| `index.html`, `style.css`, `app.js` | Saytın özü (interfeys) |
| `config.js` | Supabase ünvanı və açıq açar — **bunu sən doldurursan** |
| `supabase/schema.sql` | Cədvəllər: `messages`, `tasks` |
| `supabase/functions/jarvis/index.ts` | Gemini-yə qoşulan server funksiyası |

Quraşdırmadan əvvəl görmək istəsən: saytı açıb ünvanın sonuna `?demo` yaz (məs. `.../jarvis/?demo`).

---

## Addım 1. Gemini API açarı (pulsuz)

1. [aistudio.google.com](https://aistudio.google.com) saytına Google hesabınla daxil ol.
2. **Get API key → Create API key** → açarı kopyala. Açar `AIza` ilə başlayır.
3. Açarı Notepad-də saxla, heç kimə göstərmə.

**Pulsuz plan haqqında:**

- Kart lazım deyil, amma dəqiqəlik və gündəlik sorğu limiti var. Limitlərini AI Studio-da görə bilərsən.
- Pulsuz planda yazdıqlarını Google məhsullarını yaxşılaşdırmaq üçün istifadə edə bilər. Şifrə və şəxsi məlumat yazma.
- Limit doldusa, JARVIS bunu deyəcək. Bir az gözlə və ya “Sürətli” rejimə keç.

## Addım 2. Supabase layihəsi

1. [supabase.com](https://supabase.com) → **New project**. Region olaraq Frankfurt (`eu-central-1`) seç. Verilənlər bazası şifrəsini yadda saxla.
2. **SQL Editor → New query** → `supabase/schema.sql` faylının içini yapışdır → **Run**. “Success” görməlisən.
3. **Authentication → Sign In / Providers**: “Allow new users to sign up” seçimini **söndür**. Belə olsa, başqası qeydiyyatdan keçib sənin limitini işlədə bilməz.
4. **Authentication → Users → Add user → Create new user**: e-poçtunu və şifrəni yaz, **Auto Confirm User** seçimini işarələ. Sayta bu məlumatla daxil olacaqsan.

> Menyu adları Supabase-in yeniləmələrinə görə bir az fərqli ola bilər.

## Addım 3. Edge Function (Gemini-yə qoşulan hissə)

1. **Edge Functions → Secrets** (və ya *Manage secrets*) bölməsinə bu sirləri əlavə et:

   | Ad | Dəyər |
   |---|---|
   | `GEMINI_API_KEY` | Addım 1-də kopyaladığın `AIza...` açarı |
   | `ALLOWED_EMAILS` | Sənin e-poçtun (bir neçəsi olsa, vergüllə) |
   | `ALLOWED_ORIGIN` | *(istəyə bağlı)* saytının ünvanı, məs. `https://aliyeffw.github.io` |

2. **Edge Functions → Deploy a new function → Via Editor**.
3. Funksiyanın adını dəqiq **`jarvis`** yaz.
4. Redaktordakı nümunə kodu sil, `supabase/functions/jarvis/index.ts` faylının içini yapışdır → **Deploy**.
5. “Verify JWT” (JWT yoxlaması) açıq qalsın.

**Modellər** (pulsuz planda olanlar):

| Rejim | Model |
|---|---|
| Sürətli | `gemini-3.1-flash-lite` |
| Ağıllı | `gemini-3.5-flash` |
| Dərin | `gemini-3.5-flash`, daha çox düşünmə ilə |

Google modelləri dəyişəndə, Secrets-ə `GEMINI_MODEL_QUICK`, `GEMINI_MODEL_SMART` və ya `GEMINI_MODEL_DEEP` əlavə edib başqa model adı yaza bilərsən. Kodu dəyişmək lazım deyil.

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

GitHub-da `config.js` faylını aç → qələm nişanı (Edit) → iki sətiri dəyiş → **Commit changes**.

Publishable (açıq) açarın saytda görünməsi normaldır, o gizli deyil. Bazanı Row Level Security, bağlı qeydiyyat və `ALLOWED_EMAILS` qoruyur. **`secret`, `service_role` və ya Gemini açarını bu fayla yazma.**

## Addım 5. GitHub Pages

1. [github.com](https://github.com) → **New repository** → ad: `jarvis` → **Public** → **Create repository**.
2. “uploading an existing file” → bütün faylları (qovluqlarla birlikdə) sürüklə → **Commit changes**.
3. **Settings → Pages**: Branch = `main`, qovluq = `/ (root)` → **Save**.
4. 1–2 dəqiqədən sonra sayt açılır: `https://istifadeciadi.github.io/jarvis/`

## Addım 6. Yoxla

1. Saytı **Chrome** və ya **Edge**-də aç → e-poçt və şifrə ilə daxil ol.
2. “Salam” yaz. Cavab gəlirsə, hər şey qoşulub.
3. Mikrofon düyməsinə bas, brauzer icazə istəyəndə **Allow** de, danış. Danışıb susanda mesaj özü göndərilir.

---

## Səs haqqında

- **Mikrofon** (danışığı yazıya çevirmək) Chrome və Edge-də işləyir. Firefox-da hələ yoxdur, Safari-də zəifdir.
- **Səsli cavab** brauzerin öz səslərindən istifadə edir. Azərbaycanca səs adətən **Microsoft Edge**-də olur (məs. Babək, Banu). Chrome-da azərbaycanca səs olmaya bilər, o zaman türkcə səs seçilir. Panelin **Səs** bölməsindən özün seçə bilərsən.
- **Əlləri sərbəst** rejimi: JARVIS cavabı bitirəndən sonra özü yenidən dinləməyə başlayır.
- Qısayollar: `Alt+M` mikrofon, `Esc` dayandır, `Enter` göndər, `Shift+Enter` yeni sətir.

## Problemlər və həlli

| Görünən xəta | Səbəb və həll |
|---|---|
| “Quraşdırma tamamlanmayıb” | `config.js` doldurulmayıb (Addım 4). |
| “E-poçt və ya şifrə yanlışdır” | Addım 2.4-də yaratdığın məlumatı yoxla. |
| “jarvis funksiyası tapılmadı” | Funksiyanın adı dəqiq `jarvis` olmalıdır (Addım 3). |
| “GEMINI_API_KEY sirri təyin edilməyib” | Secrets bölməsinə açarı əlavə et (Addım 3.1). |
| “Gemini API açarı yanlışdır” | Açarı AI Studio-dan yenidən kopyala, boşluq qalmasın. |
| “Gemini-nin pulsuz limiti doldu” | Bir dəqiqə gözlə və ya “Sürətli” rejimə keç. Gündəlik limit hər gün yenilənir. |
| “Model tapılmadı” | Secrets-də `GEMINI_MODEL_SMART` kimi başqa model adı yaz (AI Studio-da siyahını gör). |
| “Bazaya yazmaq olmadı” | `schema.sql` işə salınmayıb (Addım 2.2). |
| “Bu hesabın icazəsi yoxdur” | `ALLOWED_EMAILS`-dəki e-poçt daxil olduğun e-poçtla eyni olmalıdır. |
| `401 Invalid JWT` | Çıxış et, yenidən daxil ol. Davam edərsə, funksiyanın ayarlarında “Verify JWT”-ni söndür. Funksiya istifadəçini özü də yoxlayır. |
| Mikrofon işləmir | Chrome/Edge istifadə et, ünvan sətrindəki kilid nişanından mikrofona icazə ver. |

**Logları görmək:** Supabase → Edge Functions → `jarvis` → **Logs**.

## Dəyişmək istəsən

- **Xarakter və davranış:** `index.ts` faylında `systemPrompt` funksiyası.
- **Modellər:** `index.ts` faylının əvvəlində `MODELS` və ya Secrets.
- **Yeni bacarıq (alət):** `TOOLS` siyahısına təsvir əlavə et, `runTool` funksiyasında icrasını yaz. Məsələn: valyuta məzənnəsi, Telegram-a mesaj.
- **Görünüş:** `style.css` faylının əvvəlindəki rənglər (`--accent`, `--warm` və s.).
