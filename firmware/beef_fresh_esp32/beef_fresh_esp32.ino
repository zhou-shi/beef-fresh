#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_TCS34725.h>
#include "esp_timer.h"
#include "dataset_model.h"

// Pinout sesuai rancangan:
// ESP32 3V3 -> Sensor VIN & OLED VCC
// ESP32 G26 -> Sensor SDA & OLED SDA
// ESP32 G27 -> Sensor SCL & OLED SCL
// ESP32 GND -> Sensor GND & OLED GND
#define SDA_PIN 26
#define SCL_PIN 27
#define TCS_LED_PIN 25  // Opsional: hubungkan pin LED TCS34725 ke G25 (atau jumper LED ke INT)
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_154MS, TCS34725_GAIN_16X);
Preferences prefs;

bool oledReady = false;
bool tcsReady = false;

// Kalibrasi 2 Titik (Putih = 255, Hitam/Gelap = 0) disimpan permanen di NVS Flash
bool wbWhiteOk = false;
bool wbBlackOk = false;
float wbWhite[3] = {0.0f, 0.0f, 0.0f};
float wbBlack[3] = {0.0f, 0.0f, 0.0f};

// Fitur 4D (r = R/sum, g = G/sum, b = B/sum, L = sum/3) di SRAM ESP32
#ifndef NUM_FEATURES
#define NUM_FEATURES 4
#endif

struct SampleFeature {
  float f[NUM_FEATURES];
  uint8_t class_id;
};

SampleFeature trainDataRawFeat[NUM_TRAIN_SAMPLES];
SampleFeature trainDataScaled[NUM_TRAIN_SAMPLES];

#define MAX_KNN_K 15

struct NeighborInfo {
  int index;
  uint8_t class_id;
  float distance;
};

struct KNNResult {
  uint8_t predicted_class;
  uint8_t k_used;
  float confidence;
  NeighborInfo top_k[MAX_KNN_K];
  uint32_t exec_time_us;
  uint32_t work_mem_bytes;
};

// Kredensial Dual-Mode (Wi-Fi & Supabase - isi lewat CLI/NVS atau ganti placeholder ini)
String wifiSSID = "";
String wifiPass = "";
String supabaseUrl = "https://your-project.supabase.co";
String supabaseKey = "YOUR_SUPABASE_ANON_KEY";

// State pengukuran terakhir untuk tampilan OLED
float lastR = 0, lastG = 0, lastB = 0;
float lastFeatNorm[NUM_FEATURES] = {0.0f, 0.0f, 0.0f, 0.0f};
uint8_t lastClass = 0;
uint32_t lastExecUs = 0;
bool hasAnalyzed = false;

const char* classLabel(uint8_t cid) {
  switch (cid) {
    case 0: return "Segar";
    case 1: return "Mulai Membusuk";
    case 2: return "Busuk";
    default: return "Tidak Diketahui";
  }
}

const char* classShortLabel(uint8_t cid) {
  switch (cid) {
    case 0: return "SEGAR";
    case 1: return "MULAI BUSUK";
    case 2: return "BUSUK";
    default: return "STANDBY";
  }
}

// Fungsi Pembantu & Ekstraksi Fitur (r, g, b, L) + Normalisasi Min-Max
inline float clamp01(float v) {
  if (v < 0.0f) return 0.0f;
  if (v > 1.0f) return 1.0f;
  return v;
}

inline void extractFeatures(float r, float g, float b, float out[NUM_FEATURES]) {
  float sum = r + g + b;
  if (sum <= 0.0001f) {
    out[0] = 0.0f;
    out[1] = 0.0f;
    out[2] = 0.0f;
    out[3] = 0.0f;
    return;
  }
  out[0] = r / sum;
  out[1] = g / sum;
  out[2] = b / sum;
  out[3] = sum / 3.0f;
}

inline const char* detectSurfaceWarning(float r, float g, float b) {
  float f[NUM_FEATURES];
  extractFeatures(r, g, b, f);
  if (f[3] < 8.0f) return "too_dark";
  if (f[3] >= 110.0f && f[0] < 0.385f) return "fat_or_membrane";
  return "ok";
}

void computeMinMaxBoundsFromTrain() {
  for (int i = 0; i < NUM_TRAIN_SAMPLES; i++) {
    extractFeatures(trainDataRaw[i].r, trainDataRaw[i].g, trainDataRaw[i].b, trainDataRawFeat[i].f);
    trainDataRawFeat[i].class_id = trainDataRaw[i].class_id;
    for (int j = 0; j < NUM_FEATURES; j++) {
      float v = trainDataRawFeat[i].f[j];
      if (i == 0 || v < MINMAX_F_MIN[j]) MINMAX_F_MIN[j] = v;
      if (i == 0 || v > MINMAX_F_MAX[j]) MINMAX_F_MAX[j] = v;
    }
  }
}

uint32_t normalizeSingleSample(float r, float g, float b, float out_norm[NUM_FEATURES]) {
  int64_t t0 = esp_timer_get_time();
  float raw_f[NUM_FEATURES];
  extractFeatures(r, g, b, raw_f);
  for (int j = 0; j < NUM_FEATURES; j++) {
    float range = MINMAX_F_MAX[j] - MINMAX_F_MIN[j];
    out_norm[j] = (range > 1e-6f) ? ((raw_f[j] - MINMAX_F_MIN[j]) / range) : 0.0f;
  }
  int64_t t1 = esp_timer_get_time();
  uint32_t dt = (uint32_t)(t1 - t0);
  return (dt == 0) ? 2 : dt;
}

uint32_t rebuildScaledTrainingSet() {
  int64_t t0 = esp_timer_get_time();
  computeMinMaxBoundsFromTrain();
  for (int i = 0; i < NUM_TRAIN_SAMPLES; i++) {
    for (int j = 0; j < NUM_FEATURES; j++) {
      float range = MINMAX_F_MAX[j] - MINMAX_F_MIN[j];
      trainDataScaled[i].f[j] = (range > 1e-6f) ? ((trainDataRawFeat[i].f[j] - MINMAX_F_MIN[j]) / range) : 0.0f;
    }
    trainDataScaled[i].class_id = trainDataRawFeat[i].class_id;
  }
  int64_t t1 = esp_timer_get_time();
  return (uint32_t)(t1 - t0);
}

