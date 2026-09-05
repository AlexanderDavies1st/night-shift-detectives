// Version 1.0.0
// No install required. Configure your public Supabase project URL and publishable key below.
export const CONFIG = {
  SUPABASE_URL: "https://yqceksvgggfjmookfzhq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_6HzxA8PG1N5yBN7DtCwtcQ_JuSdcIB_",
  GAME_NAME: "Night Shift Detectives",
  MAX_PLAYERS: 6,
  GUARD_WARNING_SECONDS: 5
};

export const isConfigured = () =>
  CONFIG.SUPABASE_URL.startsWith("https://") &&
  !CONFIG.SUPABASE_URL.includes("YOUR_PROJECT") &&
  CONFIG.SUPABASE_ANON_KEY.length > 40 &&
  !CONFIG.SUPABASE_ANON_KEY.includes("YOUR_");
