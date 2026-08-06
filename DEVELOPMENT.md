# Control Hub - Desenvolupament local

Aquest document es el contracte operatiu per a desenvolupadors i agents. La Fase 1 ha d'implementar exactament aquestes ordres o actualitzar aquest document en la mateixa PR.

## Estat actual

El repositori disposa del nucli executable, identitat i seguretat, CRM professional i la Fase 4 de productes, plans, preus, subscripcions, renovacions i metriques recurrents. El punt de continuacio es la Fase 5 de suport, tickets i SLA; veure `docs/development/current-state.md`.

## Requisits

- Git.
- Node.js LTS fixat pel repositori.
- pnpm mitjancant Corepack.
- Docker Engine o Docker Desktop amb Compose v2.
- PowerShell 7 a Windows; Bash compatible a Linux.

Les versions exactes quedaran fixades a `package.json`, `engines`, `packageManager` i la documentacio de release.

## Arrencada rapida prevista

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev:all
```

En entorns Windows on Node no reconegui una CA corporativa o del sistema, mantenir la validacio TLS activa i executar abans d'instal·lar:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
```

`dev:all` aixecara infraestructura local i els tres processos d'aplicacio amb logs visibles.

Flux alternatiu:

```powershell
pnpm infra:up
pnpm dev
```

## URLs locals canoniques

| Servei | URL | Notes |
|---|---|---|
| Control Hub | `http://localhost:3001` | Unica entrada del navegador |
| API via web | `http://localhost:3001/api/v1` | Ruta preferida des del frontend |
| OpenAPI UI | `http://localhost:3001/api/docs` | Documentacio interactiva en desenvolupament |
| API directa | `http://localhost:4000` | Diagnosi local, no utilitzada pel browser |
| API liveness | `http://localhost:4000/health/live` | Proces actiu |
| API readiness | `http://localhost:4000/health/ready` | Dependencies obligatories preparades |
| Mailpit UI | `http://localhost:8025` | Correu local capturat |
| n8n opcional | `http://localhost:5678` | Perfil `automation` |
| Prometheus opcional | `http://localhost:9090` | Perfil `monitoring` |
| Grafana opcional | `http://localhost:3001` | Perfil `monitoring` |

PostgreSQL `5432`, cua Redis-compatible `6379` i SMTP Mailpit `1025` nomes s'exposen a loopback en desenvolupament. Produccio no publica PostgreSQL ni la cua.

## Topologia

```text
Browser -> localhost:3001 (Next.js)
                    |
                    +-> /api/* -> localhost:4000 (Fastify)
                                      |
                                      +-> PostgreSQL :5432
                                      +-> Queue      :6379
                                      +-> Worker
```

El navegador utilitza origen unic per simplificar cookies, sessions, CSRF i CORS. Next.js fa proxy de `/api/*`; no es creen URLs d'API hardcoded als components.

## Scripts canonics

| Ordre | Responsabilitat |
|---|---|
| `pnpm dev` | Web, API i worker en watch mode |
| `pnpm dev:all` | Infraestructura local + `pnpm dev` |
| `pnpm infra:up` | PostgreSQL, cua i Mailpit |
| `pnpm infra:down` | Atura infraestructura sense eliminar dades |
| `pnpm infra:reset` | Reinicia dades locals amb confirmacio explicita |
| `pnpm db:migrate` | Aplica migracions pendents de forma idempotent |
| `pnpm db:seed:dev` | Afegeix exemples idempotents nomes a PostgreSQL local |
| `pnpm db:seed:e2e` | Prepara el compte i les dades de les proves autenticades |
| `pnpm lint` | Lint de tot el workspace |
| `pnpm typecheck` | TypeScript estricte |
| `pnpm test` | Tests unitaris |
| `pnpm test:integration` | Tests amb containers aillats |
| `pnpm test:e2e` | Playwright |
| `pnpm test:e2e:authenticated` | Playwright amb sessio iniciada (vegeu mes avall) |
| `pnpm test:visual` | Captures light/dark i locales |
| `pnpm build` | Build reproduible de totes les apps |
| `pnpm check` | Lint + typecheck + tests + build |

Cap script de test utilitza la base de dades manual del desenvolupador.

## Dades d'exemple

Despres de crear l'Owner i aplicar migracions, es pot preparar una vista representativa del producte:

```powershell
pnpm db:seed:dev
```

El seed crea leads en diferents estats, clients, productes amb versions, plans i preus, subscripcions de clients i despeses contractades. Es idempotent, no elimina dades existents i rebutja produccio, bases no locals o noms de base diferents de `control_hub`.

## Proves end-to-end autenticades

Les proves de `tests/e2e/*.authenticated.spec.ts` entren al producte de veritat: correu,
contrasenya i segon factor. **L'MFA no es desactiva.** El que fa la sessio automatitzable es
que el secret TOTP d'un compte d'usar i llencar es conegut nomes en aquell entorn.

Necessiten una base de dades **exclusiva de proves**, amb el nom acabat en `_e2e`; el seed
s'hi nega en qualsevol altra, perque reescriu el compte que hi troba.

```powershell
docker exec -e PGPASSWORD=$env:POSTGRES_ADMIN_PASSWORD control-hub-postgres-1 `
  psql -U control_hub_admin -d postgres -c "create database control_hub_e2e;"
