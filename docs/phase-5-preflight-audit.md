# Auditoria prèvia a la Fase 5

Data: 2026-08-03. Branca: `audit/session-phase-5-review`. Base: `develop` (`57b44aa`).

Auditoria de bones pràctiques, seguretat i cobertura funcional feta abans d'obrir la Fase 5.
No s'ha modificat codi: aquest document només registra troballes i propostes.

## Estat de les correccions

| Bloc | Troballes | Estat |
| --- | --- | --- |
| A | 1, 2, 3, 4, 10 | Corregides |
| B | 8 (linter i densitat) | Corregida |
| C | 5, 6, 7, 9, 11, 12 | Corregides |

Totes les troballes d'aquesta auditoria estan tancades. El que queda obert son els
tres punts anotats mes avall com a "pendent": CSP amb nonce, `trustProxy` fixat al nombre
real de salts, i les baselines visuals per a Linux.

### Troballa 13 (nova) — el rate limit no s'havia aplicat mai

Trobada mentre es corregia la 5. `@fastify/rate-limit` s'enganxa a les rutes a traves del
hook `onRoute`, que es de temps de construccio. `buildApp` declarava totes les rutes abans
que el plugin acabes de carregar-se, aixi que el hook no en veia cap: **el limitador no
governava res des del primer dia**. Els hooks de peticio de `helmet` no depenen d'aquest
ordre, i per aixo la mancanca era invisible — les capceleres de seguretat arribaven i els
pressupostos no.

Aixo vol dir que la troballa 1 era, de fet, mes greu del que deia: no hi havia cap limit
efectiu sobre `/api/auth/*`, ni per adreca ni per sessio.

Correccio: les rutes es declaren dins d'`app.after()`, i dos tests comproven el pressupost
anunciat (`x-ratelimit-limit`) en una ruta ordinaria i en una de credencials. Comptar rebutjos
no serveix com a prova: amb `skipOnError` el test passaria igualment sense cap limitador.

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

## Què s'ha canviat al bloc B

### Eina

- ESLint 9 amb una sola configuració plana a l'arrel, amb regles amb informació de tipus,
  ordre d'imports i `no-restricted-imports` que codifica les capes
  `domain -> application -> adapters` que `engineering-conventions.md` descrivia sense que
  res les fes complir.
- Prettier és qui mana en el format; `eslint-config-prettier` apaga les regles que hi
  competirien. És això el que fa impossible tornar a tenir una línia de 800 caràcters.
- Els scripts `lint` duplicats de cada workspace desapareixen, igual que la tasca `lint` de
  turbo. `pnpm lint` i `pnpm format` s'executen un sol cop des de l'arrel, i CI hi afegeix
  `format:check`.
- Reformatat mecànic de 117 fitxers, incloent-hi els `package.json`, que estaven minificats
  en una sola línia.

### Defectes que va trobar el linter

Dels 146 problemes que van requerir criteri, aquests eren errors, no estil:

- `sendResetPassword` i `sendVerificationEmail` descartaven la promesa amb `void`: un correu
  de restabliment que no sortia mai era indistingible d'un que arribava.
- Els handlers asíncrons anaven directes a `onClick`/`onSubmit`. Una petició fallida es
  convertia en un rebuig no gestionat: el `catch` que havia de mostrar l'error no s'executava
  i els indicadors de "carregant" es quedaven encesos. Ara passen per `eventHandler` i
  `actionHandler`, que lliguen el rebuig a l'estat d'error del component.
- Dos components client llegien `Date.now()` mentre renderitzaven, de manera que el marcatge
  del servidor i el primer render del client comparaven contra rellotges diferents. L'instant
  es captura ara amb les dades.
- Tres components actualitzaven estat dins d'un efecte per seguir una prop o el muntatge, i
  cadascun costava un render extra.
- `FormData.get` retorna `string | File | null`, i `String()` sobre això enviava el text
  literal `[object File]` a l'API com si fos un valor.
- **Tot el que retornava l'API entrava al web com a `any`**: un camp reanomenat no produïa
  cap error, només `undefined` a la pantalla. `lib/api-types.ts` declara ara els contractes i
  `readJson` és l'únic punt on una càrrega rep un tipus.

Quan una regla s'ha limitat en comptes d'obeir-se, s'ha limitat estretament i amb motiu:
`console` a les ordres d'operador, `unbound-method` per als espies de vitest.

### Partició d'`app.ts`

