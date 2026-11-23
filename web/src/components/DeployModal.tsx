"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, LoaderCircle, ShieldAlert, XCircle } from "lucide-react";
import { Button, ProgressBar, cn } from "./ui";

const STEPS = [
  { id: 1, label: "Menyiapkan file dataset_model.h" },
  { id: 2, label: "Melepas sementara port serial USB" },
  { id: 3, label: "Mengompilasi firmware ESP32" },
  { id: 4, label: "Mengunggah model ke memori flash ESP32" },
  { id: 5, label: "Menyambungkan ulang dan sinkronisasi OLED" },
];

export interface DeployModalProps {
  open: boolean;
  datasetLabel?: string;
  onClose: (succeeded: boolean) => void;
}

/**
 * Modal progres penuh yang mengunci seluruh interaksi website selama proses
 * kompilasi & upload model fix ke ESP32 agar tidak terganggu.
 */
export function DeployModal({ open, datasetLabel, onClose }: DeployModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const startedRef = useRef(false);
  const [step, setStep] = useState(0);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState("Memulai proses tanam model ke ESP32");
  const [done, setDone] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    setStep(1);
    setPercent(5);
    setMessage("Menghubungi server untuk menanam dataset aktif ke ESP32");
    setDone(false);
    setOk(false);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch("/api/device/deploy-model", { method: "POST", cache: "no-store" });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done: streamDone } = await reader.read();
          if (value) {
            buf += decoder.decode(value, { stream: true });
            let nl = buf.indexOf("\n");
            while (nl >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (line) {
                const ev = JSON.parse(line) as {
                  step?: number;
                  percent?: number;
                  message?: string;
                  done?: boolean;
                  ok?: boolean;
                  error?: string;
                };
                if (typeof ev.step === "number" && ev.step > 0) setStep(ev.step);
                if (typeof ev.percent === "number") setPercent(ev.percent);
                if (ev.message) setMessage(ev.message);
                if (ev.done) {
                  setDone(true);
                  setOk(Boolean(ev.ok));
                  if (ev.error) setError(ev.error);
                }
              }
              nl = buf.indexOf("\n");
            }
          }
          if (streamDone) break;
        }
      } catch (e) {
        setDone(true);
        setOk(false);
        setPercent(100);
        setMessage("Proses tanam model ke ESP32 gagal.");
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    void run();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        // Kunci total tombol Esc saat proses kompilasi/upload masih berlangsung
        e.preventDefault();
        if (done) onClose(ok);
      }}
      className="m-auto w-[min(94vw,520px)] overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fat-100 shadow-[0_30px_90px_-16px_rgba(0,0,0,0.45)] backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:shadow-[0_30px_90px_-16px_rgba(0,0,0,0.92)] dark:backdrop:bg-black/85"
    >
      <div className="p-6">
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1",
              done
                ? ok
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:ring-emerald-700/50"
                  : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/80 dark:text-red-300 dark:ring-red-700/50"
                : "bg-beef-100/80 text-beef-700 ring-beef-300/60 dark:bg-beef-900/70 dark:text-beef-300 dark:ring-beef-700/50",
            )}
          >
            {done ? (
              ok ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )
            ) : (
              <Cpu className="h-5 w-5 animate-pulse" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight text-fat-50">
              {done ? (ok ? "Model Berhasil Ditanam ke ESP32" : "Tanam Model Gagal") : "Menanam Model ke ESP32"}
            </h3>
            <p className="mt-0.5 text-xs text-fat-300/70">
              {datasetLabel ? `Dataset: ${datasetLabel}` : "Dataset aktif sedang ditulis ke memori flash ESP32."}
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-beef-700 dark:text-beef-200">{percent}%</span>
        </div>

        <div className="mt-4">
          <ProgressBar
            value={percent}
            max={100}
            color={done ? (ok ? "#34d399" : "#f87171") : "#e5383b"}
            className="h-2.5"
          />
          <div className="mt-2 text-xs font-medium text-fat-100">{message}</div>
        </div>

        <ol className="mt-4 space-y-2 rounded-xl border border-line bg-black/30 p-3.5 text-xs">
          {STEPS.map((s) => {
            const isFinished = done ? ok : step > s.id;
            const isCurrent = !done && step === s.id;
            return (
              <li key={s.id} className="flex items-center gap-2.5">
                {isFinished ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : isCurrent ? (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-beef-600 dark:text-beef-300" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border border-fat-300/35" />
                )}
                <span
                  className={cn(
                    isFinished ? "text-emerald-700 dark:text-emerald-200/90" : isCurrent ? "font-semibold text-fat-50" : "text-fat-300/55",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        {!done && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/35 dark:text-amber-200/90">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <span>Jangan cabut kabel USB ESP32 atau tutup halaman ini hingga proses selesai 100%.</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 font-mono text-[11px] text-red-800 break-words dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end border-t border-line/70 pt-4">
          <Button
            size="sm"
            variant={done ? (ok ? "primary" : "outline") : "ghost"}
            disabled={!done}
            onClick={() => onClose(ok)}
          >
            {done ? (ok ? "Selesai" : "Tutup") : "Proses sedang berjalan"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
