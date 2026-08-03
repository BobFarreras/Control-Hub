# Auditoria prèvia a la Fase 5

Data: 2026-08-03. Branca: `audit/session-phase-5-review`. Base: `develop` (`57b44aa`).

Auditoria de bones pràctiques, seguretat i cobertura funcional feta abans d'obrir la Fase 5.
No s'ha modificat codi: aquest document només registra troballes i propostes.

## Estat de les correccions

Corregides en aquesta branca (bloc A): troballes 1, 2, 3, 4 i 10. La resta segueixen obertes.

## Estat verificat

Fases 0-4 implementades i coherents amb la documentació. La branca
`feature/phase-5-support-tickets-sla` existeix però està buida (idèntica a `develop`):
la Fase 5 encara no ha començat.

## El que està ben fet i no s'ha de tocar

- **Aïllament de tenant real.** RLS amb `force row level security` a totes les taules de
  negoci, i el runtime connecta amb `control_hub_app` (`nosuperuser`, `noinherit`,
  sense `bypassrls`), separat de `control_hub_admin` que executa migracions. Això és
  l'aproximació correcta, no la típica de confiar només en el `where tenant_id`.
- **Camins pre-auth ben aïllats.** `lookup_member_invitation` i `accept_member_invitation`
  són funcions a la base de dades; l'API no fa consultes creuades de tenant a mà.
- **Tokens d'invitació** guardats com a hash SHA-256, mai en clar.
- **Aritmètica monetària amb `BigInt`** i detecció d'overflow a `packages/domain`. Cap
  càlcul de MRR/ARR/marge amb coma flotant.
