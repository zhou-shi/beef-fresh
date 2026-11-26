import { execFile, spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  findPythonCommand,
  getActiveSerialPort,
  getProjectVenvPythonPath,
  listAvailableUsbPorts,
  resetPythonCache,
} from "./serial";

const execFileAsync = promisify(execFile);

export const ROOT_DIR = path.resolve(process.cwd(), "..");
export const TOOLS_DIR = path.join(ROOT_DIR, ".tools");
export const ARDUINO_CLI_DIR = path.join(TOOLS_DIR, "arduino-cli");
export const PYVENV_DIR = path.join(TOOLS_DIR, "pyvenv");
export const ESP32_INDEX_URL = "https://espressif.github.io/arduino-esp32/package_esp32_index.json";
export const ESP32_CORE_ID = "esp32:esp32";
export const ESP32_FQBN = "esp32:esp32:esp32";
export const REQUIRED_LIBRARIES = [
  "Adafruit BusIO",
  "Adafruit GFX Library",
  "Adafruit SSD1306",
  "Adafruit TCS34725",
] as const;

export interface ToolchainStatus {
  platform: NodeJS.Platform;
  arch: string;
  osLabel: string;
  ready: boolean;
  busy: boolean;
  arduinoCli: { ok: boolean; path: string | null; version: string | null };
  esp32Core: { ok: boolean; version: string | null };
  libraries: Array<{ name: string; ok: boolean; version: string | null }>;
  python: { ok: boolean; command: string | null; pyserialOk: boolean; pyserialVersion: string | null };
}

export type ProgressFn = (ev: { step?: number; percent?: number; message: string; detail?: string }) => void;

const gTool = globalThis as typeof globalThis & {
  __beefToolchainBusy?: boolean;
};

function getOsLabel(): string {
  if (process.platform === "win32") return `Windows (${process.arch})`;
  if (process.platform === "darwin") return `macOS (${process.arch})`;
  return `Linux (${process.arch})`;
}

