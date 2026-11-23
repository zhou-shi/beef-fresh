import { errorMessage } from "@/lib/server/core";
import { isSerialPortPresent, sendSerialCommand } from "@/lib/server/serial";

export const dynamic = "force-dynamic";

/** Baca satu kali nilai RGB terkalibrasi dari sensor TCS34725 ESP32 untuk mengisi form Dataset Manual */
export async function GET() {
  try {
    if (!isSerialPortPresent()) {
      return Response.json({ error: "ESP32 tidak terhubung di USB Serial." }, { status: 503 });
    }
    const res = await sendSerialCommand<Record<string, unknown>>("READ_SENSOR", 4.0);
    if (!res) {
      return Response.json({ error: "Gagal membaca sensor dari ESP32." }, { status: 504 });
    }
    return Response.json({
      r: Number(Number(res.r_raw ?? 0).toFixed(2)),
      g: Number(Number(res.g_raw ?? 0).toFixed(2)),
      b: Number(Number(res.b_raw ?? 0).toFixed(2)),
      rawC: Number(res.c_raw ?? 0),
      lux: Number(res.lux ?? 0),
      colorTemp: Number(res.color_temp ?? 0),
    });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
