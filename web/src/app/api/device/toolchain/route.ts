import { checkToolchainStatus, ensureAllToolchain } from "@/lib/server/toolchain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await checkToolchainStatus();
    return Response.json({ ok: true, status });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };
      try {
        send({ step: 1, percent: 4, message: "Memeriksa Arduino CLI, Core ESP32, Library, dan Python PySerial..." });
        const { status } = await ensureAllToolchain((ev) => {
          send({
            step: ev.step ?? 1,
            percent: ev.percent ?? 20,
            message: ev.message,
            detail: ev.detail,
          });
        });
        send({
          step: 1,
          percent: 100,
          done: true,
          ok: true,
          status,
          message: status.ready
            ? "Semua toolchain ESP32 (Arduino CLI, Core ESP32, Library, dan PySerial) siap digunakan."
            : "Arduino CLI & library ESP32 siap. Catatan: Python PySerial belum terpasang (monitoring USB serial butuh Python 3).",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({
          step: 0,
          percent: 100,
          done: true,
          ok: false,
          error: msg.slice(0, 400),
          message: "Penyiapan toolchain ESP32 gagal.",
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
