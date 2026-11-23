import type { NextRequest } from "next/server";
import { LABELS, QUOTA_PER_CLASS, SPLITS, parseLabel, parseSplit, type Label } from "@/lib/constants";
import { OLED } from "@/lib/device-visual";
import { bumpModelVersion, errorMessage, getActiveDataset, getCounts, getSettings } from "@/lib/server/core";
import { simulateReading } from "@/lib/server/process";
import { isSerialPortPresent, sendSerialCommand, setLastOledLines } from "@/lib/server/serial";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const CLASS_ID: Record<Label, number> = {
  segar: 0,
  mulai_membusuk: 1,
  busuk: 2,
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const split = parseSplit(sp.get("split")) ?? undefined;
    const label = parseLabel(sp.get("label")) ?? undefined;
    const source = sp.get("source") || undefined;
    const limit = Math.min(5000, Math.max(1, Number(sp.get("limit")) || 500));
    const [settings, activeDataset] = await Promise.all([getSettings(), getActiveDataset()]);
    const [allRows, counts] = await Promise.all([
      store.listSamples({ split, label, source, order: "desc", limit }),
      getCounts(settings.simulation, activeDataset),
    ]);
    // Pisahkan data simulasi vs data asli pada dataset aktif
    const rows = allRows.filter((r) => {
      if (source) return true;
      const rowIsSim = r.source === "simulasi";
      if (rowIsSim !== settings.simulation) return false;
      if (!settings.simulation && r.datasetId != null && r.datasetId !== activeDataset.id) return false;
      return true;
    });
    return Response.json({ samples: rows, counts, activeDataset });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "seed") {
      const counts = await getCounts(true);
      const rows: Parameters<typeof store.insertSamples>[0] = [];
      for (const split of SPLITS) {
        for (const label of LABELS) {
          const need = QUOTA_PER_CLASS[split] - counts[split][label];
          for (let i = 0; i < need; i++) {
            rows.push({
              datasetId: null,
              split,
              label,
              ...simulateReading(label),
              source: "simulasi",
              deviceId: "virtual-esp32",
              note: null,
            });
          }
        }
      }
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      if (rows.length) {
        await store.insertSamples(rows);
        await bumpModelVersion();
      }
      return Response.json({ inserted: rows.length });
    }

    const split = parseSplit(String(body.split ?? ""));
    const label = parseLabel(String(body.label ?? ""));
    const r = Number(body.r);
    const g = Number(body.g);
    const b = Number(body.b);
    if (!split || !label || ![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 65535)) {
      return Response.json({ error: "Data tidak valid. Isi set data, label, dan nilai R, G, B (minimal 0)." }, { status: 400 });
    }
    const isPreviewConfirm = body.action === "confirm_preview";
    const sourceStr = isPreviewConfirm
      ? body.source === "simulasi"
        ? "simulasi"
        : "device"
      : "manual";
    const numOrNull = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const intOrNull = (v: unknown) => {
      const n = numOrNull(v);
      return n == null ? null : Math.round(n);
    };

    const activeDataset = sourceStr === "simulasi" ? null : await getActiveDataset();
    const [row] = await store.insertSamples([
      {
        datasetId: activeDataset ? activeDataset.id : null,
        split,
        label,
        r,
        g,
        b,
        rawR: intOrNull(body.rawR),
        rawG: intOrNull(body.rawG),
        rawB: intOrNull(body.rawB),
        rawC: intOrNull(body.rawC),
        lux: numOrNull(body.lux),
        colorTemp: numOrNull(body.colorTemp),
        source: sourceStr,
        deviceId: isPreviewConfirm ? (sourceStr === "simulasi" ? "ESP32 Simulasi" : "ESP32 (USB)") : null,
        note: body.note ? String(body.note).slice(0, 200) : null,
      },
    ]);
    await bumpModelVersion();

    if (isPreviewConfirm) {
      const isSim = sourceStr === "simulasi";
      const counts = await getCounts(isSim, activeDataset);
      const count = counts[split][label];
      const quota = split === "train" ? counts.quota.trainPerClass : counts.quota.testPerClass;
      const oledLines = OLED.saved(row.id, label, r, g, b, split, count, quota, isSim);
      setLastOledLines(oledLines);
      if (isSerialPortPresent()) {
        void sendSerialCommand(
          `CONFIRM_CAPTURE ${split},${CLASS_ID[label]},${count},${quota},${isSim ? 1 : 0},${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`,
          2.5,
        );
      }
      return Response.json({ sample: row, count, quota, oledLines });
    }

    return Response.json({ sample: row });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get("scope");
    if (scope === "simulasi") {
      const deleted = await store.deleteSamplesByScope("simulasi");
      await store.deleteClassifications("simulasi");
      await store.deleteBenchmarks("simulasi");
      if (deleted) await bumpModelVersion();
      return Response.json({ deleted });
    }
    if (scope === "all") {
      const activeDs = await getActiveDataset();
      const deleted = await store.deleteSamplesByScope("all", activeDs.id);
      await bumpModelVersion();
      return Response.json({ deleted });
    }
    if (scope === "history") {
      const c = await store.deleteClassifications("all");
      const b = await store.deleteBenchmarks("all");
      return Response.json({ deleted: c + b });
    }
    return Response.json({ error: "Scope harus bernilai simulasi, all, atau history." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
