import type { Metadata } from "next";
import DeviceView from "@/components/DeviceView";

export const metadata: Metadata = { title: "Perangkat ESP32 | Beef Fresh" };

export default function PerangkatPage() {
  return <DeviceView />;
}
