# Estat actual i continuacio

> Aquest fitxer diu **on som, quin es el seguent pas i quines decisions manen ara**. El relat de
> com hi hem arribat es a `docs/development/history/`. Quan un increment queda tancat, mou-hi el
> seu text en el mateix commit — tal qual, sense resumir-lo.

## On som

Fases 0 a 5C implementades, i tambe els increments 0-11 de consolidacio previs a la Fase 6. Tot
integrat a `develop`.

El producte executa web, API i worker en monorepo, amb PostgreSQL, Valkey, Better Auth, tenancy,
RBAC, MFA, CRM, cataleg comercial, serveis contractats pels clients, eines i despeses recurrents
de l'empresa, suport amb tickets i SLA, projectes amb imputacio de temps i barems versionats, i
registre de jornada.

Portes de qualitat: `pnpm check` passa, i `pnpm check:e2e` passa amb 24/24 proves autenticades,
dos workers, base neta i sense reintents.

## El seguent pas

**Fase 6 oberta a `feature/phase-6-connector-platform`, amb el disseny aprovat.**

L'especificacio es a `docs/specifications/connectors.md`, aprovada l'11 d'agost de 2026, i la
decisio criptografica a `docs/adr/0008-connector-credential-vault.md`.

Fets els increments 1 a 5 del pla que tanca l'especificacio:

| # | Que hi ha | On |
|---|---|---|
| 2 | Domini pur: salut derivada, backoff amb jitter, circuit breaker, redaccio | `packages/domain/src/connectors.ts` |
| 3 | Contracte de connector, registre resolt en build-time, webhook generic | `packages/connectors/` |
| 4 | Migracio `0030`, port d'emmagatzematge i adaptador tenant-scoped | `packages/database/migrations/0030_connectors.sql`, `packages/application/src/connectors.ts`, `packages/persistence/src/connector-repository.ts` |
| 5 | Vault: anell de claus versionat, segellat AES-256-GCM i rotacio en dos slots | `packages/config/src/key-ring.ts`, `packages/persistence/src/credential-vault.ts`, `packages/application/src/connector-credentials.ts` |

El seguent es el 6: el runtime del worker — `guarded-fetch` amb la llista d'egressos, reintents
amb el backoff del domini, el circuit breaker i el registre de `connector_sync_runs`.

**El que l'increment 5 deixa decidit i no s'ha de tornar a decidir.** La clau mai arriba d'un
fitxer versionat: `CONNECTOR_KEY_RING` es un secret de Docker, i el seu format el valida
`parseKeyRing`. Un anell mal format atura l'arrencada tant si el flag `connectors` esta obert com
si no — un secret amb una errata ha de fallar el dia que es desplega. Un anell absent no atura
res: el proces arrenca, `connectorKeyRing` es null i l'arrencada ho diu amb un avis, tal com
demana l'especificacio. Escriure una credencial exigeix
`credentials:rotate` **i** segon factor, i qui la pot escriure no la pot llegir: `ConnectorCredentialService`
no te cap metode que retorni un secret, i `ConnectorSecretReader` — l'unic que n'obre — nomes
l'importa el worker. Una rotacio ocupa dos slots i es tanca amb `promoteCredential`, que revoca
l'antic i promou el nou dins la mateixa transaccio.

Els increments 1 a 8 no toquen `packages/ui` ni `apps/web/src/components`. Si una altra sessio
hi afegeix una migracio abans, la `0030` de connectors es renumera **abans del merge**, mai
despres d'haver-la aplicat enlloc.

El detall i els checks dels increments de consolidacio previs son a
`docs/development/pre-phase-6-product-polish.md`.

## Pendents coneguts, no bloquejants

- Alta d'incidencies i el seu vincle amb tickets: l'esquema hi es, la UI no.
- Pantalla de configuracio de suport (horari, festius, objectius): l'API hi es, la UI no.
- UI de gestio de festius, vacances, absencies i bloquejos: nomes hi ha API i domini.
- La vista de calendari de jornada no mostra festius, vacances ni absencies, nomes hores
  treballades i sessions obertes. Cal connectar-la amb les dades noves.
- CRM, productes i subscripcions no tenen encara proves E2E amb sessio iniciada, tot i que la
  infraestructura ja hi es.
- `db:seed:dev` no sembra projectes ni imputacions, aixi que la pantalla de projectes surt buida
  en un entorn local acabat de sembrar.
- Les migracions `0025` i `0026` s'han de pujar a la base de dades de produccio.

## Feature flags

Registre a `packages/config/src/flags.ts`; s'activen amb `CONTROL_HUB_FLAGS`.

- `projects_and_time` — apagada, l'API no declara les rutes i la web no mostra ni el menu ni les
  pantalles. `/{locale}/projects` respon 404.
- `attendance` — apagada per defecte fins que la gestoria confirmi que la forma del registre li
  serveix.

## Superficie executable

