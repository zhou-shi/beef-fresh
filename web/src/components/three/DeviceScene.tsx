"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { SpriteLabel } from "./SpriteLabel";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { DeviceVisual } from "@/lib/device-visual";
import { drawOled } from "@/lib/oled";

/*
 * Model 3D alat Beef Fresh (sesuai rancangan):
 *  - Kotak putih (enclosure) dengan tutup depan berengsel 25 mm di bawah & kait (tuas) di atas
 *  - Tabung hitam (light shroud) di tutup depan, sensor TCS34725 (PCB ungu) di dalam lubang
 *  - LED bawaan sensor sebagai penerang (tanpa LED putih eksternal)
 *  - Lubang port USB di sisi kanan, OLED SSD1306 di panel belakang
 *  - ESP32 di dalam kotak, bus I2C: G26 = SDA, G27 = SCL (mode X-Ray)
 */

const W = 2.2;
const H = 2.0;
const D = 2.0;
const T = 0.06;
const WHITE = "#ecebe6";
const PINK = "#d9a2a9";
const HOOD = "#151515";
const LENS_X = -0.08;
const LENS_Y = 0.88; // relatif engsel (bawah tutup)

const PRESETS: Record<string, [number, number, number]> = {
  awal: [-3.6, 2.3, 4.6],
  depan: [0, 0.35, 5.8],
  belakang: [0.3, 0.7, -5.8],
  samping: [5.8, 0.8, 0.8],
  atas: [0.2, 6.2, 1.4],
};

type V3 = [number, number, number];

function BodyMaterial({ xray }: { xray: boolean }) {
  return <meshStandardMaterial color={WHITE} roughness={0.62} metalness={0.02} transparent opacity={xray ? 0.14 : 1} depthWrite={!xray} />;
}

function PinkMaterial() {
  return <meshStandardMaterial color={PINK} roughness={0.5} metalness={0.05} />;
}

function Tag({ position, children, show }: { position: V3; children: ReactNode; show: boolean }) {
  if (!show) return null;
  const text = typeof children === "string" ? children : String(children ?? "");
  return <SpriteLabel position={position} text={text} />;
}

