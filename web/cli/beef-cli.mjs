#!/usr/bin/env node
/**
 * Beef Fresh — CLI terminal 3D (pendamping CLI 3D di website).
 * Model alat dirender 3D (ASCII + warna 24-bit) lalu masuk ke mode interaktif
 * untuk mengendalikan ESP32 & mengambil dataset (144 latih + 36 uji).
 *
 * Pemakaian:
 *   node cli/beef-cli.mjs --url https://alamat-website-anda
 *   BEEF_URL=http://localhost:3000 node cli/beef-cli.mjs
 * Tanpa dependensi tambahan (Node.js >= 18).
 */
import readline from "node:readline";

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf("--url");
const BASE = (argv.find((a) => a.startsWith("--url="))?.slice(6) || (urlIdx >= 0 ? argv[urlIdx + 1] : "") || process.env.BEEF_URL || "http://localhost:3000").replace(/\/$/, "");

const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = fg(229, 56, 59);
const CREAM = fg(246, 231, 215);
const MUTED = fg(150, 120, 112);
const GREEN = fg(74, 222, 128);
const AMBER = fg(252, 211, 77);
const SKY = fg(125, 211, 252);
const LABELS = ["segar", "mulai_membusuk", "busuk"];
const LABEL = {
  segar: { name: "Segar", c: fg(239, 59, 63) },
  mulai_membusuk: { name: "Mulai Membusuk", c: fg(224, 138, 46) },
  busuk: { name: "Busuk", c: fg(154, 173, 60) },
};
const SPLIT = { train: "latih", test: "uji" };
const QUOTA = { train: 48, test: 12 };
const FINAL = ["done", "failed", "expired", "cancelled"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- renderer 3D ASCII ----------------------------- */
const W = 64;
const H = 28;
const CHARS = ".,-~:;=!*#$@";
const POINTS = (() => {
  const pts = [];
  const add = (x, y, z, nx, ny, nz, col) => pts.push([x, y, z, nx, ny, nz, col]);
  const white = [236, 235, 230];
  const step = 0.06;
  // kotak putih
  for (let a = -1.1; a <= 1.1; a += step)
    for (let b = -1; b <= 1; b += step) {
      add(a, b, -1, 0, 0, -1, white);
      add(a, b, 1, 0, 0, 1, white);
    }
  for (let a = -1; a <= 1; a += step)
    for (let b = -1; b <= 1; b += step) {
      add(-1.1, a, b, -1, 0, 0, white);
      const usb = a > 0.05 && a < 0.4 && b > 0.2 && b < 0.45;
      add(1.1, a, b, 1, 0, 0, usb ? [60, 60, 60] : white);
    }
  for (let a = -1.1; a <= 1.1; a += step)
    for (let b = -1; b <= 1; b += step) {
      add(a, 1, b, 0, 1, 0, white);
      add(a, -1, b, 0, -1, 0, white);
    }
  // tabung hitam + sensor
  const cx = -0.08;
  const cy = -0.12;
  for (let t = 0; t < Math.PI * 2; t += 0.07) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    for (let z = 1; z <= 1.55; z += 0.05) add(cx + 0.78 * c, cy + 0.78 * s, z, c, s, 0, [55, 55, 58]);
    for (let r = 0.17; r <= 0.78; r += 0.05) add(cx + r * c, cy + r * s, 1.55, 0, 0, 1, r < 0.24 ? [30, 30, 30] : [70, 70, 74]);
    for (let r = 0; r < 0.17; r += 0.04) add(cx + r * c, cy + r * s, 1.02, 0, 0, 1, [150, 90, 210]);
  }
  // kait (tuas) & engsel
  for (let a = -0.23; a <= 0.13; a += 0.04)
    for (let b = 0.7; b <= 1.12; b += 0.04) add(a, 1.06, b, 0, 1, 0, [217, 162, 169]);
  for (let a = -0.1; a <= 0.85; a += 0.04) add(a, -1, 1.04, 0, -0.3, 1, [217, 162, 169]);
  return pts;
})();

