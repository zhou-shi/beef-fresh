"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Beef,
  ChartColumn,
  ChartLine,
  Check,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  MemoryStick,
  Microchip,
  Monitor,
  ScanLine,
  Server,
  Sparkles,
  SquareTerminal,
  Target,
  Timer,
  X,
} from "lucide-react";
import { api, createCommand, isFinal, usePoll, waitForCommand } from "@/lib/client";
import {
  K_OPTIONS,
  LABELS,
  LABEL_INFO,
  QUOTA,
  QUOTA_PER_CLASS,
  SCALINGS,
  SCALING_INFO,
  SPLITS,
  SPLIT_INFO,
  fmtBytes,
  fmtDateTime,
  fmtNum,
  fmtPct,
  fmtTime,
  fmtUs,
  rgbCss,
  timeAgo,
  type Scaling,
} from "@/lib/constants";
import type { BenchmarkDTO, ClassificationDTO, EvaluationDTO, OverviewDTO } from "@/lib/types";
import { AccuracyChart, ExecTimeChart, ExecTrendChart, KSweepChart, MemoryChart, type AccuracyDatum } from "@/components/charts";
import { Badge, Button, Card, EmptyState, LabelBadge, MetaItems, ProgressBar, Segmented, Stat, StatusCheck, StatusDot, Swatch, Toggle, cn } from "@/components/ui";

type Analysis =
  | { phase: "idle" }
  | { phase: "waiting"; queued: boolean; note: string }
  | { phase: "done"; c: ClassificationDTO; sim: boolean }
  | { phase: "error"; message: string };

function Info({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-fat-300/50">{k}</div>
      <div className="truncate text-[13px] text-fat-100">{v}</div>
    </div>
  );
}

