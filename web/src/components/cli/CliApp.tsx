"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, DoorOpen, Eye, Lightbulb, Rotate3d, ScanEye, Sparkles, Wifi, WifiOff } from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { LABELS, LABEL_INFO, QUOTA, QUOTA_PER_CLASS, SPLITS, SPLIT_INFO, timeAgo } from "@/lib/constants";
import { DEFAULT_VISUAL, type DeviceVisual } from "@/lib/device-visual";
import type { CountsDTO, LiteOverview } from "@/lib/types";
import OledScreen from "@/components/OledScreen";
import { Badge, MetaItems, cn } from "@/components/ui";
import Terminal from "./Terminal";

const DeviceScene = dynamic(() => import("@/components/three/DeviceScene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-fat-300/60">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-beef-700 border-t-beef-300" />
        Memuat model 3D alat
      </div>
    </div>
  ),
});

type Patch = Partial<DeviceVisual> | ((v: DeviceVisual) => Partial<DeviceVisual>);

function ProgressHud({ counts }: { counts?: CountsDTO }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SPLITS.map((split) => {
        const sQuota = split === "train" ? counts?.quota?.train ?? QUOTA.train : counts?.quota?.test ?? QUOTA.test;
        const cQuota = split === "train" ? counts?.quota?.trainPerClass ?? QUOTA_PER_CLASS.train : counts?.quota?.testPerClass ?? QUOTA_PER_CLASS.test;
        return (
          <div key={split} className="rounded-xl border border-line bg-black/25 px-3 py-1.5">
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-fat-300/55">
              <span>{SPLIT_INFO[split].name}</span>
              <span className="font-mono text-fat-100">
                {counts?.[split].total ?? 0}/{sQuota}
              </span>
            </div>
            <div className="mt-1 flex gap-1.5">
              {LABELS.map((l) => {
                const n = counts?.[split][l] ?? 0;
                return (
                  <div key={l} className="w-14 sm:w-16" title={`${LABEL_INFO[l].name}: ${n}/${cQuota}`}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (n / cQuota) * 100)}%`, background: LABEL_INFO[l].color }} />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] text-fat-300/55">
                      <span>{LABEL_INFO[l].short}</span>
                      <span className="font-mono">{n}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CliApp() {
  const { data: overview, refresh } = usePoll<LiteOverview>("/api/overview?lite=1", 3000);
  const [visual, setVisualState] = useState<DeviceVisual>({ ...DEFAULT_VISUAL, labels: false });
  const [view, setView] = useState({ name: "awal", n: 0 });

  const setVisual = useCallback((patch: Patch) => {
    setVisualState((v) => ({ ...v, ...(typeof patch === "function" ? patch(v) : patch) }));
  }, []);
  const onView = useCallback((name: string) => setView((v) => ({ name, n: v.n + 1 })), []);

  // Sinkronkan tampilan OLED 3D & 2D dengan layar OLED fisik ESP32 saat idle
  const syncedOledKey = overview?.device.oledLines?.join("\n") ?? "";
  useEffect(() => {
    const lines = overview?.device.oledLines;
    if (lines?.length) {
      setVisualState((v) => (v.scanning ? v : { ...v, oled: lines }));
    }
  }, [syncedOledKey]);

  const sim = !!overview?.settings.simulation;
  const online = !!overview?.device.online;

  const tools = [
    { key: "rot", icon: Rotate3d, label: "Putar", active: visual.autoRotate, onClick: () => setVisual((v) => ({ autoRotate: !v.autoRotate })) },
    { key: "xray", icon: ScanEye, label: "X-Ray", active: visual.xray, onClick: () => setVisual((v) => ({ xray: !v.xray })) },
    { key: "lid", icon: DoorOpen, label: visual.lidOpen ? "Tutup" : "Buka", active: visual.lidOpen, onClick: () => setVisual((v) => ({ lidOpen: !v.lidOpen })) },
    { key: "lbl", icon: Eye, label: "Label", active: visual.labels, onClick: () => setVisual((v) => ({ labels: !v.labels })) },
    {
      key: "led",
      icon: Lightbulb,
      label: "LED",
      active: visual.led,
      onClick: () =>
        setVisual((v) => {
          const next = !v.led;
          void api("/api/device/led", { method: "POST", json: { on: next } }).catch(() => {});
          return { led: next };
        }),
    },
  ];
  const cams = [
    { key: "awal", label: "Awal" },
    { key: "depan", label: "Depan" },
    { key: "samping", label: "Samping" },
    { key: "belakang", label: "OLED" },
    { key: "atas", label: "Atas" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3 lg:h-dvh lg:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-fat-50">
            CLI 3D Interaktif <Badge tone="beef">Kontrol pengambilan dataset</Badge>
            {sim && (
              <Badge tone="info">
                <Sparkles className="h-3 w-3" /> Simulasi
              </Badge>
            )}
          </h1>
          <p className="text-xs text-fat-300/60">
            <MetaItems items={["Kendalikan ESP32 lewat terminal", "Target 144 data latih dan 36 data uji", "Kontrol alat terpusat"]} />
          </p>
        </div>
        <ProgressHud counts={overview?.counts} />
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <section className="card surface-dark relative h-[46vh] min-h-[340px] overflow-hidden lg:h-auto">
          <div className="marbling pointer-events-none absolute inset-0 opacity-60" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(229,56,59,0.10),transparent_60%)]" />
          <DeviceScene visual={visual} view={view} />

          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 backdrop-blur",
                online ? "bg-emerald-950/70 text-emerald-300 ring-emerald-800/60" : "bg-black/50 text-fat-300/70 ring-white/10",
              )}
            >
              {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <MetaItems items={[`ESP32 ${online ? "online" : "offline"}`, overview?.device.everSeen && !online && timeAgo(overview.device.lastSeen)]} />
            </span>
            {visual.scanning && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-950/70 px-2.5 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-700/50 backdrop-blur">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-300" /> Sensor membaca warna
              </span>
            )}
            {visual.xray && (
              <div className="w-fit rounded-lg bg-black/60 px-2.5 py-1.5 text-[10px] text-fat-100 ring-1 ring-white/10 backdrop-blur">
                {[
                  ["#ef4444", "3V3", "VIN / VCC"],
                  ["#9ca3af", "GND", "GND"],
                  ["#3b82f6", "G26", "SDA"],
                  ["#facc15", "G27", "SCL"],
                ].map(([c, src, dst]) => (
                  <div key={src} className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded" style={{ background: c }} />
                    <span>{src}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-fat-300/60" />
                    <span>{dst}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            {tools.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={t.onClick}
                  title={t.label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ring-1 backdrop-blur transition",
                    t.active ? "bg-beef-600/80 text-white ring-beef-400/50" : "bg-black/45 text-fat-200 ring-white/10 hover:bg-black/65",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="absolute bottom-3 left-3">
            <OledScreen lines={visual.oled} />
          </div>

          <div className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-1">
            {cams.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onView(c.key)}
                className="rounded-md bg-black/45 px-2 py-1 text-[10px] font-medium text-fat-200 ring-1 ring-white/10 backdrop-blur hover:bg-black/70"
              >
                {c.label}
              </button>
            ))}
          </div>
        </section>

        <Terminal overview={overview} refreshOverview={refresh} setVisual={setVisual} onView={onView} />
      </div>
    </div>
  );
}
