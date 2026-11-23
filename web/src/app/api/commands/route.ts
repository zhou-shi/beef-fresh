import type { NextRequest } from "next/server";
import type { CommandPayload } from "@/db/schema";
import {
  DEFAULT_DEVICE_ID,
  LABEL_INFO,
  QUOTA_PER_CLASS,
  SPLIT_INFO,
  parseLabel,
  parseScaling,
  parseSplit,
} from "@/lib/constants";
import { errorMessage, expireStaleCommands, getCounts, getDevice, getSettings } from "@/lib/server/core";
import { simulateCommand } from "@/lib/server/process";
import { executeSerialCommand, isSerialPortPresent } from "@/lib/server/serial";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const TYPES = ["capture", "classify", "benchmark", "ping", "sync"];

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Math.round(Number(v));
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
};

export async function GET(req: NextRequest) {
  try {
    await expireStaleCommands();
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 20));
    const rows = await store.listCommands(limit);
    return Response.json({ commands: rows });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { type?: string; payload?: Record<string, unknown> };
    const type = String(body.type ?? "");
    if (!TYPES.includes(type)) return Response.json({ error: `Tipe perintah tidak dikenal: ${type}` }, { status: 400 });
    const settings = await getSettings();
    const p = body.payload ?? {};
    const payload: CommandPayload = {};

    if (type === "capture") {
      const label = parseLabel(String(p.label ?? ""));
      const split = parseSplit(String(p.split ?? ""));
      if (!label || !split) return Response.json({ error: "Kelas atau set data tidak valid." }, { status: 400 });
      if (!p.force) {
        const counts = await getCounts(settings.simulation);
        const n = counts[split][label];
        const quota = split === "train" ? counts.quota.trainPerClass : counts.quota.testPerClass;
        if (n >= quota) {
          return Response.json(
            {
              error: `Kuota ${LABEL_INFO[label].name} (${SPLIT_INFO[split].name}) sudah penuh (${n}/${quota}). Tambahkan --paksa untuk tetap mengambil.`,
              quotaFull: true,
            },
            { status: 409 },
          );
        }
      }
      payload.label = label;
      payload.split = split;
      payload.force = Boolean(p.force);
    } else if (type === "classify") {
      payload.scaling = parseScaling(String(p.scaling ?? "")) ?? settings.defaultScaling;
      payload.k = clampInt(p.k, 1, 25) ?? settings.defaultK;
      const truth = parseLabel(String(p.truth ?? ""));
      if (truth) payload.truth = truth;
    } else if (type === "benchmark") {
      payload.k = clampInt(p.k, 1, 25) ?? settings.defaultK;
      payload.repeat = clampInt(p.repeat, 1, 10) ?? 3;
    }

    const simulated = settings.simulation;
    const hasHardware = isSerialPortPresent();
    const cmd = await store.insertCommand({
      deviceId: hasHardware ? (simulated ? "ESP32 Simulasi (/dev/ttyUSB0)" : "ESP32 (/dev/ttyUSB0)") : DEFAULT_DEVICE_ID,
      type,
      payload,
      status: simulated || hasHardware ? "running" : "pending",
      simulated,
      pickedAt: simulated || hasHardware ? new Date() : null,
    });

    // Prioritaskan ESP32 fisik jika terhubung via USB Serial (termasuk saat Mode Simulasi / Hardware-in-the-Loop!)
    if (hasHardware) {
      const ok = await executeSerialCommand(cmd, simulated);
      if (ok) {
        const done = await store.getCommand(cmd.id);
        return Response.json({ command: done ?? cmd, simulated, deviceOnline: true });
      }
      if (!simulated) {
        await store.updateCommand(cmd.id, { status: "pending", pickedAt: null });
      }
    }

    // Fallback virtual di server hanya jika alat fisik tidak terhubung saat Mode Simulasi aktif
    if (simulated) {
      await simulateCommand(cmd);
      const done = await store.getCommand(cmd.id);
      return Response.json({ command: done ?? cmd, simulated: true, deviceOnline: false });
    }

    const device = await getDevice();
    return Response.json({ command: cmd, simulated: false, deviceOnline: device.online });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
