// Version 1.0.0
// Supabase dependency is loaded by js/supabase.js.
import { supabase, isConfigured } from "./supabase.js";
const $ = (s) => document.querySelector(s);
const esc = (value="") => { const d=document.createElement("div"); d.textContent=value; return d.innerHTML; };

async function search(query) {
  const root = $("#statsResult");
  if (!isConfigured() || !supabase) { root.innerHTML = '<div class="empty-state">Configure Supabase in js/config.js first.</div>'; return; }
  const q = query.trim();
  let request = supabase.from("profiles").select("id,username,nickname,created_at,player_stats(games_played,games_won,clues_found,puzzles_solved,times_caught,extractions)");
  request = /^[0-9a-f-]{36}$/i.test(q) ? request.eq("id",q) : request.ilike("username",q);
  const { data, error } = await request.maybeSingle();
  if (error || !data) { root.innerHTML = '<div class="empty-state">No detective found.</div>'; return; }
  const s = Array.isArray(data.player_stats) ? (data.player_stats[0] || {}) : (data.player_stats || {});
  root.innerHTML = `<div class="eyebrow">PUBLIC PROFILE</div><h2>${esc(data.nickname)}</h2><p>@${esc(data.username)}</p><p class="fineprint">User ID: ${esc(data.id)}</p><div class="stat-cards"><div class="stat-card"><strong>${s.games_won||0}</strong><span>Games won</span></div><div class="stat-card"><strong>${s.clues_found||0}</strong><span>Clues found</span></div><div class="stat-card"><strong>${s.puzzles_solved||0}</strong><span>Puzzles solved</span></div><div class="stat-card"><strong>${s.times_caught||0}</strong><span>Times caught</span></div><div class="stat-card"><strong>${s.extractions||0}</strong><span>Final extractions</span></div><div class="stat-card"><strong>${s.games_played||0}</strong><span>Games joined</span></div></div>`;
}
$("#searchStatsForm")?.addEventListener("submit", e => { e.preventDefault(); search($("#statsQuery").value); });
