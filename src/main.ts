import "./style.css";

/* ============================================================
   FRUIT CATCHER
   Tangkap buah yang jatuh, hindari bom. Kumpulkan skor sebanyak
   mungkin sebelum nyawa habis.
   ============================================================ */

const foundCanvas = document.getElementById("gameCanvas") as HTMLCanvasElement | null;
if (!foundCanvas) throw new Error("Elemen canvas #gameCanvas tidak ditemukan.");
const canvas: HTMLCanvasElement = foundCanvas;

const foundCtx = canvas.getContext("2d");
if (!foundCtx) throw new Error("Browser ini tidak mendukung Canvas 2D.");
const ctx: CanvasRenderingContext2D = foundCtx;

const W = 480;
const H = 640;
canvas.width = W;
canvas.height = H;

const BASKET_Y = H - 64;
const BASKET_W = 100;
const BASKET_H = 32;
const MAX_LIVES = 3;
const MAX_LEVEL = 12;
const HIGH_SCORE_KEY = "fruit-catcher-highscore";
const FONT = "'Segoe UI', system-ui, sans-serif";

type GameState = "menu" | "playing" | "paused" | "over";
type FruitKind =
  | "apple"
  | "orange"
  | "banana"
  | "watermelon"
  | "grape"
  | "gold"
  | "bomb";

interface Fruit {
  kind: FruitKind;
  x: number;
  y: number;
  vy: number;
  r: number;
  rot: number;
  vr: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
}

interface Bokeh {
  x: number;
  y: number;
  r: number;
  speed: number;
  alpha: number;
  hue: number;
}

const FRUIT_INFO: Record<FruitKind, { points: number; radius: number; color: string }> = {
  apple: { points: 10, radius: 16, color: "#f87171" },
  orange: { points: 10, radius: 15, color: "#fb923c" },
  banana: { points: 15, radius: 17, color: "#facc15" },
  watermelon: { points: 20, radius: 19, color: "#4ade80" },
  grape: { points: 25, radius: 17, color: "#c084fc" },
  gold: { points: 50, radius: 16, color: "#fde047" },
  bomb: { points: 0, radius: 16, color: "#f87171" },
};

/* ---------- State permainan ---------- */

let state: GameState = "menu";
let score = 0;
let highScore = loadHighScore();
let lives = MAX_LIVES;
let level = 1;
let caught = 0;
let combo = 0;
let bestCombo = 0;
let spawnTimer = 0;
let shake = 0;
let banner = "";
let bannerTimer = 0;
let elapsed = 0;
let muted = false;

const fruits: Fruit[] = [];
const particles: Particle[] = [];
const floats: FloatText[] = [];
const keys = new Set<string>();
const basket = { x: W / 2, targetX: W / 2 };

/* ---------- Gradien & latar (dibuat sekali) ---------- */

const skyGradient = ctx.createLinearGradient(0, 0, 0, H);
skyGradient.addColorStop(0, "#0a1020");
skyGradient.addColorStop(0.5, "#122a44");
skyGradient.addColorStop(1, "#1b4150");

const vignetteGradient = ctx.createRadialGradient(
  W / 2,
  H * 0.42,
  H * 0.18,
  W / 2,
  H * 0.52,
  H * 0.72,
);
vignetteGradient.addColorStop(0, "rgba(0,0,0,0)");
vignetteGradient.addColorStop(1, "rgba(0,0,0,0.5)");

const hudGradient = ctx.createLinearGradient(0, 0, 0, 104);
hudGradient.addColorStop(0, "rgba(4, 10, 20, 0.7)");
hudGradient.addColorStop(1, "rgba(4, 10, 20, 0)");

const bokeh: Bokeh[] = Array.from({ length: 26 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: 1.5 + Math.random() * 3,
  speed: 8 + Math.random() * 24,
  alpha: 0.12 + Math.random() * 0.3,
  hue: 160 + Math.random() * 100,
}));

/* ---------- Audio kecil (WebAudio) ---------- */

let audio: AudioContext | null = null;

function initAudio(): void {
  if (muted) return;
  if (!audio) {
    const Ctor = window.AudioContext;
    if (Ctor) audio = new Ctor();
  }
  if (audio && audio.state === "suspended") void audio.resume();
}

