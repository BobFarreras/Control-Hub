# Estat actual i continuacio

## Punt de projecte

Les fases 0 a 5 estan implementades. El producte executa web, API i worker en monorepo,
amb PostgreSQL, Valkey, Better Auth, tenancy, RBAC, MFA, CRM, cataleg comercial,
subscripcions de clients, subscripcions contractades per l'empresa i suport amb tickets i SLA.

**El seguent pas es la Fase 5B: projectes i temps**, amb especificacio aprovada a
`docs/specifications/projects-and-time.md`. L'unica cosa que la Fase 5 li devia, la columna
`tickets.project_id` nullable, ja hi es.

La **Fase 5: suport, tickets i SLA** esta tancada: implementada, revisada pel propietari i
fusionada a `develop` amb CI en verd. Especificacio a `docs/specifications/support.md`. Que
inclou:

- `packages/domain/src/support-calendar.ts`: minuts laborables amb finestres per dia, festius,
  torns partits i canvis d'hora. Pur, 9 tests, sense base de dades.
- `0014_support.sql`: horari, festius, objectius de SLA append-only, politica de notificacio,
  tickets amb `project_id` nullable, missatges i events append-only, incidencies i el seu
  vincle amb tickets. RLS i `force row level security` a totes.
- `packages/database/src/support.integration.test.ts`: aillament entre tenants, rebuig de
  client d'un altre tenant, idempotencia per referencia externa i append-only.

- `packages/domain/src/support.ts`: estats i transicions del ticket, i el calcul de SLA amb
  pauses. El rellotge s'atura a `waiting_customer` i `waiting_third_party`, i les pauses es
  resten en minuts laborables, no de rellotge de paret.
- `packages/application/src/support.ts`: `SupportService` i el port `SupportRepository`.
  Copia els objectius vigents en obrir el ticket, marca la primera resposta un sol cop, i
  retorna el missatge ja desat quan es repeteix una referencia externa.

- `apps/api/src/support-repository.ts`: adaptador contra PostgreSQL. Numero de ticket des
  d'un comptador propi, pauses derivades del log d'events, i primera resposta escrita amb
  `where first_response_at is null`.

- `apps/api/src/routes/support.ts`: llistat, alta, fitxa, canvi d'estat, missatges i estat de
  SLA, amb `tickets:read` i `tickets:manage` a cada ruta i auditoria a les mutacions.
- `0015_support_permissions.sql`: `tickets:read` i `support:configure` a la taula de permisos,
  amb backfill per als tenants que ja existeixen.

- Configuracio de suport per API: horari setmanal, festius i objectius de SLA. Escriure exigeix
  `support:configure`; llegir, nomes `tickets:read`, perque la safata ha de poder explicar un
  venciment.

- `packages/persistence`: els set adaptadors de PostgreSQL, moguts fora d'`apps/api` perque el
  worker tambe els necessita i una app no pot importar d'una altra.
- `apps/worker/src/support-escalation.ts`: escombrada periodica que recorre els tenants i
  registra els objectius de SLA incomplerts. Job repetible de BullMQ cada 5 minuts.

- `apps/web/src/app/[locale]/support/page.tsx` i `components/support-inbox.tsx`: safata amb
  `SmartDataTable`, filtres, cerca i temps laborable restant per fila. Entrada "Suport" del
  menu ja cablejada.
- El llistat retorna l'estat de SLA per fila calculat al servidor: una carrega del calendari i
  una consulta de pauses per pagina, independentment de quantes files mostri.

- `apps/web/src/app/[locale]/support/[ticketId]/page.tsx` i `components/ticket-detail.tsx`:
  fitxa amb conversa, canvi d'estat, assignacio i resposta. Els comentaris interns es marquen
  al DOM (`aria-label` i text), no nomes visualment.
- `GET /api/v1/support/tickets/:ticketId` retorna ticket, conversa, estat de SLA i membres
  assignables en una sola crida.

- Alta de tickets des de la safata, amb seleccio de client, prioritat i categoria.

