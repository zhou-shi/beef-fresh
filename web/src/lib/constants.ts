export type Label = "segar" | "mulai_membusuk" | "busuk";
export type Split = "train" | "test";
export type Scaling = "none" | "minmax" | "zscore";

export const LABELS: Label[] = ["segar", "mulai_membusuk", "busuk"];
export const SPLITS: Split[] = ["train", "test"];
export const SCALINGS: Scaling[] = ["none", "minmax", "zscore"];

/** 144 data latih + 36 data uji => 48 & 12 per kelas */
export const QUOTA: Record<Split, number> = { train: 144, test: 36 };
export const QUOTA_PER_CLASS: Record<Split, number> = { train: 48, test: 12 };
export const K_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15];
export const DEFAULT_DEVICE_ID = "beef-esp32-01";
export const DEVICE_ONLINE_MS = 15_000;

export interface LabelMeta {
  name: string;
  short: string;
  oled: string;
  color: string;
  textColor: string;
  meat: string;
  desc: string;
}

export const LABEL_INFO: Record<Label, LabelMeta> = {
  segar: {
    name: "Segar",
    short: "segar",
    oled: "SEGAR",
    color: "#ef3b3f",
    textColor: "var(--label-segar-text)",
    meat: "#b3232b",
    desc: "Warna merah cerah dan tekstur masih segar",
  },
  mulai_membusuk: {
    name: "Mulai Membusuk",
    short: "mulai",
    oled: "MULAI BUSUK",
    color: "#e08a2e",
    textColor: "var(--label-mulai-text)",
    meat: "#8c3a26",
    desc: "Warna mulai merah kecokelatan dan kualitas menurun",
  },
  busuk: {
    name: "Busuk",
    short: "busuk",
    oled: "BUSUK",
    color: "#9aad3c",
    textColor: "var(--label-busuk-text)",
    meat: "#6b5836",
    desc: "Warna cokelat pucat atau kehijauan, tidak layak konsumsi",
  },
};

export const SPLIT_INFO: Record<Split, { name: string; short: string }> = {
  train: { name: "Data Latih", short: "latih" },
  test: { name: "Data Uji", short: "uji" },
};

export interface ScalingMeta {
  name: string;
  short: string;
  formula: string;
  color: string;
  textColor: string;
  desc: string;
}

export const SCALING_INFO: Record<Scaling, ScalingMeta> = {
  none: {
    name: "Tanpa Scaling",
    short: "Tanpa",
    formula: "x' = x",
    color: "#a8968f",
    textColor: "var(--scaling-none-text)",
    desc: "Nilai RGB mentah (0 sampai 255) langsung dipakai untuk menghitung jarak.",
  },
  minmax: {
    name: "Min-Max",
    short: "Min-Max",
    formula: "x' = (x - min) / (max - min)",
    color: "#e5383b",
    textColor: "var(--scaling-minmax-text)",
    desc: "Skalakan tiap kanal R, G, dan B ke rentang 0 sampai 1 dari nilai minimum dan maksimum data latih.",
  },
  zscore: {
    name: "Z-Score",
    short: "Z-Score",
    formula: "x' = (x - mean) / std",
    color: "#f4a261",
    textColor: "var(--scaling-zscore-text)",
    desc: "Standarkan tiap kanal agar rata-rata 0 dan simpangan baku 1 berdasarkan data latih.",
  },
};

const norm = (s?: string | null) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export function parseLabel(s?: string | null): Label | null {
  const v = norm(s);
  if (["segar", "s", "fresh", "1"].includes(v)) return "segar";
  if (["mulai_membusuk", "mulai", "m", "membusuk", "agak", "agak_segar", "2"].includes(v)) return "mulai_membusuk";
  if (["busuk", "b", "rotten", "tidak_segar", "3"].includes(v)) return "busuk";
  return null;
}

export function parseSplit(s?: string | null): Split | null {
  const v = norm(s);
  if (["train", "latih", "l", "t", "training", "data_latih"].includes(v)) return "train";
  if (["test", "uji", "u", "testing", "data_uji"].includes(v)) return "test";
  return null;
}

export function parseScaling(s?: string | null): Scaling | null {
  const v = norm(s);
  if (["none", "tanpa", "raw", "mentah", "0", "no"].includes(v)) return "none";
  if (["minmax", "min_max", "mm", "normalisasi", "norm", "minmax_scaling"].includes(v)) return "minmax";
  if (["zscore", "z_score", "z", "standar", "std", "standardisasi"].includes(v)) return "zscore";
  return null;
}

export function isLabel(s: unknown): s is Label {
  return typeof s === "string" && (LABELS as string[]).includes(s);
}

export const PIN_MAP = [
  { from: "ESP32 3V3", to: "Sensor VIN", signal: "3V3", color: "#ef4444" },
  { from: "ESP32 3V3", to: "OLED VCC", signal: "3V3", color: "#ef4444" },
  { from: "ESP32 G26", to: "Sensor SDA", signal: "SDA", color: "#3b82f6" },
  { from: "ESP32 G26", to: "OLED SDA", signal: "SDA", color: "#3b82f6" },
  { from: "ESP32 G27", to: "Sensor SCL", signal: "SCL", color: "#eab308" },
  { from: "ESP32 G27", to: "OLED SCL", signal: "SCL", color: "#eab308" },
  { from: "ESP32 GND", to: "Sensor GND", signal: "GND", color: "#9ca3af" },
  { from: "ESP32 GND", to: "OLED GND", signal: "GND", color: "#9ca3af" },
];

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function rgbCss(r: number, g: number, b: number) {
  return `rgb(${Math.round(clamp(r, 0, 255))}, ${Math.round(clamp(g, 0, 255))}, ${Math.round(clamp(b, 0, 255))})`;
}

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

export const fmtNum = (n: number | null | undefined, d = 2) => (finite(n) ? n.toFixed(d) : "-");
export const fmtPct = (n: number | null | undefined, d = 1) => (finite(n) ? `${(n * 100).toFixed(d)}%` : "-");
export const fmtUs = (us: number | null | undefined) =>
  finite(us) ? (us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : `${us.toFixed(1)} us`) : "-";
export const fmtBytes = (b: number | null | undefined) =>
  finite(b) ? (Math.abs(b) >= 1024 ? `${(b / 1024).toFixed(2)} KB` : `${Math.round(b)} B`) : "-";

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "belum pernah";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 5) return "baru saja";
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export function fmtTime(d: string | Date) {
  return new Date(d).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