function testExecutable(cmd: string, args: string[]): string | null {
  try {
    const res = spawnSync(/*turbopackIgnore: true*/ cmd, args, {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    if (res.status === 0) {
      return `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
    }
  } catch {
    // abaikan
  }
  return null;
}

export function findArduinoCliPath(): string | null {
  const isWin = process.platform === "win32";
  const binName = isWin ? "arduino-cli.exe" : "arduino-cli";
  const candidates: string[] = [];

  if (process.env.ARDUINO_CLI_BIN) {
    candidates.push(process.env.ARDUINO_CLI_BIN);
  }
  candidates.push(path.join(ARDUINO_CLI_DIR, binName));

  const home = os.homedir();
  if (isWin) {
    candidates.push(
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "arduino-cli", binName),
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Microsoft", "WinGet", "Links", binName),
      path.join(home, ".local", "bin", binName),
      path.join(home, "scoop", "shims", binName),
      "C:\\Program Files\\Arduino CLI\\arduino-cli.exe",
      "C:\\arduino-cli\\arduino-cli.exe",
    );
  } else {
    candidates.push(
      path.join(home, ".local", "bin", binName),
      path.join(home, "bin", binName),
      "/usr/local/bin/arduino-cli",
      "/usr/bin/arduino-cli",
      "/snap/bin/arduino-cli",
    );
  }

  for (const c of candidates) {
    if (!c) continue;
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ c) && testExecutable(c, ["version"]) !== null) {
        return c;
      }
    } catch {
      // abaikan
    }
  }

  // Fallback PATH sistem via where / which
  try {
    const lookup = spawnSync(isWin ? "where" : "which", [binName], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    });
    if (lookup.status === 0 && lookup.stdout) {
      for (const line of lookup.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && testExecutable(trimmed, ["version"]) !== null) {
          return trimmed;
        }
      }
    }
  } catch {
    // abaikan
  }

  return null;
}

function parseVersionText(out: string | null): string | null {
  if (!out) return null;
  try {
    const j = JSON.parse(out) as { VersionString?: string };
    if (j.VersionString) return j.VersionString;
  } catch {
    // bukan JSON
  }
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function parseCoreInfo(rawJson: string): { ok: boolean; version: string | null } {
  try {
    const parsed = JSON.parse(rawJson) as
      | Array<{ id?: string; installed_version?: string; installed?: string }>
      | { platforms?: Array<{ id?: string; installed_version?: string; installed?: string }> };
    const list = Array.isArray(parsed) ? parsed : (parsed.platforms ?? []);
    const esp = list.find((p) => (p.id ?? "").toLowerCase() === ESP32_CORE_ID);
    if (esp) {
      const ver = esp.installed_version || esp.installed || null;
      return { ok: true, version: ver };
    }
  } catch {
    // abaikan
  }
  return { ok: false, version: null };
}

function parseLibrariesInfo(rawJson: string): Map<string, string | null> {
  const installed = new Map<string, string | null>();
  try {
    const parsed = JSON.parse(rawJson) as
      | Array<{ library?: { name?: string; version?: string }; name?: string; version?: string }>
      | { installed_libraries?: Array<{ library?: { name?: string; version?: string }; name?: string; version?: string }> };
    const list = Array.isArray(parsed) ? parsed : (parsed.installed_libraries ?? []);
    for (const item of list) {
      const lib = item.library ?? item;
      const name = lib.name?.trim();
      if (name) {
        installed.set(name.toLowerCase(), lib.version ?? null);
      }
    }
  } catch {
    // abaikan
  }
  return installed;
}

export async function checkToolchainStatus(): Promise<ToolchainStatus> {
  const cliPath = findArduinoCliPath();
  let cliVersion: string | null = null;
  let esp32Core: { ok: boolean; version: string | null } = { ok: false, version: null };
  const installedLibs = new Map<string, string | null>();

  if (cliPath) {
    cliVersion = parseVersionText(testExecutable(cliPath, ["version", "--format", "json"]));
    if (!cliVersion) {
      cliVersion = parseVersionText(testExecutable(cliPath, ["version"]));
    }

    try {
      const { stdout } = await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["core", "list", "--format", "json"], {
        timeout: 15_000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      });
      esp32Core = parseCoreInfo(stdout);
    } catch {
      // abaikan
    }

    try {
      const { stdout } = await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["lib", "list", "--format", "json"], {
        timeout: 15_000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      });
      for (const [k, v] of parseLibrariesInfo(stdout)) {
        installedLibs.set(k, v);
      }
    } catch {
      // abaikan
    }
  }

  const libraries = REQUIRED_LIBRARIES.map((name) => {
    const found = installedLibs.has(name.toLowerCase());
    return {
      name,
      ok: found,
      version: installedLibs.get(name.toLowerCase()) ?? null,
    };
  });

  const py = findPythonCommand();
  let pyserialOk = false;
  let pyserialVersion: string | null = null;
  if (py) {
    const out = testExecutable(py.cmd, [...py.prefixArgs, "-c", "import serial; print(getattr(serial, '__version__', 'ok'))"]);
    if (out !== null) {
      pyserialOk = true;
      pyserialVersion = out.split(/\r?\n/)[0]?.trim() || "ok";
    }
  }

  const ready = Boolean(cliPath) && esp32Core.ok && libraries.every((l) => l.ok) && pyserialOk;

  return {
    platform: process.platform,
    arch: process.arch,
    osLabel: getOsLabel(),
    ready,
    busy: Boolean(gTool.__beefToolchainBusy),
    arduinoCli: { ok: Boolean(cliPath), path: cliPath, version: cliVersion },
    esp32Core,
    libraries,
    python: {
      ok: Boolean(py),
      command: py ? [py.cmd, ...py.prefixArgs].join(" ") : null,
      pyserialOk,
      pyserialVersion,
    },
  };
}

export async function spawnWithProgress(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    timeoutMs?: number;
    keepaliveLabel?: string;
    onDetail?: (line: string) => void;
  } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return new Promise((resolve, reject) => {
    const proc = spawn(/*turbopackIgnore: true*/ cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const tail: string[] = [];
    let settled = false;
    let lastReportAt = Date.now();
    const pushLine = (raw: string) => {
      const clean = raw.replace(/\r/g, "").trim();
      if (!clean) return;
      tail.push(clean);
      if (tail.length > 40) tail.shift();
      lastReportAt = Date.now();
      opts.onDetail?.(clean.slice(0, 160));
    };

    let outBuf = "";
    let errBuf = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      outBuf += chunk;
      const lines = outBuf.split("\n");
      outBuf = lines.pop() ?? "";
      for (const l of lines) pushLine(l);
    });
    proc.stderr?.on("data", (chunk: string) => {
      errBuf += chunk;
      const lines = errBuf.split("\n");
      errBuf = lines.pop() ?? "";
      for (const l of lines) pushLine(l);
    });

    const keepalive = setInterval(() => {
      if (settled) return;
      if (Date.now() - lastReportAt >= 5000 && opts.keepaliveLabel) {
        opts.onDetail?.(opts.keepaliveLabel);
      }
    }, 5000);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(keepalive);
      try {
        proc.kill("SIGTERM");
      } catch {
        // abaikan
      }
      reject(new Error(`Timeout setelah ${Math.round(timeoutMs / 1000)} detik: ${tail.slice(-4).join(" | ")}`));
    }, timeoutMs);

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearInterval(keepalive);
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      if (outBuf.trim()) pushLine(outBuf);
      if (errBuf.trim()) pushLine(errBuf);
      if (settled) return;
      settled = true;
      clearInterval(keepalive);
      clearTimeout(timer);
      if (code === 0) {
        resolve(tail.join("\n"));
      } else {
        const msg = tail.slice(-6).join(" | ") || `Proses keluar dengan kode ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

function getArduinoCliDownloadSpec(): { url: string; ext: "zip" | "tar.gz"; binName: string } {
  const archMap: Record<string, string> = {
    x64: "64bit",
    arm64: "ARM64",
    ia32: "32bit",
  };
  const archStr = archMap[process.arch] ?? "64bit";
  if (process.platform === "win32") {
    return {
      url: `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_${archStr}.zip`,
      ext: "zip",
      binName: "arduino-cli.exe",
    };
  }
  if (process.platform === "darwin") {
    return {
      url: `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_macOS_${archStr}.tar.gz`,
      ext: "tar.gz",
      binName: "arduino-cli",
    };
  }
  return {
    url: `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_${archStr}.tar.gz`,
    ext: "tar.gz",
    binName: "arduino-cli",
  };
}

export async function ensureArduinoCli(onProgress?: ProgressFn): Promise<string> {
  const existing = findArduinoCliPath();
  if (existing) {
    onProgress?.({ step: 1, percent: 10, message: "Arduino CLI sudah tersedia", detail: existing });
    return existing;
  }

  const spec = getArduinoCliDownloadSpec();
  fs.mkdirSync(/*turbopackIgnore: true*/ ARDUINO_CLI_DIR, { recursive: true });
  const archivePath = path.join(ARDUINO_CLI_DIR, `arduino-cli.${spec.ext}`);
  const targetBin = path.join(ARDUINO_CLI_DIR, spec.binName);

  onProgress?.({ step: 1, percent: 8, message: "Mengunduh Arduino CLI resmi...", detail: spec.url });
  const res = await fetch(spec.url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Gagal mengunduh Arduino CLI (HTTP ${res.status}). Periksa koneksi internet.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(/*turbopackIgnore: true*/ archivePath, buf);

  onProgress?.({ step: 1, percent: 14, message: "Mengekstrak Arduino CLI...", detail: targetBin });
  if (spec.ext === "zip") {
    try {
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${ARDUINO_CLI_DIR.replace(/'/g, "''")}' -Force`,
        ],
        { timeout: 60_000, windowsHide: true },
      );
    } catch {
      await execFileAsync("tar", ["-xf", archivePath, "-C", ARDUINO_CLI_DIR], { timeout: 60_000, windowsHide: true });
    }
  } else {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", ARDUINO_CLI_DIR], { timeout: 60_000, windowsHide: true });
    if (fs.existsSync(/*turbopackIgnore: true*/ targetBin)) {
      fs.chmodSync(/*turbopackIgnore: true*/ targetBin, 0o755);
    }
  }

  try {
    fs.unlinkSync(/*turbopackIgnore: true*/ archivePath);
  } catch {
    // abaikan
  }

  const verified = findArduinoCliPath();
  if (!verified) {
    throw new Error(`Arduino CLI selesai diekstrak tetapi gagal dijalankan di ${targetBin}.`);
  }
  return verified;
}

export async function ensureEsp32Core(cliPath: string, onProgress?: ProgressFn): Promise<void> {
  try {
    const { stdout } = await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["core", "list", "--format", "json"], {
      timeout: 15_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    if (parseCoreInfo(stdout).ok) {
      onProgress?.({ step: 1, percent: 22, message: "Core ESP32 (esp32:esp32) sudah terpasang" });
      return;
    }
  } catch {
    // lanjut install
  }

  onProgress?.({ step: 1, percent: 18, message: "Menyiapkan indeks board ESP32...", detail: ESP32_INDEX_URL });
  await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["config", "init"], {
    timeout: 15_000,
    windowsHide: true,
  }).catch(() => {});
  await execFileAsync(
    /*turbopackIgnore: true*/ cliPath,
    ["config", "add", "board_manager.additional_urls", ESP32_INDEX_URL],
    { timeout: 15_000, windowsHide: true },
  ).catch(() => {});

  await spawnWithProgress(cliPath, ["core", "update-index", "--additional-urls", ESP32_INDEX_URL], {
    timeoutMs: 180_000,
    keepaliveLabel: "Memperbarui indeks board ESP32...",
    onDetail: (detail) => onProgress?.({ step: 1, percent: 20, message: "Memperbarui indeks board ESP32...", detail }),
  });

  onProgress?.({
    step: 1,
    percent: 24,
    message: "Mengunduh & memasang core ESP32 (esp32:esp32)...",
    detail: "Pertama kali dapat memakan waktu beberapa menit",
  });
  await spawnWithProgress(cliPath, ["core", "install", ESP32_CORE_ID, "--additional-urls", ESP32_INDEX_URL], {
    timeoutMs: 1_200_000,
    keepaliveLabel: "Sedang mengunduh & mengekstrak toolchain ESP32...",
    onDetail: (detail) =>
      onProgress?.({ step: 1, percent: 28, message: "Mengunduh & memasang core ESP32...", detail }),
  });
}

export async function ensureArduinoLibraries(cliPath: string, onProgress?: ProgressFn): Promise<void> {
  const installed = new Map<string, string | null>();
  try {
    const { stdout } = await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["lib", "list", "--format", "json"], {
      timeout: 15_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    for (const [k, v] of parseLibrariesInfo(stdout)) installed.set(k, v);
  } catch {
    // lanjut cek
  }

  const missing = REQUIRED_LIBRARIES.filter((name) => !installed.has(name.toLowerCase()));
  if (!missing.length) {
    onProgress?.({ step: 1, percent: 36, message: "Semua library sensor & OLED sudah lengkap" });
    return;
  }

  onProgress?.({
    step: 1,
    percent: 33,
    message: `Memasang ${missing.length} library Arduino yang kurang...`,
    detail: missing.join(", "),
  });
  await spawnWithProgress(cliPath, ["lib", "update-index"], {
    timeoutMs: 180_000,
    keepaliveLabel: "Memperbarui indeks library Arduino...",
    onDetail: (detail) => onProgress?.({ step: 1, percent: 34, message: "Memperbarui indeks library...", detail }),
  });
  await spawnWithProgress(cliPath, ["lib", "install", ...missing], {
    timeoutMs: 300_000,
    keepaliveLabel: "Mengunduh library Adafruit...",
    onDetail: (detail) => onProgress?.({ step: 1, percent: 36, message: "Memasang library Adafruit...", detail }),
  });
}

export async function ensurePySerial(onProgress?: ProgressFn): Promise<void> {
  const py = findPythonCommand();
  if (!py) {
    onProgress?.({
      step: 1,
      percent: 42,
      message: "Python belum ditemukan — flash USB tetap jalan, tetapi monitoring serial butuh Python 3",
      detail: "Pasang Python 3 agar komunikasi live USB Serial aktif",
    });
    return;
  }

  const hasSerial = testExecutable(py.cmd, [...py.prefixArgs, "-c", "import serial"]) !== null;
  if (hasSerial) {
    onProgress?.({ step: 1, percent: 42, message: "Python & PySerial siap" });
    return;
  }

  onProgress?.({
    step: 1,
    percent: 39,
    message: "Menyiapkan pustaka Python PySerial...",
    detail: PYVENV_DIR,
  });

  let installed = false;
  try {
    fs.mkdirSync(/*turbopackIgnore: true*/ TOOLS_DIR, { recursive: true });
    const venvPy = getProjectVenvPythonPath();
    if (!fs.existsSync(/*turbopackIgnore: true*/ venvPy)) {
      await spawnWithProgress(py.cmd, [...py.prefixArgs, "-m", "venv", PYVENV_DIR], {
        timeoutMs: 120_000,
        onDetail: (detail) => onProgress?.({ step: 1, percent: 40, message: "Membuat environment Python lokal...", detail }),
      });
    }
    if (fs.existsSync(/*turbopackIgnore: true*/ venvPy)) {
      await spawnWithProgress(venvPy, ["-m", "pip", "install", "--upgrade", "pyserial"], {
        timeoutMs: 180_000,
        keepaliveLabel: "Mengunduh pyserial...",
        onDetail: (detail) => onProgress?.({ step: 1, percent: 41, message: "Memasang pyserial di .tools/pyvenv...", detail }),
      });
      installed = true;
    }
  } catch {
    installed = false;
  }

  if (!installed) {
    const pipArgs =
      process.platform === "linux"
        ? [...py.prefixArgs, "-m", "pip", "install", "--user", "--break-system-packages", "pyserial"]
        : [...py.prefixArgs, "-m", "pip", "install", "--user", "pyserial"];
    await spawnWithProgress(py.cmd, pipArgs, {
      timeoutMs: 180_000,
      keepaliveLabel: "Mengunduh pyserial...",
      onDetail: (detail) => onProgress?.({ step: 1, percent: 41, message: "Memasang pyserial (--user)...", detail }),
    }).catch((err) => {
      onProgress?.({
        step: 1,
        percent: 42,
        message: "PySerial gagal dipasang otomatis (flashing ESP32 tetap dilanjutkan)",
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  }

  resetPythonCache();
}

export async function ensureAllToolchain(onProgress?: ProgressFn): Promise<{ cliPath: string; status: ToolchainStatus }> {
  if (gTool.__beefToolchainBusy) {
    throw new Error("Proses penyiapan toolchain sedang berlangsung. Mohon tunggu hingga selesai.");
  }
  gTool.__beefToolchainBusy = true;
  try {
    const cliPath = await ensureArduinoCli(onProgress);
    await ensureEsp32Core(cliPath, onProgress);
    await ensureArduinoLibraries(cliPath, onProgress);
    await ensurePySerial(onProgress);
    const status = await checkToolchainStatus();
    return { cliPath, status };
  } finally {
    gTool.__beefToolchainBusy = false;
  }
}

const KNOWN_ESP32_VIDS = new Set(["0X10C4", "0X1A86", "0X0403", "0X303A", "0X2341"]);

export async function detectEsp32Port(cliPath: string, preferredPort?: string | null): Promise<string | null> {
  const ports = listAvailableUsbPorts();
  const norm = (p: string) => (process.platform === "win32" ? p.toUpperCase() : p);

  if (preferredPort) {
    const target = norm(preferredPort);
    const match = ports.find((p) => norm(p) === target);
    if (match) return match;
  }

  const active = getActiveSerialPort();
  if (active) {
    const target = norm(active);
    const match = ports.find((p) => norm(p) === target);
    if (match) return match;
  }

  try {
    const { stdout } = await execFileAsync(/*turbopackIgnore: true*/ cliPath, ["board", "list", "--format", "json"], {
      timeout: 8000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout) as {
      detected_ports?: Array<{
        port?: { address?: string; label?: string; protocol?: string; properties?: Record<string, string> };
        matching_boards?: Array<{ name?: string; fqbn?: string }>;
      }>;
    };
    const entries = parsed.detected_ports ?? [];
    for (const item of entries) {
      const addr = item.port?.address;
      if (!addr) continue;
      if ((item.port?.label ?? "").toLowerCase().includes("bluetooth")) continue;
      const isEspMatch = (item.matching_boards ?? []).some(
        (b) => (b.fqbn ?? "").toLowerCase().includes("esp32") || (b.name ?? "").toLowerCase().includes("esp32"),
      );
      if (isEspMatch) return addr;
    }
    for (const item of entries) {
      const addr = item.port?.address;
      if (!addr) continue;
      const label = (item.port?.label ?? "").toLowerCase();
      if (label.includes("bluetooth")) continue;
      const vid = (item.port?.properties?.vid ?? "").toUpperCase();
      if (KNOWN_ESP32_VIDS.has(vid)) return addr;
    }
  } catch {
    // fallback ke listAvailableUsbPorts
  }

  return ports[0] ?? null;
}
