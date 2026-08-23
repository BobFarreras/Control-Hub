# Especificacio de la Fase 7B: accions, OAuth i transport de bustia

**Estat: aprovada pel propietari el 23 d'agost de 2026.**

**Abast deliberat:** nomes la plataforma que la Fase 8 necessita per autoritzar Gmail i Microsoft
Graph, llegir IMAP i enviar correu com una accio confirmada. No implementa xarxes socials, MCP,
accions d'infraestructura ni un constructor generic d'automatitzacions.

## Problema

El contracte actual nomes sap llegir (`operations`) i rebre (`ingress`). Una operacio retorna
registres amb cursor; no pot representar una ordre amb confirmacio, idempotencia i resultat. El
vault actual segella credencials estatiques, pero no existeix authorization code, PKCE, `state`,
refresh ni revocacio OAuth.

IMAP tampoc cap al contracte actual: `ConnectorContext` nomes ofereix HTTP i donar un socket generic
al connector destruiria la guarda SSRF, els limits de protocol i la capacitat d'auditar destins.

## Objectius

- Autoritzar un compte OAuth2 sense exposar code verifier, access token ni refresh token.
- Renovar tokens amb concurrencia segura i detectar revocacio.
- Declarar accions allowlistades al manifest i executar-les sempre via outbox i cua.
- Garantir que una idempotency key representa un sol efecte extern.
- Representar un timeout posterior a un possible enviament com `unknown`, mai com `failed`.
- Llegir IMAP mitjancant un port tipat i restringit, no amb sockets arbitraris.

## Fora d'abast

- Device code flow, implicit flow, client credentials o password grant.
- Delegacio tenant-wide de Google Workspace o Microsoft 365.
- Accions configurades en runtime o codi carregat com a plugin.
- Accions destructives d'infraestructura.
- SMTP directe fora del connector de correu aprovat.
- POP3, Exchange Web Services o autenticacio IMAP basica sense TLS.
- Guardar cossos de correu dins de l'outbox generic.

## OAuth2 authorization code amb PKCE

### Declaracio del connector

Un connector OAuth declara al manifest:

- proveidor i authorization/token/revocation endpoints fixos i allowlistats en build-time;
- scopes exactes que necessita cada capacitat;
- credential kinds que produeix;
- si el proveidor rota refresh tokens;
- callback path estable del producte.

Els endpoints no arriben des del body del tenant. Qualsevol endpoint configurable passa igualment
per la guarda SSRF i no pot canviar entre authorize, exchange i refresh.

### Inici

`POST /api/v1/integrations/:instanceId/oauth/authorizations` exigeix `integrations:manage`, MFA i
una instancia del tenant. El servidor:

1. genera `state` i `code_verifier` amb CSPRNG;
2. desa nomes `state_hash`, expiracio, membership, instancia, scopes i redirect final intern;
3. segella el verifier amb el mateix primitive AES-256-GCM i anell de claus del vault, amb AAD que
   inclou tenant, instancia, intent i el proposit `oauth-pkce`;
4. deriva `code_challenge` amb S256;
5. retorna l'authorization URL del manifest.

`state` dura deu minuts, es d'un sol us i mai apareix en logs. El redirect final es una ruta
interna allowlistada; no s'accepta una URL arbitraria per evitar open redirect.

### Callback

Ruta publica estable:

```text
GET /api/v1/integrations/oauth/callback/:connectorType
```

El callback valida forma i limits, calcula el hash de `state` i consumeix l'intent atomicament.
Un `state` desconegut, expirat o reutilitzat retorna un error generic i no revela cap instancia.

Si el proveidor retorna `error=access_denied`, l'intent queda `canceled`, no s'encua cap exchange i
el navegador rep un `303` a la pantalla interna d'integracions amb un codi estable. Altres errors
queden `failed` amb una categoria redactada.

Si arriba `code`, l'API el segella amb AAD de proposit `oauth-code`, marca l'intent `received`,
escriu outbox i respon `303`. **L'API no contacta el proveidor.** El worker obre code i verifier
just-in-time, fa l'intercanvi i desa els tokens al vault existent. Ni code ni verifier entren al
job; el job nomes porta l'ID de l'intent.

La ruta de callback i el reverse proxy no registren query strings: l'authorization code arriba per
la URL encara que visqui pocs minuts, i un access log el convertiria en una credencial persistent.
Referer policy impedeix propagar aquella URL al redirect intern.

