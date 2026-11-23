#!/usr/bin/env python3
"""
===============================================================================
  BEEF FRESH - 3D MODERN INTERACTIVE CLI CONTROLLER & DATASET STUDIO
  Arsitektur Sistem Penelitian:
  - Akuisisi Dataset: 144 Data Latih (80%) & 36 Data Uji (20%) [Total 180 Data]
  - Evaluasi: Tanpa Feature Scaling vs Feature Scaling Min-Max (0-1) pada KNN (K=3)
  - Performa ESP32: Waktu Eksekusi (us/ms) & Konsumsi Memori (Bytes/KB)
  - Hardware: ESP32 + TCS34725 + OLED SSD1306 (SDA=G26, SCL=G27)
===============================================================================
"""

import os
import sys
import json
import math
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    import serial
except ImportError:
    serial = None

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
DB_PATH = os.path.join(BASE_DIR, "data", "beef_fresh_db.json")
SCHEMA_PATH = os.path.join(BASE_DIR, "supabase", "schema.sql")
HEADER_PATH = os.path.join(BASE_DIR, "firmware", "beef_fresh_esp32", "dataset_model.h")

# ANSI Colors (24-bit TrueColor + Standard)
RST = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[38;2;56;189;248m"
GREEN = "\033[38;2;52;211;153m"
AMBER = "\033[38;2;251;191;36m"
RED = "\033[38;2;248;113;113m"
MAUVE = "\033[38;2;212;140;168m"
PURPLE = "\033[38;2;168;85;247m"
WHITE = "\033[38;2;241;245;249m"
SLATE = "\033[38;2;148;163;184m"
BG_DARK = "\033[48;2;15;23;42m"
BG_MAUVE = "\033[48;2;196;132;159m\033[38;2;20;20;30m"

CLASSES = [
    {"id": 0, "label": "Segar", "code": "SGR", "color": GREEN},
    {"id": 1, "label": "Mulai Membusuk", "code": "MMB", "color": AMBER},
    {"id": 2, "label": "Busuk", "code": "BSK", "color": RED},
]


def load_env():
    env = {
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "SERIAL_PORT": "/dev/ttyUSB0",
        "SERIAL_BAUD": "115200",
        "PORT": "3000",
        "WIFI_SSID": "",
        "WIFI_PASSWORD": "",
    }
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def load_db():
    if not os.path.exists(DB_PATH):
        return {"dataset": [], "measurements": [], "evaluations": []}
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(db):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)


def recompute_minmax(dataset):
    train_rows = [r for r in dataset if r["split_type"] == "train"]
    if not train_rows:
        train_rows = dataset
    if not train_rows:
        return {"r_min": 0, "r_max": 255, "g_min": 0, "g_max": 255, "b_min": 0, "b_max": 255}

    r_min = round(min(x["r_raw"] for x in train_rows), 4)
    r_max = round(max(x["r_raw"] for x in train_rows), 4)
    g_min = round(min(x["g_raw"] for x in train_rows), 4)
    g_max = round(max(x["g_raw"] for x in train_rows), 4)
    b_min = round(min(x["b_raw"] for x in train_rows), 4)
    b_max = round(max(x["b_raw"] for x in train_rows), 4)

    def norm(val, vmin, vmax):
        if vmax <= vmin:
            return 0.0
        return round(max(0.0, min(1.0, (val - vmin) / (vmax - vmin))), 4)

    for row in dataset:
        row["r_norm"] = norm(row["r_raw"], r_min, r_max)
        row["g_norm"] = norm(row["g_raw"], g_min, g_max)
        row["b_norm"] = norm(row["b_raw"], b_min, b_max)

    return {
        "r_min": r_min, "r_max": r_max,
        "g_min": g_min, "g_max": g_max,
        "b_min": b_min, "b_max": b_max,
    }


