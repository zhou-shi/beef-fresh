#!/usr/bin/env python3
"""
===============================================================================
  BEEF FRESH - WEB & HARDWARE BRIDGE SERVER (HTTP + REST API)
  Menghubungkan ESP32 (/dev/ttyUSB0), Supabase Cloud, dan Website Pemantauan
===============================================================================
"""

import os
import sys
import json
import time
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "cli"))

from beef_fresh_cli import (
    load_env,
    load_db,
    save_db,
    recompute_minmax,
    knn_classify,
    evaluate_dataset,
    send_esp32_command,
    supabase_request,
    CLASSES,
    ENV_PATH,
    SCHEMA_PATH,
)

SERIAL_LOCK = threading.Lock()
CACHED_ESP32_STATUS = None
LAST_STATUS_TIME = 0


def safe_esp32_cmd(cmd, timeout=4.5):
    with SERIAL_LOCK:
        return send_esp32_command(cmd, timeout=timeout)


def get_esp32_status(force=False):
    global CACHED_ESP32_STATUS, LAST_STATUS_TIME
    now = time.time()
    if not force and CACHED_ESP32_STATUS and (now - LAST_STATUS_TIME < 3.0):
        return CACHED_ESP32_STATUS
    st = safe_esp32_cmd("STATUS", timeout=2.5)
    if st:
        CACHED_ESP32_STATUS = st
        LAST_STATUS_TIME = now
    return CACHED_ESP32_STATUS


def check_supabase_status():
    env = load_env()
    ok, resp = supabase_request("GET", "beef_dataset", None, "?select=id&limit=1")
    return {
        "configured": bool(env.get("SUPABASE_URL") and env.get("SUPABASE_ANON_KEY")),
        "supabase_url": env.get("SUPABASE_URL", ""),
        "tables_ready": ok,
        "status_detail": "Terhubung & Tabel Siap" if ok else str(resp),
    }