function tone(
  freq: number,
  duration = 0.12,
  type: OscillatorType = "sine",
  volume = 0.07,
  delay = 0,
  slideTo?: number,
): void {
  if (!audio || muted) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function sfxCatch(comboNow: number): void {
  tone(470 + Math.min(comboNow, 12) * 32, 0.09, "triangle", 0.06);
}

function sfxGold(): void {
  tone(700, 0.1, "sine", 0.07);
  tone(1050, 0.16, "sine", 0.06, 0.08);
}

function sfxBomb(): void {
  tone(180, 0.32, "sawtooth", 0.1, 0, 55);
  tone(90, 0.3, "square", 0.06, 0.02, 40);
}

function sfxLevel(): void {
  tone(523, 0.1, "triangle", 0.07);
  tone(659, 0.1, "triangle", 0.07, 0.09);
  tone(784, 0.16, "triangle", 0.07, 0.18);
}

function sfxStart(): void {
  tone(523, 0.09, "triangle", 0.06);
  tone(784, 0.14, "triangle", 0.06, 0.09);
}

function sfxOver(): void {
  tone(440, 0.16, "triangle", 0.07);
  tone(330, 0.16, "triangle", 0.07, 0.14);
  tone(220, 0.34, "triangle", 0.07, 0.28);
}

/* ---------- Util ---------- */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

function starPath(c: CanvasRenderingContext2D, spikes: number, outer: number, inner: number): void {
  c.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function heartPath(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.beginPath();
  c.moveTo(x, y + s * 0.72);
  c.bezierCurveTo(x - s * 1.45, y - s * 0.35, x - s * 0.72, y - s * 1.35, x, y - s * 0.5);
  c.bezierCurveTo(x + s * 0.72, y - s * 1.35, x + s * 1.45, y - s * 0.35, x, y + s * 0.72);
  c.closePath();
}

function loadHighScore(): number {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  } catch {
    /* localStorage bisa diblokir, abaikan saja */
  }
}

/* ---------- Logika permainan ---------- */

function pickKind(): FruitKind {
  const bombChance = Math.min(0.22, 0.06 + level * 0.015);
  const roll = Math.random();
  if (roll < bombChance) return "bomb";
  if (roll < bombChance + 0.05) return "gold";
  const pool: FruitKind[] = ["apple", "orange", "banana", "watermelon", "grape"];
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnFruit(): void {
  const kind = pickKind();
  const info = FRUIT_INFO[kind];
  const speedBoost = 0.9 + Math.random() * 0.5;
  fruits.push({
    kind,
    x: 34 + Math.random() * (W - 68),
    y: -info.radius - 12,
    vy: (105 + level * 16) * speedBoost,
    r: info.radius,
    rot: (Math.random() - 0.5) * 0.7,
    vr: (Math.random() - 0.5) * 2.4,
  });
}

function addFloat(x: number, y: number, text: string, color: string, life = 1.1): void {
  floats.push({ x, y, text, color, life, max: life });
}

function burst(x: number, y: number, color: string, count: number, speed: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const sp = speed * (0.35 + Math.random() * 0.65);
    const life = 0.45 + Math.random() * 0.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp - 40,
      life,
      max: life,
      size: 2 + Math.random() * 3.5,
      color,
    });
  }
}

function startGame(): void {
  state = "playing";
  score = 0;
  lives = MAX_LIVES;
  level = 1;
  caught = 0;
  combo = 0;
  bestCombo = 0;
  spawnTimer = 0.5;
  shake = 0;
  banner = "";
  bannerTimer = 0;
  fruits.length = 0;
  particles.length = 0;
  floats.length = 0;
  basket.x = W / 2;
  basket.targetX = W / 2;
  initAudio();
  sfxStart();
}

function endGame(): void {
  state = "over";
  if (score > highScore) {
    highScore = score;
    saveHighScore();
  }
  sfxOver();
}

