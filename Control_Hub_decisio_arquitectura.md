# Control Hub - Decisions d'arquitectura

**Estat:** aprovat per iniciar la base tecnica

**Document canonic:** aquest document preval sobre presentacions i resums

**Responsable tecnic:** Adria

**Validacio i pressupost:** Enric

**Titularitat:** Empresa

## 1. Objectiu

Control Hub sera una plataforma centralitzada per gestionar clients, leads, productes, subscripcions, tickets, infraestructura, automatitzacions, costos, errors i salut operativa.

El producte ha de poder desplegar-se en qualsevol VPS Linux compatible amb Docker, sense dependre obligatoriament de Cloudflare, n8n, Sentry ni cap proveidor concret.

## 2. Decisions principals

### ADR-001 - Monolit modular desplegable en contenidors

El producte sera un monolit modular TypeScript desplegat amb Docker Compose:

```text
Reverse proxy opcional
        |
Next.js Web -> Fastify API -> PostgreSQL
                    |
               Worker + Redis
                    |
          Connectors opcionals
```

Es descarten inicialment microserveis i Kubernetes. El perfil de desplegament en una sola VPS tindra un punt unic de fallada declarat, backups externs i recuperacio provada. Aquesta simplificacio operativa no redueix la qualitat del software.

### ADR-002 - Distribucio single-tenant, domini tenant-aware

Cada desplegament atendra inicialment una empresa. Tot i aixi, el domini i la base de dades inclouran `tenant_id` des del primer dia per permetre instal·lacions multiples i una futura modalitat SaaS.

Regles obligatories:

- El tenant es resol des de la identitat autenticada, mai des d'un valor arbitrari del client.
- Totes les entitats empresarials pertanyen a un tenant.
- Les uniques i relacions sensibles inclouen `tenant_id`.
- Els repositoris i casos d'us reben sempre un context de tenant.
- PostgreSQL RLS s'utilitza com a defensa addicional, no com a unic control.
- Secrets, auditories, exportacions i eliminacions estan separats per tenant.

### ADR-003 - Next.js, Fastify i worker separats

- **Next.js:** interfície web i renderitzat.
- **Fastify:** API versionada, autenticacio, permisos i casos d'us.
- **Worker:** jobs, sincronitzacions, notificacions i integracions.

La logica de negoci no viura als components React ni als handlers de transport.

### ADR-004 - PostgreSQL com a font de veritat

PostgreSQL emmagatzema l'estat empresarial. Drizzle gestiona l'esquema i les migracions versionades. Redis/BullMQ proporciona cues i jobs, pero no es font de veritat.

- Identificadors UUIDv7 o equivalents ordenables.
- Imports monetaris en unitats menors i moneda ISO 4217.
- Dates persistides en UTC.
- Restriccions i claus foranes a la base de dades.
- Migracions compatibles amb rollback de l'aplicacio sempre que sigui possible.

### ADR-005 - Plataforma de connectors

Les integracions son adaptadors opcionals i versionats. El core no conte condicionals dispersos per proveidor.

Connectors inicials previstos:

- VPS/Prometheus.
- n8n.
- SMTP/IMAP, Microsoft Graph i Gmail.
- Anthropic i OpenAI.
- Sentry.
- Storage S3-compatible.
- Webhook generic.

Cada connector defineix manifest, esquema de configuracio, referencia de credencials, capacitats, health check, timeouts, reintents, rate limits, sincronitzacio, auditoria i compatibilitat.

### ADR-006 - n8n extern i opcional

n8n sera una aplicacio independent, encara que comparteixi VPS. Control Hub:

- Consulta exclusivament APIs, webhooks i metriques suportades.
- Mostra salut, workflows, execucions i errors.
- Pot associar workflows amb clients i productes.
- Ofereix enllacos validats cap a la URL oficial de n8n.
- No incrusta ni redistribueix la interfície de n8n.
- No consulta ni modifica les taules internes de n8n.
- No comparteix tokens o sessions a traves dels enllacos.
- Continua funcionant quan n8n no esta instal·lat.

Qualsevol canvi futur que exposi n8n als clients requerira una revisio tecnica i de llicencia.

### ADR-007 - Desplegament portable

El paquet de desplegament tindra un `compose.yaml` base i perfils o overlays opcionals:

```text
core:        web, api, worker, PostgreSQL
queue:       Redis
automation:  n8n
monitoring:  Prometheus, Grafana, exporters
proxy:       Traefik o alternativa
```

