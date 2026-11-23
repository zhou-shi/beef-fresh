import type { NextRequest } from "next/server";
import { DEFAULT_DEVICE_ID } from "@/lib/constants";
import { authorizeDevice, errorMessage, expireStaleCommands, getSettings } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorizeDevice(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sp = req.nextUrl.searchParams;
    const id = (sp.get("id") || DEFAULT_DEVICE_ID).slice(0, 64);
    const intOrNull = (key: string) => {
      const v = sp.get(key);
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const boolOrNull = (key: string) => (sp.get(key) === "1" ? true : sp.get(key) === "0" ? false : null);

    await store.upsertDevice({
      id,
      lastSeen: new Date(),
      ip: sp.get("ip")?.slice(0, 64) ?? null,
      rssi: intOrNull("rssi"),
      freeHeap: intOrNull("heap"),
      firmware: sp.get("fw")?.slice(0, 32) ?? null,
      modelVersion: intOrNull("mv"),
      trainCount: intOrNull("tc"),
      sensorOk: boolOrNull("s"),
      oledOk: boolOrNull("o"),
      uptimeS: intOrNull("up"),
    });

    await expireStaleCommands();
    const next = await store.getNextPendingRealCommand();
    const settings = await getSettings();
    let cmd: Record<string, unknown> | null = null;
    if (next) {
      await store.updateCommand(next.id, { status: "running", pickedAt: new Date(), deviceId: id });
      cmd = { ...next.payload, id: next.id, type: next.type };
    }
    return Response.json({ cmd, mv: settings.modelVersion, k: settings.defaultK, scaling: settings.defaultScaling, t: Date.now() });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
