import "@fontsource-variable/hanken-grotesk";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = { title: "Control Hub", description: "Business operations control center" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
