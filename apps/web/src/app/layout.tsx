import "@fontsource-variable/hanken-grotesk";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import type { Metadata } from "next";
import { AttendanceProvider } from "@/components/attendance-provider";
import { FeatureProvider } from "@/components/feature-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { UpdateProvider } from "@/components/update-provider";
import { currentAttendanceStatus } from "@/lib/attendance-status";
import { enabledFeatures } from "@/lib/features";
import { pendingUpdate } from "@/lib/pending-update";

export const metadata: Metadata = { title: "Control Hub", description: "Business operations control center" };

/**
 * The flags are resolved here, on the server, and handed to the whole tree. Doing it once at
 * the root is what keeps the menu identical on every page, including the ones that are client
 * components and could not read the environment themselves.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Resolved here for the same reason as the flags: the clock control sits in the topbar of every
  // screen, and asking for its state from the browser would leave a gap in the first paint of
  // every navigation. Null when there is nothing to show, including on the sign-in page.
  // Both on the server, and both together: two sequential round trips to the API would add the
  // slower of them to the first paint of every navigation for no reason -- neither depends on the
  // other. The update is null for everybody who is not Owner or Administrator, which the API
  // decides; the browser never asks GitHub anything, which is the point of resolving it here.
  const [attendance, update] = await Promise.all([currentAttendanceStatus(), pendingUpdate()]);
  return (
    <html suppressHydrationWarning>
      <body>
        <FeatureProvider features={enabledFeatures()}>
          <AttendanceProvider status={attendance}>
            <UpdateProvider state={update}>
              <ThemeProvider>
                <ToastProvider>{children}</ToastProvider>
              </ThemeProvider>
            </UpdateProvider>
          </AttendanceProvider>
        </FeatureProvider>
      </body>
    </html>
  );
}