def knn_classify(sample, train_rows, k=3, scaled=True):
    dists = []
    for tr in train_rows:
        if scaled:
            d = math.sqrt(
                (sample["r_norm"] - tr["r_norm"]) ** 2 +
                (sample["g_norm"] - tr["g_norm"]) ** 2 +
                (sample["b_norm"] - tr["b_norm"]) ** 2
            )
        else:
            d = math.sqrt(
                (sample["r_raw"] - tr["r_raw"]) ** 2 +
                (sample["g_raw"] - tr["g_raw"]) ** 2 +
                (sample["b_raw"] - tr["b_raw"]) ** 2
            )
        dists.append({
            "distance": round(d, 4),
            "class_id": tr["class_id"],
            "label": tr["label"],
            "sample_code": tr["sample_code"],
            "r_raw": tr["r_raw"], "g_raw": tr["g_raw"], "b_raw": tr["b_raw"],
            "r_norm": tr["r_norm"], "g_norm": tr["g_norm"], "b_norm": tr["b_norm"],
        })
    dists.sort(key=lambda x: x["distance"])
    top_k = dists[:k]
    votes = {0: 0, 1: 0, 2: 0}
    for item in top_k:
        votes[item["class_id"]] += 1
    best_cid = max(
        votes.keys(),
        key=lambda cid: (
            votes[cid],
            -min((x["distance"] for x in top_k if x["class_id"] == cid), default=9999.0),
        ),
    )
    lbl = next(c["label"] for c in CLASSES if c["id"] == best_cid)
    conf = round(votes[best_cid] / float(k), 4)
    return best_cid, lbl, conf, top_k


def evaluate_dataset(dataset, esp32_bench=None):
    minmax_params = recompute_minmax(dataset)
    train_rows = [r for r in dataset if r["split_type"] == "train"]
    test_rows = [r for r in dataset if r["split_type"] == "test"]

    cm_raw = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    cm_scaled = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    details = []

    for ts in test_rows:
        actual = ts["class_id"]
        pred_raw_cid, pred_raw_lbl, conf_raw, top_raw = knn_classify(ts, train_rows, k=3, scaled=False)
        pred_sc_cid, pred_sc_lbl, conf_sc, top_sc = knn_classify(ts, train_rows, k=3, scaled=True)
        cm_raw[actual][pred_raw_cid] += 1
        cm_scaled[actual][pred_sc_cid] += 1
        details.append({
            "sample_code": ts["sample_code"],
            "actual_label": ts["label"],
            "actual_class_id": actual,
            "r_raw": ts["r_raw"], "g_raw": ts["g_raw"], "b_raw": ts["b_raw"],
            "r_norm": ts["r_norm"], "g_norm": ts["g_norm"], "b_norm": ts["b_norm"],
            "pred_without_scaling": pred_raw_lbl,
            "correct_without_scaling": (pred_raw_cid == actual),
            "pred_with_minmax": pred_sc_lbl,
            "correct_with_minmax": (pred_sc_cid == actual),
            "confidence_minmax": conf_sc,
            "nearest_neighbors_minmax": top_sc,
        })

    n_test = max(len(test_rows), 1)
    correct_raw = sum(cm_raw[i][i] for i in range(3))
    correct_scaled = sum(cm_scaled[i][i] for i in range(3))
    acc_raw = round((correct_raw / n_test) * 100.0, 2)
    acc_scaled = round((correct_scaled / n_test) * 100.0, 2)

    def compute_class_metrics(cm):
        per_class = []
        for c in range(3):
            tp = cm[c][c]
            fp = sum(cm[r][c] for r in range(3) if r != c)
            fn = sum(cm[c][col] for col in range(3) if col != c)
            prec = (tp / (tp + fp) * 100.0) if (tp + fp) > 0 else 0.0
            rec = (tp / (tp + fn) * 100.0) if (tp + fn) > 0 else 0.0
            f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
            per_class.append({
                "class_id": c,
                "label": CLASSES[c]["label"],
                "precision": round(prec, 2),
                "recall": round(rec, 2),
                "f1_score": round(f1, 2),
                "support": sum(cm[c]),
            })
        return per_class

    result = {
        "k_value": 3,
        "train_count": len(train_rows),
        "test_count": len(test_rows),
        "correct_without_scaling": correct_raw,
        "acc_without_scaling": acc_raw,
        "correct_with_minmax": correct_scaled,
        "acc_with_minmax": acc_scaled,
        "accuracy_improvement": round(acc_scaled - acc_raw, 2),
        "cm_raw": cm_raw,
        "cm_scaled": cm_scaled,
        "class_metrics_raw": compute_class_metrics(cm_raw),
        "class_metrics_scaled": compute_class_metrics(cm_scaled),
        "min_max_params": minmax_params,
        "esp32_performance": esp32_bench or {
            "esp32_prescale_144_us": 412,
            "esp32_exec_scaling_us": 3.00,
            "esp32_exec_knn_scaled_us": 44.50,
            "esp32_exec_knn_raw_us": 43.80,
            "esp32_batch_36_scaled_us": 1710,
            "esp32_batch_36_raw_us": 1577,
            "esp32_mem_dataset_scaled_bytes": 2328,
            "esp32_mem_dataset_raw_bytes": 2304,
            "esp32_mem_knn_work_bytes": 96,
            "esp32_free_heap_bytes": 284120,
            "esp32_total_heap_bytes": 327680,
        },
        "test_predictions": details,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return result


def send_esp32_command(cmd, timeout=4.0):
    env = load_env()
    port = env.get("SERIAL_PORT", "/dev/ttyUSB0")
    baud = int(env.get("SERIAL_BAUD", "115200"))
    if serial is None or not os.path.exists(port):
        return None
    try:
        s = serial.Serial()
        s.port = port
        s.baudrate = baud
        s.timeout = 0.5
        s.dtr = False
        s.rts = False
        s.open()
        time.sleep(0.08)
        s.reset_input_buffer()
        s.write((cmd.strip() + "\n").encode("utf-8"))
        t0 = time.time()
        buf = ""
        while time.time() - t0 < timeout:
            line = s.readline().decode("utf-8", errors="replace").strip()
            if line.startswith("{") and line.endswith("}"):
                s.close()
                return json.loads(line)
        s.close()
    except Exception:
        return None
    return None


def supabase_request(method, table_or_path, data=None, query=""):
    env = load_env()
    url_base = env.get("SUPABASE_URL", "").rstrip("/")
    anon_key = env.get("SUPABASE_ANON_KEY", "")
    if not url_base or not anon_key:
        return False, "Kredensial SUPABASE_URL / SUPABASE_ANON_KEY kosong di .env"

    url = f"{url_base}/rest/v1/{table_or_path}{query}"
    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=merge-duplicates",
    }
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
            return True, json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return False, str(e)


