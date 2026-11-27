"use strict";
(() => {
const DIRS = {
  down:  { x: 0,  y: 1,  row: 0 },
  left:  { x: -1, y: 0,  row: 1 },
  right: { x: 1,  y: 0,  row: 2 },
  up:    { x: 0,  y: -1, row: 3 },
};
const FONT = "bold 8px monospace";
const UNKNOWN = { name: "unknown", color: "#f0f", solid: true };
const bust = "?v=" + Date.now();

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

let cfg, T, W, H, M;
let tiles = {}, tileImgs = {}, playerImg = null;
const maps = {}, flags = {}, inv = {};
let map = null, player, dialog = null, fade = null, debug = false;
let steps = 0, sinceEnc = 0, tick = 0;

// ---------- loading ----------
async function loadJSON(path) {
  const r = await fetch(path + bust, { cache: "no-store" });
  if (!r.ok) throw new Error(path + " (" + r.status + ")");
  return r.json();
}
function loadImage(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src + bust;
  });
}
async function loadMap(name) {
  if (!maps[name]) {
    const m = await loadJSON("data/maps/" + name + ".json");
    m.id = name; m.h = m.tiles.length; m.w = m.tiles[0].length;
    m.npcs = m.npcs || []; m.chests = m.chests || []; m.warps = m.warps || [];
    for (const n of m.npcs) n.img = await loadImage(n.sprite);
    maps[name] = m;
  }
  return maps[name];
}
function applyUrlOverrides() {
  // e.g. index.html?stepFrames=10&turnDelayFrames=0
  for (const [k, v] of new URLSearchParams(location.search)) {
    if (k in cfg.movement) cfg.movement[k] = (v === "true" || v === "false") ? v === "true" : Number(v);
  }
}

