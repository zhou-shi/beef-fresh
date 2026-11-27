"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Cable, Check, CheckCircle2, Copy, Cpu, DoorOpen, Download, Eye, FileCode, Lightbulb, Microchip, Monitor, RefreshCw, Rotate3d, ScanEye, ScanLine, Server, Usb, Wrench, XCircle } from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { PIN_MAP, fmtBytes, timeAgo } from "@/lib/constants";
import { DEFAULT_VISUAL, OLED, type DeviceVisual } from "@/lib/device-visual";
import type { LiteOverview } from "@/lib/types";
import { Badge, Button, Card, ProgressBar, StatusDot, cn } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeployModal } from "@/components/DeployModal";

const DeviceScene = dynamic(() => import("@/components/three/DeviceScene"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-fat-300/60">Memuat model 3D</div>,
});

const PLACEHOLDER_URL = "https://your-app.example.com";

interface ToolchainStatusDTO {
  platform: string;
  arch: string;
  osLabel: string;
  ready: boolean;
  busy: boolean;
  arduinoCli: { ok: boolean; path: string | null; version: string | null };
  esp32Core: { ok: boolean; version: string | null };
  libraries: Array<{ name: string; ok: boolean; version: string | null }>;
  python: { ok: boolean; command: string | null; pyserialOk: boolean; pyserialVersion: string | null };
}

