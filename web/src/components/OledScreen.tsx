"use client";

import { useEffect, useRef } from "react";
import { drawOled } from "@/lib/oled";
import { cn } from "@/components/ui";

/** Replika layar OLED SSD1306 0.96" (128x64) */
export default function OledScreen({ lines, className }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) drawOled(ctx, lines, c.width, c.height);
  }, [lines]);

  return (
    <div className={cn("rounded-lg bg-[#123a8c] p-1.5 pt-1 shadow-2xl ring-1 ring-black/50", className)}>
      <div className="mb-1 flex justify-center gap-2 font-mono text-[8px] text-white/70">
        <span>GND</span>
        <span>VCC</span>
        <span>SCL</span>
        <span>SDA</span>
      </div>
      <canvas
        ref={ref}
        width={256}
        height={128}
        className="block h-[64px] w-[128px] rounded-[2px] sm:h-[80px] sm:w-[160px]"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="mt-1 text-center text-[8px] uppercase tracking-widest text-white/55">OLED SSD1306 (0x3C)</div>
    </div>
  );
}
