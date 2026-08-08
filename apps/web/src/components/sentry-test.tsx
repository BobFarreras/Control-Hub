"use client";

import { useState } from "react";

export function SentryTestButton() {
  const [error, setError] = useState<string | null>(null);

  function triggerError() {
    try {
      throw new Error("Test error from Sentry integration - Controls Hub");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    }
  }

  return (
    <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", marginTop: "20px" }}>
      <h3>Sentry Test</h3>
      <p>Fes clic per provocar un error de prova i verificar que Sentry funciona.</p>
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
      {error && (
        <p style={{ color: "#e74c3c", marginTop: "10px" }}>
          Error capturat: {error}
        </p>
      )}
    </div>
  );
}