De 1271 línies a 164. Els handlers viuen ara a `apps/api/src/routes/`, un mòdul per domini,
i cap passa de 400 línies. `app.ts` queda com a arrel de composició. També se n'han extret
les peces compartides: `rate-limit`, `request-headers`, `table-columns`, `invitation-message`
i `server-instance`, aquest últim perquè el tipus de la instància Fastify es pugui compartir
sense crear un cicle.

S'hi ha afegit un test que comprova que les 43 rutes segueixen registrades. Un `tsc` no pot
detectar aquest refactor si surt malament, perquè esborrar una crida a `register...Routes`
segueix compilant.

## Què s'ha canviat al bloc C

- **5.** Els comptadors viuen a Valkey amb el prefix `control-hub:rate-limit:`. El client del
  limitador es connecta de manera immediata i conserva la cua offline: amb `lazyConnect` i
  `enableOfflineQueue: false` totes les escriptures es rebutjaven abans d'existir la connexio
  i `skipOnError` se les empassava, que es un limitador que no fa res. Verificat en calent.
- **6.** Dependabot cobreix `npm` (arrel del workspace, que es on viu el lockfile) i `docker`
  (`/deploy`), amb minor i patch agrupats en una sola PR.
- **7.** CodeQL amb `security-extended`, auditoria de dependencies que falla amb severitat
  alta, i la suite E2E funcional a CI. Totes les accions fixades per SHA de commit amb la
  versio anotada al costat. Node fixat i store de pnpm cachejat.
- **9.** El segon factor s'exigeix a `resolveTenantContext`. Vegeu la seccio corresponent a
  `SECURITY_ARCHITECTURE.md`.
- **11.** `GET /metrics` en format Prometheus, fora de la superficie que el web reenvia.
  Inclou metriques per defecte de Node i histograma de durada per patro de ruta.
- **12.** L'exportacio CSV pagina fins al final en comptes de tallar a 10000 files.

**Pendent:** les baselines visuals de Playwright estan generades a Windows (`-win32`), de
manera que la suite `@visual` no s'executa a CI. Perque hi corri cal generar-ne de Linux dins
d'un contenidor.

## Mida de les imatges de contenidor

Cada servei te ara la seva propia etapa de runtime. Abans n'hi havia una de sola i les quatre
imatges eren identiques, de manera que l'API i el worker portaven Next.js i els seus binaris de
plataforma: 417 MB per a serveis que no l'importen mai.

| Imatge | Abans | Ara |
| --- | --- | --- |
| api | 2,96 GB | 1,17 GB |
| worker | 2,96 GB | 258 MB |
| web | 2,96 GB | 255 MB |
| migrate | 2,96 GB | 227 MB |

Total desplegat: de 11,8 GB a 1,9 GB.

**Pendent: l'API encara es molt mes gran que la seva propia clausura de dependencies.** El codi
que executa son 324 kB i el seu `node_modules` en fa 700, dels quals 417 son Next.js. La causa
es que `pnpm deploy` copia mes magatzem virtual del que el filtre indica.

Intent descartat, documentat perque no es repeteixi: `turbo prune` per servei mes
`pnpm install --prod` des del lockfile podat. La poda dels importers es correcta, pero el
lockfile resultant segueix arrossegant els mateixos paquets, i sobretot **el resultat no
arrenca**: pnpm posa les dependencies de cada projecte dins del seu directori i les enllaça a
un magatzem compartit, i aquests enllaços no sobreviuen a ser copiats a una altra ruta. Per
aixo el runtime necessita l'arbre aplanat que produeix `pnpm deploy`.

La via que queda per provar es `inject-workspace-packages`, que fa funcionar el `pnpm deploy`
modern, a canvi que els paquets del workspace es copiin en comptes d'enllaçar-se. Aixo
degradaria el bucle de desenvolupament, i per aixo no s'ha fet sense decidir-ho abans.

## Recomanació d'ordre

Abans d'obrir la Fase 5:

1. Troballa 2 (Postgres a CI). Sense això, res del que es validi és fiable.
2. Troballa 1 (rate limit). És un tall de servei en producció, no una hipòtesi.
3. Troballa 8 (densitat de codi) i partició d'`app.ts`. Fer-ho ara costa un dia; fer-ho
   després de tickets, SLA i escalats costa una setmana.
4. Troballes 3 i 4 (capçaleres web, swagger públic). Canvis petits, tancats.

Decisió pendent del propietari: si **Projectes i temps** entra com a fase pròpia abans de la
Fase 5, o si es manté l'ordre del pla i s'afegeix com a Fase 5-bis més endavant.
