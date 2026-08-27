"use client";

import { getUpdateDictionary, isLocale } from "@control-hub/i18n";
import { ArrowUpCircle, Check, Copy, ExternalLink } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { usePendingUpdate } from "@/components/update-provider";
import { releaseNotesUrl, updateWorkItems } from "@/lib/installation-update";

/** The command a person types, on the server, in the installation directory. */
const updateCommand = "./update.sh";

/**
 * The notice that a newer version exists, and what updating to it involves.
 *
 * It has no button that updates, and that is invariant 2 rather than caution: applying an update
 * means pulling images and replacing containers, and a screen that could do that would need the
 * Docker socket -- which would make the web tier able to replace anything running on the machine.
 * So this carries the two things a person actually needs at that moment: the work the update
 * represents, and the command, ready to copy.
 *
 * Rendered on every screen because the days it exists for are the days nobody is thinking about
 * Control Hub, which are most of them and are the days a security release comes out.
 */
export function UpdateBanner() {
  const state = usePendingUpdate();
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getUpdateDictionary(locale);
  const [copied, setCopied] = useState(false);

  if (!state?.available) return null;
  const available = state.available;
  const notes = releaseNotesUrl(available.version);
  const work = updateWorkItems(available).map((item) =>
    item === "configuration"
      ? t.configuration
      : available.migrations === 1
        ? t.migrationsOne
        : t.migrationsMany.replace("{count}", String(available.migrations))
  );

  function copy() {
    void navigator.clipboard.writeText(updateCommand).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    // `status` rather than `alert`: it is worth announcing and it is not an emergency, and an
    // assertive live region on every navigation would interrupt whatever somebody was reading.
    <section className="update-banner" role="status" aria-label={t.label}>
      <span className="update-banner-icon">
        <ArrowUpCircle size={20} />
      </span>
      <div className="update-banner-body">
        <p>
          <strong>
            {t.available} {available.version}
          </strong>
          <span> — {work.length > 0 ? work.join(" · ") : t.noWork}</span>
        </p>
        <p className="update-banner-command">
          <span>{t.commandHint}</span>
          <code>{updateCommand}</code>
          <button
            className="icon-button"
            type="button"
            title={copied ? t.copied : t.copy}
            aria-label={copied ? t.copied : t.copy}
            onClick={copy}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </p>
      </div>
      <div className="update-banner-aside">
        {notes && (
          // `noreferrer` as well as `noopener`: the address of an internal installation is not
          // something to hand to github.com as a referrer.
          <a href={notes} target="_blank" rel="noreferrer noopener">
            {t.notes}
            <ExternalLink size={14} />
          </a>
        )}
        <span>
          {t.checked} {new Date(state.checkedAt).toLocaleDateString(locale)}
        </span>
      </div>
    </section>
  );
}