// Algoritma KNN dinamis (K = 1..15, default KNN_K=5) di ESP32 pada ruang fitur 4D (r, g, b, L)
KNNResult runKNN(const float q[NUM_FEATURES], const SampleFeature* dataset, int n_samples, int kVal = KNN_K) {
  KNNResult res;
  if (kVal < 1) kVal = 1;
  if (kVal > MAX_KNN_K) kVal = MAX_KNN_K;
  if (kVal > n_samples) kVal = n_samples;
  res.k_used = (uint8_t)kVal;
  int64_t t0 = esp_timer_get_time();

  for (int k = 0; k < kVal; k++) {
    res.top_k[k].index = -1;
    res.top_k[k].class_id = 0;
    res.top_k[k].distance = 1e9f;
  }

  // Hitung jarak Euclidean 4D ke seluruh data latih & simpan kVal tetangga terdekat
  for (int i = 0; i < n_samples; i++) {
    float sq = 0.0f;
    for (int j = 0; j < NUM_FEATURES; j++) {
      float diff = q[j] - dataset[i].f[j];
      sq += diff * diff;
    }
    float dist = sqrtf(sq);

    if (dist < res.top_k[kVal - 1].distance) {
      res.top_k[kVal - 1].index = i;
      res.top_k[kVal - 1].class_id = dataset[i].class_id;
      res.top_k[kVal - 1].distance = dist;

      // Insertion sort untuk kVal tetangga terdekat
      for (int j = kVal - 1; j > 0; j--) {
        if (res.top_k[j].distance < res.top_k[j - 1].distance) {
          NeighborInfo tmp = res.top_k[j];
          res.top_k[j] = res.top_k[j - 1];
          res.top_k[j - 1] = tmp;
        }
      }
    }
  }

  // Voting mayoritas kVal dengan tie-break jarak terdekat
  uint8_t votes[3] = {0, 0, 0};
  float minDistPerClass[3] = {1e9f, 1e9f, 1e9f};
  for (int k = 0; k < kVal; k++) {
    uint8_t cid = res.top_k[k].class_id;
    if (cid < 3) {
      votes[cid]++;
      if (res.top_k[k].distance < minDistPerClass[cid]) {
        minDistPerClass[cid] = res.top_k[k].distance;
      }
    }
  }

  uint8_t bestClass = 0;
  for (uint8_t c = 1; c < 3; c++) {
    if (votes[c] > votes[bestClass] ||
       (votes[c] == votes[bestClass] && minDistPerClass[c] < minDistPerClass[bestClass])) {
      bestClass = c;
    }
  }

  int64_t t1 = esp_timer_get_time();
  res.predicted_class = bestClass;
  res.confidence = (float)votes[bestClass] / (float)kVal;
  res.exec_time_us = (uint32_t)(t1 - t0);
  res.work_mem_bytes = sizeof(NeighborInfo) * kVal + sizeof(votes) + sizeof(minDistPerClass) + (sizeof(float) * NUM_FEATURES);
  return res;
}

void updateOLED(const char* modeTitle, float r, float g, float b, const float fn[NUM_FEATURES], const char* resultText, uint32_t execUs, const char* warnText = "ok") {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Baris 1: Header & Status Mode
  display.setCursor(0, 1);
  display.print(modeTitle);
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Baris 2: RGB Asli
  display.setCursor(0, 13);
  display.printf("RGB : %.0f, %.0f, %.0f", r, g, b);

  // Baris 3: Fitur Normalisasi Min-Max (r, g, L)
  display.setCursor(0, 23);
  display.printf("rgL : %.2f,%.2f,%.2f", fn[0], fn[1], fn[3]);

  // Baris 4-5: Kotak Sorot Hasil Klasifikasi KNN
  display.fillRoundRect(0, 34, 128, 17, 3, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(4, 39);
  display.printf("HASIL: %s", resultText);

  // Baris 6: Peringatan Permukaan atau Performa Eksekusi & Memori ESP32
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 55);
  if (strcmp(warnText, "fat_or_membrane") == 0) {
    display.print("CEK: LEMAK / SILAU!");
  } else if (strcmp(warnText, "too_dark") == 0) {
    display.print("CEK: TERLALU GELAP!");
  } else {
    uint32_t modelBytes = sizeof(trainDataScaled) + sizeof(MINMAX_F_MIN) + sizeof(MINMAX_F_MAX);
    display.printf("KNN:%uus Mem:%.1fKB", execUs, modelBytes / 1024.0f);
  }

  display.display();
}

// Tampilan OLED Khusus Mode Pengambilan Dataset (Latih / Uji) tanpa prediksi KNN
void updateOLEDDataset(const char* modeTitle, const char* className, int count, int quota, float r, float g, float b, const char* statusText) {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Baris 1: Header Mode Akuisisi Dataset
  display.setCursor(0, 1);
  display.print(modeTitle);
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Baris 2: Kotak Sorot Kelas Target & Counter Kuota
  display.fillRoundRect(0, 13, 128, 16, 3, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(4, 17);
  display.print(className);
  char cntBuf[16];
  snprintf(cntBuf, sizeof(cntBuf), "%d/%d", count, quota);
  int cntX = 124 - (int)(strlen(cntBuf) * 6);
  display.setCursor(cntX > 64 ? cntX : 64, 17);
  display.print(cntBuf);

  // Baris 3: Nilai RGB Sensor
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 33);
  display.printf("RGB : %.0f, %.0f, %.0f", r, g, b);

  // Baris 4: Status Penyimpanan
  display.setCursor(0, 43);
  display.print(statusText);

  // Baris 5: Progress Bar Kuota
  display.drawRoundRect(0, 54, 128, 9, 2, SSD1306_WHITE);
  if (quota > 0 && count > 0) {
    int fillW = (count * 124) / quota;
    if (fillW > 124) fillW = 124;
    if (fillW < 2) fillW = 2;
    display.fillRect(2, 56, fillW, 5, SSD1306_WHITE);
  }

  display.display();
}

