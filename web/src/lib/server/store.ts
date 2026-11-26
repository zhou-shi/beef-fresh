import fs from "fs";
import path from "path";
import type { Benchmark, Classification, CommandPayload, DatasetRecord, Device, DeviceCommand, Sample } from "@/db/schema";
import { parseLabel, parseSplit } from "@/lib/constants";

/**
 * Dual-tier data store:
 * 1. Supabase REST API (SUPABASE_URL + SUPABASE_ANON_KEY dari .env proyek)
 * 2. Fallback otomatis ke file lokal ../data/web_store.json jika tabel Supabase
 *    belum dibuat atau sedang offline.
 */

interface LocalStoreData {
  seq: { datasets?: number; samples: number; device_commands: number; classifications: number; benchmarks: number };
  datasets?: DatasetRecord[];
  samples: Sample[];
  device_commands: DeviceCommand[];
  classifications: Classification[];
  benchmarks: Benchmark[];
  devices: Device[];
  app_settings: Array<{ key: string; value: unknown }>;
}

const ROOT_DIR = path.resolve(process.cwd(), "..");
const ROOT_ENV_PATH = path.join(ROOT_DIR, ".env");
const LOCAL_STORE_PATH = path.join(ROOT_DIR, "data", "web_store.json");
const LEGACY_DB_PATH = path.join(ROOT_DIR, "data", "beef_fresh_db.json");

let cachedEnv: { url: string; key: string } | null = null;
let supabaseReadyCache: { ready: boolean; checkedAt: number } | null = null;

function readSupabaseEnv(): { url: string; key: string } {
  if (cachedEnv) return cachedEnv;
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if ((!url || !key) && fs.existsSync(ROOT_ENV_PATH)) {
    const raw = fs.readFileSync(ROOT_ENV_PATH, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      const v = m[2].replace(/^['"]|['"]$/g, "");
      if (k === "SUPABASE_URL" && !url) url = v;
      if (k === "SUPABASE_ANON_KEY" && !key) key = v;
    }
  }
  cachedEnv = { url: url.replace(/\/+$/, ""), key };
  return cachedEnv;
}

export async function isSupabaseReady(): Promise<boolean> {
  const env = readSupabaseEnv();
  if (!env.url || !env.key) return false;
  if (supabaseReadyCache && Date.now() - supabaseReadyCache.checkedAt < 60_000) {
    return supabaseReadyCache.ready;
  }
  try {
    const res = await fetch(`${env.url}/rest/v1/samples?select=id&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const ready = res.ok;
    supabaseReadyCache = { ready, checkedAt: Date.now() };
    return ready;
  } catch {
    supabaseReadyCache = { ready: false, checkedAt: Date.now() };
    return false;
  }
}

export async function getStorageInfo() {
  const env = readSupabaseEnv();
  const ready = await isSupabaseReady();
  return {
    mode: ready ? ("supabase" as const) : ("local" as const),
    supabaseConfigured: Boolean(env.url && env.key),
    supabaseUrl: env.url || null,
  };
}

async function sbFetch<T>(table: string, query = "", init: RequestInit = {}): Promise<T> {
  const env = readSupabaseEnv();
  const headers: Record<string, string> = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${env.url}/rest/v1/${table}${query}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${table} HTTP ${res.status}: ${txt.slice(0, 160)}`);
  }
  if (res.status === 204) return [] as unknown as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : []) as T;
}

/* ---------- Konversi snake_case (Supabase) <-> camelCase (TS) ---------- */

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v ?? Date.now())));
const toOptDate = (v: unknown): Date | null => (v ? toDate(v) : null);

function fromSbDataset(r: Record<string, unknown>): DatasetRecord {
  return {
    id: Number(r.id),
    name: String(r.name),
    description: r.description == null ? null : String(r.description),
    targetTrain: Number(r.target_train ?? 144),
    targetTest: Number(r.target_test ?? 36),
    status: String(r.status ?? "active"),
    createdAt: toDate(r.created_at),
  };
}

