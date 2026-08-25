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
base neta i sense reintents, i `pnpm check` sencer —`lint`, `format:check`, `typecheck`, `test`,
`build`— tambe, sobre tretze paquets. Amb el B1, el B2, el B3 i el B4 sencers dins son **1.165
proves**, les d'integracio de PostgreSQL incloses; sense `TEST_DATABASE_URL` se'n salten 197 i en
passen 964 — no sumen les 1.165 perque quatre proves de
`@control-hub/contracts` ni tan sols es registren sense base de dades. L'error de
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

**Release `v0.3.0` preparada el 24 d'agost de 2026** des de `develop`, despres de passar les vuit
portes de CI. Inclou la 7.3, Vercel, Supabase, consum i costos variables, ingestio d'OpenAI,
Anthropic i OpenCode, i el plugin d'OpenCode. **Publicar no encen res**: `connectors`,
`infrastructure` i `usage_costs` segueixen darrere les seves flags. **No s'ha desplegat res
enlloc**; una release es codi versionat, no una instal·lacio.

La comparacio contra un `main` tan endarrerit va fer que dues portes miressin historial que les
propostes cap a `develop` no havien mirat mai, i van sortir tres coses. Gitleaks va parar en un
fixture de proves, resolt amb el fingerprint historic tal com ja prescrivia
`troubleshooting.md`. CodeQL en va marcar dues d'altes: una assercio de test que comprovava un
prefix en comptes de l'adreca sencera —i que per tant hauria passat amb
`n8n.internal.example.evil.test`, exactament el cas que el fitxer existeix per refusar—, i el
mapa de capcaleres del `guarded-fetch`, que ara es sense prototip perque el nom d'una capcalera
el tria qui hi ha a l'altra punta del socket.

## El seguent pas

**La Fase X de desenvolupament multi-agent te el primer increment implementat** a la branca
`chore/phase-x-agent-workspaces`. Separa per tasca la branca, worktree, `.env`, secrets efimers,
ports, projecte Compose, volums i PostgreSQL; inclou CLI de lifecycle, deteccio de col·lisions,
Dev Container, ADR, especificacio i guia operativa. Es una iniciativa transversal per als agents
que modifiquen el repositori, no el runtime empresarial de la Fase 11. Abans d'obrir la 11 o la
12 amb diversos agents, aquest increment s'ha d'integrar i cada tasca nova ha de neixer amb
`pnpm agent:workspace create`.

Validacio vista en aquest increment: `pnpm check` passa sencer amb cache Turbo propia --14/14
typechecks sense cap hit aliè, 24/24 tasques de test i 14/14 builds--, `pnpm test:scripts` passa
15/15 i les proves noves creen dos worktrees reals, comproven ports diferents, absencia de secrets
heretats, el refus `SCOPE_COLLISION` i que el web no arrenca sense un port explicit.
`docker compose config` confirma que el nom es deriva del directori i que tots els ports publicats
son obligatoris i variables. Les suites PostgreSQL de `pnpm test` es continuen saltant sense
`TEST_DATABASE_URL`; la Fase X no canvia esquema ni repositoris.

La prova de lifecycle completa tambe s'ha executat sobre un worktree temporal real: instal·lacio
immutable, tres serveis Compose i volums amb nom propi, totes les migracions sobre PostgreSQL
buit, web a `3159`, API a `4159`, worker preparat, readiness directa i via proxy en 200, aturada i
eliminacio de contenidors, xarxes, volums, dependències i worktree. La primera passada va detectar
i deixar documentats dos casos que les unitàries no veien --allowlist de variables de Turbo i
paths llargs de pnpm a Windows-- abans de repetir el lifecycle en verd.

**La Fase 12 esta aprovada i S1 implementat** a la branca
`agent/codex/ch-012-phase-12-secrets`. L'ADR 0010 fixa el model hibrid: Control Hub governa
metadata, permisos i auditoria; Bitwarden Password Manager custodia credencials humanes;
Secrets Manager es un adaptador opcional; el vault intern continua amb credencials tenant-scoped.
`docs/security/secrets-inventory.json` classifica les variables sensibles amb consumidor, owner,
entorn i rotacio, i `scripts/secrets-inventory.test.mjs` impedeix afegir-ne una de nova sense
inventariar-la. El seguent increment es S2, el resolver generic `_FILE` de `packages/config`.

**La 7.3 i la primera entrega de la Fase 8 son a `develop` i verificades.** El 24 d'agost de 2026,
la CI del commit `266c9a2` va passar les vuit portes: repositori, aplicacio, E2E public, E2E
autenticat, imatges de contenidor, secrets, dependencies i CodeQL. L'E2E autenticat va passar
sencer en 4m03s. La release `v0.3.0` es el punt de publicacio d'aquest conjunt.

**El punt de continuacio funcional es la plataforma OAuth2 de la 7B**, abans de Gmail/Graph i
dels connectors que hagin de deixar enrere tokens personals amplis. Despres ve M1, IMAP entrant
incremental. L'OAuth de connectors fa de Control Hub un client davant el proveidor; l'OAuth 2.1
de la Fase 10 el fara servidor de recursos per a MCP. Comparteixen primitives, no tokens ni
audiences.

**La Fase 10 te especificacio aprovada en part i el primer increment implementat** (24 d'agost de
2026). `docs/specifications/mcp-and-client-portal.md` defineix Control Hub com a resource server
OAuth 2.1: emissor propi, tokens opacs de referencia revocables a l'instant, audience lligada a
`APP_ORIGIN` + `/mcp`, scopes de lectura que s'interseccionen amb els permisos, registre manual de
clients, service accounts i auditoria per tool call. El propietari va aprovar D1, D2, D3 i D6; D4
(redirects loopback), D5 (vida del token), D7 (bearer o DPoP) i D8 (portal) segueixen obertes i
bloquegen exactament la part que en depen.

De la 10.1 hi ha aquests increments. L'**increment A** son les regles d'autoritat a
`packages/domain/src/mcp.ts` amb 23 proves, que decideixen qui pot cridar que --issuer, audience,
expiracio, revocacio, tenant, scope i permis, en aquest ordre-- i la flag `mcp` registrada i
apagada. L'**increment B1** es el cataleg de `packages/application/src/mcp.ts`: quatre tools de
lectura de CRM i suport, cadascuna lligada a un cas d'us que ja existeix, amb esquema d'entrada
tancat, projeccio que retorna menys que la pantalla i una prova d'arquitectura que li prohibeix
importar repositoris. Encara no hi ha res que li pregunti: cap ruta, cap migracio, cap token.
L'**increment B2** hi afegeix els dos resums, `infrastructure.status.summary` i `usage.summary`,
compostos de lectures que ja existien --`readInventory`, `listAlerts` i `listSources`-- sense cap
metode nou de repositori: el de la flota retorna recomptes i cap hostname ni cap adreca, i el d'us
retorna salut de col·lectors i cap import. L'**increment C** es l'esquema: la migracio `0049`
--la `0048` ja era de la 7B-- amb les sis taules d'OAuth, RLS `force` una per una i les cinc
funcions `security definer` que resolen client, token i codi abans que se sapiga el tenant, mes
les tres columnes additives de `audit_log`. Els invariants es comproven sobre el fitxer SQL, sense
base de dades, i la migracio s'ha aplicat i desfet contra el Postgres local per veure que passa
sencera. L'**increment D** son les regles del flux a `packages/domain/src/mcp-oauth.ts`: vides,
coincidencia de redirect URI, negociacio d'scopes i veredicte del refresh amb deteccio de reus,
totes pures i sense hashing. L'**increment E1** es la meitat de resource server de la persistencia:
el port `McpOauthRepository` i `PostgresMcpOauthRepository`, que resol el bearer per la funcio
`security definer` --l'unica lectura que no pot estar dins d'un tenant, perque decidir quin es el
tenant es precisament el que fa-- i que en revocar un grant apaga els seus tokens a la mateixa
transaccio. L'**increment E2** hi ha afegit la meitat d'authorization server: clients, peticio
d'autoritzacio, consum del codi, emissio i rotacio de tokens i service accounts. El codi es
consumeix amb la mateixa sentencia que el llegeix, i la rotacio del refresh gasta l'antic i emet el
successor a la mateixa transaccio amb `used_at is null` al predicat, de manera que dues peticions
simultanies donen un successor i un perdedor, mai dues linies vives. Desactivar un service account
arrossega els seus grants i els seus tokens. Quinze proves d'integracio contra PostgreSQL de debo,
amb l'aillament entre tenants comprovat i no nomes escrit.

L'**increment F** es el flux com a casos d'us: `McpOauthService` a
`packages/application/src/mcp-oauth.ts`, amb els dos documents de metadata, l'aprovacio del
consentiment i l'intercanvi del codi. L'issuer surt de la configuracio validada i **mai d'una
capcalera**, aixi que un `Host` que tria qui truca no pot decidir per a quina audiencia s'encunya
un token. El port `McpCrypto` declara encunyar, `sha256`, repte PKCE i comparacio en temps constant,
i `NodeMcpCrypto` les implementa amb el vector de l'apendix B de la RFC 7636 com a prova. Els
metodes que toca el token endpoint reben un `McpTenantScope` i no un `TenantContext`: alli no hi ha
sessio, i inventar rols, permisos i un flag d'MFA que ningu ha concedit seria mentir-li al tipus.
L'**increment F2** hi afegeix `refresh` i `revokeToken`. El refresc **no crea cap grant** --els
scopes surten del consentiment que ja existeix-- i la revocacio segueix la RFC 7009: un token
desconegut es una revocacio correcta, perque respondre altrament faria de l'endpoint un oracle de
quins tokens existeixen. La migracio `0051` eixampla `lookup_mcp_refresh_token` amb el client i els
scopes del grant. L'**increment F3** posa prefix a cada credencial (`chm_at_`, `chm_rt_`, `chm_sa_`,
`chm_ac_`), de manera que un token enganxat a un commit fa saltar gitleaks, i fa **obligatori** el
`resource` de la RFC 8707 a `/authorize`, a `/token` i al refresc.

L'**increment F3b** son els service accounts i el registre de clients: la via d'entrada sense
navegador. Un service account canvia el seu secret per **un sol access token i cap refresh token**
--pot tornar a presentar el secret quan vulgui, aixi que un refresh token seria una segona
credencial de llarga vida per guardar, rotar i perdre-- i els seus scopes es tornen a negociar a
cada login contra els permisos del compte. La **rotacio mante dues claus vives durant un dia**
(migracio `0052`): substituir el secret de cop trenca tots els qui el fan servir a l'instant exacte
de la rotacio, i una rotacio que provoca una caiguda es una rotacio que ningu no fa. La resposta diu
`usedPreviousSecret` quan el que s'ha presentat era el que s'esta retirant, i quan el secret vell es
sap compromes l'operacio es `retirePreviousSecret`, que tanca la finestra ara mateix. La migracio
`0053` fa `client_id` nul·lable a `mcp_grants` i el lliga al tipus d'actor: un grant d'usuari sempre
nomena el client que ho va demanar i un de service account no en nomena cap, cosa que es **mes
estricta** que el `not null` que substitueix.