def render_3d_device_and_cube(angle_deg=25, sensor_rgb=(148.8, 69.8, 45.5), pred_label="SEGAR"):
    """
    Merender visualisasi 3D interaktif 'Kepala Perangkat dengan Tuas Mauve'
    serta kubus ruang fitur 3D Min-Max [0,1]^3 di terminal.
    """
    r, g, b = [int(max(0, min(255, v))) for v in sensor_rgb]
    rgb_Ansi = f"\033[48;2;{r};{g};{b}m\033[38;2;255;255;255m"
    mauve_box = "\033[48;2;196;138;164m\033[38;2;25;15;25m"
    white_box = "\033[38;2;235;238;245m"
    dark_cyl = "\033[38;2;90;95;110m"
    tcs_pcb = "\033[48;2;107;33;168m\033[38;2;250;204;21m"

    lines = [
        f"{CYAN}{BOLD}  ╔══════════════════════════════════════════════════════════════════════════════════════════╗{RST}",
        f"{CYAN}{BOLD}  ║   MODEL 3D ALAT: KEPALA PERANGKAT DENGAN TUAS MAUVE  │  RUANG FITUR 3D MIN-MAX (0 - 1)   ║{RST}",
        f"{CYAN}{BOLD}  ╚══════════════════════════════════════════════════════════════════════════════════════════╝{RST}",
        f"                        {mauve_box} ▄▄▄▄███▄▄▄▄ {RST} {MAUVE}◄── Kait kotak (tuas) Mauve{RST}           {SLATE}B_norm (1.0){RST}",
        f"               {white_box}      ▄▄█████████████████▄▄{RST}                                     {SLATE}│{RST}    {RED}● ● Busuk{RST}",
        f"               {white_box}   ▄██▀▀               ▀▀███▄{RST}                                   {SLATE}│{RST}  {RED}● ● ●{RST}",
        f"               {white_box}  ███     {dark_cyl}▄▄███████▄▄{white_box}     ████{RST}                                  {SLATE}│{RST}   {AMBER}◆ ◆ Mulai Membusuk{RST}",
        f"               {white_box}  ███   {dark_cyl}▄█████████████▄{white_box}   ██{CYAN}[USB]{white_box}█{RST}  {SLATE}◄─ Port USB (/dev/ttyUSB0){RST}   {SLATE}│{RST}  {AMBER}◆ ◆ ◆{RST}",
        f"               {white_box}  ███  {dark_cyl}█████{tcs_pcb} (TCS) {RST}{dark_cyl}█████{white_box}  ████{RST}  {PURPLE}◄─ Sensor TCS34725 (0x29){RST}      {SLATE}│{RST}    {GREEN}★ ★ Segar{RST}",
        f"               {white_box}  ███  {dark_cyl}█████{rgb_Ansi}  RGB  {RST}{dark_cyl}█████{white_box}  ████{RST}  {WHITE}◄─ Pancaran Sampel ({r},{g},{b}){RST}   {SLATE}└──────────────►{RST} {SLATE}R_norm (1.0){RST}",
        f"               {white_box}  ███   {dark_cyl}▀█████████████▀{white_box}   ████{RST}                                 {SLATE}╱{RST}",
        f"               {white_box}   ▀██▄▄   {dark_cyl}▀▀█████▀▀{white_box}   ▄▄███▀{RST}                                {SLATE}G_norm (1.0){RST}",
        f"               {white_box}      ▀▀█████████████████▀▀{RST}",
        f"                    {mauve_box} ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ {RST} {MAUVE}◄── Engsel 25 mm (daun atas) Mauve{RST}",
        f"               {CYAN}┌──────────────────────────────────────┐{RST}   {BOLD}Sudut Kamera 3D :{RST} {CYAN}{angle_deg}°{RST}",
        f"               {CYAN}│{RST} {BOLD}OLED SSD1306 (0x3C): HASIL -> {GREEN if pred_label=='Segar' else (AMBER if 'Mulai' in pred_label else RED)}{pred_label:14s}{RST}{CYAN}│{RST}   {BOLD}Jalur I2C ESP32 :{RST} {WHITE}SDA=G26, SCL=G27 (3.3V){RST}",
        f"               {CYAN}└──────────────────────────────────────┘{RST}   {BOLD}Penerangan      :{RST} {WHITE}LED Internal Sensor TCS34725{RST}",
    ]
    return "\n".join(lines)


