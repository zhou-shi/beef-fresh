import type { NextRequest } from "next/server";
import type { Sample } from "@/db/schema";
import { parseLabel, parseSplit } from "@/lib/constants";
import { bumpModelVersion, errorMessage } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<Sample> = {};
    if (body.label !== undefined) {
      const l = parseLabel(String(body.label));
      if (!l) return Response.json({ error: "Label tidak valid." }, { status: 400 });
      patch.label = l;
    }
    if (body.split !== undefined) {
      const s = parseSplit(String(body.split));
      if (!s) return Response.json({ error: "Set data tidak valid." }, { status: 400 });
      patch.split = s;
    }
    if (body.note !== undefined) patch.note = body.note ? String(body.note).slice(0, 200) : null;
    if (!Object.keys(patch).length) return Response.json({ error: "Tidak ada perubahan." }, { status: 400 });
    const row = await store.updateSample(id, patch);
    if (!row) return Response.json({ error: "Sampel tidak ditemukan." }, { status: 404 });
    await bumpModelVersion();
    return Response.json({ sample: row });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    const row = await store.deleteSample(id);
    if (!row) return Response.json({ error: "Sampel tidak ditemukan." }, { status: 404 });
    await bumpModelVersion();
    return Response.json({ sample: row });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