function renderFrame(A, B) {
  const zbuf = new Float32Array(W * H);
  const chars = new Array(W * H).fill(" ");
  const cols = new Array(W * H).fill(null);
  const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
  const L = [-0.45, 0.6, -0.66];
  const K1 = 30;
  for (const [x, y, z, nx, ny, nz, col] of POINTS) {
    const x1 = x * cA + z * sA;
    const z1 = -x * sA + z * cA;
    const y2 = y * cB - z1 * sB;
    const z2 = y * sB + z1 * cB;
    const nx1 = nx * cA + nz * sA;
    const nz1 = -nx * sA + nz * cA;
    const ny2 = ny * cB - nz1 * sB;
    const nz2 = ny * sB + nz1 * cB;
    if (nz2 > 0.2) continue;
    const ooz = 1 / (z2 + 5.2);
    const xp = Math.round(W / 2 + K1 * ooz * x1 * 2.05);
    const yp = Math.round(H / 2 - K1 * ooz * y2);
    if (xp < 0 || xp >= W || yp < 0 || yp >= H) continue;
    const i = yp * W + xp;
    if (ooz <= zbuf[i]) continue;
    zbuf[i] = ooz;
    const lum = Math.max(0, nx1 * L[0] + ny2 * L[1] + nz2 * L[2]);
    chars[i] = CHARS[Math.min(CHARS.length - 1, Math.round(lum * (CHARS.length - 1)))] || ".";
    const k = 0.35 + 0.65 * lum;
    cols[i] = fg(Math.round(col[0] * k), Math.round(col[1] * k), Math.round(col[2] * k));
  }
  let out = "";
  for (let r = 0; r < H; r++) {
    let line = "";
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      line += cols[i] ? cols[i] + chars[i] : " ";
    }
    out += line + RESET + "\n";
  }
  return out;
}

async function spin3d(ms, caption) {
  process.stdout.write("\x1b[?25l\x1b[2J");
  const t0 = Date.now();
  let A = -0.6;
  while (Date.now() - t0 < ms) {
    A += 0.07;
    process.stdout.write("\x1b[H" + renderFrame(A, 0.42) + `  ${RED}${BOLD}BEEF FRESH${RESET} ${MUTED}${caption}${RESET}\n`);
    await sleep(45);
  }
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
}

/* --------------------------------- API ---------------------------------- */
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function spinner(text) {
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let i = 0;
  const t = setInterval(() => process.stdout.write(`\r${RED}${frames[i++ % frames.length]}${RESET} ${text}   `), 80);
  return { stop: () => { clearInterval(t); process.stdout.write("\r\x1b[2K"); } };
}

async function runCommand(type, payload, text) {
  const sp = spinner(text);
  try {
    const { command, simulated, deviceOnline } = await api("/api/commands", { method: "POST", body: { type, payload } });
    if (FINAL.includes(command.status)) return command;
    if (!simulated && deviceOnline === false) {
      sp.stop();
      console.log(`${AMBER}  ESP32 offline — perintah menunggu di antrean (aktifkan 'sim on' untuk simulasi)${RESET}`);
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await sleep(700);
      const { command: c } = await api(`/api/commands/${command.id}`);
      if (FINAL.includes(c.status)) return c;
    }
    await api(`/api/commands/${command.id}`, { method: "DELETE" }).catch(() => {});
    throw new Error("Timeout menunggu ESP32");
  } finally {
    sp.stop();
  }
}

const bar = (v, max, w = 24) => {
  const n = Math.max(0, Math.min(w, Math.round((v / max) * w)));
  return "█".repeat(n) + "░".repeat(w - n);
};
const swatch = (r, g, b) => `\x1b[48;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m    ${RESET}`;
const parseLabel = (s = "") => ({ segar: "segar", s: "segar", mulai: "mulai_membusuk", m: "mulai_membusuk", mulai_membusuk: "mulai_membusuk", busuk: "busuk", b: "busuk" })[s.toLowerCase()] || null;
const parseSplit = (s = "") => ({ latih: "train", train: "train", l: "train", uji: "test", test: "test", u: "test" })[s.toLowerCase()] || null;
const parseScaling = (s = "") => ({ none: "none", tanpa: "none", minmax: "minmax", "min-max": "minmax", zscore: "zscore", "z-score": "zscore" })[s.toLowerCase()] || null;

/* ------------------------------- perintah -------------------------------- */
let session = null;

async function progress() {
  const { counts } = await api("/api/overview?lite=1");
  for (const split of ["train", "test"]) {
    console.log(`${CREAM}${BOLD}Data ${SPLIT[split]}${RESET} ${MUTED}${counts[split].total}/${QUOTA[split] * 3}${RESET}`);
    for (const l of LABELS) {
      const n = counts[split][l];
      console.log(`  ${LABEL[l].c}${LABEL[l].name.padEnd(15)}${RESET} ${n >= QUOTA[split] ? GREEN : RED}${bar(n, QUOTA[split])}${RESET} ${String(n).padStart(2)}/${QUOTA[split]}`);
    }
  }
}