L'**increment F4** posa l'authorization server al fil: els dos documents de descobriment,
`/api/v1/mcp/oauth/token` amb els tres grants i `/api/v1/mcp/oauth/revoke`, a
`apps/api/src/routes/mcp-oauth.ts`, ja registrats al composition root des d'`apps/api/src/mcp.ts`.
Aquestes rutes responen amb **el sobre d'OAuth** i no amb problem details: qui truca es un client
que no hem escrit nosaltres i decideix mirant el camp `error`. La taula de refusos es un `Record`
sobre la unio de codis del domini, aixi que un codi nou sense traduccio no compila. `Cache-Control:
no-store` hi es **tambe als refusos**, el parser de formulari viu dins d'un plugin encapsulat
--la resta de l'API continua refusant aquell tipus de contingut-- i un service account presenta
nomes el seu secret, perque un `client_id` seria dir que es un client registrat.

Configuracio nova amb la F4: **`MCP_ISSUER`**, l'origen public d'aquesta API. No pot ser
`APP_ORIGIN` (es el web) ni `API_INTERNAL_URL` (nomes des de dins del desplegament), i no es dedueix
de la capcalera `Host` a proposit. Amb la flag `mcp` encesa i sense `MCP_ISSUER`, el boot ho diu i
les rutes **no** es declaren. Comprovat contra l'app composada de debo: els dos `.well-known`
responen 200, el token endpoint respon `unsupported_grant_type` en el sobre correcte, i sense
issuer tot plegat es un 404.

L'**increment G1** es la sessio: `McpSessionService` a `packages/application/src/mcp-session.ts` i
`PostgresMcpSessionRepository` a `packages/persistence/src/mcp-session-repository.ts`. Hi viu tot el
que passa entre un bearer que arriba i un cas d'us que corre --autenticar, llistar i cridar-- i
deliberadament no al transport, perque una regla que viu en una ruta nomes es pot comprovar per un
socket. Els permisos **es resolen a cada crida** i no es porten dins del token: res no revoca un
token en el moment en que algu surt d'un tenant, aixi que aquest es el lloc on s'ha de notar. Un
service account rep **els seus permisos i cap rol**. Absent, desconegut i revocat responen igual;
nomes el caducat es distingeix, perque nomes sobre aquest un client pot actuar. El llistat de tools
reutilitza la decisio de la crida, de manera que el cataleg no pot discrepar del que passa en
invocar. I **cada crida deixa una fila a `audit_log`** --exit, refus o fallada-- amb el recompte i
mai la carrega ni el missatge de l'error, marcada `source = 'mcp'`. Vint proves d'unitat i set
d'integracio contra PostgreSQL de debo.

L'**increment G2** es el transport: `POST /mcp` a `apps/api/src/routes/mcp-transport.ts` amb
`initialize`, `tools/list` i `tools/call` sobre JSON-RPC 2.0, i la composicio sencera a
`apps/api/src/mcp.ts`. El repartiment de sobres es la decisio de l'increment: **el problema del
token es respon a la capa HTTP** amb problem details i el `WWW-Authenticate` que nomena el document
de metadata --es el senyal sobre el qual el client actua sol per anar a autoritzar-se-- i **la
resta viatja dins del JSON-RPC** amb 200, perque un permis que falta no s'arregla tornant a
autoritzar i respondre-ho al transport faria que el client tanques la sessio. El `Mcp-Session-Id`
**es deriva del grant** i no es desa enlloc: tot el que una sessio guardaria es torna a llegir del
token a cada peticio, aixi que no hi ha taula, ni memoria que creix, ni estat per replicar.
`GET` i `DELETE` responen 405: no hi ha stream ni sessio que tancar.

Provat de punta a punta contra PostgreSQL real amb un service account creat a ma --secret, token,
`initialize`, `tools/list`, `tools/call` amb dades del tenant, refus fora d'scope, 404 de sessio
aliena i les dues files d'auditoria. Aquella passada va destapar dos defectes que cap prova veia i
que van amb aquest increment: `lookup_mcp_access_token` unia `mcp_clients` amb un join intern, de
manera que **cap token de service account resolia** des de la `0053` (arreglat per la `0056`, amb
`clientStatus` ara `"active" | "suspended" | null`), i el token endpoint responia en la nostra
nomenclatura en comptes de la de la RFC 6749 seccio 5.1, que cap biblioteca d'OAuth sap llegir.

L'**increment H1** son les rutes de gestio, a `apps/api/src/routes/mcp-management.ts`: clients,
consentiments i service accounts, deu rutes que nomes arriben a casos d'us que ja existien --al
servei nomes hi faltaven `listGrants` i `revokeGrant`. Tres regles hi valen per a totes: **un secret
es torna dues vegades i mai mes** (en crear i en rotar), **s'audita tot, refusos i lectures
incloses**, i **`security:manage` es exigeix fins i tot per llegir**, perque saber quins agents hi ha
i que poden llegir ja es la part sensible. El sobre es problem details i la frontera amb l'OAuth es
dibuixa per ruta: `usesProblemDetails` cobreix `/api/v1/mcp/` excepte `/api/v1/mcp/oauth`, que
continua parlant RFC 6749. S'hi afegeix `POST /api/v1/mcp/service-accounts/:id/retire-previous-secret`,
que la llista d'API no tenia i sense la qual el cas d'us de tancar la finestra de rotacio no es
podia arribar a executar. Amb H1 es declara tambe l'etiqueta `mcp` de l'OpenAPI a
`apps/api/src/app.ts`, que era l'unica linia pendent de coordinacio amb l'altra sessio.

L'**increment H2** es `/authorize` i la pantalla de consentiment, l'unic tram del flux que necessita
una persona. `GET /api/v1/mcp/oauth/authorize` valida i redirigeix al panell, i les dues crides que
la pantalla fa despres viuen a `apps/api/src/routes/mcp-consent.ts` amb el sobre de problem details,
perque parlen amb el nostre panell i no amb un client OAuth generic. **No hi ha taula de peticions
pendents**: els parametres viatgen per la query string, pero cap fet que la pantalla ensenya en surt
--nom del client, scopes que realment es concedirien i data de caducitat es tornen a llegir amb
`describeAuthorization`, que comparteix `checkAuthorization` amb l'aprovacio perque el que es mostra
i el que es faria no puguin divergir. A `/authorize` hi ha dos sobres d'error segons qui el pot
rebre: el que no es pot redirigir --client desconegut, adreca no registrada-- s'atura a la pantalla,
i la resta torna a l'adreca ja comprovada amb els noms de la RFC 6749 seccio 4.1.2.1 i l'`state` que
el client va enviar. **Aprovar exigeix una sessio de menys de deu minuts** --`sessionFreshAge`, la
mateixa finestra que better-auth fa servir per canviar la contrasenya-- i **refusar no**, perque
demanar un login nou per dir que no es com un «no» acaba sent una pestanya abandonada. La migracio
`0057` afegeix `name` a `lookup_mcp_client`: sense el nom registrat la pantalla ensenyaria un
`client_id` opac alli on una persona espera «Claude Desktop». L'API no coneix la llista d'idiomes;
redirigeix a `${appOrigin}/mcp/consent` i el panell negocia la llengua, i sense `appOrigin` la ruta
no es declara.

L'**increment H3** es la pantalla que la persona llegeix. L'API redirigeix a `/mcp/consent` sense
idioma a l'adreca i `negotiateLocale` en tria un a partir de l'`Accept-Language`; la peticio passa
sencera i sense tocar a `/{locale}/mcp/consent`, que es **de servidor**: la descripcio es torna a
llegir per l'API abans de dibuixar res, de manera que la pantalla no es pot renderitzar nomes a
partir de l'adreca. Qui hi arriba sense sessio no perd la peticio --`requireSession` accepta un
`returnTo` i el formulari d'inici de sessio l'obeeix--, i la destinacio passa per `internalPath`,
que nomes accepta camins dins del panell: es l'unica pantalla del producte que s'obre des d'un
enllac escrit per algu altre, i una destinacio treta d'una adreca es com es construeix un open
redirect. Les frases son a `getMcpDictionary` en tres idiomes, i `mcpScopeLabel` i `mcpErrorMessage`
viuen al costat de les paraules perque la derivacio de la clau i la prova que la comprova no
divergeixin en silenci. Comprovat contra la pila de verificacio al port 3002: un navegador en
espanyol acaba a `/es/mcp/consent`, un en alemany a `/ca/...`, i sense sessio a
`/es/login?next=...` amb la peticio sencera dins.

L'**increment H4** es la seccio d'agents de la pantalla de seguretat: els clients registrats, els
consentiments donats i les service accounts, contra les rutes de gestio de la H1. Si aquesta seccio
existeix o no ho decideix l'API i no el component: si el primer llistat respon 404 --la superficie
no esta muntada-- o 403 --qui mira no l'administra-- no es dibuixa res, perque un panell buit
titulat "agents registrats" diu que no n'hi ha cap, que es una frase diferent i falsa. La flag es
llegeix de l'entorn i un component `"use client"` no la pot veure, aixi que preguntar-ho a l'API es
alhora l'unica manera i la correcta.

Els dos vocabularis que els formularis ofereixen tambe venen de l'API: `GET /mcp/clients` afegeix
`scopes` --els ambits que poden formar un sostre, sense `mcp:tools.list`, que no es nega mai-- i
`GET /mcp/service-accounts` afegeix `grantableScopes`, els que qui mira pot sostenir de veritat. Son
llistes tancades del domini, que `apps/web` no importa, i una copia al navegador envelliria oferint
menys opcions de les que existeixen sense que res falles. Pel mateix motiu el formulari de service
account no envia permisos: `createServiceAccount` els dedueix dels ambits triats i els segueix
capant pels de qui la crea, de manera que la comoditat no obre cap via per sobre la regla.

Un secret es mostra al panell que l'ha encunyat i un refus al panell que l'ha provocat, no en un sol
lloc compartit: una resposta a "retira aquest consentiment" sota un formulari a mig omplir es llegeix
com si fos d'aquell formulari, i un secret sota el titol equivocat es un secret que algu desa malament.

L'**increment H5** treu els agents de la pantalla de seguretat i els posa a `/{locale}/mcp`, amb
«Configuracio» convertida en grup del menu --Seguretat i Agents MCP-- perque connectar un assistent
i donar-se d'alta un segon factor son feines diferents del mateix dia diferent. A sobre hi ha el
panell **Connectar un assistent**: l'adreca del servidor, que ve del `resource` de l'API i no es
compon a la pantalla --una adreca muntada aqui pot no coincidir amb l'audience contra la qual es
valida el token, i el desajust apareix molt despres i dins del client d'algu altre--, i la
configuracio per a Claude Code, Claude d'escriptori, OpenAI i OpenCode, cadascuna amb la linia que
diu on va. Els fragments son dades a `apps/web/src/lib/mcp-connection.ts` i es proven: son cadenes
que algu enganxara a un fitxer de configuracio, i una que sigui subtilment falsa costa una tarda.

Cap fragment porta identificador de client, perque cap d'aquests assistents n'accepta un d'escrit a
ma: se'l treuen registrant-se sols, per DCR, que la decisio **D3** deixa fora de la 10.1. El panell
ho diu tal com es en comptes d'ensenyar nomes el cami felic, i mostra l'identificador de l'agent
triat al costat, per als clients que si que el demanen. **Aixo es, ara mateix, el que impedeix
connectar-hi un assistent d'una tacada, i la primera cosa a decidir de la 10.2.** El Claude
d'escriptori i claude.ai hi afegeixen una segona condicio, que no es nostra: exigeixen una adreca
https publica i rebutgen localhost. Claude Code accepta http a localhost i es la via per provar-ho.

