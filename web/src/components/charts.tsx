"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SCALINGS, SCALING_INFO, fmtTime, type Scaling } from "@/lib/constants";
import type { BenchmarkDTO, ClassificationDTO, SweepRow } from "@/lib/types";

const TICK = { fill: "var(--chart-tick)", fontSize: 11 };
const GRID = "var(--chart-grid)";
const AXIS_LINE = { stroke: "var(--chart-axis)" };
const tooltipProps = {
  contentStyle: {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    borderRadius: 12,
    color: "var(--chart-tooltip-text)",
    fontSize: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,.22)",
  },
  labelStyle: { color: "var(--chart-tooltip-title)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "var(--chart-tooltip-text)" },
};
const legendStyle = { fontSize: 12, color: "var(--chart-legend)" };

export interface AccuracyDatum {
  key: Scaling;
  name: string;
  accuracy: number;
  f1: number;
  accLabel: string;
}

export function AccuracyChart({ data, height = 280 }: { data: AccuracyDatum[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 28, right: 12, left: -6, bottom: 4 }} barGap={6}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={TICK} axisLine={AXIS_LINE} tickLine={false} />
        <YAxis domain={[0, 100]} tick={TICK} axisLine={false} tickLine={false} unit="%" width={48} />
        <Tooltip {...tooltipProps} cursor={{ fill: "rgba(229,56,59,0.08)" }} formatter={(v) => `${Number(v).toFixed(2)}%`} />
        <Legend wrapperStyle={legendStyle} />
        <Bar dataKey="accuracy" name="Akurasi" fill="#e5383b" radius={[8, 8, 0, 0]} maxBarSize={60}>
          {data.map((d) => (
            <Cell key={d.key} fill={SCALING_INFO[d.key].color} />
          ))}
          <LabelList dataKey="accLabel" position="top" fill="var(--chart-bar-label)" fontSize={12} fontWeight={600} />
        </Bar>
        <Bar dataKey="f1" name="Macro F1-score" fill="var(--chart-secondary-bar)" radius={[8, 8, 0, 0]} maxBarSize={60} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function KSweepChart({ data, k, height = 280 }: { data: SweepRow[]; k: number; height?: number }) {
  const [visible, setVisible] = useState<Record<string, boolean>>({ none: true, minmax: true, zscore: true });
  const rows = data.map((d) => ({ k: d.k, none: d.none * 100, minmax: d.minmax * 100, zscore: d.zscore * 100 }));

  const activeMethods = SCALINGS.filter((m) => visible[m]);
  const allVisible = activeMethods.length === SCALINGS.length;

  // Cek apakah dua garis yang sedang aktif memiliki nilai akurasi yang persis sama di semua K
  const sameSeries = (a: (typeof SCALINGS)[number], b: (typeof SCALINGS)[number]) =>
    rows.length > 0 && rows.every((r) => Math.abs(r[a] - r[b]) < 0.01);

  const overlappedUnder = new Set<string>();
  for (let i = 0; i < activeMethods.length; i++) {
    for (let j = i + 1; j < activeMethods.length; j++) {
      if (sameSeries(activeMethods[i], activeMethods[j])) {
        overlappedUnder.add(activeMethods[i]);
      }
    }
  }

  function toggleLine(m: string) {
    setVisible((prev) => {
      const next = { ...prev, [m]: !prev[m] };
      // Pastikan minimal 1 garis tetap tampil agar grafik tidak kosong
      if (!Object.values(next).some(Boolean)) return prev;
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCALINGS.map((m) => {
            const on = visible[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleLine(m)}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
                style={{
                  borderColor: on ? `${SCALING_INFO[m].color}88` : "var(--color-line)",
                  backgroundColor: on ? `${SCALING_INFO[m].color}1f` : "transparent",
                  color: on ? "var(--color-fat-50)" : "var(--color-fat-300)",
                  opacity: on ? 1 : 0.65,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full transition"
                  style={{ backgroundColor: on ? SCALING_INFO[m].color : "var(--color-line)" }}
                />
                {SCALING_INFO[m].name}
              </button>
            );
          })}
          {!allVisible && (
            <button
              type="button"
              onClick={() => setVisible({ none: true, minmax: true, zscore: true })}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-fat-200 hover:bg-white/10"
            >
              Tampilkan semua
            </button>
          )}
        </div>
        {overlappedUnder.size > 0 && (
          <span className="text-[11px] text-fat-300/60">
            Ada garis bernilai sama (klik label untuk menyembunyikan)
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 12, right: 16, left: -6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="k" tick={TICK} axisLine={AXIS_LINE} tickLine={false} label={{ value: "Nilai K", position: "insideBottomRight", offset: -2, fill: "var(--chart-axis-label)", fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={TICK} axisLine={false} tickLine={false} unit="%" width={48} />
          <Tooltip {...tooltipProps} labelFormatter={(l) => `K = ${l}`} formatter={(v) => `${Number(v).toFixed(2)}%`} />
          <ReferenceLine x={k} stroke="var(--chart-ref-line)" strokeDasharray="4 4" strokeOpacity={0.5} />
          {activeMethods.map((m) => {
            const isUnderExactOverlap = overlappedUnder.has(m);
            return (
              <Line
                key={m}
                type="monotone"
                dataKey={m}
                name={SCALING_INFO[m].name}
                stroke={SCALING_INFO[m].color}
                strokeWidth={isUnderExactOverlap ? 5 : 2.5}
                dot={{ r: isUnderExactOverlap ? 5 : 3.5, strokeWidth: 0, fill: SCALING_INFO[m].color }}
                activeDot={{ r: 5.5 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function benchData(rows: BenchmarkDTO[]) {
  return SCALINGS.map((m) => {
    const r = rows.find((x) => x.scaling === m);
    return {
      key: m,
      name: SCALING_INFO[m].short,
      scale: r?.scaleUs ?? 0,
      knn: r?.knnUs ?? Math.max(0, (r?.avgUs ?? 0) - (r?.scaleUs ?? 0)),
      avg: r?.avgUs ?? 0,
      avgLabel: r ? `${r.avgUs.toFixed(1)} µs` : "",
      mem: r?.memBytes ?? 0,
      memLabel: r?.memBytes != null ? `${r.memBytes} B` : "",
      model: r?.modelBytes ?? 0,
    };
  });
}

export function ExecTimeChart({ rows, height = 240 }: { rows: BenchmarkDTO[]; height?: number }) {
  const data = benchData(rows);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 26, right: 8, left: -4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={TICK} axisLine={AXIS_LINE} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" µs" width={60} />
        <Tooltip {...tooltipProps} cursor={{ fill: "rgba(229,56,59,0.08)" }} formatter={(v) => `${Number(v).toFixed(2)} µs`} />
        <Legend wrapperStyle={legendStyle} />
        <Bar dataKey="scale" stackId="t" name="Feature scaling" fill="#f4a261" maxBarSize={56} />
        <Bar dataKey="knn" stackId="t" name="KNN (jarak + voting)" fill="#e5383b" radius={[8, 8, 0, 0]} maxBarSize={56}>
          <LabelList dataKey="avgLabel" position="top" fill="var(--chart-bar-label)" fontSize={11} fontWeight={600} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MemoryChart({ rows, height = 240 }: { rows: BenchmarkDTO[]; height?: number }) {
  const data = benchData(rows);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 26, right: 8, left: -4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={TICK} axisLine={AXIS_LINE} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} unit=" B" width={60} />
        <Tooltip {...tooltipProps} cursor={{ fill: "rgba(229,56,59,0.08)" }} formatter={(v) => `${Number(v).toFixed(0)} byte`} />
        <Legend wrapperStyle={legendStyle} />
        <Bar dataKey="mem" name="Heap inferensi (byte)" fill="#c41e2a" radius={[8, 8, 0, 0]} maxBarSize={56}>
          {data.map((d) => (
            <Cell key={d.key} fill={SCALING_INFO[d.key].color} />
          ))}
          <LabelList dataKey="memLabel" position="top" fill="var(--chart-bar-label)" fontSize={11} fontWeight={600} />
        </Bar>
        <Bar dataKey="model" name="Dataset di RAM (byte)" fill="var(--chart-ram-bar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExecTrendChart({ history, height = 220 }: { history: ClassificationDTO[]; height?: number }) {
  const data = [...history]
    .reverse()
    .filter((c) => c.execUs != null)
    .map((c) => ({ time: fmtTime(c.createdAt), execUs: c.execUs ?? 0, memBytes: c.memBytes ?? 0, scaling: SCALING_INFO[c.scaling]?.short ?? c.scaling }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 4, left: -4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="time" tick={TICK} axisLine={AXIS_LINE} tickLine={false} minTickGap={24} />
        <YAxis yAxisId="t" tick={TICK} axisLine={false} tickLine={false} unit=" µs" width={60} />
        <YAxis yAxisId="m" orientation="right" tick={TICK} axisLine={false} tickLine={false} unit=" B" width={56} />
        <Tooltip {...tooltipProps} />
        <Legend wrapperStyle={legendStyle} />
        <Line yAxisId="t" type="monotone" dataKey="execUs" name="Waktu eksekusi (µs)" stroke="#e5383b" strokeWidth={2.5} dot={{ r: 2.5 }} />
        <Line yAxisId="m" type="stepAfter" dataKey="memBytes" name="Memori (byte)" stroke="#f4a261" strokeWidth={2} dot={false} strokeDasharray="5 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}
