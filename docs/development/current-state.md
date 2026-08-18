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

Portes de qualitat sobre `develop` ja fusionat: `pnpm check:e2e` passa **27/27** amb dos workers,
base neta i sense reintents, i `pnpm check` sencer —`lint`, `format:check`, `typecheck`, `test`
(**609 proves**), `build`— tambe, sobre tretze paquets. L'error de
`react-hooks/set-state-in-effect` que hi havia a `attendance-record.tsx` va marxar amb el
redisseny de la jornada, que reescriu aquell fitxer.

**Les portes de `develop` han passat de dues a vuit** el 16 d'agost de 2026. Fins llavors nomes
`Repository standards` i `Application checks` eren obligatories, i les altres sis —les dues
suites end to end, la imatge de contenidor, gitleaks, `pnpm audit` i CodeQL— corrien pero no
aturaven res. Amb Dependabot obrint propostes cada setmana, aixo volia dir que una que trencava
la imatge complia les regles. Els minor i els patch ara es fusionen sols quan les vuit passen;
els major no, mai. El procediment i el que costa son a `BRANCHING.md`.

**La tanda de majors pendents esta tancada** el 18 d'agost de 2026, abans de comencar la 7.2 i
no durant. Cadascun ha anat sol a la seva branca i s'ha exercitat a ma alli on `BRANCHING.md` ho
demana. Els quatre que canvien alguna cosa mes que un numero:

- **Node 26 a les imatges.** Node 25 va treure corepack de la distribucio, aixi que el
  `deploy/Dockerfile` ja no l'encen: instal·la el pnpm que diu `packageManager`, amb
  `--ignore-scripts` perque una etapa de build no es lloc per executar scripts de tercers.
- **TypeScript 6.** Ha deixat d'incloure sol els paquets `@types/*`, cosa que va deixar
  trenta-nou errors de `Buffer`, `process` i `NodeJS` a la vista. `tsconfig.base.json` ara
  anomena `"types": ["node"]`: el que es ambient passa a ser una decisio en comptes d'un efecte
  secundari del que hi hagi instal·lat.
- **BullMQ 6 amb ioredis 6.** Nomes a partir del 6 l'ioredis es un peer i no una dependencia
  imbricada, o sigui que aquest es el punt on la cua parla RESP3 amb el nostre client i no amb
  un ioredis 5 amagat a dins. El reconciliador ja estava escrit contra Job Schedulers, que es
  el que va salvar-lo de l'API de repetibles que el 6 elimina.
- **`github/codeql-action` en un sol commit.** Dependabot el parteix en dos perque tracta `init`
  i `analyze` com dues accions; CodeQL no ho fa i `analyze` es nega a llegir una configuracio
  escrita per una altra versio. Cap de les dues propostes podia anar primera.

No queda cap proposta de Dependabot oberta.

**Fase 6 fusionada a `develop`** (`464ea5f`) i **fase 7.1 tambe** (`7cc853b`). Les branques
`feature/phase-6-connector-platform` i `feature/phase-7-1-infrastructure-n8n` ja no calen per a
res.

**Publicada la `v0.2.0`** el 16 d'agost de 2026: `main` anava cinquanta-un commits i dues fases
enrere, i ara hi es al dia amb el tag signat (`3a03a62`). **Publicar no encen res**: `connectors`
i `infrastructure` segueixen darrere la seva flag, apagades, i amb la flag tancada les rutes no
es declaren. **No s'ha desplegat res enlloc**; la release es un tag, no una instal·lacio.

La comparacio contra un `main` tan endarrerit va fer que dues portes miressin historial que les
propostes cap a `develop` no havien mirat mai, i van sortir tres coses. Gitleaks va parar en un
fixture de proves, resolt amb el fingerprint historic tal com ja prescrivia
`troubleshooting.md`. CodeQL en va marcar dues d'altes: una assercio de test que comprovava un
prefix en comptes de l'adreca sencera —i que per tant hauria passat amb
`n8n.internal.example.evil.test`, exactament el cas que el fitxer existeix per refusar—, i el
mapa de capcaleres del `guarded-fetch`, que ara es sense prototip perque el nom d'una capcalera
el tria qui hi ha a l'altra punta del socket.

## El seguent pas

**L'entrega 7.2**, que comenca per l'increment B1. La 7.1 esta tancada: la planificada (A1-A6),
els A7-A9 que van sortir d'usar-la, i el merge a `develop` amb els dos gates en verd.

El xoc de numeracio que l'A9b va provocar ja esta resolt al pla: l'A9b-1 va gastar la `0036` per
al permis d'esborrat, aixi que **l'inventari de hosts del B2 es la `0037`**, renumerat a
`infrastructure.md` abans de comencar-lo i no despres d'aplicar-lo. A `develop` les migracions van
de la `0001` a la `0036` sense cap numero repetit.

