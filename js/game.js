// Version 1.0.0
// Supabase Realtime dependency is loaded by js/supabase.js.
import { supabase, isConfigured } from "./supabase.js";
import { CONFIG } from "./config.js";
import { toast } from "./auth.js";

const $ = (s) => document.querySelector(s);
let session = null;
let sessionPlayer = null;
let players = [];
let shared = {};
let channel = null;
let currentRoom = "lobby";
let hidden = false;
let guardTimer = null;
let guardCountdownTimer = null;

const ROOMS = {
  lobby: { name: "Main Lobby", cls: "room-lobby", map: [2, 2], exits: { office: "West Office", security: "Security Hall", loading: "Front Exit" } },
  office: { name: "Records Office", cls: "room-office", map: [1, 2], exits: { lobby: "Lobby", archive: "Archive" } },
  archive: { name: "Archive Stacks", cls: "room-archive", map: [0, 2], exits: { office: "Office", evidence: "Evidence Room" } },
  security: { name: "Security Control", cls: "room-security", map: [2, 1], exits: { lobby: "Lobby", evidence: "Service Corridor" } },
  evidence: { name: "Evidence Room", cls: "room-evidence", map: [1, 1], exits: { archive: "Archive", security: "Security" } },
  loading: { name: "Loading Bay", cls: "room-loading", map: [2, 0], exits: { lobby: "Lobby" } }
};

const EVIDENCE = {
  keycard: ["Archive keycard", "A staff card marked A-17. Opens the archive terminal."],
  morse: ["Decoded transmission", "Morse message: LEDGER MOVED TO EVIDENCE 314."],
  photo: ["Security photograph", "A timestamped photograph showing the staged break-in team."],
  ledger: ["Black ledger", "The primary evidence. It must be carried out through the loading bay."]
};

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
function esc(value = "") { const d = document.createElement("div"); d.textContent = value; return d.innerHTML; }
function gameView() { $("#authView")?.classList.add("hidden"); $("#lobbyView")?.classList.add("hidden"); $("#gameView")?.classList.remove("hidden"); }
function lobbyView() { $("#gameView")?.classList.add("hidden"); $("#lobbyView")?.classList.remove("hidden"); }

async function createGame() {
  if (!window.currentProfile) return;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    const { data, error } = await supabase.from("game_sessions").insert({ code, host_id: window.currentProfile.id }).select().single();
    if (!error) return joinSessionRecord(data);
    if (error.code !== "23505") return toast(error.message);
  }
  toast("Could not generate a unique game code.");
}

async function joinByCode(code) {
  const cleaned = code.trim().toUpperCase();
  const { data, error } = await supabase.from("game_sessions").select("*").eq("code", cleaned).eq("status", "active").single();
  if (error || !data) return toast("Game not found or already finished.");
  const { count } = await supabase.from("session_players").select("*", { count: "exact", head: true }).eq("session_id", data.id);
  if (count >= CONFIG.MAX_PLAYERS) return toast("That game is full.");
  return joinSessionRecord(data);
}

async function joinSessionRecord(record) {
  session = record;
  const { data, error } = await supabase.from("session_players").upsert({ session_id: session.id, user_id: window.currentProfile.id, room: "lobby", is_hidden: false }, { onConflict: "session_id,user_id" }).select().single();
  if (error) return toast(error.message);
  sessionPlayer = data;
  currentRoom = data.room || "lobby";
  await supabase.from("game_state").upsert({ session_id: session.id, state_key: "visited:lobby", state_value: { visited: true } }, { onConflict: "session_id,state_key" });
  gameView();
  $("#gameCodeLabel").textContent = `Team code ${session.code}`;
  await loadEverything();
  subscribe();
}

async function loadEverything() {
  const [p, s, m] = await Promise.all([
    supabase.from("session_players").select("user_id,room,is_hidden,profiles(username,nickname)").eq("session_id", session.id),
    supabase.from("game_state").select("state_key,state_value").eq("session_id", session.id),
    supabase.from("messages").select("id,user_id,body,created_at,profiles(username,nickname)").eq("session_id", session.id).order("created_at").limit(80)
  ]);
  players = p.data || [];
  shared = Object.fromEntries((s.data || []).map((x) => [x.state_key, x.state_value]));
  renderMessages(m.data || []);
  renderAll();
}

