"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, ArchiveRestore, Check, Cpu, Database, Download, Eraser, FolderPlus, Plus, RefreshCw, ScanLine, Sparkles, SquareTerminal, Trash } from "lucide-react";
import { api, usePoll } from "@/lib/client";
import { LABELS, LABEL_INFO, QUOTA, QUOTA_PER_CLASS, SPLITS, SPLIT_INFO, fmtDateTime, fmtNum, rgbCss, type Label, type Split } from "@/lib/constants";
import type { CountsDTO, DatasetDTO, SampleDTO } from "@/lib/types";
import { Badge, Button, Card, EmptyState, MetaItems, ProgressBar, StatusDot, Swatch, cn } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeployModal } from "@/components/DeployModal";

const PAGE = 50;
const selectCls = "h-9 rounded-lg border border-line bg-black/30 px-2.5 py-1.5 text-xs leading-none text-fat-100 outline-none focus:border-beef-600";

export default function DatasetManager() {
  const [split, setSplit] = useState<"" | Split>("");
  const [label, setLabel] = useState<"" | Label>("");
  const [source, setSource] = useState("");
  const params = new URLSearchParams({ limit: "5000" });
  if (split) params.set("split", split);
  if (label) params.set("label", label);
  if (source) params.set("source", source);
  const { data, refresh, loading } = usePoll<{ samples: SampleDTO[]; counts: CountsDTO; activeDataset?: DatasetDTO }>(`/api/samples?${params.toString()}`, 6000);
  const { data: dsList, refresh: refreshDs } = usePoll<{ datasets: DatasetDTO[]; activeDatasetId: number }>("/api/datasets", 8000);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState<{ split: Split; label: Label; r: string; g: string; b: string }>({ split: "train", label: "segar", r: "", g: "", b: "" });
  const [showNewDs, setShowNewDs] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [newDs, setNewDs] = useState({ name: "", description: "", targetTrain: "144", targetTest: "36" });
  const [deployOpen, setDeployOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    tone: "danger" | "warn" | "beef";
    onConfirm: () => Promise<void>;
  } | null>(null);

  const counts = data?.counts;
  const rows = data?.samples ?? [];
  const allDatasets = dsList?.datasets ?? [];
  const activeDatasetId = dsList?.activeDatasetId ?? data?.activeDataset?.id ?? null;
  const activeDatasets = allDatasets.filter((d) => d.status === "active");
  const archivedDatasets = allDatasets.filter((d) => d.status === "archived");
  const currentDs = allDatasets.find((d) => d.id === activeDatasetId) ?? data?.activeDataset ?? null;
  const splitQuota = (s: Split) => (s === "train" ? counts?.quota?.train ?? QUOTA.train : counts?.quota?.test ?? QUOTA.test);
  const classQuota = (s: Split) => (s === "train" ? counts?.quota?.trainPerClass ?? QUOTA_PER_CLASS.train : counts?.quota?.testPerClass ?? QUOTA_PER_CLASS.test);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);

  async function act(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ tone: "ok", text });
      await Promise.all([refresh(), refreshDs()]);
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const createNewDataset = () =>
    act("newds", async () => {
      const name = newDs.name.trim();
      if (!name) throw new Error("Isi nama dataset baru terlebih dahulu.");
      const targetTrain = Math.max(3, Math.round((Number(newDs.targetTrain) || 144) / 3) * 3);
      const targetTest = Math.max(3, Math.round((Number(newDs.targetTest) || 36) / 3) * 3);
      await api("/api/datasets", {
        method: "POST",
        json: { name, description: newDs.description.trim() || null, targetTrain, targetTest },
      });
      setNewDs({ name: "", description: "", targetTrain: "144", targetTest: "36" });
      setShowNewDs(false);
      setPage(0);
      return `Dataset "${name}" dibuat (${targetTrain} latih, ${targetTest} uji) dan langsung aktif.`;
    });

  const selectDataset = (d: DatasetDTO) =>
    act(`sel${d.id}`, async () => {
      await api(`/api/datasets/${d.id}`, { method: "PATCH", json: { action: "select" } });
      setPage(0);
      return `Dataset aktif beralih ke "${d.name}".`;
    });

  const archiveDataset = (d: DatasetDTO) => {
    setConfirmModal({
      title: `Arsipkan "${d.name}"?`,
      description:
        "Dataset ini akan dipindahkan ke Arsip agar ruang kerja tetap rapi. Anda tetap bisa melanjutkannya kembali kapan saja dari menu Arsip.",
      confirmLabel: "Ya, Arsipkan",
      tone: "warn",
      onConfirm: async () => {
        await act(`arc${d.id}`, async () => {
          await api(`/api/datasets/${d.id}`, { method: "PATCH", json: { action: "archive" } });
          setPage(0);
          return `Dataset "${d.name}" dipindahkan ke Arsip.`;
        });
        setConfirmModal(null);
      },
    });
  };

  const resumeArchived = (d: DatasetDTO) =>
    act(`res${d.id}`, async () => {
      await api(`/api/datasets/${d.id}`, { method: "PATCH", json: { action: "unarchive" } });
      setPage(0);
      return `Dataset "${d.name}" dipulihkan dari Arsip dan menjadi aktif kembali.`;
    });

  const deleteDataset = (d: DatasetDTO) => {
    setConfirmModal({
      title: `Hapus permanen "${d.name}"?`,
      description:
        "Seluruh sampel latih dan uji di dalam dataset ini akan dihapus permanen dari database dan tidak dapat dikembalikan.",
      confirmLabel: "Hapus Permanen",
      tone: "danger",
      onConfirm: async () => {
        await act(`delds${d.id}`, async () => {
          await api(`/api/datasets/${d.id}`, { method: "DELETE" });
          setPage(0);
          return `Dataset "${d.name}" dihapus.`;
        });
        setConfirmModal(null);
      },
    });
  };

  const seed = () =>
    act("seed", async () => {
      const r = await api<{ inserted: number }>("/api/samples", { method: "POST", json: { action: "seed" } });
      return `${r.inserted} sampel simulasi ditambahkan untuk melengkapi kuota.`;
    });
  const wipe = (scope: "simulasi" | "all" | "history", confirmText: string) => {
    setConfirmModal({
      title:
        scope === "simulasi"
          ? "Hapus Data Simulasi?"
          : scope === "history"
            ? "Hapus Riwayat Analisa & Benchmark?"
            : "Hapus Seluruh Sampel Dataset Aktif?",
      description: confirmText,
      confirmLabel: "Ya, Hapus",
      tone: "danger",
      onConfirm: async () => {
        await act(scope, async () => {
          const r = await api<{ deleted: number }>(`/api/samples?scope=${scope}`, { method: "DELETE" });
          return `${r.deleted} data dihapus.`;
        });
        setConfirmModal(null);
      },
    });
  };
  const addManual = () =>
    act("add", async () => {
      if (form.r.trim() === "" || form.g.trim() === "" || form.b.trim() === "") {
        throw new Error("Isi nilai R, G, dan B terlebih dahulu, atau klik Baca dari ESP32.");
      }
      await api("/api/samples", { method: "POST", json: { ...form, r: Number(form.r), g: Number(form.g), b: Number(form.b) } });
      setForm((f) => ({ ...f, r: "", g: "", b: "" }));
      return "Sampel manual ditambahkan.";
    });
  const readFromEsp32 = () =>
    act("read", async () => {
      const d = await api<{ r: number; g: number; b: number }>("/api/device/read");
      setForm((f) => ({ ...f, r: String(d.r), g: String(d.g), b: String(d.b) }));
      return `Nilai RGB (${d.r}, ${d.g}, ${d.b}) berhasil dibaca dari ESP32. Klik Tambah sampel untuk menyimpan.`;
    });
  const del = (id: number) =>
    act(`del${id}`, async () => {
      await api(`/api/samples/${id}`, { method: "DELETE" });
      return `Sampel #${id} dihapus.`;
    });
  const patch = (id: number, body: Record<string, string>) =>
    act(`patch${id}`, async () => {
      await api(`/api/samples/${id}`, { method: "PATCH", json: body });
      return `Sampel #${id} diperbarui.`;
    });

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-beef-300/80">
            <Database className="h-4 w-4" /> Dataset
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-fat-50">Dataset RGB Daging Sapi</h1>
          <p className="mt-1 max-w-2xl text-sm text-fat-300/70">
            Kelola beberapa sesi dataset secara terpisah di Supabase dengan target latih dan uji dinamis. Dataset yang sudah final dapat langsung diekspor menjadi dataset_model.h untuk ditanam di ESP32.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button size="sm" variant="primary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setShowNewDs((v) => !v)}>
            New Dataset
          </Button>
          <Button size="sm" variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => setShowArchive((v) => !v)}>
            Arsip ({archivedDatasets.length})
          </Button>
          <Link href="/cli">
            <Button size="sm" variant="soft" icon={<SquareTerminal className="h-4 w-4" />}>
              Ambil via CLI 3D
            </Button>
          </Link>
          <Button
            size="sm"
            variant="primary"
            icon={<Cpu className="h-4 w-4" />}
            disabled={(counts?.train.total ?? 0) === 0}
            onClick={() =>
              setConfirmModal({
                title: "Tanam Model ke ESP32 Sekarang?",
                description: `Dataset "${currentDs?.name ?? "Aktif"}" (${counts?.train.total ?? 0} data latih, ${counts?.test.total ?? 0} data uji) akan ditulis ke dataset_model.h lalu dikompilasi dan diunggah langsung ke ESP32. Selama proses (~20 detik), seluruh halaman dikunci sementara.`,
                confirmLabel: "Mulai Tanam ke ESP32",
                tone: "beef",
                onConfirm: async () => {
                  setConfirmModal(null);
                  setDeployOpen(true);
                },
              })
            }
          >
            Tanam ke ESP32
          </Button>
          <a href="/api/samples/export-header">
            <Button size="sm" variant="soft" icon={<Download className="h-4 w-4" />}>
              Unduh .h
            </Button>
          </a>
          <a href="/api/samples/export">
            <Button size="sm" icon={<Download className="h-4 w-4" />}>Ekspor CSV</Button>
          </a>
          <Button size="sm" variant="outline" icon={<Sparkles className="h-4 w-4" />} loading={busy === "seed"} onClick={seed}>
            Isi Data Simulasi
          </Button>
        </div>
      </div>

      {showNewDs && (
        <Card
          title="Buat Dataset Baru"
          subtitle="Target latih dan uji otomatis dibagi rata ke 3 kelas (kelipatan 3) agar distribusi KNN tetap seimbang"
          icon={<FolderPlus className="h-4 w-4" />}
        >
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-fat-300/60">Nama Dataset</label>
              <input
                type="text"
                placeholder="Contoh: Daging Sapi Pasar Pagi"
                value={newDs.name}
                onChange={(e) => setNewDs((d) => ({ ...d, name: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-black/30 px-3 text-sm text-fat-100 outline-none focus:border-beef-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-fat-300/60">
                Target Latih ({Math.max(1, Math.round((Number(newDs.targetTrain) || 144) / 3))}/kelas)
              </label>
              <input
                type="number"
                min={3}
                max={3000}
                step={3}
                value={newDs.targetTrain}
                onChange={(e) => setNewDs((d) => ({ ...d, targetTrain: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-black/30 px-3 text-sm text-fat-100 outline-none focus:border-beef-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-fat-300/60">
                Target Uji ({Math.max(1, Math.round((Number(newDs.targetTest) || 36) / 3))}/kelas)
              </label>
              <input
                type="number"
                min={3}
                max={1500}
                step={3}
                value={newDs.targetTest}
                onChange={(e) => setNewDs((d) => ({ ...d, targetTest: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-black/30 px-3 text-sm text-fat-100 outline-none focus:border-beef-600"
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-fat-300/60">Catatan (opsional)</label>
              <input
                type="text"
                placeholder="Misal: Kondisi pencahayaan, jenis potongan daging, atau lokasi sampel"
                value={newDs.description}
                onChange={(e) => setNewDs((d) => ({ ...d, description: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-black/30 px-3 text-sm text-fat-100 outline-none focus:border-beef-600"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button className="flex-1" size="sm" variant="primary" loading={busy === "newds"} onClick={createNewDataset}>
                Buat & Aktifkan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewDs(false)}>
                Batal
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeDatasets.length > 0 && (
        <Card
          title="Pilih Dataset Aktif"
          subtitle="Seluruh halaman (Dashboard, CLI 3D, Evaluasi KNN, dan Ekspor .h) otomatis memakai dataset yang dipilih"
          icon={<Database className="h-4 w-4" />}
          actions={
            currentDs && (
              <Button size="sm" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} loading={busy === `arc${currentDs.id}`} onClick={() => void archiveDataset(currentDs)}>
                Arsipkan Dataset Ini
              </Button>
            )
          }
        >
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {activeDatasets.map((d) => {
              const isAct = d.id === activeDatasetId;
              return (
                <div
                  key={d.id}
                  onClick={() => !isAct && void selectDataset(d)}
                  className={cn(
                    "flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition",
                    isAct
                      ? "border-beef-500/70 bg-beef-950/40 ring-1 ring-beef-500/40"
                      : "border-line bg-black/20 hover:border-beef-700/60 hover:bg-black/35",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-fat-50">
                        {isAct && <StatusDot tone="ok" pulse />}
                        <span className="truncate">{d.name}</span>
                      </div>
                      {d.description && <div className="mt-0.5 truncate text-[11px] text-fat-300/60">{d.description}</div>}
                    </div>
                    {isAct && (
                      <Badge tone="ok">
                        <Check className="h-3 w-3" /> Aktif
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-fat-300/75">
                    <MetaItems
                      items={[
                        `Latih ${d.trainCount ?? 0}/${d.targetTrain}`,
                        `Uji ${d.testCount ?? 0}/${d.targetTest}`,
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showArchive && (
        <Card
          title="Arsip Dataset"
          subtitle="Lanjutkan pengambilan data atau evaluasi kapan saja tanpa kehilangan sampel sebelumnya"
          icon={<Archive className="h-4 w-4" />}
        >
          {archivedDatasets.length ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {archivedDatasets.map((d) => (
                <div key={d.id} className="flex flex-col justify-between rounded-xl border border-line bg-black/25 p-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-fat-100">{d.name}</span>
                      <Badge tone="neutral">Arsip</Badge>
                    </div>
                    {d.description && <p className="mt-0.5 truncate text-[11px] text-fat-300/60">{d.description}</p>}
                    <div className="mt-2 text-[11px] text-fat-300/75">
                      <MetaItems
                        items={[
                          `Latih ${d.trainCount ?? 0}/${d.targetTrain}`,
                          `Uji ${d.testCount ?? 0}/${d.targetTest}`,
                        ]}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="soft" className="flex-1" icon={<ArchiveRestore className="h-3.5 w-3.5" />} loading={busy === `res${d.id}`} onClick={() => void resumeArchived(d)}>
                      Lanjutkan
                    </Button>
                    <Button size="sm" variant="danger" icon={<Trash className="h-3.5 w-3.5" />} loading={busy === `delds${d.id}`} onClick={() => void deleteDataset(d)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Archive className="h-5 w-5" />}
              title="Belum ada dataset yang diarsipkan"
              desc="Klik Arsipkan Dataset Ini pada dataset aktif untuk menyimpannya ke arsip dan memulai dataset baru."
            />
          )}
        </Card>
      )}

      {msg && (
        <div className={cn("rounded-xl border px-4 py-2.5 text-sm", msg.tone === "ok" ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200" : "border-red-900/60 bg-red-950/40 text-red-200")}>
          {msg.text}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {SPLITS.map((s) => (
          <Card key={s} title={SPLIT_INFO[s].name} subtitle={`${counts?.[s].total ?? 0} / ${splitQuota(s)} sampel`} icon={<Database className="h-4 w-4" />}>
            <div className="grid grid-cols-3 gap-3">
              {LABELS.map((l) => {
                const n = counts?.[s][l] ?? 0;
                const q = classQuota(s);
                return (
                  <div key={l} className="flex flex-col justify-between rounded-xl border border-line bg-black/20 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: LABEL_INFO[l].textColor }}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_INFO[l].color }} />
                      <span className="truncate">{LABEL_INFO[l].name}</span>
                    </div>
                    <div className="mt-1 text-xl font-bold text-fat-50">
                      {n}
                      <span className="text-sm font-normal text-fat-300/50">/{q}</span>
                    </div>
                    <ProgressBar value={n} max={q} color={LABEL_INFO[l].color} className="mt-2" />
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title="Daftar Sampel"
          subtitle={`${rows.length} baris${source || split || label ? " (difilter)" : ""}`}
          icon={<Database className="h-4 w-4" />}
          actions={
            <>
              <select className={selectCls} value={split} onChange={(e) => { setSplit(e.target.value as "" | Split); setPage(0); }}>
                <option value="">Semua set</option>
                <option value="train">Data latih</option>
                <option value="test">Data uji</option>
              </select>
              <select className={selectCls} value={label} onChange={(e) => { setLabel(e.target.value as "" | Label); setPage(0); }}>
                <option value="">Semua kelas</option>
                {LABELS.map((l) => (
                  <option key={l} value={l}>
                    {LABEL_INFO[l].name}
                  </option>
                ))}
              </select>
              <select className={selectCls} value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}>
                <option value="">Semua sumber</option>
                <option value="device">ESP32</option>
                <option value="manual">Manual</option>
                <option value="simulasi">Simulasi</option>
              </select>
              <Button size="sm" variant="ghost" icon={<RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />} onClick={() => void refresh()} />
            </>
          }
          bodyClassName="p-0"
        >
          {rows.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Waktu</th>
                      <th>Set</th>
                      <th>Kelas</th>
                      <th>RGB (0 sampai 255)</th>
                      <th>Raw R/G/B/C</th>
                      <th>Sumber</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((s) => (
                      <tr key={s.id}>
                        <td className="font-mono text-fat-300/60">#{s.id}</td>
                        <td className="font-mono text-fat-300/80">{fmtDateTime(s.createdAt)}</td>
                        <td>
                          <select className="rounded-md border border-line bg-black/30 px-1.5 py-1 text-xs text-fat-100" value={s.split} onChange={(e) => void patch(s.id, { split: e.target.value })}>
                            <option value="train">latih</option>
                            <option value="test">uji</option>
                          </select>
                        </td>
                        <td>
                          <select
                            className="rounded-md border border-line bg-black/30 px-1.5 py-1 text-xs"
                            style={{ color: LABEL_INFO[s.label]?.textColor }}
                            value={s.label}
                            onChange={(e) => void patch(s.id, { label: e.target.value })}
                          >
                            {LABELS.map((l) => (
                              <option key={l} value={l}>
                                {LABEL_INFO[l].name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className="flex items-center gap-2 font-mono">
                            <Swatch r={s.r} g={s.g} b={s.b} />({fmtNum(s.r, 1)}, {fmtNum(s.g, 1)}, {fmtNum(s.b, 1)})
                          </span>
                        </td>
                        <td className="font-mono text-fat-300/70">{s.rawC != null ? `${s.rawR}/${s.rawG}/${s.rawB}/${s.rawC}` : "-"}</td>
                        <td>
                          {s.source === "simulasi" ? <Badge tone="info">simulasi</Badge> : s.source === "manual" ? <Badge tone="warn">manual</Badge> : <Badge tone="ok">ESP32</Badge>}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => void del(s.id)}
                            className="rounded-md p-1.5 text-fat-300/50 hover:bg-red-950/50 hover:text-red-300"
                            title="Hapus"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between border-t border-line/70 px-5 py-3 text-xs text-fat-300/70">
                  <span>
                    Halaman {page + 1} dari {pages}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      Sebelumnya
                    </Button>
                    <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                      Berikutnya
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-5">
              <EmptyState
                icon={<Database className="h-5 w-5" />}
                title="Belum ada sampel"
                desc="Gunakan CLI 3D (perintah: sesi segar latih) untuk mengambil data dari ESP32, atau isi kuota dengan data simulasi untuk uji coba."
              />
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Tambah Manual / Sensor" subtitle="Isi angka RGB atau baca langsung dari ESP32" icon={<Plus className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select className={selectCls} value={form.split} onChange={(e) => setForm((f) => ({ ...f, split: e.target.value as Split }))}>
                  <option value="train">Data latih</option>
                  <option value="test">Data uji</option>
                </select>
                <select className={selectCls} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value as Label }))}>
                  {LABELS.map((l) => (
                    <option key={l} value={l}>
                      {LABEL_INFO[l].name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="w-full"
                size="sm"
                variant="soft"
                icon={<ScanLine className="h-3.5 w-3.5" />}
                loading={busy === "read"}
                onClick={readFromEsp32}
              >
                Baca RGB dari ESP32
              </Button>
              <div className="grid grid-cols-3 gap-2">
                {(["r", "g", "b"] as const).map((ch) => (
                  <input
                    key={ch}
                    type="number"
                    min={0}
                    max={255}
                    step="0.01"
                    placeholder={ch.toUpperCase()}
                    value={form[ch]}
                    onChange={(e) => setForm((f) => ({ ...f, [ch]: e.target.value }))}
                    className="h-9 rounded-lg border border-line bg-black/30 px-2.5 text-sm text-fat-100 outline-none focus:border-beef-600"
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-white/15"
                  style={{
                    background:
                      form.r.trim() !== "" && form.g.trim() !== "" && form.b.trim() !== ""
                        ? rgbCss(Number(form.r), Number(form.g), Number(form.b))
                        : "transparent",
                  }}
                />
                <Button className="flex-1" variant="primary" icon={<Plus className="h-4 w-4" />} loading={busy === "add"} onClick={addManual}>
                  Tambah sampel
                </Button>
              </div>
              {(form.r.trim() === "" || form.g.trim() === "" || form.b.trim() === "") && (
                <p className="text-[11px] text-fat-300/60">
                  Isi nilai R, G, dan B atau klik Baca RGB dari ESP32 untuk mengambil warna sensor.
                </p>
              )}
            </div>
          </Card>

          <Card title="Pembersihan Data" subtitle="Tindakan tidak dapat dibatalkan" icon={<Eraser className="h-4 w-4" />}>
            <div className="space-y-2">
              <Button
                className="w-full justify-start"
                icon={<Sparkles className="h-4 w-4" />}
                loading={busy === "simulasi"}
                onClick={() => wipe("simulasi", "Hapus semua data SIMULASI (sampel, riwayat & benchmark)?")}
              >
                Hapus data simulasi ({counts?.bySource.simulasi ?? 0})
              </Button>
              <Button
                className="w-full justify-start"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={busy === "history"}
                onClick={() => wipe("history", "Hapus seluruh riwayat klasifikasi & benchmark?")}
              >
                Hapus riwayat analisa & benchmark
              </Button>
              <Button
                className="w-full justify-start"
                variant="danger"
                icon={<Trash className="h-4 w-4" />}
                loading={busy === "all"}
                onClick={() => wipe("all", "HAPUS SELURUH DATASET (latih & uji)? Tindakan ini tidak dapat dibatalkan.")}
              >
                Hapus seluruh dataset
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmModal)}
        title={confirmModal?.title ?? ""}
        description={confirmModal?.description ?? ""}
        confirmLabel={confirmModal?.confirmLabel}
        tone={confirmModal?.tone}
        loading={Boolean(busy)}
        onConfirm={() => void confirmModal?.onConfirm()}
        onCancel={() => setConfirmModal(null)}
      />
      <DeployModal
        open={deployOpen}
        datasetLabel={currentDs?.name}
        onClose={(succeeded) => {
          setDeployOpen(false);
          if (succeeded) {
            setMsg({ tone: "ok", text: "Model fix berhasil ditanam ke memori flash ESP32 dan OLED telah disinkronkan." });
            void Promise.all([refresh(), refreshDs()]);
          }
        }}
      />
    </div>
  );
}
