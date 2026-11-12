// ============================================================
//  JARVIS ayarları
//  Supabase → Project Settings → API Keys bölməsindən götür.
//  DİQQƏT: buraya yalnız "publishable" (açıq) açarı yaz.
//  Gizli açarları (secret / service_role / Anthropic) HEÇ VAXT bura yazma!
// ============================================================

window.JARVIS_CONFIG = {
  SUPABASE_URL: "https://SENIN-LAYIHEN.supabase.co",
  SUPABASE_KEY: "sb_publishable_BURAYA_YAZ",

  FUNCTION_NAME: "jarvis", // Edge Function-ın adı
  ASSISTANT_NAME: "JARVIS", // köməkçinin adı
  USER_NAME: "Vüqar", // JARVIS səni necə çağırsın
  CITY: "Baku", // hava üçün əsas şəhər (ingiliscə)
};
