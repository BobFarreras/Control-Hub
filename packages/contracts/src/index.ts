export type DependencyHealth = { status: "up" | "down"; latencyMs: number };
export type LiveHealth = { status: "ok"; service: string; version: string };
export type ReadyHealth = {
  status: "ready" | "not_ready";
  service: string;
  dependencies: Record<string, DependencyHealth>;
};