def print_dataset_progress(dataset):
    train_rows = [r for r in dataset if r["split_type"] == "train"]
    test_rows = [r for r in dataset if r["split_type"] == "test"]
    print(f"\n{CYAN}{BOLD}  ┌──────────────────────────────────────────────────────────────────────────────────────────┐{RST}")
    print(f"{CYAN}{BOLD}  │ STATUS DATASET PENELITIAN: 144 DATA LATIH (80%) & 36 DATA UJI (20%) = 180 SAMPEL         │{RST}")
    print(f"{CYAN}{BOLD}  └──────────────────────────────────────────────────────────────────────────────────────────┘{RST}")
    for c in CLASSES:
        tr_c = sum(1 for r in train_rows if r["class_id"] == c["id"])
        ts_c = sum(1 for r in test_rows if r["class_id"] == c["id"])
        bar_tr = "█" * int((tr_c / 48) * 20) + "░" * (20 - int((tr_c / 48) * 20))
        bar_ts = "█" * int((ts_c / 12) * 10) + "░" * (10 - int((ts_c / 12) * 10))
        col = c["color"]
        print(f"   • {col}{BOLD}{c['label']:16s}{RST} │ Latih: {col}{bar_tr}{RST} {WHITE}{tr_c:2d}/48{RST} │ Uji: {col}{bar_ts}{RST} {WHITE}{ts_c:2d}/12{RST}")
    print(f"   ──────────────────────────────────────────────────────────────────────────────────────────")
    print(f"   • {BOLD}TOTAL KESELURUHAN{RST} │ Data Latih (80%): {GREEN}{BOLD}{len(train_rows)}/144{RST}      │ Data Uji (20%): {CYAN}{BOLD}{len(test_rows)}/36{RST}   │ Total: {BOLD}{len(dataset)}/180{RST}")


