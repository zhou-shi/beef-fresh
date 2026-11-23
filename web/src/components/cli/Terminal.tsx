"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ApiError, api, createCommand, isFinal, sleep, waitForCommand } from "@/lib/client";
import {
  LABELS,
  LABEL_INFO,
  PIN_MAP,
  QUOTA,
  QUOTA_PER_CLASS,
  SCALINGS,
  SCALING_INFO,
  SPLITS,
  SPLIT_INFO,
  fmtBytes,
  fmtNum,
  fmtPct,
  fmtTime,
  fmtUs,
  parseLabel,
  parseScaling,
  parseSplit,
  rgbCss,
  timeAgo,
  type Label,
  type Scaling,
  type Split,
} from "@/lib/constants";
import { DEFAULT_VISUAL, OLED, type DeviceVisual } from "@/lib/device-visual";
import type { BenchmarkDTO, ClassificationDTO, CommandDTO, EvaluationDTO, LiteOverview, OverviewDTO, SampleDTO } from "@/lib/types";
import { cn } from "@/components/ui";

type VisualPatch = Partial<DeviceVisual>;
interface TermLine {
  id: number;
  node: ReactNode;
}
interface Session {
  label: Label;
  split: Split;
}

export interface TerminalProps {
  overview: LiteOverview | undefined;
  refreshOverview: () => Promise<LiteOverview | undefined>;
  setVisual: (patch: VisualPatch | ((v: DeviceVisual) => VisualPatch)) => void;
  onView: (name: string) => void;
}

const HIST_KEY = "beef-cli-history";

const LOGO = String.raw` ___  ___  ___  ___    ___  ___  ___  ___  _  _ 
| _ )| __|| __|| __|  | __|| _ \| __|/ __|| || |
| _ \| _| | _| | _|   | _| |   /| _| \__ \| __ |
|___/|___||___||_|    |_|  |_|_\|___||___/|_||_|`;

const HELP: Array<{ group: string; usage: string; desc: string }> = [
  { group: "Dataset", usage: "progres", desc: "Progres dataset 144 latih / 36 uji per kelas" },
  { group: "Dataset", usage: "sesi <kelas> <latih|uji>", desc: "Mode sesi: tekan Enter setiap sampel siap diukur" },
  { group: "Dataset", usage: "ambil <kelas> <latih|uji> [n] [--paksa] [--jeda=dtk]", desc: "Ambil n sampel (kelas: segar | mulai | busuk)" },
  { group: "Dataset", usage: "data [latih|uji] [kelas] [n]", desc: "Tampilkan sampel terakhir" },
  { group: "Dataset", usage: "undo, hapus <id>", desc: "Hapus sampel terakhir / berdasarkan id" },
  { group: "Dataset", usage: "ekspor", desc: "Unduh CSV dataset (+ kolom Min-Max & Z-Score)" },
  { group: "Analisis", usage: "analisa [none|minmax|zscore] [k]", desc: "Picu ESP32 menganalisa daging (KNN di perangkat)" },
  { group: "Analisis", usage: "evaluasi [k]", desc: "Akurasi KNN tiap metode feature scaling (data uji)" },
  { group: "Analisis", usage: "benchmark [k] [ulang]", desc: "Waktu eksekusi & memori KNN di ESP32" },
  { group: "Analisis", usage: "riwayat [n]", desc: "Riwayat klasifikasi terakhir" },
  { group: "Perangkat", usage: "status, pin", desc: "Status ESP32, model, dan jalur pin I2C" },
  { group: "Perangkat", usage: "ping, sync", desc: "Uji koneksi alat atau paksa unduh ulang dataset" },
  { group: "Perangkat", usage: "sim on|off, seed", desc: "Aktifkan ESP32 virtual atau isi sisa kuota simulasi" },
  { group: "Perangkat", usage: "set k <n>, set scaling <metode>", desc: "Ubah K & metode default" },
  { group: "Perangkat", usage: "reset simulasi|riwayat|semua --yakin", desc: "Hapus data" },
  { group: "Tampilan", usage: "3d putar|xray|buka|tutup|label|depan|belakang|samping|atas|reset", desc: "Kontrol model 3D alat" },
  { group: "Tampilan", usage: "ke dashboard|dataset|evaluasi|perangkat", desc: "Pindah halaman" },
  { group: "Tampilan", usage: "clear, tentang, bantuan", desc: "Bersihkan layar, lihat info proyek, atau daftar perintah" },
];

const COMMANDS = [
  "bantuan", "progres", "sesi", "ambil", "selesai", "data", "undo", "hapus", "ekspor", "analisa", "evaluasi", "benchmark",
  "riwayat", "status", "pin", "ping", "sync", "sim", "seed", "set", "reset", "3d", "ke", "clear", "tentang",
];

const ARG_HINTS: Record<string, string[][]> = {
  ambil: [["segar", "mulai", "busuk"], ["latih", "uji"], ["1", "5", "10"]],
  sesi: [["segar", "mulai", "busuk"], ["latih", "uji"]],
  analisa: [["minmax", "zscore", "none"], ["1", "3", "5", "7", "9", "11"]],
  evaluasi: [["1", "3", "5", "7", "9", "11", "13", "15"]],
  benchmark: [["3", "5", "7"], ["1", "3", "5"]],
  data: [["latih", "uji"], ["segar", "mulai", "busuk"]],
  sim: [["on", "off"]],
  reset: [["simulasi", "riwayat", "semua"], ["--yakin"]],
  set: [["k", "scaling"], ["minmax", "zscore", "none", "3", "5", "7"]],
  "3d": [["putar", "xray", "buka", "tutup", "label", "depan", "belakang", "samping", "atas", "reset"]],
  ke: [["dashboard", "dataset", "evaluasi", "perangkat"]],
};

const QUICK = ["kalibrasi putih", "kalibrasi hitam", "sesi segar latih", "analisa", "progres", "status", "bantuan"];

const bar = (v: number, max: number, w = 20) => {
  const n = max > 0 ? Math.max(0, Math.min(w, Math.round((v / max) * w))) : 0;
  return "█".repeat(n) + "░".repeat(w - n);
};
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clampK = (k: number) => Math.min(25, Math.max(1, Math.round(k) || 5));
const commonPrefix = (arr: string[]) => arr.reduce((p, s) => {
  let i = 0;
  while (i < p.length && i < s.length && p[i] === s[i]) i++;
  return p.slice(0, i);
});
const flagValue = (args: string[], name: string) => {
  const a = args.find((x) => x.toLowerCase().startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const RunCtx = createContext<(cmd: string, autorun?: boolean) => void>(() => {});

function Cmd({ children, run = true }: { children: string; run?: boolean }) {
  const exec = useContext(RunCtx);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        exec(children, run);
      }}
      className="mx-0.5 rounded bg-beef-900/50 px-1 font-semibold text-beef-200 ring-1 ring-beef-700/40 hover:bg-beef-800/70"
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/15 bg-white/5 px-1 text-[11px] text-fat-100">{children}</kbd>;
}

function Sw({ r, g, b }: { r: number; g: number; b: number }) {
  return <span className="mx-1 inline-block h-3 w-5 translate-y-[2px] rounded-[3px] ring-1 ring-white/25" style={{ background: rgbCss(r, g, b) }} />;
}

function Spinner() {
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <span className="text-beef-400">{frames[i]}</span>;
}

function Prompt({ session, counts }: { session: Session | null; counts?: LiteOverview["counts"] }) {
  return (
    <span className="shrink-0 select-none whitespace-pre">
      <span className="font-semibold text-beef-400">beef</span>
      <span className="text-fat-300/50">@</span>
      <span className="text-fat-200">esp32</span>
      {session && (
        <span className="text-amber-300">
          [{LABEL_INFO[session.label].short}/{SPLIT_INFO[session.split].short}
          {counts ? ` ${counts[session.split][session.label]}/${QUOTA_PER_CLASS[session.split]}` : ""}]
        </span>
      )}
      <span className="text-fat-300/50">:~$ </span>
    </span>
  );
}