function fromSbSample(r: Record<string, unknown>): Sample {
  return {
    id: Number(r.id),
    datasetId: r.dataset_id == null ? null : Number(r.dataset_id),
    split: String(r.split),
    label: String(r.label),
    r: Number(r.r),
    g: Number(r.g),
    b: Number(r.b),
    rawR: r.raw_r == null ? null : Number(r.raw_r),
    rawG: r.raw_g == null ? null : Number(r.raw_g),
    rawB: r.raw_b == null ? null : Number(r.raw_b),
    rawC: r.raw_c == null ? null : Number(r.raw_c),
    lux: r.lux == null ? null : Number(r.lux),
    colorTemp: r.color_temp == null ? null : Number(r.color_temp),
    source: String(r.source ?? "device"),
    deviceId: r.device_id == null ? null : String(r.device_id),
    note: r.note == null ? null : String(r.note),
    createdAt: toDate(r.created_at),
  };
}

function toSbSample(s: Partial<Sample>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.datasetId !== undefined) out.dataset_id = s.datasetId;
  if (s.split !== undefined) out.split = s.split;
  if (s.label !== undefined) out.label = s.label;
  if (s.r !== undefined) out.r = s.r;
  if (s.g !== undefined) out.g = s.g;
  if (s.b !== undefined) out.b = s.b;
  if (s.rawR !== undefined) out.raw_r = s.rawR;
  if (s.rawG !== undefined) out.raw_g = s.rawG;
  if (s.rawB !== undefined) out.raw_b = s.rawB;
  if (s.rawC !== undefined) out.raw_c = s.rawC;
  if (s.lux !== undefined) out.lux = s.lux;
  if (s.colorTemp !== undefined) out.color_temp = s.colorTemp;
  if (s.source !== undefined) out.source = s.source;
  if (s.deviceId !== undefined) out.device_id = s.deviceId;
  if (s.note !== undefined) out.note = s.note;
  return out;
}

function fromSbCommand(r: Record<string, unknown>): DeviceCommand {
  return {
    id: Number(r.id),
    deviceId: String(r.device_id),
    type: String(r.type),
    payload: (r.payload as CommandPayload) ?? {},
    status: String(r.status),
    result: (r.result as Record<string, unknown> | null) ?? null,
    error: r.error == null ? null : String(r.error),
    simulated: Boolean(r.simulated),
    createdAt: toDate(r.created_at),
    pickedAt: toOptDate(r.picked_at),
    completedAt: toOptDate(r.completed_at),
  };
}

function fromSbClassification(r: Record<string, unknown>): Classification {
  return {
    id: Number(r.id),
    commandId: r.command_id == null ? null : Number(r.command_id),
    deviceId: r.device_id == null ? null : String(r.device_id),
    r: Number(r.r),
    g: Number(r.g),
    b: Number(r.b),
    rNorm: r.r_norm == null ? null : Number(r.r_norm),
    gNorm: r.g_norm == null ? null : Number(r.g_norm),
    bNorm: r.b_norm == null ? null : Number(r.b_norm),
    rawR: r.raw_r == null ? null : Number(r.raw_r),
    rawG: r.raw_g == null ? null : Number(r.raw_g),
    rawB: r.raw_b == null ? null : Number(r.raw_b),
    rawC: r.raw_c == null ? null : Number(r.raw_c),
    scaling: String(r.scaling),
    k: Number(r.k),
    predicted: String(r.predicted),
    votes: (r.votes as number[] | null) ?? null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    nearest: r.nearest == null ? null : Number(r.nearest),
    execUs: r.exec_us == null ? null : Number(r.exec_us),
    scaleUs: r.scale_us == null ? null : Number(r.scale_us),
    knnUs: r.knn_us == null ? null : Number(r.knn_us),
    memBytes: r.mem_bytes == null ? null : Number(r.mem_bytes),
    modelBytes: r.model_bytes == null ? null : Number(r.model_bytes),
    freeHeap: r.free_heap == null ? null : Number(r.free_heap),
    trainCount: r.train_count == null ? null : Number(r.train_count),
    actual: r.actual == null ? null : String(r.actual),
    source: String(r.source ?? "device"),
    createdAt: toDate(r.created_at),
  };
}