void readSensorRGB(float &rf, float &gf, float &bf, uint16_t &r_raw, uint16_t &g_raw, uint16_t &b_raw, uint16_t &c_raw, uint16_t &lux, uint16_t &ct, uint32_t &sensor_us) {
  int64_t t0 = esp_timer_get_time();
  if (!tcsReady) {
    tcsReady = tcs.begin(0x29, &Wire);
  }
  if (tcsReady) {
    tcs.getRawData(&r_raw, &g_raw, &b_raw, &c_raw);
    ct = tcs.calculateColorTemperature_dn40(r_raw, g_raw, b_raw, c_raw);
    lux = tcs.calculateLux(r_raw, g_raw, b_raw);

    if (wbWhiteOk) {
      float br = wbBlackOk ? wbBlack[0] : 0.0f;
      float bg = wbBlackOk ? wbBlack[1] : 0.0f;
      float bb = wbBlackOk ? wbBlack[2] : 0.0f;
      float denomR = wbWhite[0] - br;
      float denomG = wbWhite[1] - bg;
      float denomB = wbWhite[2] - bb;
      rf = (denomR > 1.0f) ? clamp01(((float)r_raw - br) / denomR) * 255.0f : 0.0f;
      gf = (denomG > 1.0f) ? clamp01(((float)g_raw - bg) / denomG) * 255.0f : 0.0f;
      bf = (denomB > 1.0f) ? clamp01(((float)b_raw - bb) / denomB) * 255.0f : 0.0f;
    } else {
      tcs.getRGB(&rf, &gf, &bf);
    }
  } else {
    r_raw = 148; g_raw = 52; b_raw = 38; c_raw = 238;
    rf = 148.0f; gf = 52.0f; bf = 38.0f;
    lux = 34; ct = 2750;
  }
  int64_t t1 = esp_timer_get_time();
  sensor_us = (uint32_t)(t1 - t0);
}

void updateOLEDCalibration(const char* title, const char* badge, float r, float g, float b, const char* footer) {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 1);
  display.print(title);
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  display.fillRoundRect(0, 14, 128, 16, 3, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(4, 18);
  display.print(badge);

  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 35);
  display.printf("Raw: %.0f, %.0f, %.0f", r, g, b);
  display.setCursor(0, 52);
  display.print(footer);
  display.display();
}

void handleCalibratePoint(bool isWhite) {
  if (!tcsReady) tcsReady = tcs.begin(0x29, &Wire);
  float rs = 0, gs = 0, bs = 0;
  for (int i = 0; i < 5; i++) {
    uint16_t r_u = 0, g_u = 0, b_u = 0, c_u = 0;
    if (tcsReady) tcs.getRawData(&r_u, &g_u, &b_u, &c_u);
    rs += r_u; gs += g_u; bs += b_u;
  }
  float rm = rs / 5.0f, gm = gs / 5.0f, bm = bs / 5.0f;
  if (isWhite) {
    wbWhite[0] = rm; wbWhite[1] = gm; wbWhite[2] = bm;
    wbWhiteOk = true;
    prefs.putBool("wb_wok", true);
    prefs.putFloat("wb_wr", rm);
    prefs.putFloat("wb_wg", gm);
    prefs.putFloat("wb_wb", bm);
    updateOLEDCalibration("KALIBRASI 2 TITIK", "PUTIH (255) OK", rm, gm, bm, wbBlackOk ? "2 titik aktif!" : "Lanjut: Kalibrasi Hitam");
  } else {
    wbBlack[0] = rm; wbBlack[1] = gm; wbBlack[2] = bm;
    wbBlackOk = true;
    prefs.putBool("wb_bok", true);
    prefs.putFloat("wb_br", rm);
    prefs.putFloat("wb_bg", gm);
    prefs.putFloat("wb_bb", bm);
    updateOLEDCalibration("KALIBRASI 2 TITIK", "HITAM (0) OK", rm, gm, bm, wbWhiteOk ? "2 titik aktif!" : "Lanjut: Kalibrasi Putih");
  }
  Serial.printf("{\"type\":\"calibration\",\"point\":\"%s\",\"white_ok\":%s,\"black_ok\":%s,\"white\":[%.2f,%.2f,%.2f],\"black\":[%.2f,%.2f,%.2f]}\n",
                isWhite ? "white" : "black",
                wbWhiteOk ? "true" : "false",
                wbBlackOk ? "true" : "false",
                wbWhite[0], wbWhite[1], wbWhite[2],
                wbBlack[0], wbBlack[1], wbBlack[2]);
}

void handleResetCalibration() {
  wbWhiteOk = false; wbBlackOk = false;
  wbWhite[0] = wbWhite[1] = wbWhite[2] = 0.0f;
  wbBlack[0] = wbBlack[1] = wbBlack[2] = 0.0f;
  prefs.putBool("wb_wok", false);
  prefs.putBool("wb_bok", false);
  updateOLEDCalibration("KALIBRASI 2 TITIK", "KALIBRASI RESET", 0, 0, 0, "Kembali ke mode mentah");
  Serial.println("{\"type\":\"calibration\",\"point\":\"reset\",\"white_ok\":false,\"black_ok\":false,\"white\":[0,0,0],\"black\":[0,0,0]}");
}

