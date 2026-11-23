import type { DeviceCommand } from "@/db/schema";
import { LABELS, SCALINGS, parseLabel, parseScaling, parseSplit, type Label, type Scaling } from "@/lib/constants";
import { KnnModel } from "@/lib/knn";
import { bumpModelVersion, errorMessage, getActiveDataset, loadDataset } from "./core";
import { store } from "./store";

export interface BenchmarkItem {
  scaling?: string;
  samples?: number;
  correct?: number;
  avgUs?: number;
  minUs?: number;
  maxUs?: number;
  scaleUs?: number;
  knnUs?: number;
  memBytes?: number;
  modelBytes?: number;
}

/** Body JSON yang dikirim ESP32 ke POST /api/device/result */
export interface DeviceResultBody {
  commandId?: number;
  deviceId?: string;
  type?: string;
  error?: string;
  info?: string;
  r?: number;
  g?: number;
  b?: number;
  rawR?: number;
  rawG?: number;
  rawB?: number;
  rawC?: number;
  lux?: number;
  colorTemp?: number;
  label?: string;
  split?: string;
  scaling?: string;
  k?: number;
  predicted?: string;
  votes?: number[];
  nearest?: number;
  rNorm?: number;
  gNorm?: number;
  bNorm?: number;
  execUs?: number;
  scaleUs?: number;
  knnUs?: number;
  memBytes?: number;
  modelBytes?: number;
  freeHeap?: number;
  trainCount?: number;
  testCount?: number;
  modelVersion?: number;
  repeat?: number;
  cpuMhz?: number;
  actual?: string;
  results?: BenchmarkItem[];
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const int = (v: unknown) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

async function finish(cmd: DeviceCommand | null, status: "done" | "failed", result: Record<string, unknown> | null, error?: string) {
  if (!cmd) return;
  await store.updateCommand(cmd.id, { status, result, error: error ?? null, completedAt: new Date() });
}

export async function processResult(
  cmd: DeviceCommand | null,
  body: DeviceResultBody,
  opts: { source: "device" | "simulasi"; deviceId: string },
): Promise<{ ok: boolean; error?: string; result?: Record<string, unknown> }> {
  const type = body.type ?? cmd?.type;
  if (body.error) {
    await finish(cmd, "failed", null, String(body.error));
    return { ok: false, error: String(body.error) };
  }
  try {
    if (type === "capture") {
      const label = parseLabel(cmd?.payload?.label ?? body.label);
      const split = parseSplit(cmd?.payload?.split ?? body.split);
      const r = num(body.r);
      const g = num(body.g);
      const b = num(body.b);
      if (!label || !split || r == null || g == null || b == null) {
        throw new Error("Data pengambilan tidak lengkap (label, split, R, G, B).");
      }
      const activeDs = opts.source === "simulasi" ? null : await getActiveDataset();
      const [row] = await store.insertSamples([
        {
          datasetId: activeDs ? activeDs.id : null,
          split,
          label,
          r: round2(r),
          g: round2(g),
          b: round2(b),
          rawR: int(body.rawR),
          rawG: int(body.rawG),
          rawB: int(body.rawB),
          rawC: int(body.rawC),
          lux: num(body.lux),
          colorTemp: num(body.colorTemp),
          source: opts.source,
          deviceId: opts.deviceId,
          note: null,
        },
      ]);
      await bumpModelVersion();
      const result = { sample: row };
      await finish(cmd, "done", result);
      return { ok: true, result };
    }

    if (type === "classify") {
      const predicted = parseLabel(body.predicted);
      const r = num(body.r);
      const g = num(body.g);
      const b = num(body.b);
      if (!predicted || r == null || g == null || b == null) throw new Error("Hasil klasifikasi tidak lengkap.");
      const scaling = parseScaling(body.scaling ?? cmd?.payload?.scaling) ?? "minmax";
      const k = int(body.k) ?? cmd?.payload?.k ?? 3;
      const votes = Array.isArray(body.votes) ? body.votes.map((v) => Number(v) || 0) : null;
      const totalVotes = votes ? votes.reduce((a, v) => a + v, 0) : 0;
      const confidence = votes && totalVotes ? votes[LABELS.indexOf(predicted)] / totalVotes : null;
      const row = await store.insertClassification({
        commandId: cmd?.id ?? null,
        deviceId: opts.deviceId,
        r: round2(r),
        g: round2(g),
        b: round2(b),
        rNorm: num(body.rNorm),
        gNorm: num(body.gNorm),
        bNorm: num(body.bNorm),
        rawR: int(body.rawR),
        rawG: int(body.rawG),
        rawB: int(body.rawB),
        rawC: int(body.rawC),
        scaling,
        k,
        predicted,
        votes,
        confidence,
        nearest: num(body.nearest),
        execUs: num(body.execUs),
        scaleUs: num(body.scaleUs),
        knnUs: num(body.knnUs),
        memBytes: int(body.memBytes),
        modelBytes: int(body.modelBytes),
        freeHeap: int(body.freeHeap),
        trainCount: int(body.trainCount),
        actual: parseLabel(body.actual) ?? null,
        source: opts.source,
      });
      const result = { classification: row };
      await finish(cmd, "done", result);
      return { ok: true, result };
    }

    if (type === "benchmark") {
      const items = Array.isArray(body.results) ? body.results : [];
      if (!items.length) throw new Error("Hasil benchmark kosong.");
      const k = int(body.k) ?? cmd?.payload?.k ?? 3;
      const rows = await store.insertBenchmarks(
        items.map((it) => {
          const samplesN = int(it.samples) ?? 0;
          const correct = int(it.correct) ?? 0;
          return {
            commandId: cmd?.id ?? null,
            deviceId: opts.deviceId,
            scaling: parseScaling(it.scaling) ?? "none",
            k,
            repeat: int(body.repeat) ?? 1,
            samples: samplesN,
            correct,
            accuracy: samplesN ? correct / samplesN : 0,
            avgUs: num(it.avgUs) ?? 0,
            minUs: num(it.minUs),
            maxUs: num(it.maxUs),
            scaleUs: num(it.scaleUs),
            knnUs: num(it.knnUs),
            memBytes: int(it.memBytes),
            modelBytes: int(it.modelBytes),
            freeHeap: int(body.freeHeap),
            cpuMhz: int(body.cpuMhz),
            trainCount: int(body.trainCount),
            source: opts.source,
          };
        }),
      );
      const result = { benchmarks: rows };
      await finish(cmd, "done", result);
      return { ok: true, result };
    }

    const result = {
      ok: true,
      type: type ?? "unknown",
      info: body.info ?? null,
      modelVersion: int(body.modelVersion),
      trainCount: int(body.trainCount),
      testCount: int(body.testCount),
    };
    await finish(cmd, "done", result);
    return { ok: true, result };
  } catch (e) {
    const msg = errorMessage(e);
    await finish(cmd, "failed", null, msg);
    return { ok: false, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/*  ESP32 VIRTUAL (mode simulasi) untuk uji alur sebelum alat siap    */
/* ------------------------------------------------------------------ */

/**
 * Profil warna RGB daging sapi berdasarkan literatur ilmiah pigmen daging
 * (oxymyoglobin -> metmyoglobin -> sulfmyoglobin/degradasi) pada sensor TCS34725 terkalibrasi:
 *  - Segar          : Merah cerah (R tinggi ~188, G & B rendah ~44/42)
 *  - Mulai Membusuk : Merah kecokelatan (R turun ~138, G naik ~64, B ~52)
 *  - Busuk          : Cokelat kusam / keabuan-kehijauan (R rendah ~96, G ~84, B ~68)
 */
const PROFILE: Record<Label, { mean: number[]; sd: number[] }> = {
  segar: { mean: [188, 44, 42], sd: [16, 7, 6.5] },
  mulai_membusuk: { mean: [138, 64, 52], sd: [15, 7, 6] },
  busuk: { mean: [96, 84, 68], sd: [14, 7, 6] },
};

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateReading(label: Label) {
  const p = PROFILE[label];
  const [r, g, b] = p.mean.map((m, i) => round2(Math.min(255, Math.max(0, m + gauss() * p.sd[i]))));
  const c = Math.round(950 + Math.random() * 450);
  const rawR = Math.round((r / 255) * c);
  const rawG = Math.round((g / 255) * c);
  const rawB = Math.round((b / 255) * c);
  const lux = round2(Math.max(0, -0.32466 * rawR + 1.57837 * rawG - 0.73191 * rawB));
  const colorTemp = round2(2400 + (b / Math.max(1, r)) * 2600);
  return { r, g, b, rawR, rawG, rawB, rawC: c, lux, colorTemp };
}

function simTiming(method: Scaling, n: number, k: number) {
  const j = () => 1 + (Math.random() - 0.5) * 0.08;
  const knnUs = (n * 0.47 + k * 0.6 + 7.5) * j();
  const scaleUs = method === "none" ? 0.9 * j() : (n * 3 * (method === "zscore" ? 0.128 : 0.121) + 5.5) * j();
  const memBytes = 8 + k * 8 + (method === "none" ? 0 : 8 + n * 12);
  return { knnUs: round2(knnUs), scaleUs: round2(scaleUs), execUs: round2(knnUs + scaleUs), memBytes };
}

const simHeap = () => 214_000 + Math.round(Math.random() * 6000);
const clampK = (k: number | undefined, n: number) => Math.max(1, Math.min(Math.round(k ?? 3), 25, Math.max(1, n)));

export async function simulateCommand(cmd: DeviceCommand): Promise<void> {
  const payload = cmd.payload ?? {};
  await new Promise((r) => setTimeout(r, 380 + Math.random() * 320));
  let body: DeviceResultBody;
  try {
    switch (cmd.type) {
      case "capture": {
        const label = parseLabel(payload.label);
        if (!label) throw new Error("Label tidak valid.");
        body = { commandId: cmd.id, type: "capture", ...simulateReading(label) };
        break;
      }
      case "classify": {
        const { train } = await loadDataset();
        if (!train.length) throw new Error("Dataset latih masih kosong. Ambil data latih terlebih dahulu.");
        const scaling = parseScaling(payload.scaling) ?? "minmax";
        const k = clampK(payload.k, train.length);
        const truth = parseLabel(payload.truth) ?? LABELS[Math.floor(Math.random() * LABELS.length)];
        const reading = simulateReading(truth);
        const model = new KnnModel(train, scaling);
        const pred = model.predict(reading, k);
        const t = simTiming(scaling, train.length, k);
        body = {
          commandId: cmd.id,
          type: "classify",
          ...reading,
          scaling,
          k,
          predicted: pred.label,
          votes: pred.votes,
          nearest: round4(pred.neighbors[0]?.distance ?? 0),
          rNorm: round4(pred.scaled[0]),
          gNorm: round4(pred.scaled[1]),
          bNorm: round4(pred.scaled[2]),
          execUs: t.execUs,
          scaleUs: t.scaleUs,
          knnUs: t.knnUs,
          memBytes: t.memBytes,
          modelBytes: train.length * 16,
          freeHeap: simHeap(),
          trainCount: train.length,
          actual: truth,
        };
        break;
      }
      case "benchmark": {
        const { train, test } = await loadDataset();
        if (!train.length || !test.length) throw new Error("Benchmark membutuhkan data latih dan data uji.");
        const k = clampK(payload.k, train.length);
        const repeat = Math.max(1, Math.min(10, payload.repeat ?? 3));
        const results: BenchmarkItem[] = SCALINGS.map((m) => {
          const model = new KnnModel(train, m);
          let correct = 0;
          let sum = 0;
          let sumScale = 0;
          let sumKnn = 0;
          let min = Infinity;
          let max = 0;
          let mem = 0;
          for (const t of test) {
            if (model.predict(t, k).label === t.label) correct++;
            for (let r = 0; r < repeat; r++) {
              const tm = simTiming(m, train.length, k);
              sum += tm.execUs;
              sumScale += tm.scaleUs;
              sumKnn += tm.knnUs;
              min = Math.min(min, tm.execUs);
              max = Math.max(max, tm.execUs);
              mem = Math.max(mem, tm.memBytes);
            }
          }
          const cnt = test.length * repeat;
          return {
            scaling: m,
            samples: test.length,
            correct,
            avgUs: round2(sum / cnt),
            minUs: round2(min),
            maxUs: round2(max),
            scaleUs: round2(sumScale / cnt),
            knnUs: round2(sumKnn / cnt),
            memBytes: mem,
            modelBytes: train.length * 16,
          };
        });
        body = { commandId: cmd.id, type: "benchmark", k, repeat, cpuMhz: 240, freeHeap: simHeap(), trainCount: train.length, results };
        break;
      }
      default: {
        const { train, test } = await loadDataset();
        body = {
          commandId: cmd.id,
          type: cmd.type,
          info: cmd.type === "ping" ? "HALO dari ESP32 virtual" : "Model berhasil disinkronkan (virtual)",
          trainCount: train.length,
          testCount: test.length,
        };
      }
    }
  } catch (e) {
    body = { commandId: cmd.id, type: cmd.type, error: errorMessage(e) };
  }
  await processResult(cmd, body, { source: "simulasi", deviceId: "virtual-esp32" });
}