function Body({ v }: { v: DeviceVisual }) {
  return (
    <group>
      {/* panel depan (sensor + tabung hitam) tetap menyatu pada bodi utama */}
      <RoundedBox args={[W, H, T]} radius={0.025} smoothness={2} position={[0, 0, D / 2 + T / 2]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      <group position={[LENS_X, -H / 2 + LENS_Y, D / 2 + T]}>
        <LensHood />
        <SensorBoard led={v.led} scanning={v.scanning} />
        <Beam active={v.scanning} />
      </group>
      <RoundedBox args={[T, H, D]} radius={0.025} smoothness={2} position={[-W / 2 + T / 2, 0, 0]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      <RoundedBox args={[T, H, D]} radius={0.025} smoothness={2} position={[W / 2 - T / 2, 0, 0]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      <RoundedBox args={[W, T, D]} radius={0.025} smoothness={2} position={[0, H / 2 - T / 2, 0]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      <RoundedBox args={[W, T, D]} radius={0.025} smoothness={2} position={[0, -H / 2 + T / 2, 0]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      {/* lubang port USB sisi kanan */}
      <mesh position={[W / 2 + 0.002, 0.24, 0.34]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.26, 0.36]} />
        <meshStandardMaterial color="#2e2e2e" roughness={0.95} />
      </mesh>
      <mesh position={[W / 2 + 0.003, 0.22, 0.31]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.17, 0.28]} />
        <meshStandardMaterial color="#d8d6d0" roughness={0.95} />
      </mesh>
    </group>
  );
}

function LensHood() {
  const geom = useMemo(() => {
    const pts: Array<[number, number]> = [
      [0.17, 0],
      [0.78, 0],
      [0.78, 0.5],
      [0.745, 0.55],
      [0.21, 0.55],
      [0.17, 0.51],
      [0.17, 0],
    ];
    return new THREE.LatheGeometry(
      pts.map(([x, y]) => new THREE.Vector2(x, y)),
      72,
    );
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} rotation={[Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={HOOD} roughness={0.85} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

function SensorBoard({ led, scanning }: { led: boolean; scanning: boolean }) {
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const pulse = scanning ? 0.7 + 0.3 * Math.sin(clock.elapsedTime * 11) : 1;
    if (ledMat.current) ledMat.current.emissiveIntensity = led ? 4.5 * pulse : 0.05;
    if (light.current) light.current.intensity = led ? (scanning ? 2.6 : 1.1) * pulse : 0;
  });
  return (
    <group position={[0, 0, 0.018]}>
      <mesh>
        <boxGeometry args={[0.3, 0.3, 0.03]} />
        <meshStandardMaterial color="#5b2a8c" roughness={0.45} />
      </mesh>
      <mesh position={[0.05, 0.03, 0.02]}>
        <boxGeometry args={[0.07, 0.07, 0.02]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.4} />
      </mesh>
      <mesh position={[-0.06, -0.03, 0.025]}>
        <boxGeometry args={[0.06, 0.05, 0.03]} />
        <meshStandardMaterial ref={ledMat} color="#fffaf0" emissive="#fff1d0" emissiveIntensity={0} />
      </mesh>
      <pointLight ref={light} position={[0, 0, 0.3]} distance={1.6} decay={1.5} color="#fff1d8" intensity={0} />
    </group>
  );
}

function Beam({ active }: { active: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (!mat.current) return;
    const target = active ? 0.2 + 0.08 * Math.sin(clock.elapsedTime * 9) : 0;
    mat.current.opacity = THREE.MathUtils.damp(mat.current.opacity, target, 8, dt);
  });
  return (
    <mesh position={[0, 0, 0.55 + 0.42]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.5, 0.17, 0.84, 48, 1, true]} />
      <meshBasicMaterial ref={mat} color="#fff1d6" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Tutup berengsel pada sisi OLED (bagian atas/belakang pada alat asli) agar saat dibuka kabel & ESP32 terlihat jelas */
function Lid({ v }: { v: DeviceVisual }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, v.lidOpen ? -1.25 : 0, 4, dt);
  });
  return (
    <group ref={ref} position={[0, -H / 2, -D / 2]}>
      <RoundedBox args={[W, H, T]} radius={0.025} smoothness={2} position={[0, H / 2, T / 2]}>
        <BodyMaterial xray={v.xray} />
      </RoundedBox>
      {/* OLED SSD1306 terpasang pada tutup yang dapat dibuka */}
      <group position={[0, H / 2, 0]}>
        <Oled3D lines={v.oled} />
      </group>
      {/* daun engsel pada tutup OLED */}
      <mesh position={[0.35, 0.1, -0.006]}>
        <boxGeometry args={[0.95, 0.16, 0.012]} />
        <PinkMaterial />
      </mesh>
    </group>
  );
}

/** Pengunci / kait kotak berada di sisi atas tutup OLED (z = -D / 2) */
function Latch({ open }: { open: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, open ? -1.9 : 0, 6, dt);
  });
  return (
    <group position={[-0.05, H / 2, -D / 2 + 0.2]} rotation={[0, Math.PI, 0]}>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.36, 0.06, 0.2]} />
        <PinkMaterial />
      </mesh>
      <group ref={ref} position={[0, 0.06, 0.08]}>
        <mesh position={[0, 0, 0.115]}>
          <boxGeometry args={[0.36, 0.05, 0.23]} />
          <PinkMaterial />
        </mesh>
        <mesh position={[0, -0.12, 0.205]}>
          <boxGeometry args={[0.36, 0.29, 0.05]} />
          <PinkMaterial />
        </mesh>
        <mesh position={[0.22, 0.045, 0.06]}>
          <boxGeometry args={[0.14, 0.05, 0.2]} />
          <PinkMaterial />
        </mesh>
      </group>
    </group>
  );
}

function Hinge() {
  return (
    <group position={[0.35, -H / 2 + 0.01, -D / 2 - 0.035]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, 0.95, 16]} />
        <PinkMaterial />
      </mesh>
      <mesh position={[0, -0.016, 0.11]}>
        <boxGeometry args={[0.95, 0.012, 0.2]} />
        <PinkMaterial />
      </mesh>
    </group>
  );
}

