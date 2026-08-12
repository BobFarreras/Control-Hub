# Estat actual i continuacio

> Aquest fitxer diu **on som, quin es el seguent pas i quines decisions manen ara**. El relat de
> com hi hem arribat es a `docs/development/history/`. Quan un increment queda tancat, mou-hi el
> seu text en el mateix commit — tal qual, sense resumir-lo.

## On som

Fases 0 a 6 implementades, i tambe els increments 0-11 de consolidacio previs a la Fase 6. Tot
integrat a `develop`.

El producte executa web, API i worker en monorepo, amb PostgreSQL, Valkey, Better Auth, tenancy,
RBAC, MFA, CRM, cataleg comercial, serveis contractats pels clients, eines i despeses recurrents
de l'empresa, suport amb tickets i SLA, projectes amb imputacio de temps i barems versionats, i
registre de jornada, i la plataforma de connectors.

Portes de qualitat sobre `develop` ja fusionat: `pnpm check:e2e` passa **25/25** amb dos workers,
base neta i sense reintents, i `pnpm check` sencer —`lint`, `typecheck`, `test`, `build`— tambe.
L'error de `react-hooks/set-state-in-effect` que hi havia a `attendance-record.tsx` va marxar amb
el redisseny de la jornada, que reescriu aquell fitxer.

**Fase 6 fusionada a `develop`** (`464ea5f`). La branca `feature/phase-6-connector-platform` ja
no cal per a res. Res no s'ha empes ni desplegat.

## El seguent pas

**L'increment A4 de la Fase 7.1**: el connector `n8n` — `pull_workflows`, `pull_executions` i
l'entrada de l'error workflow. Amb A3 tancat, la plataforma ja sap programar-lo, executar-lo un
cop alhora i desar el que torni; A4 nomes ha de tocar
`packages/connectors/src/built-in/n8n.ts` i el seu test. Si en algun punt cal tocar `packages/domain`,
`packages/application` o `apps/api`, el que falla es la plataforma i s'arregla alli.

