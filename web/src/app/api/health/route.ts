import { errorMessage } from "@/lib/server/core";
import { getStorageInfo } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storage = await getStorageInfo();
    return Response.json({ ok: true, storage });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
