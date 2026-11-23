import type { NextRequest } from "next/server";
import { K_OPTIONS, SCALINGS, type Scaling } from "@/lib/constants";
import { crossValidate, evaluate, sweepK } from "@/lib/knn";
import { errorMessage, getSettings, loadDataset } from "@/lib/server/core";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const kParam = Number(req.nextUrl.searchParams.get("k"));
    const [settings, { train, test }] = await Promise.all([getSettings(), loadDataset()]);
    const k = Number.isFinite(kParam) && kParam >= 1 ? Math.min(25, Math.round(kParam)) : settings.defaultK;

    if (train.length < 1 || test.length < 1) {
      return Response.json({ ready: false, trainCount: train.length, testCount: test.length, k });
    }

    const methods = {
      none: evaluate(train, test, "none", k),
      minmax: evaluate(train, test, "minmax", k),
      zscore: evaluate(train, test, "zscore", k),
    };
    const ks = K_OPTIONS.filter((x) => x <= train.length);
    const sweep = sweepK(train, test, ks.length ? ks : [1]);
    const cv = {
      none: crossValidate(train, "none", k),
      minmax: crossValidate(train, "minmax", k),
      zscore: crossValidate(train, "zscore", k),
    };

    let best: { method: Scaling; k: number; accuracy: number } | null = null;
    for (const row of sweep) {
      for (const m of SCALINGS) {
        if (!best || row[m] > best.accuracy) best = { method: m, k: row.k, accuracy: row[m] };
      }
    }

    return Response.json({ ready: true, trainCount: train.length, testCount: test.length, k, methods, sweep, cv, best });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