Amb aixo la **10.1 queda tancada de punta a punta**: autoritat, transport, consentiment i gestio.

El propietari va tancar **les quatre decisions que quedaven obertes** el 24 d'agost de 2026:
redirects loopback permesos (D4), access token de 30 minuts (D5), bearer amb el risc residual
declarat i DPoP mes endavant (D7), i el portal de client fora d'aquesta fase (D8). D4 i D7 es van
decidir mirant el cas d'us real: els clients MCP d'avui --Claude Desktop, Claude Code, Codex,
OpenCode-- redirigeixen a `127.0.0.1` i parlen bearer, i una regla que els deixi tots fora no
protegeix ningu perque no hi ha ningu a dins. **Ja no queda cap decisio que bloquegi la 10.1.**

Dues coses que la Fase 10 haura de coordinar amb la 7B quan hi arribi: els **numeros de migracio**,
que es prenen mirant el directori en aquell moment i no els que diu cap especificacio, i l'ampliacio
additiva de `TenantContext` amb un `actor`, perque un service account no te `userId`.

**El que ve despres, decidit el 23 d'agost de 2026: mes connectors, no la Fase 9.** La Fase 9 es
empaquetat i distribucio —imatges OCI, instal·lador, Ansible, SBOM, signatura— i nomes es paga quan
una tercera empresa instal·la Control Hub, que avui no es el cas; a mes, els builds de Docker estan
bloquejats en aquesta maquina. En canvi la plataforma de connectors ja esta pagada i sense
amortitzar: l'inventari, el descobriment, la comprovacio guiada, el motor d'alertes i el vault els
hereta de franc qualsevol connector nou.

Per ordre: **Vercel** primer —cada web de client hi viu, i un build que peta o una produccio
caiguda s'ha de saber abans que ho digui el client— i **Supabase** despres, on el mode de fallada
tipic del pla petit es que el projecte es pausa sol. Tots dos son HTTP amb token de nomes lectura,
que es exactament el que el contracte de connector admet: **no depenen de la meitat d'OAuth de la
7B, que te zero codi**. Hostinger no: el que en trauriem —domini caducat, certificat expirat, lloc
que no respon— ja ho llegeix la sonda blackbox del Prometheus.