- **Escapat d'injecció CSV** a `stringifyCsv` (prefix `'` davant de `= + - @`).
- **CSRF per validació d'`Origin`** a totes les mutacions, i rebuig si hi ha cookie sense origin.
- **Cap secret al repositori.** `.gitignore` correcte i gitleaks a CI.
- **Redacció de logs** (cookie, authorization, password, token, secret).

## Troballes

### 1. ALTA — El rate limit tomba l'aplicació sencera en producció

`apps/web` no parla amb l'API des del navegador en les càrregues de pàgina: cada render de
servidor fa `fetch` directe cap a `API_INTERNAL_URL` passant només la capçalera `cookie`
(`apps/web/src/lib/require-session.ts:11`, `apps/web/src/app/[locale]/crm/page.tsx:14`,
`apps/web/src/lib/commerce-data.ts:5`, i 2 pàgines més).

Aquests `fetch` **no envien `x-forwarded-for`**. Amb `trustProxy: true`, Fastify cau al
socket, o sigui la IP del contenidor web. Conseqüència: **tot el trànsit servidor→API de
tots els usuaris comparteix una sola clau de rate limit**.

- `/api/auth/*` està limitat a **10 peticions/minut** (`apps/api/src/app.ts:90`) i
  `requireSession` el crida **a cada render de pàgina** (15 punts de crida).
- El límit global és 120/min amb `ban: 3` (`apps/api/src/app.ts:57`). Una càrrega de
  `/crm` consumeix 6 peticions (session + 2 preferències + leads + customers + summary).

Resultat pràctic: ~10 navegacions/minut per a **tota l'empresa** abans del primer `429`, i
després de 3 excessos `ban: 3` retorna `403` i deixa l'app inaccessible fins que expira.

Correcció: propagar `x-forwarded-for` als `fetch` de servidor i excloure la xarxa interna
del rate limit (`allowList`), o aplicar el límit per usuari en comptes de per IP.

### 2. ALTA — CI dona verd sense executar cap test d'aïllament de tenant

`.github/workflows/ci.yml` executa `pnpm test:integration`, però el job només aixeca un
servei `valkey`. **No hi ha PostgreSQL i no es defineixen `TEST_DATABASE_URL` ni
`TEST_DATABASE_ADMIN_URL`.** Els tres tests d'integració es salten sols:

```
packages/database/src/tenancy.integration.test.ts:7
apps/api/src/crm-repository.integration.test.ts:9
apps/api/src/commerce-repository.integration.test.ts:9
  const suite = databaseUrl && adminUrl ? describe : describe.skip;
```

Són exactament els tests que demostren el criteri de sortida de la Fase 2 ("un tenant no pot
llegir ni modificar dades d'un altre"). Ara mateix **la frontera de seguretat del producte no
està verificada per cap pipeline**, i un canvi que trenqui l'RLS passaria a `main` amb CI verd.

Correcció: afegir el servei `postgres` al job i les dues variables. Sense això, la Fase 5
construirà tickets sobre una garantia que ningú comprova.

### 3. MITJANA-ALTA — L'app web no serveix cap capçalera de seguretat

`helmet` només està registrat a l'API, que retorna JSON. La superfície que obre el navegador
és `apps/web`, i `next.config.ts` només posa `poweredByHeader: false`. No hi ha
`middleware.ts` ni `headers()`. Per tant: **cap CSP, cap HSTS, cap `X-Frame-Options`, cap
`Referrer-Policy`** a les pàgines reals.

A més `helmet` s'ha registrat amb `contentSecurityPolicy: false` (`app.ts:56`).

La Fase 2 declarava "headers de seguretat" com a entregable. Està a mitges.

### 4. MITJANA — La documentació OpenAPI és pública

Swagger UI es registra a `/api/docs` sense cap guarda d'autenticació (`app.ts:59`), i
`next.config.ts` reescriu `/api/:path*` cap a l'API. Qualsevol persona a internet pot
enumerar tota la superfície de l'API, incloent-hi rutes administratives i esquemes de cos.

Correcció: no registrar swagger-ui quan `NODE_ENV === "production"`, o exigir-hi sessió.

### 5. MITJANA — Rate limit en memòria tot i tenir Redis

`@fastify/rate-limit` es registra sense `redis`, tot i que ja hi ha una connexió Valkey al
mateix fitxer. Els límits es perden a cada reinici i no es comparteixen entre rèpliques,
cosa que trenca la protecció de força bruta contra `/api/auth/*` en quant s'escali.

### 6. MITJANA — Dependabot no cobreix npm ni Docker

`.github/dependabot.yml` només vigila `github-actions`. La Fase 1 deia explícitament
"Dependabot per npm i Docker quan existeixin els manifests corresponents"; `package.json`,
`pnpm-lock.yaml` i els Dockerfiles ja existeixen des de fa quatre fases.

### 7. MITJANA — No hi ha anàlisi de vulnerabilitats ni E2E a CI

L'única comprovació de seguretat automatitzada és gitleaks (secrets). No hi ha CodeQL/SAST,
ni `pnpm audit`/OSV per a CVEs de dependències. `playwright.config.ts` i `pnpm test:e2e`
existeixen però CI no els executa mai. Les accions tampoc estan fixades per SHA.

### 8. MITJANA — Densitat de codi que impedeix la revisió

`apps/api/src/app.ts` són 251 línies però conté ~40 rutes; hi ha línies de més de 800
caràcters amb esquema, permís, servei, auditoria i resposta encadenats
(p. ex. `app.ts:139`, `crm/page.tsx:31`).

La causa d'arrel és que **no hi ha cap linter al projecte**. No existeix cap fitxer de
configuració d'ESLint ni cap dependència d'ESLint enlloc; el script `lint` de tots els
workspaces és literalment `tsc -p tsconfig.json --noEmit`, és a dir un duplicat exacte de
`typecheck`. Per tant no hi ha regla de longitud, ni d'ordre d'imports, ni la restricció de
dependències entre mòduls que `docs/specifications/engineering-conventions.md` dona per
feta ("Imports inversos o entre internals de moduls queden bloquejats per lint"), ni el que
la Fase 1 declarava com a entregable ("Activar TypeScript estricte, ESLint, format i imports
controlats"). CI executa `pnpm lint` i passa, però no comprova res que `typecheck` no faci ja.

Això no és estètica: un `requirePermission` que falti enmig d'una línia de 800 caràcters no
es veu en una revisió, i és precisament el patró que la Fase 5 multiplicarà. És el risc de
manteniment més gran del projecte i el moment de corregir-lo és **abans** d'afegir el mòdul
de tickets, no després.

Proposta: instal·lar ESLint de debò (amb `max-len`, ordre d'imports i límits de dependència
entre paquets) i partir `app.ts` en routers per domini (`routes/crm.ts`, `routes/commerce.ts`, ...).

### 9. BAIXA — MFA obligatòria a tot arreu, però amb forats

`requirePermission` llança `MFA_REQUIRED` per a **qualsevol** permís, també de lectura
(`security.ts:37`). La Fase 2 deia "MFA per comptes privilegiats". Alhora, les rutes que
només criden `resolveTenantContext` sense `requirePermission` (`/api/v1/me`,
`/api/v1/sessions`, `/api/v1/table-preferences/*`) **no passen pel gate d'MFA**. La política
efectiva no coincideix amb cap de les dues opcions documentades: cal decidir-la i aplicar-la
en un sol lloc.

### 10. BAIXA — `requireSession` funciona per casualitat

```ts
try { ... redirect(`/${locale}/login`); }   // llança NEXT_REDIRECT
catch { redirect(`/${locale}/login`); }      // el captura i redirigeix igual
```

`redirect()` de Next funciona llançant una excepció, que el `catch` empassa. Ara coincideix
la destinació, així que el comportament és correcte; el dia que algú canviï una de les dues
rutes, deixarà de ser-ho silenciosament.

### 11. BAIXA — Observabilitat limitada a logs

`packages/observability` són 10 línies: només un logger pino. No hi ha traces
OpenTelemetry ni endpoint de mètriques. És suficient avui, però la Fase 7 (dashboard
d'infraestructura i n8n) demanarà mètriques pròpies i ara no hi ha on posar-les.

### 12. BAIXA — Detalls

- L'exportació CSV de leads talla a `pageSize: 10000` sense avisar (`app.ts:205`).
- El rol `technical` té `security:manage` i `credentials:rotate`, que `administrator` no té.
  Probablement és intencionat (perfil tècnic vs. comercial), però convé confirmar-ho.
- Deu fitxers `.tmp-*.log` a l'arrel del projecte; estan ignorats però embruten el directori.
- CI no fixa la versió de Node (`actions/setup-node`) ni cacheja l'store de pnpm.

## Funcionalitat que falta

### Buit detectat dins del propi codi

El permís **`projects:manage` existeix** a `packages/domain/src/index.ts:3` i està assignat a
tots tres rols, però **no hi ha cap mòdul de projectes** ni a la implementació ni a cap de les
deu fases del pla. Per a una empresa que ven "automatitzacions, webs i software a mida", el
projecte és la unitat de treball central. És el buit més gran del roadmap actual.

### El que tenen les plataformes equivalents i aquí no hi és

Comparat amb el que ofereixen les eines del sector (HaloPSA, Syncro, Atera per la banda MSP;
Productive.io, Harvest, Plutio per la banda agència):

| Capacitat | Estat a Control Hub | Per què importa aquí |
| --- | --- | --- |
| **Temps i hores facturables** | No existeix | Sense això no es pot saber si un client a preu tancat dona pèrdues. És la mètrica que falta per completar el marge de la Fase 8. |
| **Projectes i entregues** | Permís sí, mòdul no | Unitat de treball real de l'empresa |
| **Pressupostos → factures** | No existeix | Ara mateix el cicle comercial s'atura al lead guanyat |
| **Facturació electrònica (Verifactu / TicketBAI)** | No contemplat | Obligació normativa a l'estat espanyol; cal comprovar el calendari aplicable a l'empresa abans de dissenyar el mòdul de factures |
| **Monitoratge d'uptime dels webs del client** | Parcial a Fase 7 (VPS pròpia) | Els clients tenen webs fora de la vostra VPS |
| **Caducitat de dominis i certificats SSL** | Esmentat a Fase 7 | Alt valor, cost baix |
| **Vault de credencials per client** | Fase 6 (només connectors) | Els tècnics necessiten accessos de client, no només d'integracions |
| **Base de coneixement / runbooks per client** | No existeix | Redueix la dependència d'una sola persona |
| **Càrrega i capacitat de l'equip** | No existeix | Decidir si es pot acceptar un client més |
| **Documents i signatura electrònica** | No existeix | Contractes i acceptació de pressupostos |

### Funcions amb Claude que encaixen amb el que ja teniu

La Fase 10 ja preveu un servidor MCP, que és la peça correcta i la més valuosa: exposa el
Hub com a eines perquè Claude Code hi consulti i hi actuï amb els mateixos permisos.

Afegits que aprofiten infraestructura que ja existeix:

- **Triatge automàtic de tickets** (Fase 5): classificar prioritat, categoria i client a
  partir del text entrant. Encaixa amb "preparació de canals entrants" que ja és a la fase.
- **Errors d'n8n → incidència en llenguatge planer** (Fase 7): convertir un stack trace
  d'execució fallida en una explicació i una acció proposada.
- **Resum setmanal per client**: activitat, tickets, consum i renovacions properes.
- **Consulta en llenguatge natural** sobre el Hub, reutilitzant les tools MCP de lectura.
- **Esborrany de resposta a ticket** amb context del client, sempre amb revisió humana.

El registre de cost per model i tokens de la Fase 8 hauria de cobrir aquests usos interns
des del principi, no només el consum dels clients.

## Què s'ha canviat al bloc A i què hi queda pendent

### Troballa 1 — rate limit

- `apps/web/src/lib/api.ts` (nou): tots els `fetch` de servidor passen per `apiFetch`, que
  propaga `x-forwarded-for` i `user-agent` de la petició entrant. Abans cada pàgina construïa
  la capçalera `cookie` a mà i no reenviava res més; ara hi ha un sol lloc on mirar-ho.
- L'API deixa de limitar només per adreça: `rateLimitKey` fa servir un hash del token de
  sessió quan n'hi ha, de manera que cada usuari té el seu pressupost encara que tot el
  trànsit surti del mateix contenidor. El token mai s'usa en clar com a clau del magatzem.
- Els camins de credencials (`sign-in`, `sign-up`, `forget-password`, `reset-password`,
  `two-factor`, `passkey`) es limiten **estrictament per adreça**, ignorant la cookie: si es
  poguessin limitar per cookie, rotar-ne una de falsa donaria un pressupost nou a cada intent.
  Es queden a 10/min amb `ban: 20`; la resta de `/api/auth/*`, inclòs `get-session`, puja a 240/min.
- El `ban: 3` global desapareix i el límit global puja a 300/min. Un ban sobre trànsit de
  lectura deixa l'usuari fora del producte sencer, que és precisament l'avaria que es volia evitar.

**Risc residual acceptat:** una petició anònima que roti cookies de sessió inventades pot
obtenir un pressupost nou per cada cookie i superar el límit global de 300/min en rutes que no
són de credencials. Aquestes rutes responen `401` de seguida, i la protecció volumètrica
correspon al proxy del davant (Traefik), no a l'aplicació. Tampoc s'ha tocat `trustProxy: true`,
que segueix confiant en qualsevol `x-forwarded-for`: convé fixar-lo al nombre real de salts
quan es defineixi el desplegament definitiu.

### Troballa 2 — CI

- El job `application` aixeca `postgres:17-alpine`, crea el rol `control_hub_app` amb els
  mateixos atributs que a producció i aplica les migracions abans de cap suite.
- Les quatre suites que depenien de la base de dades ara s'executen: **20 tests, cap saltat**
  (verificat localment contra PostgreSQL 17 sobre una base exclusiva de test).
- Perquè això no torni a passar en silenci, els quatre fitxers afectats llancen un error si
  `CI` està definida i falten `TEST_DATABASE_URL` o `TEST_DATABASE_ADMIN_URL`. En local se
  segueixen saltant sense fer soroll.

### Troballes 3 i 4 — capçaleres i documentació

- `apps/web/next.config.ts` serveix CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
  `Permissions-Policy` i, només en producció, `Strict-Transport-Security`.
- Swagger UI només es registra si `exposeApiDocs` és cert, i `server.ts` només ho activa fora
  de producció. L'especificació OpenAPI se segueix generant. Cobert per test.

**Pendent:** el `script-src` encara necessita `unsafe-inline` perquè l'App Router injecta
scripts en línia i aquí ningú genera un nonce per petició. Passar a CSP amb nonce demana un
`middleware.ts` que segelli cada resposta; és una feina pròpia, no un ajust d'aquesta.

### Troballa 10 — `requireSession`

`redirect()` ja no queda dins del `try`, així que l'excepció `NEXT_REDIRECT` no la captura
el `catch`. El resultat visible és el mateix; la diferència és que ara deixarà de funcionar
si algú canvia la destinació, en comptes de fer-ho en silenci.

## Recomanació d'ordre

Abans d'obrir la Fase 5:

1. Troballa 2 (Postgres a CI). Sense això, res del que es validi és fiable.
2. Troballa 1 (rate limit). És un tall de servei en producció, no una hipòtesi.
3. Troballa 8 (densitat de codi) i partició d'`app.ts`. Fer-ho ara costa un dia; fer-ho
   després de tickets, SLA i escalats costa una setmana.
4. Troballes 3 i 4 (capçaleres web, swagger públic). Canvis petits, tancats.

Decisió pendent del propietari: si **Projectes i temps** entra com a fase pròpia abans de la
Fase 5, o si es manté l'ordre del pla i s'afegeix com a Fase 5-bis més endavant.
