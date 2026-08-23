# Guia d'implementacio de la Fase 8

**Estat:** guia de treball vinculada a les especificacions aprovades
`docs/specifications/communications-usage-costs.md` i
`docs/specifications/phase-7b-actions-and-oauth.md`.

## Precondicions

Abans del primer commit:

1. Els increments C1-C7 de la Fase 7.3 han d'estar presents a la branca compartida i les portes
   afectades han de passar.
2. Les tres ampliacions del model de dades han d'estar aprovades; ho estan des del 23 d'agost de
   2026.
3. Per a Gmail, Graph o correu sortint, la Fase 7B ha d'estar especificada, aprovada i integrada.
4. La implementacio continua a la branca compartida actual, sense crear cap worktree, i revisa
   abans de cada edicio si l'altra sessio ha modificat el mateix fitxer.
5. Les migracions de la Fase 8 comencen a la `0042`; no es calculen des de `develop`, perque la
   `0041` ja existeix en aquesta branca.

Exemple PowerShell:

```powershell
git status --short --branch
git log -5 --oneline --decorate
Get-ChildItem packages/database/migrations/*.sql | Sort-Object Name | Select-Object -Last 5
```

## Regles que no es renegocien

- El connector no rep base de dades ni `fetch` global.
- Tota I/O externa corre al worker amb timeout, retry limitat i circuit breaker.
- PostgreSQL es font de veritat; la cua es reconstruible.
- `tenant_id` surt del context autenticat, no del body.
- Imports en unitats menors; quantitats i calculs financers sense coma flotant.
- Events, tarifes, FX i valoracions son append-only o s'anul.len amb evidencia.
- Cap prompt, resposta, token, payload cru o cos de correu apareix en logs.
- La UI no es un control d'autoritzacio: API, servei, repositori i RLS protegeixen les dades.

## Ordre recomanat

### U1 — Domini pur

Fitxers principals:

- `packages/domain/src/usage.ts`
- `packages/domain/src/usage.test.ts`

Construir i provar:

- unitats i quantitats;
- tarifes per escala i data;
- arrodoniment half-up amb `BigInt`;
- FX racional;
- prioritats `reported | rated | unpriced`;
- estats `healthy | warning | exceeded | stale | partial`.

Porta:

```powershell
pnpm --filter @control-hub/domain test
pnpm --filter @control-hub/domain typecheck
```

No hi ha base de dades, Fastify, React ni noms de proveidor en les funcions pures.

### U2 — Dades, ports i permisos