La **Fase 7 esta aprovada i partida en dues entregues**, especificades a
`docs/specifications/infrastructure.md` (aprovada el 12 d'agost de 2026):

- **7.1 — plataforma, n8n i pantalla** (increments A1 a A6), a la branca
  `feature/phase-7-1-infrastructure-n8n`. Entregable tota sola: workflows d'n8n amb el seu estat,
  execucions fallides, associacio amb el client, enllac extern validat i alertes que obren
  incidencia.
- **7.2 — Prometheus, inventari i alertes d'infraestructura** (increments B1 a B4). Depen de la
  7.1: sense magatzem ni programador no te on aterrar.

**Fet fins ara:**

| # | Que hi ha | On |
|---|---|---|
| A1 | La flag `infrastructure` registrada i apagada, i l'especificacio aprovada a l'index | `packages/config/src/flags.ts`, `docs/specifications/infrastructure.md` |
| A2 | G1 tapat: `connector_records` i `connector_operation_state` (`0033`), forma per operacio al manifest, cursor persistit i purga horaria | `packages/database/migrations/0033_connector_records.sql`, `packages/connectors/src/contract.ts`, `packages/application/src/connectors.ts`, `packages/persistence/src/connector-repository.ts`, `apps/worker/src/connectors/` |
| A3 | G2 i G3 tapats: cadencia al manifest amb minim de 60 s, cua `connectors` a part, reconciliador de calendari cada 2 minuts, una execucio alhora per operacio (`0034`) i confinament a la base sota `operator_allowlist` | `packages/connectors/src/contract.ts`, `packages/contracts/src/connector-jobs.ts`, `packages/database/migrations/0034_connector_run_lease.sql`, `packages/persistence/src/connector-repository.ts`, `apps/worker/src/connectors/schedule.ts`, `apps/worker/src/index.ts` |

L'A2 canvia el contracte de connector: **`capabilities.operations` ja no es una llista de noms
sino un registre `{ nom: { shape } }`**, i la forma decideix com caduquen els registres d'aquella
operacio. Els valors de retencio son a `docs/specifications/data-governance.md` i el que ha de
saber qui escriu un connector, a `docs/development/writing-a-connector.md`.

La purga corre cada hora i **deliberadament no mira la flag**: si es tanques amb files ja escrites,
apagar la flag deixaria de fer-les caducar en comptes de deixar d'escriure'n de noves.

L'A3 fa el mateix amb el reconciliador de calendari, i pel mateix motiu: corre cada dos minuts
passi el que passi, i **amb la flag apagada la seva feina es esborrar-los tots**. Una flag que
nomes evites programar de nou deixaria els calendaris antics sondejant proveidors sense cap manera
d'aturar-los que no fos un desplegament. Tambe seu: les operacions no van per la cua `system` sino
per una de propia, `connectors`, amb concurrencia 4, i la migracio `0034` posa un sostre d'una
execucio alhora per `(instancia, operacio)` amb un arrendament de 10 minuts.

**No confondre amb la "Fase 7B - Accions i credencials OAuth"** que hi ha proposada a
`IMPLEMENTATION_PLAN.md`: es una fase diferent i posterior. Per aixo la particio d'aquesta va amb
decimals i no amb lletres.

**Els tres forats de la Fase 6 que la 7.1 ha de tapar**, verificats contra el codi i acceptats pel
propietari — s'arreglen a la plataforma, amb la seva prova, mai al connector:

| # | Que falla | On |
|---|---|---|
| G1 | ~~El runtime compta els `records` d'una operacio i els llenca; el cursor no el desa ningu~~ **Tapat a l'A2** | `apps/worker/src/connectors/runtime.ts` |
| G2 | ~~L'unica operacio que algu encua es el health check: no es pot programar cap altra~~ **Tapat a l'A3** | `apps/worker/src/connectors/schedule.ts`, `apps/worker/src/index.ts` |
| G3 | ~~Amb `operator_allowlist`, `guarded-fetch` no confina a la base configurada~~ **Tapat a l'A3**, i sense base configurada segueix funcionant com abans | `apps/worker/src/connectors/guarded-fetch.ts` |

## La Fase 6, tancada

L'especificacio es a `docs/specifications/connectors.md`, aprovada l'11 d'agost de 2026, i la
decisio criptografica a `docs/adr/0008-connector-credential-vault.md`.

Fets els increments 1 a 10 del pla que tanca l'especificacio:

| # | Que hi ha | On |
|---|---|---|
| 2 | Domini pur: salut derivada, backoff amb jitter, circuit breaker, redaccio | `packages/domain/src/connectors.ts` |
| 3 | Contracte de connector, registre resolt en build-time, webhook generic | `packages/connectors/` |
| 4 | Migracio `0030`, port d'emmagatzematge i adaptador tenant-scoped | `packages/database/migrations/0030_connectors.sql`, `packages/application/src/connectors.ts`, `packages/persistence/src/connector-repository.ts` |
| 5 | Vault: anell de claus versionat, segellat AES-256-GCM i rotacio en dos slots | `packages/config/src/key-ring.ts`, `packages/persistence/src/credential-vault.ts`, `packages/application/src/connector-credentials.ts` |
| 6 | Runtime del worker: `guarded-fetch`, breaker compartit, reintents per cua i registre de cada execucio | `packages/domain/src/egress.ts`, `packages/config/src/egress-allowlist.ts`, `apps/worker/src/connectors/` |
| 7 | API d'integracions darrere el flag `connectors`, problem details i auditoria de les accions i de les denegades | `packages/application/src/connector-instances.ts`, `apps/api/src/problem.ts`, `apps/api/src/routes/integrations.ts` |
| 8 | Ingress: encunyat d'endpoints, verificacio de firma, finestra de replay i inbox idempotent | `packages/application/src/connector-ingress.ts`, `packages/persistence/src/ingress-crypto.ts`, `apps/api/src/routes/webhooks.ts` |
| 9 | Pantalla `/{locale}/integrations` amb `ca`, `es` i `en`: llistat, panell de detall, endpoints i execucions | `apps/web/src/app/[locale]/integrations/page.tsx`, `apps/web/src/components/integrations-workspace.tsx`, `apps/web/src/lib/integrations.ts`, `packages/i18n/src/index.ts` |
| 10 | OpenAPI de la superficie de connectors generada del codi, runbook de rotacio de l'anell i tancament de la fase | `apps/api/src/app.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/openapi.test.ts`, `docs/runbooks/connector-key-rotation.md` |

**Definition of Done de la Fase 6.** Els set criteris d'acceptacio de
`docs/specifications/connectors.md`, i on falla la prova si algu els trenca:

| # | Criteri | On es prova |
|---|---|---|
| 1 | Cap credencial surt per l'API | `apps/api/src/routes/integrations.test.ts` (la resposta s'escriu camp a camp i el test hi posa una fila amb ciphertext i secret a sobre), `packages/persistence/src/credential-vault.test.ts`, `packages/persistence/src/connector-repository.integration.test.ts` |
| 2 | Configuracio invalida rebutjada amb `422` i codi estable | `packages/application/src/connector-instances.test.ts`, `packages/connectors/src/contract.test.ts` |
| 3 | Timeout i rate limit no bloquegen el worker | `apps/worker/src/connectors/job.unit.test.ts` ("never sleeps"), `apps/worker/src/connectors/guarded-fetch.unit.test.ts` |
| 4 | Un retry no duplica efectes | `apps/worker/src/connectors/runtime.unit.test.ts` (redelivery), `packages/application/src/connector-ingress.test.ts` (inbox idempotent) |
| 5 | Un connector fallit no afecta el core | `apps/worker/src/connectors/circuit-store.unit.test.ts`, `apps/api/src/app.test.ts` (la superficie no declarada no toca la resta) |
| 6 | Cap tenant veu res d'un altre | `packages/persistence/src/connector-repository.integration.test.ts`, `packages/application/src/connector-credentials.test.ts` (l'AAD lliga el sobre al tenant que truca, no al que nomena) |
| 7 | `Administrator` rep `403` a tot el que canvia i `200` a llegir | `packages/application/src/connector-instances.test.ts`, `packages/application/src/connector-ingress.test.ts` |

