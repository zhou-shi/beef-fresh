import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beef Fresh | Klasifikasi Kesegaran Daging Sapi",
  description:
    "Sistem klasifikasi kesegaran daging sapi segar, mulai membusuk, dan busuk berbasis sensor warna TCS34725, algoritma KNN, dan layar OLED SSD1306 pada ESP32.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#120607" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen font-sans antialiased">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