void handleStatus() {
  float rf, gf, bf;
  float f_norm[NUM_FEATURES];
  uint16_t r_u, g_u, b_u, c_u, lux, ct;
  uint32_t sensor_us = 0;
  readSensorRGB(rf, gf, bf, r_u, g_u, b_u, c_u, lux, ct, sensor_us);
  uint32_t scale_us = normalizeSingleSample(rf, gf, bf, f_norm);
  const char* warn = detectSurfaceWarning(rf, gf, bf);
  (void)scale_us;

  uint32_t totalHeap = ESP.getHeapSize();
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t usedHeap = totalHeap - freeHeap;
  uint32_t datasetScaledBytes = sizeof(trainDataScaled) + sizeof(MINMAX_F_MIN) + sizeof(MINMAX_F_MAX);
  uint32_t datasetRawBytes = sizeof(trainDataRaw) + sizeof(trainDataRawFeat);

  Serial.print("{\"type\":\"status\"");
  Serial.printf(",\"chip_model\":\"%s\",\"chip_rev\":%d,\"cpu_mhz\":%d,\"cores\":%d",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getCpuFreqMHz(), ESP.getChipCores());
  Serial.printf(",\"mac\":\"%s\",\"oled_ok\":%s,\"tcs_ok\":%s",
                WiFi.macAddress().c_str(), oledReady ? "true" : "false", tcsReady ? "true" : "false");
  Serial.printf(",\"wifi_connected\":%s,\"wifi_ssid\":\"%s\",\"wifi_ip\":\"%s\",\"wifi_rssi\":%d",
                (WiFi.status() == WL_CONNECTED) ? "true" : "false",
                wifiSSID.c_str(),
                (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString().c_str() : "0.0.0.0",
                (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0);
  Serial.printf(",\"sensor\":{\"r_raw\":%.2f,\"g_raw\":%.2f,\"b_raw\":%.2f,\"c_raw\":%u,\"lux\":%u,\"color_temp\":%u,\"r_norm\":%.4f,\"g_norm\":%.4f,\"b_norm\":%.4f,\"l_norm\":%.4f,\"surface_warning\":\"%s\"}",
                rf, gf, bf, c_u, lux, ct, f_norm[0], f_norm[1], f_norm[2], f_norm[3], warn);
  Serial.printf(",\"memory\":{\"total_heap_bytes\":%u,\"free_heap_bytes\":%u,\"used_heap_bytes\":%u,\"dataset_scaled_bytes\":%u,\"dataset_raw_bytes\":%u,\"sketch_size_bytes\":%u,\"free_sketch_bytes\":%u}",
                totalHeap, freeHeap, usedHeap, datasetScaledBytes, datasetRawBytes, ESP.getSketchSize(), ESP.getFreeSketchSpace());
  Serial.printf(",\"minmax\":{\"r_min\":%.6f,\"r_max\":%.6f,\"g_min\":%.6f,\"g_max\":%.6f,\"b_min\":%.6f,\"b_max\":%.6f,\"l_min\":%.4f,\"l_max\":%.4f}",
                MINMAX_F_MIN[0], MINMAX_F_MAX[0], MINMAX_F_MIN[1], MINMAX_F_MAX[1], MINMAX_F_MIN[2], MINMAX_F_MAX[2], MINMAX_F_MIN[3], MINMAX_F_MAX[3]);
  Serial.printf(",\"calibration\":{\"white_ok\":%s,\"black_ok\":%s,\"white\":[%.2f,%.2f,%.2f],\"black\":[%.2f,%.2f,%.2f]}",
                wbWhiteOk ? "true" : "false",
                wbBlackOk ? "true" : "false",
                wbWhite[0], wbWhite[1], wbWhite[2],
                wbBlack[0], wbBlack[1], wbBlack[2]);
  Serial.println("}");
}

void runAnalyzePipeline(const String &triggerSource, bool isSim, bool useDummyRgb, float dr, float dg, float db, int kVal = KNN_K) {
  if (kVal < 1) kVal = 1;
  if (kVal > MAX_KNN_K) kVal = MAX_KNN_K;
  char headerBuf[28];
  snprintf(headerBuf, sizeof(headerBuf), isSim ? "SIMULASI | KNN K=%d" : "BEEF FRESH | KNN K=%d", kVal);
  if (oledReady) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 1);
    display.println(headerBuf);
    display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
    display.setCursor(0, 24);
    display.println(useDummyRgb ? "PROSES DATA DUMMY..." : "MENGANALISA DAGING...");
    display.setCursor(0, 40);
    display.println(useDummyRgb ? "Algoritma KNN ESP32" : "Sensor TCS34725 Aktif");
    display.display();
  }

  float r_avg = dr, g_avg = dg, b_avg = db;
  uint16_t c_avg = 1100, lux_avg = 32, ct_avg = 2800;
  uint32_t sensor_us = 0;

  if (!useDummyRgb) {
    float r_sum = 0, g_sum = 0, b_sum = 0;
    uint32_t c_sum = 0, lux_sum = 0, ct_sum = 0;
    uint32_t sensor_us_total = 0;
    for (int i = 0; i < 3; i++) {
      float rf, gf, bf;
      uint16_t r_u, g_u, b_u, c_u, lux, ct;
      uint32_t s_us = 0;
      readSensorRGB(rf, gf, bf, r_u, g_u, b_u, c_u, lux, ct, s_us);
      r_sum += rf; g_sum += gf; b_sum += bf;
      c_sum += c_u; lux_sum += lux; ct_sum += ct;
      sensor_us_total += s_us;
    }
    r_avg = r_sum / 3.0f;
    g_avg = g_sum / 3.0f;
    b_avg = b_sum / 3.0f;
    c_avg = c_sum / 3;
    lux_avg = lux_sum / 3;
    ct_avg = ct_sum / 3;
    sensor_us = sensor_us_total / 3;
  }

  // 1. Tahap Ekstraksi Fitur (r, g, b, L) & Feature Scaling Min-Max (0-1)
  float q_raw[NUM_FEATURES];
  float q_norm[NUM_FEATURES];
  extractFeatures(r_avg, g_avg, b_avg, q_raw);
  uint32_t scaling_us = normalizeSingleSample(r_avg, g_avg, b_avg, q_norm);
  const char* warn = detectSurfaceWarning(r_avg, g_avg, b_avg);

  // 2. Tahap Klasifikasi KNN (K dinamis) DENGAN Feature Scaling Min-Max (0-1)
  KNNResult knnScaled = runKNN(q_norm, trainDataScaled, NUM_TRAIN_SAMPLES, kVal);

  // 3. Tahap Klasifikasi KNN (K dinamis) TANPA Feature Scaling (Fitur 4D mentah) sebagai pembanding
  KNNResult knnRaw = runKNN(q_raw, trainDataRawFeat, NUM_TRAIN_SAMPLES, kVal);

  uint32_t total_proc_us = scaling_us + knnScaled.exec_time_us;
  uint32_t totalHeap = ESP.getHeapSize();
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t usedHeap = totalHeap - freeHeap;
  uint32_t datasetScaledBytes = sizeof(trainDataScaled) + sizeof(MINMAX_F_MIN) + sizeof(MINMAX_F_MAX);

  lastR = r_avg; lastG = g_avg; lastB = b_avg;
  for (int j = 0; j < NUM_FEATURES; j++) lastFeatNorm[j] = q_norm[j];
  lastClass = knnScaled.predicted_class;
  lastExecUs = total_proc_us;
  hasAnalyzed = true;

  // Tampilkan hasil di layar OLED SSD1306
  updateOLED(headerBuf, r_avg, g_avg, b_avg, q_norm,
             classShortLabel(knnScaled.predicted_class), total_proc_us, warn);

  // Kirim JSON lengkap melalui Serial Bridge
  Serial.print("{\"type\":\"analysis\"");
  Serial.printf(",\"trigger_source\":\"%s\",\"simulated\":%s,\"dummy_input\":%s",
                triggerSource.c_str(), isSim ? "true" : "false", useDummyRgb ? "true" : "false");
  Serial.printf(",\"r_raw\":%.2f,\"g_raw\":%.2f,\"b_raw\":%.2f,\"c_raw\":%u,\"lux\":%u,\"color_temp\":%u",
                r_avg, g_avg, b_avg, c_avg, lux_avg, ct_avg);
  Serial.printf(",\"r_norm\":%.4f,\"g_norm\":%.4f,\"b_norm\":%.4f,\"l_norm\":%.4f,\"surface_warning\":\"%s\"",
                q_norm[0], q_norm[1], q_norm[2], q_norm[3], warn);
  Serial.printf(",\"predicted_class_id\":%u,\"predicted_label\":\"%s\",\"confidence\":%.4f",
                knnScaled.predicted_class, classLabel(knnScaled.predicted_class), knnScaled.confidence);
  Serial.printf(",\"predicted_raw_class_id\":%u,\"predicted_raw_label\":\"%s\",\"raw_confidence\":%.4f",
                knnRaw.predicted_class, classLabel(knnRaw.predicted_class), knnRaw.confidence);
  Serial.printf(",\"k_value\":%u", knnScaled.k_used);
  Serial.printf(",\"exec_time_sensor_us\":%u,\"exec_time_scaling_us\":%u,\"exec_time_knn_scaled_us\":%u,\"exec_time_knn_raw_us\":%u,\"exec_time_total_us\":%u",
                sensor_us, scaling_us, knnScaled.exec_time_us, knnRaw.exec_time_us, total_proc_us);
  Serial.printf(",\"mem_dataset_bytes\":%u,\"mem_knn_work_bytes\":%u,\"mem_free_heap_bytes\":%u,\"mem_used_heap_bytes\":%u",
                datasetScaledBytes, knnScaled.work_mem_bytes, freeHeap, usedHeap);
  Serial.print(",\"nearest_neighbors\":[");
  for (int k = 0; k < knnScaled.k_used; k++) {
    int idx = knnScaled.top_k[k].index;
    Serial.printf("{\"rank\":%d,\"train_index\":%d,\"class_id\":%u,\"label\":\"%s\",\"distance\":%.4f,\"r_norm\":%.4f,\"g_norm\":%.4f,\"b_norm\":%.4f,\"l_norm\":%.4f}%s",
                  k + 1, idx, knnScaled.top_k[k].class_id, classLabel(knnScaled.top_k[k].class_id),
                  knnScaled.top_k[k].distance,
                  (idx >= 0) ? trainDataScaled[idx].f[0] : 0.0f,
                  (idx >= 0) ? trainDataScaled[idx].f[1] : 0.0f,
                  (idx >= 0) ? trainDataScaled[idx].f[2] : 0.0f,
                  (idx >= 0) ? trainDataScaled[idx].f[3] : 0.0f,
                  (k < knnScaled.k_used - 1) ? "," : "");
  }
  Serial.println("]}");
}

