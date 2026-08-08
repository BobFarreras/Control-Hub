# Sentry a Control Hub

## Què és

Sentry captura errors en producció amb stack trace, context d'usuari i alertes.
En lloc d'esperar que un usuar es queixi, Sentry t'avisa automàticament.

## Configuració actual

| Servei | Estat | Paquet |
|--------|-------|--------|
| web (Next.js) | ✅ Implementat | `@sentry/nextjs` |
| api (Node.js) | ❌ No implementat | `@sentry/node` (futur) |
| worker (Node.js) | ❌ No implementat | `@sentry/node` (futur) |

## Variables d'entorn

```
NEXT_PUBLIC_SENTRY_DSN=https://...@ingest.sentry.io/...
SENTRY_AUTH_TOKEN=sntryu_...
```

- `NEXT_PUBLIC_SENTRY_DSN`: Exposada al navegador (no és un secret). Configurada a Sentry.io → Settings → Projects → Client Keys.
- `SENTRY_AUTH_TOKEN`: Usada només al build per pujar source maps. Configurada a Sentry.io → Settings → Auth Tokens.

## Fitxers creats

| Fitxer | Funció |
|--------|--------|
| `apps/web/sentry.client.config.ts` | Configuració Sentry al navegador |
| `apps/web/sentry.server.config.ts` | Configuració Sentry al servidor Node |
| `apps/web/sentry.edge.config.ts` | Configuració Sentry a l'edge runtime |
| `apps/web/instrumentation-client.ts` | Hook client per a React |
| `apps/web/instrumentation.ts` | Hook servidor per a Next.js |
| `apps/web/next.config.ts` | Wrapper `withSentryConfig()` |

## Com funciona

### En desenvolupament

Sentry està **desactivat** (`enabled: false` quan `NODE_ENV !== "production"`).
Els errors apareixen a la consola del navegador/servidor com sempre.

### A producció

1. L'usuari provoca un error
2. Sentry SDK captura l'error amb stack trace
3. L'error apareix a Sentry.io → Issues
4. Si tens alertes configurades, rep un email

### Source maps

El plugin `withSentryConfig` puja automàticament els source maps a Sentry durant el build.
Això permet veure el codi TypeScript original a les stack traces de Sentry.

**Requisit:** `SENTRY_AUTH_TOKEN` ha d'estar configurat al CI/CD.

## Com provar

### 1. Provocar un error al code

Afegeix temporalment a qualsevol pàgina:

```tsx
"use client";

export function TestError() {
  return (
    <button onClick={() => { throw new Error("Test error from Sentry"); }}>
      Provocar error
    </button>
  );
}
```

### 2. Verificar a Sentry.io

1. Vés a https://sentry.io
2. Selecciona el projecte "control-hub"
3. Vés a Issues
4. Hauries de veure l'error amb stack trace

### 3. Pàgina de prova de Sentry

Sentry crea automàticament una pàgina a `/sentry-example-page`.
Si la veus, la integració funciona.

## Configurar alertes

### Email per nous errors

1. Vés a Sentry.io → Alerts → Create Alert Rule
2. Selecciona "Issue"
3. Condicions: "A new issue is created"
4. Acció: "Send a notification via Email"
5. Desa

### Altres canals

Sentry suporta:
- Email (configurat)
- Slack
- PagerDuty
- Microsoft Teams
- Webhooks

## Errors coneguts

### "Duplicated key" al next.config.ts

Si tens `disableLogger` dues vegades, elimina'n una. El fitxer `next.config.ts` ja està netejat.

### Source maps no apareixen

Verifica que `SENTRY_AUTH_TOKEN` estigui configurat al build:
```bash
echo $SENTRY_AUTH_TOKEN  # Ha de mostrar el token
```

### Errors no apareixen a Sentry

1. Verifica que `NODE_ENV=production` al desplegament
2. Verifica que `NEXT_PUBLIC_SENTRY_DSN` estigui configurat
3. Mira la consola del navegador: si hi ha errors de Sentry, els veuràs

## Plan futur: api i worker

Quan es necessiti, afegir `@sentry/node` a l'api i el worker:

```typescript
// apps/api/src/sentry.ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1
});
```

Això és una tasca de 30 minuts. No cal fer-ho fins que l'api i el worker estiguin a producció.

## Enllaços

- [Documentació Sentry per Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Configuració manual](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
- [Sentry.io](https://sentry.io)
