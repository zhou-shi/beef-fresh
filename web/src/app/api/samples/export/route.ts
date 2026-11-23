import { isLabel } from "@/lib/constants";
import { fitScaler, scaleVec } from "@/lib/knn";
import { errorMessage, getActiveDataset, getSettings } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [settings, activeDs, allRows] = await Promise.all([
      getSettings(),
      getActiveDataset(),
      store.listSamples({ order: "asc", limit: 5000 }),
    ]);
    const rows = allRows.filter((r) => {
      const rowIsSim = r.source === "simulasi";
      if (rowIsSim !== settings.simulation) return false;
      if (!settings.simulation && r.datasetId != null && r.datasetId !== activeDs.id) return false;
      return true;
    });
    const train = rows.filter((r) => r.split === "train" && isLabel(r.label));
    const mm = fitScaler(train, "minmax");
    const zs = fitScaler(train, "zscore");
    const header = [
      "id", "split", "label", "r", "g", "b",
      "r_minmax", "g_minmax", "b_minmax", "r_zscore", "g_zscore", "b_zscore",
      "raw_r", "raw_g", "raw_b", "raw_c", "lux", "color_temp", "source", "device_id", "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const v = [r.r, r.g, r.b];
      const a = scaleVec(v, mm).map((x) => x.toFixed(6));
      const z = scaleVec(v, zs).map((x) => x.toFixed(6));
      lines.push(
        [
          r.id, r.split, r.label, r.r, r.g, r.b, ...a, ...z,
          r.rawR ?? "", r.rawG ?? "", r.rawB ?? "", r.rawC ?? "", r.lux ?? "", r.colorTemp ?? "",
          r.source, r.deviceId ?? "", r.createdAt.toISOString(),
        ].join(","),
      );
    }
    const name = `beef-fresh-dataset-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(lines.join("\n") + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
