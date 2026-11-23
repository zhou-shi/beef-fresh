#!/usr/bin/env python3
"""
Persistent USB Serial worker for Beef Fresh ESP32.
- Auto-discovers /dev/ttyUSB* and /dev/ttyACM* when ESP32 is unplugged/replugged.
- Keeps the active port open ONCE with HUPCL disabled and DTR/RTS low so the ESP32
  NEVER auto-resets between website polls/commands and the physical OLED stays synced.
"""
import glob
import json
import os
import sys
import time

try:
    import termios
except ImportError:
    termios = None

try:
    import serial
    from serial.tools import list_ports as pyserial_list_ports
except Exception:
    serial = None
    pyserial_list_ports = None

BAUD = int(os.environ.get("SERIAL_BAUD", "115200"))
IS_WINDOWS = os.name == "nt"


def list_ports():
    if IS_WINDOWS:
        if pyserial_list_ports is None:
            return []
        raw = list(pyserial_list_ports.comports())
        # Prioritaskan chip USB-UART umum ESP32 (CP210x, CH340, FTDI, USB Serial)
        def priority(p):
            desc = f"{p.description or ''} {p.manufacturer or ''}".lower()
            if any(k in desc for k in ("cp210", "ch340", "ch910", "ftdi", "silicon labs", "usb", "uart", "serial")):
                return (0, p.device)
            return (1, p.device)

        raw.sort(key=priority)
        return [p.device for p in raw if p.device]

    ports = sorted(
        set(
            glob.glob("/dev/ttyUSB*")
            + glob.glob("/dev/ttyACM*")
            + glob.glob("/dev/cu.usb*")
            + glob.glob("/dev/cu.SLAB*")
            + glob.glob("/dev/cu.wchusb*")
        )
    )
    if not ports and pyserial_list_ports is not None:
        ports = sorted(
            p.device
            for p in pyserial_list_ports.comports()
            if p.device and ("usb" in p.device.lower() or "acm" in p.device.lower() or "slab" in p.device.lower())
        )
    return ports


def disable_hupcl(fd):
    if termios is None:
        return
    try:
        attrs = termios.tcgetattr(fd)
        attrs[2] = attrs[2] & ~termios.HUPCL
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
    except Exception:
        pass


def open_port(port_path):
    if serial is None or not port_path:
        return None
    if not IS_WINDOWS and not os.path.exists(port_path):
        return None
    s = serial.Serial()
    s.port = port_path
    s.baudrate = BAUD
    s.timeout = 0.25
    s.dtr = False
    s.rts = False
    s.open()
    if not IS_WINDOWS:
        disable_hupcl(s.fileno())
    time.sleep(0.15)
    s.reset_input_buffer()
    return s


def close_quietly(ser):
    if ser is not None:
        try:
            ser.close()
        except Exception:
            pass


def query_on_port(ser, cmd, timeout):
    ser.reset_input_buffer()
    ser.write((cmd + "\n").encode("utf-8"))
    ser.flush()
    t0 = time.time()
    while time.time() - t0 < timeout:
        line = ser.readline().decode("utf-8", errors="replace").strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except Exception:
                pass
    return None


def main():
    ser = None
    active_port = None

    def ensure_connected(preferred_port=None):
        nonlocal ser, active_port
        ports = list_ports()

        # Jika port yang sedang terbuka masih ada & bukan permintaan pindah port
        if ser is not None and ser.is_open and active_port in ports and (not preferred_port or preferred_port == active_port):
            return ser, active_port, ports

        close_quietly(ser)
        ser = None
        active_port = None

        candidates = []
        if preferred_port and preferred_port in ports:
            candidates.append(preferred_port)
        for p in ports:
            if p not in candidates:
                candidates.append(p)

        for cand in candidates:
            try:
                s = open_port(cand)
                if s is not None:
                    ser = s
                    active_port = cand
                    return ser, active_port, ports
            except Exception:
                pass

        return None, None, ports

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        req_id = None
        try:
            req = json.loads(raw_line)
            req_id = req.get("id")
            cmd = str(req.get("cmd", "")).strip()
            timeout = float(req.get("timeout", 4.0))
            preferred_port = req.get("port")

            if cmd == "__LIST_PORTS__":
                ports = list_ports()
                if active_port not in ports:
                    close_quietly(ser)
                    ser = None
                    active_port = None
                sys.stdout.write(json.dumps({"id": req_id, "data": {"ports": ports, "activePort": active_port}, "port": active_port}) + "\n")
                sys.stdout.flush()
                continue

            if cmd == "__RECONNECT__":
                close_quietly(ser)
                ser = None
                active_port = None
                ports = list_ports()
                candidates = ([preferred_port] if preferred_port in ports else []) + [p for p in ports if p != preferred_port]
                found_data = None
                for cand in candidates:
                    try:
                        s = open_port(cand)
                        if s is None:
                            continue
                        res = query_on_port(s, "STATUS", 2.5)
                        if res is not None:
                            ser = s
                            active_port = cand
                            found_data = res
                            break
                        close_quietly(s)
                    except Exception:
                        pass
                sys.stdout.write(
                    json.dumps({"id": req_id, "data": found_data, "port": active_port, "ports": ports}) + "\n"
                )
                sys.stdout.flush()
                continue

            s, port, ports = ensure_connected(preferred_port)
            if s is None:
                sys.stdout.write(json.dumps({"id": req_id, "data": None, "port": None, "ports": ports}) + "\n")
                sys.stdout.flush()
                continue

            result = query_on_port(s, cmd, timeout)
            if result is None and port not in list_ports():
                # Port tercabut saat transaksi -> bersihkan dan coba port baru sekali
                close_quietly(ser)
                ser = None
                active_port = None
                s2, port2, ports2 = ensure_connected()
                if s2 is not None:
                    result = query_on_port(s2, cmd, timeout)
                    port = port2
                    ports = ports2

            sys.stdout.write(json.dumps({"id": req_id, "data": result, "port": port, "ports": ports}) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            close_quietly(ser)
            ser = None
            active_port = None
            sys.stdout.write(json.dumps({"id": req_id, "data": None, "port": None, "ports": list_ports(), "error": str(exc)}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
