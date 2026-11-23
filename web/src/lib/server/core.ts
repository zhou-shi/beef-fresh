import type { DatasetRecord } from "@/db/schema";
import {
  DEFAULT_DEVICE_ID,
  DEVICE_ONLINE_MS,
  QUOTA,
  QUOTA_PER_CLASS,
  SPLITS,
  isLabel,
  parseScaling,
  type Label,
  type Scaling,
  type Split,
} from "@/lib/constants";
import type { DataPoint } from "@/lib/knn";
import { getActiveSerialPort, getCachedSerialStatus, getLastOledLines, listAvailableUsbPorts } from "./serial";
import { store } from "./store";

export interface AppSettings {
  simulation: boolean;
  defaultK: number;
  defaultScaling: Scaling;
  modelVersion: number;
  activeDatasetId: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  simulation: false,
  defaultK: 3,
  defaultScaling: "minmax",
  modelVersion: 1,
  activeDatasetId: null,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await store.getAllSettings();
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key === "simulation") s.simulation = row.value === true;
    else if (row.key === "defaultK") s.defaultK = Number(row.value) || DEFAULT_SETTINGS.defaultK;
    else if (row.key === "defaultScaling") s.defaultScaling = parseScaling(String(row.value)) ?? DEFAULT_SETTINGS.defaultScaling;
    else if (row.key === "modelVersion") s.modelVersion = Number(row.value) || 1;
    else if (row.key === "activeDatasetId") s.activeDatasetId = row.value != null ? Number(row.value) || null : null;
  }
  return s;
}

const gCore = globalThis as typeof globalThis & {
  __beefActiveDsLock?: Promise<DatasetRecord> | null;
};

export async function getActiveDataset(): Promise<DatasetRecord> {
  if (gCore.__beefActiveDsLock) return gCore.__beefActiveDsLock;
  const task = (async () => {
    const [settings, all] = await Promise.all([getSettings(), store.listDatasets()]);
    const activeList = all.filter((d) => d.status === "active");
    if (settings.activeDatasetId != null) {
      const found = activeList.find((d) => d.id === settings.activeDatasetId);
      if (found) return found;
    }
    if (activeList.length > 0) {
      await store.setSetting("activeDatasetId", activeList[0].id);
      return activeList[0];
    }
    // Jika semua dataset sudah diarsipkan atau belum ada, buat dataset baru otomatis (1x saja)
    const created = await store.createDataset({
      name: all.length ? `Dataset ${all.length + 1}` : "Dataset Utama",
      description: "Dataset penelitian kesegaran daging sapi",
      targetTrain: QUOTA.train,
      targetTest: QUOTA.test,
    });
    await store.setSetting("activeDatasetId", created.id);
    return created;
  })();
  gCore.__beefActiveDsLock = task;
  try {
    return await task;
  } finally {
    if (gCore.__beefActiveDsLock === task) gCore.__beefActiveDsLock = null;
  }
}

export async function setSetting(key: keyof AppSettings, value: unknown) {
  await store.setSetting(key, value);
}

/** Versi dataset naik setiap ada perubahan agar ESP32 tahu kapan harus sinkron ulang */
export async function bumpModelVersion() {
  const s = await getSettings();
  await store.setSetting("modelVersion", s.modelVersion + 1);
}

export type Counts = Record<Split, Record<Label, number> & { total: number }> & {
  bySource: Record<string, number>;
  total: number;
  quota: { train: number; test: number; trainPerClass: number; testPerClass: number };
};

