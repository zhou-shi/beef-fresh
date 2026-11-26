import { isLabel, type Label } from "@/lib/constants";
import { fitScaler } from "@/lib/knn";
import { getActiveDataset, getSettings } from "./core";
import { store } from "./store";

const CLASS_ID: Record<Label, number> = {
  segar: 0,
  mulai_membusuk: 1,
  busuk: 2,
};

const CODE_PREFIX: Record<Label, string> = {
  segar: "SGR",
  mulai_membusuk: "MMB",
  busuk: "BSK",
};

const fmtF = (n: number) => `${n.toFixed(2)}f`;
const fmtF6 = (n: number) => `${n.toFixed(6)}f`;

export async function buildDatasetHeader(): Promise<{
  content: string;
  datasetName: string;
  trainCount: number;
  testCount: number;
  k: number;
}> {
  const [allRows, settings, activeDs] = await Promise.all([
    store.listSamples({ order: "asc", limit: 5000 }),
    getSettings(),
    getActiveDataset(),
  ]);
  const rows = allRows.filter((r) => {
    const rowIsSim = r.source === "simulasi";
    if (rowIsSim !== settings.simulation) return false;
    if (!settings.simulation && r.datasetId != null && r.datasetId !== activeDs.id) return false;
    return true;
  });

  const train = rows.filter((r) => r.split === "train" && isLabel(r.label));
  const test = rows.filter((r) => r.split === "test" && isLabel(r.label));

  if (!train.length) {
    throw new Error("Dataset latih masih kosong. Ambil atau isi data latih terlebih dahulu.");
  }

  const mm = fitScaler(train, "minmax");

  const formatRows = (list: typeof train, splitCode: "TRN" | "TST") => {
    const counters: Record<Label, number> = { segar: 0, mulai_membusuk: 0, busuk: 0 };
    return list
      .map((s, idx) => {
        const lbl = s.label as Label;
        counters[lbl] += 1;
        const code = `${splitCode}-${CODE_PREFIX[lbl]}-${String(counters[lbl]).padStart(3, "0")}`;
        const comma = idx < list.length - 1 ? "," : "";
        return `  {${fmtF(s.r)}, ${fmtF(s.g)}, ${fmtF(s.b)}, ${CLASS_ID[lbl]}}${comma} // ${code}`;
      })
      .join("\n");
  };

  const datasetName = settings.simulation ? "Dataset Simulasi" : activeDs.name;
  const testCount = Math.max(1, test.length);

  const content = `#ifndef DATASET_MODEL_H
#define DATASET_MODEL_H

#include <Arduino.h>

// Diekspor otomatis dari Beef Fresh Web (${datasetName}) pada ${new Date().toISOString()}
// Dataset latih: ${train.length} sampel, Dataset uji: ${test.length} sampel
#define NUM_TRAIN_SAMPLES ${train.length}
#define NUM_TEST_SAMPLES ${testCount}
#define NUM_FEATURES 4
#define KNN_K ${settings.defaultK}

struct SampleRGB {
  float r;
  float g;
  float b;
  uint8_t class_id;
};

float MINMAX_F_MIN[NUM_FEATURES] = { ${mm.min.map(fmtF6).join(", ")} };
float MINMAX_F_MAX[NUM_FEATURES] = { ${mm.max.map(fmtF6).join(", ")} };

SampleRGB trainDataRaw[NUM_TRAIN_SAMPLES] = {
${formatRows(train, "TRN")}
};

SampleRGB testDataRaw[NUM_TEST_SAMPLES] = {
${test.length ? formatRows(test, "TST") : "  {0.0f, 0.0f, 0.0f, 0}"}
};

#endif
`;

  return {
    content,
    datasetName,
    trainCount: train.length,
    testCount: test.length,
    k: settings.defaultK,
  };
}
