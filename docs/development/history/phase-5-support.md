# Historic — Fase 5: suport, tickets i SLA

> Text mogut tal qual des de `docs/development/current-state.md` (linies 235-304 de la
> versio anterior a la particio). No s'ha resumit ni reescrit res.

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