function Pipeline({ online, sim }: { online: boolean; sim: boolean }) {
  const steps = [
    { icon: ScanLine, title: "TCS34725", desc: "Baca RGB dan LED" },
    { icon: Cpu, title: "ESP32", desc: "Scaling lalu KNN" },
    { icon: Monitor, title: "OLED SSD1306", desc: "Tampilkan hasil" },
    { icon: Server, title: "Supabase", desc: "Simpan dataset" },
    { icon: ChartColumn, title: "Website", desc: "Pantau dan kontrol" },
  ];
  return (
    <div className="card grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-5">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <div key={s.title} className="relative flex items-center gap-2.5 rounded-xl border border-line bg-black/20 px-3 py-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-beef-900/60 text-beef-300 ring-1 ring-beef-700/40">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-fat-50">
                <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]", online || sim ? "bg-beef-600/30 text-beef-200" : "bg-white/10 text-fat-300/60")}>
                  {i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </div>
              <div className="truncate text-[11px] text-fat-300/60">{s.desc}</div>
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className={cn("hidden h-3.5 w-3.5 shrink-0 lg:block", online || sim ? "text-beef-400/80" : "text-fat-300/25")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultPanel({ analysis, latest, onCancel }: { analysis: Analysis; latest: ClassificationDTO | null; onCancel: () => void }) {
  if (analysis.phase === "waiting") {
    return (
      <div className="relative flex h-full min-h-[260px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-beef-800/60 bg-black/30 p-6 text-center">
        <div className="pointer-events-none absolute inset-x-0 h-16 animate-scan bg-linear-to-b from-transparent via-beef-500/25 to-transparent" />
        <div className="relative grid h-16 w-16 place-items-center rounded-full bg-beef-900/70 ring-1 ring-beef-600/50">
          <ScanLine className="h-7 w-7 animate-pulse text-beef-300" />
        </div>
        <div className="relative mt-4 text-sm font-semibold text-fat-50">{analysis.queued ? "Menunggu ESP32" : "ESP32 sedang menganalisa daging"}</div>
        <div className="relative mt-1 max-w-sm text-xs text-fat-300/70">{analysis.note}</div>
        <Button size="sm" variant="ghost" className="relative mt-4" icon={<X className="h-3.5 w-3.5" />} onClick={onCancel}>
          Batalkan
        </Button>
      </div>
    );
  }
  if (analysis.phase === "error") {
    return (
      <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl border border-red-900/50 bg-red-950/20 p-6 text-center">
        <div className="text-sm font-semibold text-red-300">Analisa gagal</div>
        <div className="mt-1 max-w-sm text-xs text-red-200/70">{analysis.message}</div>
      </div>
    );
  }
  const c = analysis.phase === "done" ? analysis.c : latest;
  if (!c) {
    return (
      <EmptyState
        icon={<Beef className="h-5 w-5" />}
        title="Belum ada hasil analisa"
        desc="Tempelkan tabung sensor ke daging, tutup kait kotak, lalu tekan tombol Analisa Daging. Hasil juga tampil di OLED alat."
      />
    );
  }
  const info = LABEL_INFO[c.predicted];
  const votes = c.votes ?? [];
  const total = votes.reduce((a, b) => a + b, 0) || c.k;
  const isNew = analysis.phase === "done";
  return (
    <div className="h-full rounded-2xl border border-line bg-black/25 p-5" style={{ boxShadow: `inset 0 0 0 1px ${info?.color}22, 0 0 60px -30px ${info?.color}` }}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-fat-300/55">
        <MetaItems items={[isNew ? "Hasil analisa" : "Hasil terakhir", `#${c.id}`]} />
        <MetaItems items={[c.source === "simulasi" ? "ESP32 virtual" : "ESP32", fmtTime(c.createdAt)]} />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/15" style={{ background: rgbCss(c.r, c.g, c.b) }}>
          <div className="absolute inset-0 bg-linear-to-br from-white/15 to-transparent" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-fat-300/55">Kesegaran daging</div>
          <div className="text-3xl font-black tracking-tight" style={{ color: info?.textColor }}>
            {info?.name.toUpperCase()}
          </div>
          <div className="text-xs text-fat-300/70">{info?.desc}</div>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {LABELS.map((l, i) => (
          <div key={l} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-fat-200/80">{LABEL_INFO[l].name}</span>
            <ProgressBar value={votes[i] ?? 0} max={total} color={LABEL_INFO[l].color} className="flex-1" />
            <span className="w-10 text-right font-mono text-fat-100">
              {votes[i] ?? 0}/{total}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line/70 pt-4 sm:grid-cols-3">
        <Info k="RGB asli" v={`(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`} />
        <Info k={`RGB ${SCALING_INFO[c.scaling]?.short ?? ""}`} v={`(${fmtNum(c.rNorm)}, ${fmtNum(c.gNorm)}, ${fmtNum(c.bNorm)})`} />
        <Info k="Metode" v={<MetaItems items={[SCALING_INFO[c.scaling]?.name ?? c.scaling, `K = ${c.k}`]} />} />
        <Info k="Waktu proses" v={<span className="text-amber-200">{fmtUs(c.execUs)}</span>} />
        <Info k="Memori RAM" v={<span className="text-amber-200">{fmtBytes(c.memBytes)}</span>} />
        <Info k="Keyakinan" v={fmtPct(c.confidence, 0)} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: ov, refresh, error: ovError } = usePoll<OverviewDTO>("/api/overview", 3000);
  const [kSel, setKSel] = useState<number | null>(null);
  const [scSel, setScSel] = useState<Scaling | null>(null);
  const [simInput, setSimInput] = useState<"sensor" | "segar" | "mulai_membusuk" | "busuk">("sensor");
  const k = kSel ?? ov?.settings.defaultK ?? 3;
  const scaling: Scaling = scSel ?? ov?.settings.defaultScaling ?? "minmax";
  const mv = ov?.settings.modelVersion;
  const { data: ev } = usePoll<EvaluationDTO>(mv != null ? `/api/evaluation?k=${k}&v=${mv}` : null, 30000);
  const [analysis, setAnalysis] = useState<Analysis>({ phase: "idle" });
  const [bench, setBench] = useState<{ running: boolean; note?: string; error?: string }>({ running: false });
  const [seeding, setSeeding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const benchAbort = useRef<AbortController | null>(null);

  const sim = ov?.settings.simulation ?? false;
  const device = ov?.device;
  const online = !!device?.online;
  const counts = ov?.counts;
  const trainTotal = counts?.train.total ?? 0;
  const testTotal = counts?.test.total ?? 0;
  const benchRows: BenchmarkDTO[] = ov?.benchmark?.rows ?? [];
  const history = ov?.history ?? [];
  const latest = analysis.phase === "done" ? analysis.c : history[0] ?? null;
  const methods = ev?.methods;
  const waiting = analysis.phase === "waiting";

  async function analyze() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalysis({ phase: "waiting", queued: false, note: "Mengirim perintah ke ESP32." });
    try {
      const payload: Record<string, unknown> = { scaling, k };
      if (sim && simInput !== "sensor") payload.truth = simInput;
      const res = await createCommand("classify", payload);
      let cmd = res.command;
      if (!isFinal(cmd.status)) {
        const queued = !res.simulated && res.deviceOnline === false;
        setAnalysis({
          phase: "waiting",
          queued,
          note: queued
            ? "ESP32 sedang offline. Perintah masuk antrean selama 90 detik, atau aktifkan Mode Simulasi untuk mencoba tanpa alat."
            : "Menunggu ESP32 mengambil perintah.",
        });
        cmd = await waitForCommand(cmd.id, {
          signal: ctrl.signal,
          timeoutMs: 95000,
          onTick: (c) => {
            if (c.status === "running") {
              setAnalysis({ phase: "waiting", queued: false, note: "ESP32 membaca sensor TCS34725, menghitung KNN, lalu menampilkan hasil ke OLED." });
            }
          },
        });
      }
      const c = cmd.result?.classification as ClassificationDTO | undefined;
      if (cmd.status === "done" && c) {
        setAnalysis({ phase: "done", c, sim: cmd.simulated });
        void refresh();
      } else setAnalysis({ phase: "error", message: cmd.error ?? `Perintah berstatus ${cmd.status}` });
    } catch (e) {
      setAnalysis({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      abortRef.current = null;
    }
  }

  async function runBenchmark() {
    const ctrl = new AbortController();
    benchAbort.current = ctrl;
    setBench({ running: true, note: "Mengirim perintah benchmark." });
    try {
      const res = await createCommand("benchmark", { k, repeat: 3 });
      let cmd = res.command;
      if (!isFinal(cmd.status)) {
        setBench({
          running: true,
          note: !res.simulated && res.deviceOnline === false ? "ESP32 sedang offline, menunggu antrean." : "ESP32 menjalankan KNN pada seluruh data uji untuk 3 metode.",
        });
        cmd = await waitForCommand(cmd.id, { signal: ctrl.signal, timeoutMs: 120000 });
      }
      if (cmd.status === "done") {
        setBench({ running: false });
        void refresh();
      } else setBench({ running: false, error: cmd.error ?? cmd.status });
    } catch (e) {
      setBench({ running: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function toggleSim(v: boolean) {
    await api("/api/settings", { method: "PUT", json: { simulation: v } });
    await refresh();
  }

  async function seed() {
    setSeeding(true);
    try {
      await api("/api/samples", { method: "POST", json: { action: "seed" } });
      await refresh();
    } finally {
      setSeeding(false);
    }
  }

  const accData: AccuracyDatum[] = methods
    ? SCALINGS.map((m) => ({
        key: m,
        name: SCALING_INFO[m].name,
        accuracy: +(methods[m].accuracy * 100).toFixed(2),
        f1: +(methods[m].macroF1 * 100).toFixed(2),
        accLabel: fmtPct(methods[m].accuracy),
      }))
    : [];

  const benchFor = (m: Scaling) => benchRows.find((r) => r.scaling === m);
  const curBench = benchFor(scaling);
  const lastExec = history.find((h) => h.execUs != null);

  let insight: ReactNode = null;
  if (methods) {
    const d1 = (methods.minmax.accuracy - methods.none.accuracy) * 100;
    const d2 = (methods.zscore.accuracy - methods.none.accuracy) * 100;
    const bn = benchFor("none");
    const bm = benchFor("minmax");
    const bz = benchFor("zscore");
    const word = (d: number) => (d > 0 ? "meningkatkan" : d < 0 ? "menurunkan" : "tidak mengubah");
    insight = (
      <>
        Pada <b>K = {k}</b>, normalisasi <b style={{ color: SCALING_INFO.minmax.textColor }}>Min-Max</b> {word(d1)} akurasi{" "}
        {d1 !== 0 && <b>{Math.abs(d1).toFixed(1)} poin persentase</b>} dan <b style={{ color: SCALING_INFO.zscore.textColor }}>Z-Score</b> {word(d2)} akurasi{" "}
        {d2 !== 0 && <b>{Math.abs(d2).toFixed(1)} poin persentase</b>} dibanding tanpa scaling ({fmtPct(methods.none.accuracy)}).
        {bn && bm && bz && (
          <>
            {" "}
            Di ESP32, tahap scaling menambah waktu proses <b>{fmtUs(bm.avgUs - bn.avgUs)}</b> (Min-Max) dan <b>{fmtUs(bz.avgUs - bn.avgUs)}</b> (Z-Score) per klasifikasi, serta
            memori <b>{fmtBytes((bm.memBytes ?? 0) - (bn.memBytes ?? 0))}</b> untuk data terskala. Angka ini jauh di bawah kapasitas RAM ESP32 sekitar 320 KB.
          </>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-beef-300/80">
            <Beef className="h-4 w-4" /> Dashboard Penelitian
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-fat-50 lg:text-3xl">Klasifikasi Kesegaran Daging Sapi</h1>
          <p className="mt-1 max-w-3xl text-sm text-fat-300/70">
            Penerapan <b className="text-fat-100">feature scaling</b> terhadap akurasi <b className="text-fat-100">KNN</b> dalam membedakan daging{" "}
            <span className="font-semibold" style={{ color: LABEL_INFO.segar.textColor }}>segar</span>,{" "}
            <span className="font-semibold" style={{ color: LABEL_INFO.mulai_membusuk.textColor }}>mulai membusuk</span>, dan{" "}
            <span className="font-semibold" style={{ color: LABEL_INFO.busuk.textColor }}>busuk</span>, serta performa KNN di ESP32 (waktu eksekusi & memori).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sim && (
            <Badge tone="info">
              <Sparkles className="h-3 w-3" /> Mode simulasi
            </Badge>
          )}
          <Link href="/cli">
            <Button variant="soft" icon={<SquareTerminal className="h-4 w-4" />}>
              Buka CLI 3D
            </Button>
          </Link>
        </div>
      </div>

      {ovError && !ov && <div className="card border-red-900/60 p-4 text-sm text-red-300">Gagal memuat data: {ovError}</div>}

      {sim && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
            online ? "border-amber-700/50 bg-amber-950/40 text-amber-200" : "border-sky-800/50 bg-sky-950/30 text-sky-200",
          )}
        >
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0" />
            {online
              ? "Mode Simulasi aktif bersama ESP32 fisik. Alat menjalankan algoritma KNN dan memperbarui OLED asli memakai dataset dummy untuk uji sistem sebelum data daging nyata diambil."
              : "Mode Simulasi aktif (ESP32 belum terhubung). Pengujian sementara memakai server virtual hingga kabel USB atau WiFi ESP32 tersambung."}
          </span>
          <Button size="sm" variant="outline" onClick={() => void toggleSim(false)}>
            Matikan simulasi
          </Button>
        </div>
      )}

      <Pipeline online={online} sim={sim} />

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="card hero-beef relative overflow-hidden xl:col-span-2">
          <div className="marbling pointer-events-none absolute inset-0 opacity-80" />
          <div className="relative grid gap-6 p-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-6">
            <div className="flex flex-col items-center justify-center gap-5 text-center">
              <button
                type="button"
                onClick={analyze}
                disabled={waiting}
                className="group relative grid h-44 w-44 place-items-center rounded-full transition-transform active:scale-95 disabled:cursor-wait"
                aria-label="Analisa daging"
              >
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-beef-500/35" />
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-beef-500/20 [animation-delay:1.2s]" />
                <span className="absolute inset-2 rounded-full bg-linear-to-b from-beef-500 to-beef-800 shadow-[0_24px_60px_-12px_rgba(229,56,59,0.75)] ring-1 ring-white/15 transition group-hover:from-beef-400" />
                <span className="absolute inset-5 rounded-full border border-white/10" />
                <span className="relative flex flex-col items-center text-white">
                  <ScanLine className={cn("h-10 w-10", waiting && "animate-pulse")} />
                  <span className="mt-1.5 text-sm font-bold tracking-wide">{waiting ? "Menganalisa" : "Analisa Daging"}</span>
                  <span className="text-[10px] text-white/70">kirim ke ESP32</span>
                </span>
              </button>
              <div className="w-full space-y-3">
                <div>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wider text-fat-300/60">Feature scaling</div>
                  <Segmented<Scaling>
                    value={scaling}
                    onChange={setScSel}
                    options={SCALINGS.map((m) => ({ value: m, label: SCALING_INFO[m].short }))}
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wider text-fat-300/60">Nilai K</div>
                  <Segmented<number> value={k} onChange={setKSel} options={K_OPTIONS.map((x) => ({ value: x, label: String(x) }))} />
                </div>
                {sim && (
                  <div>
                    <div className="mb-1.5 text-[11px] uppercase tracking-wider text-sky-300/80">Input Uji Simulasi ke ESP32</div>
                    <Segmented<"sensor" | "segar" | "mulai_membusuk" | "busuk">
                      value={simInput}
                      onChange={setSimInput}
                      options={[
                        { value: "sensor", label: "Sensor Asli" },
                        { value: "segar", label: "Dummy Segar" },
                        { value: "mulai_membusuk", label: "Dummy Mulai" },
                        { value: "busuk", label: "Dummy Busuk" },
                      ]}
                    />
                  </div>
                )}
                <p className="text-[11px] text-fat-300/60">
                  {sim
                    ? "Mode Simulasi tetap mengirim perintah ke ESP32 dan OLED fisik memakai dataset dummy agar seluruh alur alat dan website teruji sinkron."
                    : `Anda dapat memicu analisa langsung dari tombol ini. ESP32 membaca warna daging, menjalankan ${SCALING_INFO[scaling].name.toLowerCase()} dan KNN (K=${k}), lalu menampilkan hasil di OLED dan mengirimnya ke dashboard.`}
                </p>
              </div>
            </div>
            <ResultPanel analysis={analysis} latest={latest} onCancel={() => abortRef.current?.abort()} />
          </div>
        </section>

        <div className="space-y-5">
          <Card
            title="Perangkat ESP32"
            subtitle={device?.id ?? "beef-esp32-01"}
            icon={<Microchip className="h-4 w-4" />}
            actions={
              <Badge tone={online ? "ok" : "neutral"}>
                <StatusDot tone={online ? "ok" : "neutral"} pulse={online} />
                {online ? "Online" : "Offline"}
              </Badge>
            }
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info k="IP" v={device?.ip ?? "-"} />
              <Info k="Sinyal WiFi" v={device?.rssi != null ? `${device.rssi} dBm` : "-"} />
              <Info k="Sisa RAM" v={fmtBytes(device?.freeHeap)} />
              <Info k="Firmware" v={device?.firmware ?? "-"} />
              <Info k="Sensor TCS34725" v={<StatusCheck ok={device?.sensorOk} />} />
              <Info k="OLED SSD1306" v={<StatusCheck ok={device?.oledOk} />} />
              <Info
                k="Model di alat"
                v={
                  device?.modelVersion != null ? (
                    <span className="inline-flex items-center gap-1">
                      v{device.modelVersion}
                      {device.modelVersion === ov?.settings.modelVersion ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <span className="text-amber-300">(sinkron saat analisa)</span>
                      )}
                    </span>
                  ) : (
                    "-"
                  )
                }
              />
              <Info k="Terakhir terlihat" v={timeAgo(device?.lastSeen)} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-black/20 px-3 py-2.5">
              <div>
                <div className="text-xs font-medium text-fat-50">Mode simulasi (alat + data dummy)</div>
                <div className="text-[11px] text-fat-300/60">Uji ESP32, algoritma KNN, dan OLED memakai data perkiraan</div>
              </div>
              <Toggle checked={sim} onChange={(v) => void toggleSim(v)} />
            </div>
          </Card>

          <Card
            title="Progres Dataset"
            subtitle={
              sim
                ? "Dataset simulasi (144 latih, 36 uji)"
                : `${ov?.activeDataset?.name ?? "Dataset Utama"} (${counts?.quota?.train ?? QUOTA.train} latih, ${counts?.quota?.test ?? QUOTA.test} uji)`
            }
            icon={<Database className="h-4 w-4" />}
            actions={
              <Link href="/dataset" className="inline-flex items-center gap-1 text-xs text-beef-300 hover:text-beef-200">
                Kelola <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <div className="space-y-4">
              {SPLITS.map((split) => {
                const sQuota = split === "train" ? counts?.quota?.train ?? QUOTA.train : counts?.quota?.test ?? QUOTA.test;
                const cQuota = split === "train" ? counts?.quota?.trainPerClass ?? QUOTA_PER_CLASS.train : counts?.quota?.testPerClass ?? QUOTA_PER_CLASS.test;
                return (
                  <div key={split}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-fat-100">{SPLIT_INFO[split].name}</span>
                      <span className="font-mono text-fat-200">
                        {counts?.[split].total ?? 0}/{sQuota}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {LABELS.map((l) => (
                        <div key={l} className="flex items-center gap-2 text-[11px]">
                          <span className="w-24 shrink-0 text-fat-300/70">{LABEL_INFO[l].name}</span>
                          <ProgressBar value={counts?.[split][l] ?? 0} max={cQuota} color={LABEL_INFO[l].color} className="flex-1" />
                          <span className="w-10 text-right font-mono text-fat-200">
                            {counts?.[split][l] ?? 0}/{cQuota}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {trainTotal + testTotal < QUOTA.train + QUOTA.test && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href="/cli">
                    <Button size="sm" variant="primary" icon={<SquareTerminal className="h-3.5 w-3.5" />}>
                      Ambil via CLI
                    </Button>
                  </Link>
                  <Button size="sm" variant="outline" loading={seeding} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={seed}>
                    Isi simulasi
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Akurasi terbaik"
          icon={<Target className="h-4 w-4" />}
          value={ev?.best ? fmtPct(ev.best.accuracy) : "-"}
          sub={ev?.best ? <MetaItems items={[SCALING_INFO[ev.best.method].name, `K = ${ev.best.k}`]} /> : "Butuh data latih dan uji"}
        />
        <Stat
          label={`Akurasi ${SCALING_INFO[scaling].short} (K=${k})`}
          icon={<FlaskConical className="h-4 w-4" />}
          accent={SCALING_INFO[scaling].color}
          value={methods ? fmtPct(methods[scaling].accuracy) : "-"}
          sub={
            methods && scaling !== "none"
              ? `${(methods[scaling].accuracy - methods.none.accuracy) * 100 >= 0 ? "+" : ""}${((methods[scaling].accuracy - methods.none.accuracy) * 100).toFixed(1)} poin dibanding tanpa scaling`
              : methods
                ? `Skor F1 ${fmtPct(methods[scaling].macroF1)}`
                : "-"
          }
        />
        <Stat
          label="Waktu proses ESP32"
          icon={<Timer className="h-4 w-4" />}
          accent="#f4a261"
          value={curBench ? fmtUs(curBench.avgUs) : lastExec ? fmtUs(lastExec.execUs) : "-"}
          sub={
            curBench ? (
              <MetaItems items={[`Rata-rata ${curBench.samples} data uji`, SCALING_INFO[scaling].short]} />
            ) : lastExec ? (
              "Klasifikasi terakhir"
            ) : (
              "Jalankan benchmark"
            )
          }
        />
        <Stat
          label="Konsumsi memori"
          icon={<MemoryStick className="h-4 w-4" />}
          accent="#c084fc"
          value={curBench ? fmtBytes(curBench.memBytes) : lastExec ? fmtBytes(lastExec.memBytes) : "-"}
          sub={curBench ? <MetaItems items={["RAM proses KNN", `Dataset ${fmtBytes(curBench.modelBytes)}`]} /> : "RAM saat proses KNN"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={`Pengaruh Feature Scaling terhadap Akurasi KNN (K = ${k})`}
          subtitle={ev?.ready ? <MetaItems items={[`${ev.trainCount} data latih`, `${ev.testCount} data uji`]} /> : "Evaluasi pada data uji"}
          icon={<ChartColumn className="h-4 w-4" />}
          actions={
            <Link href="/evaluasi" className="inline-flex items-center gap-1 text-xs text-beef-300 hover:text-beef-200">
              Detail <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {ev?.ready ? (
            <>
              <AccuracyChart data={accData} />
              {insight && <p className="mt-3 rounded-xl border border-line bg-black/20 p-3 text-xs leading-relaxed text-fat-200/80">{insight}</p>}
            </>
          ) : (
            <EmptyState
              icon={<FlaskConical className="h-5 w-5" />}
              title="Evaluasi belum tersedia"
              desc={`Butuh data latih & data uji. Saat ini ${trainTotal} latih, ${testTotal} uji.`}
              action={
                <Link href="/cli">
                  <Button size="sm" variant="primary">
                    Ambil dataset
                  </Button>
                </Link>
              }
            />
          )}
        </Card>
        <Card title="Akurasi terhadap Nilai K" subtitle="Perbandingan tiga metode feature scaling" icon={<ChartLine className="h-4 w-4" />}>
          {ev?.ready && ev.sweep ? (
            <KSweepChart data={ev.sweep} k={k} />
          ) : (
            <EmptyState icon={<ChartLine className="h-5 w-5" />} title="Menunggu dataset" desc="Grafik akan muncul setelah data latih & uji tersedia." />
          )}
        </Card>
      </div>

      <Card
        title="Performa KNN di ESP32 (Waktu Proses dan Memori)"
        subtitle={
          ov?.benchmark ? (
            <MetaItems
              items={[
                `Benchmark ${fmtDateTime(ov.benchmark.createdAt)}`,
                `K = ${ov.benchmark.k}`,
                ov.benchmark.source === "simulasi" ? "ESP32 virtual" : "ESP32 asli",
              ]}
            />
          ) : (
            "Diukur langsung di ESP32 menggunakan micros() dan ESP.getFreeHeap() pada data RGB terskala"
          )
        }
        icon={<Gauge className="h-4 w-4" />}
        actions={
          <>
            {bench.running && <span className="text-[11px] text-fat-300/70">{bench.note}</span>}
            {bench.error && <span className="text-[11px] text-red-300">{bench.error}</span>}
            {bench.running ? (
              <Button size="sm" variant="ghost" onClick={() => benchAbort.current?.abort()} icon={<X className="h-3.5 w-3.5" />}>
                Batal
              </Button>
            ) : null}
            <Button size="sm" variant="primary" loading={bench.running} icon={<Gauge className="h-3.5 w-3.5" />} onClick={runBenchmark} disabled={!testTotal || !trainTotal}>
              Jalankan benchmark (K={k})
            </Button>
          </>
        }
      >
        {benchRows.length ? (
          <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1.2fr]">
            <div>
              <div className="mb-2 text-xs font-medium text-fat-200">Waktu proses per klasifikasi (mikrodetik)</div>
              <ExecTimeChart rows={benchRows} />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-fat-200">Konsumsi memori (byte)</div>
              <MemoryChart rows={benchRows} />
            </div>
            <div className="overflow-x-auto">
              <table className="data-table w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Metode</th>
                    <th>Rata-rata</th>
                    <th>Min / Maks</th>
                    <th>RAM</th>
                    <th>Akurasi alat</th>
                  </tr>
                </thead>
                <tbody>
                  {SCALINGS.map((m) => {
                    const r = benchFor(m);
                    return (
                      <tr key={m}>
                        <td style={{ color: SCALING_INFO[m].textColor }} className="font-medium">
                          {SCALING_INFO[m].name}
                        </td>
                        <td className="font-mono text-amber-200">{fmtUs(r?.avgUs)}</td>
                        <td className="font-mono text-fat-300/80">
                          {fmtUs(r?.minUs)} / {fmtUs(r?.maxUs)}
                        </td>
                        <td className="font-mono">{fmtBytes(r?.memBytes)}</td>
                        <td className="font-mono">{r ? `${r.correct}/${r.samples} (${fmtPct(r.accuracy)})` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-line bg-black/20 p-3 text-[11px] text-fat-300/70">
                <div>
                  CPU: <span className="text-fat-100">{benchRows[0]?.cpuMhz ?? "-"} MHz</span>
                </div>
                <div>
                  Ulangan: <span className="text-fat-100">{benchRows[0]?.repeat ?? "-"} kali</span>
                </div>
                <div>
                  Data latih di RAM: <span className="text-fat-100">{benchRows[0]?.trainCount ?? "-"}</span>
                </div>
                <div>
                  Sisa RAM: <span className="text-fat-100">{fmtBytes(benchRows[0]?.freeHeap)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Gauge className="h-5 w-5" />}
            title="Belum ada data performa ESP32"
            desc="Benchmark menjalankan KNN di ESP32 untuk seluruh data uji pada tiap metode scaling, lalu mencatat waktu proses dan memori RAM."
          />
        )}
        {history.some((h) => h.execUs != null) && (
          <div className="mt-5 border-t border-line/70 pt-4">
            <div className="mb-2 text-xs font-medium text-fat-200">Tren waktu proses dan memori per analisa</div>
            <ExecTrendChart history={history} />
          </div>
        )}
      </Card>

      <Card title="Riwayat Klasifikasi" subtitle="Data kesegaran daging dari ESP32" icon={<Database className="h-4 w-4" />}>
        {history.length ? (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="data-table w-full text-left text-[13px]">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>RGB (Asli)</th>
                  <th>RGB (Norm)</th>
                  <th>Metode</th>
                  <th>Hasil</th>
                  <th>Waktu eks.</th>
                  <th>Memori</th>
                  <th>Sumber</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-fat-300/80">{fmtTime(c.createdAt)}</td>
                    <td>
                      <span className="flex items-center gap-2 font-mono">
                        <Swatch r={c.r} g={c.g} b={c.b} />({Math.round(c.r)}, {Math.round(c.g)}, {Math.round(c.b)})
                      </span>
                    </td>
                    <td className="font-mono text-fat-200/80">
                      ({fmtNum(c.rNorm)}, {fmtNum(c.gNorm)}, {fmtNum(c.bNorm)})
                    </td>
                    <td className="text-fat-200/80">
                      <MetaItems items={[SCALING_INFO[c.scaling]?.short, `K=${c.k}`]} />
                    </td>
                    <td>
                      <LabelBadge label={c.predicted} />
                    </td>
                    <td className="font-mono text-amber-200">{fmtUs(c.execUs)}</td>
                    <td className="font-mono">{fmtBytes(c.memBytes)}</td>
                    <td>{c.source === "simulasi" ? <Badge tone="info">simulasi</Badge> : <Badge tone="ok">ESP32</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<ScanLine className="h-5 w-5" />} title="Belum ada riwayat" desc="Riwayat muncul setelah tombol Analisa Daging ditekan." />
        )}
      </Card>
    </div>
  );
}