function subscribe() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase.channel(`game:${session.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "session_players", filter: `session_id=eq.${session.id}` }, loadEverything)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_state", filter: `session_id=eq.${session.id}` }, async (payload) => {
      if (payload.new?.state_key) shared[payload.new.state_key] = payload.new.state_value;
      renderAll();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `session_id=eq.${session.id}` }, async () => {
      const { data } = await supabase.from("messages").select("id,user_id,body,created_at,profiles(username,nickname)").eq("session_id", session.id).order("created_at").limit(80);
      renderMessages(data || []);
    }).subscribe();
}

async function setState(key, value) {
  shared[key] = value;
  renderAll();
  const { error } = await supabase.from("game_state").upsert({ session_id: session.id, state_key: key, state_value: value, updated_by: window.currentProfile.id }, { onConflict: "session_id,state_key" });
  if (error) toast(error.message);
}

async function moveTo(room) {
  if (!ROOMS[room]) return;
  if (room === "archive" && !shared["evidence:keycard"]) return toast("The archive reader needs a keycard.");
  if (room === "evidence" && !shared["puzzle:lockpick"]) return openLockpick();
  currentRoom = room;
  hidden = false;
  await Promise.all([
    supabase.from("session_players").update({ room, is_hidden: false, last_seen: new Date().toISOString() }).eq("session_id", session.id).eq("user_id", window.currentProfile.id),
    setState(`visited:${room}`, { visited: true })
  ]);
  renderAll();
  maybeTriggerGuard();
}

function evidenceCount() { return Object.keys(EVIDENCE).filter((k) => shared[`evidence:${k}`]).length; }
function renderAll() { if (!session) return; renderScene(); renderMap(); renderPlayers(); renderEvidenceCount(); }

function renderScene() {
  const room = ROOMS[currentRoom];
  const scene = $("#scene");
  scene.className = `scene ${room.cls}`;
  $("#roomTitle").textContent = room.name;
  $("#sceneLabel").textContent = room.name.toUpperCase();
  const hotspots = [];
  let i = 0;
  for (const [dest, label] of Object.entries(room.exits)) {
    const positions = [[4,42,18,35],[78,38,18,38],[39,3,22,18],[35,75,28,18]];
    const p = positions[i++ % positions.length];
    hotspots.push(hotspot(`Go: ${label}`, p, () => moveTo(dest)));
  }
  if (currentRoom === "office" && !shared["evidence:keycard"]) hotspots.push(hotspot("Desk drawer", [42,54,21,22], collectKeycard));
  if (currentRoom === "office" && !shared["puzzle:morse"]) hotspots.push(hotspot("Radio receiver", [67,18,18,25], openMorse));
  if (currentRoom === "archive" && !shared["evidence:photo"]) hotspots.push(hotspot("File box A-17", [38,38,22,27], collectPhoto));
  if (["office","archive","security","evidence"].includes(currentRoom)) hotspots.push(hotspot(hidden ? "Leave hiding place" : "Hide", [8,68,18,20], toggleHide));
  if (currentRoom === "security") hotspots.push(hotspot("Guard monitor", [56,22,25,30], () => toast("Camera sweep shows the service corridor is watched every few minutes.")));
  if (currentRoom === "evidence" && !shared["evidence:ledger"]) hotspots.push(hotspot("Evidence locker 314", [41,34,23,34], collectLedger));
  if (currentRoom === "loading") hotspots.push(hotspot("Leave building", [68,22,25,58], attemptExtraction));
  const root = $("#hotspots"); root.innerHTML = ""; hotspots.forEach((el) => root.appendChild(el));
  $("#playerChips").innerHTML = players.filter(p => p.room === currentRoom).map(p => `<span class="player-chip">${p.is_hidden ? "▣ " : "● "}${esc(p.profiles?.nickname || "Detective")}</span>`).join("");
}

function hotspot(label, [x,y,w,h], fn) {
  const b = document.createElement("button"); b.className = "hotspot"; b.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%`; b.innerHTML = `<span>${esc(label)}</span>`; b.addEventListener("click", fn); return b;
}
function renderMap() {
  const map = $("#minimap"); map.innerHTML = "";
  Object.entries(ROOMS).forEach(([key, r]) => {
    const el = document.createElement("div");
    el.className = `map-room ${shared[`visited:${key}`] ? "visited" : ""} ${key === currentRoom ? "current" : ""}`;
    el.style.gridColumn = r.map[0] + 1; el.style.gridRow = 3 - r.map[1];
    const here = players.filter(p => p.room === key);
    el.innerHTML = `${shared[`visited:${key}`] || key === currentRoom ? esc(r.name) : "Unknown"}<div class="dots">${here.map(() => '<i class="dot"></i>').join("")}</div>`;
    map.appendChild(el);
  });
}
function renderPlayers() {
  $("#onlineCount").textContent = `${players.length} online`;
  $("#playerList").innerHTML = players.map(p => `<div class="player-row"><span>${esc(p.profiles?.nickname || "Detective")}</span><small>${esc(ROOMS[p.room]?.name || p.room)}${p.is_hidden ? " · hidden" : ""}</small></div>`).join("");
}
function renderEvidenceCount() { $("#evidenceCounter").textContent = `Evidence ${evidenceCount()}/4`; }