function Oled3D({ lines }: { lines: string[] }) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, texture: t };
  }, []);
  useEffect(() => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawOled(ctx, lines, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }, [lines, canvas, texture]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={[0.1, 0.25, -0.022]} rotation={[0, Math.PI, 0]}>
      <mesh>
        <boxGeometry args={[0.82, 0.64, 0.04]} />
        <meshStandardMaterial color="#173e94" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.02, 0.021]}>
        <planeGeometry args={[0.7, 0.36]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {[-0.15, -0.05, 0.05, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.26, 0.03]}>
          <boxGeometry args={[0.04, 0.04, 0.04]} />
          <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

const ESP_POS: V3 = [0.3, 0.12, 0.25];

function Esp32Board() {
  return (
    <group position={ESP_POS}>
      <mesh>
        <boxGeometry args={[1.1, 0.035, 0.5]} />
        <meshStandardMaterial color="#14161c" roughness={0.6} />
      </mesh>
      <mesh position={[-0.12, 0.04, 0]}>
        <boxGeometry args={[0.42, 0.045, 0.34]} />
        <meshStandardMaterial color="#c3c7cf" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0.6, 0.03, 0]}>
        <boxGeometry args={[0.12, 0.05, 0.17]} />
        <meshStandardMaterial color="#9aa0a8" metalness={0.8} roughness={0.3} />
      </mesh>
      {[0.22, -0.22].map((z) => (
        <mesh key={z} position={[0, 0.03, z]}>
          <boxGeometry args={[0.98, 0.03, 0.04]} />
          <meshStandardMaterial color="#d4a017" metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
      {/* standoff */}
      {[
        [-0.48, -0.2],
        [0.48, -0.2],
        [-0.48, 0.2],
        [0.48, 0.2],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, -0.5, z]}>
          <cylinderGeometry args={[0.025, 0.025, 1.0, 8]} />
          <meshStandardMaterial color="#9b9b9b" />
        </mesh>
      ))}
    </group>
  );
}

const WIRE_COLORS = ["#ef4444", "#9ca3af", "#3b82f6", "#facc15"]; // 3V3, GND, SDA(G26), SCL(G27)

function Wires({ lidOpen }: { lidOpen: boolean }) {
  const curves = useMemo(() => {
    const out: Array<{ pts: THREE.Vector3[]; color: string }> = [];
    // Hitung posisi pin OLED sesuai sudut bukaan tutup engsel (0 saat tertutup, -1.25 rad saat terbuka)
    const theta = lidOpen ? -1.25 : 0;
    const dy = H / 2 + 0.51;
    const dz = T + 0.01;
    const oledY = -H / 2 + dy * Math.cos(theta) - dz * Math.sin(theta);
    const oledZ = -D / 2 + dy * Math.sin(theta) + dz * Math.cos(theta);

    WIRE_COLORS.forEach((color, i) => {
      const start = new THREE.Vector3(ESP_POS[0] - 0.4 + i * 0.1, ESP_POS[1] + 0.05, ESP_POS[2] + 0.22);
      const sensor = new THREE.Vector3(LENS_X - 0.12 + i * 0.08, -H / 2 + LENS_Y - 0.2, D / 2 - 0.01);
      const oled = new THREE.Vector3(0.1 - 0.15 + i * 0.1, oledY, oledZ);
      const toSensor = new THREE.CatmullRomCurve3([
        start,
        start.clone().add(new THREE.Vector3(0, 0.22 + i * 0.03, 0.05)),
        new THREE.Vector3(sensor.x, sensor.y - 0.15, sensor.z - 0.35),
        sensor,
      ]);
      const midOled = lidOpen
        ? new THREE.Vector3(
            (start.x + oled.x) * 0.5,
            Math.min(start.y, oled.y) + 0.25 + i * 0.03,
            -D / 2 + 0.18,
          )
        : new THREE.Vector3(oled.x, oled.y + 0.15, oled.z + 0.45);
      const toOled = new THREE.CatmullRomCurve3([
        start,
        start.clone().add(new THREE.Vector3(0, 0.28 + i * 0.04, -0.15)),
        midOled,
        oled,
      ]);
      out.push({ pts: toSensor.getPoints(28), color }, { pts: toOled.getPoints(32), color });
    });
    return out;
  }, [lidOpen]);
  return (
    <group>
      {curves.map((c, i) => (
        <Line key={i} points={c.pts} color={c.color} lineWidth={2.4} />
      ))}
    </group>
  );
}

const MARBLE: Array<[number, number, number, number]> = [
  [-0.3, 0.25, 0.3, 0.5],
  [0.25, 0.05, -0.4, 0.42],
  [-0.1, -0.22, 0.15, 0.6],
  [0.35, -0.3, 0.6, 0.25],
  [-0.45, -0.05, -0.8, 0.22],
];

