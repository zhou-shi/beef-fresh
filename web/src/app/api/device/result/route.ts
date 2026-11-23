import type { NextRequest } from "next/server";
import type { DeviceCommand } from "@/db/schema";
import { DEFAULT_DEVICE_ID } from "@/lib/constants";
import { authorizeDevice, errorMessage } from "@/lib/server/core";
import { processResult, type DeviceResultBody } from "@/lib/server/process";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!authorizeDevice(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as DeviceResultBody | null;
    if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    const deviceId = String(body.deviceId ?? req.nextUrl.searchParams.get("id") ?? DEFAULT_DEVICE_ID).slice(0, 64);

    let cmd: DeviceCommand | null = null;
    const commandId = Number(body.commandId);
    if (Number.isInteger(commandId) && commandId > 0) {
      cmd = await store.getCommand(commandId);
      if (cmd?.status === "cancelled") {
        return Response.json({ ok: false, error: "Perintah sudah dibatalkan dari website." }, { status: 409 });
      }
    }

    const out = await processResult(cmd, body, { source: "device", deviceId });
    await store.touchDevice(deviceId);
    return Response.json(out, { status: out.ok ? 200 : 422 });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