async function collectKeycard() { await setState("evidence:keycard", { foundBy: window.currentProfile.id, at: Date.now() }); await awardClue(); toast("Archive keycard added to the shared evidence bag."); }
async function collectPhoto() { await setState("evidence:photo", { foundBy: window.currentProfile.id, at: Date.now() }); await awardClue(); toast("Security photograph recovered."); }
async function collectLedger() { if (!shared["puzzle:morse"]) return toast("You do not know which locker contains the ledger yet."); await setState("evidence:ledger", { foundBy: window.currentProfile.id, at: Date.now() }); await awardClue(); toast("Black ledger recovered. Get it to the exit."); }
async function awardClue() { await supabase.rpc("increment_stat", { target_user: window.currentProfile.id, stat_name: "clues_found", amount: 1 }); }

function openMorse() {
  const d = $("#puzzleDialog");
  $("#puzzleContent").innerHTML = `<div class="puzzle-grid"><div class="eyebrow">RADIO INTERCEPT</div><h2>Decode the Morse message</h2><p>Translate the transmission. Spaces separate letters and a slash separates words.</p><div class="morse-box">.-.. . -.. --. . .-. / ...-- .---- ....-</div><div class="code-input"><input id="morseAnswer" placeholder="decoded message"><button id="morseSubmit" class="primary">Decode</button></div><p class="fineprint">Reference: .- A · -... B · -.-. C · -.. D · . E · --. G · .... H · .-.. L · -- M · .-. R · ... S · - T · ...-- 3 · .---- 1 · ....- 4</p></div>`;
  d.showModal();
  $("#morseSubmit").onclick = async () => {
    const ans = $("#morseAnswer").value.trim().toUpperCase().replace(/\s+/g," ");
    if (ans !== "LEDGER 314") return toast("That translation is not correct.");
    await setState("puzzle:morse", { solvedBy: window.currentProfile.id });
    await setState("evidence:morse", { foundBy: window.currentProfile.id, at: Date.now() });
    await awardClue(); d.close(); toast("Transmission decoded: LEDGER 314.");
  };
}

function openLockpick() {
  const d = $("#puzzleDialog");
  $("#puzzleContent").innerHTML = `<div class="puzzle-grid"><div class="eyebrow">MECHANICAL LOCK</div><h2>Pick the evidence-room lock</h2><p>Hold <b>A</b> or <b>D</b> to rotate the pick. Press <b>Space</b> while the pick is inside the gold tolerance zone.</p><div class="lockpick"><div class="lock-core"><div class="lock-target"></div><div id="lockLine" class="lock-line"></div></div></div><small id="lockStatus">Alignment: 0° / target 82–98°</small></div>`;
  d.showModal();
  let angle = 0; const keys = new Set();
  const update = () => { angle = Math.max(-90, Math.min(180, angle + (keys.has("d") ? 2.3 : 0) - (keys.has("a") ? 2.3 : 0))); const line=$("#lockLine"); if(line) line.style.transform=`rotate(${angle}deg)`; const s=$("#lockStatus"); if(s) s.textContent=`Alignment: ${Math.round(angle)}° / target 82–98°`; };
  const interval = setInterval(update, 16);
  const kd = async (e) => { const k=e.key.toLowerCase(); if(["a","d"].includes(k)) keys.add(k); if(e.code === "Space") { e.preventDefault(); if(angle >= 82 && angle <= 98) { cleanup(); await setState("puzzle:lockpick", { solvedBy: window.currentProfile.id }); await supabase.rpc("increment_stat", { target_user: window.currentProfile.id, stat_name: "puzzles_solved", amount: 1 }); d.close(); toast("Lock opened."); } else toast("The pick slipped. Align it closer to the target."); }};
  const ku = (e) => keys.delete(e.key.toLowerCase());
  const cleanup = () => { clearInterval(interval); window.removeEventListener("keydown",kd); window.removeEventListener("keyup",ku); };
  window.addEventListener("keydown",kd); window.addEventListener("keyup",ku); d.addEventListener("close", cleanup, { once:true });
}

async function toggleHide() {
  hidden = !hidden;
  await supabase.from("session_players").update({ is_hidden: hidden }).eq("session_id", session.id).eq("user_id", window.currentProfile.id);
  toast(hidden ? "You are hidden. Stay quiet." : "You left your hiding place.");
}

