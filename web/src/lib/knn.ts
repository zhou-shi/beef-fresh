import { LABELS, SCALINGS, type Label, type Scaling } from "./constants";

/**
 * Implementasi KNN + Feature Scaling.
 * Logika IDENTIK dengan firmware ESP32 (fit scaler dari data latih, jarak Euclidean,
 * voting mayoritas, tie-break = kelas tetangga terdekat) sehingga akurasi server == akurasi alat.
 */

export interface DataPoint {
  id?: number;
  r: number;
  g: number;
  b: number;
  label: Label;
}

export interface ScalerParams {
  method: Scaling;
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
}

export interface Neighbor {
  index: number;
  id?: number;
  distance: number;
  label: Label;
}

export interface Prediction {
  label: Label;
  votes: number[];
  neighbors: Neighbor[];
  scaled: number[];
}

export const toVec = (p: { r: number; g: number; b: number }) => [p.r, p.g, p.b];

/** Fit: hitung parameter scaling (min, max, mean, std populasi) dari data latih */
export function fitScaler(train: Array<{ r: number; g: number; b: number }>, method: Scaling): ScalerParams {
  const n = train.length;
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  const mean = [0, 0, 0];
  const std = [0, 0, 0];
  if (n === 0) return { method, min, max, mean, std };
  for (let j = 0; j < 3; j++) {
    const col = train.map((p) => toVec(p)[j]);
    min[j] = Math.min(...col);
    max[j] = Math.max(...col);
    mean[j] = col.reduce((a, b) => a + b, 0) / n;
    std[j] = Math.sqrt(col.reduce((a, b) => a + (b - mean[j]) ** 2, 0) / n);
  }
  return { method, min, max, mean, std };
}

/** Transform: terapkan feature scaling ke satu vektor RGB */
export function scaleVec(v: number[], p: ScalerParams): number[] {
  return v.map((x, j) => {
    if (p.method === "minmax") {
      const range = p.max[j] - p.min[j];
      return (x - p.min[j]) / (range > 0 ? range : 1);
    }
    if (p.method === "zscore") {
      const s = p.std[j];
      return (x - p.mean[j]) / (s > 0 ? s : 1);
    }
    return x;
  });
}

export function euclidean(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export class KnnModel {
  readonly params: ScalerParams;
  private readonly X: number[][];
  private readonly y: Label[];
  private readonly ids: Array<number | undefined>;

  constructor(train: DataPoint[], method: Scaling) {
    this.params = fitScaler(train, method);
    this.X = train.map((p) => scaleVec(toVec(p), this.params));
    this.y = train.map((p) => p.label);
    this.ids = train.map((p) => p.id);
  }

  get size() {
    return this.X.length;
  }

  predict(p: { r: number; g: number; b: number }, k: number): Prediction {
    if (this.X.length === 0) throw new Error("Dataset latih kosong");
    const q = scaleVec(toVec(p), this.params);
    const all: Neighbor[] = this.X.map((x, i) => ({
      index: i,
      id: this.ids[i],
      distance: euclidean(x, q),
      label: this.y[i],
    }));
    all.sort((a, b) => a.distance - b.distance || a.index - b.index);
    const kk = Math.max(1, Math.min(Math.round(k), all.length));
    const neighbors = all.slice(0, kk);
    const votes = LABELS.map(() => 0);
    for (const n of neighbors) votes[LABELS.indexOf(n.label)]++;
    const maxV = Math.max(...votes);
    const tied = LABELS.filter((_, i) => votes[i] === maxV);
    let label = tied[0];
    if (tied.length > 1) {
      const nearestTied = neighbors.find((n) => tied.includes(n.label));
      if (nearestTied) label = nearestTied.label;
    }
    return { label, votes, neighbors, scaled: q };
  }
}

export interface ClassMetric {
  label: Label;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface PredictionRow {
  id?: number;
  r: number;
  g: number;
  b: number;
  actual: Label;
  predicted: Label;
  correct: boolean;
  scaled: number[];
  votes: number[];
}

export interface EvalResult {
  method: Scaling;
  k: number;
  accuracy: number;
  correct: number;
  total: number;
  confusion: number[][];
  perClass: ClassMetric[];
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  params: ScalerParams;
  predictions: PredictionRow[];
}

function evaluateModel(model: KnnModel, test: DataPoint[], method: Scaling, k: number): EvalResult {
  const confusion = LABELS.map(() => LABELS.map(() => 0));
  const predictions: PredictionRow[] = test.map((t) => {
    const p = model.predict(t, k);
    confusion[LABELS.indexOf(t.label)][LABELS.indexOf(p.label)]++;
    return {
      id: t.id,
      r: t.r,
      g: t.g,
      b: t.b,
      actual: t.label,
      predicted: p.label,
      correct: p.label === t.label,
      scaled: p.scaled,
      votes: p.votes,
    };
  });
  const correct = predictions.filter((p) => p.correct).length;
  const perClass: ClassMetric[] = LABELS.map((label, i) => {
    const tp = confusion[i][i];
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < LABELS.length; j++) {
      if (j !== i) {
        fp += confusion[j][i];
        fn += confusion[i][j];
      }
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision, recall, f1, support: tp + fn };
  });
  const avg = (key: "precision" | "recall" | "f1") => perClass.reduce((a, c) => a + c[key], 0) / perClass.length;
  return {
    method,
    k,
    accuracy: test.length ? correct / test.length : 0,
    correct,
    total: test.length,
    confusion,
    perClass,
    macroPrecision: avg("precision"),
    macroRecall: avg("recall"),
    macroF1: avg("f1"),
    params: model.params,
    predictions,
  };
}

export function evaluate(train: DataPoint[], test: DataPoint[], method: Scaling, k: number): EvalResult {
  return evaluateModel(new KnnModel(train, method), test, method, k);
}

export function sweepK(train: DataPoint[], test: DataPoint[], ks: number[]) {
  const models = Object.fromEntries(SCALINGS.map((m) => [m, new KnnModel(train, m)])) as Record<Scaling, KnnModel>;
  return ks.map((k) => {
    const row: { k: number } & Record<Scaling, number> = { k, none: 0, minmax: 0, zscore: 0 };
    for (const m of SCALINGS) row[m] = evaluateModel(models[m], test, m, k).accuracy;
    return row;
  });
}

/** Stratified k-fold cross validation pada data latih (pelengkap evaluasi data uji) */
export function crossValidate(train: DataPoint[], method: Scaling, k: number, folds = 5): number | null {
  if (train.length < folds * 2) return null;
  const foldOf = new Map<DataPoint, number>();
  for (const label of LABELS) {
    train.filter((p) => p.label === label).forEach((p, i) => foldOf.set(p, i % folds));
  }
  let correct = 0;
  let total = 0;
  for (let f = 0; f < folds; f++) {
    const tr = train.filter((p) => foldOf.get(p) !== f);
    const te = train.filter((p) => foldOf.get(p) === f);
    if (!tr.length || !te.length) continue;
    const model = new KnnModel(tr, method);
    for (const p of te) {
      if (model.predict(p, k).label === p.label) correct++;
      total++;
    }
  }
  return total ? correct / total : null;
}