No s'assumeix un cloud concret. Es podran utilitzar registries OCI, proxies i object storage compatibles de diferents proveidors. Les imatges tindran versions immutables i produccio podra fixar-les per digest.

### ADR-008 - MCP planificat sobre el nucli

MCP forma part de l'arquitectura objectiu, pero s'implementara quan API, permisos, auditoria i connectors ja ofereixin els casos d'us necessaris. El servidor MCP reutilitzara aquests contractes sense exigir una reescriptura:

- Primera fase: eines de lectura.
- Fase posterior: escriptura amb scopes, confirmacio i auditoria.
- HTTP remot: OAuth 2.1, PKCE, audience binding i tokens de curta durada.
- Prohibit el token passthrough a APIs de tercers.

## 3. Stack base

- pnpm workspaces i Turborepo.
- Node.js LTS i TypeScript estricte.
- Next.js, React, Tailwind CSS i shadcn/ui.
- TanStack Query, React Hook Form i Zod.
- Fastify i OpenAPI.
- PostgreSQL i Drizzle ORM.
- Redis i BullMQ.
- Vitest, Testcontainers i Playwright.
- Docker Compose.

Les versions majors suportades es fixaran al repositori i s'actualitzaran de manera controlada.

## 4. Seguretat

- MFA obligatori per comptes privilegiats.
- Sessions revocables, expiracio i registre d'accessos.
- Permisos per tenant, recurs i accio, verificats al backend.
- CSP, CORS restrictiu, rate limiting i proteccio CSRF quan correspongui.
- Webhooks amb HMAC, timestamp, proteccio contra replay i idempotencia.
- Contenidors no-root, read-only quan sigui viable, healthchecks i xarxes separades.
- PostgreSQL i Redis sense ports publics.
- Cap servei web tindra acces lliure al Docker socket o SSH.
- Logs estructurats amb request ID i redaccio de secrets i PII.

Els secrets de plataforma s'injectaran per fitxer o secret manager. Les credencials dels connectors es guardaran xifrades per tenant; la clau mestra no residira a la base de dades.

## 5. Qualitat i CI/CD

Pipeline minim:

1. Instal·lacio reproduible.
2. Typecheck i lint.
3. Tests unitaris i d'integracio.
4. Build.
5. Analisi de secrets, dependencies, codi i imatges.
6. Generacio d'imatges OCI i SBOM.
7. Publicacio immutable.
8. Desplegament a staging i smoke tests.
9. Desplegament controlat a produccio.

Abans de comercialitzar: signatura d'imatges, provenance, politica de CVE, canals `stable`/`beta` i compatibilitat d'actualitzacions documentada.

## 6. Backups i recuperacio

Objectius inicials:

- **RPO objectiu:** 1 hora com a maxim.
- **RTO objectiu:** 4 hores com a maxim.
- Alta disponibilitat inicial: no.

Els backups inclouran PostgreSQL, fitxers, object storage, configuracio, manifest de versions i metadades necessaries. Seran xifrats, copiats fora de la VPS i verificats. La clau mestra tindra custodia independent.

Es fara una restauracio mensual en un entorn net. Un snapshot del proveidor no substitueix el backup.

## 7. Observabilitat

- Health endpoints per servei.
- Logs JSON amb correlation/request ID.
- Metriques de servei i negoci.
- Alertes per indisponibilitat, backups, errors, cues i costos.
- Prometheus, Grafana, Sentry i Uptime Kuma son adaptadors opcionals.
- La infraestructura es consulta mitjancant metriques o un agent restringit, mai amb una consola SSH arbitraria.

## 8. Roadmap

El detall executable, els entregables i els criteris d'aprovacio de cada fase es defineixen a [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

1. Fonaments: monorepo, Docker, CI, autenticacio, tenant, permisos i auditoria.
2. Nucli: dashboard, leads, clients, contactes i activitat.
3. Producte: plans, subscripcions, renovacions, MRR i marges.
4. Suport: tickets, SLA, comentaris i notificacions.
5. Infraestructura: serveis, backups, certificats i alertes.
6. Connectors: n8n, correu, IA, monitoratge i webhooks.
7. Costos d'IA i comunicacions.
8. MCP de lectura i, posteriorment, operacions controlades.
9. Portal de client opcional.

## 9. Definition of Done

Una funcionalitat esta acabada quan compleix l'especificacio i criteris d'acceptacio, te proves proporcionals al risc, aplica tenant i permisos, registra auditoria quan toca, inclou observabilitat, no exposa secrets, disposa de migracio segura i es pot desplegar i revertir de manera controlada.