function catchFruit(fruit: Fruit): void {
  const info = FRUIT_INFO[fruit.kind];

  if (fruit.kind === "bomb") {
    lives -= 1;
    combo = 0;
    shake = 1;
    burst(fruit.x, fruit.y, "#fb7185", 18, 220);
    addFloat(fruit.x, fruit.y - 10, "-1 ❤", "#fb7185", 1.2);
    sfxBomb();
    if (lives <= 0) endGame();
    return;
  }

  combo += 1;
  bestCombo = Math.max(bestCombo, combo);
  const multiplier = 1 + Math.min(4, Math.floor(combo / 5));
  const gained = info.points * multiplier;
  score += gained;
  caught += 1;

  burst(
    fruit.x,
    fruit.y,
    info.color,
    fruit.kind === "gold" ? 22 : 12,
    fruit.kind === "gold" ? 240 : 160,
  );
  addFloat(
    fruit.x,
    fruit.y - 8,
    `+${gained}${multiplier > 1 ? ` x${multiplier}` : ""}`,
    fruit.kind === "gold" ? "#fde047" : info.color,
  );

  if (fruit.kind === "gold") {
    if (lives < MAX_LIVES) {
      lives += 1;
      addFloat(fruit.x, fruit.y - 32, "+1 ❤", "#fda4af", 1.2);
    }
    sfxGold();
  } else {
    sfxCatch(combo);
  }

  const newLevel = Math.min(MAX_LEVEL, 1 + Math.floor(caught / 8));
  if (newLevel > level) {
    level = newLevel;
    banner = `LEVEL ${level}`;
    bannerTimer = 1.6;
    sfxLevel();
  }
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 380 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function updateFloats(dt: number): void {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt;
    if (f.life <= 0) {
      floats.splice(i, 1);
      continue;
    }
    f.y -= 38 * dt;
  }
}

function update(dt: number): void {
  // Latar tetap hidup di semua kondisi (kecuali pause).
  if (state !== "paused") {
    for (const b of bokeh) {
      b.y += b.speed * dt;
      if (b.y - b.r > H) {
        b.y = -b.r;
        b.x = Math.random() * W;
      }
    }
    updateParticles(dt);
    updateFloats(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
    if (bannerTimer > 0) bannerTimer = Math.max(0, bannerTimer - dt);
  }

  if (state !== "playing") return;

  // Gerak keranjang via keyboard.
  let dir = 0;
  if (keys.has("arrowleft") || keys.has("a")) dir -= 1;
  if (keys.has("arrowright") || keys.has("d")) dir += 1;
  if (dir !== 0) basket.targetX += dir * 540 * dt;

  basket.targetX = clamp(basket.targetX, BASKET_W / 2 + 6, W - BASKET_W / 2 - 6);
  basket.x += (basket.targetX - basket.x) * Math.min(1, dt * 18);

  // Spawn buah baru.
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnFruit();
    spawnTimer = Math.max(0.32, 0.95 - level * 0.055) * (0.75 + Math.random() * 0.5);
  }

  // Gerakkan & periksa buah.
  for (let i = fruits.length - 1; i >= 0; i--) {
    const fruit = fruits[i];
    fruit.y += fruit.vy * dt;
    fruit.rot += fruit.vr * dt;

    const withinBasketX = Math.abs(fruit.x - basket.x) <= BASKET_W / 2 + fruit.r * 0.3;
    const atRim = fruit.y + fruit.r >= BASKET_Y && fruit.y - fruit.r <= BASKET_Y + BASKET_H + 10;

    if (withinBasketX && atRim) {
      catchFruit(fruit);
      fruits.splice(i, 1);
      if (state !== "playing") break;
      continue;
    }

    if (fruit.y - fruit.r > H) {
      if (fruit.kind !== "bomb") {
        combo = 0;
        addFloat(fruit.x, H - 30, "MISS", "#94a3b8", 0.8);
      }
      fruits.splice(i, 1);
    }
  }
}

/* ---------- Menggambar latar & objek ---------- */

