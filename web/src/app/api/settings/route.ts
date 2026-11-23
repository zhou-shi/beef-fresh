import type { NextRequest } from "next/server";
import { parseScaling } from "@/lib/constants";
import { errorMessage, getSettings, setSetting } from "@/lib/server/core";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ settings: await getSettings() });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.simulation === "boolean") await setSetting("simulation", body.simulation);
    if (body.defaultK !== undefined) {
      const k = Math.round(Number(body.defaultK));
      if (!(k >= 1 && k <= 25)) return Response.json({ error: "Nilai K harus antara 1 sampai 25." }, { status: 400 });
      await setSetting("defaultK", k);
    }
    if (body.defaultScaling !== undefined) {
      const s = parseScaling(String(body.defaultScaling));
      if (!s) return Response.json({ error: "Metode scaling: none | minmax | zscore" }, { status: 400 });
      await setSetting("defaultScaling", s);
    }
    return Response.json({ settings: await getSettings() });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
