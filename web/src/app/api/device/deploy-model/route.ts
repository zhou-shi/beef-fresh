import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { buildDatasetHeader } from "@/lib/server/header-gen";
import {
  getActiveSerialPort,
  isFlashingInProgress,
  listAvailableUsbPorts,
  reconnectSerial,
  setFlashingState,
} from "@/lib/server/serial";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(process.cwd(), "..");
const FIRMWARE_DIR = path.join(ROOT_DIR, "firmware", "beef_fresh_esp32");
const HEADER_PATH = path.join(FIRMWARE_DIR, "dataset_model.h");

function findArduinoCli(): string {
  const candidates = [
    path.join(process.env.HOME || "/home/surya-asi", ".local", "bin", "arduino-cli"),
    "/usr/local/bin/arduino-cli",
    "/usr/bin/arduino-cli",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "arduino-cli";
}

/**
 * Endpoint streaming NDJSON untuk menanam dataset_model.h aktif langsung ke ESP32:
 *  1. Generate & tulis firmware/beef_fresh_esp32/dataset_model.h
 *  2. Lepas sementara port serial agar tidak bentrok
 *  3. Compile firmware via arduino-cli
 *  4. Upload ke port USB ESP32 yang terdeteksi
 *  5. Sambungkan ulang koneksi serial & sinkronkan OLED
 */
export async function POST() {
  if (isFlashingInProgress()) {
    return Response.json({ error: "Proses tanam model ke ESP32 sedang berlangsung." }, { status: 409 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      let targetPort: string | null = null;
      try {
        // Tahap 1: Buat file dataset_model.h
        send({ step: 1, percent: 12, message: "Menyiapkan dan menulis file dataset_model.h dari dataset aktif" });
        const ports = listAvailableUsbPorts();
        targetPort = getActiveSerialPort() ?? ports[0] ?? null;
        if (!targetPort || !fs.existsSync(targetPort)) {
          throw new Error("ESP32 tidak terdeteksi di port USB (/dev/ttyUSB* atau /dev/ttyACM*). Colokkan kabel USB terlebih dahulu.");
        }

        const header = await buildDatasetHeader();
        fs.writeFileSync(HEADER_PATH, header.content, "utf-8");

        // Tahap 2: Lepas koneksi serial daemon sementara
        send({
          step: 2,
          percent: 25,
          message: `Melepas sementara port ${targetPort} (${header.trainCount} latih, ${header.testCount} uji)`,
        });
        setFlashingState(true);
        await new Promise((r) => setTimeout(r, 450));

        const cli = findArduinoCli();

        // Tahap 3: Compile firmware ESP32
        send({ step: 3, percent: 45, message: "Mengompilasi firmware ESP32 dengan dataset baru (mohon tunggu)" });
        await execFileAsync(cli, ["compile", "--fqbn", "esp32:esp32:esp32", FIRMWARE_DIR], {
          timeout: 180_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        // Tahap 4: Upload ke ESP32
        send({ step: 4, percent: 75, message: `Mengunggah model fix ke memori flash ESP32 di ${targetPort}` });
        await execFileAsync(cli, ["upload", "-p", targetPort, "--fqbn", "esp32:esp32:esp32", FIRMWARE_DIR], {
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        // Matikan HUPCL agar koneksi ulang tidak mereset ESP32
        await execFileAsync("stty", ["-F", targetPort, "-hupcl"]).catch(() => {});

        // Tahap 5: Sambungkan ulang serial & sinkronkan OLED
        send({ step: 5, percent: 92, message: "Menyambungkan ulang ESP32 dan menyinkronkan layar OLED" });
        setFlashingState(false);
        await new Promise((r) => setTimeout(r, 1200));
        const rec = await reconnectSerial(targetPort);

        send({
          step: 5,
          percent: 100,
          done: true,
          ok: true,
          message: `Model "${header.datasetName}" (${header.trainCount} latih, ${header.testCount} uji) berhasil ditanam ke ESP32${rec.port ? ` (${rec.port})` : ""}.`,
        });
      } catch (err) {
        setFlashingState(false);
        if (targetPort) {
          await reconnectSerial(targetPort).catch(() => {});
        }
        const msg = err instanceof Error ? err.message : String(err);
        send({
          step: 0,
          percent: 100,
          done: true,
          ok: false,
          error: msg.slice(0, 320),
          message: "Proses tanam model ke ESP32 gagal.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
