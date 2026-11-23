import type { Metadata } from "next";
import DatasetManager from "@/components/DatasetManager";

export const metadata: Metadata = { title: "Dataset | Beef Fresh" };

export default function DatasetPage() {
  return <DatasetManager />;
}
