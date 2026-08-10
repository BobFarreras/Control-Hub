import type { AttendanceStatus } from "@/components/attendance-provider";
import { apiFetch, readJson } from "@/lib/api";
import { featureEnabled } from "@/lib/features";

/**
 * The clock state for the person whose session this is, read on the server.
 *
 * Answers null for every reason the control should simply not appear: the flag is off, nobody is
 * signed in yet, or the API is not answering. None of those is worth an error on screen -- the
 * layout renders on the sign-in page too, where there is no session by definition.
 */
export async function currentAttendanceStatus(): Promise<AttendanceStatus | null> {
  if (!featureEnabled("attendance")) return null;
  try {
    const response = await apiFetch("/api/v1/attendance/me");
    if (!response.ok) return null;
    return await readJson<AttendanceStatus>(response);
  } catch {
    return null;
  }
}
