import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { NextRequest } from "next/server";
import { promisify } from "util";
import { buildDatasetHeader } from "@/lib/server/header-gen";
import {
  isFlashingInProgress,
  reconnectSerial,
  releaseSerialPortForFlashing,
  setFlashingState,
} from "@/lib/server/serial";
import {
  ESP32_FQBN,
  detectEsp32Port,
  ensureAllToolchain,
  spawnWithProgress,
} from "@/lib/server/toolchain";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(process.cwd(), "..");
const FIRMWARE_DIR = path.join(ROOT_DIR, "firmware", "beef_fresh_esp32");
const HEADER_PATH = path.join(FIRMWARE_DIR, "dataset_model.h");
const BUILD_DIR = path.join(os.tmpdir(), "beef-fresh-esp32-build");

/**
 * Endpoint streaming NDJSON lintas OS (Ubuntu Linux & Windows 11) untuk menanam
 * dataset_model.h & firmware terbaru langsung ke ESP32:
 *  1. Pastikan arduino-cli, core esp32:esp32, library Adafruit, & PySerial tersedia (unduh otomatis jika belum ada)
 *  2. Generate dataset_model.h dari dataset aktif & deteksi port ESP32
 *  3. Lepas port serial agar tidak terkunci oleh daemon Python
 *  4. Compile firmware via arduino-cli dengan cache persisten (--build-path)
 *  5. Upload ke ESP32 dari --input-dir
 *  6. Sambungkan ulang koneksi serial & sinkronkan OLED
 */
export async function POST(req: NextRequest) {
  if (isFlashingInProgress()) {
    return Response.json({ error: "Proses tanam model ke ESP32 sedang berlangsung." }, { status: 409 });
  }

  const reqBody = (await req.json().catch(() => ({}))) as { port?: string };
  const requestedPort = typeof reqBody.port === "string" && reqBody.port.trim() ? reqBody.port.trim() : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      let targetPort: string | null = null;
      let currentStep = 1;
      try {
        // Tahap 1: Cek & unduh otomatis dependency yang belum ada
        currentStep = 1;
        send({ step: 1, percent: 5, message: "Memeriksa Arduino CLI, Core ESP32 & Library yang dibutuhkan..." });
        const { cliPath } = await ensureAllToolchain((ev) => {
          const pct = Math.min(42, Math.max(6, Math.round(ev.percent ?? 15)));
          send({
            step: 1,
            percent: pct,
            message: ev.message,
            detail: ev.detail,
          });
        });

        // Tahap 2: Buat file dataset_model.h & deteksi port ESP32
        currentStep = 2;
        send({ step: 2, percent: 46, message: "Menyiapkan dataset_model.h dan mendeteksi port USB ESP32..." });
        const header = await buildDatasetHeader();
        fs.writeFileSync(/*turbopackIgnore: true*/ HEADER_PATH, header.content, "utf-8");

        targetPort = await detectEsp32Port(cliPath, requestedPort);
        if (!targetPort) {
          const hint =
            process.platform === "win32"
              ? "ESP32 tidak terdeteksi di port COM Windows 11. Pastikan kabel USB data terpasang dan driver CP210x/CH340 sudah terinstal."
              : "ESP32 tidak terdeteksi di /dev/ttyUSB* atau /dev/ttyACM*. Pastikan kabel USB data terpasang dan user termasuk grup dialout.";
          throw new Error(hint);
        }

        // Tahap 3: Lepas koneksi serial daemon sementara
        currentStep = 3;
        send({
          step: 3,
          percent: 54,
          message: `Melepas sementara port ${targetPort} (${header.trainCount} latih, ${header.testCount} uji, K=${header.k})`,
          detail: `Port target: ${targetPort}`,
        });
        await releaseSerialPortForFlashing();

        // Tahap 4: Compile firmware ESP32 (dengan build cache persisten agar cepat)
        currentStep = 4;
        fs.mkdirSync(/*turbopackIgnore: true*/ BUILD_DIR, { recursive: true });
        const compileStartedAt = Date.now();
        const compileMsg =
          process.platform === "win32"
            ? "Mengompilasi firmware ESP32 (kompilasi pertama di Windows membutuhkan beberapa menit)..."
            : "Mengompilasi firmware ESP32 dengan model 4-fitur terbaru...";
        send({ step: 4, percent: 62, message: compileMsg, detail: `Build cache: ${BUILD_DIR}` });
        await spawnWithProgress(
          cliPath,
          ["compile", "--fqbn", ESP32_FQBN, "--jobs", "0", "--build-path", BUILD_DIR, FIRMWARE_DIR],
          {
            timeoutMs: 900_000,
            keepaliveLabel: "Sedang mengompilasi sketch ESP32...",
            onDetail: (detail) => {
              const sec = Math.round((Date.now() - compileStartedAt) / 1000);
              const text = detail === "Sedang mengompilasi sketch ESP32..." ? `${detail} (${sec} dtk)` : detail;
              send({
                step: 4,
                percent: Math.min(78, 62 + Math.floor(sec / 20)),
                message: compileMsg,
                detail: text,
              });
            },
          },
        );

        // Tahap 5: Upload ke ESP32
        currentStep = 5;
        send({ step: 5, percent: 82, message: `Mengunggah firmware & model ke memori flash ESP32 di ${targetPort}...` });
        await spawnWithProgress(
          cliPath,
          ["upload", "-p", targetPort, "--fqbn", ESP32_FQBN, "--input-dir", BUILD_DIR, FIRMWARE_DIR],
          {
            timeoutMs: 180_000,
            keepaliveLabel: `Menulis memori flash ESP32 di ${targetPort}...`,
            onDetail: (detail) =>
              send({
                step: 5,
                percent: 88,
                message: `Mengunggah firmware & model ke memori flash ESP32 di ${targetPort}...`,
                detail,
              }),
          },
        );

        // Matikan HUPCL di Linux agar koneksi ulang tidak mereset ESP32
        if (process.platform === "linux") {
          await execFileAsync("stty", ["-F", targetPort, "-hupcl"], { windowsHide: true }).catch(() => {});
        }

        // Tahap 6: Sambungkan ulang serial & sinkronkan OLED
        currentStep = 6;
        send({ step: 6, percent: 95, message: "Menyambungkan ulang ESP32 dan menyinkronkan layar OLED..." });
        setFlashingState(false);
        await new Promise((r) => setTimeout(r, 1200));
        const rec = await reconnectSerial(targetPort);

        send({
          step: 6,
          percent: 100,
          done: true,
          ok: true,
          message: `Model "${header.datasetName}" (${header.trainCount} latih, ${header.testCount} uji, K=${header.k}) berhasil ditanam ke ESP32${rec.port ? ` (${rec.port})` : ` (${targetPort})`}.`,
        });
      } catch (err) {
        setFlashingState(false);
        if (targetPort) {
          await reconnectSerial(targetPort).catch(() => {});
        }
        const msg = err instanceof Error ? err.message : String(err);
        send({
          step: currentStep,
          percent: 100,
          done: true,
          ok: false,
          error: msg.slice(0, 420),
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
      "X-Accel-Buffering": "no",
    },
  });
}
