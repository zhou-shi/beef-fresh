/**
 * Renderer 1:1 layar OLED SSD1306 128x64 monokrom biru penuh.
 * Selaras piksel-demi-piksel dengan fungsi updateOLED() dan updateOLEDDataset()
 * di firmware/beef_fresh_esp32/beef_fresh_esp32.ino.
 *
 * Sintaks baris khusus:
 *   - Baris 0             : Header di atas garis pemisah (y=10)
 *   - "=TEKS"             : Kotak sorot biru penuh dengan teks gelap terbalik
 *   - "=KIRI|KANAN"       : Kotak sorot biru penuh dengan teks kiri & kanan (counter kuota)
 *   - "#cur/max"          : Progress bar bingkai biru penuh di bagian bawah layar
 *   - "!TEKS"             : Teks besar (fallback kompatibilitas)
 */
const OLED_BG = "#020916";
const OLED_BLUE = "#63d2ff";
const OLED_BLUE_SOFT = "rgba(99, 210, 255, 0.88)";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: boolean,
  stroke: boolean,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

export function drawOled(ctx: CanvasRenderingContext2D, lines: string[], w: number, h: number) {
  const s = w / 128;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Latar gelap khas kaca OLED
  ctx.fillStyle = OLED_BG;
  ctx.fillRect(0, 0, w, h);

  // Sedikit pendaran biru halus khas modul SSD1306 monokrom biru
  ctx.shadowColor = "rgba(99, 210, 255, 0.35)";
  ctx.shadowBlur = 2.5 * s;
  ctx.textBaseline = "top";

  const hasProgress = lines.some((l) => l.startsWith("#"));
  const header = lines[0] ?? "BEEF FRESH | SIAP";

  // Baris 0: Header + garis pemisah y=10
  ctx.fillStyle = OLED_BLUE;
  ctx.font = `700 ${7.5 * s}px "Courier New", ui-monospace, monospace`;
  ctx.fillText(header, 1 * s, 1 * s, w - 2 * s);
  ctx.fillRect(0, 10 * s, w, Math.max(1, 0.8 * s));

  // Render baris isi (index 1..n)
  let y = 13 * s;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw) {
      y += 9 * s;
      continue;
    }

    // Progress bar (#cur/max) di bagian bawah (y=54..63)
    if (raw.startsWith("#")) {
      const [curStr, maxStr] = raw.slice(1).split("/");
      const cur = Math.max(0, Number(curStr) || 0);
      const max = Math.max(1, Number(maxStr) || 1);
      const ratio = Math.min(1, cur / max);
      const barY = 54 * s;
      const barH = 8.5 * s;
      ctx.strokeStyle = OLED_BLUE;
      ctx.lineWidth = Math.max(1, 1 * s);
      drawRoundedRect(ctx, 1 * s, barY, w - 2 * s, barH, 2 * s, false, true);
      if (cur > 0) {
        const innerMax = w - 6 * s;
        const fillW = Math.max(2 * s, Math.round(innerMax * ratio));
        ctx.fillStyle = OLED_BLUE;
        ctx.fillRect(3 * s, barY + 2 * s, fillW, barH - 4 * s);
      }
      continue;
    }

    // Kotak sorot biru penuh dengan teks gelap terbalik (=TEKS atau =KIRI|KANAN)
    if (raw.startsWith("=")) {
      const content = raw.slice(1);
      const boxH = hasProgress ? 16 * s : 17 * s;
      ctx.fillStyle = OLED_BLUE;
      drawRoundedRect(ctx, 0.5 * s, y, w - 1 * s, boxH, 3 * s, true, false);

      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = OLED_BG;
      ctx.font = `700 ${8 * s}px "Courier New", ui-monospace, monospace`;
      if (content.includes("|")) {
        const [left, right] = content.split("|");
        ctx.textAlign = "left";
        ctx.fillText(left, 4 * s, y + 4 * s, w * 0.68);
        ctx.textAlign = "right";
        ctx.fillText(right, w - 4 * s, y + 4 * s, w * 0.34);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(content, 4 * s, y + 4.5 * s, w - 8 * s);
      }
      ctx.restore();
      y += boxH + 4 * s;
      continue;
    }

    // Teks besar opsional (!TEKS)
    if (raw.startsWith("!")) {
      const text = raw.slice(1);
      ctx.fillStyle = OLED_BLUE;
      ctx.font = `700 ${13 * s}px "Courier New", ui-monospace, monospace`;
      ctx.fillText(text, 2 * s, y, w - 4 * s);
      y += 15 * s;
      continue;
    }

    // Teks reguler
    ctx.fillStyle = OLED_BLUE_SOFT;
    ctx.font = `600 ${7.5 * s}px "Courier New", ui-monospace, monospace`;
    ctx.fillText(raw, 1 * s, y, w - 2 * s);
    y += 10 * s;
  }

  // Efek scanline halus khas matriks piksel OLED
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
  for (let yy = 0; yy < h; yy += Math.max(2, Math.round(s * 2))) {
    ctx.fillRect(0, yy, w, Math.max(1, Math.round(s * 0.45)));
  }
  ctx.restore();
}
