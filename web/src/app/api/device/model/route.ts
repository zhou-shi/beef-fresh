import type { NextRequest } from "next/server";
import { LABELS } from "@/lib/constants";
import { authorizeDevice, errorMessage, getSettings, loadDataset } from "@/lib/server/core";

export const dynamic = "force-dynamic";

/**
 * Dataset untuk KNN di ESP32 (format teks ringkas agar hemat RAM):
 *   V,<versi>            versi dataset
 *   K,<k>                K default
 *   S,<scaling>          metode scaling default
 *   T,r,g,b,label        data latih  (label: 0=segar, 1=mulai_membusuk, 2=busuk)
 *   U,r,g,b,label        data uji    (untuk benchmark di perangkat)
 *   E                    akhir data
 * Parameter scaling (min, max, mean, std) dihitung sendiri oleh ESP32 dari data latih.
 */
export async function GET(req: NextRequest) {
  if (!authorizeDevice(req)) return new Response("unauthorized", { status: 401 });
  try {
    const [settings, { train, test }] = await Promise.all([getSettings(), loadDataset()]);
    const lines = [`V,${settings.modelVersion}`, `K,${settings.defaultK}`, `S,${settings.defaultScaling}`];
    for (const p of train.slice(0, 200)) lines.push(`T,${p.r.toFixed(2)},${p.g.toFixed(2)},${p.b.toFixed(2)},${LABELS.indexOf(p.label)}`);
    for (const p of test.slice(0, 60)) lines.push(`U,${p.r.toFixed(2)},${p.g.toFixed(2)},${p.b.toFixed(2)},${LABELS.indexOf(p.label)}`);
    lines.push("E");
    return new Response(lines.join("\n") + "\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(`error: ${errorMessage(e)}`, { status: 500 });
  }
}
