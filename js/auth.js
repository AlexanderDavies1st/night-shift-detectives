// Version 1.5.0
// Supabase Auth dependency is loaded by js/supabase.js.
import { supabase, isConfigured } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const authView = $("#authView");
const lobbyView = $("#lobbyView");
const gameView = $("#gameView");
const setupWarning = $("#setupWarning");

// Supabase's email/password provider requires an email-shaped identifier.
// Players never enter it. Do NOT use .example/.test domains: Supabase rejects test/example addresses.
// Confirm email must be disabled because players do not receive or verify email.
const AUTH_DOMAIN = "yqceksvgggfjmookfzhq.supabase.co";
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
  OAUTH_CALLBACK_FAILED: "NSD-AUTH-013",
  UNEXPECTED: "NSD-AUTH-999"
};

let signedInUserId = null;
let authListenerRegistered = false;
let profileLoadPromise = null;

function diagnostic(error, operation, extra = {}) {
  const details = {
    operation,
    timestamp: new Date().toISOString(),
    name: error?.name || null,
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || null,
    statusText: error?.statusText || null,
    details: error?.details || null,
    hint: error?.hint || null,
    ...extra
  };
  window.__nightShiftLastAuthError = details;
  console.error("[Night Shift Auth Diagnostic]", details, error);
  return details;
}

function errorCode(error, fallback = ERROR_CODES.UNEXPECTED) {
  const text = `${error?.message || ""} ${error?.code || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  if (error?.status === 429 || text.includes("rate limit") || text.includes("too many")) return ERROR_CODES.RATE_LIMITED;
  if (text.includes("username already taken") || text.includes("username already exists") || text.includes("duplicate key") || error?.code === "23505") return ERROR_CODES.USERNAME_TAKEN;
  if (text.includes("nsd-auth-db-") || text.includes("trigger") || text.includes("current transaction is aborted") || text.includes("profiles")) return ERROR_CODES.DATABASE_TRIGGER_FAILED;
  if (text.includes("invalid login credentials") || text.includes("email not confirmed") || text.includes("email_not_confirmed")) return ERROR_CODES.INVALID_CREDENTIALS;
  if (text.includes("oauth") || text.includes("callback") || text.includes("provider")) return ERROR_CODES.OAUTH_CALLBACK_FAILED;
  if (text.includes("email address") && text.includes("invalid")) return ERROR_CODES.INVALID_AUTH_IDENTIFIER;
  if (error instanceof TypeError || text.includes("failed to fetch") || text.includes("networkerror")) return ERROR_CODES.NETWORK_FAILED;
  return fallback;
}

function safeMessage(error, fallback) {
  return (error?.message || fallback)
    .replace(/yqceksvgggfjmookfzhq\.supabase\.co/gi, "internal auth identifier")
    .replace(/accounts\.nightshift\.example/gi, "internal auth identifier")
    .replace(/email/gi, "username");
}

function showError(code, message, error = null, operation = "unknown", extra = {}) {
  if (error) diagnostic(error, operation, extra);
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
  const user = session?.user;
  if (!user) {
    signedInUserId = null;
    profileLoadPromise = null;
    window.currentProfile = null;
    setView(authView);
    return;
  }

  // OAuth callbacks can emit INITIAL_SESSION and SIGNED_IN almost together.
  // Only load the profile once for a given user to prevent duplicate state changes.
  if (signedInUserId === user.id && profileLoadPromise) return profileLoadPromise;
  signedInUserId = user.id;
  profileLoadPromise = (async () => {
    try {
      await loadProfile(user);
      setView(lobbyView);
      window.dispatchEvent(new CustomEvent("detective:signed-in", { detail: user }));
    } catch (err) {
      showError(ERROR_CODES.PROFILE_FAILED, "Profile could not be loaded. Check the browser console for diagnostics.", err, "loadProfile", { userId: user.id });
    }
  })();
  return profileLoadPromise;
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

function registerAuthListener() {
  if (authListenerRegistered) return;
  authListenerRegistered = true;
  supabase.auth.onAuthStateChange((event, session) => {
    console.info("[NSD-AUTH-STATE]", event, session?.user?.id || null);
    if (!session) {
      signedInUserId = null;
      profileLoadPromise = null;
      window.currentProfile = null;
      setView(authView);
      window.dispatchEvent(new Event("detective:signed-out"));
      return;
    }
    // Do not perform another URL navigation here. Supabase already consumes the OAuth callback.
    void handleSignedIn(session);
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

  // Register BEFORE getSession(). OAuth callbacks can emit their session during initialization.
  registerAuthListener();

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return showError(ERROR_CODES.INVALID_USERNAME, "Enter a valid username.");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) return showError(errorCode(error, ERROR_CODES.INVALID_CREDENTIALS), safeMessage(error, "Login failed."), error, "signInWithPassword", { username });
    } catch (err) {
      showError(errorCode(err), safeMessage(err, "Login failed unexpectedly. Check the browser console for diagnostics."), err, "signInWithPassword:exception", { username });
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
      const normalizedUsername = username.toLowerCase();
      const { data: existingProfile, error: profileCheckError } = await supabase.from("profiles").select("id").eq("username", normalizedUsername).maybeSingle();
      if (profileCheckError) return showError(ERROR_CODES.PROFILE_FAILED, "Could not check username availability.", profileCheckError, "checkUsername", { username: normalizedUsername });
      if (existingProfile) return showError(ERROR_CODES.USERNAME_TAKEN, "That username is already taken.");

      const internalEmail = usernameEmail(normalizedUsername);
      console.info("[NSD-AUTH-TRACE] signup request", { operation: "signUp", username: normalizedUsername, internalIdentifier: internalEmail });
      const { data, error } = await supabase.auth.signUp({
        email: internalEmail,
        password,
        options: { data: { username: normalizedUsername, nickname } }
      });
      if (error) return showError(errorCode(error, ERROR_CODES.SIGNUP_FAILED), safeMessage(error, "Account creation failed."), error, "signUp", { username: normalizedUsername, internalIdentifier: internalEmail });
      if (!data?.user) return showError(ERROR_CODES.SIGNUP_FAILED, "Supabase returned no user after signup.", new Error("signUp returned no user"), "signUp:noUser", { username: normalizedUsername });

      if (!data.session) {
        const confirmed = Boolean(data.user.email_confirmed_at);
        const diagnosticError = new Error("signUp returned no session");
        const message = confirmed
          ? "Account was created and confirmed, but Supabase returned no session. Check Auth configuration or session persistence."
          : "Account was created, but Supabase returned no session because email confirmation is enabled. Disable Confirm email in Supabase Authentication > Providers > Email.";
        return showError(ERROR_CODES.NO_SESSION_AFTER_SIGNUP, message, diagnosticError, "signUp:noSession", {
          userId: data.user.id,
          username: normalizedUsername,
          emailConfirmed: confirmed,
          sessionReturned: false,
          authConfigRequired: !confirmed ? "disable_confirm_email" : "inspect_session_config"
        });
      }

      console.info("[NSD-AUTH-TRACE] signup success", { userId: data.user.id, username: normalizedUsername });
      toast("Account created.");
    } catch (err) {
      showError(errorCode(err), safeMessage(err, "Account creation failed unexpectedly. Check the browser console for diagnostics."), err, "signUp:exception", { username });
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
}

initAuth();
