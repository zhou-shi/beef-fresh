import type { NextRequest } from "next/server";
import { errorMessage, expireStaleCommands, getActiveDataset, getCounts, getDevice, getSettings } from "@/lib/server/core";
import { getStorageInfo, store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const lite = req.nextUrl.searchParams.get("lite") === "1";
    const [settings, device, storage, activeDataset] = await Promise.all([
      getSettings(),
      getDevice(),
      getStorageInfo(),
      getActiveDataset(),
    ]);
    const counts = await getCounts(settings.simulation, activeDataset);
    if (lite) return Response.json({ settings, counts, device, storage, activeDataset });

    await expireStaleCommands();
    const [allHistory, rawBenchmark, pending] = await Promise.all([
      store.listClassifications(80),
      store.getLatestBenchmarkGroup(),
      store.countActiveCommands(),
    ]);
    const isSim = settings.simulation;
    const history = allHistory.filter((h) => (h.source === "simulasi") === isSim).slice(0, 40);
    const benchmark =
      rawBenchmark && (rawBenchmark.source === "simulasi") === isSim ? rawBenchmark : null;

    return Response.json({ settings, counts, device, storage, activeDataset, history, benchmark, pending });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