**El connector de Vercel ja esta escrit** (23 d'agost de 2026), amb la seva especificacio a
`docs/specifications/connector-vercel.md` i el runbook a `docs/runbooks/connect-vercel.md`. Llegeix
els projectes com a estat (`project:<id>`, cada 5 min) i els desplegaments de produccio fallits com
a esdeveniment (`deployment:<uid>`), amb la base **fixada al codi** a `https://api.vercel.com` -- un
camp lliure alli seria una manera d'apuntar el token del compte al host de qualsevol altre. 28
proves verdes, `pnpm check` sencer **no executat** (la branca es compartida).

**Els projectes ja es dibuixen.** El 23 d'agost de 2026 es va decidir el que quedava obert: un
projecte de Vercel no es ni una maquina ni un servei —`hostId` es obligatori a un servei—, aixi que
te **franja propia**, com les automatitzacions d'n8n, amb la taula d'enllac `infra_project_links`
(migracio `0046`) per lligar-lo a un client. La fila ensenya el domini de produccio, si produccio
serveix i **quan es va desplegar el que se serveix** —que mentre serveixi es l'ultim build bo, aixi
que no cal desar cap registre de builds correctes per dir-ho—, quan es va crear el projecte, amb que
esta fet, **l'ultim build fallit** —dues columnes i no una: un projecte pot estar servint i haver
tingut un build que peta fa deu minuts— i l'edat de la lectura. La franja esta subjecta al filtre de
recollidor com la resta.

**El que segueix sense fer-se, i es diu:** cap alerta salta quan un build peta. Demana una regla
`deployment_failed` i es un increment a part; fins llavors un build fallit es veu **quan algu mira
la pantalla**. El webhook de Vercel tampoc hi es, pel mateix motiu: la immediatesa nomes val la pena
quan hi ha alerta que la faci servir. **Les visites tampoc**, i es va comprovar el 24 d'agost de
2026: l'API hi es (`GET /v1/query/web-analytics/visits/count`, mateix token), pero Web Analytics
s'activa per projecte des del tauler de Vercel i cap dels projectes actuals el te activat —la crida
respon 404, no zero. Es documenta a `connector-vercel.md` en comptes d'implementar-se perque avui
la franja nomes sabria dir que no sap res.

**El connector de Supabase ja esta escrit i dibuixat** (24 d'agost de 2026), amb la seva
especificacio a `docs/specifications/connector-supabase.md` i el runbook a
`docs/runbooks/connect-supabase.md`. Llegeix els projectes com a estat
(`pull_supabase_projects`, `project:<ref>`, cada 5 min), amb la base **fixada al codi** a
`https://api.supabase.com`, com Vercel. **Decisio deliberada, amb el risc dit sencer:** un
Personal Access Token de Supabase no te cap abast de nomes lectura -- porta el mateix privilegi
que el compte que el va encunyar, i l'unica manera de tenir-ne un de limitat de veritat es OAuth2,
que demana la plataforma de la Fase 7B i no es construeix nomes per aixo. El propietari ho va
acceptar amb el risc explicit, i `credentialHint_supabase_api_token` ho diu a l'onboarding amb
aquestes paraules, no amb un eufemisme. **Cap migracio nova**: els projectes reutilitzen
`infra_project_links` (la mateixa taula de Vercel) perque associar un projecte allotjat a un
client es el mateix concepte sigui quin sigui el proveidor, i l'`instance_id` ja el diferencia
sense cap columna `kind`. La franja **Projectes Supabase** es separada de la de Vercel -- columnes
diferents, sense domini ni framework -- amb regio, estat (`healthy`: actiu, inactiu o en transicio
quan es `null`, mai una caiguda falsa mentre Supabase mou el projecte d'un lloc a un altre) i quan
es va crear.

**La primera VPS real ja es llegeix.** El 23 d'agost de 2026 la VPS de Contabo
(`node-exporter:9100`) va passar de no tenir cap lectura a ensenyar CPU, memoria, disc, carrega i
temps encesa, mes 20 contenidors, 5 sondes i la copia de seguretat diaria. **La VPS no va caldre
tocar-la**: ja tenia el Prometheus nomes a loopback i els tres exportadors sense publicar cap port,
tal com demana `docs/runbooks/connect-a-vps.md`. El que fallava era la installacio del Control Hub,
i eren dues coses independents:

- **`connector_sync_runs_job_id_check` limitava `job_id` a 120 caracteres**, i l'identificador de
  BullMQ en gasta 104 abans del nom de l'operacio. `pull_executions` en feia 120 i passava just;
  `pull_host_metrics` en feia 122 i no. La violacio saltava dins de `startRun`, **abans que
  existis la fila de la passada**, aixi que no quedava ni passada, ni salut, ni codi d'error: un
  modul sencer incapac de desar una lectura, fallant de l'unica manera que no deixa rastre a cap
  pantalla. Ho corregeix la migracio `0040`.
- **`CONNECTOR_INTERNAL_ALLOWLIST` estava escrita dues vegades al `.env`.** El `--env-file` de Node
  es queda l'ultima i descarta la primera sense dir-ho, aixi que l'origen del Prometheus no hi era
  mai i cada passada moria amb `DESTINATION_NOT_ALLOWLISTED`. La seccio 7 del runbook ho documenta.

**Cap de les dues no l'hauria enxampada la comprovacio guiada del C1 tal com esta ara.** Amb
`lastAttempt` a null la cadena s'atura al primer esglao dient que ningu no ho ha mirat, quan la
veritat era que el modul no podia ni comencar. Val la pena, quan es reprengui el C1, distingir
"ningu no ho ha intentat" de "no es pot intentar".

**El C1 esta complet.** Hi ha el domini, el cas d'us, la lectura contra PostgreSQL i la ruta
`GET /api/v1/infrastructure/connectors/{instanceId}/diagnosis`, amb sis esglaons dels set que
llista l'especificacio: el primer no hi es a proposit, perque amb la flag tancada no hi ha ruta a
preguntar i la resposta es el 404.

La pantalla es un panell a la fitxa de la integracio (`/integrations/{instanceId}`), i nomes surt
per a connectors que han d'arribar a una adreca de la llista de l'operador i amb la flag
`infrastructure` oberta. Dibuixa la cadena sencera i obre nomes l'esglao trencat, amb l'ordre per
copiar. **Les dues ordres es componen al navegador amb l'adreca que hi ha al formulari del
costat**, no amb la desada ni amb cap cosa que vingui de la resposta. El modul
`connector-diagnosis.ts` de `apps/web/src/lib` en treu l'origen i el port i descarta credencials,
camins i qualsevol nom que pogues fer de segona ordre en una consola. Quan l'adreca escrita es la mateixa maquina,
el forat del davant queda visible en comptes d'inventar-se una VPS.

El criteri 11 ja te la seva prova: `packages/i18n/src/index.test.ts` recorre
`infrastructureErrorCodes` i falla si un codi no te frase en els tres idiomes o si cau a la frase
generica.

**`pnpm check` torna a estar verd de punta a punta**, i pel cami han caigut tres defectes que no
eren del C1. El `build` fallava fent el prerender de `/_global-error`, la pagina interna de Next
per quan el layout arrel no arriba a renderitzar: aquesta aplicacio no en tenia cap de propia i la
integrada peta amb un `useContext` nul. Ara hi ha `apps/web/src/app/global-error.tsx`, que no es un
pedac sino la pantalla que faltava — el layout arrel espera `currentAttendanceStatus()`, de manera
que l'API sense respondre fa caure precisament el layout, i fins ara la resposta era una pagina en
angles, sense estil i sense reportar res. Diu el mateix que `[locale]/error.tsx` en els tres
idiomes, amb els colors del producte escrits inline (el full d'estils global no arriba a aquest
limit) i fa `captureException`.

El segon no arriba al repositori i val la pena saber-ho: `packages/database/src/index.ts` i
`packages/domain/src/infrastructure.ts` tenien 2 i 57 linies en LF dins de fitxers CRLF, de quan es
van inserir amb un script. Amb `endOfLine: "auto"` aixo deixa `format:check` vermell, pero
**nomes en aquesta copia de treball**: `.gitattributes` diu `text=auto`, o sigui que git desa LF
sempre i un clon nou surt tot en CRLF i verd. Arreglat amb `prettier --write` i sense res a
committejar. La trampa es que qualsevol script que insereixi text amb `\n` en un fitxer que git ha
posat en CRLF torna a obrir-la.

El tercer, a `apps/web/src/app/styles.css`: **51 referencies a colors que no existien**. Vint-i-una
sense cap fallback — `--text-muted`, `--bg`, `--fg`, `--primary`, `--focus`, `--text-strong` — de
manera que la propietat no s'aplicava; i trenta que queien en un valor codificat a ma que era la
paleta per defecte de Tailwind. Tot el modul de tiquets estava escrit contra un vocabulari de tokens
que aqui no ha existit mai. Ara tot apunta a la paleta real i s'ha declarat `--info-subtle`, l'unic
color semantic que no tenia superficie tenyida. L'unica variable no declarada que queda es
`--row-index`, que ve inline des de `smart-data-table.tsx`.

**El C2 esta complet: el resum, els filtres i la fitxa per maquina.** Cap taula nova i cap
migracio, com deia l'especificacio.

El resum compta maquines i serveis pel seu estat, i els compta `observedTally` al domini a partir
de les mateixes lectures amb que es dibuixen les files. La xifra de dalt i la llista de sota son
una sola afirmacio comptada dues vegades, i comptar-la a la pantalla seria una segona opinio sobre
quantes maquines han caigut. Viatja dins la resposta d'inventari, no dins la de resum: es d'alla
que surten les lectures, i demanar-ho a `/overview` voldria dir llegir la flota dues vegades per
pintar una pantalla.

Els filtres son tres preguntes acumulables sobre l'inventari —entorn, resposta de la lectura i
recollidor d'origen— i cadascuna es una llista: buida no demana res, dos valors demanen qualsevol
dels dos, i dues llistes amb contingut s'han de complir totes dues. **No canvien res del que es
llegeix**: `filterInventory` amaga files i prou, i l'objecte que torna per a una fila que passa es
el mateix objecte que li va entrar —hi ha una prova que ho comprova amb `toBe`. El resum de dalt no
es filtra a proposit: quanta flota hi ha caiguda no depen del que algu estigui mirant en aquell
moment. Una maquina es queda tambe quan el que coincideix es un servei seu, perque un servei no te
on dibuixar-se sol, i llavors nomes se n'ensenyen els serveis que han coincidit.

Perque tot aixo fos possible, `CurrentReading` ara diu **de quin connector ve cada lectura**
(`instanceId`). Es una propietat de la lectura i mai de la cosa llegida: la mateixa VPS la pot
llegir un altre recollidor dema, i dos poden llegir-la avui. Es l'identificador d'una fila nostra
de `connector_instances`, el mateix que ja porten les automatitzacions i les regles d'alerta — mai
una adreca del proveidor.

La fitxa d'una maquina es `/infrastructure/hosts/{hostId}`, i llegeix el mateix inventari que la
llista per triar-ne una: **no hi ha ruta per host a l'API i no n'hi ha d'haver**, perque una segona
ruta que calculi la mateixa resposta es una segona ocasio de calcular-la diferent. El que hi afegeix
es la procedencia: quin recollidor ha llegit cada linia i fa quant, junts, perque una xifra fresca
d'un recollidor inesperat i una d'una hora del recollidor correcte son problemes diferents.

La decisio que mes forma dona a la fase: **el programari diagnostica i escriu ordres, no n'executa
cap**. Ni `ssh`, ni escriptura a `.env`, ni cap clau d'acces a maquines desada. El motiu es de
consequencies: avui el pitjor cas d'un panell compromes es que algu sapiga quanta RAM gasta una VPS;
amb una clau SSH al vault seria perdre-les totes.

**El C3 esta complet: el descobriment.** Cap taula nova i cap migracio tampoc aqui, com deia
l'especificacio de tots tres increments.

El descobriment diu, per a un recollidor, quines etiquetes ha desat a la darrera passada i quines
d'aquestes ja estan declarades i contra quina fitxa. Es el mateix esglao `matching` del diagnostic
guiat, pero desplegat com a llista en comptes de reduit a un si o un no, i el calcula la mateixa
funcio del domini (`discoverInstances`, a `connector-diagnosis.ts`) perque les dues respostes no
puguin arribar a discrepar. A la persistencia, la consulta d'etiquetes es una sola i la comparteixen
les dues lectures: dues copies d'aquell `where` acabarien discrepant, i la discrepancia es llegiria
com una pantalla que ofereix una maquina que la comprovacio diu que no veu. Les adreces sondejades
en queden fora a totes dues, perque una URL no es una maquina que ningu pugui declarar — vegeu el
defecte de sota, perque durant uns dies aixo era el que el document deia i no el que el codi feia.

**No dispara cap consulta cap enfora.** Llegeix registres ja desats, i per aixo obrir la pantalla no
pot generar trafic. Tampoc s'audita: es una lectura. Declarar des d'alla si que s'audita, com
qualsevol declaracio, perque es exactament la mateixa operacio.

La pantalla es al taulell d'infraestructura i no al costat del diagnostic, i el motiu es el boto:
declarar es `infrastructure:operate` i el formulari que ho fa es el dialeg d'aquella pantalla, ja
escrit i ja permissionat. Posar la llista al costat de la comprovacio hauria volgut dir o be una
segona copia d'aquell dialeg o be arrossegar un `hostname` per una navegacio, i un `hostname` a una
query string es precisament el que les regles del modul volen evitar. El panell no es carrega sol:
es demana, com el diagnostic, perque llegir els registres de tota la flota per pintar una pantalla
que poca gent obre el paga tothom.

Codi d'error nou: `MIGRATION_REQUIRED`, amb 503 i frase en tres idiomes. Amb l'esquema incomplet no
hi ha `connector_instances` on mirar, i respondre "aquesta integracio no hi es" seria una resposta
falsa sobre una taula que no existeix — el mateix ordre d'esglaons que ja feia el diagnostic.

~~**Les tres proves d'integracio noves de PostgreSQL no s'han pogut executar aqui**: la connexio
TCP cap a `control_hub_test` no s'estableix des d'aquesta sessio.~~ **Corregit el 23 d'agost de
2026**: la connexio si que funciona; el que passava es que les suites se salten soles quan no hi ha
`TEST_DATABASE_URL` exportada, i llavors semblen executades i verdes. Passen totes. La recepta es
a `docs/development/troubleshooting.md`.

**Un defecte del C3, trobat usant-lo i tancat.** El panell de maquines oferia
`https://sssupabase.digitaistudios.com/storage/v1/version` com si fos una maquina. Declarada, la
seva fitxa deia «no respon / cap lectura» i ho hauria dit per sempre: les xifres d'una maquina surten
de `pull_host_metrics`, que desa `host:<etiqueta>`, i cap lectura no portara mai aquella etiqueta.
Supabase no es una maquina: es un servei al qual el Prometheus truca amb el blackbox.

La causa era una suposicio escrita com si fos una regla. La consulta filtrava per `scrapeUp` creient
que una sonda de blackbox no en te; **si que en te**: Prometheus reetiqueta l'scrape de blackbox de
manera que la linia `up` porta la URL sondejada com a `instance`. La prova d'integracio que ho
guardava sembrava el registre **sense** `scrapeUp`, o sigui que confirmava la creenca en comptes de
comprovar-la — i per aixo passava.

Ara la regla es al domini (`couldNameMachine`) amb les seves proves, i s'aplica sobre la consulta
compartida, de manera que la comprovacio guiada i el descobriment no poden discrepar. Una URL es
continua llegint i continua sortint: **al selector de serveis**, com a mena `http`, que es la
pantalla que en pot fer alguna cosa. La prova d'integracio ara sembra el registre tal com el
connector l'escriu de debo.

**El C4 esta complet: el selector de serveis.** El descobriment del C3 proposa maquines; aquest
proposa serveis, un esglao mes avall i pel mateix motiu. Fins ara declarar un servei volia dir
escriure `container:n8n` a ma dins d'un camp lliure, i un sol caracter equivocat produia un servei
que no s'encenia mai, sense res a cap pantalla que digues per que. **Aquest error el vaig cometre
jo mateix aconsellant-lo**: la clau ha de portar el prefix, i sense ell no casa amb res.

La pantalla ensenya tot el que el recollidor ha desat amb un prefix declarable — `container:`,
`probe:` i `backup:` — agrupat per mena, amb una casella per cada cosa encara sense declarar i els
ja declarats a la vista pero sense casella, perque son informacio i no una accio. El nom proposat es
l'identificador sense el prefix. Marcar-ne uns quants i confirmar els declara tots de cop, amb estat
esperat `up`, fins a cent per crida, i **cada servei declarat deixa la seva fila d'auditoria**: una
casella marcada ha de ser indistingible al rastre d'una declaracio escrita a ma.

**El que la llista no sap, no ho fingeix.** Una lectura de contenidor porta l'etiqueta del cAdvisor
que la va veure (`cadvisor:8080`) i una maquina es declara per l'etiqueta del `node_exporter`
(`node-exporter:9100`); res no lliga les dues. Per aixo s'ofereix tot el que el recollidor veu i es
mostra al costat de qui ho va veure, i decideix qui ho sap. Filtrar per una correspondencia
inventada amagaria serveis de debo sense dir-ho.

El calcul es al domini (`discoverServices`, al mateix `connector-diagnosis.ts` que `discoverInstances`)
i la pantalla viu a la fitxa de la maquina: un servei pertany a una maquina i alla ja esta triada.
Es l'unic tros d'aquella pagina que escriu, i per aixo es l'unica illa de client que hi ha; la resta
segueix sent servidor. Llegir demana `infrastructure:read` i declarar `infrastructure:operate`, i la
pagina ho pregunta a `/api/v1/me` en comptes de suposar-ho: oferir un boto que el servidor
rebutjara es pitjor que no oferir-lo.

La migracio `0041` afegeix `backup` a les menes acceptades per `infra_services`. Ampliar un `check`
accepta tot el que ja era valid, aixi que s'aplica sobre un desplegament en marxa sense res per
desfer. Aplicada a `control_hub` i a `control_hub_e2e`; la de test (`control_hub_test`) es va
quedar enrere, igual que la `0040`, **fins al 23 d'agost de 2026, en que es va migrar sencera**.

**El C5 esta complet: la pantalla depen del que tries.** Fins ara Infraestructura ho ensenyava tot
alhora: qui l'obria per mirar la VPS es trobava al davant la taula d'automatitzacions d'un n8n que
en aquell moment no li importava, i qui l'obria per mirar les automatitzacions es trobava les
maquines. Ara hi ha un selector a dalt de tot —«Tota la infraestructura» i una entrada per cada
instancia— i **tot el que hi ha a sota es consequencia d'aquella tria**.

La regla no es una taula de correspondencies entre menes de connector i seccions, que envelliria el
dia que n'hi hagi una de nova, sino una sola frase: **una seccio que no te res d'aquell recollidor
no es dibuixa.** Amb el Prometheus triat no hi ha taula d'automatitzacions perque no n'ha llegit
cap; amb l'n8n triat no hi ha maquines pel mateix motiu. El dia que un connector llegeixi les dues
coses sortiran les dues, sense tocar res.

**Els comptadors segueixen la seleccio i no menteixen.** Amb tota la infraestructura son els que
compta l'API, que es l'unic recompte que pot parlar de maquines que aquesta pantalla no ha rebut;
amb un recollidor triat es compten aqui, perque l'API va comptar una flota i la pantalla n'ensenya
un tros — i un titol que seguis dient «22 automatitzacions» sobre una llista de cap seria la
pantalla contradint-se. **Els estats no es tornen a jutjar**: se sumen els que ja porta cada
lectura, i la frescor es tria entre les edats que el servidor ja ha calculat (`oldestAge`), mai
mesurada un altre cop al navegador.

Un comptador d'una cosa que la seleccio no conte no s'ensenya a zero: no s'ensenya. Les fitxes son
mes petites (`.metric-row.compact`), que es el que demanava una fila on la majoria porten un sol
numero.

**Els panells buits deixen d'ocupar lloc.** Les alertes, quan no n'hi ha cap de viva, passen de
panell sencer a una franja d'una linia —amb el cami cap a les resoltes a dins, perque amagar la
porta perque avui no hi ha res al darrere deixaria sense on mirar el que hi havia ahir— i el
descobriment nomes es dibuixa quan hi ha un recollidor a qui preguntar-ho: amb tota la
infraestructura la pregunta no te subjecte.

**Els filtres passen al component de seleccio general.** El de connector d'origen desapareix de la
flota: ja es el selector de dalt, i preguntar-ho dues vegades es com una llista acaba reduida a un
recollidor que no es el del titol. Els altres dos —entorn i resposta— deixen de ser caselles
acumulables i passen a una resposta cada un, amb «Qualsevol» com a primera. **Es una correccio
deliberada del C2**, escrita a l'especificacio i no un descuit.

La tria viu a la barra d'adreces, escrita amb `window.history.replaceState` —que aquesta versio de
Next integra amb el router, documentat a `node_modules/next/dist/docs`— i per tant sense
navegacio: la flota ja es al navegador i recarregar-la per dibuixar-ne menys seria demanar-ho tot
per ensenyar-ne un tros. **Un identificador d'instancia no es una adreca de proveidor**: es el
mateix UUID que ja viatja pels camins de l'API.

**Cap taula nova, cap migracio, cap ruta nova.** Tot el canvi es de lectura i de pantalla:
`sliceByCollector`, `tallyReadings` i `oldestAge` son funcions pures amb prova a
`apps/web/src/lib/infrastructure.test.ts`. `readingSources` i el component `FilterGroup` han
marxat amb el filtre que els feia servir; deixar-los hauria estat codi mort amb proves que el
justifiquen.

**El C6 esta complet: la maquina d'un cop d'ull.** El C5 va deixar la pantalla neta i seguia sense
servir: amb el Prometheus triat, tot el que deia d'una VPS amb vint contenidors era una fila de
maquina i tres etiquetes darrere d'un boto. Els vint contenidors hi eren desats; ningu no els
dibuixava, i despres de mirar la pantalla calia obrir un terminal igualment.

Ara la vista d'un recollidor ensenya **tot el que ha llegit, agrupat per mena i amb l'estat de
cada cosa** i les xifres que porta la lectura. L'estat el decideix `currentReading`, la mateixa
funcio que el decideix per a l'inventari i sobre els mateixos registres, declarada la cosa o no:
un contenidor «Respon» aqui i «No respon» a la fitxa de la maquina seria el producte discutint amb
ell mateix. **Es llegeix sol en obrir**, perque el boto que hi havia guardava la pregunta
equivocada; res no surt cap a cap proveidor en cap dels dos casos.

Declarar segueix sent una decisio d'una persona i les alertes segueixen sent nomes sobre el que
s'ha declarat: l'unic que canvia es que ara es decideix amb l'estat al davant.

**I l'espai buit.** Les maquines van a dues columnes quan la finestra hi cap, el selector i els
comptadors comparteixen una franja en comptes d'ocupar-ne dues mig buides, i el filtre deixa de
ser un panell amb vora dibuixat al voltant de dos desplegables estrets.

**La comanda del tunel del diagnostic porta tres opcions que no son decoracio.** `-L 127.0.0.1:...`
perque sense el davant `ssh` publica el port a totes les interficies i un Prometheus que es va
deixar al loopback de la VPS acabaria obert a la xarxa d'aquest ordinador; `ExitOnForwardFailure`
perque sense ell un reenviament que no s'ha pogut obrir deixa la sessio connectada i sense
reenviar res, amb el panell dient que l'adreca no respon; i `ServerAliveInterval` perque un tunel
sense transit el tanca el que hi ha al mig, en silenci.

**El C7 corregeix un defecte del C6 i acaba l'espai buit.** El C6 va donar estat a tot el que el
recollidor llegeix i **l'estat era fals**: tot el que no estava declarat sortia «No respon», i en
una VPS acabada de connectar no hi ha res declarat, aixi que sortien «No respon» els vint
contenidors, les cinc sondes i la copia. La pantalla deia que la maquina era morta mentre anava.

La causa: la lectura es demanava a `readInventoryState`, i aquella consulta selecciona els
registres **pel conjunt de claus ja declarades**. Per a un servei que ningu no ha declarat —que
son exactament els que es descobreixen— no en torna cap, i `currentReading`, amb la passada feta
i cap registre, respon `down`. Ara `readServiceDiscoveryState` torna els registres sencers i la
frescor de les operacions: ja consultava `connector_records` d'aquell recollidor per triar els
prefixos, nomes en descartava els camps. Hi ha una consulta menys, no una de mes.

**La prova d'aplicacio no ho veia perque sembrava la dada pel cami equivocat**: posava el registre
a `inventoryState`, que es precisament el que a produccio era buit. Provava que `currentReading`
sap decidir, no que la dada hi arriba. La d'ara sembra el que el repositori real torna, amb
`declaredMatchKeys` buit, que es el cas que fallava, i n'hi ha una de nova per al cas contrari:
sense cap passada recent, `unknown` i no `down`.

**Tots els recollidors alhora.** Sense cap tria no se'n dibuixava cap; ara es dibuixen tots, cada
un sota el seu nom i el seu panell. No es barregen en una llista —aquell argument del C5 seguia
sent bo— pero qui obre Infraestructura vol la salut de les maquines sencera i d'un cop, no una
pantalla que li demana una tria abans de dir-li res.

**Cada grup es plega, amb `<details>`.** El plec s'obre pel que no esta be: un grup amb alguna
cosa caiguda o sense veure surt obert; un on tot respon surt tancat amb el recompte i el desglos
al damunt. `<details>` i no estat propi: es l'unic control que el navegador ja dona resolt al
teclat, al lector de pantalla i a la cerca dins la pagina.

**L'espai buit, els quatre punts que quedaven.** Els comptadors passen de fitxes a cel·les d'una
franja separades per una linia, perque cada xifra tenia caixa, vora i encoixinat propi per dir un
numero. El selector porta la marca del proveidor —la nostra, en el seu color, mai el seu logotip
ni res demanat a un servidor de fora—, perque una llista de recollidors es llegeix per quin
proveidor es cadascun abans que pel nom que algu li va posar. El filtre puja a la linia del titol
i del boto: eren tres bandes apilades fent una sola pregunta. I la franja de «cap alerta» ocupa el
que diu, perque una banda de l'ample de la pantalla amb sis paraules es llegeix com un panell que
no ha carregat.

**Tres correccions mes sobre el mateix increment.** L'espai entre bandes el posa ara la pila
(`.infra-stack`) i no cada banda: la franja d'alertes tocava el panell de sota perque ningu no el
posava. **Un recollidor que no llegeix res d'aixo ja no dibuixa panell** —un n8n llegeix
automatitzacions, que tenen la seva taula a la mateixa pantalla, i li estavem fent una pregunta
sense subjecte; una fallada si que es dibuixa. I **cada cosa es una fitxa**: un grup amb mes de
vuit s'emporta la fila sencera i hi escampa les seves fitxes, amb el nom primer i l'estat a sota,
perque vint contenidors en columna al costat d'un grup que en te un era mig ample buit.

**El selector de serveis de la fitxa ensenya l'estat** de cada cosa al costat de la casella, i la
frase d'una maquina sense serveis declarats diu on mirar en comptes de deixar la pantalla morta.

Portes d'aquest increment: `pnpm typecheck` verd als 13 paquets, `pnpm lint` verd, i les suites de
`domain` (280), `application` (81), `i18n` (15), `api` (145) i `web` (154) passades. **No s'han
executat `pnpm test:scripts`, `pnpm build` ni `pnpm check:e2e`** en aquest increment, ni s'ha vist
la pantalla renderitzada a cap navegador des d'aqui. Queda dit.

**El C8 arregla el que la fitxa d'una maquina no podia dir.** La VPS deia «cap servei declarat en
aquesta maquina» amb vint contenidors desats al costat, i no era cap descuit: **a les dades no hi
havia res que els lligues**. El connector agrega `by (instance)`, i `instance` es l'objectiu de
scrape que ho ha reportat, no l'ordinador —una VPS normal en te tres: `node-exporter:9100` per a
la maquina, `cadvisor:8080` per als contenidors i `127.0.0.1:9090` per al Prometheus mateix. Es va
declarar amb el primer i els contenidors arriben amb el segon.

**Ara una maquina declara les etiquetes que son seves** (migracio `0042`, taula
`infra_host_labels`, RLS `enable` i `force`, clau primaria `(tenant_id, label)`), i tot el que
arriba amb qualsevol d'elles es d'ella. **Es declara i no s'endevina**, pel mateix motiu que un
servei es declara: endevinar-ho seria fals el dia que hi ha dues VPS, i el Prometheus d'un client
no el configurem nosaltres. Al panell del recollidor, una etiqueta sense declarar ofereix ara dues
sortides —«declarar-la» i «es d'una maquina que ja tinc»— i la fitxa de la maquina ensenya **tot el
que els recollidors hi veuen, declarat o no**, amb el que esta declarat marcat: declarar vol dir
«vull alertes d'aixo» i no «vull veure-ho», i el producte en feia una sola pregunta.

**El limit es dit i no amagat: nomes els contenidors es poden atribuir.** Son l'unica mena de
lectura que porta l'etiqueta de qui la va veure. Una sonda es sobre una adreça i una copia sobre
una feina; per a cap de les dues «quina maquina» no es una propietat del fet observat, i qui les
vulgui penjades d'una maquina **les declara com a servei d'aquella maquina**.

Aixo canvia una decisio del B2 que s'ha de dir: **l'inventari ja no llegeix nomes el que s'ha
declarat**, sino tambe tot el que porta un prefix atribuible (`container:`, `probe:`, `backup:`) —
el mateix conjunt que la ruta de descobriment ja llegia. El que segueix fora es el que cap maquina
pot contenir: un `workflow:` es una automatitzacio i te la seva pantalla.

**El descobriment ensenyava tot menys l'etiqueta que calia reclamar.** Llistava les etiquetes de
les lectures `host:` i de les sondes amb `scrapeUp` —el que el Prometheus escaneja—, i el
`cadvisor:8080` no es cap de les dues: viatja dins de cada contenidor, al camp `host` del registre.
Aixi que la unica etiqueta que algu havia de reclamar era la unica que la pantalla no ensenyava
mai, i el C8 quedava inabastable des de la interficie. Ara el descobriment tambe llegeix l'etiqueta
on s'ha vist un contenidor, i una etiqueta ja reclamada surt com a maquina seva i no com a pendent
de declarar —tant al descobriment com a la comprovacio guiada.

Portes d'aquest increment, i **per primer cop amb les suites d'integracio de PostgreSQL de debo**:
`pnpm check` sencer verd sobre els tretze paquets —`lint`, `format:check`, `typecheck`, `test`,
`test:scripts` i `build`— amb **1.413 proves passades i cap de saltada**. Fins ara la porta
s'anunciava com «1.138 passades i 209 saltades»: les saltades eren precisament les que toquen
l'esquema, l'RLS i l'aillament entre tenants, i **el gruix del que aquest increment afegeix viu
alli**. La base de proves estava a la `0039` i li faltaven sis migracions; migrada i executada,
les onze proves d'integracio noves passen.

**La porta en va destapar una de mal escrita, i era meva.** «No llegeix res d'un tenant que no ha
declarat res» comprovava tambe que aquell tenant no tenia cap maquina, i `tenantC` el comparteixen
diverses proves del mateix fitxer: el que hi ha declarat quan aquesta corre depen de l'ordre en que
han corregut les altres. Una prova que falla segons l'ordre no prova res. Ara comprova el que era
seu —cap lectura i cap etiqueta— i res mes.

**No s'ha executat `pnpm check:e2e`** en aquest increment, ni s'ha vist la pantalla renderitzada
des d'aqui. El propietari si que ha verificat el C8 a ma sobre la VPS real: reclamada l'etiqueta
del cAdvisor, la fitxa de la maquina ensenya els contenidors i les sondes, i es poden seleccionar.

**`pnpm check:e2e`: 32 proves, 32 passades**, amb dos workers i base `_e2e` neta. **La porta, pero,
la compta vermella**, i amb rao: dues proves d'altres modules —el fitxatge i les despeses— nomes
han passat al reintent, totes dues amb «el control no s'ha hidratat mai» sota una maquina
carregada. Cap de les dues no toca infraestructura i les cinc d'infraestructura han passat a la
primera. Queda dit i no arreglat: una prova que nomes passa al reintent no es verda.

Dues proves noves en aquesta tanda: la del C4 marca dos serveis del
selector i els torna a llegir a la fitxa de la maquina, i la del C5 tria un recollidor i comprova
que la taula de l'altre **no hi es** —no buida: absent— en els dos sentits, i que la tria queda a
l'adreca.

I `pnpm check` sencer sobre els tretze paquets: `lint`, `format:check`, `typecheck`, `test`,
`test:scripts` i `build`, tots verds, amb **1.138 proves passades i 209 saltades** — les
d'integracio de PostgreSQL, que sense `TEST_DATABASE_URL` no es registren. **Aixo inclou les del
C3 i el C4 que toquen `infra_services` i el descobriment: escrites, mai executades en aquesta
maquina**, i per tant encara sense provar contra una base de debo. **Ja no: el 23 d'agost de 2026
la base de test es va migrar i totes van passar** —vegeu la porta del C8.

**I la porta ha destapat tres defectes de la prova del C3, que mai no havia corregut.** Cap dels
tres era del producte i cap no era visible sense obrir un navegador:

- `selectOption` sobre un `SelectField`, que fa temps que no es un `<select>` natiu. Hi ha
  l'ajudant `selectFieldOption` precisament per aixo.
- `hasText` amb un regexp ancorat: l'ancora s'aplica al text **de la fila**, no al de l'etiqueta,
  aixi que `^e2e-vps` casava tambe amb `e2e-vps-nou` i la fila declarada semblava oferir un boto
  que era de l'altra.
- `getByLabel("Nom")` casant amb dos elements, perque el `?` d'ajuda del costat porta un
  `aria-label` on hi surt la paraula.

La llico es la que ja diu el document mes avall i val la pena repetir aqui: **una prova E2E escrita
i no executada no es una prova.** El `typecheck` la dona per bona i el `pnpm check` no l'obre mai.

**Un defecte de la 7.2 que impedia al modul desar cap lectura, reparat.** El
`check` de `connector_sync_runs.job_id` era de 120 caracters i l'identificador el composa BullMQ:
`repeat:connector:<tenant>:<instancia>:<operacio>:<timestamp>`, 104 caracters abans del nom de
l'operacio. Les dues de l'n8n hi cabien (119 i 120); les tres del Prometheus no (121, 122 i 125).
Cada passada petava a `startRun`, **abans** que existis la fila de run, i per tant sense deixar
rastre: ni run per tancar, ni salut per registrar, ni estat d'operacio. La integracio deia
«Activa / Sense comprovar / Mai» mentre feia dies que ho intentava cada cinc minuts.

Es la fallada silenciosa que la 7.3 existeix per acabar, i **el diagnostic guiat tampoc l'hauria
atrapada**: `lastAttempt` era null, o sigui que la cadena s'aturava a `reachable` amb un «ningu ho
ha mirat» quan la veritat era «no pot ni comencar». Un esglao que falta, apuntat per a mes
endavant.

La `0040` puja el limit a 200, la llargada que el magatzem de registres ja admet per a un
`external_id`. Ampliar un `check` accepta tot el que ja era valid, aixi que s'aplica sobre un
desplegament en marxa sense res per desfer. Aplicada a `control_hub` i a `control_hub_e2e`; la
de test (`control_hub_test`) es va quedar enrere **fins al 23 d'agost de 2026**.

Verificat sobre la base de desenvolupament: a la primera passada despres de migrar, el Prometheus
va obrir dues runs de debo i les va tancar amb `DESTINATION_NOT_ALLOWLISTED`. La integracio ara diu
que falla i per que, en comptes de dir que ningu no l'ha mirat mai.

**La Fase 8 te les sis decisions originals aprovades el 23 d'agost de 2026**, a
`docs/specifications/communications-usage-costs.md` i
`docs/development/phase-8-implementation-guide.md`. La revisio ha trobat tres ampliacions de model
noves —fonts obligatories de pressupost, valoracio de correccions i snapshots mensuals— i ha creat
`docs/specifications/phase-7b-actions-and-oauth.md` per OAuth, accions i el port IMAP. **A2 i A4
han estat aprovats el 23 d'agost de 2026.** La `0042` pertany a les etiquetes d'hosts de la fase 7.3 (C8);
la primera migracio de Fase 8 es `0043_usage_costs.sql`. **U1 ja esta entregat** a
`packages/domain/src/usage.ts`: unitats tipades,
tarifes progressives i versionades, half-up amb `BigInt`, FX racional, prioritat
`reported | rated | unpriced` i pressupostos amb precedencia `stale > partial > exceeded > warning
> healthy`, coberts per 12 proves i typecheck del paquet. **U2 tambe esta entregat**: model additiu
de fonts, events, correccions, tarifes, FX, valoracions, atribucio, pressupostos i snapshots; RLS
`enable + force`, FK compostes, evidencia append-only, deduplicacio atomica; ports d'aplicacio i
adaptador PostgreSQL; permisos separats `usage:manage` i `budgets:manage`; i flags independents
`usage_costs` i `mail`. Totes les migracions i els cinc casos PostgreSQL obligatoris han passat en
una base PostgreSQL 17 efimera. **U3 ja esta entregat**: el runtime projecta envelopes
`data.usage` estrictes despres de conservar el lot del connector, valida unitats, enters `BigInt`,
cost reportat i atribucio XOR, deduplica per font i `external_id`, i nomes avanca font i cursor quan
tot el lot acaba. `0044_usage_reported_cost.sql` conserva el cost original com evidencia. Hi ha 42
proves focalitzades de worker i 6 casos PostgreSQL executats sobre PostgreSQL 17.

**U4 ja esta entregat.** `0045_usage_valuation_controls.sql` afegeix linies immutables per
quantitat, anul.lacio one-way de FX i els permisos que faltaven al cataleg PostgreSQL. El servei
aplica `reported > rated > unpriced`, tarifes progressives, FX racional del dia UTC i revaloracions
versionades; els pressupostos propaguen `stale` i `partial` abans dels llindars i nomes creen events
en transicions. Els snapshots mensuals conserven quantitats i costos agregats i rebutgen evidencia
incompleta. La superficie `/api/v1/usage/*` esta sota `usage_costs`, documentada a OpenAPI, auditada
en mutacions i serialitza imports com enters decimals; `usage:read` elimina tot `reportedCost`.
Les migracions i 9 casos d'integracio han passat sobre PostgreSQL 17.

**U5, primer proveidor entregat: OpenAI.** El connector build-time llegeix l'API oficial de consum
de l'organitzacio amb clau administrativa, pagina dins de cada passada i projecta nomes quantitats
diaries per projecte, model, batch i tier. Rellegir una finestra solapada es idempotent pels
identificadors deterministes. No desa prompts, respostes, payload cru, tarifes ni costos agregats
que no es poden reconciliar amb el grup de model. Te fixture anonimitzada de l'API 2020-10-01 i
proves de paginacio, camps absents, 429, 5xx, health i redaccio del secret.

**U5 completada amb Anthropic.** Llegeix l'Admin Usage API oficial amb clau administrativa i
agrupa per workspace, model, tier i finestra de context. Input sense cache, cache write de 5m,
cache write d'1h, cache read, output i web search son events separats amb SKU estable: preservar
aquesta diferencia es el que permet tarifes reproduibles. Com OpenAI, pagina dins de la passada,
rellegeix una finestra solapada, no desa contingut ni payload cru i no reparteix un cost agregat
entre events que el proveidor no permet reconciliar. OpenAI i Anthropic tenen commits independents,
fixtures anonimitzades versionades, health checks i contract tests.

**U6 ja esta implementada.** La sidebar incorpora el grup propi `Consum i costos`, separat de les
despeses recurrents, amb Resum (`/{locale}/usage`), Costos (`/usage/costs`) i Pressupostos
(`/usage/budgets`) sota la flag `usage_costs`. Resum mostra volum, cobertura i l'ultima passada
completa de fonts reals; no inventa salut a partir de l'existencia d'events. Technical nomes rep
volum i frescor amb `usage:read`; imports i pressupostos nomes es consulten amb `financials:read`,
i les accions nomes apareixen amb `budgets:manage`. Els estats parcials i obsolets expliquen la
dada o font que falta en text. U6 afegeix `GET /api/v1/usage/sources`, tenant-scoped, i proves de
permisos, precisio `BigInt`, cobertura, OpenAPI i PostgreSQL. L'E2E autenticat sobre la pila
3002/4002 comprova login amb MFA, les tres rutes i el contracte real de fonts.

**U7, plugin global d'OpenCode, esta implementat.** Cada dispositiu crea una instancia
`opencode`, rep un endpoint i un secret d'un sol us visual, i envia lots HMAC per HTTPS cap a la
VPS. Una sola ordre instal·la i vincula `@control-hub/opencode`; el plugin escolta `session.idle` i
reconstrueix IDs, proveidor, model, tokens i projecte pseudonimitzat. Prompts, respostes, reasoning
textual, codi, paths, diffs i ordres no surten del dispositiu. L'API aplica anti-replay i encua la
inbox; el worker revalida, deduplica i projecta consum abans de marcar-la processada. El collector
loopback anterior queda com a fallback. El runbook es `docs/runbooks/connect-opencode.md`.
Passen lint, typecheck dels 14 paquets, 24 tasques de proves, migracions PostgreSQL, build dels 14
paquets i l'E2E autenticat d'Integracions (3/3). La suite E2E global conserva dos errors aliens a
U7: una assercio de text d'Infraestructura i la ruta Usage sense el feature flag del runner.
**M1, M2, M3 i M4 estan implementats a la branca compartida.** IMAP, Gmail i Microsoft Graph projecten
correu entrant incremental a `support_inbound_messages`, de forma idempotent i amb remitents
desconeguts en estat `pending`. Gmail i Graph usen OAuth delegat de nomes lectura: `state` d'un sol
us, PKCE S256, tokens xifrats amb context de proposit, jobs sense secrets i renovacio concurrent
protegida per lease i compare-and-swap. Els clients OAuth es configuren per instal·lacio segons
`docs/runbooks/connect-mail.md`; la fitxa inicia el consentiment i mostra nomes metadades. El
`M3` afegeix resposta sortint des del detall del ticket amb Gmail o Microsoft Graph, confirmacio
explicita vinculada al contingut, MFA i `tickets:manage`, idempotencia persistent, transactional
outbox, execucio al worker i estats `succeeded`, `failed` o `unknown`. Un timeout de transport no
es reintenta cegament perquè el proveidor podria haver acceptat el correu. La migracio es
`0054_connector_actions_mail.sql`, la flag es `connector_actions` i les integracions OAuth
existents s'han de reautoritzar per obtenir `gmail.send` o `Mail.Send`. `M4` afegeix la safata
`/support/mail`: suggereix client per adreca sense classificar automaticament, permet crear un
ticket amb l'SLA vigent, vincular el correu a un ticket obert del mateix client o descartar-lo.
La classificacio bloqueja la fila i importa o crea el ticket dins una sola transaccio; l'auditoria
no copia cos, assumpte ni remitent. El detall del ticket mostra tambe l'estat persistent de
lliurament de cada resposta. El contracte es `docs/specifications/support-mailbox.md` i la UI/API
nomes existeixen amb la flag `mail`.

La UI d'M4 es una safata de dues columnes: resum de remitents i assumptes a l'esquerra i lector
amb classificacio a la dreta. Els pendents tenen seleccio multiple i descart massiu de fins a
100 files, atomic i auditat. El selector de correu sortint ja no depen del cataleg general
d'Integracions: `/api/v1/support/mail-senders` retorna nomes Gmail/Graph habilitats amb grant OAuth
actiu, sota `tickets:read`, sense exposar configuracio ni credencials.
El lector i la llista tenen alcada lligada al viewport i scroll independent; suggeriment, client,
desti, prioritat o ticket, classificacio i descart comparteixen una sola linia a la barra superior
de la safata. La resposta externa conserva la confirmacio obligatoria d'M3, pero ara
la presenta en un dialeg modal: "Revisar" nomes prepara i "Confirmar i enviar" crea la peticio
persistent. Un intent de revisio no es mostra com un enviament.

Validacio M4 observada: typecheck d'application, persistence, API, i18n i web; 7/7 proves unitaries
de la bustia i proves d'integracio PostgreSQL de deduplicacio, tenancy, classificacio atomica i
descart massiu. L'E2E autenticat no ha arribat a M4 perquè el setup local no ha mostrat el repte
TOTP; continua sent porta de CI abans de considerar l'increment publicable.

La migracio `0055_connector_oauth_redirect_path_constraint.sql` corregeix la restriccio de
`redirect_path` publicada a `0050`: PostgreSQL no admetia el quantificador `{1,500}` i impedia
crear qualsevol intent OAuth. La longitud queda separada en `char_length` i la regex conserva
l'allowlist de caracters.

Els relays OAuth i d'accions utilitzen IDs BullMQ `oauth-<uuid>` i `action-<uuid>`. BullMQ refusa
els dos punts als custom job IDs; el format anterior deixava l'intent en `received` amb l'outbox
pendent encara que el consentiment del proveidor hagués acabat correctament.

**Redisseny de Jornada integrat a `develop`.** L'arquitectura d'informacio
aprovada separa quatre subseccions a la sidebar: Resum, Calendari, Registre i Equip. Resum es la
porta d'entrada amb fitxatge, temps d'avui i del mes, proxims dies i sol·licituds; Calendari mostra
els dotze mesos de l'any seleccionat amb llegenda accessible i accions; Registre conserva el detall
mensual professional; Equip conserva conciliacio, aprovacions i exportacio, i nomes existeix amb
`attendance:manage`. Les rutes noves son `/attendance`, `/attendance/calendar`,
`/attendance/records` i `/attendance/team`.

El calendari personal ara pot llegir els festius amb `attendance:record`; crear-los i eliminar-los
continua exigint `attendance:holidays`. Abans la UI prometia festius a qualsevol membre pero el GET
els amagava als qui no podien administrar-los.

La seleccio de dies del calendari crea sol.licituds de vacances o absencia amb un interval inclusiu.
Totes dues neixen `pending`; nomes `attendance:vacations` les pot aprovar o rebutjar i una absencia
no modifica el calendari fins que queda aprovada. La migracio `0038` afegeix estat, aprovador i
instant de resolucio a les absencies; la `0037` ja esta gastada per l'inventari de hosts de la 7.2 i
la `0039` pels tipus d'alerta. La consulta global i la cancel.lacio aliena queden igualment darrere el permis de gestio, de
manera que un membre ordinari nomes veu i cancel.la les seves peticions.

Verificat despres d'incorporar els canvis de dependencies de `develop`: migracio sobre PostgreSQL
de verificacio; lint i format globals; typecheck, suite completa i build dels 13 paquets; 111
proves web, 94 proves API, 26 proves d'aplicacio de jornada, 32 de domini i 178 d'integracio de
persistencia; i l'E2E autenticat de jornada **6/6**, inclosa la seleccio d'interval i el formulari
preemplenat.

**L'entrega 7.2 esta implementada sencera i integrada a `develop`: el B1, el B2, el B3 i els dos
commits del B4.** La 7.1
esta tancada: la planificada (A1-A6), els A7-A9 que van sortir d'usar-la, i el merge a `develop`
amb els dos gates en verd.

**Fet del 7.2:**

| # | Que hi ha | On |
|---|---|---|
| B1 | Connector `prometheus`: `pull_host_metrics`, `pull_container_state` i `pull_probe_state`, totes forma `state`, amb els seus contract tests i les paraules del connector en `ca`, `es` i `en` | `packages/connectors/src/built-in/prometheus.ts` i el seu test, `packages/connectors/src/index.ts`, `packages/i18n/src/index.ts` |
| B2 | Inventari declarat: migracio `0037` amb `infra_hosts` i `infra_services`, els casos d'us amb els seus permisos, la implementacio contra PostgreSQL i vuit rutes sota `/api/v1/infrastructure` | `packages/database/migrations/0037_infrastructure_hosts.sql`, `packages/application/src/infrastructure.ts`, `packages/persistence/src/infrastructure-repository.ts`, `apps/api/src/routes/infrastructure.ts`, `apps/api/src/problem.ts`, i els seus tests |
| B4 (1/2) | La lectura del tauler tecnic: `currentReading` al domini amb la tercera resposta `unknown`, els pressupostos llegits dels manifests, `GET /api/v1/infrastructure/inventory` amb la resposta escrita camp a camp, i l'OpenAPI del modul complet | `packages/domain/src/infrastructure.ts`, `packages/application/src/infrastructure.ts`, `packages/persistence/src/infrastructure-repository.ts`, `apps/api/src/routes/infrastructure.ts`, `apps/api/src/app.ts`, `apps/api/src/openapi.test.ts`, i els seus tests |
| B3 | Les tres regles d'infraestructura al motor pur: `service_down`, `certificate_expiring` i `backup_stale`, amb la migracio `0039` que amplia els `check` de `kind` i de target, i l'inventari i les operacions noves arribant a l'escombrada | `packages/domain/src/infrastructure.ts`, `packages/application/src/infrastructure.ts`, `packages/database/migrations/0039_infrastructure_alert_kinds.sql`, `packages/persistence/src/infrastructure-repository.ts`, `apps/api/src/routes/infrastructure.ts`, `apps/web/src/lib/api-types.ts`, i els seus tests |
| B4 (2/2) | La pantalla: la seccio de maquines amb les xifres de cada host i la taula de serveis, els dialegs per declarar-los i corregir-los, les paraules en `ca`/`es`/`en`, i l'E2E de les tres respostes sobre una llavor amb Prometheus | `apps/web/src/lib/infrastructure.ts`, `apps/web/src/lib/api-types.ts`, `apps/web/src/components/infrastructure-workspace.tsx`, `apps/web/src/app/[locale]/infrastructure/page.tsx`, `apps/web/src/app/styles.css`, `packages/i18n/src/index.ts`, `apps/api/src/seed-e2e.ts`, `tests/e2e/`, i els seus tests |

**El que el B1 deixa decidit i no s'ha de tornar a decidir.** La **PromQL es constant**: cap valor
de la configuracio entra mai en una URL, i `hostLabels`, `containerJob` i `probeJob` filtren el
resultat ja parsejat. Aixo tanca la injeccio de PromQL, l'escapada de regex d'una etiqueta escrita
en un formulari i el "cap secret a una query string" alhora, i una prova ho exigeix en comptes de
confiar-ho a un habit. De Prometheus se'n desa **una projeccio nomenada camp a camp**, mai el joc
d'etiquetes: una etiqueta que algu afegeixi a un `scrape_config` no arriba a cap registre. Una
resposta de mes de 1.000 series o una passada de mes de 500 registres **falla en comptes de
truncar-se**, perque en una operacio `state` retornar el que hi cabia caducaria la resta — el mateix
argument que el pressupost de pagines d'n8n. La credencial es **opcional**: sense token es crida
igualment i sense capcalera, un token pelat viatja com a `Bearer` i un valor que ja nomena el seu
esquema viatja tal qual, de manera que un proxy amb autenticacio basica no obliga ningu a fer base64
a ma; nomes s'atrapa `CREDENTIAL_MISSING`, perque un anell de claus trencat disfressat de crida
anonima informaria d'un `401` que no es el problema. I l'usuari i la contrasenya d'un target sondat
**es treuen abans** que allo sigui un `externalId`, que va a la base i a una pantalla.

Els noms de codi que el connector llenca son **interns**: `RESPONSE_TOO_LARGE` i companyia arriben
al runtime com a `INVALID_RESPONSE`, exactament com el `TOO_MANY_PAGES` d'n8n, de manera que el B1
**no toca** el vocabulari tancat de `@control-hub/domain` ni les frases d'error de l'i18n.

**El B1 si que toca `packages/i18n`, i el pla deia que no.** Registrar un connector obliga a donar-li
nom, descripcio i etiqueta de cada camp en les tres llengues: `packages/i18n/src/index.test.ts`
recorre el registre i falla si en falta cap. Aquella porta **no existia** el 12 d'agost, quan l'A4 va
entrar n8n amb un "i res mes"; va arribar el 14 amb la pantalla de cataleg. Sense les paraules,
l'increment deixaria `pnpm check` en vermell, i el pla demana que cada increment el passi pel seu
compte. Queda anotat al pla d'increments de l'especificacio.

**Encara no el fa servir ningu**, igual que n8n el dia que va entrar: cal una instancia creada des
de la pantalla d'integracions i la flag `infrastructure` oberta perque el reconciliador li programi
res. La marca del cataleg cau al connector generic fins que el B4 li'n dibuixi una. Els seus
contract tests van contra fixtures escrites del contracte documentat de l'API HTTP v1, **no
capturades de la VPS**.

**Les dues precondicions del 7.2 que no son codi ja estan fetes** el 20 d'agost de 2026, i
verificades a la VPS: el `blackbox_exporter` desplegat —el job `blackbox` esta `up` amb dos
targets— i l'escript de backup emetent
`control_hub_backup_last_success_seconds{backup_job="hub-vps-daily"}` al textfile collector, visible
tant al `node-exporter` com a Prometheus. El valor de `backup_job` segueix la convencio
`<maquina>-<que>`, perque dues maquines amb el mateix valor fusionarien series i el `max` amagaria
la que esta morta. Sense elles, `certificate_expiring` i `backup_stale` haurien quedat `starved` —
visibles, no silencioses.

**El que el B2 deixa decidit.** `hostname` es **obligatori i unic**: es l'unica manera de comparar
un host declarat amb una lectura, i esta acotat als mateixos 190 caracters que el connector imposa
a `hostLabels`. **`kind` diu que es el servei i `match_key` com s'observa**, i son dues columnes
perque el Postgres d'un Supabase autoallotjat es una base de dades que cAdvisor veu com un
contenidor; `match_key` es l'`external_id` sencer, prefix inclos, i es unic sense el `kind` a dins.
**`expected_state` te tres valors i tots tres els avalua el B3**: `up`, `stopped` —un servei que ha
de quedar-se aturat i del qual volem saber si torna— i `ignored`. I **un host no s'esborra**: no es
una ruta que falti, es el `grant`, com a `infra_alert_events`.

**El que el B3 deixa decidit.** El `dedupKey` de les tres regles **es l'identificador mateix** —el
`match_key` d'un servei, l'`externalId` d'una sonda o d'un backup— i no un prefix nou al davant:
`dedup_key` i `match_key` estan acotats tots dos a 200 caracters, i `service:<match_key>`
desbordaria en silenci. **Un servei es "amunt" quan la seva lectura s'ha refrescat dins el
pressupost i cap boolea diu el contrari**: `connector_records` es estat sobreescrit, o sigui que un
contenidor aturat no perd la fila, deixa d'avancar-li el `last_seen_at`; els booleans que
contradiuen son `success` i `scrapeUp` d'una sonda i `active` d'una automatitzacio. El mateix
`freshness_seconds` s'aplica a dos nivells: si tota l'operacio es rancia la regla queda `starved` i
no diu res de ningu, i nomes amb la passada fresca una lectura sense refrescar vol dir que **aquella
cosa** ha marxat.

**Una regla llegeix una instancia, i el prefix del `match_key` decideix quins serveis li toquen.**
Un tenant amb Prometheus i n8n en te dues i pot declarar serveis de totes dues; sense filtre, cada
regla dispararia pels serveis de l'altra. No ha calgut cap columna: el prefix diu quina operacio
observa la cosa i una instancia que executa aquella operacio hi te fila a
`connector_operation_state`.

**L'absencia vol dir dues coses oposades, i queden separades.** Per a `service_down` l'absencia
**es** l'alerta, que es la decisio 1 de l'especificacio. Per a `certificate_expiring` i
`backup_stale` no hi ha res que declari que hauria d'existir, aixi que sense cap lectura amb
certificat o sense cap registre `backup:` la regla queda **`starved`, no verda** — que es
exactament el que passaria si l'escript de backup de la VPS no emetes l'etiqueta `backup_job`.

**El que la primera meitat del B4 deixa decidit.** **Hi ha una sola nocio de "caigut"**: el tauler i
la regla `service_down` conclouen amb el mateix nucli del domini, i el que el tauler hi afegeix es
una **tercera resposta**. `unknown` es haver perdut de vista el col·lector, i `down` queda reservat
per a una passada que si ha corregut i no ha trobat allo — dibuixar un Prometheus mut com vint
maquines caient alhora seria mentir exactament quan mes falta fa la pantalla. **El pressupost surt
del manifest** (`everySeconds` per tres passades) i no de cap fitxer de `apps/web`, de manera que un
col·lector amb una altra cadencia no obliga a tocar la pantalla. **El tauler diu el que veu, no el
que algu esperava**: un servei declarat `stopped` es llegeix `down` i es la pantalla qui hi posa
"esperat" al costat. I **la resposta porta una llista blanca de camps per prefix**, segona tanca
darrere la projeccio que el connector ja escriu, perque el camp que un col·lector futur publiqui no
arribi a un navegador pel sol fet d'existir.

**El B4 en toca quatre paquets mes que la seva fila, i per una rao sola: no existia cap lectura.**
Les vuit rutes del B2 tornen l'inventari declarat i prou, aixi que sense
`GET /api/v1/infrastructure/inventory` el "dashboard tecnic" seria una llista de noms que la dada no
pot contradir mai. **Les vuit rutes del B2 tampoc eren a l'OpenAPI**: la llista del test es un
whitelist i ningu comprovava que fos completa. Ara hi son, i una prova falla si algu declara una
ruta d'infraestructura i no l'apunta.

**El que el segon commit del B4 deixa decidit.** **La pantalla no torna a decidir res**: `state`
viatja tal com l'API l'ha conclos i el navegador el dibuixa, de manera que no hi ha dues nocions de
"caigut" per divergir. D'aixo se'n despren la decisio que costa mes d'explicar i menys de defensar
un cop escrita: **maquines i serveis no porten segona insignia d'antiguitat**. El
`staleAfterMinutes = 45` de `apps/web/src/lib/infrastructure.ts` esta calibrat per a
`pull_workflows` —tres passades de quinze minuts— i posar-lo al costat d'un estat ja jutjat contra
el pressupost del manifest seria una segona opinio sobre la mateixa pregunta, sovint la contraria:
un contenidor amb pressupost de 900 s pot ser perfectament viu als 46 minuts. Els automatismes, que
no tenen estat observat, si que la conserven, perque alli l'edat es tot el que hi ha.

**La llista de xifres es tancada i viu a `apps/web/src/lib/infrastructure.ts`**: la mateixa regla que
la llista blanca per prefix de l'API, aplicada al costat del cable on hi ha el navegador. Un camp que
ningu ha posat a la taula no es dibuixa, i una prova ho exigeix ficant una adreca i un token dins la
lectura i comprovant que no surten. Les xifres i les edats **es calculen al servidor contra un sol
instant**, com ja feia l'edat de les automatitzacions, perque el "ara" del client no es el del
servidor i la diferencia es una discrepancia d'hidratacio. Un valor de la forma equivocada es
descarta en comptes de dibuixar-se: una xifra que ningu pot creure es pitjor que cap xifra. I un
uptime i l'hora en que un contenidor va arrencar es diuen amb **les mateixes paraules** que
qualsevol altra edat; nomes el certificat, que mira endavant, te vocabulari propi, i un que ja ha
caducat ho diu amb paraules en comptes de comptar enrere.

**Una maquina es una targeta, no una fila.** Una sonda i un host no comparteixen cap xifra, i una
taula unica els dibuixaria mig buits; els serveis d'un host si que son una taula, perque entre ells
si que es comparen. Els botons de declarar i corregir nomes existeixen amb `infrastructure:operate`,
i un servei que es mou de host es un servei que observa una altra cosa, aixi que el `hostId` nomes
viatja en crear-lo.

**La llavor d'E2E porta un Prometheus amb inventari, lectures i estat d'operacio**, perque
`unknown` nomes es pot sembrar deixant una operacio **sense cap fila** a
`connector_operation_state`: no es un valor que es pugui escriure a la base, es l'absencia d'una
passada. Es l'unica manera que la pantalla ensenyi les tres respostes alhora.

**El seguent pas es tancar la 7.2 i fusionar-la.** Falta la porta que no s'ha pogut passar en
aquesta sessio: `pnpm check:e2e` sobre base `_e2e` neta i sembrada, que ara hauria de ser **28/28**
—la prova nova de les tres respostes—, perque aquesta sessio no te la pila de verificacio en peu.
La resta de `pnpm check` si que esta passada sobre els tretze paquets: `lint`, `format:check`,
`typecheck`, `test` i `build`. Despres, fusionar `claude/prometheus-connector-b1-qi1uvt` a
`develop` amb `--no-ff`, per no aixafar els quatre increments en un de sol.

**El que queda per cablejar la instancia de debo, i no es codi.** El `hostname` d'un host declarat
ha de ser **l'etiqueta `instance`** —`node-exporter:9100`—, la mateixa cadena que va a `hostLabels`,
i no el nom de la maquina: el connector no llegeix cap etiqueta `host`. Els `external_labels` d'un
`prometheus.yml` **no surten a les consultes locals**, nomes a federacio, `remote_write` i alertes,
de manera que declarar-hi `host: vpsia` no falla, simplement no distingeix res; per a mes d'una
maquina tampoc cal cap `relabel_config`, perque dos `node-exporter` ja son dos `instance`. Queda
escrit a `docs/specifications/infrastructure.md`. Els jobs de la VPS son `node`, `cadvisor`,
`blackbox` i `prometheus`, i Prometheus segueix tancat a `127.0.0.1:9090` sense autenticacio, o
sigui que la instancia haura d'anar per `CONNECTOR_INTERNAL_ALLOWLIST` i sense credencial.

**Un buit conegut i no bloquejant:** dels crons de la VPS, nomes el backup diari emet metrica. El
backup del joc i la prova de restauracio setmanal son invisibles per al Control Hub; seguint la
convencio serien `hub-vps-aigioh` i `hub-vps-drill`, i cadascun voldria un servei declarat amb
`match_key` `backup:<aquell valor>`. Una prova de restauracio que deixa de correr en silenci es
exactament el que `backup_stale` existeix per dir.

El xoc de numeracio que l'A9b va provocar ja esta resolt: l'A9b-1 va gastar la `0036` per al permis
d'esborrat, aixi que **l'inventari de hosts es la `0037`**, renumerat a `infrastructure.md` abans
d'escriure-la i no despres d'aplicar-la. La `0038` la va gastar el redisseny de Jornada, o sigui que
els tipus de regla nous son la **`0039`**. Amb el B3 dins, les migracions van de la `0001` a la
`0039` sense cap numero repetit.

**El B2 tambe toca `packages/persistence`, que la fila del pla no nomenava.** Es on viu
`PostgresInfrastructureRepository`: sense implementacio les rutes no tenen res al darrere, i les
proves d'RLS que el criteri 9 exigeix son les d'aquell paquet. Queda anotat al pla d'increments.

**El B3 en toca quatre mes que la seva fila, i pel mateix motiu.** La `0039` perque la `0035` ja
deia que la 7.2 ampliaria aquell `check`; `packages/persistence` perque `readEvaluationState`
llegia nomes `pull_executions` i cap servei, i unes regles correctes als tests i mortes en
produccio serien el pitjor resultat possible; i una linia a `apps/api` i una a
`apps/web/src/lib/api-types.ts` perque la llista de tipus de regla ara **surt d'una constant del
domini** (`alertRuleKinds`) que la ruta escampa, de manera que no queden dues llistes per divergir.

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
- UI de gestio global de festius i bloquejos: nomes hi ha API i domini. El calendari personal ja
  mostra l'any complet i permet sol·licitar vacances i absencies, pero administrar el calendari
  global continua pendent.
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
- **`connectorHealth` no la crida ningu.** La funcio de domini que pesa la comprovacio de salut i
  les passades recents com a **evidencia** (`packages/domain/src/connectors.ts`) esta escrita i
  provada, i el cami de lectura no la fa servir enlloc: `instanceResponse` envia la columna
  `health_status` crua. Com que una passada correcta no escriu salut a proposit, i la comprovacio
  **nomes s'encua des de l'API** i mai periodicament, una integracio que fa hores que llegeix be
  segueix dient "fallando" amb l'error de l'ultima comprovacio fins que algu prem el boto — just a
  sobre d'una llista de passades que diu "correcta". Es la mateixa mena de contradiccio que la
  comprovacio guiada va neixer per matar, i li falta la ultima passa. Connectar-la vol una lectura
  nova de les ultimes passades per instancia i, per al senyal del circuit, moure `CircuitStore` de
  `apps/worker` a un paquet que l'API pugui importar: es una feina propia, no un afegit.

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
- Jornada separa Resum, Calendari, Registre i Equip (aquest darrer nomes amb
  `attendance:manage`). Calendari es anual i conserva l'any a la URL; Registre i Equip son
  mensuals. Les taules de dies, moviments i equip reutilitzen `SmartDataTable`, amb ordre
  recent-primer, filtres, paginacio i configuracio de columnes.
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
