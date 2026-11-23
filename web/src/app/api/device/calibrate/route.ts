import type { NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/core";
import { getCachedSerialStatus, isSerialPortPresent, sendSerialCommand, setLastOledLines } from "@/lib/server/serial";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action ?? "").toLowerCase();
    if (!["white", "black", "reset"].includes(action)) {
      return Response.json({ error: "Aksi kalibrasi harus white, black, atau reset." }, { status: 400 });
    }
    if (!isSerialPortPresent()) {
      return Response.json({ error: "ESP32 tidak terhubung di USB Serial." }, { status: 503 });
    }

    const cmd =
      action === "white" ? "CALIBRATE_WHITE" : action === "black" ? "CALIBRATE_BLACK" : "RESET_CALIBRATION";
    const res = await sendSerialCommand<{
      white_ok?: boolean;
      black_ok?: boolean;
      white?: number[];
      black?: number[];
    }>(cmd, 5.0);

    if (!res) {
      return Response.json({ error: "ESP32 tidak merespons perintah kalibrasi." }, { status: 504 });
    }

    const r = action === "white" ? res.white?.[0] ?? 0 : action === "black" ? res.black?.[0] ?? 0 : 0;
    const g = action === "white" ? res.white?.[1] ?? 0 : action === "black" ? res.black?.[1] ?? 0 : 0;
    const b = action === "white" ? res.white?.[2] ?? 0 : action === "black" ? res.black?.[2] ?? 0 : 0;

    const oledLines =
      action === "white"
        ? [
            "KALIBRASI 2 TITIK",
            "=PUTIH (255) OK",
            `Raw: ${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`,
            res.black_ok ? "2 titik aktif!" : "Lanjut: Kalibrasi Hitam",
          ]
        : action === "black"
          ? [
              "KALIBRASI 2 TITIK",
              "=HITAM (0) OK",
              `Raw: ${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`,
              res.white_ok ? "2 titik aktif!" : "Lanjut: Kalibrasi Putih",
            ]
          : ["KALIBRASI 2 TITIK", "=KALIBRASI RESET", "Raw: 0, 0, 0", "Kembali ke mode mentah"];

    setLastOledLines(oledLines);
    await getCachedSerialStatus(true);

    return Response.json({
      ok: true,
      calibration: {
        white_ok: Boolean(res.white_ok),
        black_ok: Boolean(res.black_ok),
        white: res.white ?? [0, 0, 0],
        black: res.black ?? [0, 0, 0],
      },
      oledLines,
    });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