function fromSbBenchmark(r: Record<string, unknown>): Benchmark {
  return {
    id: Number(r.id),
    commandId: r.command_id == null ? null : Number(r.command_id),
    deviceId: r.device_id == null ? null : String(r.device_id),
    scaling: String(r.scaling),
    k: Number(r.k),
    repeat: Number(r.repeat ?? 1),
    samples: Number(r.samples),
    correct: Number(r.correct),
    accuracy: Number(r.accuracy),
    avgUs: Number(r.avg_us),
    minUs: r.min_us == null ? null : Number(r.min_us),
    maxUs: r.max_us == null ? null : Number(r.max_us),
    scaleUs: r.scale_us == null ? null : Number(r.scale_us),
    knnUs: r.knn_us == null ? null : Number(r.knn_us),
    memBytes: r.mem_bytes == null ? null : Number(r.mem_bytes),
    modelBytes: r.model_bytes == null ? null : Number(r.model_bytes),
    freeHeap: r.free_heap == null ? null : Number(r.free_heap),
    cpuMhz: r.cpu_mhz == null ? null : Number(r.cpu_mhz),
    trainCount: r.train_count == null ? null : Number(r.train_count),
    source: String(r.source ?? "device"),
    createdAt: toDate(r.created_at),
  };
}

function fromSbDevice(r: Record<string, unknown>): Device {
  return {
    id: String(r.id),
    lastSeen: toDate(r.last_seen),
    ip: r.ip == null ? null : String(r.ip),
    rssi: r.rssi == null ? null : Number(r.rssi),
    freeHeap: r.free_heap == null ? null : Number(r.free_heap),
    firmware: r.firmware == null ? null : String(r.firmware),
    modelVersion: r.model_version == null ? null : Number(r.model_version),
    trainCount: r.train_count == null ? null : Number(r.train_count),
    sensorOk: r.sensor_ok == null ? null : Boolean(r.sensor_ok),
    oledOk: r.oled_ok == null ? null : Boolean(r.oled_ok),
    uptimeS: r.uptime_s == null ? null : Number(r.uptime_s),
  };
}

/* ---------- Local JSON Persistence ---------- */

function createInitialLocalStore(): LocalStoreData {
  const data: LocalStoreData = {
    seq: { datasets: 1, samples: 0, device_commands: 0, classifications: 0, benchmarks: 0 },
    datasets: [
      {
        id: 1,
        name: "Dataset Utama",
        description: "Dataset penelitian kesegaran daging sapi (144 latih, 36 uji)",
        targetTrain: 144,
        targetTest: 36,
        status: "active",
        createdAt: new Date(),
      },
    ],
    samples: [],
    device_commands: [],
    classifications: [],
    benchmarks: [],
    devices: [],
    app_settings: [
      { key: "simulation", value: false },
      { key: "defaultK", value: 5 },
      { key: "defaultScaling", value: "minmax" },
      { key: "modelVersion", value: 1 },
      { key: "activeDatasetId", value: 1 },
    ],
  };

  // Bootstrap otomatis dari data/beef_fresh_db.json proyek jika ada
  if (fs.existsSync(LEGACY_DB_PATH)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, "utf-8")) as {
        dataset?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(legacy.dataset)) {
        for (const item of legacy.dataset) {
          const split = parseSplit(String(item.split_type ?? ""));
          const label = parseLabel(String(item.label ?? ""));
          if (!split || !label) continue;
          const id = ++data.seq.samples;
          data.samples.push({
            id,
            datasetId: null,
            split,
            label,
            r: Number(item.r_raw ?? 0),
            g: Number(item.g_raw ?? 0),
            b: Number(item.b_raw ?? 0),
            rawR: item.r_raw != null ? Math.round(Number(item.r_raw)) : null,
            rawG: item.g_raw != null ? Math.round(Number(item.g_raw)) : null,
            rawB: item.b_raw != null ? Math.round(Number(item.b_raw)) : null,
            rawC: item.c_raw != null ? Math.round(Number(item.c_raw)) : null,
            lux: item.lux != null ? Number(item.lux) : null,
            colorTemp: item.color_temp != null ? Number(item.color_temp) : null,
            source: "simulasi",
            deviceId: "seed-simulasi",
            note: item.sample_code ? String(item.sample_code) : null,
            createdAt: toDate(item.created_at),
          });
        }
      }
    } catch {
      // Abaikan jika file lama tidak terbaca
    }
  }

  return data;
}

