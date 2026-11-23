import type { NextRequest } from "next/server";
import { errorMessage, expireStaleCommands } from "@/lib/server/core";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    await expireStaleCommands();
    const row = await store.getCommand(id);
    if (!row) return Response.json({ error: "Perintah tidak ditemukan." }, { status: 404 });
    return Response.json({ command: row });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "ID tidak valid." }, { status: 400 });
    const row = await store.getCommand(id);
    if (!row) return Response.json({ error: "Perintah tidak ditemukan." }, { status: 404 });
    if (row.status === "pending" || row.status === "running") {
      const upd = await store.updateCommand(id, {
        status: "cancelled",
        error: "Dibatalkan oleh pengguna.",
        completedAt: new Date(),
      });
      return Response.json({ command: upd ?? row });
    }
    return Response.json({ command: row });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
