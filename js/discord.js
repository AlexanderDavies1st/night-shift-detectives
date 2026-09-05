// Version 1.0.0
// Supabase Auth dependency is loaded by js/supabase.js.
import { supabase } from "./supabase.js";

const buttons = [document.querySelector("#discordLoginBtn"), document.querySelector("#discordSignupBtn")].filter(Boolean);

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__discordToastTimer);
  window.__discordToastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

async function signInWithDiscord() {
  if (!supabase) {
    toast("Discord login is unavailable until Supabase is configured.");
    return;
  }

  buttons.forEach((button) => { button.disabled = true; });
  try {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo }
    });
    if (error) {
      console.error("[NSD-AUTH-DISCORD]", error);
      toast(`Discord login failed: ${error.message}`);
      buttons.forEach((button) => { button.disabled = false; });
    }
  } catch (error) {
    console.error("[NSD-AUTH-DISCORD] Unexpected error", error);
    toast("Discord login failed unexpectedly. Check the browser console.");
    buttons.forEach((button) => { button.disabled = false; });
  }
}

buttons.forEach((button) => button.addEventListener("click", signInWithDiscord));