I la porta que no es una prova unitaria: `pnpm check:e2e` passa **25/25** amb dos workers, base
neta i sense reintents, incloent-hi `tests/e2e/integrations.authenticated.spec.ts` — crear una
integracio, veure com la configuracio es refusada en catala amb el cami del camp, activar-la i
demanar-ne una comprovacio de salut que respon `202`.

El merge cap a `develop` es va fer el 12 d'agost de 2026. Les uniques divergencies van ser de
jornada i cataleg, i **hi van guanyar els canvis de `develop`**; nomes el menu lateral es va
fusionar a ma, perque hi conviuen la navegacio nova de jornada i l'entrada d'Integracions. La
migracio de permisos de jornada es va renumerar a `0032` per deixar el `0031` a `develop`.

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

**El que l'increment 6 deixa decidit i no s'ha de tornar a decidir.** Un connector no te cap
altra sortida de xarxa que el `HttpPort` que rep: `guarded-fetch` resol el nom, refusa tota
adreca que no sigui publica — llevat de les que l'operador ha escrit a
`CONNECTOR_INTERNAL_ALLOWLIST`, que cap tenant pot tocar — i **connecta a l'adreca que ha
validat**, fixant-la amb l'opcio `lookup` de Node i `agent: false`, de manera que un canvi de DNS
entre la comprovacio i la connexio no serveix de res. Cada redireccio es torna a validar i, si
canvia d'origen, les capcaleres lligades a l'origen (`authorization`, `cookie`, `x-api-key`) no hi
viatgen. El worker **no dorm mai**: una fallada transitoria acaba la feina i demana a la cua que
la torni amb `moveToDelayed`, perque un worker adormit es una plaça que un proveidor lent ha pres
a tots els altres tenants. L'estat del breaker viu a Valkey, compartit entre repliques i amb TTL;
si Valkey no respon, el breaker deixa passar — una caiguda del cache no pot convertir-se en una
caiguda dels connectors. Un error que ningu ha classificat es tracta com a permanent, per no
reintentar indefinidament un defecte nostre.