La callback URI es exacta i deriva de la configuracio d'instal.lacio validada. No es confia en
`Host`, `Forwarded` o query params per construir-la.

### Tokens i metadata

- Access i refresh token son `connector_credentials` segellades amb kinds separats.
- La resposta de l'API nomes mostra scopes, `expires_at`, `last_refreshed_at`, estat i proveidor.
- Un ID token no s'utilitza com a credencial d'API; si no es necessari, no es desa.
- Si el proveidor retorna un refresh token nou, la substitucio es atomica: el nou sobre queda
  escrit abans de retirar l'antic dins la mateixa transaccio empresarial.
- Cap token entra a payloads BullMQ, logs, traces, auditoria, problem details ni respostes.

### Refresh concurrent

Abans d'usar un access token, el worker comprova l'expiracio amb marge configurable de rellotge.
Si cal renovar:

1. adquireix una lease PostgreSQL per tenant, instancia i credential kind;
2. rellegeix la versio: un altre worker pot haver renovat mentre esperava;
3. obre el refresh token just-in-time i crida el token endpoint;
4. desa la nova versio amb compare-and-swap;
5. allibera la lease.

Una lease expira per recuperar workers morts. Errors transitoris tenen retry limitat. `invalid_grant`
o revocacio marquen la grant `reauthorization_required` i no entren en bucle. Un connector amb la
grant caducada o revocada no executa operacions i informa l'estat.

### Revocacio

`DELETE /api/v1/integrations/:instanceId/oauth/grant` exigeix confirmacio, MFA i
`integrations:manage`. Crea una accio asincrona de revocacio:

- si el proveidor confirma, els sobres queden revocats i il.legibles per al runtime;
- si respon que ja no existeix, el resultat local tambe es `revoked`;
- si hi ha timeout, queda `unknown` i no s'esborra el token fins reconciliar o confirmar de nou;
- revocar localment sense poder contactar el proveidor requereix una segona confirmacio i
  auditoria diferenciada.

## Contracte d'accions

### Manifest

`CapabilityManifest` afegeix `actions`, separat d'`operations`:

```ts
type ActionDeclaration = {
  permission: Permission;
  confirmation: "explicit";
  requiresMfa: boolean;
  reversible: boolean;
  retry: "before-delivery-only" | "idempotent-provider";
};

type CapabilityManifest = {
  egress: EgressPolicy | null;
  operations: Readonly<Record<string, OperationDeclaration>>;
  actions: Readonly<Record<string, ActionDeclaration>>;
  ingress: boolean;
  mailbox: MailboxPolicy | null;
};
```

La definicio implementa un handler per cada accio declarada i cap altra. L'input es valida amb un
schema tancat del connector. El nom d'accio, permis, reversibilitat i politica de retry venen del
manifest; el client no els tria.

### Confirmacio vinculada al contingut

La UI demana una confirmacio explicita. L'API emet un nonce curt i single-use vinculat al digest de
tenant, membership, instancia, accio i input. En executar, recalcula el digest. Un boolea
`confirmed: true` enviat pel client no te cap valor.

`requiresMfa` exigeix una prova MFA recent segons la politica de sessio. Tenir el permis no
substitueix MFA, i MFA no substitueix el permis.

### Outbox i idempotencia

`POST /api/v1/integrations/:instanceId/actions/:action` exigeix una `Idempotency-Key` amb format i
longitud limitats. Dins una transaccio:

1. resol tenant i permisos;
2. valida manifest, input, confirmacio i MFA;
3. crea `connector_action_requests` i outbox;
4. respon `202` amb l'ID i estat `queued`.

Unique `(tenant_id, instance_id, action, idempotency_key)`. Repetir la mateixa clau i digest retorna
la peticio existent; repetir-la amb input diferent retorna `409 IDEMPOTENCY_KEY_REUSED`.

L'input sensible es segella amb el primitive del vault sota un proposit diferent
`connector-action-input`. El job nomes porta l'ID. Per correu, l'accio referencia
`mail_delivery_id`; el cos continua a suport i el worker construeix l'input just-in-time.

### Execucio i estats

Flux vinculant:

```text
usuari confirma
  -> API valida permis i MFA
  -> outbox PostgreSQL
  -> cua
  -> worker obre credencial i input just-in-time
  -> connector executa l'accio declarada
  -> resultat persistent
  -> auditoria
```

