import { SentryTestButton } from "@/components/sentry-test";

export default function SentryTestPage() {
  return (
    <main style={{ padding: "40px", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Sentry Integration Test</h1>
      <p>Aquesta pàgina serveix per verificar que Sentry funciona correctament.</p>

      <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#f8f9fa", borderRadius: "8px" }}>
        <h2>Com provar:</h2>
        <ol>
          <li>Fes clic al botó "Provocar Error"</li>
          <li>
            Vés a{" "}
            <a href="https://sentry.io" target="_blank" rel="noopener noreferrer">
              Sentry.io
            </a>
          </li>
          <li>Selecciona el projecte "control-hub"</li>
          <li>Vés a Issues</li>
          <li>Hauries de veure l'error amb stack trace</li>
        </ol>
      </div>

      <SentryTestButton />

      <div style={{ marginTop: "30px", padding: "15px", backgroundColor: "#fff3cd", borderRadius: "8px" }}>
        <h3>Nota important:</h3>
        <p>
          Sentry només captura errors a <strong>producció</strong> (quan <code>NODE_ENV=production</code>). En
          desenvolupament, els errors van a la consola del navegador.
        </p>
        <p>Per provar a producció, desplega el servei i visita aquesta pàgina.</p>
      </div>
    </main>
  );
}
