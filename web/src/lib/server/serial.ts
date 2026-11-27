import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import type { DeviceCommand } from "@/db/schema";
import { QUOTA_PER_CLASS, parseLabel, parseSplit, type Label } from "@/lib/constants";
import { OLED } from "@/lib/device-visual";
import { getCounts } from "./core";
import { processResult, simulateReading, type DeviceResultBody } from "./process";

const IS_WIN = process.platform === "win32";
const ROOT_DIR = path.resolve(process.cwd(), "..");
const DAEMON_SCRIPT = path.join(ROOT_DIR, "cli", "serial_daemon.py");
const SERIAL_PORT = process.env.SERIAL_PORT || (IS_WIN ? "COM3" : "/dev/ttyUSB0");

export function getProjectVenvPythonPath(): string {
  return IS_WIN
    ? path.join(ROOT_DIR, ".tools", "pyvenv", "Scripts", "python.exe")
    : path.join(ROOT_DIR, ".tools", "pyvenv", "bin", "python");
}

let cachedPythonCmd: { cmd: string; prefixArgs: string[] } | null = null;

export function resetPythonCache() {
  cachedPythonCmd = null;
  const w = gSerial.__beefSerialWorker;
  if (w) {
    gSerial.__beefSerialWorker = null;
    try {
      w.proc.stdin.end();
      w.proc.kill("SIGTERM");
    } catch {
      // abaikan
    }
  }
}

export function findPythonCommand(): { cmd: string; prefixArgs: string[] } | null {
  if (cachedPythonCmd) return cachedPythonCmd;
  const candidates: Array<{ cmd: string; prefixArgs: string[] }> = [];
  const venvPy = getProjectVenvPythonPath();
  if (fs.existsSync(/*turbopackIgnore: true*/ venvPy)) {
    candidates.push({ cmd: venvPy, prefixArgs: [] });
  }
  if (process.env.PYTHON_BIN) candidates.push({ cmd: process.env.PYTHON_BIN, prefixArgs: [] });
  if (IS_WIN) {
    candidates.push(
      { cmd: "python", prefixArgs: [] },
      { cmd: "py", prefixArgs: ["-3"] },
      { cmd: "python3", prefixArgs: [] },
    );
  } else {
    candidates.push(
      { cmd: "python3", prefixArgs: [] },
      { cmd: "python", prefixArgs: [] },
    );
  }
  let firstWorking: { cmd: string; prefixArgs: string[] } | null = null;
  for (const c of candidates) {
    try {
      const ver = spawnSync(/*turbopackIgnore: true*/ c.cmd, [...c.prefixArgs, "--version"], {
        stdio: "ignore",
        timeout: 2500,
        windowsHide: true,
      });
      if (ver.status !== 0) continue;
      if (!firstWorking) firstWorking = c;
      const hasSerial = spawnSync(/*turbopackIgnore: true*/ c.cmd, [...c.prefixArgs, "-c", "import serial"], {
        stdio: "ignore",
        timeout: 2500,
        windowsHide: true,
      });
      if (hasSerial.status === 0) {
        cachedPythonCmd = c;
        return c;
      }
    } catch {
      // coba kandidat berikutnya
    }
  }
  if (firstWorking) {
    cachedPythonCmd = firstWorking;
    return firstWorking;
  }
  return null;
}

const CLASS_ID: Record<Label, number> = {
  segar: 0,
  mulai_membusuk: 1,
  busuk: 2,
};

/**
 * Profil RGB dummy ilmiah (oxymyoglobin segar -> metmyoglobin mulai membusuk -> busuk kusam),
 * dipakai saat Mode Simulasi mengirim input dummy ke ESP32 fisik untuk uji tiap kelas.
 */
const DUMMY_PROFILE: Record<Label, { mean: [number, number, number]; spread: [number, number, number] }> = {
  segar: { mean: [188, 44, 42], spread: [16, 6, 5] },
  mulai_membusuk: { mean: [138, 64, 52], spread: [14, 6, 5] },
  busuk: { mean: [96, 84, 68], spread: [13, 6, 5] },
};

export function sampleDummyRgbForHardware(label: Label): { r: number; g: number; b: number } {
  const p = DUMMY_PROFILE[label];
  const jitter = () => (Math.random() - 0.5) * 2;
  return {
    r: Number((p.mean[0] + jitter() * p.spread[0]).toFixed(2)),
    g: Number((p.mean[1] + jitter() * p.spread[1]).toFixed(2)),
    b: Number((p.mean[2] + jitter() * p.spread[2]).toFixed(2)),
  };
}

