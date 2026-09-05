// Version 1.2.0
// Supabase Auth dependency is loaded by js/supabase.js.
import { supabase, isConfigured } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const authView = $("#authView");
const lobbyView = $("#lobbyView");
const gameView = $("#gameView");
const setupWarning = $("#setupWarning");

// Supabase's email/password provider still requires an email-shaped identifier.
// Players never enter it. .example is a reserved documentation domain and is syntactically valid.
// Supabase Authentication > Providers > Email must have "Confirm email" disabled for this username-only flow.
const AUTH_DOMAIN = "accounts.nightshift.example";
const usernameEmail = (username) => `${username.toLowerCase()}@${AUTH_DOMAIN}`;

const ERROR_CODES = {
  INVALID_USERNAME: "NSD-AUTH-001",
  INVALID_NICKNAME: "NSD-AUTH-002",
  INVALID_PASSWORD: "NSD-AUTH-003",
  RATE_LIMITED: "NSD-AUTH-004",
  USERNAME_TAKEN: "NSD-AUTH-005",
  INVALID_CREDENTIALS: "NSD-AUTH-006",
  INVALID_AUTH_IDENTIFIER: "NSD-AUTH-007",
  SIGNUP_FAILED: "NSD-AUTH-008",
  PROFILE_FAILED: "NSD-AUTH-009",
  UNKNOWN: "NSD-AUTH-999"
};

function errorCode(error, fallback = ERROR_CODES.UNKNOWN) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  if (error?.status === 429 || text.includes("rate limit") || text.includes("too many")) return ERROR_CODES.RATE_LIMITED;
  if (text.includes("username already taken") || text.includes("duplicate key")) return ERROR_CODES.USERNAME_TAKEN;
  if (text.includes("invalid login credentials")) return ERROR_CODES.INVALID_CREDENTIALS;
  if (text.includes("email address") && text.includes("invalid")) return ERROR_CODES.INVALID_AUTH_IDENTIFIER;
  return fallback;
}

function showError(code, message) {
  console.error(`[${code}]`, message);
  toast(`${code}: ${message}`);
}

export function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

function setView(view) {
  [authView, lobbyView, gameView].forEach((el) => el?.classList.add("hidden"));
  view?.classList.remove("hidden");
}

async function loadProfile(user) {
  const { data, error } = await supabase.from("profiles").select("id,username,nickname").eq("id", user.id).single();
  if (error) throw error;
  window.currentProfile = data;
  $("#profileLine").textContent = `${data.nickname} · @${data.username} · ${data.id.slice(0, 8)}`;
  return data;
}

async function handleSignedIn(session) {
  if (!session?.user) return setView(authView);
  try {
    await loadProfile(session.user);
    setView(lobbyView);
    window.dispatchEvent(new CustomEvent("detective:signed-in", { detail: session.user }));
  } catch (err) {
    console.error(`[${ERROR_CODES.PROFILE_FAILED}]`, err);
    showError(ERROR_CODES.PROFILE_FAILED, "Profile could not be loaded.");
  }
}

function initTabs() {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b === button));
      $("#loginForm").classList.toggle("hidden", button.dataset.authTab !== "login");
      $("#signupForm").classList.toggle("hidden", button.dataset.authTab !== "signup");
    });
  });
}

async function initAuth() {
  initTabs();
  if (!isConfigured() || !supabase) {
    setupWarning.classList.remove("hidden");
    setupWarning.textContent = "Setup required: add your Supabase URL and publishable key in js/config.js, then run supabase-schema.sql in Supabase.";
    document.querySelectorAll("#loginForm button,#signupForm button,#createGameBtn,#joinForm button").forEach((b) => b.disabled = true);
    return;
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return showError(ERROR_CODES.INVALID_USERNAME, "Enter a valid username.");
    const { error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
    if (error) showError(errorCode(error, ERROR_CODES.INVALID_CREDENTIALS), error.message.replace(/email/gi, "username"));
  });

  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#signupUsername").value.trim();
    const nickname = $("#signupNickname").value.trim();
    const password = $("#signupPassword").value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return showError(ERROR_CODES.INVALID_USERNAME, "Username must be 3–24 letters, numbers, or underscores.");
    if (nickname.length < 2) return showError(ERROR_CODES.INVALID_NICKNAME, "Nickname must be at least 2 characters.");
    if (password.length < 8) return showError(ERROR_CODES.INVALID_PASSWORD, "Password must be at least 8 characters.");

    const { data, error } = await supabase.auth.signUp({
      email: usernameEmail(username),
      password,
      options: { data: { username, nickname } }
    });
    if (error) return showError(errorCode(error, ERROR_CODES.SIGNUP_FAILED), error.message.replace(/email/gi, "username"));
    toast(data.session ? "Account created." : "NSD-AUTH-010: Account created, but no session was returned. Confirm email must be disabled in Supabase.");
  });

  $("#logoutBtn").addEventListener("click", () => supabase.auth.signOut());
  const { data } = await supabase.auth.getSession();
  await handleSignedIn(data.session);
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      window.currentProfile = null;
      setView(authView);
      window.dispatchEvent(new Event("detective:signed-out"));
    } else handleSignedIn(session);
  });
}

initAuth();
