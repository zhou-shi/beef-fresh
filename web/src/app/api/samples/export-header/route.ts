import { errorMessage } from "@/lib/server/core";
import { buildDatasetHeader } from "@/lib/server/header-gen";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const header = await buildDatasetHeader();
    return new Response(header.content, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="dataset_model.h"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 400 });
  }
}
