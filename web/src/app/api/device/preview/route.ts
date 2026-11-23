import type { NextRequest } from "next/server";
import { LABEL_INFO, QUOTA_PER_CLASS, SPLIT_INFO, parseLabel, parseSplit, type Label } from "@/lib/constants";
import { OLED } from "@/lib/device-visual";
import { errorMessage, getCounts, getSettings } from "@/lib/server/core";
import { simulateReading } from "@/lib/server/process";
import { isSerialPortPresent, sampleDummyRgbForHardware, sendSerialCommand, setLastOledLines } from "@/lib/server/serial";

export const dynamic = "force-dynamic";

const CLASS_ID: Record<Label, number> = {
  segar: 0,
  mulai_membusuk: 1,
  busuk: 2,
};

/**
 * Ambil pembacaan preview dari sensor TCS34725 ESP32 TANPA langsung menyimpannya ke database.
 * Pengguna bisa melihat visual warna RGB terlebih dahulu lalu memilih Simpan atau Ambil Ulang.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { label?: string; split?: string; force?: boolean };
    const label = parseLabel(body.label);
    const split = parseSplit(body.split);
    if (!label || !split) {
      return Response.json({ error: "Kelas atau set data tidak valid." }, { status: 400 });
    }

    const settings = await getSettings();
    const isSim = settings.simulation;
    const counts = await getCounts(isSim);
    const curCount = counts[split][label];
    const quota = split === "train" ? counts.quota.trainPerClass : counts.quota.testPerClass;

    if (!body.force && curCount >= quota) {
      return Response.json(
        {
          error: `Kuota ${LABEL_INFO[label].name} (${SPLIT_INFO[split].name}) sudah penuh (${curCount}/${quota}). Tambahkan --paksa untuk tetap mengambil.`,
          quotaFull: true,
        },
        { status: 409 },
      );
    }

    const nextCount = curCount + 1;
    const cid = CLASS_ID[label];
    const hasHardware = isSerialPortPresent();

    let r = 0;
    let g = 0;
    let b = 0;
    let rawR: number | null = null;
    let rawG: number | null = null;
    let rawB: number | null = null;
    let rawC: number | null = null;
    let lux: number | null = null;
    let colorTemp: number | null = null;
    let fromHardware = false;

    if (hasHardware) {
      let res: Record<string, unknown> | null = null;
      if (isSim) {
        const d = sampleDummyRgbForHardware(label);
        res = await sendSerialCommand<Record<string, unknown>>(
          `PREVIEW_DUMMY ${split},${cid},${nextCount},${quota},${d.r},${d.g},${d.b}`,
          4.5,
        );
      } else {
        res = await sendSerialCommand<Record<string, unknown>>(
          `PREVIEW_SAMPLE ${split},${cid},${nextCount},${quota},0`,
          4.5,
        );
        if (!res) {
          res = await sendSerialCommand<Record<string, unknown>>("READ_SENSOR", 4.0);
        }
      }
      if (res) {
        r = Number(res.r_raw ?? 0);
        g = Number(res.g_raw ?? 0);
        b = Number(res.b_raw ?? 0);
        rawR = Math.round(r);
        rawG = Math.round(g);
        rawB = Math.round(b);
        rawC = res.c_raw != null ? Number(res.c_raw) : null;
        lux = res.lux != null ? Number(res.lux) : null;
        colorTemp = res.color_temp != null ? Number(res.color_temp) : null;
        fromHardware = true;
      }
    }

    if (!fromHardware) {
      if (!isSim) {
        return Response.json(
          { error: "ESP32 tidak terhubung di USB Serial. Colokkan alat atau aktifkan Mode Simulasi." },
          { status: 503 },
        );
      }
      const simR = simulateReading(label);
      r = simR.r;
      g = simR.g;
      b = simR.b;
      rawR = simR.rawR;
      rawG = simR.rawG;
      rawB = simR.rawB;
      rawC = simR.rawC;
      lux = simR.lux;
      colorTemp = simR.colorTemp;
    }

    const oledLines = [
      isSim
        ? split === "test"
          ? "SIM DATA UJI"
          : "SIM DATA LATIH"
        : split === "test"
          ? "AMBIL DATA UJI"
          : "AMBIL DATA LATIH",
      `=${LABEL_INFO[label].oled}|${nextCount}/${quota}`,
      `RGB : ${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`,
      "PREVIEW: SIMPAN?",
      `#${nextCount}/${quota}`,
    ];
    setLastOledLines(oledLines);

    return Response.json({
      preview: {
        split,
        label,
        r: Math.round(r * 100) / 100,
        g: Math.round(g * 100) / 100,
        b: Math.round(b * 100) / 100,
        rawR,
        rawG,
        rawB,
        rawC,
        lux,
        colorTemp,
        source: isSim ? "simulasi" : "device",
        fromHardware,
        nextCount,
        quota,
        oledLines,
      },
    });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
