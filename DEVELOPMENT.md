# Control Hub - Desenvolupament local

Aquest document es el contracte operatiu per a desenvolupadors i agents. La Fase 1 ha d'implementar exactament aquestes ordres o actualitzar aquest document en la mateixa PR.

## Estat actual

El repositori disposa del nucli executable, la identitat i seguretat de la Fase 2, i el CRM professional complet de la Fase 3: leads, clients, contactes, activitat, tasques, CSV i dashboard comercial.

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
| Control Hub | `http://localhost:3000` | Unica entrada del navegador |
| API via web | `http://localhost:3000/api/v1` | Ruta preferida des del frontend |
| OpenAPI UI | `http://localhost:3000/api/docs` | Documentacio interactiva en desenvolupament |
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
Browser -> localhost:3000 (Next.js)
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
| `pnpm lint` | Lint de tot el workspace |
| `pnpm typecheck` | TypeScript estricte |
| `pnpm test` | Tests unitaris |
| `pnpm test:integration` | Tests amb containers aillats |
| `pnpm test:e2e` | Playwright |
| `pnpm test:visual` | Captures light/dark i locales |
| `pnpm build` | Build reproduible de totes les apps |
| `pnpm check` | Lint + typecheck + tests + build |

Cap script de test utilitza la base de dades manual del desenvolupador.

## Configuracio

1. Copiar valors no secrets des de `.env.example` segons el mecanisme documentat.
2. Generar secrets locals; no reutilitzar staging o produccio.
3. Validacio estricta en arrencar: una variable absent produeix un error accionable.

Fitxers locals `.env*` estan ignorats, excepte `.env.example`. Credencials reals no entren al repositori, captures ni issues.

## Autenticacio local

Better Auth viu a l'API Fastify sota `/api/auth/*`. `pnpm bootstrap:owner` crea l'Owner mitjancant una ordre explicita d'un sol us; no hi ha credencials per defecte hardcoded. Despres de verificar el correu a Mailpit, cal activar TOTP a `/{locale}/security` per accedir a operacions privilegiades.

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
- Cookies no persisteixen: comprovar que el browser entra per `localhost:3000`.
- Reset de dades: utilitzar nomes `pnpm infra:reset`, mai eliminar volums manualment sense revisar el target.
