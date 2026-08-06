# Estat actual i continuacio

## Punt de projecte

Les fases 0 a 5B estan implementades. El producte executa web, API i worker en monorepo,
amb PostgreSQL, Valkey, Better Auth, tenancy, RBAC, MFA, CRM, cataleg comercial,
subscripcions de clients, subscripcions contractades per l'empresa, suport amb tickets i SLA, i
projectes amb imputacio de temps, barems versionats i rendibilitat.

**La Fase 5B esta implementada a `feature/phase-5b-projects-and-time` i pendent de revisio del
propietari.** No esta fusionada a `develop` ni desplegada. Especificacio a
`docs/specifications/projects-and-time.md`. Que inclou:

- `packages/config/src/flags.ts`: el registre de feature flags del repositori, el primer que hi
  ha. Cada flag es declara amb propietari i data de retirada, i s'activa amb `CONTROL_HUB_FLAGS`.
  `projects_and_time` apagada vol dir que l'API no declara les rutes i la web no mostra ni el
  menu ni les pantalles. Un nom no declarat s'ignora i s'avisa a l'arrencada.
- `packages/domain/src/projects.ts`: estats i transicions del projecte, arrodoniment half-up amb
  `BigInt`, resolucio del barem per data d'efecte, lectura de durades (`90` i `1h 30m`) i marge
  per moneda. Pur, 25 tests, sense base de dades.
- `0016_projects_and_time.sql`: projectes, historial append-only, barems de cost i de venda,
  imputacions, i la clau forana composta que obliga el projecte d'un ticket a ser del mateix
  client. RLS i `force row level security` a totes. `0017_projects_permissions.sql` afegeix
  `projects:read`, `time:log`, `time:manage` i `rates:manage` amb backfill per als tenants que
  ja existeixen.
- `packages/application/src/projects.ts`: `ProjectsService` i el port `ProjectsRepository`.
  Valida el xor de la imputacio, rebutja dates futures i projectes tancats, retorna la
  imputacio ja desada quan es repeteix un `clientReference`, i nomes deixa editar hores d'una
  altra persona amb `time:manage`.
- `packages/persistence/src/projects-repository.ts`: adaptador contra PostgreSQL. Els dies
  viatgen com a `YYYY-MM-DD` i no com a instants, i els barems es carreguen sencers per
  resoldre'ls al domini en comptes de fer una consulta per hora imputada.
- `apps/api/src/routes/projects.ts`: llistat, alta, fitxa, canvi d'estat, imputacions, barems i
  rendibilitat per projecte i per client. Cost i marge sempre darrere `financials:read`, al
  servei i a la ruta. Cap import de cost a l'auditoria.
- `apps/web`: pantalla de projectes amb `SmartDataTable`, fitxa amb historial, formulari
  d'imputacio i bloc de rendibilitat. El bloc financer no arriba al navegador de qui no te
  `financials:read`: el servidor no el demana, no s'amaga amb CSS.

- `tests/e2e/projects.authenticated.spec.ts`: dues proves amb sessio iniciada que creen un
  projecte pel dialeg real, hi imputen `1h 30m`, comproven que la fitxa i la capcalera diuen les
  mateixes hores, que l'informe avisa del barem absent en comptes d'ensenyar marge, i que un
  projecte tancat deixa el formulari d'hores inhabilitat amb el motiu escrit. El job
  `authenticated-end-to-end` porta `CONTROL_HUB_FLAGS=projects_and_time`; sense la variable
  aquestes proves anirien contra un 404.

### El que encara no s'ha fet

No hi ha **pantalla de gestio de barems**: l'API els publica i els llegeix, pero avui es
configuren per API. `IMPLEMENTATION_PLAN.md` la llista com a entregable de la Fase 5B.

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
- **Pantalla de barems** (`IMPLEMENTATION_PLAN.md` la llista com a entregable de la Fase 5B):
  l'API publica i llegeix barems de cost i de venda, pero no hi ha UI per fer-ho. Avui es
  configuren per API.
- L'E2E autenticat cobreix suport i projectes. CRM, productes i subscripcions no tenen encara
  proves amb sessio iniciada, tot i que la infraestructura ja hi es.
- `db:seed:dev` no sembra projectes ni imputacions, aixi que la pantalla de projectes surt buida
  en un entorn local acabat de sembrar.

## El seguent increment

Un cop el propietari revisi i fusioni la Fase 5B, la **Fase 5C: registre de jornada** te
especificacio a `docs/specifications/attendance.md`. Pendent de confirmacio de la gestoria
abans d'activar-la en produccio.

Abans, val la pena tancar els dos buits que la Fase 5B deixa oberts a proposit: la pantalla de
barems i les proves E2E autenticades del modul.

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
  subscripcions d'empresa, suport, projectes i seguretat.
- `/{locale}/projects` i `/{locale}/projects/{projectId}` nomes existeixen amb
  `CONTROL_HUB_FLAGS=projects_and_time`. Sense la flag responen 404 i el menu no les mostra.
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
- `0016_projects_and_time.sql`: projectes, historial, barems i imputacions. Tres garanties que
  no viuen al domini: el xor de la imputacio (`num_nonnulls(project_id, ticket_id) = 1`), el
  trigger que rebutja hores sobre un projecte tancat (SQLSTATE propi `CH001`), i la clau forana
  composta `tickets(tenant_id, project_id, customer_id)` que obliga el projecte d'un ticket a
  ser del mateix client.
- `0017_projects_permissions.sql`: permisos nous amb backfill per als tenants existents.
- `pnpm db:seed:dev`: dades representatives locals, idempotents i sense esborrar dades. **Encara
  no sembra projectes ni imputacions.**

## Decisions de projectes i temps vigents

- Els barems son append-only amb data d'efecte. Una imputacio es valora amb el barem vigent el
  **dia treballat**, mai amb el d'avui.
- Els dies (`spent_on`, `effective_from`) viatgen com a `YYYY-MM-DD` de la base a la pantalla i
  mai es converteixen a instant: un barem vigent des del dia 1 val per a la feina del dia 1
  sigui quina sigui la zona horaria de qui ho llegeix.
- L'arrodoniment es half-up i **per imputacio**, no sobre la suma, de manera que un total sempre
  es la suma de les linies que un client pot veure.
- Les hores d'un projecte inclouen les imputades als seus tickets. La feina de suport d'un
  projecte es feina del projecte.
- Una imputacio sense barem resoluble no compta com a cost zero: surt a l'informe com a barem
  absent.
- La durada s'envia com a text (`90` o `1h 30m`) i la llegeix un unic parser del domini.

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
