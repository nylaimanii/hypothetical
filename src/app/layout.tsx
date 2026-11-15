import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "hypothetical · prolong humanity",
  description: "one ai governs every nation with one mandate: keep humanity alive, longer lives, a population that endures, a civilization on more than one world. every world it loses teaches the next one.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
