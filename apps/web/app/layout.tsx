import type { Metadata, Viewport } from "next";
import { Inter, Geist, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Toaster, TooltipProvider } from "@all/ui";
import { isSupabase } from "@/lib/env";
import "./globals.css";

// DM Sans из design.md не содержит кириллицы — используем рекомендованную замену Inter (её же допускает раздел 03)
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", weight: ["400", "500", "600"] });
const geist = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-geist", weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-jetbrains", weight: ["400"] });

export const metadata: Metadata = {
  title: { default: "ALL-менеджер", template: "%s · ALL-менеджер" },
  description: "AI-администратор, который отвечает на звонки как живой человек",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0a0a" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang={locale} data-rt={isSupabase ? "off" : "sse"} data-theme={theme === "light" || theme === "dark" ? theme : "dark"} className={`${inter.variable} ${geist.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
