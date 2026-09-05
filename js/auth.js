// Version 1.3.0
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
  NO_SESSION_AFTER_SIGNUP: "NSD-AUTH-010",
  NETWORK_FAILED: "NSD-AUTH-011",
  DATABASE_TRIGGER_FAILED: "NSD-AUTH-012",
  UNEXPECTED: "NSD-AUTH-999"
};

function diagnostic(error, operation) {
  const details = {
    operation,
    timestamp: new Date().toISOString(),
    name: error?.name || null,
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || null,
    statusText: error?.statusText || null,
    details: error?.details || null,
    hint: error?.hint || null
  };
  window.__nightShiftLastAuthError = details;
  console.error("[Night Shift Auth Diagnostic]", details, error);
  return details;
}

function errorCode(error, fallback = ERROR_CODES.UNEXPECTED) {
  const text = `${error?.message || ""} ${error?.code || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  if (error?.status === 429 || text.includes("rate limit") || text.includes("too many")) return ERROR_CODES.RATE_LIMITED;
  if (text.includes("username already taken") || text.includes("duplicate key") || error?.code === "23505") return ERROR_CODES.USERNAME_TAKEN;
  if (text.includes("invalid login credentials")) return ERROR_CODES.INVALID_CREDENTIALS;
  if (text.includes("email address") && text.includes("invalid")) return ERROR_CODES.INVALID_AUTH_IDENTIFIER;
  if (text.includes("trigger") || text.includes("current transaction is aborted") || text.includes("profiles")) return ERROR_CODES.DATABASE_TRIGGER_FAILED;
  if (error instanceof TypeError || text.includes("failed to fetch") || text.includes("networkerror")) return ERROR_CODES.NETWORK_FAILED;
  return fallback;
}

function safeMessage(error, fallback) {
  const message = error?.message || fallback;
  return message.replace(/accounts\.nightshift\.example/gi, "internal auth identifier").replace(/email/gi, "username");
}

function showError(code, message, error = null, operation = "unknown") {
  if (error) diagnostic(error, operation);
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
    showError(ERROR_CODES.PROFILE_FAILED, "Profile could not be loaded. Check the browser console for the diagnostic details.", err, "loadProfile");
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
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) return showError(errorCode(error, ERROR_CODES.INVALID_CREDENTIALS), safeMessage(error, "Login failed."), error, "signInWithPassword");
    } catch (err) {
      showError(errorCode(err, ERROR_CODES.UNEXPECTED), safeMessage(err, "Login failed unexpectedly. Check the browser console for diagnostics."), err, "signInWithPassword:exception");
    }
  });

  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#signupUsername").value.trim();
    const nickname = $("#signupNickname").value.trim();
    const password = $("#signupPassword").value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return showError(ERROR_CODES.INVALID_USERNAME, "Username must be 3–24 letters, numbers, or underscores.");
    if (nickname.length < 2) return showError(ERROR_CODES.INVALID_NICKNAME, "Nickname must be at least 2 characters.");
    if (password.length < 8) return showError(ERROR_CODES.INVALID_PASSWORD, "Password must be at least 8 characters.");

    try {
      // Give a clear client-side collision error before Auth is called. The database trigger remains the final race-safe check.
      const { data: existingProfile, error: profileCheckError } = await supabase.from("profiles").select("id").eq("username", username.toLowerCase()).maybeSingle();
      if (profileCheckError) return showError(ERROR_CODES.PROFILE_FAILED, "Could not check username availability.", profileCheckError, "checkUsername");
      if (existingProfile) return showError(ERROR_CODES.USERNAME_TAKEN, "That username is already taken.");

      const internalEmail = usernameEmail(username);
      console.info("[NSD-AUTH-TRACE] signup request", { operation: "signUp", username, internalIdentifier: internalEmail });
      const { data, error } = await supabase.auth.signUp({
        email: internalEmail,
        password,
        options: { data: { username: username.toLowerCase(), nickname } }
      });
      if (error) return showError(errorCode(error, ERROR_CODES.SIGNUP_FAILED), safeMessage(error, "Account creation failed."), error, "signUp");
      if (!data?.user) return showError(ERROR_CODES.SIGNUP_FAILED, "Supabase returned no user after signup. Check the browser console for diagnostics.", new Error("signUp returned no user"), "signUp:noUser");
      if (!data.session) return showError(ERROR_CODES.NO_SESSION_AFTER_SIGNUP, "Account was created, but no session was returned. Confirm email must be disabled in Supabase.", new Error("signUp returned no session"), "signUp:noSession");
      console.info("[NSD-AUTH-TRACE] signup success", { userId: data.user.id, username: username.toLowerCase() });
      toast("Account created.");
    } catch (err) {
      showError(errorCode(err, ERROR_CODES.UNEXPECTED), safeMessage(err, "Account creation failed unexpectedly. Check the browser console for diagnostics."), err, "signUp:exception");
    }
  });

  $("#logoutBtn").addEventListener("click", () => supabase.auth.signOut());
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) showError(ERROR_CODES.UNEXPECTED, "Could not restore the login session.", error, "getSession");
    else await handleSignedIn(data.session);
  } catch (err) {
    showError(ERROR_CODES.NETWORK_FAILED, "Could not connect to Supabase while restoring the session.", err, "getSession:exception");
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      window.currentProfile = null;
      setView(authView);
      window.dispatchEvent(new Event("detective:signed-out"));
    } else handleSignedIn(session);
  });
}

initAuth();
