import { Plug } from "lucide-react";
import type { ReactElement } from "react";

/**
 * The picture beside a connector's name in the catalogue.
 *
 * These are our own glyphs in each provider's colour, not the providers' logos: a mark drawn from
 * memory is a trademark reproduced badly, and one fetched at render time is a request to somebody
 * else's server from a screen that has to work on an isolated network. What they buy is
 * recognition at a glance in a list, which is the whole job here.
 *
 * A connector with no mark still gets one, because a catalogue with a gap in it reads as broken
 * rather than as unremarkable.
 */

type Mark = { tint: string; art: ReactElement };

const marks: Record<string, Mark> = {
  /** Connected nodes, which is what an automation looks like when you draw one. */
  n8n: {
    tint: "#ea4b71",
    art: (
      <>
        <path d="M6 12h3.5M14.5 8.5H18M14.5 15.5H18" />
        <circle cx="4" cy="12" r="2" />
        <circle cx="12" cy="12" r="2.2" />
        <circle cx="20" cy="8.5" r="2" />
        <circle cx="20" cy="15.5" r="2" />
        <path d="M11 10.4 13 9.6M11 13.6l2 .8" />
      </>
    )
  },
  /** The torch: a flame over the ring the metrics arrive on, in Prometheus' own orange. */
  prometheus: {
    tint: "#e6522c",
    art: (
      <>
        <circle cx="12" cy="14.5" r="6.5" />
        <path d="M5.5 11.5h13" />
        <path d="M12 3.2c2.6 2.2 3 4.1 1.7 5.7-1 1.2-2.6 1-2.9-.4-.2-.9.3-1.6 1-2.3" />
      </>
    )
  },
  /** An arrow arriving at a door: this connector receives, it does not go and fetch. */
  "generic-webhook": {
    tint: "#6366f1",
    art: (
      <>
        <path d="M3 12h9" />
        <path d="m9 9 3 3-3 3" />
        <path d="M15 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
      </>
    )
  }
};

export function ConnectorMark({ type, size = 28 }: { type: string; size?: number }) {
  const mark = marks[type];
  if (!mark) return <Plug size={size} aria-hidden="true" />;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={mark.tint}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {mark.art}
    </svg>
  );
}