async function capture(label, split, n = 1) {
  for (let i = 0; i < n; i++) {
    const c = await runCommand("capture", { label, split }, `[${i + 1}/${n}] Mengambil sampel ${LABEL[label].name} → ${SPLIT[split]}…`);
    if (c.status !== "done") {
      console.log(`${RED}✗ ${c.error || c.status}${RESET}`);
      return;
    }
    const s = c.result.sample;
    console.log(`${GREEN}✓${RESET} ${MUTED}#${s.id}${RESET} ${LABEL[label].c}${LABEL[label].name}${RESET} → ${SPLIT[split]} ${swatch(s.r, s.g, s.b)} RGB(${s.r.toFixed(1)}, ${s.g.toFixed(1)}, ${s.b.toFixed(1)})${c.simulated ? ` ${SKY}[sim]${RESET}` : ""}`);
    if (i < n - 1) await sleep(c.simulated ? 120 : 1500);
  }
}

async function analyze(scaling, k) {
  const c = await runCommand("classify", { scaling, k }, "ESP32 membaca warna & menjalankan KNN…");
  if (c.status !== "done") return console.log(`${RED}✗ ${c.error || c.status}${RESET}`);
  const r = c.result.classification;
  console.log(`\n  ${BOLD}${LABEL[r.predicted].c}${LABEL[r.predicted].name.toUpperCase()}${RESET}  ${MUTED}(${r.scaling}, K=${r.k}, suara ${JSON.stringify(r.votes)})${RESET}`);
  console.log(`  RGB asli ${swatch(r.r, r.g, r.b)} (${r.r.toFixed(1)}, ${r.g.toFixed(1)}, ${r.b.toFixed(1)})  norm (${[r.rNorm, r.gNorm, r.bNorm].map((x) => (x ?? 0).toFixed(3)).join(", ")})`);
  console.log(`  ${AMBER}Waktu eksekusi ${r.execUs?.toFixed(1)} µs · memori ${r.memBytes} byte${RESET}\n`);
}

async function evaluation(k) {
  const ev = await api(`/api/evaluation?k=${k}`);
  if (!ev.ready) return console.log(`${AMBER}Butuh data latih & uji (${ev.trainCount} latih, ${ev.testCount} uji)${RESET}`);
  console.log(`${MUTED}K=${ev.k} · ${ev.trainCount} latih · ${ev.testCount} uji${RESET}`);
  for (const m of ["none", "minmax", "zscore"]) {
    const r = ev.methods[m];
    console.log(`  ${m.padEnd(8)} ${RED}${bar(r.accuracy, 1, 20)}${RESET} ${(r.accuracy * 100).toFixed(1)}%  F1 ${(r.macroF1 * 100).toFixed(1)}%`);
  }
  if (ev.best) console.log(`  ★ terbaik: ${ev.best.method} K=${ev.best.k} (${(ev.best.accuracy * 100).toFixed(1)}%)`);
}

async function benchmark(k) {
  const c = await runCommand("benchmark", { k, repeat: 3 }, "ESP32 menjalankan benchmark KNN…");
  if (c.status !== "done") return console.log(`${RED}✗ ${c.error || c.status}${RESET}`);
  for (const r of c.result.benchmarks) {
    console.log(`  ${r.scaling.padEnd(8)} ${AMBER}${r.avgUs.toFixed(1).padStart(8)} µs${RESET}  heap ${String(r.memBytes).padStart(5)} B  akurasi ${r.correct}/${r.samples}`);
  }
}

function help() {
  const rows = [
    ["progres", "progres dataset 144 latih / 36 uji"],
    ["sesi <kelas> <latih|uji>", "mode sesi: Enter = ambil 1 sampel, 'selesai' = keluar"],
    ["ambil <kelas> <latih|uji> [n]", "ambil n sampel (kelas: segar | mulai | busuk)"],
    ["analisa [none|minmax|zscore] [k]", "picu ESP32 menganalisa daging"],
    ["evaluasi [k] · benchmark [k]", "akurasi per metode · performa ESP32"],
    ["status · sim on|off · seed", "status alat · mode simulasi · isi data simulasi"],
    ["3d · keluar", "putar model 3D · keluar"],
  ];
  for (const [u, d] of rows) console.log(`  ${CREAM}${u.padEnd(36)}${RESET}${MUTED}${d}${RESET}`);
}

