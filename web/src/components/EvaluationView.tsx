"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Boxes, ChartColumn, ChartLine, Check, FlaskConical, Sigma, Table, Target, X } from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { K_OPTIONS, LABELS, LABEL_INFO, SCALINGS, SCALING_INFO, SPLIT_INFO, fmtNum, fmtPct, type Scaling } from "@/lib/constants";
import { FEATURE_NAMES, fitScaler, scaleVec, toVec, type EvalResult } from "@/lib/knn";
import type { EvaluationDTO, LiteOverview, SampleDTO } from "@/lib/types";
import type { ScatterPoint } from "@/components/three/Scatter3D";
import { AccuracyChart, KSweepChart, type AccuracyDatum } from "@/components/charts";
import { Button, Card, EmptyState, MetaItems, Segmented, cn } from "@/components/ui";

const Scatter3D = dynamic(() => import("@/components/three/Scatter3D"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-fat-300/60">Memuat visualisasi 3D</div>,
});

function ConfusionMatrix({ r }: { r: EvalResult }) {
  const max = Math.max(1, ...r.confusion.flat());
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: SCALING_INFO[r.method].textColor }}>
          {SCALING_INFO[r.method].name}
        </span>
        <MetaItems className="text-xs text-fat-300/60" items={[fmtPct(r.accuracy), `${r.correct}/${r.total}`]} />
      </div>
      <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-1 text-center text-xs">
        <div />
        {LABELS.map((l) => (
          <div key={l} className="truncate px-1 pb-1 text-[10px] text-fat-300/60">
            {LABEL_INFO[l].short}
          </div>
        ))}
        {LABELS.map((actual, i) => (
          <Fragment key={actual}>
            <div className="flex items-center pr-2 text-[10px] text-fat-300/60">{LABEL_INFO[actual].short}</div>
            {LABELS.map((pred, j) => {
              const v = r.confusion[i][j];
              const a = v / max;
              return (
                <div
                  key={pred}
                  className="grid aspect-[1.5] place-items-center rounded-lg font-mono text-sm font-semibold"
                  style={{
                    background: i === j ? `rgba(229,56,59,${0.12 + a * 0.6})` : v ? `rgba(244,162,97,${0.12 + a * 0.45})` : "rgba(255,255,255,0.03)",
                    color: v ? "#fff" : "rgba(255,255,255,0.3)",
                  }}
                >
                  {v}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="mt-1.5 text-[10px] text-fat-300/50">
        <MetaItems items={["Baris: kelas aktual", "Kolom: hasil prediksi"]} />
      </div>
    </div>
  );
}

export default function EvaluationView() {
  const { data: lite, refresh: refreshLite } = usePoll<LiteOverview>("/api/overview?lite=1", 8000);
  const [kSel, setKSel] = useState<number | null>(null);
  const [savingK, setSavingK] = useState(false);
  const k = kSel ?? lite?.settings.defaultK ?? 3;
  const mv = lite?.settings.modelVersion;
  const { data: ev, loading } = usePoll<EvaluationDTO>(mv != null ? `/api/evaluation?k=${k}&v=${mv}` : null, 60000);
  const { data: ds } = usePoll<{ samples: SampleDTO[] }>(mv != null ? `/api/samples?limit=5000&v=${mv}` : null, 60000);
  const [space, setSpace] = useState<Scaling>("minmax");
  const [detail, setDetail] = useState<Scaling>("minmax");
  const methods = ev?.methods;

  const scatterPoints = useMemo<ScatterPoint[]>(() => {
    const samples = ds?.samples ?? [];
    if (!samples.length) return [];
    const params = methods?.[space]?.params ?? fitScaler(samples.filter((s) => s.split === "train"), space);
    const wrong = new Set((methods?.[space]?.predictions ?? []).filter((p) => !p.correct).map((p) => p.id));
    return samples.map((s) => {
      const fv = toVec(s);
      const sv = scaleVec(fv, params);
      return {
        id: s.id,
        v: [sv[0], sv[1], sv[3]] as [number, number, number],
        color: LABEL_INFO[s.label]?.color ?? "#999",
        test: s.split === "test",
        wrong: s.split === "test" && wrong.has(s.id),
        title: `#${s.id} ${LABEL_INFO[s.label]?.name} (${SPLIT_INFO[s.split]?.short}) RGB(${s.r.toFixed(0)}, ${s.g.toFixed(0)}, ${s.b.toFixed(0)}) | r=${fv[0].toFixed(3)}, L=${fv[3].toFixed(1)}`,
      };
    });
  }, [ds, methods, space]);

  const accData: AccuracyDatum[] = methods
    ? SCALINGS.map((m) => ({
        key: m,
        name: SCALING_INFO[m].name,
        accuracy: +(methods[m].accuracy * 100).toFixed(2),
        f1: +(methods[m].macroF1 * 100).toFixed(2),
        accLabel: fmtPct(methods[m].accuracy),
      }))
    : [];

  const bestAcc = methods ? Math.max(...SCALINGS.map((m) => methods[m].accuracy)) : 0;
  const example = methods?.minmax.predictions[0];
  const mm = methods?.minmax.params;
  const zs = methods?.zscore.params;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-beef-300/80">
            <FlaskConical className="h-4 w-4" /> Evaluasi
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-fat-50">Evaluasi Feature Scaling dan Akurasi KNN</h1>
          <p className="mt-1 max-w-3xl text-sm text-fat-300/70">
            Nilai RGB sensor diekstrak menjadi 4 fitur (r = R/Σ, g = G/Σ, b = B/Σ, dan kecerahan L = Rata2) agar tahan variasi pencahayaan. Parameter scaling dihitung dari data latih tanpa kebocoran data, identik dengan firmware ESP32.
          </p>
        </div>
        <div className="shrink-0">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-fat-300/60">
            <MetaItems items={["Nilai K", loading && "Memuat"]} />
            {lite?.settings && k !== lite.settings.defaultK && (
              <button
                type="button"
                disabled={savingK}
                onClick={async () => {
                  setSavingK(true);
                  try {
                    await api("/api/settings", { method: "PUT", json: { defaultK: k } });
                    await refreshLite();
                  } finally {
                    setSavingK(false);
                  }
                }}
                className="rounded-md bg-beef-600/25 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-beef-200 ring-1 ring-beef-500/40 hover:bg-beef-600/40 disabled:opacity-50"
              >
                {savingK ? "Menyimpan..." : `Jadikan K=${k} Default`}
              </button>
            )}
          </div>
          <Segmented<number> value={k} onChange={setKSel} options={K_OPTIONS.map((x) => ({ value: x, label: String(x) }))} />
        </div>
      </div>

      {!ev?.ready || !methods ? (
        <EmptyState
          icon={<FlaskConical className="h-5 w-5" />}
          title="Dataset belum cukup untuk evaluasi"
          desc={`Dibutuhkan data latih dan data uji. Saat ini ${ev?.trainCount ?? 0} data latih dan ${ev?.testCount ?? 0} data uji.`}
          action={
            <Link href="/cli">
              <Button variant="primary">Ambil dataset via CLI 3D</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {SCALINGS.map((m) => {
              const r = methods[m];
              const best = r.accuracy === bestAcc;
              return (
                <div key={m} className={cn("card relative overflow-hidden p-5", best && "ring-1 ring-beef-500/60")}>
                  <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{ background: SCALING_INFO[m].color }} />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: SCALING_INFO[m].textColor }}>
                      {SCALING_INFO[m].name}
                    </span>
                    {best && <span className="rounded-full bg-beef-600/30 px-2 py-0.5 text-[10px] font-semibold text-beef-200">TERBAIK</span>}
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-fat-300/60">{SCALING_INFO[m].formula}</div>
                  <div className="mt-3 text-4xl font-black tracking-tight text-fat-50">{fmtPct(r.accuracy)}</div>
                  <div className="mt-1 text-xs text-fat-300/65">
                    <MetaItems items={[`${r.correct}/${r.total} data uji benar`, `K = ${k}`]} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line/70 pt-3 text-center">
                    {[
                      ["Presisi", r.macroPrecision],
                      ["Recall", r.macroRecall],
                      ["F1", r.macroF1],
                      ["CV-5", ev.cv?.[m] ?? null],
                    ].map(([name, v]) => (
                      <div key={name as string}>
                        <div className="text-[10px] uppercase tracking-wider text-fat-300/50">{name}</div>
                        <div className="font-mono text-sm text-fat-100">{fmtPct(v as number | null)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={`Akurasi & F1 per metode (K = ${k})`} icon={<ChartColumn className="h-4 w-4" />}>
              <AccuracyChart data={accData} />
            </Card>
            <Card
              title="Akurasi vs nilai K"
              subtitle={ev.best ? `Terbaik: ${SCALING_INFO[ev.best.method].name}, K = ${ev.best.k} (${fmtPct(ev.best.accuracy)})` : undefined}
              icon={<ChartLine className="h-4 w-4" />}
            >
              {ev.sweep && <KSweepChart data={ev.sweep} k={k} />}
            </Card>
          </div>

          <Card title="Confusion Matrix" subtitle={<MetaItems items={[`Data uji (${ev.testCount} sampel)`, `K = ${k}`]} />} icon={<Target className="h-4 w-4" />}>
            <div className="grid gap-6 md:grid-cols-3">
              {SCALINGS.map((m) => (
                <ConfusionMatrix key={m} r={methods[m]} />
              ))}
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Card
              title="Visualisasi 3D Ruang Fitur (r, g, L)"
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-fat-200" /> Data latih
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rotate-45 bg-fat-200" /> Data uji
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" /> Salah klasifikasi
                  </span>
                </span>
              }
              icon={<Boxes className="h-4 w-4" />}
              actions={<Segmented<Scaling> value={space} onChange={setSpace} options={SCALINGS.map((m) => ({ value: m, label: SCALING_INFO[m].short }))} />}
              bodyClassName="p-0"
            >
              <div className="surface-dark relative h-[440px]">
                {scatterPoints.length ? (
                  <Scatter3D
                    points={scatterPoints}
                    axes={
                      space === "none"
                        ? ["r (R/Σ)", "g (G/Σ)", "L (Rata2)"]
                        : space === "minmax"
                          ? ["r (0-1)", "g (0-1)", "L (0-1)"]
                          : ["r (z)", "g (z)", "L (z)"]
                    }
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm text-fat-300/60">Memuat data</div>
                )}
                <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
                  {LABELS.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-fat-100 ring-1 ring-white/10">
                      <span className="h-2 w-2 rounded-full" style={{ background: LABEL_INFO[l].color }} />
                      {LABEL_INFO[l].name}
                    </span>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Parameter Feature Scaling" subtitle={`Di-fit dari ${ev.trainCount} data latih (dihitung ulang juga di ESP32)`} icon={<Sigma className="h-4 w-4" />}>
              {mm && zs && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-left text-xs">
                      <thead>
                        <tr>
                          <th>Fitur</th>
                          <th>Min</th>
                          <th>Max</th>
                          <th>Rata-rata</th>
                          <th>Simpangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {FEATURE_NAMES.map((ch, j) => {
                          const dec = j < 3 ? 4 : 2;
                          const cls =
                            j === 0
                              ? "text-red-600 dark:text-red-400"
                              : j === 1
                                ? "text-emerald-700 dark:text-emerald-400"
                                : j === 2
                                  ? "text-blue-700 dark:text-blue-400"
                                  : "text-amber-600 dark:text-amber-400";
                          return (
                            <tr key={ch}>
                              <td className={cn("font-semibold", cls)}>{ch}</td>
                              <td className="font-mono">{fmtNum(mm.min[j], dec)}</td>
                              <td className="font-mono">{fmtNum(mm.max[j], dec)}</td>
                              <td className="font-mono">{fmtNum(zs.mean[j], dec)}</td>
                              <td className="font-mono">{fmtNum(zs.std[j], dec)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {example && (() => {
                    const exVec = toVec(example);
                    const exMm = scaleVec(exVec, mm);
                    const exZs = scaleVec(exVec, zs);
                    return (
                      <div className="rounded-xl border border-line bg-black/25 p-3 font-mono text-[11.5px] leading-relaxed text-fat-200/85">
                        <div className="mb-1 font-sans text-[11px] uppercase tracking-wider text-fat-300/55">Contoh perhitungan (data uji #{example.id})</div>
                        <div>
                          RGB asli = ({fmtNum(example.r)}, {fmtNum(example.g)}, {fmtNum(example.b)})
                        </div>
                        <div>
                          Fitur (r, g, b, L) = ({fmtNum(exVec[0], 4)}, {fmtNum(exVec[1], 4)}, {fmtNum(exVec[2], 4)}, {fmtNum(exVec[3], 2)})
                        </div>
                        <div style={{ color: SCALING_INFO.minmax.textColor }}>
                          r<sub>minmax</sub> = ({fmtNum(exVec[0], 4)} - {fmtNum(mm.min[0], 4)}) / ({fmtNum(mm.max[0], 4)} - {fmtNum(mm.min[0], 4)}) ={" "}
                          {fmtNum(exMm[0], 4)}
                        </div>
                        <div style={{ color: SCALING_INFO.zscore.textColor }}>
                          r<sub>zscore</sub> = ({fmtNum(exVec[0], 4)} - {fmtNum(zs.mean[0], 4)}) / {fmtNum(zs.std[0], 4)} = {fmtNum(exZs[0], 4)}
                        </div>
                        <div className="mt-1 space-y-0.5 text-fat-300/60">
                          <div>Vektor Min-Max = ({exMm.map((x) => fmtNum(x, 3)).join(", ")})</div>
                          <div>Vektor Z-Score = ({exZs.map((x) => fmtNum(x, 3)).join(", ")})</div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-1.5 text-xs text-fat-300/70">
                    {SCALINGS.map((m) => (
                      <div key={m}>
                        <span className="font-semibold" style={{ color: SCALING_INFO[m].textColor }}>
                          {SCALING_INFO[m].name}:
                        </span>{" "}
                        {SCALING_INFO[m].desc}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Metrik per Kelas"
            icon={<Table className="h-4 w-4" />}
            actions={<Segmented<Scaling> value={detail} onChange={setDetail} options={SCALINGS.map((m) => ({ value: m, label: SCALING_INFO[m].short }))} />}
          >
            <div className="overflow-x-auto">
              <table className="data-table w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Kelas</th>
                    <th>Presisi</th>
                    <th>Recall</th>
                    <th>F1-score</th>
                    <th>Support</th>
                  </tr>
                </thead>
                <tbody>
                  {methods[detail].perClass.map((c) => (
                    <tr key={c.label}>
                      <td style={{ color: LABEL_INFO[c.label].textColor }} className="font-medium">
                        {LABEL_INFO[c.label].name}
                      </td>
                      <td className="font-mono">{fmtPct(c.precision)}</td>
                      <td className="font-mono">{fmtPct(c.recall)}</td>
                      <td className="font-mono">{fmtPct(c.f1)}</td>
                      <td className="font-mono">{c.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Prediksi Data Uji" subtitle="Perbandingan hasil tiap metode untuk setiap sampel uji" icon={<Table className="h-4 w-4" />} bodyClassName="p-0">
            <div className="max-h-[520px] overflow-auto">
              <table className="data-table w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-panel">
                  <tr>
                    <th>ID</th>
                    <th>RGB</th>
                    <th>Aktual</th>
                    {SCALINGS.map((m) => (
                      <th key={m} style={{ color: SCALING_INFO[m].textColor }}>
                        {SCALING_INFO[m].short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {methods.none.predictions.map((p, i) => (
                    <tr key={p.id ?? i}>
                      <td className="font-mono text-fat-300/60">#{p.id}</td>
                      <td className="font-mono">
                        ({Math.round(p.r)}, {Math.round(p.g)}, {Math.round(p.b)})
                      </td>
                      <td style={{ color: LABEL_INFO[p.actual].textColor }} className="font-medium">{LABEL_INFO[p.actual].name}</td>
                      {SCALINGS.map((m) => {
                        const q = methods[m].predictions[i];
                        return (
                          <td key={m} className={q?.correct ? "text-emerald-300" : "text-red-300"}>
                            <span className="inline-flex items-center gap-1">
                              {q?.correct ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                              {q ? LABEL_INFO[q.predicted].short : "-"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