**El que l'increment 7 deixa decidit i no s'ha de tornar a decidir.** L'API mai no retorna un
secret perque no en te cap manera d'obtenir-lo: les rutes reben `ConnectorCredentialService`, que
segella i no obre, i `credentialResponse` escriu camp a camp — una columna nova a la taula no pot
arribar a un client pel sol fet d'existir. Tampoc surt el `key_id`. Les regles que un operador pot
trencar viuen a `ConnectorService`, no a la ruta, i per aixo els criteris 2 i 7 es tanquen amb
proves que no obren cap socket: configuracio invalida es `422` amb codi estable i les incidencies
nomes diuen el cami i el codi, mai el valor; un `Administrator` rep `403` a tot el que canvia
alguna cosa i `200` a llegir. Els errors d'aquesta superficie son RFC 9457 amb
`application/problem+json`; la resta de l'API conserva el sobre antic fins que algu la migri a
proposit, i el que comparteixen es el `code`, que es el que la UI tradueix. Els codis segueixen en
UPPER_SNAKE com a tot arreu. Desactivar atura primer i revoca despres, mai al reves. La
comprovacio de salut s'encua i retorna `202`: l'API no parla mai amb un proveidor. I les rutes de
credencials no es declaren si no hi ha anell de claus, tal com anuncia l'avis d'arrencada.

**El que l'increment 8 deixa decidit i no s'ha de tornar a decidir.** Una adreca d'ingress i el
seu secret es donen **un sol cop**, quan es crea l'endpoint, i no hi ha cap ruta que els pugui
tornar a mostrar: el llistat no porta `public_id` i cap objecte de l'API pot obrir el secret. El
que retorna la creacio es el **cami** (`/api/v1/webhooks/<public_id>`), no una URL absoluta,
perque l'unica cosa que l'API sap de la seva propia adreca es una capcalera `Host` que tria qui
truca. Una instancia te **un endpoint viu**, perque el secret de firma viu per instancia i slot;
revocar l'endpoint revoca tambe el secret, en aquest ordre. La verificacio no la fa cap ruta:
`ConnectorIngressService` obre el secret dins seu i respon si la firma quadra, mai amb que — cap
handler de l'API rep mai un `ConnectorSecretReader`. Es proven els dos secrets vius, perque
durant una rotacio la firma pot venir de qualsevol dels dos, i es marca el que ha quadrat. La
finestra de replay son 5 minuts **als dos costats**, el `timestamp` va dins dels bytes signats i
la comparacio es de llargada fixa (es fa el hash dels dos costats abans del `timingSafeEqual`).
**Adreca desconeguda, firma que no quadra i timestamp fora de finestra tenen una sola sortida**,
`ingressAnswer`, que retorna sempre `404 NOT_FOUND`: una funcio, no una branca per cas. L'unica
excepcio es un cos ben signat que el connector no pot llegir — `400`, perque per arribar-hi cal
tenir el nostre secret i qui el te mereix saber que ha enviat. L'exit es `202` amb cos buit, i un
event repetit tambe: la idempotencia la decideix la restriccio unica de `connector_inbox`, amb
l'identificador del proveidor o el `sha256` del cos cru. **El que encara no fa ningu es
processar-los**: els events queden `pending` a la inbox fins que un connector digui que se n'ha
de fer amb ells, i marcar-los `processed` sense que ningu els hagi tocat seria inventar-se una
prova. La ruta publica queda exempta de la comprovacio d'`Origin` perque no llegeix cap cookie ni
resol cap sessio: la firma es l'unica autoritat que hi val.