export async function getCounts(simulationMode?: boolean, datasetOverride?: DatasetRecord | null): Promise<Counts> {
  const isSim = simulationMode ?? (await getSettings()).simulation;
  const activeDs = isSim ? null : (datasetOverride ?? (await getActiveDataset()));
  const rows = await store.listSamples({ order: "asc", limit: 5000 });
  const empty = () => ({ segar: 0, mulai_membusuk: 0, busuk: 0, total: 0 });
  const targetTrain = activeDs ? activeDs.targetTrain : QUOTA.train;
  const targetTest = activeDs ? activeDs.targetTest : QUOTA.test;
  const counts: Counts = {
    train: empty(),
    test: empty(),
    bySource: {},
    total: 0,
    quota: {
      train: targetTrain,
      test: targetTest,
      trainPerClass: Math.max(1, Math.round(targetTrain / 3)),
      testPerClass: Math.max(1, Math.round(targetTest / 3)),
    },
  };
  for (const r of rows) {
    const rowIsSim = r.source === "simulasi";
    if (rowIsSim !== isSim) continue;
    if (!isSim && activeDs && r.datasetId != null && r.datasetId !== activeDs.id) continue;
    if ((SPLITS as string[]).includes(r.split) && isLabel(r.label)) {
      counts[r.split as Split][r.label] += 1;
      counts[r.split as Split].total += 1;
    }
    counts.bySource[r.source] = (counts.bySource[r.source] ?? 0) + 1;
    counts.total += 1;
  }
  return counts;
}

export async function loadDataset(simulationMode?: boolean): Promise<{ train: DataPoint[]; test: DataPoint[] }> {
  const isSim = simulationMode ?? (await getSettings()).simulation;
  const activeDs = isSim ? null : await getActiveDataset();
  const rows = await store.listSamples({ order: "asc", limit: 5000 });
  const train: DataPoint[] = [];
  const test: DataPoint[] = [];
  for (const row of rows) {
    const rowIsSim = row.source === "simulasi";
    if (rowIsSim !== isSim) continue;
    if (!isSim && activeDs && row.datasetId != null && row.datasetId !== activeDs.id) continue;
    if (!isLabel(row.label)) continue;
    const p: DataPoint = { id: row.id, r: row.r, g: row.g, b: row.b, label: row.label };
    if (row.split === "train") train.push(p);
    else if (row.split === "test") test.push(p);
  }
  return { train, test };
}

export async function getDevice() {
  const availablePorts = listAvailableUsbPorts();
  const serial = await getCachedSerialStatus();
  if (serial) {
    const activePort = getActiveSerialPort() ?? availablePorts[0] ?? "/dev/ttyUSB0";
    return {
      id: `${serial.chip_model ?? "ESP32"} (USB)`,
      online: true,
      everSeen: true,
      lastSeen: new Date(),
      ip: serial.wifi_connected && serial.wifi_ip && serial.wifi_ip !== "0.0.0.0" ? serial.wifi_ip : `USB ${activePort}`,
      rssi: serial.wifi_connected ? (serial.wifi_rssi ?? null) : null,
      freeHeap: serial.memory?.free_heap_bytes ?? null,
      firmware: "beef_fresh_esp32",
      modelVersion: 1,
      trainCount: 144,
      sensorOk: serial.tcs_ok ?? null,
      oledOk: serial.oled_ok ?? null,
      uptimeS: null,
      usbPort: activePort,
      availablePorts,
      oledLines: getLastOledLines(),
      calibration: serial.calibration ?? null,
    };
  }

  const row = await store.getLatestDevice();
  if (!row) {
    return {
      id: DEFAULT_DEVICE_ID,
      online: false,
      everSeen: false,
      lastSeen: null as Date | null,
      ip: null,
      rssi: null,
      freeHeap: null,
      firmware: null,
      modelVersion: null,
      trainCount: null,
      sensorOk: null,
      oledOk: null,
      uptimeS: null,
      usbPort: null,
      availablePorts,
    };
  }
  return { ...row, online: Date.now() - row.lastSeen.getTime() < DEVICE_ONLINE_MS, everSeen: true, usbPort: null, availablePorts };
}

/** Jika DEVICE_API_KEY di-set, ESP32 wajib mengirim header x-device-key yang sama */
export function authorizeDevice(req: Request): boolean {
  const key = process.env.DEVICE_API_KEY;
  if (!key) return true;
  const h = req.headers.get("x-device-key");
  const q = new URL(req.url).searchParams.get("key");
  return h === key || q === key;
}

/** Tandai perintah yang belum diambil lebih dari 90 detik sebagai kedaluwarsa */
export async function expireStaleCommands() {
  const cutoff = new Date(Date.now() - 90_000);
  await store.expireStaleCommands(cutoff);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
