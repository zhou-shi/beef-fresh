import { LABEL_INFO, SCALING_INFO, type Label, type Scaling } from "./constants";

/** State visual model 3D alat (dikendalikan oleh CLI dan sinkron dengan OLED fisik) */
export interface DeviceVisual {
  led: boolean;
  scanning: boolean;
  lidOpen: boolean;
  xray: boolean;
  labels: boolean;
  autoRotate: boolean;
  oled: string[];
  meatColor: string | null;
}

export const DEFAULT_VISUAL: DeviceVisual = {
  led: true,
  scanning: false,
  lidOpen: false,
  xray: false,
  labels: true,
  autoRotate: false,
  oled: ["BEEF FRESH | SIAP", "RGB : --, --, --", "Norm: --, --, --", "=SIAP MENGUKUR", "KNN:--us Mem:2.3KB"],
  meatColor: null,
};

const r0 = (n: number) => Math.round(n);
const f2 = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? n.toFixed(2) : "0.00");

/**
 * Pembangun frame OLED 128x64 yang 1:1 identik dengan firmware ESP32:
 *  - Mode Pengambilan Dataset (updateOLEDDataset): kotak sorot kelas + counter + progress bar (tanpa prediksi KNN)
 *  - Mode Analisa Cerdas (updateOLED): RGB asli, RGB norm, kotak sorot HASIL, waktu KNN & memori
 */
export const OLED = {
  idle: (status = "SIAP") => [
    `BEEF FRESH | ${status}`,
    "RGB : --, --, --",
    "Norm: --, --, --",
    "=SIAP MENGUKUR",
    "KNN:--us Mem:2.3KB",
  ],

  /** Tampilan OLED saat menunggu/membaca sampel dataset (tanpa prediksi KNN) */
  capturing: (label: Label, split: string, count = 0, quota = 48, isSim = false) => [
    isSim
      ? split === "test"
        ? "SIM DATA UJI"
        : "SIM DATA LATIH"
      : split === "test"
        ? "AMBIL DATA UJI"
        : "AMBIL DATA LATIH",
    `=${LABEL_INFO[label].oled}|${count}/${quota}`,
    "Membaca TCS34725",
    "Tempel tabung sensor",
    `#${count}/${quota}`,
  ],

  /** Tampilan OLED setelah sampel dataset tersimpan (identik dengan updateOLEDDataset di ESP32) */
  saved: (
    _id: number,
    label: Label,
    r: number,
    g: number,
    b: number,
    split = "train",
    count = 1,
    quota = 48,
    isSim = false,
  ) => [
    isSim
      ? split === "test"
        ? "SIM DATA UJI"
        : "SIM DATA LATIH"
      : split === "test"
        ? "AMBIL DATA UJI"
        : "AMBIL DATA LATIH",
    `=${LABEL_INFO[label].oled}|${count}/${quota}`,
    `RGB : ${r0(r)}, ${r0(g)}, ${r0(b)}`,
    isSim ? "SIMULASI TERSIMPAN" : "SAMPEL TERSIMPAN",
    `#${count}/${quota}`,
  ],

  /** Tampilan OLED saat proses analisa cerdas KNN berjalan */
  analyzing: (scaling: Scaling, k: number, isSim = false) => [
    isSim ? `SIMULASI | KNN K=${k}` : `BEEF FRESH | KNN K=${k}`,
    `Metode: ${SCALING_INFO[scaling].short}`,
    "Membaca sensor RGB",
    "=MENGANALISA DAGING",
    "Mohon tunggu...",
  ],

  /** Tampilan OLED hasil analisa cerdas KNN (identik dengan updateOLED di ESP32) */
  result: (
    label: Label,
    r: number,
    g: number,
    b: number,
    execUs?: number | null,
    rn?: number | null,
    gn?: number | null,
    bn?: number | null,
    isSim = false,
    k = 3,
  ) => [
    isSim ? `SIMULASI | KNN K=${k}` : `BEEF FRESH | KNN K=${k}`,
    `RGB : ${r0(r)}, ${r0(g)}, ${r0(b)}`,
    `Norm: ${f2(rn)},${f2(gn)},${f2(bn)}`,
    `=HASIL: ${LABEL_INFO[label].oled}`,
    `KNN:${execUs != null ? r0(execUs) : "--"}us Mem:2.3KB`,
  ],

  message: (title: string, ...rest: string[]) => [title, ...rest],
};