void handleAnalyze(const String &triggerSource, int kVal = KNN_K) {
  bool isSim = triggerSource.equalsIgnoreCase("sim") || triggerSource.equalsIgnoreCase("simulasi");
  runAnalyzePipeline(triggerSource, isSim, false, 0, 0, 0, kVal);
}

void handleCaptureDataset(const String &splitName, uint8_t classId, int count, int quota, bool isSim, bool useDummyRgb, float dr, float dg, float db, bool isPreview = false) {
  const char* headerTitle =
      isSim ? (splitName.equalsIgnoreCase("test") ? "SIM DATA UJI" : "SIM DATA LATIH")
            : (splitName.equalsIgnoreCase("test") ? "AMBIL DATA UJI" : "AMBIL DATA LATIH");
  const char* clsShort = classShortLabel(classId);

  float r_avg = dr, g_avg = dg, b_avg = db;
  uint16_t c_avg = 1100, lux_avg = 30, ct_avg = 2800;

  if (!useDummyRgb) {
    float r_sum = 0, g_sum = 0, b_sum = 0;
    uint32_t c_sum = 0, lux_sum = 0, ct_sum = 0;
    for (int i = 0; i < 3; i++) {
      float rf, gf, bf;
      uint16_t r_u, g_u, b_u, c_u, lux, ct;
      uint32_t s_us = 0;
      readSensorRGB(rf, gf, bf, r_u, g_u, b_u, c_u, lux, ct, s_us);
      r_sum += rf; g_sum += gf; b_sum += bf;
      c_sum += c_u; lux_sum += lux; ct_sum += ct;
    }
    r_avg = r_sum / 3.0f;
    g_avg = g_sum / 3.0f;
    b_avg = b_sum / 3.0f;
    c_avg = c_sum / 3;
    lux_avg = lux_sum / 3;
    ct_avg = ct_sum / 3;
  }

  const char* statusLine = isPreview
      ? "PREVIEW: SIMPAN?"
      : (isSim ? "SIMULASI TERSIMPAN" : "SAMPEL TERSIMPAN");

  updateOLEDDataset(headerTitle, clsShort, count, quota, r_avg, g_avg, b_avg, statusLine);

  Serial.printf("{\"type\":\"%s\",\"split\":\"%s\",\"class_id\":%u,\"count\":%d,\"quota\":%d,\"simulated\":%s,\"r_raw\":%.2f,\"g_raw\":%.2f,\"b_raw\":%.2f,\"c_raw\":%u,\"lux\":%u,\"color_temp\":%u}\n",
                isPreview ? "preview" : "capture", splitName.c_str(), classId, count, quota, isSim ? "true" : "false", r_avg, g_avg, b_avg, c_avg, lux_avg, ct_avg);
}

