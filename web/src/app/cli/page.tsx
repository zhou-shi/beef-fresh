import type { Metadata } from "next";
import CliApp from "@/components/cli/CliApp";

export const metadata: Metadata = { title: "CLI 3D Interaktif | Beef Fresh" };

export default function CliPage() {
  return <CliApp />;
}