export interface SerialStatus {
  chip_model?: string;
  cpu_mhz?: number;
  oled_ok?: boolean;
  tcs_ok?: boolean;
  wifi_connected?: boolean;
  wifi_ip?: string;
  wifi_rssi?: number;
  sensor?: {
    r_raw?: number;
    g_raw?: number;
    b_raw?: number;
    r_norm?: number;
    g_norm?: number;
    b_norm?: number;
  };
  memory?: {
    total_heap_bytes?: number;
    free_heap_bytes?: number;
    used_heap_bytes?: number;
    dataset_scaled_bytes?: number;
    dataset_raw_bytes?: number;
  };
  calibration?: {
    white_ok: boolean;
    black_ok: boolean;
    white: number[];
    black: number[];
  };
}

interface WorkerState {
  proc: ChildProcessWithoutNullStreams;
  buf: string;
  seq: number;
  pending: Map<number, (val: { data: unknown; port: string | null; ports?: string[] }) => void>;
}

const gSerial = globalThis as typeof globalThis & {
  __beefSerialWorker?: WorkerState | null;
  __beefSerialQueue?: Promise<unknown>;
  __beefSerialStatus?: { data: SerialStatus | null; at: number } | null;
  __beefLastOled?: string[] | null;
  __beefActivePort?: string | null;
  __beefFlashing?: boolean;
};

export function setFlashingState(flashing: boolean) {
  gSerial.__beefFlashing = flashing;
  if (flashing) {
    // Lepas port USB serial agar tidak bentrok dengan esptool/arduino-cli upload
    const w = gSerial.__beefSerialWorker;
    if (w) {
      gSerial.__beefSerialWorker = null;
      try {
        w.proc.kill("SIGTERM");
      } catch {
        // abaikan
      }
    }
  }
}

export async function releaseSerialPortForFlashing(): Promise<void> {
  gSerial.__beefFlashing = true;
  const w = gSerial.__beefSerialWorker;
  if (w) {
    gSerial.__beefSerialWorker = null;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          w.proc.kill("SIGTERM");
        } catch {
          // abaikan
        }
        finish();
      }, 1400);
      w.proc.once("exit", () => {
        clearTimeout(timer);
        finish();
      });
      try {
        w.proc.stdin.write(JSON.stringify({ id: ++w.seq, cmd: "__CLOSE__", timeout: 1.0 }) + "\n");
        setTimeout(() => {
          try {
            w.proc.stdin.end();
            w.proc.kill("SIGTERM");
          } catch {
            // abaikan
          }
        }, 250);
      } catch {
        clearTimeout(timer);
        try {
          w.proc.kill("SIGTERM");
        } catch {
          // abaikan
        }
        finish();
      }
    });
  }
  await new Promise((r) => setTimeout(r, IS_WIN ? 700 : 350));
}

export function isFlashingInProgress(): boolean {
  return Boolean(gSerial.__beefFlashing);
}