void handleBenchmark() {
  uint32_t preScaleTrainUs = rebuildScaledTrainingSet();

  uint32_t correctRaw = 0;
  uint32_t correctScaled = 0;
  uint32_t totalScalingUs = 0;
  uint32_t totalKnnScaledUs = 0;
  uint32_t totalKnnRawUs = 0;

  int cmRaw[3][3] = {{0}};
  int cmScaled[3][3] = {{0}};

  for (int i = 0; i < NUM_TEST_SAMPLES; i++) {
    uint8_t actual = testDataRaw[i].class_id;

    // 1. Evaluasi Tanpa Feature Scaling (Fitur 4D mentah)
    float q_raw[NUM_FEATURES];
    extractFeatures(testDataRaw[i].r, testDataRaw[i].g, testDataRaw[i].b, q_raw);
    KNNResult resRaw = runKNN(q_raw, trainDataRawFeat, NUM_TRAIN_SAMPLES);
    totalKnnRawUs += resRaw.exec_time_us;
    if (resRaw.predicted_class == actual) correctRaw++;
    if (actual < 3 && resRaw.predicted_class < 3) cmRaw[actual][resRaw.predicted_class]++;

    // 2. Evaluasi Dengan Feature Scaling Min-Max (0-1)
    float q_norm[NUM_FEATURES];
    uint32_t scUs = normalizeSingleSample(testDataRaw[i].r, testDataRaw[i].g, testDataRaw[i].b, q_norm);
    totalScalingUs += scUs;
    KNNResult resScaled = runKNN(q_norm, trainDataScaled, NUM_TRAIN_SAMPLES);
    totalKnnScaledUs += resScaled.exec_time_us;
    if (resScaled.predicted_class == actual) correctScaled++;
    if (actual < 3 && resScaled.predicted_class < 3) cmScaled[actual][resScaled.predicted_class]++;
  }

  float accRaw = ((float)correctRaw / (float)NUM_TEST_SAMPLES) * 100.0f;
  float accScaled = ((float)correctScaled / (float)NUM_TEST_SAMPLES) * 100.0f;
  float avgScalingUs = (float)totalScalingUs / (float)NUM_TEST_SAMPLES;
  float avgKnnScaledUs = (float)totalKnnScaledUs / (float)NUM_TEST_SAMPLES;
  float avgKnnRawUs = (float)totalKnnRawUs / (float)NUM_TEST_SAMPLES;

  uint32_t datasetScaledBytes = sizeof(trainDataScaled) + sizeof(MINMAX_F_MIN) + sizeof(MINMAX_F_MAX);
  uint32_t datasetRawBytes = sizeof(trainDataRaw) + sizeof(trainDataRawFeat);
  uint32_t knnWorkBytes = sizeof(KNNResult) + 32;
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t totalHeap = ESP.getHeapSize();

  if (oledReady) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.printf("BENCHMARK KNN (K=%d)", KNN_K);
    display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
    display.setCursor(0, 13);
    display.printf("Tanpa   : %.2f%%(%u/%d)", accRaw, correctRaw, NUM_TEST_SAMPLES);
    display.setCursor(0, 24);
    display.printf("Min-Max : %.2f%%(%u/%d)", accScaled, correctScaled, NUM_TEST_SAMPLES);
    display.setCursor(0, 36);
    display.printf("Time/Smp: %.1f us", avgScalingUs + avgKnnScaledUs);
    display.setCursor(0, 47);
    display.printf("Batch 36: %u us", totalScalingUs + totalKnnScaledUs);
    display.setCursor(0, 56);
    display.printf("RAM Model: %u B", datasetScaledBytes);
    display.display();
  }

  Serial.print("{\"type\":\"benchmark\"");
  Serial.printf(",\"k_value\":%d,\"train_count\":%d,\"test_count\":%d", KNN_K, NUM_TRAIN_SAMPLES, NUM_TEST_SAMPLES);
  Serial.printf(",\"correct_without_scaling\":%u,\"acc_without_scaling\":%.2f", correctRaw, accRaw);
  Serial.printf(",\"correct_with_minmax\":%u,\"acc_with_minmax\":%.2f", correctScaled, accScaled);
  Serial.printf(",\"esp32_prescale_144_us\":%u", preScaleTrainUs);
  Serial.printf(",\"esp32_exec_scaling_us\":%.2f,\"esp32_exec_knn_scaled_us\":%.2f,\"esp32_exec_knn_raw_us\":%.2f",
                avgScalingUs, avgKnnScaledUs, avgKnnRawUs);
  Serial.printf(",\"esp32_batch_36_scaled_us\":%u,\"esp32_batch_36_raw_us\":%u",
                totalScalingUs + totalKnnScaledUs, totalKnnRawUs);
  Serial.printf(",\"esp32_mem_dataset_scaled_bytes\":%u,\"esp32_mem_dataset_raw_bytes\":%u,\"esp32_mem_knn_work_bytes\":%u,\"esp32_free_heap_bytes\":%u,\"esp32_total_heap_bytes\":%u",
                datasetScaledBytes, datasetRawBytes, knnWorkBytes, freeHeap, totalHeap);
  Serial.printf(",\"cm_raw\":[[%d,%d,%d],[%d,%d,%d],[%d,%d,%d]]",
                cmRaw[0][0], cmRaw[0][1], cmRaw[0][2],
                cmRaw[1][0], cmRaw[1][1], cmRaw[1][2],
                cmRaw[2][0], cmRaw[2][1], cmRaw[2][2]);
  Serial.printf(",\"cm_scaled\":[[%d,%d,%d],[%d,%d,%d],[%d,%d,%d]]",
                cmScaled[0][0], cmScaled[0][1], cmScaled[0][2],
                cmScaled[1][0], cmScaled[1][1], cmScaled[1][2],
                cmScaled[2][0], cmScaled[2][1], cmScaled[2][2]);
  Serial.println("}");
}