Crear `0043_usage_costs.sql` (`0042` ja pertany a les etiquetes d'hosts de la fase 7.2). Afegir taules, RLS, FK compostes, checks, indexes i grants. Separar
`usage:manage` de `budgets:manage`.

Fitxers principals:

- `packages/database/migrations/0043_usage_costs.sql`
- `packages/application/src/usage.ts`
- `packages/persistence/src/usage-repository.ts`
- `packages/domain/src/index.ts`
- `docs/specifications/permissions.md`

Proves obligatories:

- dos tenants no es veuen;
- una FK aliena es rebutjada;
- dos ingestors concurrents no dupliquen l'event;
- el rol d'aplicacio no pot mutar evidencia;
- Technical rep denegacio financera encara que conegui l'ID.

### U3 — Ingestio i worker

El runtime llegeix `connector_records`, normalitza i envia un DTO al servei d'aplicacio. La clau
d'idempotencia inclou tenant, instancia, operacio i identificador extern estable.

Fitxers principals:

- `apps/worker/src/usage/`
- `packages/contracts/src/jobs.ts`
- `packages/application/src/usage.ts`
- `packages/persistence/src/usage-repository.ts`

Casos negatius:

- event duplicat;
- pagina repetida;
- proveidor sense ID estable;
- event sense tarifa;
- font parcial o stale;
- job reintentat despres d'haver persistit.

### U4 — Tarifes, FX i pressupostos

Afegir casos d'us, endpoints OpenAPI i auditoria. Una tarifa o FX publicada no s'edita; s'anul.la
i se'n publica una altra. El pressupost consumeix valoracions, no payloads de proveidor.

Cap resposta de `usage:read` pot contenir imports. Fer proves sobre l'objecte serialitzat complet,
no nomes sobre un camp.

### U5 — Connectors Anthropic i OpenAI

Cada connector entra en un commit independent i inclou:

- schema/config fields i paraules `ca`, `es`, `en`;
- fixtures capturades i anonimitzades amb versio d'API;
- contract tests de paginacio, errors, rate limit i camps absents;
- health check i operacions de forma `event` o `state` segons semantica;
- cap tarifa hardcoded dins del connector.

Si una API no ofereix detall reconciliable, el connector declara la limitacio i s'utilitza import
manual. No es fa scraping de consoles web.

### U6 — UI de consum i costos

Rutes proposades:

- `/{locale}/usage`: volum, salut i cobertura.
- `/{locale}/usage/costs`: costos i atribucio, amb `financials:read`.
- `/{locale}/usage/budgets`: pressupostos.

Reutilitzar `PageTopbar`, `SmartDataTable`, tokens semantics i `SelectControl`/`SelectField`.
Incloure light, dark, teclat, mobile, reduced motion i `ca`/`es`/`en`.

Els estats partial i stale han de dir quina font o dada falta; no poden ser un color sense text.

### M1 — IMAP entrant

Implementar lectura incremental, no enviament. El cursor es monotonic i l'import a suport es
idempotent per identificador de bustia i missatge. No carregar recursos remots ni adjunts.

Validar limits de mida, encoding, capçaleres, fils malformats i correus duplicats. El contingut
importat entra pel cas d'us de suport existent amb `externalReference`.

### M2 — Gmail i Graph entrants

No començar fins tenir OAuth de la 7B. Provar PKCE, `state`, refresh concurrent, revocacio,
expiracio i que cap refresh token surti del vault, job, log o API.

### M3 — Correu sortint

No començar fins tenir accions de la 7B. El flux es:

```text
usuari confirma -> API valida permis/MFA -> outbox -> cua -> connector -> resultat -> auditoria
```

Una mateixa idempotency key produeix un sol enviament. Timeout despres d'enviar dona `unknown`, no
`failed`, fins que el proveidor permeti reconciliar.

### M4 — Integracio amb suport

Afegir import, resposta, estat de lliurament i E2E autenticats. El ticket continua sent el domini
propietari del missatge; correu es un adaptador, no un segon sistema de tickets.

## Estrategia de commits

Commits petits i revisables:

```text
feat(usage): define reproducible usage valuation
feat(usage): persist tenant-scoped usage evidence
feat(usage): ingest connector usage idempotently
feat(usage): manage rates exchange and budgets
feat(connectors): read anthropic usage
feat(connectors): read openai usage
feat(web): show usage costs and coverage
```

No barrejar un connector, una migracio i una pantalla en un sol commit.

## Verificacio per increment

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:scripts
pnpm build
git diff --check
git status --short
```

Quan hi hagi dades o connectors:

```powershell
pnpm test:integration
pnpm check:e2e
```

La CI no contacta proveidors reals. Utilitza contract tests i fixtures. La revisio amb comptes
reals es una porta del propietari posterior al codi i mai escriu credencials al repositori.

## Checklist de seguretat

- [ ] RLS `enable` i `force` a totes les taules tenant-scoped.
- [ ] FK compostes impedeixen referencies cross-tenant.
- [ ] Permisos negatius provats a API i servei.
- [ ] URLs sota la guarda SSRF i allowlist d'operador quan siguin internes.
- [ ] Secrets oberts just-in-time al worker.
- [ ] Logs i errors redaccionats amb proves.
- [ ] Jobs sense secrets ni contingut sensible.
- [ ] Deduplicacio concurrent protegida per unique/index, no nomes per un `select` previ.
- [ ] Purga continua amb la feature flag apagada.
- [ ] Exports financers auditats i protegits contra formula injection.

## Integracio amb una branca que ha avançat

Abans de fusionar:

```powershell
git fetch origin
git merge --no-ff develop
pnpm install --frozen-lockfile
pnpm check
```

Revisar especialment:

- numero de migracio;
- `packages/domain/src/index.ts` i permisos;
- registre de connectors i i18n;
- `apps/api/src/app.ts`, OpenAPI i seed E2E;
- sidebar, estils i `current-state.md`.

Si hi ha una migracio amb el mateix numero, renumerar la no publicada abans d'aplicar-la. No editar
mai una migracio ja aplicada o integrada.
