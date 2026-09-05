// Version 1.1.0
// Supabase Auth dependency is loaded by js/supabase.js.
import { supabase, isConfigured } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const authView = $("#authView");
const lobbyView = $("#lobbyView");
const gameView = $("#gameView");
const setupWarning = $("#setupWarning");

// Supabase Auth still expects an email identifier. The player never enters one;
// this deterministic internal address is generated from their username.
const AUTH_DOMAIN = "login.nightshift.local";
const usernameEmail = (username) => `${username.toLowerCase()}@${AUTH_DOMAIN}`;

export function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
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
    console.error(err);
    toast("Profile could not be loaded.");
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
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return toast("Enter a valid username.");
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameEmail(username),
      password
    });
    if (error) toast(error.message.replace(/email/gi, "username"));
  });

  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#signupUsername").value.trim();
    const nickname = $("#signupNickname").value.trim();
    const password = $("#signupPassword").value;
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return toast("Username must be 3–24 letters, numbers, or underscores.");
    if (nickname.length < 2) return toast("Nickname must be at least 2 characters.");
    if (password.length < 8) return toast("Password must be at least 8 characters.");

    const { data, error } = await supabase.auth.signUp({
      email: usernameEmail(username),
      password,
      options: { data: { username, nickname } }
    });
    if (error) return toast(error.message.replace(/email/gi, "username"));
    toast(data.session ? "Account created." : "Account created. If this persists, disable Supabase Confirm Email.");
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