- **Proves end-to-end autenticades.** Per primera vegada hi ha verificacio automatica de
  pantalles amb sessio iniciada. `apps/api/src/seed-e2e.ts` prepara un compte d'usar i llencar
  en una base exclusiva de test i li **enrola** el segon factor per la via normal de Better
  Auth; l'MFA no es toca, i el seed es nega a escriure credencials si el compte no acaba amb
  MFA activada. `tests/e2e/support/totp.ts` genera els codis amb `node:crypto`, fixat als
  vectors publicats de la RFC 6238 a `tests/e2e/totp.spec.ts`. Cobreixen: entrada completa amb
  correu, contrasenya i segon factor (i el rebuig d'un codi incorrecte), la safata amb la
  columna de compromis, la conversa d'un ticket amb la nota interna marcada al DOM per
  `aria-label` i per text, i el canvi d'estat i l'assignacio des de la fitxa. El job
  `authenticated-end-to-end` de `.github/workflows/ci.yml` ho executa a cada push.

**La Fase 5 esta tancada.** El propietari l'ha revisada i aprovada, i la porta que demanava el
pla queda passada.

El primer pas de la Fase 5 per CI va destapar dos defectes que portaven dies al repositori i
que cap validacio local veia: la imatge de contenidors no es podia ni construir, i el test de
l'escombrada d'escalats assertia sobre estat compartit entre suites que corren en paral·lel.
Tots dos corregits; la causa i la solucio son a `troubleshooting.md`.

### Pendents coneguts, no bloquejants

- Alta d'incidencies i el seu vincle amb tickets: l'esquema hi es, la UI no.
- Pantalla de configuracio de suport (horari, festius, objectius): l'API hi es, la UI no.
- L'E2E autenticat cobreix suport. Cap altre modul (CRM, productes, subscripcions) te encara
  proves amb sessio iniciada, tot i que la infraestructura ja hi es.

## El seguent increment: Fase 5B

Especificacio aprovada a `docs/specifications/projects-and-time.md`. Abast: projectes per
client amb historial append-only, imputacio de temps contra un projecte o un ticket, barems de
cost i de venda versionats per data d'efecte, i rendibilitat per projecte i per client, per
moneda.

Es numera 5B i no 6 per no renumerar les fases posteriors, que ja tenen dependencies
documentades entre elles. Reutilitza `SmartDataTable` (`docs/development/smart-data-table.md`)
per als llistats, i els codis d'error de `docs/specifications/errors-and-api.md`.

La **Fase 5C: registre de jornada** te especificacio a `docs/specifications/attendance.md`.
Pendent de confirmacio de la gestoria abans d'activar-la en produccio.

L'auditoria previa a la Fase 5 i les correccions aplicades estan a
`docs/phase-5-preflight-audit.md`.

## Decisions de suport vigents

- Horari de suport: dilluns a divendres, 08:00 a 16:00, `Europe/Madrid`.
- El rellotge del SLA s'atura fora d'horari i mentre s'espera el client.
- Objectius de SLA per prioritat, iguals per a tots els clients.
- Les incidencies no tenen SLA de client: tenen gravetat, i nomes `critical` avisa fora
  d'horari.

## Superficie executable

- Web canonica: `http://localhost:3001`.
- API interna: `http://127.0.0.1:4000`; el navegador usa exclusivament `/api/*` via Next.js.
- Rutes operatives: dashboard, CRM, detall de client, productes, subscripcions de clients,
  subscripcions d'empresa i seguretat.
- `/{locale}/commerce` es una redireccio de compatibilitat cap a `/{locale}/products`.
- Locales obligatoris: `ca`, `es` i `en`; temes obligatoris: light i dark.

## Decisions UI vigents

- `PageTopbar` es la capcalera canonica: eyebrow, titol i descripcio aprofiten la topbar.
- KPI i accions principals comparteixen franges compactes.
- `MetricHelp` explica sigles i metriques per hover i focus amb text traduit.
- `SmartDataTable` proporciona paginacio server-side, cerca instantania, ordenacio,
  filtres i preferencies de columnes persistides per tenant i usuari.
- CRM permet canviar visualment les etapes actives del lead; Guanyat converteix el lead
  en client i Perdut es una accio terminal separada.
- Tota UI nova ha de seguir `DESIGN_SYSTEM.md` i reutilitzar aquestes primitives.

## Dades i migracions recents

- `0012_company_subscriptions.sql`: despeses recurrents de l'empresa amb RLS.
- `0013_user_table_preferences.sql`: preferencies de taula per tenant i usuari amb RLS.
- `pnpm db:seed:dev`: dades representatives locals, idempotents i sense esborrar dades.

## Validacio abans de continuar

```powershell
pnpm infra:up
pnpm db:migrate
pnpm dev
pnpm check
pnpm test:e2e
```

Les proves d'integracio PostgreSQL requereixen `TEST_DATABASE_URL` i
`TEST_DATABASE_ADMIN_URL` sobre una base exclusiva de test.

Les proves end-to-end autenticades necessiten la seva propia base, acabada en `_e2e`, i
`pnpm db:seed:e2e` abans de cada tanda. El procediment complet es a `DEVELOPMENT.md`. Dos
detalls que fan perdre temps si no es saben: `APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` han de ser
la mateixa cadena, i les proves esperen que React hidrati abans de tocar res, perque un clic
anterior a la hidratacio es perd i sembla que el producte no respongui.
