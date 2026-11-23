import type { NextRequest } from "next/server";
import { bumpModelVersion, errorMessage, getActiveDataset, setSetting } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Daftar seluruh dataset (aktif & arsip) beserta jumlah sampelnya */
export async function GET() {
  try {
    const [active, all, allSamples] = await Promise.all([
      getActiveDataset(),
      store.listDatasets(),
      store.listSamples({ order: "asc", limit: 5000 }),
    ]);

    const realSamples = allSamples.filter((s) => s.source !== "simulasi");
    const datasets = all.map((d) => {
      const dsRows = realSamples.filter((s) => s.datasetId === d.id || (s.datasetId == null && d.id === active.id));
      return {
        ...d,
        trainCount: dsRows.filter((s) => s.split === "train").length,
        testCount: dsRows.filter((s) => s.split === "test").length,
      };
    });

    return Response.json({ datasets, activeDatasetId: active.id, activeDataset: active });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

/** Buat New Dataset baru dengan target data latih & uji dinamis (kelipatan 3) */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      targetTrain?: number;
      targetTest?: number;
    };
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) return Response.json({ error: "Nama dataset tidak boleh kosong." }, { status: 400 });

    const rawTrain = Math.round(Number(body.targetTrain ?? 144));
    const rawTest = Math.round(Number(body.targetTest ?? 36));
    if (!Number.isFinite(rawTrain) || rawTrain < 3 || rawTrain > 3000) {
      return Response.json({ error: "Target data latih harus antara 3 sampai 3000." }, { status: 400 });
    }
    if (!Number.isFinite(rawTest) || rawTest < 3 || rawTest > 1500) {
      return Response.json({ error: "Target data uji harus antara 3 sampai 1500." }, { status: 400 });
    }
    // Bulatkan otomatis ke kelipatan 3 agar 3 kelas selalu seimbang
    const targetTrain = Math.max(3, Math.round(rawTrain / 3) * 3);
    const targetTest = Math.max(3, Math.round(rawTest / 3) * 3);

    const created = await store.createDataset({
      name,
      description: body.description ? String(body.description).trim().slice(0, 300) : null,
      targetTrain,
      targetTest,
    });
    await setSetting("activeDatasetId", created.id);
    await bumpModelVersion();

    return Response.json({ dataset: created, activeDatasetId: created.id });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