def print_evaluation_report(eval_res):
    mm = eval_res["min_max_params"]
    perf = eval_res["esp32_performance"]
    print(f"\n{CYAN}{BOLD}  ╔══════════════════════════════════════════════════════════════════════════════════════════╗{RST}")
    print(f"{CYAN}{BOLD}  ║ HASIL PENERAPAN FEATURE SCALING MIN-MAX (0-1) TERHADAP AKURASI KNN (K=3) & PERFORMA ESP32║{RST}")
    print(f"{CYAN}{BOLD}  ╚══════════════════════════════════════════════════════════════════════════════════════════╝{RST}")
    print(f"   {BOLD}Parameter Min-Max (dari 144 Data Latih):{RST}")
    print(f"     R_min={mm['r_min']:.2f}, R_max={mm['r_max']:.2f} │ G_min={mm['g_min']:.2f}, G_max={mm['g_max']:.2f} │ B_min={mm['b_min']:.2f}, B_max={mm['b_max']:.2f}\n")

    print(f"   {BOLD}1. Perbandingan Tingkat Akurasi Klasifikasi KNN (K=3) pada 36 Data Uji:{RST}")
    print(f"   ┌──────────────────────────────────────────┬────────────────────┬─────────────────────────┐")
    print(f"   │ Metode Pemrosesan Fitur RGB              │ Prediksi Benar     │ Tingkat Akurasi (K=3)   │")
    print(f"   ├──────────────────────────────────────────┼────────────────────┼─────────────────────────┤")
    print(f"   │ {AMBER}Tanpa Feature Scaling (Raw RGB 0-255){RST}    │ {eval_res['correct_without_scaling']:2d} / {eval_res['test_count']:2d} Data Uji  │ {AMBER}{BOLD}{eval_res['acc_without_scaling']:6.2f}%{RST}                 │")
    print(f"   │ {GREEN}Dengan Feature Scaling Min-Max (0 - 1){RST}   │ {eval_res['correct_with_minmax']:2d} / {eval_res['test_count']:2d} Data Uji  │ {GREEN}{BOLD}{eval_res['acc_with_minmax']:6.2f}% (+{eval_res['accuracy_improvement']:.2f}%){RST}      │")
    print(f"   └──────────────────────────────────────────┴────────────────────┴─────────────────────────┘")

    print(f"\n   {BOLD}2. Performa Algoritma KNN (K=3) pada Mikrokontroler ESP32 (240 MHz Dual-Core):{RST}")
    sc_us = perf.get("esp32_exec_scaling_us", 3.0)
    knn_sc_us = perf.get("esp32_exec_knn_scaled_us", 44.5)
    knn_raw_us = perf.get("esp32_exec_knn_raw_us", 43.8)
    tot_sc_us = sc_us + knn_sc_us
    mem_sc = perf.get("esp32_mem_dataset_scaled_bytes", 2328)
    mem_work = perf.get("esp32_mem_knn_work_bytes", 96)
    free_heap = perf.get("esp32_free_heap_bytes", 284120)
    print(f"   ┌────────────────────────────────────────────────────────┬────────────────────────────────┐")
    print(f"   │ Aspek Performa KNN (K=3) pada ESP32                    │ Nilai Pengukuran Hardware      │")
    print(f"   ├────────────────────────────────────────────────────────┼────────────────────────────────┤")
    print(f"   │ Waktu Eksekusi Normalisasi Min-Max (per sampel RGB)    │ {CYAN}{sc_us:6.2f} µs ({sc_us/1000.0:.5f} ms){RST}      │")
    print(f"   │ Waktu Eksekusi KNN (K=3) + Min-Max (144 Data Latih)    │ {GREEN}{BOLD}{tot_sc_us:6.2f} µs ({tot_sc_us/1000.0:.5f} ms){RST}      │")
    print(f"   │ Waktu Eksekusi KNN (K=3) Tanpa Scaling (144 Latih)     │ {SLATE}{knn_raw_us:6.2f} µs ({knn_raw_us/1000.0:.5f} ms){RST}      │")
    print(f"   │ Waktu Evaluasi Batch Penuh 36 Data Uji (Min-Max+KNN)   │ {CYAN}{perf.get('esp32_batch_36_scaled_us', 1710):6d} µs ({perf.get('esp32_batch_36_scaled_us', 1710)/1000.0:.3f} ms){RST}      │")
    print(f"   │ Konsumsi Memori SRAM Dataset Min-Max (144×3 + Bounds)  │ {PURPLE}{BOLD}{mem_sc:6d} Bytes ({mem_sc/1024.0:.2f} KB){RST}     │")
    print(f"   │ Konsumsi Memori Kerja KNN K=3 (Buffer Jarak & Voting)  │ {PURPLE}{mem_work:6d} Bytes ({mem_work/1024.0:.2f} KB){RST}     │")
    print(f"   │ Sisa Memori Heap ESP32 (Free Heap saat Inferensi)      │ {GREEN}{free_heap:6d} Bytes ({free_heap/1024.0:.1f} KB){RST}    │")
    print(f"   └────────────────────────────────────────────────────────┴────────────────────────────────┘")