export function listAvailableUsbPorts(): string[] {
  if (IS_WIN) {
    try {
      // Query registry Windows untuk semua port COM aktif (cepat, ~15ms, tanpa izin admin)
      const out = execFileSync("reg", ["query", "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM"], {
        encoding: "utf-8",
        timeout: 2500,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const matches = out.match(/\bCOM\d+\b/gi) ?? [];
      const unique = Array.from(new Set(matches.map((m) => m.toUpperCase()))).sort((a, b) => {
        const na = Number(a.slice(3));
        const nb = Number(b.slice(3));
        return na - nb;
      });
      return unique;
    } catch {
      return [];
    }
  }
  try {
    const pattern = process.platform === "darwin" ? /^cu\.(usb|SLAB|wchusb)/i : /^tty(USB|ACM)\d+$/;
    return fs
      .readdirSync("/dev")
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => `/dev/${name}`);
  } catch {
    return [];
  }
}

export function getActiveSerialPort(): string | null {
  return gSerial.__beefActivePort ?? null;
}

export function getLastOledLines(): string[] | null {
  return gSerial.__beefLastOled ?? null;
}

export function setLastOledLines(lines: string[]) {
  gSerial.__beefLastOled = lines;
}

function withSerialLock<T>(fn: () => Promise<T>): Promise<T> {
  const cur = gSerial.__beefSerialQueue ?? Promise.resolve();
  const next = cur.then(fn, fn);
  gSerial.__beefSerialQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function getWorker(): WorkerState | null {
  if (gSerial.__beefSerialWorker && !gSerial.__beefSerialWorker.proc.killed && gSerial.__beefSerialWorker.proc.exitCode === null) {
    return gSerial.__beefSerialWorker;
  }
  try {
    const py = findPythonCommand();
    if (!py) return null;
    const proc = spawn(/*turbopackIgnore: true*/ py.cmd, [...py.prefixArgs, "-u", DAEMON_SCRIPT], {
      env: { ...process.env, SERIAL_PORT },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const state: WorkerState = { proc, buf: "", seq: 0, pending: new Map() };
    proc.on("error", () => {
      for (const resolve of state.pending.values()) resolve({ data: null, port: null });
      state.pending.clear();
      if (gSerial.__beefSerialWorker === state) gSerial.__beefSerialWorker = null;
    });
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
      state.buf += chunk;
      let nl = state.buf.indexOf("\n");
      while (nl >= 0) {
        const line = state.buf.slice(0, nl).trim();
        state.buf = state.buf.slice(nl + 1);
        if (line) {
          try {
            const msg = JSON.parse(line) as { id?: number; data?: unknown; port?: string | null; ports?: string[] };
            if (msg.port !== undefined) gSerial.__beefActivePort = msg.port ?? null;
            if (typeof msg.id === "number") {
              const resolver = state.pending.get(msg.id);
              if (resolver) {
                state.pending.delete(msg.id);
                resolver({ data: msg.data ?? null, port: msg.port ?? null, ports: msg.ports });
              }
            }
          } catch {
            // abaikan baris non-JSON
          }
        }
        nl = state.buf.indexOf("\n");
      }
    });
    proc.on("exit", () => {
      for (const resolve of state.pending.values()) resolve({ data: null, port: null });
      state.pending.clear();
      if (gSerial.__beefSerialWorker === state) gSerial.__beefSerialWorker = null;
    });
    gSerial.__beefSerialWorker = state;
    return state;
  } catch {
    return null;
  }
}

export function isSerialPortPresent(): boolean {
  return listAvailableUsbPorts().length > 0;
}

async function rawWorkerRequest(
  cmd: string,
  timeoutSec = 4.5,
  port?: string,
): Promise<{ data: unknown; port: string | null; ports?: string[] }> {
  return withSerialLock(async () => {
    const worker = getWorker();
    if (!worker) return { data: null, port: null };
    const id = ++worker.seq;
    return new Promise<{ data: unknown; port: string | null; ports?: string[] }>((resolve) => {
      const timer = setTimeout(() => {
        worker.pending.delete(id);
        resolve({ data: null, port: gSerial.__beefActivePort ?? null });
      }, Math.round((timeoutSec + 3.0) * 1000));

      worker.pending.set(id, (val) => {
        clearTimeout(timer);
        resolve(val);
      });

      try {
        worker.proc.stdin.write(JSON.stringify({ id, cmd, timeout: timeoutSec, ...(port ? { port } : {}) }) + "\n");
      } catch {
        clearTimeout(timer);
        worker.pending.delete(id);
        resolve({ data: null, port: null });
      }
    });
  });
}

export async function sendSerialCommand<T = Record<string, unknown>>(cmd: string, timeoutSec = 4.5): Promise<T | null> {
  if (gSerial.__beefFlashing || !isSerialPortPresent()) return null;
  const res = await rawWorkerRequest(cmd, timeoutSec);
  return (res.data as T | null) ?? null;
}

export async function reconnectSerial(preferredPort?: string): Promise<{
  connected: boolean;
  port: string | null;
  availablePorts: string[];
  status: SerialStatus | null;
}> {
  const availablePorts = listAvailableUsbPorts();
  if (!availablePorts.length) {
    gSerial.__beefActivePort = null;
    gSerial.__beefSerialStatus = { data: null, at: Date.now() };
    return { connected: false, port: null, availablePorts, status: null };
  }
  const res = await rawWorkerRequest("__RECONNECT__", 5.0, preferredPort);
  const status = (res.data as SerialStatus | null) ?? null;
  gSerial.__beefActivePort = res.port ?? null;
  gSerial.__beefSerialStatus = { data: status, at: Date.now() };
  if (status && status.sensor) {
    gSerial.__beefLastOled = [
      "BEEF FRESH | SIAP",
      `RGB : ${Math.round(status.sensor.r_raw ?? 0)}, ${Math.round(status.sensor.g_raw ?? 0)}, ${Math.round(status.sensor.b_raw ?? 0)}`,
      `Norm: ${(status.sensor.r_norm ?? 0).toFixed(2)},${(status.sensor.g_norm ?? 0).toFixed(2)},${(status.sensor.b_norm ?? 0).toFixed(2)}`,
      "=SIAP MENGUKUR",
      "KNN:--us Mem:2.3KB",
    ];
  }
  return {
    connected: Boolean(status),
    port: res.port ?? null,
    availablePorts: res.ports ?? availablePorts,
    status,
  };
}

export async function getCachedSerialStatus(force = false): Promise<SerialStatus | null> {
  if (gSerial.__beefFlashing) return gSerial.__beefSerialStatus?.data ?? null;
  const ports = listAvailableUsbPorts();
  if (!ports.length) {
    gSerial.__beefSerialStatus = null;
    gSerial.__beefActivePort = null;
    return null;
  }
  if (!force && gSerial.__beefSerialStatus && Date.now() - gSerial.__beefSerialStatus.at < 5000) {
    return gSerial.__beefSerialStatus.data;
  }
  let data = await sendSerialCommand<SerialStatus>("STATUS", 2.5);
  // Jika belum merespons padahal ada port USB (mis. habis cabut-pasang ke /dev/ttyUSB1), coba auto-reconnect sekali
  if (!data && ports.length > 0) {
    const rec = await reconnectSerial();
    data = rec.status;
  }
  gSerial.__beefSerialStatus = { data, at: Date.now() };
  if (data && !gSerial.__beefLastOled && data.sensor) {
    gSerial.__beefLastOled = [
      "BEEF FRESH | SIAP",
      `RGB : ${Math.round(data.sensor.r_raw ?? 0)}, ${Math.round(data.sensor.g_raw ?? 0)}, ${Math.round(data.sensor.b_raw ?? 0)}`,
      `Norm: ${(data.sensor.r_norm ?? 0).toFixed(2)},${(data.sensor.g_norm ?? 0).toFixed(2)},${(data.sensor.b_norm ?? 0).toFixed(2)}`,
      "=SIAP MENGUKUR",
      "KNN:--us Mem:2.3KB",
    ];
  }
  return data;
}

/**
 * Jalankan perintah website langsung pada ESP32 fisik via USB Serial (/dev/ttyUSB0),
 * baik untuk mode normal maupun Mode Simulasi (Hardware-in-the-Loop dengan data dummy).
 */
export async function executeSerialCommand(cmd: DeviceCommand, isSim: boolean): Promise<boolean> {
  if (!isSerialPortPresent()) return false;
  const source: "device" | "simulasi" = isSim ? "simulasi" : "device";
  const activePort = getActiveSerialPort() ?? SERIAL_PORT;
  const deviceId = isSim ? `ESP32 Simulasi (${activePort})` : `ESP32 (${activePort})`;

  if (cmd.type === "ping" || cmd.type === "sync") {
    const st = await getCachedSerialStatus(true);
    if (!st) return false;
    await processResult(
      cmd,
      {
        commandId: cmd.id,
        type: cmd.type,
        info: cmd.type === "ping" ? `ESP32 ${st.chip_model ?? "aktif"} terhubung via USB Serial` : "Model aktif di ESP32 siap",
        trainCount: 144,
        testCount: 36,
      },
      { source, deviceId },
    );
    return true;
  }

  if (cmd.type === "capture") {
    const label = parseLabel(cmd.payload?.label) ?? "segar";
    const split = parseSplit(cmd.payload?.split) ?? "train";
    const counts = await getCounts(isSim);
    const nextCount = counts[split][label] + 1;
    const quota = split === "train" ? counts.quota.trainPerClass : counts.quota.testPerClass;
    const cid = CLASS_ID[label];

    let res: Record<string, unknown> | null = null;
    if (isSim) {
      // Mode Simulasi Hardware-in-the-Loop: kirim RGB dummy ke ESP32 agar OLED fisik masuk mode SIM DATA LATIH/UJI
      const d = sampleDummyRgbForHardware(label);
      res = await sendSerialCommand<Record<string, unknown>>(
        `CAPTURE_DUMMY ${split},${cid},${nextCount},${quota},${d.r},${d.g},${d.b}`,
        4.5,
      );
      if (!res) {
        // Fallback jika firmware lama belum mendukung CAPTURE_DUMMY
        const simR = simulateReading(label);
        res = { r_raw: simR.r, g_raw: simR.g, b_raw: simR.b, c_raw: simR.rawC, lux: simR.lux, color_temp: simR.colorTemp };
      }
    } else {
      // Mode Asli: baca sensor TCS34725 nyata + tampilkan layar khusus Mode Pengambilan Dataset di OLED fisik
      res = await sendSerialCommand<Record<string, unknown>>(
        `CAPTURE_SAMPLE ${split},${cid},${nextCount},${quota},0`,
        4.5,
      );
      if (!res) {
        res = await sendSerialCommand<Record<string, unknown>>("READ_SENSOR", 4.0);
      }
    }
    if (!res) return false;

    const rVal = Number(res.r_raw ?? 0);
    const gVal = Number(res.g_raw ?? 0);
    const bVal = Number(res.b_raw ?? 0);
    setLastOledLines(OLED.saved(cmd.id, label, rVal, gVal, bVal, split, nextCount, quota, isSim));

    const body: DeviceResultBody = {
      commandId: cmd.id,
      type: "capture",
      r: rVal,
      g: gVal,
      b: bVal,
      rawR: Math.round(rVal),
      rawG: Math.round(gVal),
      rawB: Math.round(bVal),
      rawC: Number(res.c_raw ?? 0),
      lux: Number(res.lux ?? 0),
      colorTemp: Number(res.color_temp ?? 0),
    };
    await processResult(cmd, body, { source, deviceId });
    return true;
  }

  if (cmd.type === "classify") {
    const truth = parseLabel(cmd.payload?.truth);
    const reqK = Math.max(1, Math.min(15, Math.round(Number(cmd.payload?.k ?? 3))));
    let res: Record<string, unknown> | null = null;

    if (isSim && truth) {
      // Mode Simulasi + Uji Kelas Dummy tertentu -> kirim RGB dummy + nilai K ke ESP32 fisik
      const d = sampleDummyRgbForHardware(truth);
      res = await sendSerialCommand<Record<string, unknown>>(`SIMULATE_ANALYZE ${d.r},${d.g},${d.b},${reqK}`, 5.0);
    } else if (isSim) {
      // Mode Simulasi + Sensor Asli -> ESP32 baca TCS34725 nyata dengan nilai K pilihan pengguna
      res = await sendSerialCommand<Record<string, unknown>>(`ANALYZE SIM ${reqK}`, 5.0);
    } else {
      // Mode Produksi / Normal -> ESP32 baca TCS34725 nyata + dataset fix di alat dengan nilai K pilihan
      res = await sendSerialCommand<Record<string, unknown>>(`ANALYZE website ${reqK}`, 5.0);
    }
    if (!res) return false;

    const scaling = cmd.payload?.scaling ?? "minmax";
    const predictedLabel =
      scaling === "none"
        ? parseLabel(String(res.predicted_raw_label ?? res.predicted_label ?? "segar")) ?? "segar"
        : parseLabel(String(res.predicted_label ?? "segar")) ?? "segar";
    const k = Number(res.k_value ?? reqK);
    const votes = [0, 0, 0];
    const neighbors = Array.isArray(res.nearest_neighbors) ? (res.nearest_neighbors as Array<{ class_id?: number; distance?: number }>) : [];
    for (const nb of neighbors) {
      const cid = Number(nb.class_id);
      if (cid >= 0 && cid <= 2) votes[cid] += 1;
    }
    if (votes.reduce((a, b) => a + b, 0) === 0) {
      const idx = predictedLabel === "segar" ? 0 : predictedLabel === "mulai_membusuk" ? 1 : 2;
      votes[idx] = k;
    }
    const execUs =
      scaling === "none"
        ? Number(res.exec_time_knn_raw_us ?? res.exec_time_total_us ?? 0)
        : Number(res.exec_time_total_us ?? Number(res.exec_time_scaling_us ?? 0) + Number(res.exec_time_knn_scaled_us ?? 0));
    const rVal = Number(res.r_raw ?? 0);
    const gVal = Number(res.g_raw ?? 0);
    const bVal = Number(res.b_raw ?? 0);
    const rn = Number(res.r_norm ?? 0);
    const gn = Number(res.g_norm ?? 0);
    const bn = Number(res.b_norm ?? 0);

    setLastOledLines(OLED.result(predictedLabel, rVal, gVal, bVal, execUs, rn, gn, bn, isSim, k));

    const body: DeviceResultBody = {
      commandId: cmd.id,
      type: "classify",
      r: rVal,
      g: gVal,
      b: bVal,
      rNorm: rn,
      gNorm: gn,
      bNorm: bn,
      rawR: Math.round(rVal),
      rawG: Math.round(gVal),
      rawB: Math.round(bVal),
      rawC: Number(res.c_raw ?? 0),
      scaling,
      k,
      predicted: predictedLabel,
      votes,
      nearest: neighbors[0]?.distance ?? 0,
      execUs,
      scaleUs: Number(res.exec_time_scaling_us ?? 0),
      knnUs: Number(scaling === "none" ? res.exec_time_knn_raw_us ?? 0 : res.exec_time_knn_scaled_us ?? 0),
      memBytes: Number(res.mem_knn_work_bytes ?? 84) + Number(res.mem_dataset_bytes ?? 2328),
      modelBytes: Number(res.mem_dataset_bytes ?? 2328),
      freeHeap: Number(res.mem_free_heap_bytes ?? 0),
      trainCount: 144,
      actual: truth ?? undefined,
    };
    await processResult(cmd, body, { source, deviceId });
    return true;
  }

  if (cmd.type === "benchmark") {
    const res = await sendSerialCommand<Record<string, unknown>>("BENCHMARK", 6.0);
    if (!res) return false;
    const testCount = Number(res.test_count ?? 36);
    const scaleUs = Number(res.esp32_exec_scaling_us ?? 0);
    const knnScaledUs = Number(res.esp32_exec_knn_scaled_us ?? 0);
    const knnRawUs = Number(res.esp32_exec_knn_raw_us ?? 0);
    const workBytes = Number(res.esp32_mem_knn_work_bytes ?? 84);
    const dsScaled = Number(res.esp32_mem_dataset_scaled_bytes ?? 2328);
    const dsRaw = Number(res.esp32_mem_dataset_raw_bytes ?? 2304);
    const accRaw = Number(res.acc_without_scaling ?? 0);
    const accScaled = Number(res.acc_with_minmax ?? 0);

    const kVal = Number(res.k_value ?? 3);
    setLastOledLines([
      `BENCHMARK KNN (K=${kVal})`,
      `Tanpa   : ${accRaw.toFixed(1)}% (${res.correct_without_scaling ?? 0}/${testCount})`,
      `Min-Max : ${accScaled.toFixed(1)}% (${res.correct_with_minmax ?? 0}/${testCount})`,
      `=TIME: ${(scaleUs + knnScaledUs).toFixed(1)} us`,
      `RAM Model: ${dsScaled} B`,
    ]);

    const body: DeviceResultBody = {
      commandId: cmd.id,
      type: "benchmark",
      k: Number(res.k_value ?? 3),
      repeat: 1,
      cpuMhz: 240,
      freeHeap: Number(res.esp32_free_heap_bytes ?? 0),
      trainCount: Number(res.train_count ?? 144),
      results: [
        {
          scaling: "none",
          samples: testCount,
          correct: Number(res.correct_without_scaling ?? 0),
          avgUs: knnRawUs,
          minUs: knnRawUs,
          maxUs: knnRawUs,
          scaleUs: 0,
          knnUs: knnRawUs,
          memBytes: workBytes + dsRaw,
          modelBytes: dsRaw,
        },
        {
          scaling: "minmax",
          samples: testCount,
          correct: Number(res.correct_with_minmax ?? 0),
          avgUs: scaleUs + knnScaledUs,
          minUs: scaleUs + knnScaledUs,
          maxUs: scaleUs + knnScaledUs,
          scaleUs,
          knnUs: knnScaledUs,
          memBytes: workBytes + dsScaled,
          modelBytes: dsScaled,
        },
      ],
    };
    await processResult(cmd, body, { source, deviceId });
    return true;
  }

  return false;
}
