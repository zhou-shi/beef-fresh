# Beef Fresh — Feature Scaling × KNN untuk Kesegaran Daging Sapi

Sistem klasifikasi kesegaran daging sapi (**Segar / Mulai Membusuk / Busuk**) berbasis warna RGB dari sensor
**TCS34725**, dijalankan dengan **KNN di ESP32**, hasil di **OLED SSD1306**, dan website interaktif untuk kontrol,
pengambilan dataset (144 latih + 36 uji) serta analisis pengaruh **feature scaling** (Tanpa / Min-Max / Z-Score)
terhadap akurasi & performa ESP32 (waktu eksekusi dan konsumsi memori).

## Perangkat keras

| ESP32 | Tujuan | Sinyal |
|---|---|---|
| 3V3 | Sensor VIN, OLED VCC | Catu 3,3 V |
| GND | Sensor GND, OLED GND | Ground |
| G26 | Sensor SDA, OLED SDA | I2C SDA |
| G27 | Sensor SCL, OLED SCL | I2C SCL |

- LED putih eksternal **tidak digunakan** — penerangan memakai LED bawaan modul TCS34725.
- Bentuk alat: kotak putih, tutup depan berengsel 25 mm + kait (tuas), tabung hitam peredam cahaya,
  lubang port USB di samping, OLED di panel belakang (lihat model 3D di menu **Perangkat** / **CLI 3D**).
- Firmware: `public/firmware/beef_fresh_esp32.ino` (juga dapat diunduh dari halaman Perangkat dengan alamat server terisi otomatis).

## Fitur

1. **CLI 3D interaktif** (`/cli`) — terminal + model 3D alat + replika OLED. Perintah utama:
   `sesi segar latih` (Enter = ambil sampel), `ambil busuk uji 5`, `progres`, `analisa minmax 5`,
   `evaluasi`, `benchmark`, `status`, `pin`, `sim on`, `3d xray`, `bantuan`.
   Versi terminal asli: `node cli/beef-cli.mjs --url https://alamat-website`.
2. **Dashboard** (`/`) — tombol **Analisa Daging** (pengganti tombol fisik), hasil klasifikasi,
   grafik akurasi per metode scaling, akurasi vs K, performa KNN di ESP32 (µs & byte), riwayat.
3. **Evaluasi** (`/evaluasi`) — confusion matrix, presisi/recall/F1, CV 5-fold, parameter scaling,
   contoh perhitungan, scatter 3D ruang fitur, prediksi tiap data uji.
4. **Dataset** (`/dataset`) — progres kuota, edit/hapus, input manual, ekspor CSV (+ kolom Min-Max & Z-Score).

## Alur data

```
Website (tombol/CLI) ──► antrean perintah (DB) ◄── ESP32 polling GET /api/device/poll
ESP32: baca TCS34725 → feature scaling → KNN → OLED ──► POST /api/device/result ──► DB ──► Dashboard
ESP32 mengunduh dataset dari GET /api/device/model (disimpan di LittleFS, parameter scaling di-fit di ESP32)
```

## Database / Supabase

Data disimpan di PostgreSQL melalui Drizzle ORM (`src/db/schema.ts`). Untuk memakai **Supabase**, isi
`DATABASE_URL` dengan connection string Postgres Supabase lalu jalankan `npx drizzle-kit push`.

Variabel lingkungan opsional: `DEVICE_API_KEY` — jika di-set, ESP32 wajib mengirim header `x-device-key` yang sama.

## Mode simulasi

Aktifkan dari dashboard atau CLI (`sim on`) untuk menguji seluruh alur tanpa alat: perintah dijalankan oleh
ESP32 virtual di server dan datanya bertanda `simulasi` (dapat dihapus sekaligus sebelum pengambilan data nyata).