**Les dues flags segueixen tancades.** Fusionar no encen res: sense `connectors` ni
`infrastructure` declarades, cap de les dues rutes existeix i el modul respon 404. Encendre-les es
una decisio a part, que ningu ha pres.

Tot fusionat a `develop` des de `feature/phase-7-1-infrastructure-n8n`, en vint-i-un commits amb
`--no-ff` per no aixafar els increments en un de sol. La 7.1 planificada —A1 a A6— hi es
sencera, amb la pantalla `/{locale}/infrastructure` i el runbook de l'error workflow d'n8n. Els
increments **A7 a A9** no eren al pla: surten d'usar el producte de debo un cop l'n8n va quedar
connectat, i tots toquen la pantalla d'integracions, per aixo el que decideixen queda documentat
a la seccio de la Fase 6 i no en aquesta taula. **La integracio d'n8n funciona en real**: el
connector s'activa, la comprovacio de salut passa i a Infraestructura es veuen els automatismes
de la instancia.

A5 i A6 han anat en dos commits cadascun **a proposit**: un de sol amb migracio, domini,
aplicacio, persistencia, API i worker no el pot revisar ningu, i el mateix val per un que barregi
el constructor d'enllac amb la pantalla sencera. Cadascun passa `pnpm check` pel seu compte.

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
| A4 | Connector `n8n`: `pull_workflows` i `pull_executions` amb marca d'aigua, salut autenticada i entrada de l'error workflow signada. Del que n8n dona se'n desa una projeccio, mai el cos | `packages/connectors/src/built-in/n8n.ts` i el seu test |
| A5 (1/2) | Migracio `0035` (`infra_automation_links`, `infra_alert_rules`, `infra_alert_events` amb l'index unic parcial i la purga de resoltes) i el motor de veredictes pur: `firing`, `resolved` i `starved` | `packages/database/migrations/0035_infrastructure_automations.sql`, `packages/domain/src/infrastructure.ts` |
| A5 (2/2) | Casos d'us i motor d'alertes (`InfrastructureService` i `AlertEngine`), adaptador PostgreSQL, la superficie `/api/v1/infrastructure` darrere la flag amb problem details, i al worker l'escombrada d'alertes cada 2 minuts i la purga de resoltes a 180 dies | `packages/application/src/infrastructure.ts`, `packages/persistence/src/infrastructure-repository.ts`, `apps/api/src/routes/infrastructure.ts`, `apps/worker/src/infrastructure/` |
| A6 (1/2) | El constructor d'enllac extern validat, la lectura de l'edat i l'estat d'una alerta, i el diccionari `ca`/`es`/`en` | `apps/web/src/lib/infrastructure-link.ts`, `apps/web/src/lib/infrastructure.ts`, `packages/i18n/src/index.ts` |
| A6 (2/2) | La pantalla `/{locale}/infrastructure` (resum, automatitzacions amb la seva edat, alertes vives i regles), l'entrada del menu darrere la flag, l'OpenAPI del modul i el runbook de l'error workflow | `apps/web/src/app/[locale]/infrastructure/page.tsx`, `apps/web/src/components/infrastructure-workspace.tsx`, `apps/api/src/openapi.test.ts`, `docs/runbooks/n8n-error-workflow.md` |

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

**El motor d'alertes es pur i encara no el crida ningu**: viu a
`packages/domain/src/infrastructure.ts`, entren regles, registres i rellotge, i surten veredictes.
La decisio que mes hi pesa es que **frescor va abans que veredicte**: una regla amb dades mes
velles que el seu pressupost queda `starved`, i llavors **no resol el que ja estava disparat** —
perdre de vista n8n no ha de semblar que tots els workflows s'han arreglat alhora.

**El connector `n8n` ja es al registre, pero encara no el fa servir ningu**: cal una instancia
creada per la pantalla d'integracions, amb la seva `api_token` desada a la caixa forta, i la flag
`infrastructure` oberta perque el reconciliador li programi res. Els seus contract tests van contra
fixtures escrites des del contracte public documentat de l'API v1, **no capturades d'una instancia
real** — l'acces a produccio es fora d'abast d'aquesta fase. El dia que se sapiga la versio d'n8n
de la VPS, les fixtures s'hi fixen i el test la nomena.

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
configuracio **es un formulari que dicta el connector**, i connectar una plataforma es triar-la
d'un cataleg de targetes i respondre el que aquella plataforma demana. El connector nomes tria
com es dibuixa cada camp i per a que serveix; si es obligatori i quin valor per defecte porta es
llegeixen del seu propi esquema, amb una sola pregunta, de manera que les dues respostes no es
poden contradir. Els camps de **connexio** es pregunten obertament i els de **comportament** es
plegan, perque tots ells ja es responen sols — i `defineConnector` refusa a la carrega del modul
tant un camp obligatori declarat com a plegable com una llista que hagi divergit de l'esquema en
qualsevol direccio. La que importa mes: **una clau de configuracio sense camp es una clau que
ningu pot omplir des d'una pantalla**, i era exactament aixo el que obligava a configurar una
integracio per `curl`. Les incidencies cauen sobre el camp que les ha provocat i obren el
desplegable si el camp hi era plegat; les que no nomenen cap camp declarat es dibuixen amb cami i
codi, mai amb el valor escrit. Un connector que aquesta versio ja no porta no te camps ni res que
accepti una edicio: la seva configuracio **es mostra, no s'ofereix**. La credencial s'escriu des
del mateix dialeg que crea la integracio —quan el connector es dels que surten a buscar dades— i
tambe des del panell, en un camp que exigeix `credentials:rotate` —que no es el permis que
gestiona la integracio— i que no es torna a llegir mai: cap ruta d'aquesta API en retorna el
valor, i el formulari es buida en enviar-lo.

Quan una execucio falla, **la pantalla diu que ha fallat**, no que alguna cosa ha fallat. El
conjunt de codis que una execucio pot desar es tancat i el declara `@control-hub/domain`, de
manera que el worker no en pot llencar cap que no en sigui membre i una prova exigeix, per a cada
codi i cada llengua, una frase que no sigui la generica. Van a un espai propi (`runError*`) perque
`FORBIDDEN` de l'API vol dir que et falta un permis i `FORBIDDEN` d'una execucio vol dir que el
proveidor ha refusat la credencial: una sola clau en diria una de les dues malament.

**El que l'A9b deixa decidit i no s'ha de tornar a decidir.** Desactivar ja es l'arxiu —conserva
tot i atura la feina—, aixi que esborrar vol dir que la integracio no hi es. Es **una sola
sentencia** contra `connector_instances` i la cascada de l'esquema s'emporta la resta; no hi ha
cap llista de taules escrita a ma, perque seria la copia que un dia deixa de quadrar. La `0036`
obre **un sol privilegi**, `delete` sobre `connector_instances`: les files de sota segueixen sent
inabastables d'una en una, i se'n van nomes com a consequencia. Una peticio no pot esborrar
l'evidencia del que una integracio va fer; nomes pot retirar la integracio.

Dues respostes que no son al text del SQL i que per tant es proven contra PostgreSQL a
`connector-repository.integration.test.ts`, no es donen per bones: **una cascada no necessita
privilegi de `delete` a les taules que referencien** (corre amb els privilegis del propietari) i
**la RLS forçada no la barra**. La prova munta una instancia amb fila a les nou taules i n'exigeix
zero despres.

**L'historial d'execucions se'n va; l'auditoria es queda.** `audit_log.target_id` es text sense
clau forana, de manera que `connector_instance.deleted` sobreviu a la instancia que anomena, i
per aixo porta el nom, el tipus, l'estat i quantes credencials, execucions i adreces se n'han
anat: es tot el que una investigacio tindra. **Sense precondicio d'estat**: es pot esborrar una
instancia activa, perque el reconciliador ja treu el calendari que no vol i el runtime ja deixa
caure una feina d'una instancia que no troba. El que no podem fer es revocar la credencial al
proveidor, i la pantalla ho ha de dir.

**L'A9b (2/3) treu la fitxa d'una integracio del panell i li dona ruta propia.** Configuracio,
adreca d'entrada, credencials i execucions ja no comparteixen mig ecran amb la taula:
`/{locale}/integrations/[instanceId]` es una pagina, amb la mateixa navegacio de tornada que
qualsevol altra fitxa del producte, i la llista recupera l'amplada sencera. El formulari de
configuracio viu en un sol component (`connector-forms.tsx`) que usen alhora el dialeg de creacio
i la fitxa, perque un formulari que divergeix entre les dues pantalles es la mena de deriva que
no es descobreix fins que un camp accepta una cosa en un lloc i una altra a l'altre. Els enllacos
antics amb `?selected=<id>` es redirigeixen a la fitxa **nomes si el valor te forma
d'identificador**; qualsevol altra cosa s'ignora en comptes d'escapar-se, perque aquell valor
acaba dins d'un cami i no hi ha cap `../..` legitim a preservar.

El dialeg d'esborrat exigeix escriure el nom exacte abans d'activar el boto de confirmar —friccio
deliberada, no el control que decideix, que es el permis comprovat a l'API— i llista que se
n'emporta abans de deixar fer res. Provat contra la pila de verificacio (port 3002): les tres
proves d'`integrations.authenticated.spec.ts` (connectar, refusar un valor, esborrar) passen amb
un usuari real i base neta.

**Les execucions no tenen final natural, i la pantalla ho havia de saber.** Un connector sa fa
`pull_executions` cada cinc minuts i `pull_workflows` cada quinze —es la cadencia que declara
`n8n.ts`, no un simptoma—, aixi que una integracio oberta un dia sol ja te centenars de files. La
llista es pagina contra la mateixa ruta `GET /runs` que ja paginava, amb el seu propi peu de
pagina en comptes del de la taula, i queda capada en alcada amb desplacament propi perque no
empenyi la zona de perill avall de la pantalla. Dos defectes visuals van sortir de fer-la servir
de debo, no de cap prova: les files d'execucio posaven un `StatusPill` sencer a la columna de 14px
que `.timeline` reserva per a un punt, i es solapava amb el text —arreglat amb l'estructura
`.timeline-mark`/`.timeline-body` que ja fa servir `project-detail.tsx`—; i la graella de dues
columnes estirava cada panell a l'alcada del mes alt de la seva fila, aixi que un panell curt
("Cap credencial") es veia amb un buit enorme sota el text —arreglat amb `align-items: start`.

**L'A9b (3/3) fa que la taula respongui sense que ningu hi entri.** La fila duu la marca i el nom
del proveidor en comptes del tipus en kebab-case, la salut amb el seu motiu llegit del vocabulari
de les execucions (`runError*`, mai el de l'API: `FORBIDDEN` vol dir coses diferents als dos), i
**l'antiguitat** de la lectura en comptes d'una marca de temps —amb avis explicit quan es massa
vella, perque una fila que digui «sana» de fa tres hores no es sana, es que ningu l'ha mirada. Cap
camp nou a l'API: el llistat ja portava `health.lastErrorCode` i `health.checkedAt`. L'edat es
calcula al servidor i baixa per props, com ja feia infraestructura, perque el "ara" del client no
es el del servidor i la diferencia es una discrepancia d'hidratacio.

`readingAge` i `ageLabel` es reaprofiten de `lib/infrastructure` en comptes de duplicar-se: el
llindar de 45 minuts hi te el mateix sentit (tres passades de `pull_workflows` que no han passat).
Les paraules de l'edat si que es repeteixen al diccionari d'integracions, perque els dos espais de
noms son deliberadament independents.

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
- La pantalla d'**Infraestructura** ensenya l'**estat actual amb l'edat de la lectura**, i cap
  grafic historic: `connector_records` guarda l'ultim valor de cada cosa observada, no la serie.
  Una serie temporal entraria com una consulta a demanda al connector, sense passar pel magatzem
  (decisio 3 de `docs/specifications/infrastructure.md`).
- L'enllac cap a n8n **el construeix el servidor**, no el navegador: la resposta
  d'infraestructura no porta cap adreca de proveidor, i la base surt de la superficie
  d'integracions, que demana el seu propi permis. Sense aquell permis no hi ha enllacos i els
  noms es dibuixen com a text, que es el mateix resultat que una base que ningu ha configurat.

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
- `infrastructure` — apagada per defecte, registrada a l'increment A1 de la Fase 7.1. Apagada:
  **cap ruta `/api/v1/infrastructure` declarada** —l'API respon 404, que es la veritat—, el
  reconciliador esborra tots els calendaris de connector de Valkey i no en programa cap, i el
  worker treu del calendari l'escombrada d'alertes. La purga de les alertes resoltes, en canvi,
  **no mira la flag**: files escrites amb la flag oberta han de caducar igual quan es tanqui.
  A la web, tancada vol dir **cap entrada al menu lateral i `/{locale}/infrastructure` responent
  404**; oberta, la pantalla i l'entrada hi son. La suite E2E corre amb la flag oberta
  (`.github/workflows/ci.yml`), i el 404 amb la flag tancada el prova `apps/api/src/app.test.ts`
  a l'API i la guarda de la pagina a la web.

## Superficie executable

- Web canonica: `http://localhost:3001`.
- API interna: `http://127.0.0.1:4000`; el navegador usa exclusivament `/api/*` via Next.js.
- Rutes operatives: dashboard, CRM, detall de client, productes, serveis de clients, eines i
  despeses recurrents, suport, projectes, barems, jornada, integracions, infraestructura i
  seguretat. Projectes, jornada, integracions i infraestructura, nomes amb la seva flag oberta.
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
- `0036_connector_instance_delete.sql`: un sol `grant delete` sobre `connector_instances`, i cap
  mes. Reverteix una linia de la `0030` —que no donava `delete` enlloc— nomes per a la instancia:
  esborrar-ne una s'emporta el que hi penja per cascada, i les files de sota segueixen sense
  poder-se esborrar d'una en una.
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