function readLocal(): LocalStoreData {
  if (!fs.existsSync(LOCAL_STORE_PATH)) {
    const init = createInitialLocalStore();
    writeLocal(init);
    return init;
  }
  const raw = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8")) as LocalStoreData;
  raw.seq = { datasets: 0, ...raw.seq };
  raw.datasets = (raw.datasets ?? []).map((d) => ({ ...d, createdAt: toDate(d.createdAt) }));
  if (!raw.datasets.length) {
    const firstId = Math.max(1, (raw.seq.datasets ?? 0) + 1);
    raw.seq.datasets = firstId;
    raw.datasets.push({
      id: firstId,
      name: "Dataset Utama",
      description: "Dataset penelitian kesegaran daging sapi (144 latih, 36 uji)",
      targetTrain: 144,
      targetTest: 36,
      status: "active",
      createdAt: new Date(),
    });
    // Kaitkan sampel non-simulasi yang sudah ada ke Dataset Utama
    for (const s of raw.samples ?? []) {
      if (s.source !== "simulasi" && s.datasetId == null) s.datasetId = firstId;
    }
    writeLocal(raw);
  }
  raw.samples = (raw.samples ?? []).map((s) => ({
    ...s,
    datasetId: s.datasetId === undefined ? null : s.datasetId,
    createdAt: toDate(s.createdAt),
  }));
  raw.device_commands = (raw.device_commands ?? []).map((c) => ({
    ...c,
    createdAt: toDate(c.createdAt),
    pickedAt: toOptDate(c.pickedAt),
    completedAt: toOptDate(c.completedAt),
  }));
  raw.classifications = (raw.classifications ?? []).map((c) => ({ ...c, createdAt: toDate(c.createdAt) }));
  raw.benchmarks = (raw.benchmarks ?? []).map((b) => ({ ...b, createdAt: toDate(b.createdAt) }));
  raw.devices = (raw.devices ?? []).map((d) => ({ ...d, lastSeen: toDate(d.lastSeen) }));
  raw.app_settings = raw.app_settings ?? [];
  return raw;
}

