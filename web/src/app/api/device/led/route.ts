import type { NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/core";
import { isSerialPortPresent, sendSerialCommand } from "@/lib/server/serial";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { on?: boolean };
    const on = Boolean(body.on);
    if (!isSerialPortPresent()) {
      return Response.json({ ok: true, on, hardwareSynced: false });
    }
    const res = await sendSerialCommand<{ type?: string; on?: boolean }>(`SET_LED ${on ? 1 : 0}`, 2.5);
    return Response.json({ ok: true, on, hardwareSynced: Boolean(res) });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