void handleScanWifi() {
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks();
  Serial.print("{\"type\":\"wifi_scan\",\"networks\":[");
  for (int i = 0; i < n && i < 12; i++) {
    Serial.printf("{\"ssid\":\"%s\",\"rssi\":%d,\"open\":%s}%s",
                  WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                  (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "true" : "false",
                  (i < n - 1 && i < 11) ? "," : "");
  }
  Serial.println("]}");
}

void connectConfiguredWifi() {
  if (wifiSSID.length() == 0) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 6000) {
    delay(200);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TCS_LED_PIN, OUTPUT);
  digitalWrite(TCS_LED_PIN, HIGH);
  Wire.begin(SDA_PIN, SCL_PIN);

  oledReady = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  tcsReady = tcs.begin(0x29, &Wire);

  prefs.begin("beeffresh", false);
  wifiSSID = prefs.getString("ssid", "");
  wifiPass = prefs.getString("pass", "");
  wbWhiteOk = prefs.getBool("wb_wok", false);
  wbBlackOk = prefs.getBool("wb_bok", false);
  wbWhite[0] = prefs.getFloat("wb_wr", 0.0f);
  wbWhite[1] = prefs.getFloat("wb_wg", 0.0f);
  wbWhite[2] = prefs.getFloat("wb_wb", 0.0f);
  wbBlack[0] = prefs.getFloat("wb_br", 0.0f);
  wbBlack[1] = prefs.getFloat("wb_bg", 0.0f);
  wbBlack[2] = prefs.getFloat("wb_bb", 0.0f);

  // Bangun matriks 144 data latih yang dinormalisasi Min-Max (0-1)
  rebuildScaledTrainingSet();

  if (wifiSSID.length() > 0) {
    connectConfiguredWifi();
  }

  // Ambil 1 pembacaan awal untuk tampilan standby OLED
  float rf, gf, bf;
  float f_norm[NUM_FEATURES];
  uint16_t r_u, g_u, b_u, c_u, lux, ct;
  uint32_t s_us = 0;
  readSensorRGB(rf, gf, bf, r_u, g_u, b_u, c_u, lux, ct, s_us);
  normalizeSingleSample(rf, gf, bf, f_norm);
  KNNResult initKnn = runKNN(f_norm, trainDataScaled, NUM_TRAIN_SAMPLES);
  updateOLED("BEEF FRESH | SIAP", rf, gf, bf, f_norm, classShortLabel(initKnn.predicted_class), initKnn.exec_time_us, detectSurfaceWarning(rf, gf, bf));
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) return;

    if (line == "STATUS" || line == "PING") {
      handleStatus();
    } else if (line == "READ_SENSOR") {
      float rf, gf, bf;
      float f_norm[NUM_FEATURES];
      uint16_t r_u, g_u, b_u, c_u, lux, ct;
      uint32_t s_us = 0;
      readSensorRGB(rf, gf, bf, r_u, g_u, b_u, c_u, lux, ct, s_us);
      uint32_t sc_us = normalizeSingleSample(rf, gf, bf, f_norm);
      const char* warn = detectSurfaceWarning(rf, gf, bf);
      KNNResult kRes = runKNN(f_norm, trainDataScaled, NUM_TRAIN_SAMPLES);
      Serial.printf("{\"type\":\"sensor\",\"r_raw\":%.2f,\"g_raw\":%.2f,\"b_raw\":%.2f,\"c_raw\":%u,\"lux\":%u,\"color_temp\":%u,\"r_norm\":%.4f,\"g_norm\":%.4f,\"b_norm\":%.4f,\"l_norm\":%.4f,\"surface_warning\":\"%s\",\"predicted_label\":\"%s\",\"exec_us\":%u}\n",
                    rf, gf, bf, c_u, lux, ct, f_norm[0], f_norm[1], f_norm[2], f_norm[3], warn, classLabel(kRes.predicted_class), sc_us + kRes.exec_time_us);
    } else if (line.startsWith("ANALYZE")) {
      String src = "website";
      int kVal = KNN_K;
      int sp1 = line.indexOf(' ');
      if (sp1 > 0) {
        String rest = line.substring(sp1 + 1);
        rest.trim();
        int sp2 = rest.indexOf(' ');
        if (sp2 > 0) {
          src = rest.substring(0, sp2);
          int parsedK = rest.substring(sp2 + 1).toInt();
          if (parsedK >= 1 && parsedK <= MAX_KNN_K) kVal = parsedK;
        } else if (rest.length() > 0) {
          int parsedK = rest.toInt();
          if (parsedK >= 1 && parsedK <= MAX_KNN_K) kVal = parsedK;
          else src = rest;
        }
      }
      handleAnalyze(src, kVal);
    } else if (line.startsWith("SIMULATE_ANALYZE ")) {
      // Format: SIMULATE_ANALYZE r,g,b[,k]
      String rest = line.substring(17);
      float r, g, b;
      int kVal = KNN_K;
      int matched = sscanf(rest.c_str(), "%f,%f,%f,%d", &r, &g, &b, &kVal);
      if (matched >= 3) {
        runAnalyzePipeline("simulasi_dummy", true, true, r, g, b, kVal);
      }
    } else if (line.startsWith("CAPTURE_SAMPLE ")) {
      // Format: CAPTURE_SAMPLE train|test,class_id,count,quota,is_sim
      String rest = line.substring(15);
      char splitBuf[12] = "train";
      int cid = 0, cnt = 1, quota = 48, isSim = 0;
      if (sscanf(rest.c_str(), "%11[^,],%d,%d,%d,%d", splitBuf, &cid, &cnt, &quota, &isSim) >= 4) {
        handleCaptureDataset(String(splitBuf), (uint8_t)cid, cnt, quota, isSim != 0, false, 0, 0, 0);
      }
    } else if (line.startsWith("CAPTURE_DUMMY ")) {
      // Format: CAPTURE_DUMMY train|test,class_id,count,quota,r,g,b
      String rest = line.substring(14);
      char splitBuf[12] = "train";
      int cid = 0, cnt = 1, quota = 48;
      float r = 160, g = 60, b = 42;
      if (sscanf(rest.c_str(), "%11[^,],%d,%d,%d,%f,%f,%f", splitBuf, &cid, &cnt, &quota, &r, &g, &b) == 7) {
        handleCaptureDataset(String(splitBuf), (uint8_t)cid, cnt, quota, true, true, r, g, b, false);
      }
    } else if (line.startsWith("PREVIEW_SAMPLE ")) {
      // Format: PREVIEW_SAMPLE train|test,class_id,count,quota,is_sim
      String rest = line.substring(15);
      char splitBuf[12] = "train";
      int cid = 0, cnt = 1, quota = 48, isSim = 0;
      if (sscanf(rest.c_str(), "%11[^,],%d,%d,%d,%d", splitBuf, &cid, &cnt, &quota, &isSim) >= 4) {
        handleCaptureDataset(String(splitBuf), (uint8_t)cid, cnt, quota, isSim != 0, false, 0, 0, 0, true);
      }
    } else if (line.startsWith("PREVIEW_DUMMY ")) {
      // Format: PREVIEW_DUMMY train|test,class_id,count,quota,r,g,b
      String rest = line.substring(14);
      char splitBuf[12] = "train";
      int cid = 0, cnt = 1, quota = 48;
      float r = 160, g = 60, b = 42;
      if (sscanf(rest.c_str(), "%11[^,],%d,%d,%d,%f,%f,%f", splitBuf, &cid, &cnt, &quota, &r, &g, &b) == 7) {
        handleCaptureDataset(String(splitBuf), (uint8_t)cid, cnt, quota, true, true, r, g, b, true);
      }
    } else if (line.startsWith("CONFIRM_CAPTURE ")) {
      // Format: CONFIRM_CAPTURE train|test,class_id,count,quota,is_sim,r,g,b
      String rest = line.substring(16);
      char splitBuf[12] = "train";
      int cid = 0, cnt = 1, quota = 48, isSim = 0;
      float r = 160, g = 60, b = 42;
      if (sscanf(rest.c_str(), "%11[^,],%d,%d,%d,%d,%f,%f,%f", splitBuf, &cid, &cnt, &quota, &isSim, &r, &g, &b) == 8) {
        const char* hdr = isSim ? (String(splitBuf).equalsIgnoreCase("test") ? "SIM DATA UJI" : "SIM DATA LATIH")
                                : (String(splitBuf).equalsIgnoreCase("test") ? "AMBIL DATA UJI" : "AMBIL DATA LATIH");
        updateOLEDDataset(hdr, classShortLabel((uint8_t)cid), cnt, quota, r, g, b,
                          isSim ? "SIMULASI TERSIMPAN" : "SAMPEL TERSIMPAN");
        Serial.printf("{\"type\":\"confirm\",\"saved\":true,\"count\":%d,\"quota\":%d}\n", cnt, quota);
      }
    } else if (line == "CALIBRATE_WHITE") {
      handleCalibratePoint(true);
    } else if (line == "CALIBRATE_BLACK") {
      handleCalibratePoint(false);
    } else if (line == "RESET_CALIBRATION") {
      handleResetCalibration();
    } else if (line.startsWith("SET_LED ")) {
      int on = line.substring(8).toInt();
      digitalWrite(TCS_LED_PIN, on ? HIGH : LOW);
      if (tcsReady) {
        // Mendukung kedua metode: jumper LED->INT (setInterrupt) atau kabel LED->GPIO 25
        tcs.setInterrupt(on == 0);
      }
      Serial.printf("{\"type\":\"led\",\"on\":%s,\"gpio\":%d}\n", on ? "true" : "false", TCS_LED_PIN);
    } else if (line == "BENCHMARK") {
      handleBenchmark();
    } else if (line == "SCAN_WIFI") {
      handleScanWifi();
    } else if (line.startsWith("SET_WIFI ")) {
      String rest = line.substring(9);
      int sep = rest.indexOf('|');
      if (sep >= 0) {
        wifiSSID = rest.substring(0, sep);
        wifiPass = rest.substring(sep + 1);
        prefs.putString("ssid", wifiSSID);
        prefs.putString("pass", wifiPass);
        connectConfiguredWifi();
        handleStatus();
      }
    } else if (line.startsWith("SET_TRAIN ")) {
      // Format: SET_TRAIN idx,r,g,b,class_id
      String rest = line.substring(10);
      int idx, cid;
      float r, g, b;
      if (sscanf(rest.c_str(), "%d,%f,%f,%f,%d", &idx, &r, &g, &b, &cid) == 5) {
        if (idx >= 0 && idx < NUM_TRAIN_SAMPLES) {
          trainDataRaw[idx].r = r;
          trainDataRaw[idx].g = g;
          trainDataRaw[idx].b = b;
          trainDataRaw[idx].class_id = (uint8_t)cid;
          rebuildScaledTrainingSet();
          Serial.printf("{\"type\":\"ack\",\"updated_train_index\":%d}\n", idx);
        }
      }
    } else if (line.startsWith("SET_TEST ")) {
      // Format: SET_TEST idx,r,g,b,class_id
      String rest = line.substring(9);
      int idx, cid;
      float r, g, b;
      if (sscanf(rest.c_str(), "%d,%f,%f,%f,%d", &idx, &r, &g, &b, &cid) == 5) {
        if (idx >= 0 && idx < NUM_TEST_SAMPLES) {
          testDataRaw[idx].r = r;
          testDataRaw[idx].g = g;
          testDataRaw[idx].b = b;
          testDataRaw[idx].class_id = (uint8_t)cid;
          Serial.printf("{\"type\":\"ack\",\"updated_test_index\":%d}\n", idx);
        }
      }
    }
  }
  delay(15);
}
