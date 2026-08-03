import { CircleHelp } from "lucide-react";

export function MetricHelp({ label, description }: { label: string; description: string }) {
  return <span className="metric-label">{label}<span className="metric-help" tabIndex={0} aria-label={`${label}: ${description}`}><CircleHelp size={13} /><span role="tooltip"><strong>{label}</strong>{description}</span></span></span>;
}