**El que l'increment 9 deixa decidit i no s'ha de tornar a decidir.** La pantalla no ensenya mai
paraules d'un proveidor ni d'un connector: el que arriba de l'API es un `code` i el que llegeix
una persona es la nostra frase per aquell codi (`errorMessage` a `apps/web/src/lib/integrations.ts`),
amb una frase generica per a un codi que encara ningu ha traduit — un `INSTANCE_NOT_ENABLED` a la
pantalla seria ensenyar les nostres interioritats. L'avis que l'adreca i el secret **nomes es
veuran un cop** va **abans** del boto que els encunya, no al costat del resultat: un avis llegit
despres no es un avis. El secret viu nomes a la memoria del component, no al `query string` ni a
cap `storage`, i el panell va **amb `key` per instancia**, de manera que seleccionar-ne una altra
no arrossega ni una configuracio a mig editar ni un secret encunyat. Qui nomes te
`integrations:read` veu la pantalla sencera sense cap boto que canvii res, i ho diu un avis, no
un boto que falla en clicar-lo. El llistat s'ordena, es filtra i es pagina **a la pagina**, perque
`GET /api/v1/integrations` respon amb totes les instancies del tenant i sense paginacio; el dia
que aquesta llista deixi de cabre en una resposta, el fitxer que ha de canviar es la pagina. La
configuracio es un camp JSON perque es l'unica forma que generalitza a connectors que aquesta
versio encara no porta, i les incidencies es dibuixen amb cami i codi, mai amb el valor escrit.

**El que l'increment 10 deixa decidit i no s'ha de tornar a decidir.** El document d'API es
**genera del codi**, no s'escriu al costat: cada ruta de connectors porta `tags`, `summary` i
`description` al seu propi `schema`, i `apps/api/src/openapi.test.ts` falla si alguna en surt
sense. Cap ruta declara **response schema**, i es una decisio: a Fastify un schema de resposta
tambe es el serialitzador, de manera que un camp que hi falti desapareix de la resposta — un
document que edita silenciosament el que l'API retorna es pitjor que un que la descriu en prosa,
i encara mes a l'unica resposta que porta un secret un sol cop. Les formes viuen a
l'especificacio. El document diu la veritat del desplegament que el genera: sense anell de claus
no hi surten ni credencials, ni endpoints, ni el webhook public, perque en aquell desplegament no
existeixen. La ruta publica d'ingress **si** que es documenta: amagar-la nomes la treu de la
pagina que llegeix qui ha de configurar el proveidor, i la resposta uniforme davant qualsevol
refus es una propietat del handler, no d'una ruta no documentada. El runbook de rotacio es
`docs/runbooks/connector-key-rotation.md`: rotar no reescriu cap fila, perque cada sobre porta el
seu `key_id`, i per tant una fuga **no** es arregla rotant — s'arregla tornant a escriure totes
les credencials i rotant-les tambe al proveidor.

Els increments 1 a 8 no toquen `packages/ui` ni `apps/web/src/components`; el 9 nomes toca
`apps/web` i el diccionari, mai `packages/ui`. Si una altra sessio hi afegeix una migracio abans,
la `0030` de connectors es renumera **abans del merge**, mai despres d'haver-la aplicat enlloc.

El detall i els checks dels increments de consolidacio previs son a
`docs/development/pre-phase-6-product-polish.md`.

## Pendents coneguts, no bloquejants

- Alta d'incidencies i el seu vincle amb tickets: l'esquema hi es, la UI no.
- Pantalla de configuracio de suport (horari, festius, objectius): l'API hi es, la UI no.
- UI de gestio global de festius i bloquejos: nomes hi ha API i domini. La jornada personal ja
  mostra i permet sol·licitar vacances i absencies sobre qualsevol mes de l'any; el calendari
  consulta sempre el rang mensual complet, fins i tot quan no hi ha fitxatges.