function drawBackground(time: number): void {
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, W, H);

  // Cahaya bulan di kanan atas.
  const glow = ctx.createRadialGradient(W - 92, 96, 8, W - 92, 96, 150);
  glow.addColorStop(0, "rgba(255, 236, 190, 0.22)");
  glow.addColorStop(1, "rgba(255, 236, 190, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(W - 250, 0, 250, 260);

  ctx.fillStyle = "rgba(255, 245, 214, 0.85)";
  ctx.beginPath();
  ctx.arc(W - 92, 96, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(230, 214, 170, 0.35)";
  ctx.beginPath();
  ctx.arc(W - 84, 88, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W - 100, 106, 4, 0, Math.PI * 2);
  ctx.fill();

  // Bokeh / kunang-kunang yang melayang.
  for (const b of bokeh) {
    ctx.fillStyle = `hsla(${b.hue}, 75%, 70%, ${b.alpha})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bukit jauh.
  ctx.fillStyle = "#0d2a35";
  ctx.beginPath();
  ctx.moveTo(0, H - 96);
  ctx.bezierCurveTo(W * 0.18, H - 150, W * 0.42, H - 70, W * 0.62, H - 108);
  ctx.bezierCurveTo(W * 0.8, H - 140, W * 0.92, H - 88, W, H - 112);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Bukit dekat.
  ctx.fillStyle = "#0a3a33";
  ctx.beginPath();
  ctx.moveTo(0, H - 54);
  ctx.bezierCurveTo(W * 0.2, H - 92, W * 0.38, H - 34, W * 0.58, H - 60);
  ctx.bezierCurveTo(W * 0.76, H - 84, W * 0.9, H - 44, W, H - 62);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Rumput yang bergoyang pelan.
  ctx.strokeStyle = "rgba(74, 222, 128, 0.28)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const gx = (i / 26) * W + 6;
    const gy = H - 46 + Math.sin(i * 1.7) * 6;
    const sway = Math.sin(time * 1.4 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(gx, gy + 8);
    ctx.quadraticCurveTo(gx + sway, gy - 4, gx + sway * 1.6, gy - 12);
    ctx.stroke();
  }

  ctx.fillStyle = vignetteGradient;
  ctx.fillRect(0, 0, W, H);
}

function drawBasket(): void {
  const x = basket.x;
  const y = BASKET_Y;
  const w = BASKET_W;
  const h = BASKET_H;

  // Bayangan.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#04110f";
  ctx.beginPath();
  ctx.ellipse(x, y + h + 4, w * 0.52, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pegangan.
  ctx.strokeStyle = "#b97b3f";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y + 2, w * 0.34, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.strokeStyle = "#e0a45f";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y + 2, w * 0.34, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();

  // Badan keranjang (trapesium).
  const bottomW = w * 0.74;
  const bx = x - bottomW / 2;
  const by = y + h;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(bx + bottomW, by);
  ctx.quadraticCurveTo(x, by + 6, bx, by);
  ctx.closePath();

  const bodyGrad = ctx.createLinearGradient(0, y, 0, by);
  bodyGrad.addColorStop(0, "#d99a55");
  bodyGrad.addColorStop(0.5, "#b87434");
  bodyGrad.addColorStop(1, "#8f5522");
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Anyaman.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(70, 35, 10, 0.35)";
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    const px = x + i * 13;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px + i * 1.5, by);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255, 220, 160, 0.18)";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + 8 + i * 9);
    ctx.lineTo(x + w / 2, y + 8 + i * 9);
    ctx.stroke();
  }
  ctx.restore();

  // Bibir keranjang.
  roundRectPath(ctx, x - w / 2, y - 5, w, 11, 5.5);
  const rimGrad = ctx.createLinearGradient(0, y - 5, 0, y + 6);
  rimGrad.addColorStop(0, "#e8b06a");
  rimGrad.addColorStop(1, "#a8642a");
  ctx.fillStyle = rimGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(90, 50, 15, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawFruitShape(
  kind: FruitKind,
  x: number,
  y: number,
  rot: number,
  r: number,
  time: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(r / 16, r / 16);

  if (kind === "apple") {
    const g = ctx.createRadialGradient(-5, -7, 2, 0, 2, 19);
    g.addColorStop(0, "#ff9a9a");
    g.addColorStop(0.55, "#f04747");
    g.addColorStop(1, "#b91c3c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 2, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(90, 10, 25, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = "#6b3f1d";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.quadraticCurveTo(2, -20, 6, -22);
    ctx.stroke();

    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.ellipse(9, -21, 8, 3.6, -0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.ellipse(-6, -4, 4, 6, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "orange") {
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 1, 18);
    g.addColorStop(0, "#ffd08a");
    g.addColorStop(0.5, "#fb923c");
    g.addColorStop(1, "#c2410c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 14.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 40, 0, 0.35)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = "rgba(120, 40, 0, 0.25)";
    const dots: [number, number][] = [
      [-6, -4],
      [4, -7],
      [7, 3],
      [-4, 6],
      [0, 0],
      [-8, 1],
    ];
    for (const [dx, dy] of dots) {
      ctx.beginPath();
      ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "#7c4a1e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(1, -12);
    ctx.lineTo(3, -17);
    ctx.stroke();

    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.ellipse(8, -16, 6, 3, -0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-5, -5, 4, 5, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "banana") {
    ctx.beginPath();
    ctx.moveTo(-15, -6);
    ctx.bezierCurveTo(-12, 12, 8, 16, 16, -2);
    ctx.bezierCurveTo(9, 6, -3, 4, -10, -10);
    ctx.closePath();
    const g = ctx.createLinearGradient(-10, -10, 12, 14);
    g.addColorStop(0, "#fff08a");
    g.addColorStop(0.6, "#facc15");
    g.addColorStop(1, "#ca8a04");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 80, 0, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#8a5a1a";
    ctx.beginPath();
    ctx.arc(-15, -6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(16, -2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.quadraticCurveTo(0, 8, 10, 3);
    ctx.stroke();
  } else if (kind === "watermelon") {
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 18);
    g.addColorStop(0, "#86efac");
    g.addColorStop(0.5, "#22c55e");
    g.addColorStop(1, "#15803d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(6, 78, 40, 0.75)";
    ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 7, -18);
      ctx.quadraticCurveTo(i * 7 + 6, 0, i * 7, 18);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-6, -6, 4, 6, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "grape") {
    const g = ctx.createRadialGradient(-4, -6, 2, 0, 0, 16);
    g.addColorStop(0, "#e9d5ff");
    g.addColorStop(0.55, "#a855f7");
    g.addColorStop(1, "#6b21a8");
    ctx.fillStyle = g;
    const grapes: [number, number][] = [
      [-7, -4],
      [0, -6],
      [7, -4],
      [-4, 2],
      [4, 2],
      [0, 8],
      [-9, 3],
      [9, 3],
    ];
    for (const [dx, dy] of grapes) {
      ctx.beginPath();
      ctx.arc(dx, dy, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(50, 10, 80, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = "#5b3a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(1, -17);
    ctx.stroke();

    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.ellipse(7, -14, 7, 3.4, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "gold") {
    ctx.shadowColor = "rgba(253, 224, 71, 0.9)";
    ctx.shadowBlur = 16 + Math.sin(time * 6) * 4;
    const g = ctx.createRadialGradient(-3, -4, 2, 0, 0, 17);
    g.addColorStop(0, "#fff7b0");
    g.addColorStop(0.55, "#fde047");
    g.addColorStop(1, "#d97706");
    ctx.fillStyle = g;
    starPath(ctx, 5, 17, 7.5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(-3, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Bom.
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 17);
    g.addColorStop(0, "#6b7280");
    g.addColorStop(0.5, "#374151");
    g.addColorStop(1, "#111827");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 1, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-5, -4, 4, 5, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // Sumbu.
    ctx.strokeStyle = "#a16207";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(6, -14);
    ctx.quadraticCurveTo(12, -21, 9, -26);
    ctx.stroke();

    // Percikan api.
    const flicker = 2.5 + Math.sin(time * 25) * 1.5;
    ctx.fillStyle = "#fbbf24";
    ctx.shadowColor = "#f97316";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(9, -26, flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff7ed";
    ctx.beginPath();
    ctx.arc(9, -26, flicker * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Mata lucu.
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(-4, -2, 2, 0, Math.PI * 2);
    ctx.arc(4, -2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawFruit(fruit: Fruit, time: number): void {
  drawFruitShape(fruit.kind, fruit.x, fruit.y, fruit.rot, fruit.r, time);
}

function drawParticles(): void {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.max);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + alpha * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloats(): void {
  ctx.textAlign = "center";
  ctx.font = `800 16px ${FONT}`;
  for (const f of floats) {
    const alpha = Math.max(0, Math.min(1, f.life / f.max));
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawBanner(): void {
  const progress = 1 - bannerTimer / 1.6;
  const alpha = Math.min(1, bannerTimer * 2.2);
  const y = H * 0.4 - progress * 16;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.font = `900 42px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(8, 15, 30, 0.65)";
  ctx.strokeText(banner, W / 2, y);
  ctx.fillStyle = "#fde047";
  ctx.shadowColor = "rgba(253, 224, 71, 0.6)";
  ctx.shadowBlur = 18;
  ctx.fillText(banner, W / 2, y);
  ctx.restore();
}

/* ---------- HUD & layar overlay ---------- */

function drawHeart(x: number, y: number, s: number, filled: boolean): void {
  heartPath(ctx, x, y, s);
  if (filled) {
    const g = ctx.createLinearGradient(x, y - s, x, y + s);
    g.addColorStop(0, "#fb7185");
    g.addColorStop(1, "#e11d48");
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawHud(): void {
  ctx.fillStyle = hudGradient;
  ctx.fillRect(0, 0, W, 104);

  // Skor.
  ctx.textAlign = "left";
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = "#7dd3fc";
  ctx.fillText("SKOR", 18, 24);
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(String(score).padStart(4, "0"), 18, 54);
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = "rgba(226, 232, 240, 0.55)";
  ctx.fillText(`BEST ${Math.max(highScore, score)}`, 18, 72);

  // Level.
  const pillW = 94;
  const pillH = 28;
  const pillX = W / 2 - pillW / 2;
  const pillY = 14;
  ctx.fillStyle = "rgba(10, 20, 35, 0.72)";
  roundRectPath(ctx, pillX, pillY, pillW, pillH, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = "#fde68a";
  ctx.fillText(`LEVEL ${level}`, W / 2, pillY + 19);

  // Nyawa.
  for (let i = 0; i < MAX_LIVES; i++) {
    drawHeart(W - 26 - i * 24, 30, 8.5, i < lives);
  }

  // Combo.
  if (combo >= 2) {
    const multiplier = 1 + Math.min(4, Math.floor(combo / 5));
    ctx.font = `800 14px ${FONT}`;
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`COMBO ${combo}  ×${multiplier}`, W / 2, 82);
  }

  // Petunjuk suara.
  ctx.textAlign = "right";
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = "rgba(226, 232, 240, 0.35)";
  ctx.fillText(muted ? "M · SUARA OFF" : "M · SUARA ON", W - 16, H - 12);
}

function drawMenu(time: number): void {
  ctx.fillStyle = "rgba(4, 10, 20, 0.74)";
  ctx.fillRect(0, 0, W, H);

  // Deretan buah yang mengapung.
  const demo: FruitKind[] = ["apple", "orange", "banana", "watermelon", "grape", "gold"];
  demo.forEach((kind, i) => {
    const x = 78 + i * 65;
    const y = 108 + Math.sin(time * 2 + i * 0.8) * 7;
    drawFruitShape(kind, x, y, Math.sin(time + i) * 0.25, 15, time);
  });

  // Judul.
  ctx.textAlign = "center";
  ctx.font = `900 44px ${FONT}`;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillText("FRUIT", W / 2 + 3, 203);
  ctx.fillText("CATCHER", W / 2 + 3, 251);

  const titleGrad = ctx.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
  titleGrad.addColorStop(0, "#fde047");
  titleGrad.addColorStop(0.45, "#fb923c");
  titleGrad.addColorStop(1, "#f43f5e");
  ctx.fillStyle = titleGrad;
  ctx.fillText("FRUIT", W / 2, 200);
  ctx.fillText("CATCHER", W / 2, 248);

  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText("Tangkap buahnya, hindari bomnya!", W / 2, 286);

  // Panel instruksi.
  const px = 52;
  const py = 318;
  const pw = W - 104;
  const ph = 154;
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  roundRectPath(ctx, px, py, pw, ph, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = `700 12px ${FONT}`;
  ctx.fillStyle = "#fbbf24";
  ctx.fillText("CARA MAIN", px + 20, py + 26);

  const lines: [string, string][] = [
    ["← → / A D", "gerakkan keranjang"],
    ["Mouse / sentuh", "ikuti jari atau kursor"],
    ["P / ESC · M", "pause · suara"],
  ];
  ctx.font = `600 13px ${FONT}`;
  lines.forEach(([key, desc], i) => {
    const ly = py + 58 + i * 28;
    ctx.fillStyle = "#93c5fd";
    ctx.fillText(key, px + 20, ly);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(desc, px + 160, ly);
  });

  // Ajakan mulai.
  ctx.textAlign = "center";
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time * 2.4));
  ctx.globalAlpha = pulse;
  ctx.font = `800 16px ${FONT}`;
  ctx.fillStyle = "#4ade80";
  ctx.fillText("TEKAN ENTER / SPASI UNTUK MULAI", W / 2, 526);
  ctx.globalAlpha = 1;

  ctx.font = `500 12px ${FONT}`;
  ctx.fillStyle = "rgba(203, 213, 225, 0.7)";
  ctx.fillText("atau klik / sentuh layar", W / 2, 550);

  if (highScore > 0) {
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = "#fcd34d";
    ctx.fillText(`REKOR TERBAIK  ${highScore}`, W / 2, 590);
  }
}

function drawPaused(): void {
  ctx.fillStyle = "rgba(4, 10, 20, 0.62)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.font = `900 40px ${FONT}`;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText("PAUSED", W / 2, 292);

  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("P / ESC untuk lanjut  ·  R untuk mulai ulang", W / 2, 332);
}

function drawGameOver(time: number): void {
  ctx.fillStyle = "rgba(4, 10, 20, 0.78)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.font = `900 44px ${FONT}`;
  ctx.fillStyle = "#f87171";
  ctx.shadowColor = "rgba(248, 113, 113, 0.4)";
  ctx.shadowBlur = 24;
  ctx.fillText("GAME OVER", W / 2, 214);
  ctx.shadowBlur = 0;

  ctx.font = `700 12px ${FONT}`;
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("SKOR AKHIR", W / 2, 264);

  ctx.font = `900 64px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(score), W / 2, 326);

  if (score > 0 && score >= highScore) {
    const pulse = 0.7 + 0.3 * Math.sin(time * 4);
    ctx.globalAlpha = pulse;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillStyle = "#fcd34d";
    ctx.fillText("🏆 REKOR BARU!", W / 2, 360);
    ctx.globalAlpha = 1;
  } else {
    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Rekor terbaik: ${highScore}`, W / 2, 360);
  }

  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = "#a5b4fc";
  ctx.fillText(
    `Level ${level}  ·  Combo terbaik ${bestCombo}  ·  ${caught} buah`,
    W / 2,
    398,
  );

  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time * 2.4));
  ctx.globalAlpha = pulse;
  ctx.font = `800 16px ${FONT}`;
  ctx.fillStyle = "#4ade80";
  ctx.fillText("TEKAN ENTER / R UNTUK MAIN LAGI", W / 2, 500);
  ctx.globalAlpha = 1;

  ctx.font = `500 12px ${FONT}`;
  ctx.fillStyle = "rgba(203, 213, 225, 0.7)";
  ctx.fillText("atau klik / sentuh layar", W / 2, 524);

  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillText(muted ? "M · suara mati" : "M · suara hidup", W / 2, 570);
}