$env:MIGRATION_DATABASE_URL = "postgres://control_hub_admin:...@127.0.0.1:5432/control_hub_e2e"
$env:DATABASE_URL = "postgres://control_hub_app:...@127.0.0.1:5432/control_hub_e2e"
$env:E2E_OWNER_EMAIL = "e2e-owner@controlhub.test"
$env:E2E_OWNER_PASSWORD = "<genera'n una, 12+ caracters>"
$env:E2E_CREDENTIALS_FILE = "$PWD\.e2e\credentials.json"
$env:APP_ORIGIN = "http://127.0.0.1:3001"
pnpm db:migrate
pnpm db:seed:e2e
pnpm test:e2e:authenticated
```

- `APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` han de ser **la mateixa cadena**. L'API compara l'origen
  a cada peticio que escriu, i `127.0.0.1` contra `localhost` fa fallar totes les mutacions
  amb `ORIGIN_DENIED`.
- El seed enrola el segon factor per la via normal de Better Auth (`enable` i despres `verify`)
  i es nega a escriure credencials si el compte no acaba amb MFA activada.
- Escriu el secret a `E2E_CREDENTIALS_FILE`. `.e2e/` esta ignorat per git: no el comparteixis
  ni l'adjuntis a cap issue.
- Torna a executar `pnpm db:seed:e2e` abans de cada tanda. Les proves canvien estat i
  assignacio, i el seed les retorna al punt de partida.
- Sense el fitxer de credencials, els projectes autenticats simplement no existeixen i
  `pnpm test:e2e` executa la suite anonima de sempre.

Les rutes de credencials estan limitades a deu peticions per minut i per adreca. Una tanda
completa en gasta cinc; si hi afegiu mes entrades, compteu-les.

## Configuracio

1. Crear `.env` a partir de `.env.example` i substituir els secrets locals abans de la primera arrencada.
2. Generar secrets locals; no reutilitzar staging o produccio.
3. Validacio estricta en arrencar: una variable absent produeix un error accionable.

Fitxers locals `.env*` estan ignorats, excepte `.env.example`. Credencials reals no entren al repositori, captures ni issues.

## Autenticacio local

Better Auth viu a l'API Fastify sota `/api/auth/*`. `pnpm bootstrap:owner` crea l'Owner mitjancant una ordre explicita d'un sol us; no hi ha credencials per defecte hardcoded. Despres de verificar el correu a Mailpit, cal activar TOTP a `/{locale}/security` per accedir a operacions privilegiades.

La sessio es persistent durant la seva vigencia i es conserva a PostgreSQL encara que es reiniciin el web o l'API. Cal entrar sempre per `http://localhost:3001`: alternar entre `localhost` i `127.0.0.1` crea contextos de cookie diferents. L'autoritzacio de les rutes protegides es valida al servidor; una recompilacio temporal del client no provoca un logout.

### Durada de la sessio i dispositiu de confianca

- **Sessio de 30 dies, renovada un cop al dia mentre s'utilitza** el panell.
- **El dispositiu es recorda 30 dies** (`trustDevice`), aixi que el segon factor no es demana a
  cada entrada al mateix navegador.
- **`freshAge` es de 10 minuts i no s'ha tocat.** Les operacions sensibles (canviar contrasenya,
  tocar el segon factor) tornen a demanar credencials per antiga que sigui la sessio.

Aixo es durada de sessio, no politica de factor: l'MFA continua obligatoria per a tots els comptes
i un dispositiu que no s'ha marcat com de confianca rep el repte igualment. Abans eren 12 hores
sense renovacio, i les onze files de `session` de la base de dades de desenvolupament tenien
totes `updatedAt` igual a `createdAt`: cap s'havia allargat mai, de manera que el panell tancava
la sessio dues vegades al dia a hora fixa. Si algun dia el panell s'ha d'obrir des d'un portatil
que viatja, aquests dos numeros son els que s'han de revisar.

Mailpit captura verificacio de correu i recuperacio. MFA i passkeys es poden provar amb TOTP real i autenticadors virtuals de Playwright/WebAuthn.

## Perfils Docker opcionals

```powershell
docker compose --profile automation up -d
docker compose --profile monitoring up -d
```

Els perfils opcionals no poden impedir que el core arrenqui.

## Flux Git

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feature/CH-123-nom-feature
```

Despres: commit atomic, push, PR contra `develop`, CI i merge. Un unic desenvolupador no necessita aprovacio humana, pero la PR i CI continuen sent obligatories.

## Abans de lliurar

```powershell
pnpm check
git diff --check
git status
```

Afegir validacions de seguretat, migracions, integracio o E2E segons el risc. Informar de qualsevol comprovacio no executada.

## Troubleshooting previst

- Port ocupat: aturar el proces conflictiu o definir `POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT` o `MAILPIT_UI_PORT`; els valors canonics no canvien silenciosament.
- Readiness falla: revisar PostgreSQL, cua i migracions.
- Correu no arriba: revisar Mailpit abans del proveidor SMTP.
- Cookies no persisteixen: comprovar que el browser entra per `localhost:3001`.
- Reset de dades: utilitzar nomes `pnpm infra:reset`, mai eliminar volums manualment sense revisar el target.
