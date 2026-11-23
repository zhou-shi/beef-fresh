"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

type V3 = [number, number, number];

/**
 * Label 3D berbasis THREE.Sprite + CanvasTexture.
 * Menggantikan @react-three/drei <Html> agar bebas error unmount React 19.
 */
export function SpriteLabel({
  position,
  text,
  accent = "#e5383b",
  scale = 0.72,
}: {
  position: V3;
  text: string;
  accent?: string;
  scale?: number;
}) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fontSize = 26;
    const padX = 22;
    const padY = 14;
    const accentW = 8;

    let textW = 160;
    if (ctx) {
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      textW = Math.ceil(ctx.measureText(text).width);
    }

    const w = textW + padX * 2 + accentW;
    const h = fontSize + padY * 2;
    canvas.width = w;
    canvas.height = h;

    if (ctx) {
      const r = 12;
      ctx.fillStyle = "rgba(24, 20, 26, 0.9)";
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(0, 0, accentW, h, [r, 0, 0, r]);
      ctx.fill();

      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(text, accentW + padX - 4, h / 2 + 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    return { texture: tex, aspect: w / h };
  }, [text, accent]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  const h = 0.14 * scale;
  const w = h * aspect;

  return (
    <sprite position={position} scale={[w, h, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}
