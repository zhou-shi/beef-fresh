"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SpriteLabel } from "./SpriteLabel";

export interface ScatterPoint {
  id: number;
  v: [number, number, number];
  color: string;
  test: boolean;
  wrong: boolean;
  title: string;
}

type V3 = [number, number, number];

export default function Scatter3D({ points, axes }: { points: ScatterPoint[]; axes: [string, string, string] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { pts, min, max } = useMemo(() => {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let j = 0; j < 3; j++) {
        min[j] = Math.min(min[j], p.v[j]);
        max[j] = Math.max(max[j], p.v[j]);
      }
    }
    const pts = points.map((p) => ({
      ...p,
      pos: p.v.map((x, j) => {
        const r = max[j] - min[j] || 1;
        return ((x - min[j]) / r) * 2 - 1;
      }) as V3,
    }));
    return { pts, min, max };
  }, [points]);
  const box = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), []);
  const hovered = hover != null ? pts.find((p) => p.id === hover) : undefined;
  const fmt = (n: number) => (Number.isFinite(n) ? (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(2)) : "-");
  const axisColors = ["#ef4444", "#22c55e", "#3b82f6"];
  const ends: V3[] = [
    [1.3, -1, -1],
    [-1, 1.3, -1],
    [-1, -1, 1.3],
  ];

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [2.8, 2.1, 3.0], fov: 42 }} dpr={[1, 2]} style={{ position: "absolute", inset: 0 }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <lineSegments geometry={box}>
          <lineBasicMaterial color="#4a1c22" />
        </lineSegments>
        {ends.map((end, j) => (
          <group key={j}>
            <Line points={[[-1, -1, -1], end]} color={axisColors[j]} lineWidth={2} />
            <SpriteLabel
              position={end}
              text={`${axes[j]} [${fmt(min[j])} - ${fmt(max[j])}]`}
              accent={axisColors[j]}
              scale={1.35}
            />
          </group>
        ))}
        {pts.map((p) => (
          <mesh
            key={p.id}
            position={p.pos}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(p.id);
            }}
            onPointerOut={() => setHover((h) => (h === p.id ? null : h))}
            scale={hover === p.id ? 1.8 : 1}
          >
            {p.test ? <octahedronGeometry args={[0.06]} /> : <sphereGeometry args={[0.036, 14, 14]} />}
            <meshStandardMaterial
              color={p.color}
              roughness={0.35}
              emissive={p.wrong ? "#ffffff" : p.color}
              emissiveIntensity={p.wrong ? 0.55 : 0.12}
            />
          </mesh>
        ))}
        {pts
          .filter((p) => p.wrong)
          .map((p) => (
            <mesh key={`w${p.id}`} position={p.pos}>
              <sphereGeometry args={[0.1, 12, 12]} />
              <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.45} />
            </mesh>
          ))}
        <OrbitControls autoRotate={hover == null} autoRotateSpeed={0.6} enablePan={false} minDistance={2.2} maxDistance={8} />
      </Canvas>
      {hovered && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-white/10 bg-[#1c0b0e]/95 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg">
          {hovered.title}
        </div>
      )}
    </div>
  );
}
