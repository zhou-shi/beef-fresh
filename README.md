# Beef Fresh — Klasifikasi Kesegaran Daging Sapi (KNN K=3 & Feature Scaling Min-Max) pada ESP32

Implementasi penuh sistem penelitian **Beef Fresh** untuk menganalisis pengaruh **Feature Scaling Min-Max (0–1)** terhadap tingkat akurasi klasifikasi algoritma **K-Nearest Neighbors (KNN, K=3)** dalam membedakan daging sapi **Segar**, **Mulai Membusuk**, dan **Busuk**, serta evaluasi performa algoritma KNN pada mikrokontroler **ESP32** ditinjau dari aspek **Waktu Eksekusi (*Execution Time*)** dan **Konsumsi Memori (*Memory Usage*)**.

---

## 1. Jalur Pin Perangkat Keras (ESP32 + TCS34725 + OLED SSD1306)

Sesuai rancangan **Kepala Perangkat dengan Tuas Mauve** (penerangan menggunakan lampu LED putih internal pada sensor TCS34725):

| Pin ESP32 (`ESP32-D0WD-V3`) | Tujuan Komponen | Keterangan |
| :--- | :--- | :--- |
| **3V3** | Sensor `VIN` & OLED `VCC` | Catu daya 3.3V |
| **G26 (GPIO 26)** | Sensor `SDA` & OLED `SDA` | Jalur Data I2C (`0x29` & `0x3C`) |
| **G27 (GPIO 27)** | Sensor `SCL` & OLED `SCL` | Jalur Clock I2C (`0x29` & `0x3C`) |
| **GND** | Sensor `GND` & OLED `GND` | Ground bersama |

---

## 2. Struktur Proyek

- [`firmware/beef_fresh_esp32/beef_fresh_esp32.ino`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/firmware/beef_fresh_esp32/beef_fresh_esp32.ino): Firmware mikrokontroler ESP32 Dual-Mode (USB Serial Bridge `/dev/ttyUSB0` + Wi-Fi HTTPS) dengan implementasi **Normalisasi Min-Max (0–1)**, **KNN (`K=3`)**, tampilan real-time **OLED SSD1306**, serta pengukuran presisi tinggi `esp_timer_get_time()` (`µs`) dan konsumsi memori SRAM/Heap (`Bytes`).
- [`firmware/beef_fresh_esp32/dataset_model.h`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/firmware/beef_fresh_esp32/dataset_model.h): Matriks **144 Data Latih (80%)** dan **36 Data Uji (20%)** beserta batas kalibrasi Min-Max.
- [`cli/beef_fresh_cli.py`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/cli/beef_fresh_cli.py): **CLI 3D Modern Interaktif** untuk kontrol akuisisi 144 data latih & 36 data uji, pemicu analisa daging mandiri, benchmark performa ESP32, dan sinkronisasi Supabase.
- [`server.py`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/server.py): Server HTTP & REST API Bridge yang menghubungkan Website Interaktif, ESP32 (`/dev/ttyUSB0`), dan Supabase Cloud.
- [`web/index.html`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/web/index.html), [`web/styles.css`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/web/styles.css), [`web/app.js`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/web/app.js): **Website Pemantauan Interaktif & 3D** dengan tombol **Trigger Analisa Daging**, model 3D *Kepala Perangkat dengan Tuas Mauve*, evaluasi Feature Scaling Min-Max vs Tanpa Scaling, serta metrik *Execution Time* dan *Memory Usage* ESP32.
- [`supabase/schema.sql`](file:///home/surya-asi/Hermes/Antigravity/Projects/Beef-Fresh/supabase/schema.sql): Skema tabel PostgreSQL & kebijakan RLS untuk proyek Supabase (`beef_dataset`, `beef_measurements`, `beef_evaluations`, `device_commands`).

---

## 3. Cara Menjalankan

### A. Menjalankan CLI 3D Modern Interaktif
```bash
python3 cli/beef_fresh_cli.py
```
Atau mode perintah cepat:
```bash
# Menjalankan Benchmark Hardware ESP32 (144 Data Latih & 36 Data Uji):
python3 cli/beef_fresh_cli.py --benchmark

# Memicu Analisa Daging Mandiri pada ESP32 & Layar OLED:
python3 cli/beef_fresh_cli.py --analyze

# Menyinkronkan 144 Data Latih + 36 Data Uji ke Supabase:
python3 cli/beef_fresh_cli.py --sync
```

### B. Menjalankan Website Pemantauan Interaktif
```bash
python3 server.py
```
Buka di browser: **`http://localhost:3000`**
