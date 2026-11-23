import type { NextRequest } from "next/server";
import { errorMessage, getDevice } from "@/lib/server/core";
import { reconnectSerial } from "@/lib/server/serial";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { port?: string };
    const result = await reconnectSerial(body.port || undefined);
    const device = await getDevice();
    return Response.json({
      ok: result.connected,
      port: result.port,
      availablePorts: result.availablePorts,
      device,
      error: result.connected
        ? undefined
        : result.availablePorts.length
          ? `ESP32 belum merespons pada port yang terdeteksi (${result.availablePorts.join(", ")}).`
          : "Tidak ada port USB serial (COM* di Windows atau /dev/ttyUSB* di Linux) yang terdeteksi di laptop.",
    });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