/* ---------- Render satu frame ---------- */

function draw(time: number): void {
  ctx.save();
  if (shake > 0) {
    const amount = shake * 7;
    ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
  }

  drawBackground(time);
  for (const fruit of fruits) drawFruit(fruit, time);
  drawBasket();
  drawParticles();
  drawFloats();
  if (bannerTimer > 0) drawBanner();

  ctx.restore();

  if (state === "playing" || state === "paused") drawHud();
  if (state === "menu") drawMenu(time);
  else if (state === "paused") drawPaused();
  else if (state === "over") drawGameOver(time);
}

/* ---------- Input ---------- */

function pointerToCanvasX(clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  const ratio = rect.width === 0 ? 1 : (clientX - rect.left) / rect.width;
  return clamp(ratio * W, BASKET_W / 2 + 6, W - BASKET_W / 2 - 6);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(key)) {
    event.preventDefault();
  }
  keys.add(key);

  if (key === "m") {
    muted = !muted;
    if (!muted) {
      initAudio();
      tone(660, 0.08, "sine", 0.05);
    }
    return;
  }

  if (state === "menu") {
    if (key === "enter" || key === " ") startGame();
    return;
  }

  if (state === "playing") {
    if (key === "p" || key === "escape") {
      state = "paused";
    } else if (key === "r") {
      startGame();
    }
  } else if (state === "paused") {
    if (key === "p" || key === "escape") {
      state = "playing";
    } else if (key === "r") {
      startGame();
    }
  } else if (state === "over") {
    if (key === "enter" || key === " " || key === "r") startGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => {
  keys.clear();
});

canvas.addEventListener("pointermove", (event) => {
  if (state === "playing") {
    basket.targetX = pointerToCanvasX(event.clientX);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  initAudio();

  if (state === "menu" || state === "over") {
    startGame();
    return;
  }
  if (state === "paused") {
    state = "playing";
    return;
  }
  basket.targetX = pointerToCanvasX(event.clientX);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") {
    state = "paused";
  }
});

/* ---------- Game loop ---------- */

let lastTime = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;

  update(dt);
  draw(elapsed);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