function Meat({ color }: { color: string | null }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const target = useMemo(() => new THREE.Color("#a3242b"), []);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const show = !!color;
    g.position.x = THREE.MathUtils.damp(g.position.x, show ? LENS_X : -4.5, 5, dt);
    g.scale.setScalar(Math.max(0.001, THREE.MathUtils.damp(g.scale.x, show ? 1 : 0.001, 6, dt)));
    if (color) target.set(color);
    if (mat.current) mat.current.color.lerp(target, Math.min(1, dt * 4));
  });
  return (
    <group ref={ref} position={[-4.5, -H / 2 + LENS_Y, D / 2 + T + 0.55 + 0.42]} scale={0.001}>
      <RoundedBox args={[1.35, 1.02, 0.22]} radius={0.09} smoothness={4}>
        <meshStandardMaterial ref={mat} color="#a3242b" roughness={0.55} />
      </RoundedBox>
      {MARBLE.map(([x, y, rot, len], i) => (
        <mesh key={i} position={[x, y, -0.112]} rotation={[0, Math.PI, rot]}>
          <planeGeometry args={[len, 0.03]} />
          <meshStandardMaterial color="#f3e2cf" roughness={0.7} transparent opacity={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.25, 0.06, 0.2]} />
        <meshStandardMaterial color="#f1dfc8" roughness={0.6} />
      </mesh>
    </group>
  );
}

function DeviceModel({ v }: { v: DeviceVisual }) {
  return (
    <group>
      <Body v={v} />
      <Lid v={v} />
      <Latch open={v.lidOpen} />
      <Hinge />
      <Esp32Board />
      {(v.xray || v.lidOpen) && <Wires lidOpen={v.lidOpen} />}
      <Meat color={v.meatColor} />
      <Tag show={v.labels} position={[-0.25, H / 2 + 0.3, -D / 2]}>
        Kait tutup OLED (atas)
      </Tag>
      <Tag show={v.labels} position={[0.85, -H / 2 - 0.08, -D / 2 - 0.1]}>
        Engsel tutup OLED
      </Tag>
      <Tag show={v.labels} position={[LENS_X + 0.8, -H / 2 + LENS_Y + 0.55, D / 2 + T + 0.55]}>
        Sensor TCS34725 + LED bawaan
      </Tag>
      <Tag show={v.labels} position={[W / 2 + 0.06, 0.48, 0.34]}>
        Port USB
      </Tag>
      <Tag show={v.labels && !v.lidOpen} position={[0.1, 0.66, -D / 2 - 0.05]}>
        OLED SSD1306
      </Tag>
      {(v.xray || v.lidOpen) && (
        <Tag show position={[ESP_POS[0] + 0.3, ESP_POS[1] - 0.15, ESP_POS[2]]}>
          ESP32 (G26 SDA, G27 SCL)
        </Tag>
      )}
    </group>
  );
}

function CameraRig({ view }: { view: { name: string; n: number } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { update: () => void } | null;
  const goal = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const p = PRESETS[view.name];
    if (p && view.n > 0) goal.current = new THREE.Vector3(p[0], p[1], p[2]);
  }, [view]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    camera.position.lerp(g, 1 - Math.exp(-5 * dt));
    controls?.update();
    if (camera.position.distanceTo(g) < 0.03) goal.current = null;
  });
  return null;
}

export default function DeviceScene({ visual, view }: { visual: DeviceVisual; view: { name: string; n: number } }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: PRESETS.awal, fov: 36, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#fff4ec", "#2a080c", 0.7]} />
      <directionalLight position={[-4, 6, 5]} intensity={2.1} />
      <directionalLight position={[5, 1.5, -4]} intensity={0.9} color="#ff8a8a" />
      <directionalLight position={[3, -2, 4]} intensity={0.35} color="#ffd9c7" />
      <group position={[0, 0.15, 0]}>
        <DeviceModel v={visual} />
      </group>
      <ContactShadows position={[0, -1.75, 0]} opacity={0.55} scale={10} blur={2.8} far={3.5} />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3.2}
        maxDistance={12}
        autoRotate={visual.autoRotate}
        autoRotateSpeed={0.9}
        target={[0, 0.1, 0.3]}
      />
      <CameraRig view={view} />
    </Canvas>
  );
}
