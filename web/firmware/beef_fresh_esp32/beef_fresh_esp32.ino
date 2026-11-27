/*
 * ============================================================================
 *  BEEF FRESH — Firmware ESP32
 *  Klasifikasi kesegaran daging sapi: SEGAR / MULAI MEMBUSUK / BUSUK
 *  Sensor warna TCS34725 + OLED SSD1306 + KNN dengan Feature Scaling
 * ============================================================================
 *  Jalur pin (satu bus I2C bersama):
 *    ESP32 3V3 -> Sensor VIN   &  OLED VCC
 *    ESP32 GND -> Sensor GND   &  OLED GND
 *    ESP32 G26 -> Sensor SDA   &  OLED SDA
 *    ESP32 G27 -> Sensor SCL   &  OLED SCL
 *
 *  Catatan: LED putih eksternal TIDAK digunakan. Penerangan memakai LED bawaan
 *  modul TCS34725 (pin LED modul dibiarkan tidak terhubung = selalu menyala).
 *
 *  Library (Arduino Library Manager):
 *    - Adafruit TCS34725
 *    - Adafruit SSD1306 (+ Adafruit GFX Library, Adafruit BusIO)
 *    - ArduinoJson 7.x
 *  Board: "ESP32 Dev Module" (esp32 by Espressif, core 2.x / 3.x)
 *
 *  Alur kerja (tombol fisik belum ada -> trigger dari website):
 *    1. ESP32 polling  GET  {SERVER}/api/device/poll   setiap 1,5 detik
 *    2. Website membuat perintah: capture (ambil dataset), classify (analisa),
 *       benchmark (uji performa), ping, sync
 *    3. ESP32 mengeksekusi perintah secara mandiri:
 *         capture   : baca RGB -> kirim sebagai data latih/uji
 *         classify  : baca RGB -> feature scaling -> KNN di ESP32 -> OLED
 *         benchmark : ukur waktu eksekusi (micros) & memori heap KNN untuk
 *                     seluruh data uji pada 3 metode scaling
 *    4. Hasil dikirim ke  POST {SERVER}/api/device/result  (HTTPS)
 *  Dataset latih/uji diunduh dari GET {SERVER}/api/device/model lalu disimpan
 *  di LittleFS agar tetap tersedia setelah ESP32 restart.
 * ============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "Adafruit_TCS34725.h"

// ------------------------------- KONFIGURASI --------------------------------
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* SERVER_URL    = "https://your-app.example.com";  // tanpa "/" di akhir
const char* DEVICE_ID     = "beef-esp32-01";
const char* DEVICE_KEY    = "beef-fresh-key";                // = DEVICE_API_KEY di server (opsional)
const char* FW_VERSION    = "1.0.0";

#define I2C_SDA       26
#define I2C_SCL       27
#define OLED_WIDTH    128
#define OLED_HEIGHT   64
#define OLED_ADDR     0x3C
#define READ_SAMPLES  5      // jumlah pembacaan sensor yang dirata-rata per sampel
#define POLL_MS       1500
#define MAX_TRAIN     200
#define MAX_TEST      60
#define NUM_CLASSES   3
#define NUM_FEATURES  4
#define MAX_K         25

// ------------------------------- OBJEK & TIPE --------------------------------
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_154MS, TCS34725_GAIN_4X);

enum ScalingMethod : uint8_t { SC_NONE = 0, SC_MINMAX = 1, SC_ZSCORE = 2 };
const char* SCALING_KEYS[3] = { "none", "minmax", "zscore" };
const char* CLASS_KEYS[NUM_CLASSES] = { "segar", "mulai_membusuk", "busuk" };

struct Sample   { float f[NUM_FEATURES]; uint8_t label; };
struct Neighbor { float d; uint8_t label; };

struct KnnResult {
  uint8_t  label;
  uint8_t  votes[NUM_CLASSES];
  float    nearest;
  float    scaled[NUM_FEATURES];
  uint32_t scaleUs;   // waktu tahap feature scaling
  uint32_t knnUs;     // waktu tahap KNN (jarak + seleksi K + voting)
  uint32_t execUs;    // total waktu eksekusi
  uint32_t memBytes;  // heap terpakai selama inferensi
};

struct Reading { float rgb[3]; uint16_t raw[4]; float lux; float colorTemp; };

Sample trainSet[MAX_TRAIN];
Sample testSet[MAX_TEST];
int  trainCount = 0;
int  testCount  = 0;
long modelVersion = -1;
long serverModelVersion = -1;
float fMin[NUM_FEATURES], fMax[NUM_FEATURES], fMean[NUM_FEATURES], fStd[NUM_FEATURES];

bool sensorOk = false;
bool oledOk   = false;
unsigned long lastPoll = 0;

// ------------------------------- PROTOTIPE ------------------------------------
void oledShow(const String& title, const String& l1 = "", const String& l2 = "", const String& l3 = "");
void oledResult(uint8_t label, const float rgb[3], uint32_t execUs);
bool readColor(Reading& out);
void extractFeatures(const float rgb[3], float out[NUM_FEATURES]);
void computeScaler();
static float scaleValue(float x, int j, ScalingMethod m);
bool runKnn(const float feat[NUM_FEATURES], ScalingMethod m, int k, KnnResult& res);
bool parseRow(const char* p, float out[3], int& lab);
bool parseModel(const String& text);
bool syncModel();
void loadModelFromFlash();
bool ensureModel();
bool httpRequest(bool post, const String& path, const String& payload, String& response, int& code);
void sendResult(JsonDocument& doc);
void pollServer();
void handleCommand(JsonVariant cmd);
void doCapture(long id, JsonVariant cmd);
void doClassify(long id, JsonVariant cmd);
void doBenchmark(long id, JsonVariant cmd);
void doPing(long id);
void doSync(long id);
void connectWiFi();
ScalingMethod parseScalingKey(const String& s);
float round2(float v);

// ------------------------------- OLED ----------------------------------------
void oledShow(const String& title, const String& l1, const String& l2, const String& l3) {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(title);
  display.drawFastHLine(0, 11, OLED_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 18); display.print(l1);
  display.setCursor(0, 32); display.print(l2);
  display.setCursor(0, 46); display.print(l3);
  display.display();
}

void oledResult(uint8_t label, const float rgb[3], uint32_t execUs) {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("HASIL:");
  display.setTextSize(2);
  if (label == 1) {
    display.setCursor(0, 14); display.print("MULAI");
    display.setCursor(0, 32); display.print("MEMBUSUK");
  } else {
    display.setCursor(0, 22); display.print(label == 0 ? "SEGAR" : "BUSUK");
  }
  display.setTextSize(1);
  display.setCursor(0, 55);
  display.printf("%d,%d,%d %luus", (int)rgb[0], (int)rgb[1], (int)rgb[2], (unsigned long)execUs);
  display.display();
}

// ------------------------------- SENSOR --------------------------------------
float round2(float v) { return roundf(v * 100.0f) / 100.0f; }

bool readColor(Reading& out) {
  if (!sensorOk) return false;
  uint32_t sum[4] = { 0, 0, 0, 0 };
  for (int i = 0; i < READ_SAMPLES; i++) {
    uint16_t r, g, b, c;
    tcs.getRawData(&r, &g, &b, &c);   // menunggu waktu integrasi (154 ms)
    sum[0] += r; sum[1] += g; sum[2] += b; sum[3] += c;
  }
  for (int i = 0; i < 4; i++) out.raw[i] = (uint16_t)(sum[i] / READ_SAMPLES);
  // Normalisasi terhadap kanal Clear -> RGB 0..255 (tidak bergantung intensitas)
  for (int i = 0; i < 3; i++) {
    out.rgb[i] = out.raw[3] ? ((float)out.raw[i] / (float)out.raw[3]) * 255.0f : 0.0f;
  }
  out.lux = tcs.calculateLux(out.raw[0], out.raw[1], out.raw[2]);
  out.colorTemp = tcs.calculateColorTemperature_dn40(out.raw[0], out.raw[1], out.raw[2], out.raw[3]);
  return true;
}

// ------------------------------- FEATURE SCALING -----------------------------
// Ekstraksi 4 fitur: r = R/sum, g = G/sum, b = B/sum, L = sum/3
void extractFeatures(const float rgb[3], float out[NUM_FEATURES]) {
  float sum = rgb[0] + rgb[1] + rgb[2];
  if (sum <= 0.0001f) {
    for (int j = 0; j < NUM_FEATURES; j++) out[j] = 0.0f;
    return;
  }
  out[0] = rgb[0] / sum;
  out[1] = rgb[1] / sum;
  out[2] = rgb[2] / sum;
  out[3] = sum / 3.0f;
}

// FIT: parameter dihitung dari data latih (identik dengan perhitungan di server)
void computeScaler() {
  for (int j = 0; j < NUM_FEATURES; j++) { fMin[j] = 0; fMax[j] = 0; fMean[j] = 0; fStd[j] = 0; }
  if (trainCount <= 0) return;
  for (int j = 0; j < NUM_FEATURES; j++) { fMin[j] = trainSet[0].f[j]; fMax[j] = trainSet[0].f[j]; }
  for (int i = 0; i < trainCount; i++) {
    for (int j = 0; j < NUM_FEATURES; j++) {
      float x = trainSet[i].f[j];
      if (x < fMin[j]) fMin[j] = x;
      if (x > fMax[j]) fMax[j] = x;
      fMean[j] += x;
    }
  }
  for (int j = 0; j < NUM_FEATURES; j++) fMean[j] /= (float)trainCount;
  for (int i = 0; i < trainCount; i++) {
    for (int j = 0; j < NUM_FEATURES; j++) {
      float d = trainSet[i].f[j] - fMean[j];
      fStd[j] += d * d;
    }
  }
  for (int j = 0; j < NUM_FEATURES; j++) fStd[j] = sqrtf(fStd[j] / (float)trainCount);
}

// TRANSFORM
static float scaleValue(float x, int j, ScalingMethod m) {
  if (m == SC_MINMAX) {
    float range = fMax[j] - fMin[j];
    return (x - fMin[j]) / (range > 0 ? range : 1.0f);
  }
  if (m == SC_ZSCORE) {
    return (x - fMean[j]) / (fStd[j] > 0 ? fStd[j] : 1.0f);
  }
  return x;
}

// ------------------------------- KNN -----------------------------------------
bool runKnn(const float feat[NUM_FEATURES], ScalingMethod m, int k, KnnResult& res) {
  if (trainCount <= 0) return false;
  if (k < 1) k = 1;
  if (k > MAX_K) k = MAX_K;
  if (k > trainCount) k = trainCount;

  uint32_t heapBefore = ESP.getFreeHeap();
  uint32_t t0 = micros();

  // Tahap 1: feature scaling (salinan data latih terskala + data baru)
  float* scaled = nullptr;
  if (m != SC_NONE) {
    scaled = (float*)malloc(sizeof(float) * NUM_FEATURES * trainCount);
    if (!scaled) return false;
    for (int i = 0; i < trainCount; i++) {
      for (int j = 0; j < NUM_FEATURES; j++) scaled[i * NUM_FEATURES + j] = scaleValue(trainSet[i].f[j], j, m);
    }
  }
  float q[NUM_FEATURES];
  for (int j = 0; j < NUM_FEATURES; j++) q[j] = scaleValue(feat[j], j, m);
  uint32_t t1 = micros();

  // Tahap 2: KNN — jarak Euclidean 4D, simpan K tetangga terdekat (insertion), voting
  Neighbor* nb = (Neighbor*)malloc(sizeof(Neighbor) * k);
  if (!nb) { if (scaled) free(scaled); return false; }
  uint32_t heapPeak = ESP.getFreeHeap();
  int filled = 0;
  for (int i = 0; i < trainCount; i++) {
    const float* x = scaled ? &scaled[i * NUM_FEATURES] : trainSet[i].f;
    float sq = 0.0f;
    for (int j = 0; j < NUM_FEATURES; j++) {
      float dj = x[j] - q[j];
      sq += dj * dj;
    }
    float d = sqrtf(sq);
    int pos;
    if (filled < k) {
      pos = filled++;
    } else if (d < nb[k - 1].d) {
      pos = k - 1;
    } else {
      continue;
    }
    while (pos > 0 && nb[pos - 1].d > d) { nb[pos] = nb[pos - 1]; pos--; }
    nb[pos].d = d;
    nb[pos].label = trainSet[i].label;
  }
  uint8_t votes[NUM_CLASSES] = { 0, 0, 0 };
  for (int i = 0; i < filled; i++) votes[nb[i].label]++;
  uint8_t best = 0;
  for (uint8_t c = 1; c < NUM_CLASSES; c++) {
    if (votes[c] > votes[best]) best = c;
  }
  int tied = 0;
  for (uint8_t c = 0; c < NUM_CLASSES; c++) {
    if (votes[c] == votes[best]) tied++;
  }
  if (tied > 1) {  // seri -> pilih kelas tetangga terdekat di antara kelas yang seri
    for (int i = 0; i < filled; i++) {
      if (votes[nb[i].label] == votes[best]) { best = nb[i].label; break; }
    }
  }
  uint32_t t2 = micros();

  res.label = best;
  for (int c = 0; c < NUM_CLASSES; c++) res.votes[c] = votes[c];
  res.nearest = filled > 0 ? nb[0].d : 0;
  for (int j = 0; j < NUM_FEATURES; j++) res.scaled[j] = q[j];
  res.scaleUs = t1 - t0;
  res.knnUs = t2 - t1;
  res.execUs = t2 - t0;
  res.memBytes = heapBefore > heapPeak ? heapBefore - heapPeak : 0;

  free(nb);
  if (scaled) free(scaled);
  return true;
}

// ------------------------------- MODEL / DATASET -----------------------------
bool parseRow(const char* p, float out[3], int& lab) {
  char* e;
  for (int j = 0; j < 3; j++) {
    out[j] = strtof(p, &e);
    if (e == p || *e != ',') return false;
    p = e + 1;
  }
  long v = strtol(p, &e, 10);
  if (e == p || v < 0 || v >= NUM_CLASSES) return false;
  lab = (int)v;
  return true;
}

bool parseModel(const String& text) {
  if (!text.startsWith("V,")) return false;
  int tc = 0, uc = 0;
  long ver = -1;
  int len = text.length();
  int start = 0;
  const char* base = text.c_str();
  while (start < len) {
    int end = text.indexOf('\n', start);
    if (end < 0) end = len;
    const char* line = base + start;
    if (end - start >= 2 && line[1] == ',') {
      float v[3];
      int lab = 0;
      if (line[0] == 'V') {
        ver = strtol(line + 2, nullptr, 10);
      } else if (line[0] == 'T' && tc < MAX_TRAIN && parseRow(line + 2, v, lab)) {
        extractFeatures(v, trainSet[tc].f);
        trainSet[tc].label = (uint8_t)lab;
        tc++;
      } else if (line[0] == 'U' && uc < MAX_TEST && parseRow(line + 2, v, lab)) {
        extractFeatures(v, testSet[uc].f);
        testSet[uc].label = (uint8_t)lab;
        uc++;
      }
    }
    start = end + 1;
  }
  if (ver < 0) return false;
  trainCount = tc;
  testCount = uc;
  modelVersion = ver;
  computeScaler();
  return true;
}

bool syncModel() {
  oledShow("SINKRON MODEL", "Mengunduh dataset", "dari server...");
  String body;
  int code = 0;
  if (!httpRequest(false, String("/api/device/model?id=") + DEVICE_ID, "", body, code)) {
    Serial.printf("[MODEL] gagal mengunduh (%d)\n", code);
    return false;
  }
  if (!parseModel(body)) {
    Serial.println("[MODEL] format tidak valid");
    return false;
  }
  File f = LittleFS.open("/model.txt", "w");
  if (f) { f.print(body); f.close(); }
  Serial.printf("[MODEL] v%ld: %d latih, %d uji\n", modelVersion, trainCount, testCount);
  return true;
}

void loadModelFromFlash() {
  if (!LittleFS.exists("/model.txt")) return;
  File f = LittleFS.open("/model.txt", "r");
  if (!f) return;
  String s = f.readString();
  f.close();
  if (parseModel(s)) Serial.printf("[MODEL] dari flash v%ld (%d latih, %d uji)\n", modelVersion, trainCount, testCount);
}

bool ensureModel() {
  bool needSync = modelVersion < 0 || trainCount == 0 || (serverModelVersion >= 0 && serverModelVersion != modelVersion);
  if (needSync) syncModel();   // jika gagal, tetap pakai model lama (mandiri/offline)
  return trainCount > 0;
}

// ------------------------------- HTTP ----------------------------------------
bool httpRequest(bool post, const String& path, const String& payload, String& response, int& code) {
  code = -1;
  if (WiFi.status() != WL_CONNECTED) return false;
  String url = String(SERVER_URL) + path;
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https://")) {
    secure.setInsecure();   // sederhana: lewati verifikasi sertifikat
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return false;
  http.setTimeout(12000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.addHeader("x-device-key", DEVICE_KEY);
  if (post) {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(payload);
  } else {
    code = http.GET();
  }
  if (code > 0) response = http.getString();
  http.end();
  return code >= 200 && code < 300;
}

void sendResult(JsonDocument& doc) {
  doc["deviceId"] = DEVICE_ID;
  String body;
  serializeJson(doc, body);
  String resp;
  int code = 0;
  for (int attempt = 0; attempt < 3; attempt++) {
    if (httpRequest(true, "/api/device/result", body, resp, code)) return;
    Serial.printf("[HTTP] kirim hasil gagal (%d) %s\n", code, resp.c_str());
    if (code > 0) return;   // server merespons (bukan masalah jaringan) -> jangan ulang
    delay(700);
  }
}

// ------------------------------- PERINTAH ------------------------------------
ScalingMethod parseScalingKey(const String& s) {
  if (s == "none") return SC_NONE;
  if (s == "zscore") return SC_ZSCORE;
  return SC_MINMAX;
}

void pollServer() {
  String path = String("/api/device/poll?id=") + DEVICE_ID +
                "&mv=" + String(modelVersion) +
                "&tc=" + String(trainCount) +
                "&rssi=" + String(WiFi.RSSI()) +
                "&heap=" + String(ESP.getFreeHeap()) +
                "&fw=" + FW_VERSION +
                "&ip=" + WiFi.localIP().toString() +
                "&s=" + (sensorOk ? "1" : "0") +
                "&o=" + (oledOk ? "1" : "0") +
                "&up=" + String(millis() / 1000);
  String resp;
  int code = 0;
  if (!httpRequest(false, path, "", resp, code)) {
    Serial.printf("[POLL] gagal (%d)\n", code);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  serverModelVersion = doc["mv"] | -1L;
  JsonVariant cmd = doc["cmd"];
  if (cmd.isNull()) return;
  handleCommand(cmd);
}

void handleCommand(JsonVariant cmd) {
  long id = cmd["id"] | 0L;
  String type = cmd["type"] | "";
  Serial.printf("[CMD] #%ld %s\n", id, type.c_str());
  if (type == "capture") doCapture(id, cmd);
  else if (type == "classify") doClassify(id, cmd);
  else if (type == "benchmark") doBenchmark(id, cmd);
  else if (type == "ping") doPing(id);
  else if (type == "sync") doSync(id);
  else {
    JsonDocument d;
    d["commandId"] = id;
    d["type"] = type;
    d["error"] = "Perintah tidak dikenal";
    sendResult(d);
  }
}

void doCapture(long id, JsonVariant cmd) {
  String label = cmd["label"] | "";
  String split = cmd["split"] | "";
  oledShow("AMBIL DATA", label, String("set: ") + split, "membaca warna...");
  JsonDocument d;
  d["commandId"] = id;
  d["type"] = "capture";
  Reading rd;
  if (!readColor(rd)) {
    d["error"] = "Sensor TCS34725 tidak terdeteksi";
    sendResult(d);
    oledShow("ERROR", "Sensor tidak", "terdeteksi");
    return;
  }
  d["r"] = round2(rd.rgb[0]);
  d["g"] = round2(rd.rgb[1]);
  d["b"] = round2(rd.rgb[2]);
  d["rawR"] = rd.raw[0];
  d["rawG"] = rd.raw[1];
  d["rawB"] = rd.raw[2];
  d["rawC"] = rd.raw[3];
  d["lux"] = rd.lux;
  d["colorTemp"] = rd.colorTemp;
  sendResult(d);
  oledShow("DATA TERSIMPAN", label, String("set: ") + split,
           String("R") + String((int)rd.rgb[0]) + " G" + String((int)rd.rgb[1]) + " B" + String((int)rd.rgb[2]));
}

void doClassify(long id, JsonVariant cmd) {
  String sc = cmd["scaling"] | "minmax";
  int k = cmd["k"] | 3;
  ScalingMethod m = parseScalingKey(sc);
  JsonDocument d;
  d["commandId"] = id;
  d["type"] = "classify";
  oledShow("MENGANALISA", String(SCALING_KEYS[m]) + " K=" + String(k), "membaca warna...");
  if (!ensureModel()) {
    d["error"] = "Dataset latih belum tersedia di ESP32";
    sendResult(d);
    oledShow("ERROR", "Dataset latih", "belum tersedia");
    return;
  }
  Reading rd;
  if (!readColor(rd)) {
    d["error"] = "Sensor TCS34725 tidak terdeteksi";
    sendResult(d);
    oledShow("ERROR", "Sensor tidak", "terdeteksi");
    return;
  }
  float qFeat[NUM_FEATURES];
  extractFeatures(rd.rgb, qFeat);
  KnnResult res;
  if (!runKnn(qFeat, m, k, res)) {
    d["error"] = "Memori tidak cukup untuk KNN";
    sendResult(d);
    return;
  }
  oledResult(res.label, rd.rgb, res.execUs);
  d["r"] = round2(rd.rgb[0]);
  d["g"] = round2(rd.rgb[1]);
  d["b"] = round2(rd.rgb[2]);
  d["rawR"] = rd.raw[0];
  d["rawG"] = rd.raw[1];
  d["rawB"] = rd.raw[2];
  d["rawC"] = rd.raw[3];
  d["scaling"] = SCALING_KEYS[m];
  d["k"] = k > trainCount ? trainCount : k;
  d["predicted"] = CLASS_KEYS[res.label];
  JsonArray v = d["votes"].to<JsonArray>();
  for (int c = 0; c < NUM_CLASSES; c++) v.add(res.votes[c]);
  d["nearest"] = res.nearest;
  d["rNorm"] = res.scaled[0];
  d["gNorm"] = res.scaled[1];
  d["bNorm"] = res.scaled[2];
  d["lNorm"] = res.scaled[3];
  d["execUs"] = res.execUs;
  d["scaleUs"] = res.scaleUs;
  d["knnUs"] = res.knnUs;
  d["memBytes"] = res.memBytes;
  d["modelBytes"] = (uint32_t)(trainCount * sizeof(Sample));
  d["freeHeap"] = ESP.getFreeHeap();
  d["trainCount"] = trainCount;
  sendResult(d);
  Serial.printf("[KNN] %s (%s, K=%d) %luus, %lu byte\n", CLASS_KEYS[res.label], SCALING_KEYS[m], k,
                (unsigned long)res.execUs, (unsigned long)res.memBytes);
}

void doBenchmark(long id, JsonVariant cmd) {
  int k = cmd["k"] | 3;
  int repeat = cmd["repeat"] | 3;
  if (repeat < 1) repeat = 1;
  if (repeat > 10) repeat = 10;
  JsonDocument d;
  d["commandId"] = id;
  d["type"] = "benchmark";
  if (!ensureModel() || testCount == 0) {
    d["error"] = "Benchmark butuh data latih & data uji";
    sendResult(d);
    return;
  }
  oledShow("BENCHMARK KNN", String(testCount) + " data uji", "x 3 metode", String("K=") + String(k));
  d["k"] = k;
  d["repeat"] = repeat;
  d["cpuMhz"] = getCpuFrequencyMhz();
  d["trainCount"] = trainCount;
  JsonArray arr = d["results"].to<JsonArray>();
  String summary[3];
  for (int m = 0; m < 3; m++) {
    uint64_t sum = 0, sumScale = 0, sumKnn = 0;
    uint32_t mn = 0xFFFFFFFF, mx = 0, mem = 0;
    int correct = 0;
    uint32_t n = 0;
    for (int i = 0; i < testCount; i++) {
      for (int r = 0; r < repeat; r++) {
        KnnResult res;
        if (!runKnn(testSet[i].f, (ScalingMethod)m, k, res)) continue;
        n++;
        sum += res.execUs;
        sumScale += res.scaleUs;
        sumKnn += res.knnUs;
        if (res.execUs < mn) mn = res.execUs;
        if (res.execUs > mx) mx = res.execUs;
        if (res.memBytes > mem) mem = res.memBytes;
        if (r == 0 && res.label == testSet[i].label) correct++;
      }
      yield();
    }
    if (n == 0) n = 1;
    JsonObject o = arr.add<JsonObject>();
    o["scaling"] = SCALING_KEYS[m];
    o["samples"] = testCount;
    o["correct"] = correct;
    o["avgUs"] = (float)sum / (float)n;
    o["minUs"] = mn == 0xFFFFFFFF ? 0 : mn;
    o["maxUs"] = mx;
    o["scaleUs"] = (float)sumScale / (float)n;
    o["knnUs"] = (float)sumKnn / (float)n;
    o["memBytes"] = mem;
    o["modelBytes"] = (uint32_t)(trainCount * sizeof(Sample));
    summary[m] = String(SCALING_KEYS[m]) + " " + String((float)sum / (float)n, 0) + "us";
  }
  d["freeHeap"] = ESP.getFreeHeap();
  sendResult(d);
  oledShow("BENCHMARK OK", summary[0], summary[1], summary[2]);
}

void doPing(long id) {
  oledShow("PING", "HALO!", "dari website");
  JsonDocument d;
  d["commandId"] = id;
  d["type"] = "ping";
  d["info"] = String(String("pong - ") + DEVICE_ID + " fw " + FW_VERSION);
  d["modelVersion"] = modelVersion;
  d["trainCount"] = trainCount;
  d["testCount"] = testCount;
  sendResult(d);
}

void doSync(long id) {
  bool ok = syncModel();
  JsonDocument d;
  d["commandId"] = id;
  d["type"] = "sync";
  if (!ok) d["error"] = "Gagal mengunduh dataset";
  else {
    d["info"] = String(String("Model v") + String(modelVersion) + " termuat");
    d["modelVersion"] = modelVersion;
    d["trainCount"] = trainCount;
    d["testCount"] = testCount;
  }
  sendResult(d);
  oledShow("MODEL SIAP", String("versi ") + String(modelVersion), String(trainCount) + " data latih", String(testCount) + " data uji");
}

// ------------------------------- WIFI ----------------------------------------
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  oledShow("BEEF FRESH", "Menghubungkan WiFi", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] terhubung, IP %s\n", WiFi.localIP().toString().c_str());
    oledShow("WIFI TERHUBUNG", WiFi.localIP().toString(), "Menunggu perintah", "dari website...");
  } else {
    Serial.println("\n[WIFI] gagal, mencoba lagi...");
    oledShow("WIFI GAGAL", "Cek SSID/password", "mencoba lagi...");
  }
}

// ------------------------------- SETUP & LOOP --------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin(I2C_SDA, I2C_SCL);   // bus I2C bersama: G26 = SDA, G27 = SCL

  // periphBegin = false agar library tidak memanggil Wire.begin() default (pin 21/22)
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR, true, false);
  if (oledOk) { display.clearDisplay(); display.display(); }
  else Serial.println("[OLED] SSD1306 tidak ditemukan di 0x3C");
  oledShow("BEEF FRESH", String("Firmware v") + FW_VERSION, "Inisialisasi...");

  sensorOk = tcs.begin(TCS34725_ADDRESS, &Wire);
  if (!sensorOk) {
    Serial.println("[SENSOR] TCS34725 tidak ditemukan! Cek kabel SDA=G26 SCL=G27");
    oledShow("SENSOR ERROR", "TCS34725 tidak", "terdeteksi", "cek G26/G27");
    delay(1500);
  }

  if (!LittleFS.begin(true)) Serial.println("[FS] LittleFS gagal");
  else loadModelFromFlash();

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(1000);
    return;
  }
  if (millis() - lastPoll >= POLL_MS) {
    lastPoll = millis();
    pollServer();
  }
  delay(5);
}