function maybeTriggerGuard() {
  if (["lobby","loading"].includes(currentRoom) || Math.random() > .42) return;
  clearTimeout(guardTimer);
  guardTimer = setTimeout(startGuardWarning, 3500 + Math.random() * 5500);
}
function startGuardWarning() {
  let left = CONFIG.GUARD_WARNING_SECONDS;
  const banner = $("#guardBanner"); banner.classList.remove("hidden"); $("#guardCountdown").textContent = left;
  try { const ctx = new AudioContext(); const osc=ctx.createOscillator(), gain=ctx.createGain(); osc.frequency.value=180; gain.gain.value=.035; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+.18); } catch {}
  clearInterval(guardCountdownTimer);
  guardCountdownTimer = setInterval(async () => {
    left--; $("#guardCountdown").textContent = left;
    if (left <= 0) { clearInterval(guardCountdownTimer); banner.classList.add("hidden"); await resolveGuard(); }
  },1000);
}
async function resolveGuard() {
  const { data } = await supabase.from("session_players").select("is_hidden").eq("session_id",session.id).eq("user_id",window.currentProfile.id).single();
  if (data?.is_hidden) return toast("The guard passed without seeing you.");
  toast("The guard spotted you and escorted you back to the lobby.");
  await supabase.rpc("increment_stat", { target_user: window.currentProfile.id, stat_name: "times_caught", amount: 1 });
  await moveTo("lobby");
}

async function attemptExtraction() {
  if (evidenceCount() < 4) return toast(`You still need ${4 - evidenceCount()} evidence item(s).`);
  const { data: team } = await supabase.from("session_players").select("user_id,room").eq("session_id",session.id);
  if (!team?.every(p => p.room === "loading")) return toast("Everyone must reach the loading bay before the team can extract.");
  const { error } = await supabase.rpc("complete_game", { target_session: session.id });
  if (error) return toast(error.message);
  alert("CASE CLOSED\n\nYour team escaped with all evidence. The ledger is now in safe hands.");
  await leaveGame(false);
}

function renderMessages(messages) {
  const root = $("#chatMessages"); root.innerHTML = messages.map(m => `<div class="message"><b>${esc(m.profiles?.nickname || "Detective")}</b>${esc(m.body)}</div>`).join(""); root.scrollTop = root.scrollHeight;
}
async function sendMessage(body) { if (!body.trim()) return; const { error } = await supabase.from("messages").insert({ session_id:session.id,user_id:window.currentProfile.id,body:body.trim().slice(0,300) }); if(error) toast(error.message); }
function showInventory() { $("#inventoryList").innerHTML = Object.entries(EVIDENCE).map(([key,[name,desc]]) => shared[`evidence:${key}`] ? `<div class="evidence-item"><strong>${esc(name)}</strong><small>${esc(desc)}</small></div>` : `<div class="evidence-item"><strong>Unknown evidence</strong><small>Not yet recovered.</small></div>`).join(""); $("#inventoryDialog").showModal(); }
function showHint() { const hints = !shared["evidence:keycard"] ? "Search the records office for a way into the archive." : !shared["puzzle:morse"] ? "The office radio is broadcasting a coded message." : !shared["puzzle:lockpick"] ? "The evidence room is mechanically locked." : !shared["evidence:photo"] ? "Search archive box A-17." : !shared["evidence:ledger"] ? "Use the decoded locker number in the evidence room." : "Get the entire team to the loading bay and leave with the evidence."; toast(hints); }

async function leaveGame(removePlayer=true) {
  if (!session) return;
  if (removePlayer) await supabase.from("session_players").delete().eq("session_id",session.id).eq("user_id",window.currentProfile.id);
  if(channel) await supabase.removeChannel(channel);
  session=null; sessionPlayer=null; players=[]; shared={}; currentRoom="lobby"; hidden=false;
  clearTimeout(guardTimer); clearInterval(guardCountdownTimer); $("#guardBanner").classList.add("hidden"); lobbyView();
}

function bind() {
  $("#createGameBtn")?.addEventListener("click", createGame);
  $("#joinForm")?.addEventListener("submit", e => { e.preventDefault(); joinByCode($("#joinCode").value); });
  $("#leaveGameBtn")?.addEventListener("click", () => leaveGame(true));
  $("#chatForm")?.addEventListener("submit", e => { e.preventDefault(); const input=$("#chatInput"); sendMessage(input.value); input.value=""; });
  $("#inventoryBtn")?.addEventListener("click", showInventory); $("#hintBtn")?.addEventListener("click", showHint);
  $("#closePuzzleBtn")?.addEventListener("click", () => $("#puzzleDialog").close()); $("#closeInventoryBtn")?.addEventListener("click", () => $("#inventoryDialog").close());
}

bind();
window.addEventListener("detective:signed-out", () => { if(session) leaveGame(false); });
if (!isConfigured()) console.info("Game backend is disabled until Supabase is configured.");