async function handle(line, rl) {
  const [cmd = "", ...rest] = line.trim().split(/\s+/);
  const c = cmd.toLowerCase();
  if (!c) {
    if (session) await capture(session.label, session.split, 1);
    return;
  }
  if (session && /^\d+$/.test(c)) return capture(session.label, session.split, Number(c));
  switch (c) {
    case "bantuan": case "help": return help();
    case "progres": return progress();
    case "status": {
      const { device, settings } = await api("/api/overview?lite=1");
      console.log(`  ESP32 ${device.online ? GREEN + "online" : MUTED + "offline"}${RESET} · IP ${device.ip ?? "–"} · heap ${device.freeHeap ?? "–"} · mode ${settings.simulation ? SKY + "SIMULASI" : "nyata"}${RESET}`);
      return;
    }
    case "ambil": case "sesi": {
      const label = parseLabel(rest[0]);
      const split = parseSplit(rest[1]);
      if (!label || !split) return console.log(`${AMBER}Penggunaan: ${c} <segar|mulai|busuk> <latih|uji>${RESET}`);
      if (c === "ambil") return capture(label, split, Math.max(1, Math.min(48, Number(rest[2]) || 1)));
      session = { label, split };
      console.log(`${AMBER}● Sesi ${LABEL[label].name} → ${SPLIT[split]}: Enter = ambil, angka = ambil n, 'selesai' = keluar${RESET}`);
      rl.setPrompt(`${RED}beef${RESET}${AMBER}[${LABEL[label].name}/${SPLIT[split]}]${RESET}> `);
      return;
    }
    case "selesai":
      session = null;
      rl.setPrompt(`${RED}beef${RESET}> `);
      return console.log(`${MUTED}Sesi selesai.${RESET}`);
    case "analisa": {
      let scaling = "minmax";
      let k = 5;
      for (const a of rest) {
        if (/^\d+$/.test(a)) k = Number(a);
        else if (parseScaling(a)) scaling = parseScaling(a);
      }
      return analyze(scaling, k);
    }
    case "evaluasi": return evaluation(Number(rest[0]) || 5);
    case "benchmark": return benchmark(Number(rest[0]) || 5);
    case "sim": {
      const on = rest[0] ? rest[0] === "on" : true;
      await api("/api/settings", { method: "PUT", body: { simulation: on } });
      return console.log(on ? `${SKY}● Mode simulasi aktif${RESET}` : `${GREEN}○ Mode simulasi nonaktif${RESET}`);
    }
    case "seed": {
      const r = await api("/api/samples", { method: "POST", body: { action: "seed" } });
      return console.log(`${GREEN}✓ ${r.inserted} sampel simulasi ditambahkan${RESET}`);
    }
    case "3d":
      rl.pause();
      await spin3d(4000, "model alat · ESP32 + TCS34725 + OLED SSD1306");
      rl.resume();
      return;
    case "keluar": case "exit": case "q":
      rl.close();
      return;
    default:
      console.log(`${RED}Perintah tidak dikenal: ${c}${RESET} ${MUTED}(ketik 'bantuan')${RESET}`);
  }
}

async function main() {
  if (process.stdout.isTTY) await spin3d(2600, `menghubungkan ke ${BASE}…`);
  console.log(`${RED}${BOLD}BEEF FRESH CLI${RESET} ${MUTED}— KNN + Feature Scaling · server ${BASE}${RESET}`);
  try {
    await progress();
  } catch (e) {
    console.log(`${RED}✗ Tidak dapat terhubung ke server: ${e.message}${RESET}`);
  }
  console.log(`${MUTED}Ketik 'bantuan' untuk daftar perintah.${RESET}`);
  const COMPLETE = ["bantuan", "progres", "status", "ambil", "sesi", "selesai", "analisa", "evaluasi", "benchmark", "sim", "seed", "3d", "keluar"];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${RED}beef${RESET}> `,
    completer: (line) => {
      const hits = COMPLETE.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMPLETE, line];
    },
  });
  rl.prompt();
  let busy = false;
  rl.on("line", async (line) => {
    if (busy) return;
    busy = true;
    try {
      await handle(line, rl);
    } catch (e) {
      console.log(`${RED}✗ ${e.message}${RESET}`);
    }
    busy = false;
    rl.prompt();
  });
  rl.on("close", () => {
    process.stdout.write("\x1b[?25h");
    console.log(`${MUTED}Sampai jumpa!${RESET}`);
    process.exit(0);
  });
}

main();
