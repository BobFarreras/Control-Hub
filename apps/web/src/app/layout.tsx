import "@fontsource-variable/hanken-grotesk";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import type { Metadata } from "next";
import { FeatureProvider } from "@/components/feature-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { enabledFeatures } from "@/lib/features";

export const metadata: Metadata = { title: "Control Hub", description: "Business operations control center" };

/**
 * The flags are resolved here, on the server, and handed to the whole tree. Doing it once at
 * the root is what keeps the menu identical on every page, including the ones that are client
 * components and could not read the environment themselves.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning>
      <body>
        <FeatureProvider features={enabledFeatures()}>
          <ThemeProvider>{children}</ThemeProvider>
        </FeatureProvider>
      </body>
    </html>
  );
}