function writeLocal(data: LocalStoreData) {
  fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/* ---------- Operasi Unified CRUD ---------- */

export const store = {
  // --- DATASETS ---
  async listDatasets(): Promise<DatasetRecord[]> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("datasets", "?select=*&order=id.desc");
      return rows.map(fromSbDataset);
    }
    return [...(readLocal().datasets ?? [])].sort((a, b) => b.id - a.id);
  },

  async createDataset(d: { name: string; description?: string | null; targetTrain: number; targetTest: number }): Promise<DatasetRecord> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("datasets", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            name: d.name,
            description: d.description ?? null,
            target_train: d.targetTrain,
            target_test: d.targetTest,
            status: "active",
          },
        ]),
      });
      return fromSbDataset(rows[0]);
    }
    const db = readLocal();
    db.seq.datasets = (db.seq.datasets ?? 0) + 1;
    const row: DatasetRecord = {
      id: db.seq.datasets,
      name: d.name,
      description: d.description ?? null,
      targetTrain: d.targetTrain,
      targetTest: d.targetTest,
      status: "active",
      createdAt: new Date(),
    };
    db.datasets = db.datasets ?? [];
    db.datasets.push(row);
    writeLocal(db);
    return row;
  },

  async updateDataset(
    id: number,
    patch: Partial<{ name: string; description: string | null; targetTrain: number; targetTest: number; status: string }>,
  ): Promise<DatasetRecord | null> {
    if (await isSupabaseReady()) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.targetTrain !== undefined) body.target_train = patch.targetTrain;
      if (patch.targetTest !== undefined) body.target_test = patch.targetTest;
      if (patch.status !== undefined) body.status = patch.status;
      const rows = await sbFetch<Array<Record<string, unknown>>>("datasets", `?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      return rows[0] ? fromSbDataset(rows[0]) : null;
    }
    const db = readLocal();
    const row = (db.datasets ?? []).find((x) => x.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    writeLocal(db);
    return row;
  },

  async deleteDataset(id: number): Promise<boolean> {
    if (await isSupabaseReady()) {
      await sbFetch("samples", `?dataset_id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      const rows = await sbFetch<Array<{ id: number }>>("datasets", `?id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length > 0;
    }
    const db = readLocal();
    const before = (db.datasets ?? []).length;
    db.datasets = (db.datasets ?? []).filter((x) => x.id !== id);
    db.samples = db.samples.filter((s) => s.datasetId !== id);
    writeLocal(db);
    return (db.datasets ?? []).length < before;
  },

  // --- SETTINGS ---
  async getAllSettings(): Promise<Array<{ key: string; value: unknown }>> {
    if (await isSupabaseReady()) {
      return sbFetch<Array<{ key: string; value: unknown }>>("app_settings", "?select=key,value");
    }
    return readLocal().app_settings;
  },

  async setSetting(key: string, value: unknown): Promise<void> {
    if (await isSupabaseReady()) {
      await sbFetch("app_settings", "?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ key, value }]),
      });
      return;
    }
    const db = readLocal();
    const idx = db.app_settings.findIndex((r) => r.key === key);
    if (idx >= 0) db.app_settings[idx].value = value;
    else db.app_settings.push({ key, value });
    writeLocal(db);
  },

  // --- SAMPLES ---
  async listSamples(opts?: {
    datasetId?: number | null;
    split?: string;
    label?: string;
    source?: string;
    order?: "asc" | "desc";
    limit?: number;
  }): Promise<Sample[]> {
    const order = opts?.order ?? "desc";
    const limit = opts?.limit ?? 5000;
    if (await isSupabaseReady()) {
      const p = new URLSearchParams();
      p.set("select", "*");
      if (opts?.datasetId != null) p.set("dataset_id", `eq.${opts.datasetId}`);
      if (opts?.split) p.set("split", `eq.${opts.split}`);
      if (opts?.label) p.set("label", `eq.${opts.label}`);
      if (opts?.source) p.set("source", `eq.${opts.source}`);
      p.set("order", `id.${order}`);
      p.set("limit", String(limit));
      const rows = await sbFetch<Array<Record<string, unknown>>>("samples", `?${p.toString()}`);
      return rows.map(fromSbSample);
    }
    let rows = readLocal().samples;
    if (opts?.datasetId != null) rows = rows.filter((r) => r.datasetId === opts.datasetId);
    if (opts?.split) rows = rows.filter((r) => r.split === opts.split);
    if (opts?.label) rows = rows.filter((r) => r.label === opts.label);
    if (opts?.source) rows = rows.filter((r) => r.source === opts.source);
    rows = [...rows].sort((a, b) => (order === "asc" ? a.id - b.id : b.id - a.id));
    return rows.slice(0, limit);
  },

  async insertSamples(items: Array<Omit<Sample, "id" | "createdAt">>): Promise<Sample[]> {
    if (!items.length) return [];
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("samples", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(items.map((x) => toSbSample(x))),
      });
      return rows.map(fromSbSample);
    }
    const db = readLocal();
    const inserted: Sample[] = items.map((x) => ({
      ...x,
      id: ++db.seq.samples,
      createdAt: new Date(),
    }));
    db.samples.push(...inserted);
    writeLocal(db);
    return inserted;
  },

  async updateSample(id: number, patch: Partial<Sample>): Promise<Sample | null> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("samples", `?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(toSbSample(patch)),
      });
      return rows[0] ? fromSbSample(rows[0]) : null;
    }
    const db = readLocal();
    const row = db.samples.find((s) => s.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    writeLocal(db);
    return row;
  },

  async deleteSample(id: number): Promise<Sample | null> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("samples", `?id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows[0] ? fromSbSample(rows[0]) : null;
    }
    const db = readLocal();
    const idx = db.samples.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const [removed] = db.samples.splice(idx, 1);
    writeLocal(db);
    return removed;
  },

  async deleteSamplesByScope(scope: "simulasi" | "all", datasetId?: number | null): Promise<number> {
    if (await isSupabaseReady()) {
      const q =
        scope === "simulasi"
          ? "?source=eq.simulasi"
          : datasetId != null
            ? `?dataset_id=eq.${datasetId}`
            : "?id=gt.0";
      const rows = await sbFetch<Array<{ id: number }>>("samples", q, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length;
    }
    const db = readLocal();
    const before = db.samples.length;
    if (scope === "simulasi") {
      db.samples = db.samples.filter((s) => s.source !== "simulasi");
    } else if (datasetId != null) {
      db.samples = db.samples.filter((s) => s.datasetId !== datasetId);
    } else {
      db.samples = [];
    }
    writeLocal(db);
    return before - db.samples.length;
  },

  // --- DEVICE COMMANDS ---
  async listCommands(limit = 20): Promise<DeviceCommand[]> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>(
        "device_commands",
        `?select=*&order=id.desc&limit=${limit}`,
      );
      return rows.map(fromSbCommand);
    }
    return [...readLocal().device_commands].sort((a, b) => b.id - a.id).slice(0, limit);
  },

  async getCommand(id: number): Promise<DeviceCommand | null> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("device_commands", `?select=*&id=eq.${id}&limit=1`);
      return rows[0] ? fromSbCommand(rows[0]) : null;
    }
    return readLocal().device_commands.find((c) => c.id === id) ?? null;
  },

  async getNextPendingRealCommand(): Promise<DeviceCommand | null> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>(
        "device_commands",
        "?select=*&status=eq.pending&simulated=eq.false&order=id.asc&limit=1",
      );
      return rows[0] ? fromSbCommand(rows[0]) : null;
    }
    return (
      [...readLocal().device_commands]
        .filter((c) => c.status === "pending" && !c.simulated)
        .sort((a, b) => a.id - b.id)[0] ?? null
    );
  },

  async countActiveCommands(): Promise<number> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<{ id: number }>>(
        "device_commands",
        "?select=id&status=in.(pending,running)",
      );
      return rows.length;
    }
    return readLocal().device_commands.filter((c) => c.status === "pending" || c.status === "running").length;
  },

  async insertCommand(c: {
    deviceId: string;
    type: string;
    payload: CommandPayload;
    status: string;
    simulated: boolean;
    pickedAt: Date | null;
  }): Promise<DeviceCommand> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("device_commands", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            device_id: c.deviceId,
            type: c.type,
            payload: c.payload,
            status: c.status,
            simulated: c.simulated,
            picked_at: c.pickedAt ? c.pickedAt.toISOString() : null,
          },
        ]),
      });
      return fromSbCommand(rows[0]);
    }
    const db = readLocal();
    const row: DeviceCommand = {
      id: ++db.seq.device_commands,
      deviceId: c.deviceId,
      type: c.type,
      payload: c.payload,
      status: c.status,
      result: null,
      error: null,
      simulated: c.simulated,
      createdAt: new Date(),
      pickedAt: c.pickedAt,
      completedAt: null,
    };
    db.device_commands.push(row);
    writeLocal(db);
    return row;
  },

  async updateCommand(id: number, patch: Partial<DeviceCommand>): Promise<DeviceCommand | null> {
    if (await isSupabaseReady()) {
      const body: Record<string, unknown> = {};
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.result !== undefined) body.result = patch.result;
      if (patch.error !== undefined) body.error = patch.error;
      if (patch.deviceId !== undefined) body.device_id = patch.deviceId;
      if (patch.pickedAt !== undefined) body.picked_at = patch.pickedAt ? patch.pickedAt.toISOString() : null;
      if (patch.completedAt !== undefined) body.completed_at = patch.completedAt ? patch.completedAt.toISOString() : null;
      const rows = await sbFetch<Array<Record<string, unknown>>>("device_commands", `?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      return rows[0] ? fromSbCommand(rows[0]) : null;
    }
    const db = readLocal();
    const row = db.device_commands.find((c) => c.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    writeLocal(db);
    return row;
  },

  async expireStaleCommands(cutoff: Date): Promise<void> {
    if (await isSupabaseReady()) {
      await sbFetch("device_commands", `?status=eq.pending&created_at=lt.${encodeURIComponent(cutoff.toISOString())}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "expired",
          error: "Waktu tunggu habis, ESP32 belum mengambil perintah.",
          completed_at: new Date().toISOString(),
        }),
      });
      return;
    }
    const db = readLocal();
    let changed = false;
    for (const c of db.device_commands) {
      if (c.status === "pending" && c.createdAt.getTime() < cutoff.getTime()) {
        c.status = "expired";
        c.error = "Waktu tunggu habis, ESP32 belum mengambil perintah.";
        c.completedAt = new Date();
        changed = true;
      }
    }
    if (changed) writeLocal(db);
  },

  // --- CLASSIFICATIONS ---
  async listClassifications(limit = 40): Promise<Classification[]> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>(
        "classifications",
        `?select=*&order=id.desc&limit=${limit}`,
      );
      return rows.map(fromSbClassification);
    }
    return [...readLocal().classifications].sort((a, b) => b.id - a.id).slice(0, limit);
  },

  async insertClassification(c: Omit<Classification, "id" | "createdAt">): Promise<Classification> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("classifications", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            command_id: c.commandId,
            device_id: c.deviceId,
            r: c.r,
            g: c.g,
            b: c.b,
            r_norm: c.rNorm,
            g_norm: c.gNorm,
            b_norm: c.bNorm,
            raw_r: c.rawR,
            raw_g: c.rawG,
            raw_b: c.rawB,
            raw_c: c.rawC,
            scaling: c.scaling,
            k: c.k,
            predicted: c.predicted,
            votes: c.votes,
            confidence: c.confidence,
            nearest: c.nearest,
            exec_us: c.execUs,
            scale_us: c.scaleUs,
            knn_us: c.knnUs,
            mem_bytes: c.memBytes,
            model_bytes: c.modelBytes,
            free_heap: c.freeHeap,
            train_count: c.trainCount,
            actual: c.actual,
            source: c.source,
          },
        ]),
      });
      return fromSbClassification(rows[0]);
    }
    const db = readLocal();
    const row: Classification = { ...c, id: ++db.seq.classifications, createdAt: new Date() };
    db.classifications.push(row);
    writeLocal(db);
    return row;
  },

  async deleteClassifications(scope: "simulasi" | "all"): Promise<number> {
    if (await isSupabaseReady()) {
      const q = scope === "simulasi" ? "?source=eq.simulasi" : "?id=gt.0";
      const rows = await sbFetch<Array<{ id: number }>>("classifications", q, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length;
    }
    const db = readLocal();
    const before = db.classifications.length;
    db.classifications = scope === "simulasi" ? db.classifications.filter((c) => c.source !== "simulasi") : [];
    writeLocal(db);
    return before - db.classifications.length;
  },

  // --- BENCHMARKS ---
  async getLatestBenchmarkGroup(): Promise<{
    commandId: number | null;
    source: string;
    createdAt: Date;
    k: number;
    rows: Benchmark[];
  } | null> {
    if (await isSupabaseReady()) {
      const last = await sbFetch<Array<Record<string, unknown>>>("benchmarks", "?select=*&order=id.desc&limit=1");
      if (!last[0]) return null;
      const ref = fromSbBenchmark(last[0]);
      const rows =
        ref.commandId != null
          ? (await sbFetch<Array<Record<string, unknown>>>("benchmarks", `?select=*&command_id=eq.${ref.commandId}`)).map(
              fromSbBenchmark,
            )
          : [ref];
      return { commandId: ref.commandId, source: ref.source, createdAt: ref.createdAt, k: ref.k, rows };
    }
    const all = [...readLocal().benchmarks].sort((a, b) => b.id - a.id);
    const ref = all[0];
    if (!ref) return null;
    const rows = ref.commandId != null ? all.filter((b) => b.commandId === ref.commandId) : [ref];
    return { commandId: ref.commandId, source: ref.source, createdAt: ref.createdAt, k: ref.k, rows };
  },

  async insertBenchmarks(items: Array<Omit<Benchmark, "id" | "createdAt">>): Promise<Benchmark[]> {
    if (!items.length) return [];
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("benchmarks", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(
          items.map((b) => ({
            command_id: b.commandId,
            device_id: b.deviceId,
            scaling: b.scaling,
            k: b.k,
            repeat: b.repeat,
            samples: b.samples,
            correct: b.correct,
            accuracy: b.accuracy,
            avg_us: b.avgUs,
            min_us: b.minUs,
            max_us: b.maxUs,
            scale_us: b.scaleUs,
            knn_us: b.knnUs,
            mem_bytes: b.memBytes,
            model_bytes: b.modelBytes,
            free_heap: b.freeHeap,
            cpu_mhz: b.cpuMhz,
            train_count: b.trainCount,
            source: b.source,
          })),
        ),
      });
      return rows.map(fromSbBenchmark);
    }
    const db = readLocal();
    const inserted: Benchmark[] = items.map((b) => ({
      ...b,
      id: ++db.seq.benchmarks,
      createdAt: new Date(),
    }));
    db.benchmarks.push(...inserted);
    writeLocal(db);
    return inserted;
  },

  async deleteBenchmarks(scope: "simulasi" | "all"): Promise<number> {
    if (await isSupabaseReady()) {
      const q = scope === "simulasi" ? "?source=eq.simulasi" : "?id=gt.0";
      const rows = await sbFetch<Array<{ id: number }>>("benchmarks", q, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length;
    }
    const db = readLocal();
    const before = db.benchmarks.length;
    db.benchmarks = scope === "simulasi" ? db.benchmarks.filter((b) => b.source !== "simulasi") : [];
    writeLocal(db);
    return before - db.benchmarks.length;
  },

  // --- DEVICES ---
  async getLatestDevice(): Promise<Device | null> {
    if (await isSupabaseReady()) {
      const rows = await sbFetch<Array<Record<string, unknown>>>("devices", "?select=*&order=last_seen.desc&limit=1");
      return rows[0] ? fromSbDevice(rows[0]) : null;
    }
    return [...readLocal().devices].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())[0] ?? null;
  },

  async upsertDevice(d: Device): Promise<void> {
    if (await isSupabaseReady()) {
      await sbFetch("devices", "?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([
          {
            id: d.id,
            last_seen: d.lastSeen.toISOString(),
            ip: d.ip,
            rssi: d.rssi,
            free_heap: d.freeHeap,
            firmware: d.firmware,
            model_version: d.modelVersion,
            train_count: d.trainCount,
            sensor_ok: d.sensorOk,
            oled_ok: d.oledOk,
            uptime_s: d.uptimeS,
          },
        ]),
      });
      return;
    }
    const db = readLocal();
    const idx = db.devices.findIndex((x) => x.id === d.id);
    if (idx >= 0) db.devices[idx] = d;
    else db.devices.push(d);
    writeLocal(db);
  },

  async touchDevice(id: string): Promise<void> {
    if (await isSupabaseReady()) {
      await sbFetch("devices", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_seen: new Date().toISOString() }),
      });
      return;
    }
    const db = readLocal();
    const row = db.devices.find((x) => x.id === id);
    if (row) {
      row.lastSeen = new Date();
      writeLocal(db);
    }
  },
};