function CaptureLine({ s, count, quota, sim }: { s: SampleDTO; count: number; quota: number; sim: boolean }) {
  const info = LABEL_INFO[s.label];
  return (
    <div className="flex animate-fade-in flex-wrap items-center gap-x-2">
      <span className="text-emerald-400">✓</span>
      <span className="text-fat-300/50">#{s.id}</span>
      <span style={{ color: info?.color }}>{info?.name}</span>
      <span className="text-fat-300/50">→ {SPLIT_INFO[s.split]?.short}</span>
      <Sw r={s.r} g={s.g} b={s.b} />
      <span>
        RGB({fmtNum(s.r, 1)}, {fmtNum(s.g, 1)}, {fmtNum(s.b, 1)})
      </span>
      {s.rawC != null && <span className="text-fat-300/45">C={s.rawC}</span>}
      <span className="text-beef-400/80">{bar(count, quota, 12)}</span>
      <span className="text-fat-300/70">
        {count}/{quota}
      </span>
      {sim && <span className="text-sky-300/70">[sim]</span>}
    </div>
  );
}

function ResultBlock({ c, sim }: { c: ClassificationDTO; sim: boolean }) {
  const info = LABEL_INFO[c.predicted];
  const votes = c.votes ?? [];
  const total = votes.reduce((a, b) => a + b, 0) || c.k;
  const pv = votes[LABELS.indexOf(c.predicted)] ?? 0;
  const sc = SCALING_INFO[c.scaling] ?? SCALING_INFO.minmax;
  const k = "text-fat-300/55";
  return (
    <div className="my-1.5 max-w-2xl animate-fade-in rounded-lg border border-line bg-black/35 p-3" style={{ boxShadow: `inset 3px 0 0 ${info?.color}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-widest text-fat-300/50">
        <span>Hasil klasifikasi KNN di ESP32 (#{c.id})</span>
        <span>
          {sim ? "ESP32 virtual (simulasi)" : c.deviceId ?? "ESP32"} ({fmtTime(c.createdAt)})
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
        <span className="text-2xl font-black tracking-wide" style={{ color: info?.color }}>
          {info?.name.toUpperCase()}
        </span>
        <span className="text-fat-200/80">
          {pv}/{total} suara tetangga ({fmtPct(total ? pv / total : null, 0)})
        </span>
        {c.actual && (
          <span className={c.actual === c.predicted ? "text-emerald-400" : "text-red-400"}>
            sampel asli: {LABEL_INFO[c.actual as Label]?.name ?? c.actual} {c.actual === c.predicted ? "✓" : "✗"}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12.5px]">
        <span className={k}>RGB asli</span>
        <span>
          <Sw r={c.r} g={c.g} b={c.b} />({fmtNum(c.r, 1)}, {fmtNum(c.g, 1)}, {fmtNum(c.b, 1)})
        </span>
        <span className={k}>RGB {sc.short}</span>
        <span>
          ({fmtNum(c.rNorm, 3)}, {fmtNum(c.gNorm, 3)}, {fmtNum(c.bNorm, 3)})
        </span>
        <span className={k}>Metode</span>
        <span>
          {sc.name}, K = {c.k}, {c.trainCount ?? "?"} data latih
        </span>
        <span className={k}>Suara</span>
        <span>
          {LABELS.map((l, i) => (
            <span key={l} className="mr-3" style={{ color: LABEL_INFO[l].color }}>
              {LABEL_INFO[l].short}:{votes[i] ?? 0}
            </span>
          ))}
        </span>
        <span className={k}>Waktu eksekusi</span>
        <span className="text-amber-200">
          {fmtUs(c.execUs)} <span className="text-fat-300/50">(scaling {fmtUs(c.scaleUs)} + KNN {fmtUs(c.knnUs)})</span>
        </span>
        <span className={k}>Memori</span>
        <span className="text-amber-200">
          {fmtBytes(c.memBytes)}{" "}
          <span className="text-fat-300/50">
            RAM proses KNN, dataset {fmtBytes(c.modelBytes)}, sisa RAM {fmtBytes(c.freeHeap)}
          </span>
        </span>
      </div>
    </div>
  );
}

function BenchTable({ rows, sim }: { rows: BenchmarkDTO[]; sim: boolean }) {
  const f = rows[0];
  return (
    <div className="my-1.5 animate-fade-in overflow-x-auto">
      <div className="mb-1 text-[11px] uppercase tracking-widest text-fat-300/50">
        Performa KNN di ESP32 {sim ? "(simulasi)" : ""} (K={f?.k}, {f?.samples} data uji x {f?.repeat} ulangan, {f?.cpuMhz ?? 240} MHz)
      </div>
      <table className="term-table text-[12.5px]">
        <thead>
          <tr>
            <th>Metode</th>
            <th>Rata-rata</th>
            <th>Min / Maks</th>
            <th>Scaling</th>
            <th>KNN</th>
            <th>Heap inferensi</th>
            <th>Dataset RAM</th>
            <th>Akurasi alat</th>
          </tr>
        </thead>
        <tbody>
          {SCALINGS.map((m) => {
            const r = rows.find((x) => x.scaling === m);
            if (!r) return null;
            return (
              <tr key={m}>
                <td style={{ color: SCALING_INFO[m].color }}>{SCALING_INFO[m].name}</td>
                <td className="text-amber-200">{fmtUs(r.avgUs)}</td>
                <td>
                  {fmtUs(r.minUs)} / {fmtUs(r.maxUs)}
                </td>
                <td>{fmtUs(r.scaleUs)}</td>
                <td>{fmtUs(r.knnUs)}</td>
                <td className="text-amber-200">{fmtBytes(r.memBytes)}</td>
                <td>{fmtBytes(r.modelBytes)}</td>
                <td>
                  {r.correct}/{r.samples} ({fmtPct(r.accuracy)})
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvalTable({ ev }: { ev: EvaluationDTO }) {
  const m = ev.methods;
  if (!m) return null;
  const base = m.none.accuracy;
  return (
    <div className="my-1.5 animate-fade-in overflow-x-auto">
      <div className="mb-1 text-[11px] uppercase tracking-widest text-fat-300/50">
        Evaluasi KNN (K={ev.k}, {ev.trainCount} data latih, {ev.testCount} data uji)
      </div>
      <table className="term-table text-[12.5px]">
        <thead>
          <tr>
            <th>Metode</th>
            <th>Akurasi</th>
            <th />
            <th>Presisi</th>
            <th>Recall</th>
            <th>F1</th>
            <th>CV-5</th>
            <th>Δ vs tanpa</th>
          </tr>
        </thead>
        <tbody>
          {SCALINGS.map((s) => {
            const r = m[s];
            const delta = (r.accuracy - base) * 100;
            return (
              <tr key={s}>
                <td style={{ color: SCALING_INFO[s].color }}>{SCALING_INFO[s].name}</td>
                <td className="font-semibold text-fat-50">{fmtPct(r.accuracy)}</td>
                <td className="text-beef-400/80">{bar(r.accuracy, 1, 14)}</td>
                <td>{fmtPct(r.macroPrecision)}</td>
                <td>{fmtPct(r.macroRecall)}</td>
                <td>{fmtPct(r.macroF1)}</td>
                <td>{fmtPct(ev.cv?.[s] ?? null)}</td>
                <td className={delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-fat-300/60"}>
                  {s === "none" ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} poin`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ev.best && (
        <div className="mt-1 text-fat-200/80">
          ★ Terbaik: <span style={{ color: SCALING_INFO[ev.best.method].color }}>{SCALING_INFO[ev.best.method].name}</span> dengan K ={" "}
          {ev.best.k} → akurasi {fmtPct(ev.best.accuracy)}
        </div>
      )}
    </div>
  );
}

function computeHints(input: string): string[] {
  if (!input.trim()) return [];
  const parts = input.split(" ");
  if (parts.length === 1) {
    const cur = parts[0].toLowerCase();
    return COMMANDS.filter((c) => c.startsWith(cur) && c !== cur).slice(0, 8);
  }
  const opts = ARG_HINTS[parts[0].toLowerCase()]?.[parts.length - 2] ?? [];
  const cur = parts[parts.length - 1].toLowerCase();
  return opts.filter((o) => o.startsWith(cur) && o !== cur).slice(0, 10);
}

interface PendingPreview {
  split: Split;
  label: Label;
  r: number;
  g: number;
  b: number;
  rawR: number | null;
  rawG: number | null;
  rawB: number | null;
  rawC: number | null;
  lux: number | null;
  colorTemp: number | null;
  source: "device" | "simulasi";
  fromHardware: boolean;
  nextCount: number;
  quota: number;
  oledLines: string[];
  force?: boolean;
}

export default function Terminal({ overview, refreshOverview, setVisual, onView }: TerminalProps) {
  const router = useRouter();
  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusyText] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);
  const pendingRef = useRef<PendingPreview | null>(null);
  const [tabHints, setTabHints] = useState<string[]>([]);
  const idRef = useRef(0);
  const histRef = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);
  const ovRef = useRef<LiteOverview | undefined>(overview);
  const sessionRef = useRef<Session | null>(null);
  const runRef = useRef<(cmd: string, autorun?: boolean) => void>(() => {});

  useEffect(() => {
    ovRef.current = overview;
  }, [overview]);

  useEffect(() => {
    pendingRef.current = pendingPreview;
  }, [pendingPreview]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy, busyNote, pendingPreview]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ----------------------------- output helpers ----------------------------- */
  const print = useCallback((node: ReactNode) => {
    setLines((ls) => {
      const next = [...ls, { id: ++idRef.current, node }];
      return next.length > 700 ? next.slice(-700) : next;
    });
  }, []);
  const say = (t: ReactNode, cls = "text-fat-100") => print(<div className={cls}>{t}</div>);
  const dim = (t: ReactNode) => say(t, "text-fat-300/55");
  const ok = (t: ReactNode) => say(t, "text-emerald-400");
  const warn = (t: ReactNode) => say(t, "text-amber-300");
  const err = (t: ReactNode) => say(t, "text-red-400");
  const usage = (u: string) => warn(`Penggunaan: ${u}`);

  function startBusy(text: string) {
    busyRef.current = true;
    setBusyText(text);
    setBusyNote(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl;
  }
  function stopBusy() {
    busyRef.current = false;
    setBusyText(null);
    setBusyNote(null);
    abortRef.current = null;
  }
  function setSess(s: Session | null) {
    sessionRef.current = s;
    setSession(s);
  }

  /* ------------------------------- boot ------------------------------------ */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]");
      if (Array.isArray(h)) histRef.current = h.filter((x) => typeof x === "string").slice(-100);
    } catch {
      /* abaikan */
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function boot() {
    print(<pre className="logo-gradient overflow-hidden text-[8.5px] font-bold leading-[1.15] sm:text-[11px]">{LOGO}</pre>);
    dim("Beef Fresh CLI v1.0 | Kontrol ESP32, TCS34725, dan OLED SSD1306");
    dim("─".repeat(56));
    await sleep(120);
    const ov = await refreshOverview();
    if (!ov) {
      err("✗ Gagal terhubung ke server/database.");
      return;
    }
    const d = ov.device;
    const c = ov.counts;
    const s = ov.settings;
    const row = (k: string, v: ReactNode) =>
      print(
        <div className="whitespace-pre">
          <span className="text-fat-300/55">▸ {k.padEnd(14, ".")} </span>
          {v}
        </div>,
      );
    row("Server", <span className="text-emerald-400">terhubung</span>);
    await sleep(80);
    row(
      "ESP32",
      d.online ? (
        <span className="text-emerald-400">
          online ({d.ip}, {d.rssi} dBm)
        </span>
      ) : (
        <span className="text-fat-300/70">offline {d.everSeen ? `(terakhir ${timeAgo(d.lastSeen)})` : "(belum pernah terhubung)"}</span>
      ),
    );
    await sleep(80);
    row("Mode", s.simulation ? <span className="text-sky-300">SIMULASI (ESP32 virtual)</span> : <span>perangkat nyata</span>);
    await sleep(80);
    row(
      "Data latih",
      <span>
        <span className="text-beef-400">{bar(c.train.total, QUOTA.train, 18)}</span> {c.train.total}/{QUOTA.train}
      </span>,
    );
    await sleep(80);
    row(
      "Data uji",
      <span>
        <span className="text-beef-400">{bar(c.test.total, QUOTA.test, 18)}</span> {c.test.total}/{QUOTA.test}
      </span>,
    );
    row("Default", <span>{SCALING_INFO[s.defaultScaling].name}, K = {s.defaultK}</span>);
    print(<div className="h-2" />);
    print(
      <div>
        Ketik <Cmd>bantuan</Cmd> untuk daftar perintah, <Cmd>sesi segar latih</Cmd> untuk mulai mengambil data, atau tekan <Kbd>Tab</Kbd> untuk lengkapi otomatis.
      </div>,
    );
    if (!d.online && !s.simulation) {
      print(
        <div className="text-amber-300/90">
          ⓘ ESP32 belum online. Nyalakan alat (menu Perangkat) atau ketik <Cmd>sim on</Cmd> untuk mencoba dengan ESP32 virtual.
        </div>,
      );
    }
    setVisual({ oled: OLED.idle(s.simulation ? "SIM" : d.online ? "ON" : "OFF") });
  }

  /* --------------------------- device commands ----------------------------- */
  async function runDevice(type: string, payload: Record<string, unknown>, label: string, ctrl: AbortController, timeoutMs = 45000): Promise<CommandDTO> {
    setBusyText(label);
    const res = await createCommand(type, payload);
    if (isFinal(res.command.status)) return res.command;
    setBusyNote(
      !res.simulated && res.deviceOnline === false
        ? "ESP32 sedang offline. Perintah masuk antrean (tekan Ctrl+C untuk batal, atau ketik sim on)."
        : "Menunggu ESP32 mengambil perintah",
    );
    return waitForCommand(res.command.id, {
      signal: ctrl.signal,
      timeoutMs,
      onTick: (c) => {
        if (c.status === "running") setBusyNote("ESP32 sedang memproses");
      },
    });
  }

  function suggestNext(ov?: LiteOverview) {
    const c = (ov ?? ovRef.current)?.counts;
    if (!c) return;
    for (const split of SPLITS) {
      for (const label of LABELS) {
        if (c[split][label] < QUOTA_PER_CLASS[split]) {
          const cmdText = `sesi ${LABEL_INFO[label].short} ${SPLIT_INFO[split].short}`;
          print(
            <div className="text-fat-300/70">
              → Berikutnya: <Cmd>{cmdText}</Cmd>{" "}
              <span className="text-fat-300/45">
                ({c[split][label]}/{QUOTA_PER_CLASS[split]})
              </span>
            </div>,
          );
          return;
        }
      }
    }
    ok("★ Dataset lengkap: 144 data latih + 36 data uji! Lanjutkan dengan 'evaluasi' dan 'benchmark'.");
  }

  async function previewSingle(label: Label, split: Split, force = false) {
    const curOv = ovRef.current;
    const isSim = !!curOv?.settings.simulation;
    const curCnt = curOv?.counts[split][label] ?? 0;
    const quota = QUOTA_PER_CLASS[split];
    const ctrl = startBusy(`Membaca warna dari ESP32 untuk ${LABEL_INFO[label].name} (${SPLIT_INFO[split].name})`);
    setVisual({
      led: true,
      scanning: true,
      meatColor: LABEL_INFO[label].meat,
      oled: OLED.capturing(label, split, curCnt, quota, isSim),
    });
    try {
      const res = await api<{ preview: PendingPreview }>("/api/device/preview", {
        method: "POST",
        json: { label, split, force },
        signal: ctrl.signal,
      });
      const p = { ...res.preview, force };
      setPendingPreview(p);
      setVisual({
        scanning: false,
        meatColor: rgbCss(p.r, p.g, p.b),
        oled: p.oledLines,
      });
    } catch (e) {
      setVisual({ scanning: false, meatColor: null });
      if (e instanceof ApiError && e.status === 409) {
        warn(e.message);
        if (sessionRef.current) endSession(true);
        suggestNext();
      } else {
        err(msg(e));
      }
    } finally {
      stopBusy();
    }
  }

  async function confirmPreview() {
    const p = pendingRef.current;
    if (!p) return;
    startBusy("Menyimpan sampel ke database");
    try {
      const res = await api<{ sample: SampleDTO; count: number; quota: number; oledLines: string[] }>("/api/samples", {
        method: "POST",
        json: {
          action: "confirm_preview",
          split: p.split,
          label: p.label,
          r: p.r,
          g: p.g,
          b: p.b,
          rawR: p.rawR,
          rawG: p.rawG,
          rawB: p.rawB,
          rawC: p.rawC,
          lux: p.lux,
          colorTemp: p.colorTemp,
          source: p.source,
        },
      });
      setPendingPreview(null);
      const ov = await refreshOverview();
      print(<CaptureLine s={res.sample} count={res.count} quota={res.quota} sim={p.source === "simulasi"} />);
      setVisual({
        scanning: false,
        meatColor: rgbCss(res.sample.r, res.sample.g, res.sample.b),
        oled: res.oledLines,
      });
      if (res.count >= res.quota && !p.force) {
        ok(`Kuota ${LABEL_INFO[p.label].name} (${SPLIT_INFO[p.split].name}) sudah terpenuhi (${res.count}/${res.quota}).`);
        if (sessionRef.current) endSession(true);
        suggestNext(ov);
      }
    } catch (e) {
      err(msg(e));
    } finally {
      stopBusy();
    }
  }

  async function retakePreview() {
    const p = pendingRef.current;
    if (!p) return;
    setPendingPreview(null);
    dim("Sampel sebelumnya dibatalkan. Mengambil ulang dari sensor ESP32.");
    await previewSingle(p.label, p.split, !!p.force);
  }

  function discardPreview() {
    if (!pendingRef.current) return;
    setPendingPreview(null);
    setVisual({ scanning: false, meatColor: null });
    dim("Preview sampel dibatalkan dan tidak disimpan.");
  }

  async function captureMany(label: Label, split: Split, n: number, opts: { force?: boolean; delayMs?: number } = {}) {
    // Untuk pengambilan 1 sampel, tampilkan Preview Visual RGB + konfirmasi Simpan / Ambil Ulang dulu
    if (n === 1) {
      await previewSingle(label, split, !!opts.force);
      return;
    }
    const ctrl = startBusy("Menyiapkan pengambilan");
    let saved = 0;
    try {
      for (let i = 0; i < n; i++) {
        if (ctrl.signal.aborted) break;
        const prefix = n > 1 ? `[${i + 1}/${n}] ` : "";
        const curOv = overview;
        const isSim = !!curOv?.settings.simulation;
        const curCnt = curOv?.counts[split][label] ?? 0;
        const quota = QUOTA_PER_CLASS[split];
        setVisual({
          led: true,
          scanning: true,
          meatColor: LABEL_INFO[label].meat,
          oled: OLED.capturing(label, split, curCnt, quota, isSim),
        });
        let cmd: CommandDTO;
        try {
          cmd = await runDevice(
            "capture",
            { label, split, force: !!opts.force },
            `${prefix}Mengambil sampel ${LABEL_INFO[label].name} ke ${SPLIT_INFO[split].name}`,
            ctrl,
          );
        } catch (e) {
          setVisual({ scanning: false, meatColor: null });
          if (e instanceof ApiError && e.status === 409) {
            warn(e.message);
            if (sessionRef.current) endSession(true);
            suggestNext();
          } else err(msg(e));
          break;
        }
        if (cmd.status !== "done") {
          err(`Gagal (${cmd.status}): ${cmd.error ?? "-"}`);
          setVisual({ scanning: false, meatColor: null });
          break;
        }
        const s = cmd.result?.sample as SampleDTO | undefined;
        if (!s) {
          err("Respons tanpa data sampel.");
          break;
        }
        saved++;
        const ov = await refreshOverview();
        const count = ov?.counts[split][label] ?? curCnt + 1;
        print(<CaptureLine s={s} count={count} quota={quota} sim={cmd.simulated} />);
        setVisual({
          scanning: false,
          meatColor: rgbCss(s.r, s.g, s.b),
          oled: OLED.saved(s.id, label, s.r, s.g, s.b, split, count, quota, cmd.simulated),
        });
        if (count >= quota && !opts.force) {
          ok(`★ Kuota ${LABEL_INFO[label].name} / ${SPLIT_INFO[split].name} terpenuhi (${count}/${quota})`);
          if (sessionRef.current) endSession(true);
          suggestNext(ov);
          break;
        }
        if (i < n - 1) {
          setBusyText("Jeda sebentar. Geser tabung sensor ke titik daging lain.");
          setBusyNote(null);
          await sleep(opts.delayMs ?? (cmd.simulated ? 150 : 1500), ctrl.signal);
        }
      }
    } finally {
      stopBusy();
      setVisual({ scanning: false });
    }
    if (ctrl.signal.aborted) warn("^C pengambilan dibatalkan");
    if (n > 1) dim(`${saved}/${n} sampel tersimpan.`);
  }

  async function startSession(label: Label, split: Split) {
    const ov = await refreshOverview();
    const count = ov?.counts[split][label] ?? 0;
    setSess({ label, split });
    print(
      <div className="my-1 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="font-semibold text-amber-300">
          ● Mode sesi: {LABEL_INFO[label].name} → {SPLIT_INFO[split].name} ({count}/{QUOTA_PER_CLASS[split]})
        </div>
        <div className="mt-1 grid gap-x-6 gap-y-0.5 text-fat-200/80 sm:grid-cols-2">
          <span>
            <Kbd>Enter</Kbd> ambil 1 sampel
          </span>
          <span>
            <Kbd>angka</Kbd> mis. 5 = ambil 5 sampel
          </span>
          <span>
            <Kbd>selesai</Kbd> / <Kbd>Esc</Kbd> keluar sesi
          </span>
          <span>
            <Kbd>Ctrl+C</Kbd> batalkan pengambilan
          </span>
        </div>
        <div className="mt-1.5 text-xs text-fat-300/60">
          Tips: kunci kait kotak agar cahaya luar tidak masuk, tempelkan tabung sensor rapat ke daging, dan geser ke titik berbeda di setiap pengambilan.
        </div>
      </div>,
    );
    setVisual({
      oled: ["MODE SESI", LABEL_INFO[label].oled, `Set: ${SPLIT_INFO[split].short.toUpperCase()}`, `${count}/${QUOTA_PER_CLASS[split]} sampel`],
      meatColor: LABEL_INFO[label].meat,
    });
  }

  function endSession(auto = false) {
    if (!sessionRef.current) {
      dim("Tidak ada sesi aktif.");
      return;
    }
    setSess(null);
    dim(auto ? "Sesi diakhiri otomatis (kuota terpenuhi)." : "Sesi selesai.");
    setVisual({ meatColor: null });
  }

  async function analyze(scaling: Scaling, k: number, truth?: Label) {
    const isSim = !!overview?.settings.simulation;
    const ctrl = startBusy("Mengirim perintah analisa ke ESP32");
    setVisual({ led: true, scanning: true, meatColor: truth ? LABEL_INFO[truth].meat : "#9b2830", oled: OLED.analyzing(scaling, k, isSim) });
    try {
      const cmd = await runDevice(
        "classify",
        { scaling, k, ...(truth ? { truth } : {}) },
        `ESP32 membaca warna dan menjalankan KNN (${SCALING_INFO[scaling].name}, K=${k})`,
        ctrl,
        95000,
      );
      if (cmd.status !== "done") {
        err(`Analisa gagal (${cmd.status}): ${cmd.error ?? "-"}`);
        setVisual({ scanning: false, meatColor: null });
        return;
      }
      const c = cmd.result?.classification as ClassificationDTO | undefined;
      if (!c) {
        err("Respons tanpa hasil klasifikasi.");
        return;
      }
      print(<ResultBlock c={c} sim={cmd.simulated} />);
      setVisual({
        scanning: false,
        meatColor: rgbCss(c.r, c.g, c.b),
        oled: OLED.result(c.predicted, c.r, c.g, c.b, c.execUs, c.rNorm, c.gNorm, c.bNorm, cmd.simulated, c.k),
      });
    } catch (e) {
      err(`✗ ${msg(e)}`);
      setVisual({ scanning: false, meatColor: null });
    } finally {
      stopBusy();
    }
  }

  async function benchmark(kIn: number, repeatIn: number) {
    const k = clampK(kIn);
    const repeat = Math.min(10, Math.max(1, Math.round(repeatIn) || 3));
    const ctrl = startBusy("Mengirim perintah benchmark");
    setVisual({ scanning: true, oled: ["BENCHMARK KNN", "Data uji x3", "metode...", `K=${k} ulang=${repeat}`] });
    try {
      const cmd = await runDevice("benchmark", { k, repeat }, `ESP32 menjalankan KNN pada data uji × 3 metode (K=${k}, ${repeat}× ulang)`, ctrl, 120000);
      if (cmd.status !== "done") {
        err(`✗ Benchmark gagal (${cmd.status}): ${cmd.error ?? "-"}`);
        return;
      }
      const rows = (cmd.result?.benchmarks as BenchmarkDTO[] | undefined) ?? [];
      print(<BenchTable rows={rows} sim={cmd.simulated} />);
      setVisual({ oled: ["BENCHMARK OK", ...rows.map((r) => `${(SCALING_INFO[r.scaling]?.short ?? r.scaling).padEnd(8)}${Math.round(r.avgUs)}us`)] });
    } catch (e) {
      err(`✗ ${msg(e)}`);
    } finally {
      stopBusy();
      setVisual({ scanning: false });
    }
  }

  async function evaluation(kArg?: number) {
    const k = clampK(kArg ?? ovRef.current?.settings.defaultK ?? 5);
    startBusy(`Menghitung akurasi KNN (K=${k}) untuk 3 metode feature scaling`);
    try {
      const ev = await api<EvaluationDTO>(`/api/evaluation?k=${k}`);
      if (!ev.ready || !ev.methods) {
        warn(`⚠ Butuh data latih & data uji. Saat ini: ${ev.trainCount} latih, ${ev.testCount} uji.`);
        suggestNext();
        return;
      }
      print(<EvalTable ev={ev} />);
    } catch (e) {
      err(`✗ ${msg(e)}`);
    } finally {
      stopBusy();
    }
  }

  async function simpleCommand(type: "ping" | "sync") {
    const ctrl = startBusy(type === "ping" ? "Ping ke ESP32" : "Meminta ESP32 mengunduh ulang dataset");
    const t0 = performance.now();
    if (type === "ping") setVisual({ oled: ["PING", "!HALO!", "dari website", ""] });
    try {
      const cmd = await runDevice(type, {}, type === "ping" ? "Menunggu balasan ESP32" : "ESP32 menyinkronkan model", ctrl, 30000);
      const ms = Math.round(performance.now() - t0);
      if (cmd.status === "done") {
        const r = cmd.result ?? {};
        ok(
          `${type === "ping" ? "Pong" : "Sinkron"} dalam ${ms} ms${r.info ? ` (${String(r.info)})` : ""}${
            r.trainCount != null ? `, ${String(r.trainCount)} data latih` : ""
          }`,
        );
      } else err(`✗ ${cmd.status}: ${cmd.error ?? "-"}`);
    } catch (e) {
      err(`✗ ${msg(e)}`);
    } finally {
      stopBusy();
    }
  }

  /* ------------------------------ info commands ---------------------------- */
  function showHelp() {
    const groups = Array.from(new Set(HELP.map((h) => h.group)));
    print(
      <div className="my-1 space-y-1.5">
        {groups.map((g) => (
          <div key={g}>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-beef-300/80">{g}</div>
            {HELP.filter((h) => h.group === g).map((h) => (
              <div key={h.usage} className="grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(0,340px)_1fr]">
                <span className="text-fat-50">{h.usage}</span>
                <span className="text-fat-300/60">{h.desc}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="text-fat-300/50">Pintasan: Panah atas/bawah riwayat, Tab lengkapi, Ctrl+C batal, Ctrl+L bersihkan, Esc keluar sesi</div>
      </div>,
    );
  }

  async function showStatus() {
    const ov = await refreshOverview();
    if (!ov) {
      err("✗ Gagal memuat status");
      return;
    }
    const d = ov.device;
    const s = ov.settings;
    const synced = d.modelVersion != null && d.modelVersion === s.modelVersion;
    const rows: Array<[string, ReactNode]> = [
      ["Perangkat", <span key="a">{d.id} {d.online ? <span className="text-emerald-400">● online</span> : <span className="text-fat-300/60">○ offline</span>}</span>],
      ["Terakhir terlihat", timeAgo(d.lastSeen)],
      ["IP / RSSI", `${d.ip ?? "-"} / ${d.rssi != null ? `${d.rssi} dBm` : "-"}`],
      ["Free heap", fmtBytes(d.freeHeap)],
      ["Firmware", d.firmware ?? "-"],
      ["Sensor TCS34725", d.sensorOk == null ? "-" : d.sensorOk ? <span key="b" className="text-emerald-400">OK (I2C 0x29)</span> : <span key="b" className="text-red-400">tidak terdeteksi</span>],
      ["OLED SSD1306", d.oledOk == null ? "-" : d.oledOk ? <span key="c" className="text-emerald-400">OK (I2C 0x3C)</span> : <span key="c" className="text-red-400">tidak terdeteksi</span>],
      [
        "Model di ESP32",
        d.modelVersion != null ? (
          <span key="d">
            v{d.modelVersion} ({d.trainCount ?? 0} data latih){" "}
            {synced ? <span className="text-emerald-400">✓ tersinkron</span> : <span className="text-amber-300">(server v{s.modelVersion}, sinkron otomatis saat analisa)</span>}
          </span>
        ) : (
          "-"
        ),
      ],
      ["Mode", s.simulation ? <span key="e" className="text-sky-300">SIMULASI (ESP32 virtual)</span> : "perangkat nyata"],
      ["Default", `${SCALING_INFO[s.defaultScaling].name}, K = ${s.defaultK}`],
      ["Uptime", d.uptimeS != null ? `${Math.floor(d.uptimeS / 60)} mnt ${d.uptimeS % 60} dtk` : "-"],
    ];
    print(
      <div className="my-1 grid max-w-2xl grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-fat-300/55">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>,
    );
  }

  function showWiring() {
    print(
      <div className="my-1 overflow-x-auto">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-fat-300/50">Jalur pin bus I2C bersama (TCS34725 0x29 dan SSD1306 0x3C)</div>
        <table className="term-table text-[12.5px]">
          <thead>
            <tr>
              <th>ESP32</th>
              <th />
              <th>Tujuan</th>
              <th>Sinyal</th>
            </tr>
          </thead>
          <tbody>
            {PIN_MAP.map((p, i) => (
              <tr key={i}>
                <td className="text-fat-50">{p.from}</td>
                <td style={{ color: p.color }}>━━━━▶</td>
                <td>{p.to}</td>
                <td style={{ color: p.color }}>{p.signal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-fat-300/60">LED putih eksternal tidak dipakai. Penerangan berasal dari LED bawaan modul TCS34725.</div>
      </div>,
    );
  }

  async function showProgress() {
    const ov = await refreshOverview();
    if (!ov) {
      err("✗ Gagal memuat progres");
      return;
    }
    const c = ov.counts;
    print(
      <div className="my-1">
        {SPLITS.map((split) => (
          <div key={split} className="mb-1">
            <div className="text-fat-50">
              {SPLIT_INFO[split].name}{" "}
              <span className="text-fat-300/50">
                {c[split].total}/{QUOTA[split]}
              </span>
            </div>
            {LABELS.map((l) => {
              const n = c[split][l];
              const q = QUOTA_PER_CLASS[split];
              return (
                <div key={l} className="flex gap-2 whitespace-pre">
                  <span style={{ color: LABEL_INFO[l].color }}>{`  ${LABEL_INFO[l].name.padEnd(15)}`}</span>
                  <span className={n >= q ? "text-emerald-400" : "text-beef-400/80"}>{bar(n, q, 24)}</span>
                  <span>
                    {String(n).padStart(2)}/{q}
                  </span>
                  {n >= q && <span className="text-emerald-400">✓</span>}
                </div>
              );
            })}
          </div>
        ))}
        <div className="text-fat-300/50">
          sumber:{" "}
          {Object.entries(c.bySource)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ") || "-"}
        </div>
      </div>,
    );
    suggestNext(ov);
  }

  async function showHistory(n: number) {
    const ov = await api<OverviewDTO>("/api/overview");
    const rows = ov.history.slice(0, Math.min(30, Math.max(1, n || 8)));
    if (!rows.length) {
      dim("Belum ada riwayat klasifikasi. Jalankan 'analisa'.");
      return;
    }
    print(
      <div className="my-1 overflow-x-auto">
        <table className="term-table text-[12.5px]">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>RGB (asli)</th>
              <th>RGB (norm)</th>
              <th>Metode</th>
              <th>Hasil</th>
              <th>Waktu eks.</th>
              <th>Memori</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{fmtTime(c.createdAt)}</td>
                <td>
                  <Sw r={c.r} g={c.g} b={c.b} />({Math.round(c.r)},{Math.round(c.g)},{Math.round(c.b)})
                </td>
                <td>
                  ({fmtNum(c.rNorm, 2)},{fmtNum(c.gNorm, 2)},{fmtNum(c.bNorm, 2)})
                </td>
                <td>
                  {SCALING_INFO[c.scaling]?.short} K{c.k}
                </td>
                <td style={{ color: LABEL_INFO[c.predicted]?.color }}>{LABEL_INFO[c.predicted]?.name.toUpperCase()}</td>
                <td>{fmtUs(c.execUs)}</td>
                <td>{fmtBytes(c.memBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  async function listData(pos: string[]) {
    let split: Split | null = null;
    let label: Label | null = null;
    let n = 10;
    for (const a of pos) {
      if (/^\d+$/.test(a)) n = Math.min(100, Math.max(1, Number(a)));
      else if (parseSplit(a)) split = parseSplit(a);
      else if (parseLabel(a)) label = parseLabel(a);
    }
    const params = new URLSearchParams({ limit: String(n) });
    if (split) params.set("split", split);
    if (label) params.set("label", label);
    const res = await api<{ samples: SampleDTO[] }>(`/api/samples?${params.toString()}`);
    if (!res.samples.length) {
      dim("Tidak ada data.");
      return;
    }
    print(
      <div className="my-1 overflow-x-auto">
        <table className="term-table text-[12.5px]">
          <thead>
            <tr>
              <th>ID</th>
              <th>Waktu</th>
              <th>Set</th>
              <th>Kelas</th>
              <th>RGB</th>
              <th>Clear</th>
              <th>Sumber</th>
            </tr>
          </thead>
          <tbody>
            {res.samples.map((s) => (
              <tr key={s.id}>
                <td className="text-fat-300/60">#{s.id}</td>
                <td>{fmtTime(s.createdAt)}</td>
                <td>{SPLIT_INFO[s.split]?.short}</td>
                <td style={{ color: LABEL_INFO[s.label]?.color }}>{LABEL_INFO[s.label]?.name}</td>
                <td>
                  <Sw r={s.r} g={s.g} b={s.b} />({fmtNum(s.r, 1)}, {fmtNum(s.g, 1)}, {fmtNum(s.b, 1)})
                </td>
                <td>{s.rawC ?? "-"}</td>
                <td className={s.source === "simulasi" ? "text-sky-300/80" : ""}>{s.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  async function deleteSample(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      usage("hapus <id>");
      return;
    }
    const res = await api<{ sample: SampleDTO }>(`/api/samples/${id}`, { method: "DELETE" });
    ok(`✓ Sampel #${res.sample.id} (${LABEL_INFO[res.sample.label]?.name} / ${SPLIT_INFO[res.sample.split]?.short}) dihapus`);
    await refreshOverview();
  }

  async function undo() {
    const res = await api<{ samples: SampleDTO[] }>("/api/samples?limit=1");
    const last = res.samples[0];
    if (!last) {
      dim("Dataset kosong.");
      return;
    }
    await deleteSample(last.id);
  }

  async function setSim(arg?: string) {
    const cur = ovRef.current?.settings.simulation ?? false;
    const a = (arg ?? "").toLowerCase();
    const val = ["on", "1", "aktif", "nyala"].includes(a) ? true : ["off", "0", "mati", "nonaktif"].includes(a) ? false : !cur;
    await api("/api/settings", { method: "PUT", json: { simulation: val } });
    const ov = await refreshOverview();
    if (val) say("Mode simulasi AKTIF. Perintah dijalankan di ESP32 virtual dan data ditandai sebagai simulasi.", "text-sky-300");
    else ok("Mode simulasi NONAKTIF. Perintah dikirim ke ESP32 asli.");
    setVisual({ oled: OLED.idle(val ? "SIM" : ov?.device.online ? "ON" : "OFF") });
  }

  async function seed() {
    startBusy("Mengisi sisa kuota dengan data simulasi");
    try {
      const res = await api<{ inserted: number }>("/api/samples", { method: "POST", json: { action: "seed" } });
      ok(`✓ ${res.inserted} sampel simulasi ditambahkan (sumber: simulasi).`);
    } finally {
      stopBusy();
    }
    await showProgress();
  }

  async function reset(scope?: string, yes?: boolean) {
    const map: Record<string, string> = { simulasi: "simulasi", sim: "simulasi", semua: "all", all: "all", riwayat: "history", history: "history" };
    const s = scope ? map[scope.toLowerCase()] : undefined;
    if (!s) {
      usage("reset <simulasi|riwayat|semua> --yakin");
      return;
    }
    if (!yes) {
      warn(`⚠ Tindakan ini menghapus data (${scope}). Ulangi dengan: reset ${scope} --yakin`);
      return;
    }
    const res = await api<{ deleted: number }>(`/api/samples?scope=${s}`, { method: "DELETE" });
    ok(`✓ ${res.deleted} data dihapus.`);
    await refreshOverview();
  }

  async function setDefault(key?: string, value?: string) {
    const k = (key ?? "").toLowerCase();
    if (k === "k") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 25) {
        usage("set k <1-25>");
        return;
      }
      await api("/api/settings", { method: "PUT", json: { defaultK: n } });
      ok(`✓ K default = ${n}`);
    } else if (k === "scaling" || k === "metode") {
      const s = parseScaling(value);
      if (!s) {
        usage("set scaling <none|minmax|zscore>");
        return;
      }
      await api("/api/settings", { method: "PUT", json: { defaultScaling: s } });
      ok(`✓ Metode default = ${SCALING_INFO[s].name}`);
    } else {
      usage("set k <n> | set scaling <none|minmax|zscore>");
      return;
    }
    await refreshOverview();
  }

  function control3d(arg?: string) {
    const a = (arg ?? "").toLowerCase();
    switch (a) {
      case "putar":
      case "rotate":
        setVisual((v) => ({ autoRotate: !v.autoRotate }));
        ok("↻ Rotasi otomatis di-toggle");
        return;
      case "xray":
        setVisual((v) => ({ xray: !v.xray }));
        ok("Mode X-Ray diubah. Menampilkan ESP32 dan kabel I2C (G26 SDA, G27 SCL).");
        return;
      case "buka":
        setVisual({ lidOpen: true });
        ok("▾ Kait dilepas, tutup depan (engsel 25 mm) dibuka");
        return;
      case "tutup":
        setVisual({ lidOpen: false });
        ok("▴ Tutup depan ditutup & dikunci kait");
        return;
      case "label":
        setVisual((v) => ({ labels: !v.labels }));
        ok("Label komponen di-toggle");
        return;
      case "depan":
      case "belakang":
      case "samping":
      case "atas":
      case "awal":
        onView(a);
        ok(`Kamera → ${a}`);
        return;
      case "reset":
        setVisual((v) => ({ ...DEFAULT_VISUAL, oled: v.oled }));
        onView("awal");
        ok("Tampilan 3D direset");
        return;
      default:
        usage("3d putar|xray|buka|tutup|label|depan|belakang|samping|atas|reset");
    }
  }

  function navigate(page?: string) {
    const map: Record<string, string> = {
      dashboard: "/",
      beranda: "/",
      dataset: "/dataset",
      data: "/dataset",
      evaluasi: "/evaluasi",
      eval: "/evaluasi",
      perangkat: "/perangkat",
      alat: "/perangkat",
    };
    const href = page ? map[page.toLowerCase()] : undefined;
    if (!href) {
      usage("ke dashboard|dataset|evaluasi|perangkat");
      return;
    }
    ok(`→ membuka ${href}`);
    router.push(href);
  }

  function about() {
    print(
      <div className="my-1 max-w-2xl space-y-0.5 text-fat-200/85">
        <div className="font-semibold text-fat-50">Beef Fresh | Klasifikasi Kesegaran Daging Sapi</div>
        <div>
          Klasifikasi daging sapi <span style={{ color: LABEL_INFO.segar.color }}>Segar</span>,{" "}
          <span style={{ color: LABEL_INFO.mulai_membusuk.color }}>Mulai Membusuk</span>, dan{" "}
          <span style={{ color: LABEL_INFO.busuk.color }}>Busuk</span> berdasarkan warna RGB sensor TCS34725.
        </div>
        <div>Perangkat: ESP32, TCS34725 (LED bawaan), OLED SSD1306, bus I2C G26 (SDA) dan G27 (SCL).</div>
        <div>Dataset: 144 data latih (48 per kelas) dan 36 data uji (12 per kelas). Metode: Tanpa scaling, Min-Max, dan Z-Score dengan KNN Euclidean.</div>
        <div>KNN dijalankan di ESP32. Waktu proses (mikrodetik) dan penggunaan RAM (byte) diukur langsung di perangkat.</div>
      </div>,
    );
  }

  function pushHistory(line: string) {
    const h = histRef.current.filter((x) => x !== line);
    h.push(line);
    histRef.current = h.slice(-100);
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(histRef.current));
    } catch {
      /* abaikan */
    }
  }

  /* ------------------------------ dispatcher ------------------------------- */
  async function execute(raw: string) {
    const sess = sessionRef.current;
    print(
      <div className="mt-1 flex flex-wrap">
        <Prompt session={sess} counts={ovRef.current?.counts} />
        <span className="break-all text-fat-50">{raw}</span>
      </div>,
    );
    const line = raw.trim();
    if (pendingRef.current) {
      const low = line.toLowerCase();
      if (!low || low === "y" || low === "ya" || low === "simpan") {
        await confirmPreview();
        return;
      }
      if (low === "r" || low === "ulang" || low === "retake") {
        await retakePreview();
        return;
      }
      if (low === "n" || low === "batal" || low === "hapus") {
        discardPreview();
        return;
      }
    }
    if (!line) {
      if (sess) await captureMany(sess.label, sess.split, 1);
      return;
    }
    pushHistory(line);
    const tokens = line.split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    const flags = new Set(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).toLowerCase()));
    const pos = args.filter((a) => !a.startsWith("--"));
    try {
      if (sess && /^\d+$/.test(cmd)) {
        await captureMany(sess.label, sess.split, Math.min(48, Math.max(1, Number(cmd))));
        return;
      }
      switch (cmd) {
        case "bantuan":
        case "help":
        case "?":
          return showHelp();
        case "clear":
        case "cls":
          setLines([]);
          return;
        case "kalibrasi":
        case "calibrate": {
          const mode = (pos[0] ?? "").toLowerCase();
          const action =
            mode === "putih" || mode === "white"
              ? "white"
              : mode === "hitam" || mode === "gelap" || mode === "black"
                ? "black"
                : mode === "reset"
                  ? "reset"
                  : null;
          if (!action) return usage("kalibrasi <putih|hitam|reset>");
          startBusy(
            action === "white"
              ? "Mengkalibrasi referensi putih (255) pada ESP32"
              : action === "black"
                ? "Mengkalibrasi referensi hitam (0) pada ESP32"
                : "Mereset kalibrasi warna pada ESP32",
          );
          try {
            const res = await api<{
              calibration: { white_ok: boolean; black_ok: boolean; white: number[]; black: number[] };
              oledLines?: string[];
            }>("/api/device/calibrate", { method: "POST", json: { action } });
            if (res.oledLines?.length) setVisual({ scanning: false, oled: res.oledLines });
            await refreshOverview();
            if (action === "white") {
              ok(`Kalibrasi Putih (255) tersimpan di ESP32. Raw putih: (${res.calibration.white.map((v) => Math.round(v)).join(", ")}).`);
            } else if (action === "black") {
              ok(`Kalibrasi Hitam (0) tersimpan di ESP32. Raw hitam: (${res.calibration.black.map((v) => Math.round(v)).join(", ")}).`);
            } else {
              ok("Kalibrasi warna direset ke mode mentah.");
            }
          } finally {
            stopBusy();
          }
          return;
        }
        case "status":
          return await showStatus();
        case "pin":
        case "wiring":
        case "kabel":
          return showWiring();
        case "progres":
        case "progress":
          return await showProgress();
        case "ambil":
        case "capture": {
          const label = parseLabel(pos[0]);
          const split = parseSplit(pos[1]);
          if (!label || !split) return usage("ambil <segar|mulai|busuk> <latih|uji> [jumlah] [--paksa] [--jeda=detik]");
          const n = pos[2] ? Math.min(48, Math.max(1, Number(pos[2]) || 1)) : 1;
          const jeda = flagValue(args, "jeda");
          return await captureMany(label, split, n, {
            force: flags.has("paksa") || flags.has("force"),
            delayMs: jeda != null && Number.isFinite(Number(jeda)) ? Number(jeda) * 1000 : undefined,
          });
        }
        case "sesi":
        case "session": {
          const label = parseLabel(pos[0]);
          const split = parseSplit(pos[1]);
          if (!label || !split) return usage("sesi <segar|mulai|busuk> <latih|uji>");
          return await startSession(label, split);
        }
        case "selesai":
        case "keluar":
        case "exit":
        case "q":
          return endSession();
        case "analisa":
        case "analyze":
        case "klasifikasi":
        case "scan": {
          const s = ovRef.current?.settings;
          let scaling: Scaling = s?.defaultScaling ?? "minmax";
          let k = s?.defaultK ?? 5;
          for (const a of pos) {
            if (/^\d+$/.test(a)) k = clampK(Number(a));
            else {
              const sc = parseScaling(a);
              if (sc) scaling = sc;
            }
          }
          const truth = parseLabel(flagValue(args, "sampel")) ?? undefined;
          return await analyze(scaling, k, truth);
        }
        case "benchmark":
        case "bench":
          return await benchmark(pos[0] ? Number(pos[0]) : ovRef.current?.settings.defaultK ?? 5, pos[1] ? Number(pos[1]) : 3);
        case "evaluasi":
        case "eval":
        case "akurasi":
          return await evaluation(pos[0] ? Number(pos[0]) : undefined);
        case "riwayat":
        case "history":
          return await showHistory(pos[0] ? Number(pos[0]) : 8);
        case "data":
        case "ls":
          return await listData(pos);
        case "hapus":
        case "rm":
          return await deleteSample(Number(pos[0]));
        case "undo":
          return await undo();
        case "sim":
          return await setSim(pos[0]);
        case "seed":
          return await seed();
        case "reset":
          return await reset(pos[0], flags.has("yakin") || flags.has("y"));
        case "ping":
          return await simpleCommand("ping");
        case "sync":
          return await simpleCommand("sync");
        case "set":
          return await setDefault(pos[0], pos[1]);
        case "ekspor":
        case "export":
          window.open("/api/samples/export", "_blank");
          ok("✓ Mengunduh dataset CSV (dengan kolom Min-Max & Z-Score)");
          return;
        case "3d":
          return control3d(pos[0]);
        case "xray":
        case "putar":
        case "buka":
        case "tutup":
        case "label":
          return control3d(cmd);
        case "ke":
        case "goto":
        case "cd":
          return navigate(pos[0]);
        case "tentang":
        case "about":
          return about();
        default: {
          const sug = COMMANDS.filter((c) => c.startsWith(cmd.slice(0, 2)));
          err(`Perintah tidak dikenal: ${cmd}`);
          if (sug.length) {
            print(
              <div className="text-fat-300/60">
                Mungkin maksud Anda:{" "}
                {sug.map((s) => (
                  <Cmd key={s} run={false}>
                    {s}
                  </Cmd>
                ))}
              </div>,
            );
          } else dim("Ketik 'bantuan' untuk melihat daftar perintah.");
        }
      }
    } catch (e) {
      err(`✗ ${msg(e)}`);
    }
  }

  async function submit(raw: string) {
    if (busyRef.current) return;
    setInput("");
    setTabHints([]);
    histIdx.current = -1;
    await execute(raw);
  }

  useEffect(() => {
    runRef.current = (c: string, autorun = true) => {
      if (autorun && !busyRef.current) void submit(c);
      else {
        setInput(`${c} `);
        inputRef.current?.focus();
      }
    };
  });
  const runStable = useCallback((c: string, autorun?: boolean) => runRef.current(c, autorun), []);

  function complete() {
    const parts = input.split(" ");
    if (parts.length <= 1) {
      const cur = parts[0].toLowerCase();
      const m = COMMANDS.filter((c) => c.startsWith(cur));
      if (m.length === 1) {
        setInput(`${m[0]} `);
        setTabHints([]);
      } else if (m.length > 1) {
        const p = commonPrefix(m);
        if (p.length > cur.length) setInput(p);
        setTabHints(m);
      }
      return;
    }
    const opts = ARG_HINTS[parts[0].toLowerCase()]?.[parts.length - 2] ?? [];
    const cur = parts[parts.length - 1].toLowerCase();
    const m = opts.filter((o) => o.startsWith(cur));
    if (m.length === 1) {
      parts[parts.length - 1] = m[0];
      setInput(`${parts.join(" ")} `);
      setTabHints([]);
    } else if (m.length > 1) {
      const p = commonPrefix(m);
      if (p.length > cur.length) {
        parts[parts.length - 1] = p;
        setInput(parts.join(" "));
      }
      setTabHints(m);
    }
  }

  function applyHint(h: string) {
    const parts = input.split(" ");
    parts[parts.length - 1] = h;
    setInput(`${parts.join(" ")} `);
    setTabHints([]);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!busyRef.current) void submit(input);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      complete();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = histRef.current;
      if (!h.length) return;
      histIdx.current = histIdx.current < 0 ? h.length - 1 : Math.max(0, histIdx.current - 1);
      setInput(h[histIdx.current]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = histRef.current;
      if (histIdx.current < 0) return;
      histIdx.current += 1;
      if (histIdx.current >= h.length) {
        histIdx.current = -1;
        setInput("");
      } else setInput(h[histIdx.current]);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "c") {
      const selected = window.getSelection()?.toString();
      if (busyRef.current) {
        e.preventDefault();
        abortRef.current?.abort();
        setBusyNote("Membatalkan");
      } else if (!selected) {
        e.preventDefault();
        print(
          <div className="mt-1 flex">
            <Prompt session={sessionRef.current} counts={ovRef.current?.counts} />
            <span>{input}</span>
            <span className="text-fat-300/50">^C</span>
          </div>,
        );
        setInput("");
      }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setLines([]);
      return;
    }
    if (e.key === "Escape") {
      if (sessionRef.current) {
        e.preventDefault();
        endSession();
      } else setTabHints([]);
    }
  }

  const liveHints = useMemo(() => computeHints(input), [input]);
  const hints = tabHints.length ? tabHints : liveHints;
  const sim = overview?.settings.simulation;
  const online = overview?.device.online;

  return (
    <RunCtx.Provider value={runStable}>
      <section
        className="card surface-dark flex h-[64vh] min-h-[440px] flex-col overflow-hidden lg:h-auto lg:min-h-0"
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line/80 bg-black/35 px-3 py-2">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 truncate text-center font-mono text-xs text-fat-300/60">
            beef-fresh | esp32-cli {session ? `| sesi ${LABEL_INFO[session.label].short}/${SPLIT_INFO[session.split].short}` : ""}
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10px] ring-1",
              sim ? "bg-sky-950/60 text-sky-300 ring-sky-800/60" : online ? "bg-emerald-950/60 text-emerald-300 ring-emerald-800/60" : "bg-white/5 text-fat-300/60 ring-white/10",
            )}
          >
            {sim ? "SIM" : online ? "ONLINE" : "OFFLINE"}
          </span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed">
          {lines.map((l) => (
            <div key={l.id}>{l.node}</div>
          ))}
          {busy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Spinner />
              <span className="text-fat-100">{busy}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  abortRef.current?.abort();
                  setBusyNote("Membatalkan");
                }}
                className="rounded border border-line px-1.5 text-[11px] text-fat-300/70 hover:text-fat-50"
              >
                Ctrl+C batal
              </button>
            </div>
          )}
          {busy && busyNote && <div className="pl-6 text-[12px] text-fat-300/55">{busyNote}</div>}
          {pendingPreview && !busy && (
            <div
              className="my-2 rounded-xl border border-beef-600/50 bg-[#1a0a0d]/90 p-3 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="h-14 w-14 shrink-0 rounded-xl ring-2 ring-white/20 shadow-inner"
                  style={{ background: rgbCss(pendingPreview.r, pendingPreview.g, pendingPreview.b) }}
                  title={`Warna terbaca: RGB(${Math.round(pendingPreview.r)}, ${Math.round(pendingPreview.g)}, ${Math.round(pendingPreview.b)})`}
                />
                <div className="min-w-0 flex-1 space-y-0.5 font-sans">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-fat-50">
                      Preview Sampel {LABEL_INFO[pendingPreview.label].name} ({SPLIT_INFO[pendingPreview.split].name})
                    </span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-fat-200">
                      #{pendingPreview.nextCount}/{pendingPreview.quota}
                    </span>
                    <span className="rounded bg-emerald-950/70 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-emerald-700/40">
                      {pendingPreview.fromHardware ? "ESP32 TCS34725" : "Virtual"}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-fat-100">
                    RGB ({pendingPreview.r.toFixed(1)}, {pendingPreview.g.toFixed(1)}, {pendingPreview.b.toFixed(1)})
                    {pendingPreview.rawC != null && (
                      <span className="ml-2 text-fat-300/65">
                        Clear: {pendingPreview.rawC} | Lux: {pendingPreview.lux != null ? Math.round(pendingPreview.lux) : "-"}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-fat-300/65">
                    Periksa warna visual di kiri. Simpan ke dataset, atau ambil ulang jika posisi sensor belum pas.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 font-sans">
                <button
                  type="button"
                  onClick={() => void confirmPreview()}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Simpan (Enter)
                </button>
                <button
                  type="button"
                  onClick={() => void retakePreview()}
                  className="rounded-lg border border-amber-600/50 bg-amber-950/50 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
                >
                  Ambil Ulang (R)
                </button>
                <button
                  type="button"
                  onClick={discardPreview}
                  className="rounded-lg border border-line bg-white/5 px-3 py-1.5 text-xs font-medium text-fat-200 hover:bg-white/10"
                >
                  Batal (N)
                </button>
              </div>
            </div>
          )}
          <div className={cn("mt-1 flex items-center", busy && "opacity-40")}>
            <Prompt session={session} counts={overview?.counts} />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setTabHints([]);
              }}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              aria-label="Input terminal"
              placeholder={
                pendingPreview
                  ? "Enter = simpan, r = ambil ulang, n = batal"
                  : session
                    ? "Tekan Enter untuk ambil sampel, atau ketik selesai untuk keluar"
                    : "Ketik perintah (misal: bantuan)"
              }
              className="min-w-0 flex-1 bg-transparent font-mono text-fat-50 caret-beef-400 outline-none placeholder:text-fat-300/25"
            />
          </div>
        </div>

        <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 border-t border-line/80 bg-black/30 px-3 py-2">
          {hints.length > 0 ? (
            <>
              <span className="mr-1 text-[10px] uppercase tracking-wider text-fat-300/45">Tab</span>
              {hints.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    applyHint(h);
                  }}
                  className="rounded-md border border-line bg-panel-2/70 px-2 py-0.5 font-mono text-[11px] text-fat-100 hover:border-beef-600"
                >
                  {h}
                </button>
              ))}
            </>
          ) : session ? (
            <>
              <span className="mr-1 text-[10px] uppercase tracking-wider text-amber-300/70">Sesi</span>
              {["", "5", "10", "progres", "selesai"].map((c) => (
                <button
                  key={c || "enter"}
                  type="button"
                  disabled={!!busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void submit(c);
                  }}
                  className="rounded-md border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 font-mono text-[11px] text-amber-200 hover:border-amber-500 disabled:opacity-40"
                >
                  {c === "" ? "⏎ ambil 1" : /^\d+$/.test(c) ? `ambil ${c}` : c}
                </button>
              ))}
            </>
          ) : (
            <>
              <span className="mr-1 text-[10px] uppercase tracking-wider text-fat-300/45">Cepat</span>
              {QUICK.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!!busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void submit(c);
                  }}
                  className="rounded-md border border-line bg-panel-2/70 px-2 py-0.5 font-mono text-[11px] text-fat-200 hover:border-beef-600 hover:text-fat-50 disabled:opacity-40"
                >
                  {c}
                </button>
              ))}
            </>
          )}
        </div>
      </section>
    </RunCtx.Provider>
  );
}