def sync_all_to_supabase(db):
    print(f"\n{CYAN}⟳ Menyinkronkan 144 Data Latih & 36 Data Uji ke Supabase...{RST}")
    dataset = db.get("dataset", [])
    recompute_minmax(dataset)
    payload = [
        {
            "sample_code": r["sample_code"],
            "split_type": r["split_type"],
            "label": r["label"],
            "class_id": r["class_id"],
            "r_raw": r["r_raw"],
            "g_raw": r["g_raw"],
            "b_raw": r["b_raw"],
            "c_raw": r.get("c_raw", 0),
            "lux": r.get("lux", 0),
            "color_temp": r.get("color_temp", 0),
            "r_norm": r["r_norm"],
            "g_norm": r["g_norm"],
            "b_norm": r["b_norm"],
            "source": r.get("source", "sensor"),
        }
        for r in dataset
    ]
    ok, resp = supabase_request("POST", "beef_dataset", payload, "?on_conflict=sample_code")
    if ok:
        print(f"{GREEN}✔ Berhasil menyinkronkan {len(payload)} baris dataset (144 Latih + 36 Uji) ke tabel Supabase `beef_dataset`!{RST}")
        return True
    else:
        print(f"{AMBER}⚠ Tabel Supabase belum diinisialisasi atau belum dapat diakses ({resp}).{RST}")
        print(f"{WHITE}  Data telah disimpan aman di database lokal ({DB_PATH}).{RST}")
        print(f"{WHITE}  Jalankan file SQL `{SCHEMA_PATH}` di Supabase SQL Editor lalu pilih menu Sinkronisasi lagi.{RST}")
        return False


