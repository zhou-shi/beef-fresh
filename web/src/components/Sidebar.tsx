"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Beef, Database, FlaskConical, LayoutDashboard, Microchip, Sparkles, SquareTerminal, Wifi, WifiOff } from "lucide-react";
import { usePoll } from "@/lib/client";
import { QUOTA, timeAgo } from "@/lib/constants";
import type { LiteOverview } from "@/lib/types";
import { cn } from "@/components/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cli", label: "CLI 3D", icon: SquareTerminal, badge: "Utama" },
  { href: "/dataset", label: "Dataset", icon: Database },
  { href: "/evaluasi", label: "Evaluasi KNN", icon: FlaskConical },
  { href: "/perangkat", label: "Perangkat", icon: Microchip },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data } = usePoll<LiteOverview>("/api/overview?lite=1", 5000);
  const online = !!data?.device.online;
  const sim = !!data?.settings.simulation;
  const train = data?.counts.train.total ?? 0;
  const test = data?.counts.test.total ?? 0;
  const trainQuota = data?.counts.quota?.train ?? QUOTA.train;
  const testQuota = data?.counts.quota?.test ?? QUOTA.test;
  const dsName = sim ? "Dataset Simulasi" : data?.activeDataset?.name ?? "Dataset Utama";

  return (
    <aside className="sticky top-0 z-40 flex shrink-0 flex-col border-b border-line bg-panel/92 backdrop-blur-md lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:py-5">
        <Link href="/" className="flex items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-beef-500 to-beef-800 shadow-[0_8px_24px_-6px_rgba(229,56,59,0.7)] ring-1 ring-white/10">
            <Beef className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-fat-50">Beef Fresh</div>
            <div className="text-[11px] text-fat-300/60">Deteksi Kesegaran Daging</div>
          </div>
        </Link>
        <div className="flex items-center gap-2 lg:hidden">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ring-1",
              sim
                ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800/60"
                : online
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800/60"
                  : "bg-black/5 text-fat-300/80 ring-line dark:bg-white/5 dark:text-fat-300/70 dark:ring-white/10",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", sim ? "bg-sky-500 dark:bg-sky-400" : online ? "bg-emerald-500 dark:bg-emerald-400" : "bg-fat-300/40")} />
            {sim ? "Simulasi" : online ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-linear-to-r from-beef-600 to-beef-700 text-white shadow-[0_6px_16px_-8px_rgba(196,30,42,0.75)] dark:from-beef-700/70 dark:to-beef-900/40 dark:shadow-[inset_0_0_0_1px_rgba(229,56,59,0.35)]"
                  : "text-fat-200/80 hover:bg-black/5 hover:text-fat-50 dark:text-fat-200/70 dark:hover:bg-white/5 dark:hover:text-fat-50",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-beef-100 dark:text-beef-200" : "text-fat-300/70 group-hover:text-beef-600 dark:text-fat-300/60 dark:group-hover:text-beef-300")} />
              <span>{item.label}</span>
              {item.badge && (
                <span className={cn(
                  "ml-auto hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold lg:inline",
                  active
                    ? "bg-white/20 text-white dark:bg-beef-500/20 dark:text-beef-200"
                    : "bg-beef-100 text-beef-700 dark:bg-beef-500/20 dark:text-beef-200",
                )}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden space-y-3 p-4 lg:block">
        <div className="rounded-xl border border-line bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-fat-300/50">ESP32</span>
            {online ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-fat-300/40" />}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", online ? "bg-emerald-400" : "bg-fat-300/30")} />
            </span>
            <span className="text-sm font-medium text-fat-50">{online ? "Online" : "Offline"}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-fat-300/50">
            {data?.device.everSeen ? `terakhir ${timeAgo(data.device.lastSeen)}` : "belum pernah terhubung"}
          </div>
          {sim && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800/50">
              <Sparkles className="h-3 w-3" /> Mode simulasi aktif
            </div>
          )}
        </div>
        <div className="rounded-xl border border-line bg-black/20 p-3 text-[12px]">
          <div className="truncate text-[11px] uppercase tracking-wider text-fat-300/50" title={dsName}>{dsName}</div>
          <div className="mt-2 space-y-2">
            {[
              { name: "Latih", n: train, q: trainQuota },
              { name: "Uji", n: test, q: testQuota },
            ].map((d) => (
              <div key={d.name}>
                <div className="flex justify-between text-fat-200/80">
                  <span>{d.name}</span>
                  <span className="font-mono">
                    {d.n}/{d.q}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-linear-to-r from-beef-600 to-beef-400" style={{ width: `${Math.min(100, (d.n / d.q) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