Estats: `queued | running | succeeded | failed | unknown | canceled`.

- Error abans d'intentar lliurar: `failed`, amb retry si es transitori.
- Resposta definitiva del proveidor: `succeeded` o `failed`.
- Timeout, connexio tallada o resposta il.legible despres que el proveidor pugui haver acceptat:
  `unknown`, mai `failed`.
- `unknown` no es reintenta automaticament tret que el proveidor admeti idempotency key propia o
  una operacio de reconciliacio demostri que no va passar.

El resultat public conserva identificador extern, timestamps i codi estable; mai cos cru del
proveidor. L'auditoria registra actor, tenant, instancia, accio, idempotency key hash, resultat i
correlation ID, amb input redactat.

## Transport IMAP

### Port `mailbox` tipat aprovat

Es proposa afegir un port d'alt nivell `MailboxPort` al `ConnectorContext`, injectat nomes quan el
manifest declara `mailbox`. **No s'exposa `net.Socket`, `tls.Socket`, callbacks de bytes ni una
funcio `connect(host, port)` generica al connector.**

El port ofereix operacions acotades:

```ts
type MailboxPort = {
  listFolders(): Promise<readonly MailFolder[]>;
  changes(input: MailCursor): Promise<MailChangePage>;
  message(input: MailMessageRef, limits: MailReadLimits): Promise<MailMessage>;
};
```

L'adaptador del worker posseeix socket, DNS, TLS, autenticacio, timeouts, limits de bytes, nombre de
missatges i concurrencia. El connector IMAP nomes transforma carpetes i missatges al contracte
normalitzat.

`MailboxPolicy` declara ports permesos i mode TLS. Per defecte nomes `993` amb TLS directe; `143`
requereix STARTTLS obligatori i aprovacio de configuracio. Plaintext queda prohibit. La resolucio
DNS aplica els mateixos bloquejos de loopback, link-local, metadata i xarxes privades que HTTP;
destins interns legitims exigeixen allowlist d'operador. Es verifica hostname i certificat, sense
cap `rejectUnauthorized: false`.

Gmail i Graph continuen usant el port HTTP existent amb OAuth. No necessiten ni reben
`MailboxPort`.

**Alternatives descartades:**

- socket generic al connector: converteix el contracte en egress arbitrari i duplica TLS, limits i
  redaccio per proveidor;
- prohibir IMAP i exigir nomes APIs HTTP: simplifica el runtime pero elimina el connector IMAP que
  la Release 1.0 promet i exclou proveidors sense API oficial;
- executar una llibreria IMAP directament dins del connector: la llibreria rebria xarxa real i el
  manifest deixaria de ser un control aplicable.

## Reutilitzacio del vault

Es reutilitzen sense reescriure:

- AES-256-GCM, anell de claus i rotacio;
- AAD amb tenant i instancia;
- sealer a API/aplicacio i opener nomes al worker;
- metadata `expires_at`, `rotated_at`, `last_used_at`, `revoked_at`;
- credential kinds separats i permisos de rotacio.

S'afegeixen:

- proposit a l'AAD per impedir moure un sobre entre credencial, PKCE, code i input d'accio;
- credential kinds OAuth per connector;
- intents efimers i grants amb estat;
- lease/version per refresh concurrent;
- sobres efimers de code verifier i authorization code amb purga curta;
- API de revocacio asincrona.

Canviar l'AAD o el format d'envelope existent exigeix ADR nova. La implementacio ha de comprovar si
el primitive actual ja admet proposit sense fer il.legibles els sobres publicats; si no, s'afegeix
una versio d'envelope, no s'edita la versio existent.

## Model de dades proposat

Els numeros s'assignen a partir de `0042` a la branca compartida quan aquesta especificacio sigui
aprovada.

- `connector_oauth_attempts`: state hash, verifier/code envelopes, scopes, actor, expiracio, consum
  i estat.
- `connector_oauth_grants`: instancia, proveidor, scopes, estat, expiracio, versio i refresh lease.
- `connector_action_requests`: accio, actor, digest, idempotency key, input envelope, estat,
  resultat, timestamps i correlation ID.
- `connector_action_outbox`: peticio, disponibilitat, intents i publicacio a cua.