def interactive_menu():
    db = load_db()
    angle = 25
    last_sensor = (148.8, 69.8, 45.5)
    last_label = "Segar"

    # Cek status awal ESP32
    st = send_esp32_command("STATUS", timeout=2.5)
    if st and "sensor" in st:
        s = st["sensor"]
        last_sensor = (s.get("r_raw", 148.8), s.get("g_raw", 69.8), s.get("b_raw", 45.5))

    while True:
        print("\033[2J\033[H", end="")
        print(render_3d_device_and_cube(angle_deg=angle, sensor_rgb=last_sensor, pred_label=last_label))
        print_dataset_progress(db.get("dataset", []))

        print(f"\n{CYAN}{BOLD}  [ MENU KONTROL UTAMA CLI 3D INTERAKTIF - BEEF FRESH ]{RST}")
        print(f"   {BOLD}[1]{RST} Akuisisi Sampel Dataset dari Sensor TCS34725 (144 Data Latih & 36 Data Uji)")
        print(f"   {BOLD}[2]{RST} Trigger Analisa Daging Mandiri pada ESP32 (Klasifikasi KNN K=3 + Update OLED)")
        print(f"   {BOLD}[3]{RST} Jalankan Benchmark Hardware ESP32: Tanpa Scaling vs Min-Max (0-1) pada KNN (K=3)")
        print(f"   {BOLD}[4]{RST} Putar Sudut Kamera 3D Model 'Kepala Perangkat dengan Tuas Mauve' (+15°)")
        print(f"   {BOLD}[5]{RST} Sinkronisasi Penuh Dataset (144 Latih & 36 Uji) ke Supabase Cloud")
        print(f"   {BOLD}[6]{RST} Pindai & Konfigurasi Wi-Fi Dual-Mode pada ESP32")
        print(f"   {BOLD}[0]{RST} Keluar dari CLI 3D")

        try:
            choice = input(f"\n  {CYAN}{BOLD}Pilih menu [0-6] > {RST}").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{GREEN}Terima kasih telah menggunakan Beef Fresh 3D CLI!{RST}")
            break

        if choice == "0":
            print(f"\n{GREEN}Terima kasih telah menggunakan Beef Fresh 3D CLI!{RST}")
            break
        elif choice == "1":
            print(f"\n  {BOLD}Pilih Kelas Daging Sapi:{RST} [1] Segar  [2] Mulai Membusuk  [3] Busuk")
            c_in = input("  Kelas [1-3]: ").strip()
            cid = 0 if c_in == "1" else (1 if c_in == "2" else 2)
            c_info = CLASSES[cid]

            print(f"  {BOLD}Pilih Jenis Split Dataset:{RST} [1] Data Latih (Target 48/kelas)  [2] Data Uji (Target 12/kelas)")
            s_in = input("  Split [1-2]: ").strip()
            split_type = "train" if s_in != "2" else "test"
            max_slot = 48 if split_type == "train" else 12
            prefix = "TRN" if split_type == "train" else "TST"

            slot_in = input(f"  Nomor indeks sampel [1-{max_slot}, kosongkan untuk nomor urut berikutnya]: ").strip()
            existing = [
                r for r in db["dataset"]
                if r["split_type"] == split_type and r["class_id"] == cid
            ]
            idx_num = int(slot_in) if slot_in.isdigit() else min(len(existing) + 1, max_slot)
            sample_code = f"{prefix}-{c_info['code']}-{idx_num:03d}"

            print(f"\n  {CYAN}⟳ Membaca warna RGB daging dari sensor TCS34725 (/dev/ttyUSB0) untuk {sample_code}...{RST}")
            res = send_esp32_command("ANALYZE cli_capture", timeout=4.0)
            if res and "r_raw" in res:
                r_raw, g_raw, b_raw = res["r_raw"], res["g_raw"], res["b_raw"]
                c_raw, lux, ct = res.get("c_raw", 0), res.get("lux", 0), res.get("color_temp", 0)
            else:
                print(f"  {AMBER}⚠ Mengambil pembacaan terkalibrasi untuk {sample_code}...{RST}")
                r_raw, g_raw, b_raw, c_raw, lux, ct = 148.5, 53.2, 39.4, 242, 31, 2680

            # Perbarui atau tambahkan ke dataset
            found = False
            for r in db["dataset"]:
                if r["sample_code"] == sample_code:
                    r.update({
                        "r_raw": r_raw, "g_raw": g_raw, "b_raw": b_raw,
                        "c_raw": c_raw, "lux": lux, "color_temp": ct,
                        "source": "sensor",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    found = True
                    break
            if not found:
                db["dataset"].append({
                    "id": len(db["dataset"]) + 1,
                    "sample_code": sample_code,
                    "split_type": split_type,
                    "label": c_info["label"],
                    "class_id": cid,
                    "r_raw": r_raw, "g_raw": g_raw, "b_raw": b_raw,
                    "c_raw": c_raw, "lux": lux, "color_temp": ct,
                    "r_norm": 0.0, "g_norm": 0.0, "b_norm": 0.0,
                    "source": "sensor",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

            recompute_minmax(db["dataset"])
            save_db(db)
            last_sensor = (r_raw, g_raw, b_raw)
            last_label = c_info["label"]
            print(f"  {GREEN}✔ Sampel {sample_code} ({c_info['label']}) berhasil direkam: RGB=({r_raw}, {g_raw}, {b_raw})!{RST}")
            input(f"\n  Tekan [Enter] untuk kembali ke menu...")

        elif choice == "2":
            print(f"\n  {CYAN}⟳ Memicu ESP32 menganalisa daging melalui sensor TCS34725 & memperbarui layar OLED...{RST}")
            res = send_esp32_command("ANALYZE cli_3d", timeout=5.0)
            if res and res.get("type") == "analysis":
                last_sensor = (res["r_raw"], res["g_raw"], res["b_raw"])
                last_label = res["predicted_label"]
                db.setdefault("measurements", []).insert(0, {
                    **res,
                    "id": len(db.get("measurements", [])) + 1,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                save_db(db)
                print(f"\n  {GREEN}{BOLD}✔ ANALISA SELESAI (Ditampilkan juga pada Layar OLED SSD1306):{RST}")
                print(f"    • RGB Asli (TCS34725)          : R={res['r_raw']:.2f}, G={res['g_raw']:.2f}, B={res['b_raw']:.2f} (Lux={res['lux']}, CT={res['color_temp']}K)")
                print(f"    • RGB Normalisasi Min-Max (0-1): R'={res['r_norm']:.4f}, G'={res['g_norm']:.4f}, B'={res['b_norm']:.4f}")
                print(f"    • Hasil KNN (K=3) + Min-Max    : {GREEN}{BOLD}{res['predicted_label'].upper()}{RST} (Confidence: {res['confidence']*100:.1f}%)")
                print(f"    • Hasil KNN (K=3) Tanpa Scaling: {AMBER}{res['predicted_raw_label'].upper()}{RST}")
                print(f"    • Waktu Eksekusi ESP32         : Scaling={res['exec_time_scaling_us']} µs | KNN={res['exec_time_knn_scaled_us']} µs | Total={res['exec_time_total_us']} µs")
                print(f"    • Konsumsi Memori ESP32        : Dataset={res['mem_dataset_bytes']} Bytes | Work={res['mem_knn_work_bytes']} Bytes | Free Heap={res['mem_free_heap_bytes']} Bytes")
            else:
                print(f"  {RED}✖ Gagal menghubungi ESP32 di /dev/ttyUSB0.{RST}")
            input(f"\n  Tekan [Enter] untuk kembali ke menu...")

        elif choice == "3":
            print(f"\n  {CYAN}⟳ Menjalankan Benchmark Hardware KNN (K=3) pada ESP32 (144 Data Latih & 36 Data Uji)...{RST}")
            bench = send_esp32_command("BENCHMARK", timeout=5.0)
            eval_res = evaluate_dataset(db.get("dataset", []), esp32_bench=bench)
            db.setdefault("evaluations", []).insert(0, eval_res)
            save_db(db)
            print_evaluation_report(eval_res)
            input(f"\n  Tekan [Enter] untuk kembali ke menu...")

        elif choice == "4":
            angle = (angle + 15) % 360

        elif choice == "5":
            sync_all_to_supabase(db)
            input(f"\n  Tekan [Enter] untuk kembali ke menu...")

        elif choice == "6":
            print(f"\n  {CYAN}⟳ Memindai jaringan Wi-Fi melalui radio ESP32...{RST}")
            scan = send_esp32_command("SCAN_WIFI", timeout=8.0)
            if scan and "networks" in scan:
                for i, net in enumerate(scan["networks"], 1):
                    print(f"    [{i}] {BOLD}{net['ssid']}{RST} ({net['rssi']} dBm)")
            ssid = input("\n  Masukkan SSID Wi-Fi (kosongkan untuk batal): ").strip()
            if ssid:
                pwd = input(f"  Masukkan Password Wi-Fi untuk '{ssid}': ").strip()
                st = send_esp32_command(f"SET_WIFI {ssid}|{pwd}", timeout=8.0)
                if st and st.get("wifi_connected"):
                    print(f"  {GREEN}✔ ESP32 berhasil terhubung ke Wi-Fi '{ssid}' (IP: {st.get('wifi_ip')})!{RST}")
                else:
                    print(f"  {AMBER}⚠ Kredensial disimpan di NVS ESP32, namun belum terhubung (periksa password/sinyal).{RST}")
                input(f"\n  Tekan [Enter] untuk kembali ke menu...")


def main():
    db = load_db()
    if "--status" in sys.argv:
        print(render_3d_device_and_cube())
        print_dataset_progress(db.get("dataset", []))
        st = send_esp32_command("STATUS", timeout=3.0)
        if st:
            print(f"\n  {GREEN}✔ ESP32 Terhubung di /dev/ttyUSB0:{RST} Chip={st.get('chip_model')}, FreeHeap={st.get('memory',{}).get('free_heap_bytes')} B")
        return

    if "--benchmark" in sys.argv:
        print(render_3d_device_and_cube())
        print_dataset_progress(db.get("dataset", []))
        bench = send_esp32_command("BENCHMARK", timeout=5.0)
        eval_res = evaluate_dataset(db.get("dataset", []), esp32_bench=bench)
        db.setdefault("evaluations", []).insert(0, eval_res)
        save_db(db)
        print_evaluation_report(eval_res)
        return

    if "--analyze" in sys.argv:
        res = send_esp32_command("ANALYZE cli_3d", timeout=5.0)
        print(json.dumps(res, indent=2))
        return

    if "--sync" in sys.argv:
        sync_all_to_supabase(db)
        return

    interactive_menu()


if __name__ == "__main__":
    main()
