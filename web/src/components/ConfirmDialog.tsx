"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Archive, Trash2, X } from "lucide-react";
import { Button, cn } from "./ui";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warn" | "beef";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Dialog konfirmasi kustom berbasis elemen native <dialog>
 * yang selaras dengan tema dark-crimson Beef Fresh.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  tone = "beef",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  if (!open) return null;

  const iconBox =
    tone === "danger"
      ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/80 dark:text-red-300 dark:ring-red-700/50"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:ring-amber-700/50"
        : "bg-beef-100/80 text-beef-700 ring-beef-300/60 dark:bg-beef-900/70 dark:text-beef-300 dark:ring-beef-700/50";

  const Icon = tone === "danger" ? Trash2 : tone === "warn" ? Archive : AlertTriangle;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !loading) onCancel();
      }}
      className="m-auto w-[min(92vw,440px)] overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fat-100 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.45)] backdrop:bg-black/55 backdrop:backdrop-blur-xs dark:shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)] dark:backdrop:bg-black/75"
    >
      <div className="relative p-5">
        <button
          type="button"
          disabled={loading}
          onClick={onCancel}
          aria-label="Tutup dialog"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-fat-300/60 transition hover:bg-white/5 hover:text-fat-50 disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1", iconBox)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-fat-50">{title}</h3>
            <div className="mt-1.5 text-xs leading-relaxed text-fat-300/75">{description}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-line/70 pt-4">
          <Button size="sm" variant="ghost" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={tone === "danger" ? "danger" : "primary"}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