function WiringDiagram() {
  const esp = [
    { name: "3V3", y: 112, color: "#ef4444" },
    { name: "GND", y: 152, color: "#9ca3af" },
    { name: "G26", y: 192, color: "#3b82f6" },
    { name: "G27", y: 232, color: "#eab308" },
  ];
  const sensor = { VIN: 64, GND: 86, SDA: 108, SCL: 130 };
  const oled = { VCC: 254, GND: 276, SDA: 298, SCL: 320 };
  const wires = [
    { y: 112, s: sensor.VIN, o: oled.VCC, color: "#ef4444", cx: 330 },
    { y: 152, s: sensor.GND, o: oled.GND, color: "#9ca3af", cx: 350 },
    { y: 192, s: sensor.SDA, o: oled.SDA, color: "#3b82f6", cx: 370 },
    { y: 232, s: sensor.SCL, o: oled.SCL, color: "#eab308", cx: 390 },
  ];
  return (
    <svg viewBox="0 0 720 360" className="h-auto w-full" role="img" aria-label="Diagram rangkaian ESP32, TCS34725 dan OLED SSD1306">
      <rect x="20" y="50" width="210" height="250" rx="16" fill="#14161c" stroke="#3b3f4a" />
      <rect x="48" y="80" width="120" height="86" rx="8" fill="#c3c7cf" />
      <text x="108" y="128" textAnchor="middle" fill="#1f2937" fontSize="15" fontWeight="800">ESP32</text>
      <text x="108" y="146" textAnchor="middle" fill="#374151" fontSize="9">WROOM-32</text>
      <rect x="95" y="282" width="34" height="18" rx="3" fill="#9aa0a8" />
      <text x="112" y="272" textAnchor="middle" fill="#9ca3af" fontSize="10">USB</text>
      <text x="40" y="70" fill="#9ca3af" fontSize="11">ESP32 DevKit</text>
      {esp.map((p) => (
        <g key={p.name}>
          <circle cx="230" cy={p.y} r="5.5" fill={p.color} />
          <text x="216" y={p.y + 4} textAnchor="end" fill="#e5e7eb" fontSize="12" fontFamily="monospace">
            {p.name}
          </text>
        </g>
      ))}

      <rect x="500" y="30" width="200" height="124" rx="14" fill="#3b1470" stroke="#7c3aed" />
      <text x="600" y="54" textAnchor="middle" fill="#f5f3ff" fontSize="14" fontWeight="700">TCS34725</text>
      <text x="600" y="70" textAnchor="middle" fill="#c4b5fd" fontSize="9.5">I2C 0x29 (Sensor warna RGB)</text>
      <circle cx="640" cy="112" r="15" fill="#fff8e1" />
      <circle cx="640" cy="112" r="24" fill="#fff8e1" opacity="0.18" />
      <text x="640" y="146" textAnchor="middle" fill="#fde68a" fontSize="9">LED bawaan (penerang)</text>
      <rect x="590" y="100" width="22" height="22" rx="3" fill="#d8d2c4" />
      {Object.entries(sensor).map(([n, y]) => (
        <g key={n}>
          <circle cx="500" cy={y} r="5" fill="#fbbf24" />
          <text x="512" y={y + 4} fill="#ede9fe" fontSize="11" fontFamily="monospace">
            {n}
          </text>
        </g>
      ))}

      <rect x="500" y="222" width="200" height="124" rx="14" fill="#173e94" stroke="#3b82f6" />
      <rect x="556" y="242" width="128" height="74" rx="4" fill="#020916" />
      <text x="562" y="253" fill="#63d2ff" fontSize="8.5" fontFamily="monospace" fontWeight="700">BEEF FRESH | KNN</text>
      <line x1="556" y1="257" x2="684" y2="257" stroke="#63d2ff" strokeWidth="1" />
      <text x="562" y="269" fill="#63d2ff" fontSize="8" fontFamily="monospace">RGB : 182, 51, 38</text>
      <rect x="560" y="278" width="120" height="18" rx="3" fill="#63d2ff" />
      <text x="566" y="290" fill="#020916" fontSize="10" fontWeight="700" fontFamily="monospace">HASIL: SEGAR</text>
      <text x="562" y="309" fill="#63d2ff" fontSize="7.5" fontFamily="monospace">KNN:82us Mem:2.3KB</text>
      <text x="620" y="334" textAnchor="middle" fill="#bfdbfe" fontSize="9.5">OLED SSD1306 Biru (0x3C)</text>
      {Object.entries(oled).map(([n, y]) => (
        <g key={n}>
          <circle cx="500" cy={y} r="5" fill="#fbbf24" />
          <text x="512" y={y + 4} fill="#dbeafe" fontSize="11" fontFamily="monospace">
            {n}
          </text>
        </g>
      ))}

      {wires.map((w) => (
        <g key={w.color}>
          <path d={`M236 ${w.y} C ${w.cx} ${w.y}, ${w.cx + 40} ${w.s}, 494 ${w.s}`} stroke={w.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.95" />
          <path d={`M236 ${w.y} C ${w.cx} ${w.y}, ${w.cx + 40} ${w.o}, 494 ${w.o}`} stroke={w.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.95" />
        </g>
      ))}
      <text x="365" y="352" textAnchor="middle" fill="var(--chart-tick)" fontSize="10">Bus I2C bersama: G26 (SDA), G27 (SCL), catu daya 3V3</text>
    </svg>
  );
}

export default function DeviceView() {
  const { data: ov, refresh } = usePoll<LiteOverview>("/api/overview?lite=1", 5000);
  const [visual, setVisual] = useState<DeviceVisual>({ ...DEFAULT_VISUAL, autoRotate: true, oled: OLED.result("segar", 198, 51, 38, 97, 0.77, 0.11, 0.1, false, 3) });
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calMsg, setCalMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [selectedPort, setSelectedPort] = useState("");
  const [reconBusy, setReconBusy] = useState(false);
  const [reconMsg, setReconMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [tcStatus, setTcStatus] = useState<ToolchainStatusDTO | null>(null);
  const [tcLoading, setTcLoading] = useState(false);
  const [tcInstallBusy, setTcInstallBusy] = useState(false);
  const [tcPercent, setTcPercent] = useState(0);
  const [tcMsg, setTcMsg] = useState<string | null>(null);
  const [tcDetail, setTcDetail] = useState<string | null>(null);
  const [tcErr, setTcErr] = useState<string | null>(null);
  const [kBusy, setKBusy] = useState(false);

  async function refreshToolchain() {
    setTcLoading(true);
    try {
      const res = await api<{ ok: boolean; status?: ToolchainStatusDTO }>("/api/device/toolchain");
      if (res.status) setTcStatus(res.status);
    } catch {
      // abaikan
    } finally {
      setTcLoading(false);
    }
  }

  async function installToolchain() {
    setTcInstallBusy(true);
    setTcPercent(4);
    setTcMsg("Menyiapkan komponen yang diperlukan...");
    setTcDetail(null);
    setTcErr(null);
    try {
      const res = await fetch("/api/device/toolchain", { method: "POST", cache: "no-store" });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (value) {
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) {
              const ev = JSON.parse(line) as {
                percent?: number;
                message?: string;
                detail?: string;
                done?: boolean;
                ok?: boolean;
                error?: string;
                status?: ToolchainStatusDTO;
              };
              if (typeof ev.percent === "number") setTcPercent(ev.percent);
              if (ev.message) setTcMsg(ev.message);
              if (ev.detail !== undefined) setTcDetail(ev.detail || null);
              if (ev.status) setTcStatus(ev.status);
              if (ev.done && !ev.ok && ev.error) setTcErr(ev.error);
            }
            nl = buf.indexOf("\n");
          }
        }
        if (streamDone) break;
      }
      await refreshToolchain();
    } catch (e) {
      setTcErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTcInstallBusy(false);
    }
  }

  async function resetDefaultK3() {
    setKBusy(true);
    try {
      await api("/api/settings", { method: "PUT", json: { defaultK: 3 } });
      await refresh();
    } finally {
      setKBusy(false);
    }
  }

  async function reconnectUsb() {
    setReconBusy(true);
    setReconMsg(null);
    try {
      const res = await api<{ ok: boolean; port?: string | null; availablePorts?: string[]; error?: string }>("/api/device/reconnect", {
        method: "POST",
        json: { port: selectedPort || undefined },
      });
      await refresh();
      if (res.ok && res.port) {
        setSelectedPort(res.port);
        setReconMsg({ tone: "ok", text: `Terhubung dan sinkron dengan ESP32 di port ${res.port}.` });
      } else {
        setReconMsg({ tone: "err", text: res.error ?? "ESP32 tidak ditemukan pada port USB." });
      }
    } catch (e) {
      setReconMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setReconBusy(false);
    }
  }
  const syncedOledKey = ov?.device.oledLines?.join("\n") ?? "";
  useEffect(() => {
    const lines = ov?.device.oledLines;
    if (lines?.length) {
      setVisual((v) => (v.scanning ? v : { ...v, oled: lines }));
    }
  }, [syncedOledKey]);

  async function runCalibration(action: "white" | "black" | "reset") {
    setCalBusy(action);
    setCalMsg(null);
    try {
      const res = await api<{ oledLines?: string[] }>("/api/device/calibrate", { method: "POST", json: { action } });
      if (res.oledLines?.length) setVisual((v) => ({ ...v, oled: res.oledLines! }));
      setCalMsg({
        tone: "ok",
        text:
          action === "white"
            ? "Kalibrasi Putih (255) tersimpan di memori ESP32."
            : action === "black"
              ? "Kalibrasi Hitam (0) tersimpan di memori ESP32."
              : "Kalibrasi direset ke mode mentah.",
      });
      await refresh();
    } catch (e) {
      setCalMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCalBusy(null);
    }
  }
  const [view, setView] = useState({ name: "awal", n: 0 });
  const [code, setCode] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/firmware/beef_fresh_esp32.ino")
      .then((r) => r.text())
      .then(setCode)
      .catch(() => setCode("// Gagal memuat firmware"));
    void refreshToolchain();
  }, []);

  const finalCode = useMemo(() => (origin ? code.replace(PLACEHOLDER_URL, origin) : code), [code, origin]);

  function download() {
    const blob = new Blob([finalCode], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "beef_fresh_esp32.ino";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(finalCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* abaikan */
    }
  }

  const d = ov?.device;
  const toggle = (key: "autoRotate" | "xray" | "lidOpen" | "labels" | "led") =>
    setVisual((v) => {
      const next = !v[key];
      if (key === "led") {
        void api("/api/device/led", { method: "POST", json: { on: next } }).catch(() => {});
      }
      return { ...v, [key]: next };
    });
  const tools: Array<{ key: "autoRotate" | "xray" | "lidOpen" | "labels" | "led"; label: string; icon: typeof Rotate3d }> = [
    { key: "autoRotate", label: "Putar", icon: Rotate3d },
    { key: "xray", label: "X-Ray", icon: ScanEye },
    { key: "lidOpen", label: "Buka tutup", icon: DoorOpen },
    { key: "labels", label: "Label", icon: Eye },
    { key: "led", label: "LED sensor", icon: Lightbulb },
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-beef-300/80">
            <Microchip className="h-4 w-4" /> Perangkat
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-fat-50">Perangkat Beef Fresh (ESP32, TCS34725, dan OLED)</h1>
          <p className="mt-1 max-w-3xl text-sm text-fat-300/70">
            Kotak berengsel 25 mm dengan kait, tabung hitam peredam cahaya luar, sensor warna TCS34725 dengan LED bawaan, dan layar OLED SSD1306 untuk menampilkan hasil deteksi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={d?.online ? "ok" : "neutral"}>
            <StatusDot tone={d?.online ? "ok" : "neutral"} pulse={!!d?.online} />
            {d?.online ? "ESP32 online" : "ESP32 offline"}
          </Badge>
          {d?.usbPort && <Badge tone="info">{d.usbPort}</Badge>}
          {d?.everSeen && <Badge>Terakhir {timeAgo(d.lastSeen)}</Badge>}
          {d?.freeHeap != null && <Badge>Sisa RAM {fmtBytes(d.freeHeap)}</Badge>}
        </div>
      </div>

      <Card
        title="Koneksi USB Serial ESP32"
        subtitle="Deteksi otomatis port USB (COM* di Windows atau /dev/ttyUSB* di Linux) dan hubungkan ulang setelah kabel dicabut-pasang"
        icon={<Usb className="h-4 w-4" />}
        actions={
          <Badge tone={d?.usbPort ? "ok" : "neutral"}>
            <StatusDot tone={d?.usbPort ? "ok" : "neutral"} pulse={!!d?.usbPort} />
            {d?.usbPort ? `Aktif: ${d.usbPort}` : "Belum terhubung"}
          </Badge>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              className="h-9 rounded-lg border border-line bg-black/30 px-2.5 py-1.5 text-xs text-fat-100 outline-none focus:border-beef-600"
            >
              <option value="">Otomatis (scan semua port USB)</option>
              {(d?.availablePorts ?? []).map((p) => (
                <option key={p} value={p}>
                  {p} {p === d?.usbPort ? "(aktif)" : ""}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" icon={<RefreshCw className={cn("h-3.5 w-3.5", reconBusy && "animate-spin")} />} loading={reconBusy} onClick={() => void reconnectUsb()}>
              Scan & Hubungkan Ulang
            </Button>
          </div>
          <div className="text-xs text-fat-300/70">
            {reconMsg ? (
              <span className={reconMsg.tone === "ok" ? "text-emerald-300" : "text-red-300"}>{reconMsg.text}</span>
            ) : d?.availablePorts?.length ? (
              <span>Port terdeteksi di laptop: <b className="font-mono text-fat-100">{d.availablePorts.join(", ")}</b></span>
            ) : (
              <span>Belum ada port USB serial yang terdeteksi. Colokkan kabel USB ESP32 lalu klik Scan.</span>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Kesiapan Toolchain ESP32 (Windows 11 & Ubuntu)"
        subtitle="Arduino CLI, Core esp32:esp32, 4 Library Adafruit, dan Python PySerial diperiksa otomatis dan dapat diunduh langsung jika belum tersedia"
        icon={<Wrench className="h-4 w-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tcStatus?.osLabel && <Badge tone="info">{tcStatus.osLabel}</Badge>}
            <Badge tone={tcStatus?.ready ? "ok" : "warn"}>
              <StatusDot tone={tcStatus?.ready ? "ok" : "warn"} />
              {tcStatus ? (tcStatus.ready ? "Siap Tanam" : "Perlu Disiapkan") : "Memeriksa..."}
            </Badge>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
              <div>
                <div className="font-semibold text-fat-50">Arduino CLI</div>
                <div className="text-[11px] text-fat-300/65">{tcStatus?.arduinoCli.version ? `v${tcStatus.arduinoCli.version}` : "Belum terpasang"}</div>
              </div>
              {tcStatus?.arduinoCli.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
              <div>
                <div className="font-semibold text-fat-50">Core ESP32</div>
                <div className="text-[11px] text-fat-300/65">{tcStatus?.esp32Core.version ? `esp32 v${tcStatus.esp32Core.version}` : "Belum terpasang"}</div>
              </div>
              {tcStatus?.esp32Core.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
              <div>
                <div className="font-semibold text-fat-50">Library Adafruit (4)</div>
                <div className="text-[11px] text-fat-300/65">
                  {tcStatus ? `${tcStatus.libraries.filter((l) => l.ok).length}/${tcStatus.libraries.length} terpasang` : "Memeriksa..."}
                </div>
              </div>
              {tcStatus?.libraries.every((l) => l.ok) ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
              <div>
                <div className="font-semibold text-fat-50">Python & PySerial</div>
                <div className="text-[11px] text-fat-300/65">
                  {tcStatus?.python.pyserialOk
                    ? `pyserial ${tcStatus.python.pyserialVersion ?? "ok"}`
                    : tcStatus?.python.ok
                      ? "PySerial belum ada"
                      : "Python 3 belum ada"}
                </div>
              </div>
              {tcStatus?.python.pyserialOk ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} loading={tcInstallBusy} onClick={() => void installToolchain()}>
                Siapkan / Unduh Otomatis
              </Button>
              <Button size="sm" variant="outline" icon={<RefreshCw className={cn("h-3.5 w-3.5", tcLoading && "animate-spin")} />} loading={tcLoading} onClick={() => void refreshToolchain()}>
                Cek Ulang
              </Button>
              {ov?.settings && ov.settings.defaultK !== 3 && (
                <Button size="sm" variant="soft" loading={kBusy} onClick={() => void resetDefaultK3()}>
                  Set Default K = 3
                </Button>
              )}
            </div>
            {ov?.settings && (
              <div className="text-xs text-fat-300/70">
                Model aktif: <b className="font-mono text-fat-100">K = {ov.settings.defaultK}</b> ({ov.settings.defaultScaling})
              </div>
            )}
          </div>

          {(tcInstallBusy || tcMsg || tcErr) && (
            <div className="rounded-xl border border-line bg-black/25 p-3 text-xs">
              {tcInstallBusy && <ProgressBar value={tcPercent} max={100} color="#e5383b" className="mb-2 h-2" />}
              {tcMsg && <div className="font-medium text-fat-100">{tcMsg}</div>}
              {tcDetail && <div className="mt-1 truncate font-mono text-[11px] text-fat-300/70">{tcDetail}</div>}
              {tcErr && <div className="mt-1.5 font-mono text-[11px] text-red-300 break-words">{tcErr}</div>}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="card surface-dark relative h-[520px] overflow-hidden">
          <div className="marbling pointer-events-none absolute inset-0 opacity-60" />
          <DeviceScene visual={visual} view={view} />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {tools.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggle(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ring-1 backdrop-blur transition",
                    visual[t.key] ? "bg-beef-600/80 text-white ring-beef-400/50" : "bg-black/45 text-fat-200 ring-white/10 hover:bg-black/65",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setVisual((v) => ({ ...v, scanning: !v.scanning, meatColor: v.scanning ? null : "#b3232b" }))}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ring-1 backdrop-blur transition",
                visual.scanning ? "bg-amber-600/80 text-white ring-amber-400/50" : "bg-black/45 text-fat-200 ring-white/10 hover:bg-black/65",
              )}
            >
              <ScanLine className="h-3.5 w-3.5" /> Demo pengukuran
            </button>
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1">
            {[
              ["awal", "Awal"],
              ["depan", "Depan"],
              ["samping", "Samping"],
              ["belakang", "OLED"],
              ["atas", "Atas"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView((v) => ({ name: key, n: v.n + 1 }))}
                className="rounded-md bg-black/45 px-2 py-1 text-[10px] font-medium text-fat-200 ring-1 ring-white/10 backdrop-blur hover:bg-black/70"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <Card title="Jalur Pin" subtitle="Satu bus I2C untuk sensor & OLED" icon={<Cable className="h-4 w-4" />} bodyClassName="p-0">
            <table className="data-table w-full text-left text-[13px]">
              <thead>
                <tr>
                  <th>ESP32</th>
                  <th />
                  <th>Komponen</th>
                  <th>Sinyal</th>
                </tr>
              </thead>
              <tbody>
                {PIN_MAP.map((p, i) => (
                  <tr key={i}>
                    <td className="font-mono font-semibold text-fat-50">{p.from}</td>
                    <td>
                      <span className="block h-1 w-10 rounded-full" style={{ background: p.color }} />
                    </td>
                    <td className="text-fat-100">{p.to}</td>
                    <td
                      className={cn(
                        "font-mono font-semibold",
                        p.signal === "3V3"
                          ? "text-red-600 dark:text-red-400"
                          : p.signal === "SDA"
                            ? "text-blue-700 dark:text-blue-400"
                            : p.signal === "SCL"
                              ? "text-amber-700 dark:text-yellow-400"
                              : "text-slate-700 dark:text-slate-300",
                      )}
                    >
                      {p.signal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Komponen Utama" icon={<Cpu className="h-4 w-4" />}>
            <ul className="space-y-3 text-[13px] text-fat-200/85">
              <li className="flex gap-2.5">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-beef-300" />
                <div>
                  <div className="font-semibold text-fat-50">ESP32 DevKit</div>
                  <div className="text-xs text-fat-300/75">Membaca sensor warna, menjalankan scaling dan KNN, serta menampilkan hasil ke OLED lewat USB Serial atau WiFi.</div>
                </div>
              </li>
              <li className="flex gap-2.5">
                <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-beef-300" />
                <div>
                  <div className="font-semibold text-fat-50">TCS34725 (I2C 0x29)</div>
                  <div className="text-xs text-fat-300/75">Sensor warna RGB dengan LED bawaan. Untuk mematikan atau menyalakan LED fisik dari website, hubungkan 1 kabel jumper dari pin LED sensor ke pin INT sensor atau ke pin G25 ESP32.</div>
                </div>
              </li>
              <li className="flex gap-2.5">
                <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-beef-300" />
                <div>
                  <div className="font-semibold text-fat-50">OLED SSD1306 (I2C 0x3C)</div>
                  <div className="text-xs text-fat-300/75">Layar 128 x 64 piksel untuk menampilkan status alat dan hasil klasifikasi secara langsung.</div>
                </div>
              </li>
              <li className="flex gap-2.5">
                <Server className="mt-0.5 h-4 w-4 shrink-0 text-beef-300" />
                <div>
                  <div className="font-semibold text-fat-50">Supabase dan Model Fix ESP32</div>
                  <div className="text-xs text-fat-300/75">Supabase menyimpan dataset eksperimen yang masih berkembang. Dataset yang sudah final diekspor menjadi dataset_model.h untuk ditanam di ESP32.</div>
                </div>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Card
        title="Kalibrasi Warna 2 Titik (Putih dan Hitam)"
        subtitle="Simpan referensi kertas putih (255) dan gelap/hitam (0) secara permanen di memori ESP32 agar warna sensor akurat"
        icon={<ScanLine className="h-4 w-4" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d?.calibration?.white_ok ? "ok" : "warn"}>
              <StatusDot tone={d?.calibration?.white_ok ? "ok" : "warn"} />
              Putih: {d?.calibration?.white_ok ? "Aktif" : "Belum"}
            </Badge>
            <Badge tone={d?.calibration?.black_ok ? "ok" : "neutral"}>
              <StatusDot tone={d?.calibration?.black_ok ? "ok" : "neutral"} />
              Hitam: {d?.calibration?.black_ok ? "Aktif" : "Belum"}
            </Badge>
          </div>
        }
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1 text-xs text-fat-300/75">
            <div>
              1. Tempelkan tabung sensor pada <b className="text-fat-50">kertas putih bersih</b> lalu klik <b>Kalibrasi Putih (255)</b>.
            </div>
            <div>
              2. Tutup tabung pada <b className="text-fat-50">permukaan hitam/gelap</b> lalu klik <b>Kalibrasi Hitam (0)</b>.
            </div>
            {d?.calibration?.white_ok && (
              <div className="pt-1 font-mono text-[11px] text-fat-200/80">
                Ref Putih: ({d.calibration.white.map((v) => Math.round(v)).join(", ")})
                {d.calibration.black_ok ? ` | Ref Hitam: (${d.calibration.black.map((v) => Math.round(v)).join(", ")})` : ""}
              </div>
            )}
            {calMsg && (
              <div className={cn("pt-1 text-xs font-medium", calMsg.tone === "ok" ? "text-emerald-300" : "text-red-300")}>
                {calMsg.text}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={calBusy === "white"} onClick={() => void runCalibration("white")}>
              Kalibrasi Putih (255)
            </Button>
            <Button size="sm" variant="soft" loading={calBusy === "black"} onClick={() => void runCalibration("black")}>
              Kalibrasi Hitam (0)
            </Button>
            <Button size="sm" variant="outline" loading={calBusy === "reset"} onClick={() => void runCalibration("reset")}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Diagram Rangkaian" subtitle="Koneksi I2C antara ESP32, TCS34725, dan OLED SSD1306" icon={<Cable className="h-4 w-4" />}>
        <WiringDiagram />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card title="Langkah Pemasangan dan Update Dataset Fix" icon={<FileCode className="h-4 w-4" />}>
          <ol className="list-decimal space-y-2.5 pl-5 text-[13px] text-fat-200/85 marker:text-beef-400">
            <li>
              Buka Arduino IDE, pasang board <b className="text-fat-50">esp32 by Espressif</b> di Board Manager, lalu pilih <i>ESP32 Dev Module</i>.
            </li>
            <li>
              Pasang pustaka <b className="text-fat-50">Adafruit TCS34725</b>, <b className="text-fat-50">Adafruit SSD1306</b>, dan <b className="text-fat-50">Adafruit GFX</b> dari Library Manager.
            </li>
            <li>
              Simpan file firmware <code className="rounded bg-black/40 px-1">beef_fresh_esp32.ino</code> bersama file <code className="rounded bg-black/40 px-1">dataset_model.h</code> di folder{" "}
              <code className="rounded bg-black/40 px-1">firmware/beef_fresh_esp32/</code>.
            </li>
            <li>
              Saat dataset di Supabase bertambah atau diperbaiki, klik tombol <b className="text-fat-50">Ekspor dataset_model.h</b>. Ganti file lama di folder firmware, lalu upload ulang tanpa perlu mengubah kode alat atau OLED.
            </li>
            <li>
              Untuk mode nirkabel, isi <code className="rounded bg-black/40 px-1">WIFI_SSID</code> dan <code className="rounded bg-black/40 px-1">WIFI_PASSWORD</code>. Alamat server saat ini:{" "}
              <code className="rounded bg-black/40 px-1 text-beef-200">{origin || "localhost:3000"}</code>.
            </li>
            <li>
              Buka menu <b className="text-fat-50">CLI 3D</b> lalu jalankan <code className="rounded bg-black/40 px-1">sesi segar latih</code> untuk mengambil sampel baru, atau gunakan tombol{" "}
              <b className="text-fat-50">Analisa Daging</b> di dashboard.
            </li>
          </ol>
          <div className="mt-4 rounded-xl border border-line bg-black/25 p-3 text-xs text-fat-300/75">
            <div className="mb-1.5 font-semibold text-fat-100">Endpoint API perangkat</div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ok">GET</Badge>
                <span className="text-fat-100">/api/device/poll</span>
                <span className="font-sans text-fat-300/70">Heartbeat dan ambil perintah</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ok">GET</Badge>
                <span className="text-fat-100">/api/device/model</span>
                <span className="font-sans text-fat-300/70">Unduh dataset latih dan uji</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">POST</Badge>
                <span className="text-fat-100">/api/device/result</span>
                <span className="font-sans text-fat-300/70">Kirim hasil sampel, klasifikasi, atau benchmark</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">GET</Badge>
                <span className="text-fat-100">/api/samples/export-header</span>
                <span className="font-sans text-fat-300/70">Ekspor dataset_model.h siap tanam</span>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Firmware ESP32 (Arduino)"
          subtitle="beef_fresh_esp32.ino dengan tampilan OLED SSD1306 dan KNN aktif"
          icon={<FileCode className="h-4 w-4" />}
          actions={
            <>
              <Button size="sm" variant="primary" icon={<Cpu className="h-3.5 w-3.5" />} onClick={() => setConfirmDeploy(true)}>
                Tanam ke ESP32
              </Button>
              <a href="/api/samples/export-header">
                <Button size="sm" variant="soft" icon={<Download className="h-3.5 w-3.5" />}>
                  Unduh .h
                </Button>
              </a>
              <Button size="sm" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copy}>
                {copied ? "Tersalin" : "Salin"}
              </Button>
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={download} disabled={!code}>
                Unduh .ino
              </Button>
            </>
          }
          bodyClassName="p-0"
        >
          <pre className="surface-dark max-h-[520px] overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-fat-200/90">{finalCode || "Memuat kode firmware"}</pre>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDeploy}
        title="Tanam Model ke ESP32 Sekarang?"
        description={`Dataset "${ov?.activeDataset?.name ?? "Aktif"}" (${ov?.counts.train.total ?? 0} data latih, ${ov?.counts.test.total ?? 0} data uji, K=${ov?.settings.defaultK ?? 3}) akan ditulis ke dataset_model.h lalu dikompilasi dan diunggah ke ESP32. Jika Arduino CLI, Core ESP32, atau library belum ada di laptop ini, sistem akan mengunduhnya otomatis terlebih dahulu.`}
        confirmLabel="Mulai Tanam ke ESP32"
        tone="beef"
        onConfirm={() => {
          setConfirmDeploy(false);
          setDeployOpen(true);
        }}
        onCancel={() => setConfirmDeploy(false)}
      />
      <DeployModal
        open={deployOpen}
        datasetLabel={ov?.activeDataset?.name}
        port={selectedPort || ov?.device.usbPort || undefined}
        onClose={(succeeded) => {
          setDeployOpen(false);
          if (succeeded) {
            void refresh();
            void refreshToolchain();
          }
        }}
      />
    </div>
  );
}
