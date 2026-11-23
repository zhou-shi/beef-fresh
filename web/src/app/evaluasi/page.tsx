import type { Metadata } from "next";
import EvaluationView from "@/components/EvaluationView";

export const metadata: Metadata = { title: "Evaluasi KNN & Feature Scaling | Beef Fresh" };

export default function EvaluasiPage() {
  return <EvaluationView />;
}
