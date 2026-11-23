import type { NextRequest } from "next/server";
import { bumpModelVersion, errorMessage, getActiveDataset, setSetting } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID dataset tidak valid." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as {
      action?: "select" | "archive" | "unarchive";
      name?: string;
      description?: string | null;
      targetTrain?: number;
      targetTest?: number;
    };

    const all = await store.listDatasets();
    const target = all.find((d) => d.id === id);
    if (!target) return Response.json({ error: "Dataset tidak ditemukan." }, { status: 404 });

    if (body.action === "select") {
      if (target.status === "archived") {
        await store.updateDataset(id, { status: "active" });
      }
      await setSetting("activeDatasetId", id);
      await bumpModelVersion();
      return Response.json({ ok: true, activeDatasetId: id });
    }

    if (body.action === "archive") {
      await store.updateDataset(id, { status: "archived" });
      const active = await getActiveDataset();
      await bumpModelVersion();
      return Response.json({ ok: true, activeDatasetId: active.id, activeDataset: active });
    }

    if (body.action === "unarchive") {
      await store.updateDataset(id, { status: "active" });
      await setSetting("activeDatasetId", id);
      await bumpModelVersion();
      return Response.json({ ok: true, activeDatasetId: id });
    }

    const patch: Parameters<typeof store.updateDataset>[1] = {};
    if (body.name !== undefined && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
    if (body.description !== undefined) patch.description = body.description ? body.description.trim().slice(0, 300) : null;
    if (body.targetTrain !== undefined) patch.targetTrain = Math.max(3, Math.round(Number(body.targetTrain) / 3) * 3);
    if (body.targetTest !== undefined) patch.targetTest = Math.max(3, Math.round(Number(body.targetTest) / 3) * 3);

    const updated = await store.updateDataset(id, patch);
    await bumpModelVersion();
    return Response.json({ dataset: updated });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID dataset tidak valid." }, { status: 400 });
    const ok = await store.deleteDataset(id);
    if (!ok) return Response.json({ error: "Dataset tidak ditemukan." }, { status: 404 });
    const active = await getActiveDataset();
    await bumpModelVersion();
    return Response.json({ ok: true, activeDatasetId: active.id });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