Totes porten `tenant_id`, RLS `enable` + `force`, uniques compostes i grants minims. Intents OAuth,
codes i inputs d'accio tenen purga curta encara que la feature flag estigui apagada.

Els intents consumits, cancel.lats o expirats i els sobres de code/verifier es purguen al cap de 24
hores; el material segellat d'una accio es purga quan el resultat ja es terminal i ha vençut la
finestra operativa de reconciliacio. L'evidencia redactada i l'auditoria es conserven segons la
politica general, no dins dels sobres.

## API proposada

```text
POST   /api/v1/integrations/:instanceId/oauth/authorizations
GET    /api/v1/integrations/oauth/callback/:connectorType
GET    /api/v1/integrations/:instanceId/oauth/grant
DELETE /api/v1/integrations/:instanceId/oauth/grant
POST   /api/v1/integrations/:instanceId/actions/:action/confirmation
POST   /api/v1/integrations/:instanceId/actions/:action
GET    /api/v1/integrations/:instanceId/actions/:requestId
```

La callback es l'unica ruta sense sessio i nomes consumeix un `state` valid. No accepta tenant,
instance ID ni redirect URL com a autoritat.

## Errors publics

- `OAUTH_STATE_INVALID`, `OAUTH_STATE_EXPIRED`, `OAUTH_CANCELED`.
- `OAUTH_EXCHANGE_FAILED`, `OAUTH_REAUTHORIZATION_REQUIRED`.
- `ACTION_NOT_DECLARED`, `ACTION_CONFIRMATION_INVALID`, `ACTION_MFA_REQUIRED`.
- `IDEMPOTENCY_KEY_REUSED`, `ACTION_RESULT_UNKNOWN`.
- `MAILBOX_DESTINATION_DENIED`, `MAILBOX_TLS_REQUIRED`, `MAILBOX_LIMIT_EXCEEDED`.

Els detalls del proveidor queden en categories internes redactades.

## Criteris d'acceptacio

1. `state` es single-use, expira i no revela una instancia.
2. Cancel.lar al proveidor torna a Integracions sense crear grant ni job d'exchange.
3. Code, verifier, access i refresh token no apareixen a API, jobs, logs ni auditoria.
4. Dos refresh concurrents produeixen una sola versio activa i no perden un token rotat.
5. `invalid_grant` atura retries i demana reautoritzacio.
6. Una accio no declarada o sense permis, MFA o confirmacio es rebutjada i auditada.
7. La mateixa idempotency key i input executa una vegada; amb input diferent retorna `409`.
8. Un timeout posterior a possible lliurament queda `unknown` i no es reintenta a cegues.
9. Deshabilitar una instancia impedeix noves accions i refresh.
10. Un connector sense `mailbox` no rep el port, i cap connector rep un socket generic.
11. IMAP plaintext, certificat invalid i desti SSRF son rebutjats.
12. Cap fila, grant, accio o intent travessa tenants.

## Proves

- Domini: transicions OAuth/accions, digest de confirmacio i classificacio `unknown`.
- PostgreSQL: consum atomic de state, unique d'idempotencia, lease de refresh, RLS i purga.
- Worker: exchange, refresh rotat, revocacio, outbox at-least-once i timeout ambigu.
- Contracte: manifest/handler d'accions, input tancat i disponibilitat del port mailbox.
- Seguretat: SSRF IMAP, TLS, open redirect, replay de callback, logs i jobs redactats.
- E2E: autoritzacio cancel.lada, autoritzacio correcta, confirmacio i resultat d'una accio.

## Rollout i rollback

- Flags separades `connector_oauth` i `connector_actions`; `mail` no les encen implicitament.
- Migracions additives amb flags apagades.
- Apagar accions impedeix noves ordres pero el worker acaba o reconcilia les ja acceptades.
- Apagar OAuth impedeix noves autoritzacions i refresh; no esborra grants ni tokens.
- La purga de material efimer i outbox continua amb les flags apagades.

## Decisions aprovades pel propietari el 23 d'agost de 2026

1. Aprovar el flux OAuth callback -> outbox -> exchange al worker.
2. Aprovar el contracte d'accions, confirmacio vinculada al digest i estat `unknown`.
3. Aprovar el port `MailboxPort` tipat, sense socket generic, per implementar IMAP.
4. Aprovar la reutilitzacio del primitive del vault amb proposit/version d'envelope.
