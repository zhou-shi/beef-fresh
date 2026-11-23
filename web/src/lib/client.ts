"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandDTO } from "./types";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...((headers as Record<string, string> | undefined) ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

/** Polling data JSON secara berkala (berhenti saat tab tidak terlihat & tidak menumpuk request) */
export function usePoll<T>(url: string | null, intervalMs = 3000) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const lastJson = useRef<string | null>(null);

  const runFetch = useCallback(
    async (force: boolean): Promise<T | undefined> => {
      if (!url) return undefined;
      if (!force && inFlight.current) return undefined;
      inFlight.current = true;
      const my = ++seq.current;
      try {
        const d = await api<T>(url, { signal: AbortSignal.timeout(15_000) });
        if (my === seq.current) {
          const serialized = JSON.stringify(d);
          if (serialized !== lastJson.current) {
            lastJson.current = serialized;
            setData(d);
          }
          setError(null);
        }
        return d;
      } catch (e) {
        if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        if (my === seq.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [url],
  );

  const refresh = useCallback(() => runFetch(true), [runFetch]);

  useEffect(() => {
    if (!url) return;
    lastJson.current = null;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(async () => {
        if (!cancelled && document.visibilityState === "visible") {
          await runFetch(false);
        }
        schedule();
      }, intervalMs);
    };

    void runFetch(true).finally(schedule);

    const onVis = () => {
      if (document.visibilityState === "visible") void runFetch(false);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [url, intervalMs, runFetch]);

  return { data, error, loading, refresh, setData };
}

export const FINAL_STATUSES = ["done", "failed", "expired", "cancelled"];
export const isFinal = (s: string) => FINAL_STATUSES.includes(s);

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export interface CreateCommandResponse {
  command: CommandDTO;
  simulated: boolean;
  deviceOnline?: boolean;
}

export function createCommand(type: string, payload: Record<string, unknown> = {}) {
  return api<CreateCommandResponse>("/api/commands", { method: "POST", json: { type, payload } });
}

export async function cancelCommand(id: number) {
  try {
    await api(`/api/commands/${id}`, { method: "DELETE" });
  } catch {
    /* abaikan */
  }
}

export async function waitForCommand(
  id: number,
  opts: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number; onTick?: (c: CommandDTO) => void } = {},
): Promise<CommandDTO> {
  const started = Date.now();
  const timeout = opts.timeoutMs ?? 60_000;
  for (;;) {
    if (opts.signal?.aborted) {
      await cancelCommand(id);
      throw new Error("Dibatalkan oleh pengguna");
    }
    const { command } = await api<{ command: CommandDTO }>(`/api/commands/${id}`);
    opts.onTick?.(command);
    if (isFinal(command.status)) return command;
    if (Date.now() - started > timeout) {
      await cancelCommand(id);
      throw new Error("Waktu tunggu habis karena ESP32 tidak merespons.");
    }
    await sleep(opts.intervalMs ?? 700, opts.signal);
  }
}
