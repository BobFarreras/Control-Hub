"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

export function SentryTestButton() {
  const [sent, setSent] = useState(false);

  function triggerError() {
    Sentry.captureException(new Error("Test error from Sentry integration - Controls Hub"));
    setSent(true);
  }

  return (
    <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "20px" }}>
      <h3>Sentry Test</h3>
      <p>Fes clic per enviar un error de prova a Sentry.</p>
      <button
        onClick={triggerError}
        style={{
          padding: "10px 20px",
          backgroundColor: "#e74c3c",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer"
        }}
      >
        Provocar Error
      </button>
      {sent && (
        <p style={{ color: "#27ae60", marginTop: "10px" }}>
          Error enviat a Sentry! Comprova-ho a la consola de Sentry.
        </p>
      )}
    </div>
  );
}