- CRM, productes i subscripcions no tenen encara proves E2E amb sessio iniciada, tot i que la
  infraestructura ja hi es.
- `db:seed:dev` no sembra projectes ni imputacions, aixi que la pantalla de projectes surt buida
  en un entorn local acabat de sembrar.
- Les migracions `0025` i `0026` s'han de pujar a la base de dades de produccio.
- El desplegable del sistema visual (`SelectControl`) es un boto amb `aria-haspopup="listbox"`
  i un `<select>` amagat al costat: **cap element respon al rol `combobox`**, i a la fitxa d'un
  ticket el camp nomes te nom accessible perque hi porta un `aria-label` a ma. Funciona i es
  navegable amb teclat, pero el patro ARIA d'un desplegable d'aquest tipus vol
  `role="combobox"` al boto. Afegir-l'hi obliga a repassar els localitzadors de tres suites E2E
  a la vegada, aixi que es una feina propia, no un afegit a una altra.
- L'entrada **Infraestructura** del menu lateral segueix sent un `href="#"` que no porta enlloc
  (`apps/web/src/components/app-sidebar.tsx`). **Ja te especificacio aprovada**
  (`docs/specifications/infrastructure.md`) i la pantalla arriba a l'increment A6; fins llavors es
  queda com esta. No s'ha de confondre amb **Integracions**, que si que existeix i viu darrere el
  flag `connectors`.

## Feature flags

Registre a `packages/config/src/flags.ts`; s'activen amb `CONTROL_HUB_FLAGS`.

- `projects_and_time` — apagada, l'API no declara les rutes i la web no mostra ni el menu ni les
  pantalles. `/{locale}/projects` respon 404.
- `attendance` — apagada per defecte fins que la gestoria confirmi que la forma del registre li
  serveix.
- `connectors` — apagada per defecte. Amb la bandera tancada l'API no declara cap ruta
  d'integracions ni de webhooks, la web no mostra l'entrada del menu i `/{locale}/integrations`
  respon 404. Obrir-la sense `CONNECTOR_KEY_RING` deixa la pantalla en peu pero sense credencials
  ni endpoints: aquelles rutes no existeixen en aquell desplegament.
- `infrastructure` — apagada per defecte, registrada a l'increment A1 de la Fase 7.1. Des de
  l'A3 ja mana sobre alguna cosa: **apagada, el reconciliador esborra tots els calendaris de
  connector de Valkey i no en programa cap**. Encara no hi ha ni ruta ni pantalla; quan n'hi hagi,
  tancada voldra dir tambe cap ruta declarada, cap entrada al menu i `/{locale}/infrastructure`
  responent 404.

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
- `PageTopbar` centralitza el retorn contextual: conserva la traça interna de la pestanya i cau
  al pare funcional si una pantalla s'ha obert directament. El dashboard es l'arrel i no mostra
  retorn; les pantalles no dupliquen enllacos de retorn al contingut ni a les accions.
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
- Jornada separa Calendari, Registre i Equip (aquest darrer nomes amb `attendance:manage`). Les
  taules de dies, moviments i equip reutilitzen `SmartDataTable`, amb ordre recent-primer,
  filtres, paginacio i configuracio de columnes.
- El cataleg de productes reutilitza `SmartDataTable` i porta la gestio comercial a la fitxa
  del producte. La identitat del producte es estable; funcionalitats, contingut, esquema i
  notes pertanyen a la versio. Els recursos son enllacos HTTPS tipats i el codi es referencia
  com a repositori, no es desa com un blob. La fitxa deriva els clients contractats dels
  `customer_services` i explica la jerarquia versio -> pla -> preu immutable.

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
- `0031_product_knowledge.sql`: coneixement versionat del producte i recursos externs tipats,
  amb claus foranes tenant-scoped, RLS i validacio que la versio vinculada pertany al producte.
  `0030` queda reservada per la plataforma de connectors desenvolupada en paral.lel.
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
