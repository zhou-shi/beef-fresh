import type { Label, Scaling, Split } from "./constants";
import type { EvalResult } from "./knn";

/** Bentuk data JSON yang dikirim API ke browser */

export interface DatasetDTO {
  id: number;
  name: string;
  description: string | null;
  targetTrain: number;
  targetTest: number;
  status: "active" | "archived";
  createdAt: string;
  trainCount?: number;
  testCount?: number;
}

export interface AppSettingsDTO {
  simulation: boolean;
  defaultK: number;
  defaultScaling: Scaling;
  modelVersion: number;
  activeDatasetId?: number | null;
}

export type ClassCounts = Record<Label, number> & { total: number };

export interface QuotaInfoDTO {
  train: number;
  test: number;
  trainPerClass: number;
  testPerClass: number;
}

export interface CountsDTO {
  train: ClassCounts;
  test: ClassCounts;
  bySource: Record<string, number>;
  total: number;
  quota?: QuotaInfoDTO;
}

export interface DeviceDTO {
  id: string;
  online: boolean;
  everSeen: boolean;
  lastSeen: string | null;
  ip: string | null;
  rssi: number | null;
  freeHeap: number | null;
  firmware: string | null;
  modelVersion: number | null;
  trainCount: number | null;
  sensorOk: boolean | null;
  oledOk: boolean | null;
  uptimeS: number | null;
  usbPort?: string | null;
  availablePorts?: string[];
  oledLines?: string[] | null;
  calibration?: {
    white_ok: boolean;
    black_ok: boolean;
    white: number[];
    black: number[];
  } | null;
}

export interface LiteOverview {
  settings: AppSettingsDTO;
  counts: CountsDTO;
  device: DeviceDTO;
  activeDataset?: DatasetDTO | null;
}

export interface ClassificationDTO {
  id: number;
  commandId: number | null;
  deviceId: string | null;
  r: number;
  g: number;
  b: number;
  rNorm: number | null;
  gNorm: number | null;
  bNorm: number | null;
  rawR: number | null;
  rawG: number | null;
  rawB: number | null;
  rawC: number | null;
  scaling: Scaling;
  k: number;
  predicted: Label;
  votes: number[] | null;
  confidence: number | null;
  nearest: number | null;
  execUs: number | null;
  scaleUs: number | null;
  knnUs: number | null;
  memBytes: number | null;
  modelBytes: number | null;
  freeHeap: number | null;
  trainCount: number | null;
  actual: string | null;
  source: string;
  createdAt: string;
}

export interface BenchmarkDTO {
  id: number;
  commandId: number | null;
  deviceId: string | null;
  scaling: Scaling;
  k: number;
  repeat: number;
  samples: number;
  correct: number;
  accuracy: number;
  avgUs: number;
  minUs: number | null;
  maxUs: number | null;
  scaleUs: number | null;
  knnUs: number | null;
  memBytes: number | null;
  modelBytes: number | null;
  freeHeap: number | null;
  cpuMhz: number | null;
  trainCount: number | null;
  source: string;
  createdAt: string;
}

export interface BenchmarkRunDTO {
  commandId: number | null;
  source: string;
  createdAt: string;
  k: number;
  rows: BenchmarkDTO[];
}

export interface OverviewDTO extends LiteOverview {
  history: ClassificationDTO[];
  benchmark: BenchmarkRunDTO | null;
  pending: number;
}

export interface CommandDTO {
  id: number;
  deviceId: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  simulated: boolean;
  createdAt: string;
  pickedAt: string | null;
  completedAt: string | null;
}

export interface SampleDTO {
  id: number;
  split: Split;
  label: Label;
  r: number;
  g: number;
  b: number;
  rawR: number | null;
  rawG: number | null;
  rawB: number | null;
  rawC: number | null;
  lux: number | null;
  colorTemp: number | null;
  source: string;
  deviceId: string | null;
  note: string | null;
  createdAt: string;
}

export type SweepRow = { k: number } & Record<Scaling, number>;

export interface EvaluationDTO {
  ready: boolean;
  trainCount: number;
  testCount: number;
  k: number;
  methods?: Record<Scaling, EvalResult>;
  sweep?: SweepRow[];
  cv?: Record<Scaling, number | null>;
  best?: { method: Scaling; k: number; accuracy: number } | null;
}