// ---------- input ----------
const keyHeld = [];
let touchDir = null, actionQueued = false;
const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
window.addEventListener("keydown", e => {
  const d = KEYMAP[e.key];
  if (d) { e.preventDefault(); if (!keyHeld.includes(d)) keyHeld.push(d); }
  else if (["z", "Z", " ", "Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) actionQueued = true; }
  else if (e.key === "`") debug = !debug;
});
window.addEventListener("keyup", e => {
  const d = KEYMAP[e.key], i = keyHeld.indexOf(d);
  if (i >= 0) keyHeld.splice(i, 1);
});
function wantDir() { return touchDir || keyHeld[keyHeld.length - 1] || null; }
function consumeAction() { const a = actionQueued; actionQueued = false; return a; }

function setupTouch() {
  const pad = document.getElementById("dpad"), knob = document.getElementById("knob");
  const btn = document.getElementById("abtn");
  let active = false;
  function move(e) {
    const r = pad.getBoundingClientRect(), rad = r.width / 2;
    const dx = e.clientX - (r.left + rad), dy = e.clientY - (r.top + rad);
    if (Math.hypot(dx, dy) < rad * cfg.touch.deadZone) touchDir = null;
    else touchDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    const k = Math.min(1, Math.hypot(dx, dy) / rad) * rad * 0.55, a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * k}px, ${Math.sin(a) * k}px)`;
  }
  function end() { active = false; touchDir = null; knob.style.transform = "translate(0,0)"; }
  pad.addEventListener("pointerdown", e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); active = true; move(e); });
  pad.addEventListener("pointermove", e => { if (active) { e.preventDefault(); move(e); } });
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  btn.addEventListener("pointerdown", e => { e.preventDefault(); actionQueued = true; btn.classList.add("on"); });
  const off = () => btn.classList.remove("on");
  btn.addEventListener("pointerup", off); btn.addEventListener("pointercancel", off);
  for (const ev of ["contextmenu", "gesturestart"]) document.addEventListener(ev, e => e.preventDefault());
}

// ---------- world helpers ----------
const tileAt = (x, y) => tiles[map.tiles[y][x]] || UNKNOWN;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h;
const npcAt = (x, y) => map.npcs.find(n => n.x === x && n.y === y);
const chestAt = (x, y) => map.chests.find(c => c.x === x && c.y === y);
function blocked(x, y) {
  return !inBounds(x, y) || tileAt(x, y).solid || npcAt(x, y) || chestAt(x, y);
}

// ---------- dialogue ----------
function wrap(text, maxW) {
  ctx.font = FONT;
  const lines = []; let line = "";
  for (const w of text.split(" ")) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function openDialog(src) {
  const pages = [];
  for (const s of Array.isArray(src) ? src : [src]) {
    const lines = wrap(s, W - 32);
    for (let i = 0; i < lines.length; i += 3) pages.push(lines.slice(i, i + 3));
  }
  dialog = { pages, i: 0, chars: 0 };
}
function updateDialog() {
  const page = dialog.pages[dialog.i], total = page.reduce((n, l) => n + l.length, 0);
  const act = consumeAction();
  if (dialog.chars < total) { dialog.chars = act ? total : dialog.chars + cfg.text.charsPerFrame; }
  else if (act) { dialog.i++; dialog.chars = 0; if (dialog.i >= dialog.pages.length) dialog = null; }
}

// ---------- player logic ----------
function startStep(dir) {
  const d = DIRS[dir];
  Object.assign(player, { dir, moving: true, t: 0, tx: player.x + d.x, ty: player.y + d.y, parity: player.parity ^ 1 });
}
function tryStep(dir) {
  const d = DIRS[dir];
  if (!blocked(player.x + d.x, player.y + d.y)) startStep(dir);
}
function interact() {
  const d = DIRS[player.dir], x = player.x + d.x, y = player.y + d.y;
  const npc = npcAt(x, y), chest = chestAt(x, y);
  if (npc) openDialog(npc.dialog || "...");
  else if (chest) {
    const key = map.id + ":" + chest.x + "," + chest.y;
    if (flags[key]) openDialog("The chest is empty.");
    else { flags[key] = true; inv[chest.item] = (inv[chest.item] || 0) + 1; openDialog(chest.text || "Found " + chest.item + "!"); }
  }
}
function idle(want, chained) {
  if (!chained && consumeAction()) { interact(); return; }
  if (!want) { player.turnWait = 0; return; }
  if (want !== player.dir) {
    player.dir = want;
    if (!(chained && M.instantTurnWhenWalking)) { player.turnWait = M.turnDelayFrames; return; }
  }
  if (player.turnWait > 0) { player.turnWait--; return; }
  tryStep(want);
}
function finishStep() {
  player.x = player.tx; player.y = player.ty; player.moving = false;
  steps++; sinceEnc++;
  const w = map.warps.find(w => w.x === player.x && w.y === player.y);
  if (w) { startWarp(w); return; }
  const t = tileAt(player.x, player.y);
  if (t.encounter && map.encounters !== false && sinceEnc >= cfg.encounters.minSteps && Math.random() < cfg.encounters.chancePerStep) {
    sinceEnc = 0;
    openDialog("An enemy appears! (Battle goes here.)");
    return;
  }
  idle(wantDir(), true);
}
function startWarp(w) {
  fade = { state: "out", t: 0, warp: w, ready: false };
  loadMap(w.map).then(() => { if (fade) fade.ready = true; })
    .catch(() => { fade = null; openDialog("Missing map file: " + w.map); });
}
function applyWarp(w) {
  map = maps[w.map];
  player.x = w.toX; player.y = w.toY; player.dir = w.dir || player.dir;
  player.moving = false; player.turnWait = 0;
}

function update() {
  tick++;
  if (fade) {
    fade.t++;
    if (fade.state === "out") { if (fade.t >= M.fadeFrames && fade.ready) { applyWarp(fade.warp); fade = { state: "in", t: 0 }; } }
    else if (fade.t >= M.fadeFrames) fade = null;
    return;
  }
  if (dialog) { updateDialog(); return; }
  const want = wantDir();
  if (player.moving) { if (++player.t >= M.stepFrames) finishStep(); return; }
  idle(want, false);
}

// ---------- rendering ----------
function drawActor(img, px, py, dir, moving, parity, color, fw, fh) {
  const x = Math.round(px), y = Math.round(py);
  if (img) {
    const col = moving ? 1 + parity : 0;
    ctx.drawImage(img, col * fw, DIRS[dir].row * fh, fw, fh, x, y + T - fh, fw, fh);
    return;
  }
  const bob = moving && (tick % 8 < 4) ? 1 : 0;
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(x + 2, y + T - 3, T - 4, 2);
  ctx.fillStyle = color; ctx.fillRect(x + 2, y + 2 + bob, T - 4, T - 5 - bob);
  ctx.fillStyle = "#fff"; const d = DIRS[dir], cx = x + T / 2 - 1, cy = y + T / 2 - 1;
  ctx.fillRect(cx + d.x * 4, cy + d.y * 4, 2, 2);
}
function render() {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (!map) return;
  let px = player.x * T, py = player.y * T;
  if (player.moving) {
    const p = player.t / M.stepFrames;
    px += (player.tx - player.x) * T * p; py += (player.ty - player.y) * T * p;
  }
  const camFor = (p, size, view) => size <= view ? -Math.round((view - size) / 2) : Math.min(size - view, Math.max(0, Math.round(p + T / 2 - view / 2)));
  const camX = camFor(px, map.w * T, W), camY = camFor(py, map.h * T, H);

  for (let y = Math.max(0, Math.floor(camY / T)); y < Math.min(map.h, Math.ceil((camY + H) / T)); y++) {
    for (let x = Math.max(0, Math.floor(camX / T)); x < Math.min(map.w, Math.ceil((camX + W) / T)); x++) {
      const ch = map.tiles[y][x], t = tiles[ch] || UNKNOWN, sx = x * T - camX, sy = y * T - camY;
      if (tileImgs[ch]) ctx.drawImage(tileImgs[ch], sx, sy, T, T);
      else { ctx.fillStyle = t.color; ctx.fillRect(sx, sy, T, T); ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(sx, sy, T, 1); ctx.fillRect(sx, sy, 1, T); }
    }
  }
  for (const c of map.chests) {
    const open = flags[map.id + ":" + c.x + "," + c.y], x = c.x * T - camX, y = c.y * T - camY;
    ctx.fillStyle = open ? "#6a4a20" : "#d09030"; ctx.fillRect(x + 2, y + 4, T - 4, T - 6);
    ctx.fillStyle = "#000"; ctx.fillRect(x + 2, y + 8, T - 4, 1);
  }
  for (const n of map.npcs) drawActor(n.img, n.x * T - camX, n.y * T - camY, n.dir || "down", false, 0, n.color || "#c44", T, T);
  drawActor(playerImg, px - camX, py - camY, player.dir, player.moving, player.parity, cfg.player.color, cfg.player.frameW, cfg.player.frameH);

  if (fade) {
    const a = Math.min(1, fade.t / Math.max(1, M.fadeFrames));
    ctx.fillStyle = `rgba(0,0,0,${fade.state === "out" ? a : 1 - a})`; ctx.fillRect(0, 0, W, H);
  }
  if (dialog) drawDialog();
  if (debug) {
    ctx.font = FONT; ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(`${map.name} (${player.x},${player.y}) ${tileAt(player.x, player.y).name}  steps:${steps}`, 3, 9);
    ctx.fillText("items: " + (Object.entries(inv).map(([k, v]) => k + "x" + v).join(", ") || "none"), 3, 19);
  }
}
function drawDialog() {
  const bx = 8, by = H - 56, bw = W - 16, bh = 48;
  ctx.fillStyle = "#fff"; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = "#12206a"; ctx.fillRect(bx, by, bw, bh);
  ctx.font = FONT; ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
  let left = Math.floor(dialog.chars);
  dialog.pages[dialog.i].forEach((line, i) => {
    ctx.fillText(line.slice(0, Math.max(0, left)), bx + 8, by + 7 + i * 12);
    left -= line.length;
  });
  ctx.textBaseline = "alphabetic";
  const total = dialog.pages[dialog.i].reduce((n, l) => n + l.length, 0);
  if (dialog.chars >= total && tick % 40 < 24) {
    ctx.beginPath(); ctx.moveTo(bx + bw - 14, by + bh - 10); ctx.lineTo(bx + bw - 6, by + bh - 10); ctx.lineTo(bx + bw - 10, by + bh - 5); ctx.fill();
  }
}

// ---------- boot ----------
function resize() {
  const dpr = window.devicePixelRatio || 1, landscape = innerWidth > innerHeight;
  const availH = landscape ? innerHeight : innerHeight - 210;
  const s = Math.max(1, Math.floor(Math.min(innerWidth * dpr / W, availH * dpr / H)));
  canvas.style.width = (W * s / dpr) + "px"; canvas.style.height = (H * s / dpr) + "px";
}
let last = 0, acc = 0;
function frame(now) {
  acc += Math.min(now - last, 100); last = now;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  render();
  requestAnimationFrame(frame);
}
async function boot() {
  try {
    cfg = await loadJSON("data/config.json");
    applyUrlOverrides();
    T = cfg.tileSize; W = cfg.screen.width; H = cfg.screen.height; M = cfg.movement; debug = cfg.debug;
    canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false;
    tiles = await loadJSON("data/tiles.json");
    for (const [ch, t] of Object.entries(tiles)) tileImgs[ch] = await loadImage(t.image);
    playerImg = await loadImage(cfg.player.sprite);
    map = await loadMap(cfg.startMap);
    player = { x: map.start.x, y: map.start.y, dir: "down", moving: false, t: 0, tx: 0, ty: 0, parity: 0, turnWait: 0 };
    setupTouch(); resize(); addEventListener("resize", resize);
    last = performance.now(); requestAnimationFrame(frame);
  } catch (e) {
    document.getElementById("error").textContent = "Could not load game data: " + e.message +
      ". Serve the folder over http (GitHub Pages, or run: python3 -m http.server) instead of opening the file directly.";
  }
}
boot();
})();
