import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BTAI Talent Protocol",
  description: "Agentic AI Talent Protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  console.log("BTAI: Layout Active V1.2");
  return (
    <html lang="en" suppressHydrationWarning={true}>
      {/* BTAI Diagnostic: V1.2 Hydration Fix */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans bg-black text-white`}
        suppressHydrationWarning={true}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