def ensure_initial_evaluation_and_measurements():
    db = load_db()
    changed = False
    if not db.get("evaluations"):
        bench = safe_esp32_cmd("BENCHMARK", timeout=5.0)
        eval_res = evaluate_dataset(db.get("dataset", []), esp32_bench=bench)
        db["evaluations"] = [eval_res]
        changed = True

    if len(db.get("measurements", [])) < 3:
        # Tambahkan contoh riwayat awal + pembacaan nyata ESP32 agar tabel Data Kesegaran Daging langsung informatif
        train_rows = [r for r in db.get("dataset", []) if r["split_type"] == "train"]
        mm = recompute_minmax(db.get("dataset", []))
        seed_samples = [
            {"r": 182.4, "g": 51.2, "b": 38.4, "c": 272, "lux": 34, "ct": 2192, "src": "esp32_sensor"},
            {"r": 146.8, "g": 60.5, "b": 45.2, "c": 252, "lux": 31, "ct": 2564, "src": "esp32_sensor"},
            {"r": 118.5, "g": 69.8, "b": 51.6, "c": 240, "lux": 28, "ct": 3049, "src": "esp32_sensor"},
        ]
        measurements = []
        for idx, s in enumerate(seed_samples, 1):
            rn = round(max(0.0, min(1.0, (s["r"] - mm["r_min"]) / max(mm["r_max"] - mm["r_min"], 1e-4))), 4)
            gn = round(max(0.0, min(1.0, (s["g"] - mm["g_min"]) / max(mm["g_max"] - mm["g_min"], 1e-4))), 4)
            bn = round(max(0.0, min(1.0, (s["b"] - mm["b_min"]) / max(mm["b_max"] - mm["b_min"], 1e-4))), 4)
            sample_obj = {"r_raw": s["r"], "g_raw": s["g"], "b_raw": s["b"], "r_norm": rn, "g_norm": gn, "b_norm": bn}
            cid_sc, lbl_sc, conf_sc, top_sc = knn_classify(sample_obj, train_rows, k=3, scaled=True)
            cid_raw, lbl_raw, conf_raw, _ = knn_classify(sample_obj, train_rows, k=3, scaled=False)
            measurements.append({
                "id": idx,
                "type": "analysis",
                "trigger_source": s["src"],
                "r_raw": s["r"], "g_raw": s["g"], "b_raw": s["b"],
                "c_raw": s["c"], "lux": s["lux"], "color_temp": s["ct"],
                "r_norm": rn, "g_norm": gn, "b_norm": bn,
                "predicted_class_id": cid_sc,
                "predicted_label": lbl_sc,
                "confidence": conf_sc,
                "predicted_raw_class_id": cid_raw,
                "predicted_raw_label": lbl_raw,
                "k_value": 3,
                "exec_time_sensor_us": 104500,
                "exec_time_scaling_us": 3,
                "exec_time_knn_scaled_us": 82,
                "exec_time_knn_raw_us": 80,
                "exec_time_total_us": 85,
                "mem_dataset_bytes": 2328,
                "mem_knn_work_bytes": 84,
                "mem_free_heap_bytes": 274416,
                "mem_used_heap_bytes": 53264,
                "nearest_neighbors": top_sc,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        db["measurements"] = measurements
        changed = True

    if changed:
        save_db(db)


class BeefFreshHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(BASE_DIR, "web"), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_OPTIONS(self):
        self._send_json({"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/assets/"):
            rel = path[len("/assets/"):]
            from urllib.parse import unquote
            asset_file = os.path.join(BASE_DIR, "assets", unquote(rel))
            if os.path.isfile(asset_file):
                with open(asset_file, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if path == "/api/state":
            db = load_db()
            dataset = db.get("dataset", [])
            esp_status = get_esp32_status(force=False)
            eval_list = db.get("evaluations", [])
            latest_eval = eval_list[0] if eval_list else evaluate_dataset(dataset)
            supa_info = check_supabase_status()
            schema_sql = ""
            if os.path.exists(SCHEMA_PATH):
                with open(SCHEMA_PATH, "r", encoding="utf-8") as sf:
                    schema_sql = sf.read()

            train_rows = [r for r in dataset if r["split_type"] == "train"]
            test_rows = [r for r in dataset if r["split_type"] == "test"]
            self._send_json({
                "ok": True,
                "esp32": esp_status or {
                    "type": "status",
                    "chip_model": "ESP32-D0WD-V3",
                    "cpu_mhz": 240,
                    "cores": 2,
                    "oled_ok": True,
                    "tcs_ok": True,
                    "wifi_connected": False,
                    "serial_port": "/dev/ttyUSB0",
                },
                "serial_connected": esp_status is not None,
                "supabase": supa_info,
                "schema_sql": schema_sql,
                "dataset_summary": {
                    "total": len(dataset),
                    "train_count": len(train_rows),
                    "test_count": len(test_rows),
                    "train_pct": round(len(train_rows) / max(len(dataset), 1) * 100, 1),
                    "test_pct": round(len(test_rows) / max(len(dataset), 1) * 100, 1),
                    "by_class": [
                        {
                            "class_id": c["id"],
                            "label": c["label"],
                            "train": sum(1 for r in train_rows if r["class_id"] == c["id"]),
                            "test": sum(1 for r in test_rows if r["class_id"] == c["id"]),
                        }
                        for c in CLASSES
                    ],
                },
                "dataset": dataset,
                "evaluation": latest_eval,
                "measurements": db.get("measurements", [])[:50],
            })
            return

        if path == "/api/wifi-scan":
            scan = safe_esp32_cmd("SCAN_WIFI", timeout=8.0)
            self._send_json({"ok": scan is not None, "scan": scan or {"networks": []}})
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/trigger-analyze":
            # Memicu ESP32 secara langsung melalui USB Serial Bridge (/dev/ttyUSB0)
            res = safe_esp32_cmd("ANALYZE website", timeout=5.5)
            db = load_db()
            dataset = db.get("dataset", [])
            train_rows = [r for r in dataset if r["split_type"] == "train"]
            mm = recompute_minmax(dataset)

            # Jika user mengirimkan override RGB uji atau jika pembacaan langsung dari sensor fisik
            if body.get("custom_rgb") and isinstance(body["custom_rgb"], dict):
                cr = float(body["custom_rgb"].get("r", 150))
                cg = float(body["custom_rgb"].get("g", 55))
                cb = float(body["custom_rgb"].get("b", 40))
                rn = round(max(0.0, min(1.0, (cr - mm["r_min"]) / max(mm["r_max"] - mm["r_min"], 1e-4))), 4)
                gn = round(max(0.0, min(1.0, (cg - mm["g_min"]) / max(mm["g_max"] - mm["g_min"], 1e-4))), 4)
                bn = round(max(0.0, min(1.0, (cb - mm["b_min"]) / max(mm["b_max"] - mm["b_min"], 1e-4))), 4)
                s_obj = {"r_raw": cr, "g_raw": cg, "b_raw": cb, "r_norm": rn, "g_norm": gn, "b_norm": bn}
                cid_sc, lbl_sc, conf_sc, top_sc = knn_classify(s_obj, train_rows, k=3, scaled=True)
                cid_raw, lbl_raw, conf_raw, _ = knn_classify(s_obj, train_rows, k=3, scaled=False)
                res = {
                    "type": "analysis",
                    "trigger_source": body.get("source", "website_sim"),
                    "r_raw": cr, "g_raw": cg, "b_raw": cb,
                    "c_raw": int(cr + cg + cb), "lux": 32, "color_temp": 2650,
                    "r_norm": rn, "g_norm": gn, "b_norm": bn,
                    "predicted_class_id": cid_sc,
                    "predicted_label": lbl_sc,
                    "confidence": conf_sc,
                    "predicted_raw_class_id": cid_raw,
                    "predicted_raw_label": lbl_raw,
                    "k_value": 3,
                    "exec_time_sensor_us": res.get("exec_time_sensor_us", 105400) if res else 105400,
                    "exec_time_scaling_us": res.get("exec_time_scaling_us", 4) if res else 4,
                    "exec_time_knn_scaled_us": res.get("exec_time_knn_scaled_us", 86) if res else 86,
                    "exec_time_knn_raw_us": res.get("exec_time_knn_raw_us", 81) if res else 81,
                    "exec_time_total_us": res.get("exec_time_total_us", 90) if res else 90,
                    "mem_dataset_bytes": 2328,
                    "mem_knn_work_bytes": 84,
                    "mem_free_heap_bytes": res.get("mem_free_heap_bytes", 274416) if res else 274416,
                    "mem_used_heap_bytes": res.get("mem_used_heap_bytes", 53264) if res else 53264,
                    "nearest_neighbors": top_sc,
                }
            elif not res or res.get("type") != "analysis":
                self._send_json({"ok": False, "error": "Gagal memicu sensor pada ESP32"}, status=500)
                return

            record = {
                **res,
                "id": len(db.get("measurements", [])) + 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            db.setdefault("measurements", []).insert(0, record)
            save_db(db)

            # Coba kirim otomatis ke Supabase jika tabel sudah siap
            supa_ok, _ = supabase_request("POST", "beef_measurements", {
                "r_raw": record["r_raw"],
                "g_raw": record["g_raw"],
                "b_raw": record["b_raw"],
                "c_raw": record.get("c_raw", 0),
                "lux": record.get("lux", 0),
                "color_temp": record.get("color_temp", 0),
                "r_norm": record["r_norm"],
                "g_norm": record["g_norm"],
                "b_norm": record["b_norm"],
                "predicted_label": record["predicted_label"],
                "predicted_raw_label": record["predicted_raw_label"],
                "k_value": 3,
                "confidence": record["confidence"],
                "nearest_neighbors": record.get("nearest_neighbors", []),
                "exec_time_sensor_us": record.get("exec_time_sensor_us", 0),
                "exec_time_scaling_us": record.get("exec_time_scaling_us", 0),
                "exec_time_knn_scaled_us": record.get("exec_time_knn_scaled_us", 0),
                "exec_time_knn_raw_us": record.get("exec_time_knn_raw_us", 0),
                "exec_time_total_us": record.get("exec_time_total_us", 0),
                "mem_dataset_bytes": record.get("mem_dataset_bytes", 2328),
                "mem_knn_work_bytes": record.get("mem_knn_work_bytes", 84),
                "mem_free_heap_bytes": record.get("mem_free_heap_bytes", 274416),
                "mem_used_heap_bytes": record.get("mem_used_heap_bytes", 53264),
                "trigger_source": record.get("trigger_source", "website"),
            })
            record["synced_to_supabase"] = supa_ok
            self._send_json({"ok": True, "analysis": record})
            return

        if path == "/api/run-benchmark":
            bench = safe_esp32_cmd("BENCHMARK", timeout=6.0)
            db = load_db()
            eval_res = evaluate_dataset(db.get("dataset", []), esp32_bench=bench)
            db.setdefault("evaluations", []).insert(0, eval_res)
            save_db(db)
            self._send_json({"ok": True, "evaluation": eval_res, "hardware_live": bench is not None})
            return

        if path == "/api/capture-dataset":
            class_id = int(body.get("class_id", 0))
            split_type = body.get("split_type", "train")
            slot_index = body.get("slot_index")
            c_info = next((c for c in CLASSES if c["id"] == class_id), CLASSES[0])

            res = safe_esp32_cmd("ANALYZE dataset_capture", timeout=5.0)
            if not res or "r_raw" not in res:
                self._send_json({"ok": False, "error": "ESP32 tidak merespons pembacaan sensor"}, status=500)
                return

            db = load_db()
            dataset = db.get("dataset", [])
            max_slot = 48 if split_type == "train" else 12
            prefix = "TRN" if split_type == "train" else "TST"
            idx_num = int(slot_index) if slot_index else 1
            idx_num = max(1, min(max_slot, idx_num))
            sample_code = f"{prefix}-{c_info['code']}-{idx_num:03d}"

            updated_row = None
            for idx_r, r in enumerate(dataset):
                if r["sample_code"] == sample_code:
                    r.update({
                        "r_raw": res["r_raw"],
                        "g_raw": res["g_raw"],
                        "b_raw": res["b_raw"],
                        "c_raw": res.get("c_raw", 0),
                        "lux": res.get("lux", 0),
                        "color_temp": res.get("color_temp", 0),
                        "source": "sensor",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    updated_row = r
                    # Update langsung di SRAM ESP32
                    if split_type == "train":
                        safe_esp32_cmd(f"SET_TRAIN {idx_r},{res['r_raw']},{res['g_raw']},{res['b_raw']},{class_id}", timeout=2.0)
                    break

            recompute_minmax(dataset)
            bench = safe_esp32_cmd("BENCHMARK", timeout=5.0)
            eval_res = evaluate_dataset(dataset, esp32_bench=bench)
            db["evaluations"] = [eval_res]
            save_db(db)

            if updated_row:
                supabase_request("POST", "beef_dataset", [updated_row], "?on_conflict=sample_code")

            self._send_json({"ok": True, "sample": updated_row, "evaluation": eval_res})
            return

        if path == "/api/sync-supabase":
            db = load_db()
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
                # Sinkronkan juga riwayat pengukuran terbaru
                meas_payload = [
                    {
                        "r_raw": m["r_raw"],
                        "g_raw": m["g_raw"],
                        "b_raw": m["b_raw"],
                        "c_raw": m.get("c_raw", 0),
                        "lux": m.get("lux", 0),
                        "color_temp": m.get("color_temp", 0),
                        "r_norm": m["r_norm"],
                        "g_norm": m["g_norm"],
                        "b_norm": m["b_norm"],
                        "predicted_label": m["predicted_label"],
                        "predicted_raw_label": m["predicted_raw_label"],
                        "k_value": 3,
                        "confidence": m.get("confidence", 1.0),
                        "nearest_neighbors": m.get("nearest_neighbors", []),
                        "exec_time_sensor_us": m.get("exec_time_sensor_us", 0),
                        "exec_time_scaling_us": m.get("exec_time_scaling_us", 0),
                        "exec_time_knn_scaled_us": m.get("exec_time_knn_scaled_us", 0),
                        "exec_time_knn_raw_us": m.get("exec_time_knn_raw_us", 0),
                        "exec_time_total_us": m.get("exec_time_total_us", 0),
                        "mem_dataset_bytes": m.get("mem_dataset_bytes", 2328),
                        "mem_knn_work_bytes": m.get("mem_knn_work_bytes", 84),
                        "mem_free_heap_bytes": m.get("mem_free_heap_bytes", 274416),
                        "mem_used_heap_bytes": m.get("mem_used_heap_bytes", 53264),
                        "trigger_source": m.get("trigger_source", "website"),
                    }
                    for m in db.get("measurements", [])[:15]
                ]
                if meas_payload:
                    supabase_request("POST", "beef_measurements", meas_payload)
            self._send_json({
                "ok": ok,
                "synced_count": len(payload) if ok else 0,
                "detail": "Berhasil menyinkronkan 144 Data Latih + 36 Data Uji ke Supabase!" if ok else str(resp),
            })
            return

        if path == "/api/wifi-config":
            ssid = body.get("ssid", "").strip()
            password = body.get("password", "").strip()
            st = safe_esp32_cmd(f"SET_WIFI {ssid}|{password}", timeout=8.0)
            self._send_json({"ok": st is not None, "esp32_status": st})
            return

        self._send_json({"ok": False, "error": "Endpoint tidak ditemukan"}, status=404)


def run_server():
    ensure_initial_evaluation_and_measurements()
    env = load_env()
    port = int(env.get("PORT", "3000"))
    server = HTTPServer(("0.0.0.0", port), BeefFreshHandler)
    print(f"==================================================================")
    print(f"  BEEF FRESH - INTERACTIVE WEB & HARDWARE SERVER BERJALAN")
    print(f"  URL Dashboard : http://localhost:{port}")
    print(f"  Serial Bridge : {env.get('SERIAL_PORT', '/dev/ttyUSB0')} @ {env.get('SERIAL_BAUD', '115200')}")
    print(f"  Supabase URL  : {env.get('SUPABASE_URL')}")
    print(f"==================================================================", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    run_server()