- Web canonica: `http://localhost:3001`.
- API interna: `http://127.0.0.1:4000`; el navegador usa exclusivament `/api/*` via Next.js.
- Rutes operatives: dashboard, CRM, detall de client, productes, serveis de clients, eines i
  despeses recurrents, suport, projectes, barems, jornada i seguretat.
- `/{locale}/commerce` es una redireccio de compatibilitat cap a `/{locale}/products`.
- Locales obligatoris: `ca`, `es` i `en`; temes obligatoris: light i dark.

## Decisions de suport vigents

- Horari de suport: dilluns a divendres, 08:00 a 16:00, `Europe/Madrid`.
- El rellotge del SLA s'atura fora d'horari i mentre s'espera el client.
- Objectius de SLA per prioritat, iguals per a tots els clients.
- Les incidencies no tenen SLA de client: tenen gravetat, i nomes `critical` avisa fora
  d'horari.

## Decisions UI vigents

- `PageTopbar` es la capcalera canonica: eyebrow, titol i descripcio aprofiten la topbar.
- KPI i accions principals comparteixen franges compactes.
- `MetricHelp` explica sigles i metriques per hover i focus amb text traduit.
- `SmartDataTable` proporciona paginacio server-side, cerca instantania, ordenacio,
  filtres i preferencies de columnes persistides per tenant i usuari.
- `ToastProvider` ofereix notificacions efimeres (auto-dismiss 5s) per errors i confirmacions.
  Ubicat **a baix a la dreta**, respectant la safe-area, adaptat a mobil i sense animacio amb
  reduced motion. Utilitzar `useToast()` des de qualsevol component de client.
- CRM permet canviar visualment les etapes actives del lead; Guanyat converteix el lead
  en client i Perdut es una accio terminal separada.
- Tota UI nova ha de seguir `DESIGN_SYSTEM.md` i reutilitzar aquestes primitives.

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

## Dades i migracions recents

- `0012_company_subscriptions.sql`: despeses recurrents de l'empresa amb RLS.
- `0013_user_table_preferences.sql`: preferencies de taula per tenant i usuari amb RLS.
- `0029_company_subscriptions_polish.sql`: evolucio additiva de les despeses recurrents,
  responsable tenant-scoped, dates contractuals, historial append-only i backfill idempotent.
- `0016_projects_and_time.sql`: projectes, historial, barems i imputacions. Tres garanties que
  no viuen al domini: el xor de la imputacio (`num_nonnulls(project_id, ticket_id) = 1`), el
  trigger que rebutja hores sobre un projecte tancat (SQLSTATE propi `CH001`), i la clau forana
  composta `tickets(tenant_id, project_id, customer_id)` que obliga el projecte d'un ticket a
  ser del mateix client.
- `0017_projects_permissions.sql`: permisos nous amb backfill per als tenants existents.
- `0030_connectors.sql`: instancies, credencials segellades, execucions, endpoints d'ingress i
  inbox. Dues garanties que no viuen a l'aplicacio: l'index unic parcial que nomes deixa dues
  credencials vives per tipus — la finestra de rotacio — i la clau unica
  `(tenant_id, endpoint_id, provider_event_id)`, que es la idempotencia d'ingress feta complir
  per la base i no per una lectura que dos workers poden creuar. Cap permis nou: `integrations:read`,
  `integrations:manage` i `credentials:rotate` existeixen des de la `0003`.
- `pnpm db:seed:dev`: dades representatives locals, idempotents i sense esborrar dades. **Encara
  no sembra projectes ni imputacions.**

## Observabilitat

Sentry captura errors de produccio al servei web (Next.js). L'API i el worker encara no.
**Configuracio, variables d'entorn i CSP a `docs/observability/SENTRY.md`** — no la dupliquis
aqui.

## Validacio abans de continuar

```powershell
pnpm infra:up
pnpm db:migrate
pnpm dev
pnpm check
pnpm check:e2e
```

Les proves d'integracio PostgreSQL requereixen `TEST_DATABASE_URL` i
`TEST_DATABASE_ADMIN_URL` sobre una base exclusiva de test.

Les proves end-to-end autenticades necessiten la seva propia base, acabada en `_e2e`, i
`pnpm db:seed:e2e` abans de cada tanda. El procediment complet es a `DEVELOPMENT.md`. Dos
detalls que fan perdre temps si no es saben: `APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` han de ser
la mateixa cadena, i les proves esperen que React hidrati abans de tocar res, perque un clic
anterior a la hidratacio es perd i sembla que el producte no respongui.

## On es la resta

| Que busques | On es |
| --- | --- |
| Com hem arribat fins aqui, fase a fase | `docs/development/history/` |
| Fallades ja diagnosticades | `docs/development/troubleshooting.md` |
| Especificacio d'un modul | `docs/specifications/<modul>.md` |
| Checks dels increments previs a la Fase 6 | `docs/development/pre-phase-6-product-polish.md` |
| Auditoria previa a la Fase 5 | `docs/phase-5-preflight-audit.md` |
| Sentry i observabilitat | `docs/observability/SENTRY.md` |
| Normes vinculants | `AGENTS.md` |
