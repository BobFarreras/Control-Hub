# Especificacio de la Fase 10: MCP i portal de client

**Estat: aprovada, en implementacio.** Escrita el 24 d'agost de 2026 a la branca compartida
`feature/oauth-and-agent-platform`.

El propietari va aprovar **les vuit decisions** el 24 d'agost de 2026, D1, D2, D3 i D6 primer i
D4, D5, D7 i D8 en acabat: emissor propi, tokens opacs de referencia, registre manual de clients,
la primera llista de sis tools de lectura, redirects loopback per als clients d'escriptori, trenta
minuts de vida del access token, bearer amb el risc residual declarat, i el portal de client fora
d'aquesta fase.

**No queda cap decisio oberta que bloquegi la 10.1.** El que va guiar D4 i D7 va ser el cas d'us
concret: els clients MCP d'avui --Claude Desktop, Claude Code, Codex, OpenCode-- s'autoritzen amb un
redirect a `127.0.0.1` i parlen bearer, i una regla que els deixi tots fora no protegeix res perque
no hi ha ningu a dins.

## Problema

Control Hub sap autoritzar persones davant la seva propia UI i sap ser **client** OAuth davant
proveidors externs (Fase 7B). No sap ser **servidor de recursos**: no pot rebre una peticio d'un
agent o d'una eina externa, decidir de quin tenant parla, quins permisos porta i quines capacitats
te concedides, i respondre amb el mateix resultat que hauria donat per REST o per la UI.

Sense aquesta frontera, qualsevol integracio d'agent acaba en una d'aquestes tres formes, i totes
tres son inacceptables: una clau d'API amb permisos totals, un token de proveidor reenviat cap
avall, o un servei que llegeix PostgreSQL pel seu compte.

## Objectius

- Control Hub es un **resource server OAuth 2.1** amb validacio obligatoria d'issuer, audience,
  expiracio, revocacio i scopes a cada peticio.
- Un servidor MCP que exposa **exclusivament casos d'us existents**, mai repositoris ni SQL.
- Autoritzacio tenant-scoped resolta del token i de la membership, mai de l'input de la tool.
- **Mateix resultat de permisos per REST, UI i MCP**, perque la comprovacio es la mateixa i viu al
  cas d'us.
- Auditoria per tool call, redactada, amb el mateix registre append-only que la resta del producte.
- Primera entrega **nomes amb tools de lectura**.
- **Cap passthrough de tokens** cap als connectors ni cap a proveidors.

## Abast

La fase es parteix en dos increments que no comparteixen dependencia:

- **10.1 MCP read-only** — l'unic increment que aquesta especificacio deixa implementable:
  autoritzacio, cataleg, transport, auditoria i sis tools de lectura.
- **10.2 Portal de client** — **fora d'aquesta fase** per decisio D8. Comparteix el resource server
  pero no el model d'identitat: necessita identitats externes, sessions de client i un model de
  permisos propi. La seccio "Portal de client" es queda com a material per a la fase que el reculli.

### Estat d'implementacio

- **10.1-A — nucli d'autoritat.** Implementat: la flag `mcp` registrada i apagada, i les regles
  d'autoritat a `packages/domain/src/mcp.ts` amb proves. Cap ruta, cap migracio i cap token: aquest
  increment nomes decideix, i encara no hi ha res que li pregunti.
- **10.1-B1 — cataleg de tools.** Implementat: `packages/application/src/mcp.ts` publica quatre
  tools de lectura (`crm.customers.list`, `crm.customers.get`, `support.tickets.list`,
  `support.tickets.get`), cadascuna lligada a un cas d'us que ja existeix, amb esquema d'entrada
  tancat i projeccio que retorna menys que la pantalla. Una prova d'arquitectura comprova que el
  modul no importa res mes que el domini i els seus germans. Encara no hi ha transport: ningu no
  crida el cataleg.
- **10.1-B2 — les dues tools de resum.** Implementat: `infrastructure.status.summary` surt de
  `InfrastructureService.readInventory` mes `listAlerts`, que ja guarden totes dues
  `infrastructure:read`; `usage.summary` surt de `UsageService.listSources`. Cap lectura nova, cap
  metode nou al repositori: el cataleg composa dues lectures que ja existien i en projecta el
  recompte.
- **10.1-C — l'esquema.** Implementat: `packages/database/migrations/0049_mcp_oauth.sql` crea les sis
  taules del model de dades amb RLS `enable` + `force` i politica d'aillament una per una, les cinc
  funcions `security definer` que resolen client, token, refresh, service account i codi
  d'autoritzacio abans que se sapiga el tenant, i l'ampliacio additiva de `audit_log`. La prova
  `packages/database/src/mcp-schema.test.ts` comprova els invariants sobre el fitxer, sense base de
  dades: cap taula sense `force`, cap credencial que no sigui un hash SHA-256, cap `drop`, i cap
  funcio `security definer` sense `search_path` fixat.
- **10.1-D — les regles del flux.** Implementat: `packages/domain/src/mcp-oauth.ts` amb les vides
  aprovades a D5, la coincidencia de redirect URI amb l'excepcio de loopback de D4, la negociacio
  d'scopes i el veredicte del refresh amb deteccio de reus. Pur, sense hashing i sense I/O: la
  comparacio del verificador PKCE es fa on ja hi ha crypto, no aqui.
- La resta de la fase continua sense implementar: no hi ha ni repositori, ni rutes, ni transport.

## Fora d'abast de la 10.1

- Tools d'escriptura, accions destructives i confirmacions vinculades al contingut.
- Dynamic Client Registration (RFC 7591) i client discovery automatic.
- Federacio, SAML, LDAP o un identity provider extern (`adr/0003-identity.md` continua vigent).
- Portal de client, sessions de client i identitats externes.
- Passar per MCP cap capacitat que no existeixi ja com a cas d'us autoritzat.
- Streaming de recursos MCP, prompts MCP i sampling; nomes `tools/*` i el minim de protocol.
- Qualsevol dependencia del domini d'agents de la Fase 11.

## Frontera amb la Fase 7B: dos OAuth diferents

Comparteixen vocabulari i cap altra cosa. La confusio entre els dos es una de les amenaces que
aquesta especificacio ha de tancar explicitament.

| | Fase 7B — OAuth de connectors | Fase 10 — OAuth de MCP |
| --- | --- | --- |
| Rol de Control Hub | Client | Authorization server i resource server |
| Qui emet el token | Google, Microsoft, el proveidor | Control Hub |
| Qui el consumeix | El worker, contra el proveidor | El servidor MCP, dins de Control Hub |
| On viu | `connector_credentials`, segellat AES-256-GCM al vault | `mcp_access_tokens`, nomes com a hash SHA-256 |
| Audience | El proveidor | La URI canonica del recurs MCP |
| Scopes | Els que declara el manifest del connector | Els del cataleg de tools de Control Hub |
| Qui l'obre | Nomes el worker, just-in-time | Ningu: no es desxifra, es compara un hash |
| Flag | `connector_oauth`, `connector_actions` | `mcp` |

**Regles vinculants d'aillament:**

1. Un token MCP no entra mai al vault de connectors, i una credencial de connector no s'accepta mai
   com a token MCP. Els dominis d'emmagatzematge son diferents i no hi ha cap funcio que tradueixi
   d'un a l'altre.
2. El proposit de l'AAD del vault (7B) i la taula de tokens MCP fan que un sobre mogut entre els dos
   dominis sigui il.legible o inexistent, no simplement rebutjat per una comprovacio d'aplicacio.
3. Un tool handler **no rep cap credencial**. Rep un `TenantContext` i crida un cas d'us. Si aquell
   cas d'us necessita un proveidor, es el worker qui obre la credencial, com sempre.
4. Cap scope MCP concedeix acces a un proveidor. Si un tenant no te grant de Gmail, cap token MCP
   pot llegir-ne correu, tingui l'scope que tingui.

Les dues fases comparteixen nomes primitives generiques del repositori: CSPRNG, hashing, consum
atomic de nonces i el patro de lease. Compartir codi d'aquestes primitives es correcte; compartir
taules, audiences o tokens, no.

## Model d'autoritzacio

### Emissor

**Recomanacio (decisio D1):** Control Hub es el seu propi authorization server, integrat a l'API
Fastify i acotat exclusivament a MCP. `adr/0003-identity.md` ja va decidir identitat integrada i va
descartar Keycloak per a una instal.lacio de dues persones; introduir-lo ara nomes per emetre tokens
d'agent reobriria aquella decisio a canvi de mes contenidors, backups i upgrades.

- Issuer: l'`APP_ORIGIN` validat de la instal.lacio. No es deriva de `Host`, `Forwarded` ni de cap
  query param.
- Metadata publicada segons RFC 9728 a `/.well-known/oauth-protected-resource` i RFC 8414 a
  `/.well-known/oauth-authorization-server`. Les dues nomes existeixen amb la flag `mcp` oberta.
- L'authorization server **no serveix cap altre recurs** que el MCP. Si algun dia n'hi ha un segon
  (per exemple el portal), caldra decidir formats de token i separacio d'audiences abans, no despres.

### Tokens

**Recomanacio (decisio D2): tokens opacs de referencia**, 256 bits de CSPRNG, desats nomes com a
hash SHA-256 i validats per lectura a PostgreSQL.

Motiu: authorization server i resource server son el mateix desplegament, aixi que un JWT no
estalvia cap crida i afegeix gestio de claus, rotacio de JWKS i la classe d'errors de verificacio
que ningu vol a la frontera d'un agent. Un token de referencia, a mes, **es revocable a l'instant**,
que es exactament el que `SECURITY_ARCHITECTURE.md` exigeix a les sessions.

La validacio comprova **sempre les cinc coses, encara que el token l'hagi emes aquest mateix
proces**: issuer, audience, expiracio, estat de revocacio i scopes. Aquesta redundancia es
deliberada: el dia que hi hagi un segon recurs o un emissor extern, la porta ja estara escrita.

| Token | Vida | Rotacio |
| --- | --- | --- |
| Authorization code | 60 s, single-use | — |
| Access token | 30 min | Nou a cada refresh |
| Refresh token | 30 dies | Rotacio obligatoria amb deteccio de reus |
| Grant (consentiment) | 90 dies maxim | Requereix consentiment nou |
| Secret de service account | 365 dies maxim | Rotacio amb finestra de dues claus vives |

Cap token apareix mai en logs, traces, auditoria, problem details, query strings ni respostes. Els
prefixos son distingibles (`chm_at_`, `chm_rt_`, `chm_sa_`) perque gitleaks i el secret scan els
puguin reconeixer.

### Audience i resource indicators

L'audience es la URI canonica del recurs: `${APP_ORIGIN}/mcp`. Els clients l'han de demanar amb el
parametre `resource` (RFC 8707) tant a l'authorization request com al token request.

- Un token amb audience diferent **es rebutja abans de resoldre tenant, permisos o tool**.
- Un token emes per a un altre recurs del mateix issuer no serveix per a MCP.
- La comparacio es exacta sobre la URI canonica, sense normalitzacions creatives.

### Grants suportats

- **Authorization Code + PKCE (S256 obligatori)** per a clients que actuen en nom d'un membre.
  `plain` no s'accepta mai. `code_challenge` es obligatori tambe per a clients confidencials.
- **Client Credentials** exclusivament per a service accounts (seccio propia). Sense usuari al
  darrere, sense consentiment interactiu i sense refresh token.
- Implicit, password grant, device code i qualsevol grant amb el token a la URL: **denegats**. Igual
  que a la 7B, i pel mateix motiu.

### Registre de clients

**Recomanacio (decisio D3): registre manual pel propietari, sense DCR a la 10.1.**

Un client MCP es una fila creada des de la pantalla de seguretat per algu amb `security:manage` i
sessio amb MFA fresca. Declara nom, tipus (`public` o `confidential`), redirect URIs exactes i els
scopes maxims que podra demanar.

- Els redirect URIs son de coincidencia exacta. S'admeten loopback (`http://127.0.0.1:<port>/...` i
  `http://[::1]:<port>/...`) amb path exacte i port lliure, segons RFC 8252, perque els clients MCP
  d'escriptori no tenen cap altra manera de rebre el codi. Qualsevol altre esquema ha de ser HTTPS.
- Els clients publics no tenen secret i depenen de PKCE. Els confidencials tenen secret desat com a
  hash i rotable.
- Un client suspes no pot iniciar autoritzacions ni refrescar; els seus grants queden inutilitzables
  sense esborrar-se.

El cost d'aquesta decisio es real i s'ha de dir: **els clients MCP que nomes saben registrar-se per
DCR no es podran connectar** fins que la decisio D3 s'ampli. La contrapartida es que a la primera
entrega ningu es pot registrar sol contra el nostre authorization server.

### Consentiment

La pantalla de consentiment mostra el client, el tenant, els scopes en text pla, les tools que
implicaran, la caducitat del grant i qui l'aprova. Aprovar exigeix sessio amb segon factor **fresc**
(la finestra de `freshAge`, deu minuts), com qualsevol operacio sensible del producte.

Un consentiment **no pot ampliar-se sol**: demanar un scope nou obre un consentiment nou i deixa
rastre a l'auditoria.

### Revocacio

- `POST /api/v1/mcp/oauth/revoke` (RFC 7009) per al client.
- Revocacio des de la UI de seguretat: per grant, per client, per service account o tot el tenant.
- Revocar un grant invalida a l'instant els seus access tokens: son de referencia, no cal esperar
  cap expiracio.
- Reutilitzar un refresh token ja consumit **revoca tota la familia**, no nomes aquell token, i
  genera un event d'auditoria de categoria de seguretat.
- Suspendre una membership o desactivar l'usuari revoca els grants que actuaven en nom seu. Un token
  no pot sobreviure a la persona que el va autoritzar.

## Scopes

Els scopes son **capacitats de lectura per domini**, no permisos duplicats. Deny by default: un
token sense scopes no pot fer res.

| Scope | Permisos que l'han de sostenir |
| --- | --- |
| `mcp:tools.list` | cap: llistar el que pots cridar no revela res que no puguis fer |
| `crm.read` | `customers:read` |
| `support.read` | `tickets:read` |
| `projects.read` | `projects:read` |
| `commerce.read` | `products:manage` |
| `infrastructure.read` | `infrastructure:read` |
| `usage.read` | `usage:read` |

Un scope nomes s'ofereix al consentiment si l'actor ja te els permisos que el sostenen, i un service
account no en pot rebre cap que el seu propietari no tingui.

**`mcp:tools.list` no es negocia: es concedeix sempre.** No obre cap dada --el cataleg que un token
veu ja esta filtrat al que aquell token podria cridar-- i un client registrat sense aquest scope no
podria descobrir ni una sola tool, que es una manera de registrar un client que no funciona.

`commerce.read` esta lligat a `products:manage` perque **avui el cataleg no te cap permis de nomes
lectura**. Aixo no es un detall d'implementacio: es precisament el motiu pel qual la 10.1 no publica
cap tool de comerc. Publicar-ne una obligaria a concedir un permis de gestio per llegir un preu, i
el que caldria abans es un `products:read` al cataleg de permisos, que es un canvi de la matriu de
`permissions.md` i no d'aquesta fase.

Regla de composicio, i es la que garanteix el criteri de paritat:

```text
autoritat efectiva = interseccio(
    scopes del token,
    permisos de la membership (o del service account),
    tools publicades pel cataleg,
    flags actives de la instal.lacio
  )
```

**Un scope no concedeix mai res que el permis no concedeixi.** Si el membre perd `tickets:read`, el
token deixa de poder llegir tickets el mateix instant, sense reemetre res. Al reves tambe: tenir el
permis no obre una tool si el token no porta l'scope. La interseccio es sempre la mes restrictiva, i
la comprovacio de permis segueix vivint al cas d'us, no al transport.

Els scopes d'escriptura (`*.write`) **no es declaren** a la 10.1. Un scope que ningu pot demanar es
una cosa menys que pot sortir malament; declarar-los per refusar-los despres nomes afegeix una porta
que algu hauria de recordar tancar. Quan hi hagi tools d'escriptura aprovades, entraran amb el seu
scope i amb la confirmacio vinculada al contingut que la 7B ja va definir.

## Tenant resolution

Un token pertany **exactament a un tenant**, fixat en el moment del consentiment i desat a la fila
del grant.

- El tenant no arriba mai de l'input d'una tool, ni d'una capcalera, ni del nom d'un recurs. Un
  argument que anomeni un altre tenant s'ignora i la crida es denega amb `MCP_TENANT_MISMATCH`.
- Un membre amb dos tenants necessita **dos grants**, i per tant dues autoritzacions explicites. No
  existeix cap token que travessi tenants ni cap manera de canviar de tenant amb el mateix token.
- El `TenantContext` que arriba al cas d'us es construeix a partir del grant: tenant, membership,
  rols i permisos rellegits a cada peticio (no congelats a l'emissio), mes l'actor.
- Els repositoris continuen sent tenant-scoped i la RLS continua sent la darrera porta. MCP no
  n'obre cap de nova.

### Actor

`TenantContext` avui assumeix una persona (`userId`, `membershipId`). Un service account no en te.

**Recomanacio:** ampliacio **additiva** amb un camp opcional `actor: { type: "user" | "service_account"; id: string }`, amb `type: "user"` implicit quan no hi es. Aixi cap ruta ni cas d'us existent
canvia de forma, i el codi nou pot exigir-lo. Aquesta ampliacio toca `packages/domain`, que es
compartit: veure la seccio de conflictes amb la 7B.

## Service accounts

Un service account es una identitat operativa del tenant per a clients headless (un agent, un job,
la futura Fase 11).

- El crea algu amb `security:manage` amb MFA fresca, i te **propietari** (una membership) i
  caducitat obligatoria.
- Te **scopes explicits i un conjunt de permisos propi**, mai un rol huma. `permissions.md` ja ho
  exigeix: "Service accounts tenen scopes explicits, no rols humans".
- Els seus permisos no poden superar els del propietari en el moment de crear-lo, i es reavaluen: si
  el propietari perd un permis, el service account el perd.
- MFA no aplica a una maquina; per aixo la creacio i la rotacio si que l'exigeixen a la persona.
- Secret rotable amb finestra de dues claus vives, com el vault de connectors.
- Un service account desactivat, caducat o amb el propietari suspes no obte tokens i els seus tokens
  vius es revoquen.
- A la 10.1 **cap service account pot rebre scopes d'escriptura**, perque no n'hi ha de publicades.

## Superficie MCP

- Transport HTTP a `${APP_ORIGIN}/mcp`, dins l'API Fastify, darrere el mateix proxy i les mateixes
  proteccions de la resta de l'API.
- Nomes `initialize`, `tools/list` i `tools/call`. Recursos, prompts i sampling no s'implementen.
- La sessio MCP (`Mcp-Session-Id`) queda **lligada al grant** que la va obrir. Reprendre una sessio
  amb un token d'un altre grant es un error, no una represa.
- `tools/list` retorna **nomes** les tools que aquell token pot cridar. Una tool que el cataleg no
  publica per a aquell token no existeix per a ell: ni surt a la llista ni es pot invocar.
- Sense la flag `mcp`, la ruta `/mcp` i les rutes OAuth **no es declaren**: l'API respon 404, que es
  la veritat, com ja fa `infrastructure`.

### Arquitectura

```text
Client MCP
  -> /mcp (adaptador de transport, apps/api)
      -> validacio de token (issuer, audience, expiracio, revocacio, scopes)
      -> resolucio de tenant i actor
      -> cataleg de tools (packages/application)
          -> cas d'us existent
              -> repositori tenant-scoped -> PostgreSQL + RLS
      -> auditoria per tool call
```

El modul del cataleg **no pot importar repositoris, `@control-hub/persistence`, `postgres` ni cap
client de base de dades**. Es una regla verificable, no una intencio: una prova d'arquitectura
comprova els imports del modul i falla si algu obre aquella porta.

## Cataleg de tools i versionat

Una tool es una declaracio estatica al codi, revisable en un diff:

```ts
type ToolDeclaration = {
  name: string;              // `crm.customers.list`
  version: `v${number}`;     // `v1`
  scope: McpScope;
  permission: Permission;    // el mateix que exigeix el cas d'us
  flag: FeatureFlag | null;  // el modul que l'ha de tenir obert
  mutating: false;           // a la 10.1, sempre
  input: ZodSchema;          // tancat: `strict`, sense camps addicionals
  output: ZodSchema;         // projeccio explicita, mai la fila crua
  limits: { maxItems: number; maxBytes: number };
};
```

- **Cap tool es descobreix en runtime.** No hi ha tools configurables per tenant ni carregades com a
  plugin: publicar-ne una es un canvi de codi que el propietari aprova, tal com demana el pla.
- **El nom es estable; la versio la porta el descriptor.** Un canvi compatible (afegir un camp
  opcional a la sortida) mante nom i versio. Un canvi incompatible publica `v2` i **les dues
  conviuen** durant una finestra declarada abans que la `v1` es retiri.
- La retirada d'una versio s'anuncia al descriptor (`deprecatedSince`, `removeAfter`) i queda a
  `tools/list` fins que expira.
- Els contract tests fixen nom, versio, schema d'entrada i forma de sortida. Un canvi que els trenqui
  ha de ser una versio nova, i el test es precisament el que impedeix que passi per descuit.
- L'input es valida amb schema tancat abans d'arribar al handler. La sortida es limita per nombre
  d'elements i per bytes; un tenant gran no pot convertir una tool de lectura en una exportacio.

### Primera llista de tools read-only

Sis tools, totes de lectura, totes sobre casos d'us ja implementats i permissionats:

| Tool | Scope | Permis | Flag | Cas d'us |
| --- | --- | --- | --- | --- |
| `crm.customers.list` `v1` | `crm.read` | `customers:read` | — | `CrmService.listCustomers` |
| `crm.customers.get` `v1` | `crm.read` | `customers:read` | — | `CrmService.getCustomer` |
| `support.tickets.list` `v1` | `support.read` | `tickets:read` | — | `SupportService` (llistat) |
| `support.tickets.get` `v1` | `support.read` | `tickets:read` | — | `SupportService` (detall) |
| `infrastructure.status.summary` `v1` | `infrastructure.read` | `infrastructure:read` | `infrastructure` | `InfrastructureService` (resum) |
| `usage.summary` `v1` | `usage.read` | `usage:read` | `usage_costs` | `UsageService` (resum) |

Notes que no son opcionals:

- `crm.*` retorna dades personals de clients. La projeccio de sortida es **la mateixa** que ja
  retorna l'API REST, ni un camp mes, i queda subjecta a `docs/security/data-governance.md`.
- `usage.summary` retorna volum i salut. **Imports, FX i marge no hi son**: aixo es `financials:read`
  i no te scope MCP a la 10.1.
- `infrastructure.status.summary` retorna **recomptes i res mes**. Ni hostnames, ni URLs de
  col·lectors, ni dedup keys d'alerta —que es construeixen amb els dos—: aixo es el dibuix de la
  xarxa interna d'aquesta instal·lacio, i saber quantes maquines son caigudes no en necessita cap.
  El detall, si algun dia cal, sera una tool a part i una decisio a part.
- Les tools amb flag desapareixen del cataleg quan la flag es tanca. Desapareixer, no fallar.
- Projectes i comerc tenen scope declarat pero **cap tool publicada** a la 10.1. S'afegiran quan
  el propietari les aprovi una per una, que es el que demana el pla de fase.

## Auditoria per tool call

Cada `tools/call` escriu **una** fila d'auditoria, tant si s'executa com si es denega.

```text
action        mcp.tool.call
target_type   mcp_tool
target_id     <nom>@<versio>
outcome       success | denied | failure
actor_type    user | service_account
actor_id      <membership o service account>
metadata      client_id, grant_id, token_id, scope, permis,
              codi de denegacio, durada_ms, elements retornats,
              bytes retornats, correlation_id
```

- **Els arguments de la tool no s'hi desen crus.** S'hi desa un digest SHA-256 dels arguments
  normalitzats i la llista de noms de camp. Un identificador de client dins d'un argument es dada
  personal, i l'auditoria es de retencio llarga.
- Els resultats no s'hi desen mai: nomes comptadors.
- Les denegacions s'auditen amb el mateix detall que els exits. Aixo es el que fa detectable el
  sondeig d'un token robat.
- Els events d'autoritzacio (`mcp.grant.created`, `mcp.grant.revoked`, `mcp.token.refresh_reuse`,
  `mcp.client.created`, `mcp.service_account.rotated`) tambe s'auditen, i el reus de refresh token
  genera alerta, no nomes fila.
- L'auditoria continua sent la taula `audit_log` append-only. MCP no en te una de propia: "auditoria
  unificada d'API, UI i MCP" vol dir literalment la mateixa taula, amb `source` per distingir-los.

## Limits i quotes

- Rate limiting per token, per tenant i per tool, amb `429` i `Retry-After`.
- Timeout per tool call i pressupost de bytes de resposta.
- Concurrencia maxima per grant, perque un agent en bucle no pot monopolitzar l'API.
- Els limits son configuracio de la instal.lacio, no del client.

## Model de dades proposat

Totes les taules porten `tenant_id`, RLS `enable` + `force`, uniques compostes i grants minims.

- `mcp_clients`: tenant, `client_id`, nom, tipus, hash del secret, redirect URIs, scopes maxims,
  estat, creador.
- `mcp_authorization_requests`: hash del codi, client, tenant, membership, scopes, `code_challenge`,
  redirect URI, audience, expiracio i consum atomic.
- `mcp_grants`: tenant, client, actor (tipus i id), scopes consentits, estat, consentiment,
  caducitat i revocacio.
- `mcp_access_tokens`: grant, hash del token, audience, scopes, expiracio, revocacio, `last_used_at`.
- `mcp_refresh_tokens`: grant, hash, familia, substitut, us i expiracio — la familia es el que permet
  detectar el reus.
- `mcp_service_accounts`: tenant, nom, propietari, scopes, permisos, hash del secret, caducitat,
  rotacio i desactivacio.
- `audit_log`: ampliacio additiva amb `actor_type`, `actor_id` i `source`, amb `default` que deixa
  intactes les files i el codi existents.

Els codis d'autoritzacio i els tokens caducats es purguen a les 24 hores encara que la flag estigui
tancada. L'auditoria no.

**Numeracio:** els numeros de migracio **no s'assignen en aquesta especificacio**. La branca es
compartida amb la 7B i els numeros es prenen al moment d'implementar, mirant que hi ha llavors. El
repositori ja ha pagat un xoc de numeracio abans (`current-state.md`, cas A9b) i no cal repetir-lo.
Aixi es va fer: quan es va escriure aquest esquema la 7B ja tenia la `0048`, i li va tocar la
`0049`.

**El `Mcp-Session-Id` encara no te taula.** La sessio d'MCP es lliga al grant, pero que se n'ha de
desar --si res, mes enlla del token que ja hi ha-- depen de com el transport gestioni `initialize`.
Inventar-ne l'esquema abans de tenir el transport seria inventar-se el requisit; la decisio va amb
l'increment del transport.

## API proposada

```text
GET    /.well-known/oauth-protected-resource
GET    /.well-known/oauth-authorization-server
GET    /api/v1/mcp/oauth/authorize
POST   /api/v1/mcp/oauth/token
POST   /api/v1/mcp/oauth/revoke
GET    /api/v1/mcp/clients
POST   /api/v1/mcp/clients
DELETE /api/v1/mcp/clients/:clientId
GET    /api/v1/mcp/grants
DELETE /api/v1/mcp/grants/:grantId
GET    /api/v1/mcp/service-accounts
POST   /api/v1/mcp/service-accounts
POST   /api/v1/mcp/service-accounts/:id/rotate
DELETE /api/v1/mcp/service-accounts/:id
POST   /mcp
```

Les rutes de gestio exigeixen `security:manage` i MFA. `/mcp` i `/api/v1/mcp/oauth/*` son les
uniques que accepten un token MCP; **cap ruta REST de producte l'accepta**, i cap token de sessio de
la UI serveix per a `/mcp`. Un token no travessa la frontera per a la qual no es va emetre.

## Errors publics

Problem details RFC 9457, amb la capcalera `WWW-Authenticate` que RFC 9728 demana perque un client
MCP pugui descobrir com autoritzar-se.

- `MCP_TOKEN_INVALID` (401) — absent, mal format, desconegut o revocat.
- `MCP_TOKEN_EXPIRED` (401).
- `MCP_AUDIENCE_INVALID` (401) — emes per a un altre recurs.
- `MCP_SCOPE_INSUFFICIENT` (403) — amb `WWW-Authenticate: error="insufficient_scope"`.
- `MCP_TENANT_MISMATCH` (403).
- `MCP_CLIENT_UNKNOWN`, `MCP_CLIENT_SUSPENDED` (400/403).
- `MCP_REDIRECT_URI_MISMATCH`, `MCP_PKCE_REQUIRED`, `MCP_GRANT_TYPE_UNSUPPORTED` (400).
- `MCP_AUTHORIZATION_CODE_INVALID` (400) — desconegut, caducat o ja consumit.
- `MCP_REFRESH_REUSE_DETECTED` (401) — la familia queda revocada.
- `TOOL_NOT_PUBLISHED` (404) — la tool no existeix en aquesta instal.lacio.
- `TOOL_INPUT_INVALID` (400), `TOOL_LIMIT_EXCEEDED` (422), `RATE_LIMITED` (429).
- `PERMISSION_DENIED` (403) — la mateixa que dona REST, amb el mateix codi.

Cap error revela si un recurs existeix en un altre tenant, ni quines tools hi ha per a altri, ni res
del proveidor.

### Ordre de la decisio

L'ordre en que es refusa una crida forma part del contracte, i no es lliure:

1. **Tenant** anomenat en un argument que no coincideix amb el del token -> `MCP_TENANT_MISMATCH`.
   Es compara, no s'obeeix, i no pot ampliar res.
2. **Existencia** -> `TOOL_NOT_PUBLISHED`. Tres casos hi cauen i son indistingibles entre ells: un
   nom desconegut, una tool amb la flag del seu modul tancada i una tool que escriu mentre no hi ha
   escriptures publicades. Sondejar el cataleg no informa de res.
3. **Scope** -> `MCP_SCOPE_INSUFFICIENT`, abans de mirar els permisos. El token es la credencial
   presentada, aixi que la seva autoritat es decideix primer, i la resposta es accionable: qui no te
   un scope el pot demanar.
4. **Permis** -> `PERMISSION_DENIED`, exactament el que respondria REST i amb el mateix codi. Aixo
   es el criteri de paritat, i per aixo un permis absent **no** es dissimula darrere un 404: una
   ruta REST tampoc ho fa.

`tools/list` mostra les tools que superen les quatre comprovacions. Una tool a la qual nomes falta
l'scope no surt a la llista pero respon `403` si s'invoca pel nom: es la unica manera que el client
sapiga que existeix quelcom que pot demanar.

## Threat model

STRIDE sobre la frontera nova, seguint `docs/security/threat-model.md`. Actius: tokens MCP, grants,
secrets de service account, dades de client llegibles per tool, i l'auditoria.

Frontera nova:

```text
Client MCP (no fiable) | Internet | proxy | /mcp | cataleg de tools | casos d'us | PostgreSQL + RLS
```

| Amenaca | STRIDE | Impacte | Controls |
| --- | --- | --- | --- |
| Token robat reutilitzat des d'un altre lloc | S | Alt | TLS, vida de 30 min, revocacio immediata, `last_used_at`, alerta per patro anomal |
| Token emes per a un altre recurs acceptat a `/mcp` | S | Critic | Audience exacta validada abans de res, `resource` obligatori |
| Client MCP malicios registrat sol | S | Alt | Sense DCR; registre manual amb `security:manage` i MFA |
| Codi d'autoritzacio interceptat | S | Critic | PKCE S256 obligatori, codi de 60 s single-use, redirect exacte |
| Refresh token robat i reutilitzat | S | Alt | Rotacio, deteccio de reus, revocacio de familia, auditoria i alerta |
| Escalada per scope inventat | E | Critic | Deny by default, interseccio amb permisos, scopes no emissibles refusats |
| Travessa de tenant per argument de tool | E/I | Critic | Tenant del grant, argument ignorat, repositoris scoped, RLS, tests negatius |
| Tool no publicada invocada pel nom | E | Alt | Cataleg estatic, `TOOL_NOT_PUBLISHED`, la tool no apareix a `tools/list` |
| Confusio entre token MCP i token de proveidor | S | Critic | Emmagatzematge separat, AAD amb proposit, cap funcio de traduccio, proves creuades |
| Passthrough de token cap a un connector | I | Critic | El handler no rep credencials; el worker les obre just-in-time |
| Exfiltracio massiva per tool de lectura | I | Alt | Limits d'elements i bytes, rate limit, auditoria amb comptadors |
| Prompt injection que fa cridar tools | T/E | Alt | Cap text pot ampliar scopes; l'autoritat es del token, no del contingut |
| Fuga de dades a l'auditoria | I | Mitja | Digest d'arguments, cap resultat, redaccio, retencio declarada |
| Denegacio de servei per agent en bucle | D | Mitja | Rate limit per token i tenant, concurrencia maxima, timeouts |
| Manipulacio del registre de tool calls | T | Alt | `audit_log` append-only amb trigger, sense update ni delete des de l'aplicacio |

**Risc residual acceptat i declarat:** els access tokens son bearer. Qui n'obtingui un pot usar-lo
fins que expiri o es revoqui. Els mitigants son la vida curta, la revocacio immediata i l'auditoria
de denegacions. El seguent grao seria DPoP o mTLS, i el propietari el va deixar **fora de la 10.1**
(D7) per una rao concreta: cap client MCP d'avui el parla, i una exigencia que no compleix ningu no
protegeix ningu. Es revisa el dia que hi hagi tools d'escriptura, perque llavors el calcul canvia; la
columna del `jkt` s'afegeix a `mcp_access_tokens` sense trencar cap token viu.

## Proves

### Positives

- Autoritzacio completa amb PKCE, consentiment i primera crida a `tools/list` i `tools/call`.
- Refresh rotatiu correcte, amb el token antic invalidat.
- Client credentials d'un service account amb scopes acotats.
- Les sis tools retornen la mateixa projeccio que la ruta REST equivalent.

### Negatives (obligatories)

1. **Audience incorrecta:** token emes per a un altre recurs -> `401 MCP_AUDIENCE_INVALID`, sense
   arribar a resoldre tenant ni tool.
2. **Scope insuficient:** token sense `support.read` cridant `support.tickets.list` ->
   `403 MCP_SCOPE_INSUFFICIENT` amb `WWW-Authenticate`, i la tool ni apareix a `tools/list`.
3. **Token caducat:** -> `401 MCP_TOKEN_EXPIRED`.
4. **Token revocat:** revocar el grant i tornar a cridar amb el mateix token -> `401` a la crida
   immediatament seguent, sense esperar cap expiracio.
5. **Tenant incorrecte:** argument que anomena un altre tenant -> `403 MCP_TENANT_MISMATCH`, i cap
   fila d'un altre tenant a la resposta ni a la consulta.
6. **Tool no publicada:** invocar per nom una tool inexistent, una amb la flag del seu modul tancada
   i una que escriu mentre no hi ha escriptures publicades -> `404 TOOL_NOT_PUBLISHED` en els tres
   casos, indistingibles entre ells. Un permis absent, en canvi, respon `403 PERMISSION_DENIED`,
   igual que la ruta REST equivalent.
7. **Replay:** codi d'autoritzacio reutilitzat -> error; refresh token reutilitzat -> familia revocada
   i alerta; sessio MCP represa amb un altre grant -> error.
8. **Confusio de tokens:** un access token de proveidor (7B) presentat a `/mcp` i un token MCP
   presentat com a credencial de connector -> tots dos rebutjats, i cap dels dos llegible al domini
   de l'altre.
9. **Paritat:** per a cada tool, la mateixa membership obte el mateix resultat autoritzatiu per REST
   i per MCP; treure-li el permis els talla tots dos.
10. **Redaccio:** cap prova troba un token, un secret ni un argument cru a logs, jobs, auditoria o
    problem details.
11. **Flag tancada:** `/mcp` i les rutes OAuth responen 404 i no s'emet cap token.
12. **Aillament d'arquitectura:** el modul del cataleg no importa cap repositori ni client de base
    de dades.

Capes: domini (interseccio d'autoritat, estats de grant), PostgreSQL (consum atomic de codi, familia
de refresh, RLS, purga), API (validacio de token, errors, rate limit), contracte (schemas de tools i
versionat) i E2E (autoritzacio completa des d'un client MCP de prova).

## Feature flags

- `mcp` — apagada per defecte. Tancada: `/mcp`, les rutes OAuth i les de gestio **no es declaren**,
  no s'emet cap token, i el cataleg no es publica. La purga de codis i tokens caducats continua.
- `client_portal` — reservada per a la 10.2, apagada i sense codi darrere a la 10.1.

Cap flag concedeix autoritat: obrir `mcp` no dona a ningu cap scope ni cap grant.

## Rollout i rollback

1. Migracions additives amb la flag tancada.
2. Obrir `mcp` en local, registrar un client de prova i validar amb un client MCP real.
3. El propietari aprova les tools **una per una** abans de publicar-les.
4. Rollback: tancar la flag. Les rutes desapareixen i cap token serveix. Si cal, revocar tots els
   grants del tenant, que amb tokens de referencia es immediat.
5. Desfer les migracions no cal: son additives i no canvien cap comportament amb la flag tancada.

## Portal de client (10.2, proposta oberta)

El portal exposa a una persona externa els seus tickets, documents i estat de serveis. Comparteix el
resource server, **pero no el model d'identitat**, i per aixo no entra a la 10.1.

Preguntes que s'han de respondre abans d'escriure'n una linia:

- Els usuaris de portal son membres del mateix pool d'identitat amb un rol `client`, o una identitat
  separada? Avui **tot compte es de personal i MFA es obligatori**; un client extern amb MFA
  obligatoria es una decisio de producte, no un detall tecnic.
- Que veu exactament un client, i com es lliga una persona externa a un `customer_id` sense obrir
  cap via d'enumeracio.
- Si el portal es una app propia o una seccio de la web actual, i quin impacte te sobre CSP, cookies
  i sessions.

Fins que aquestes tres tinguin resposta, la 10.2 continua sent una proposta.

## Criteris d'acceptacio de la 10.1

1. Un token amb audience, issuer, expiracio, revocacio o scope incorrectes es rebutjat abans de
   resoldre tenant, permisos o tool, i queda auditat.
2. Cap token MCP surt mai cap a un proveidor, i cap credencial de proveidor s'accepta a `/mcp`.
3. Un token pertany a un sol tenant i cap argument pot canviar-lo.
4. `tools/list` mostra exactament les tools invocables per aquell token, ni una mes.
5. Una tool no publicada es denegada abans del seu handler i auditada.
6. La mateixa membership obte el mateix resultat autoritzatiu per REST, UI i MCP.
7. Cada tool call, exitosa o denegada, deixa una fila d'auditoria sense arguments crus ni resultats.
8. Revocar un grant talla l'acces a la crida seguent.
9. Reutilitzar un refresh token revoca la familia i genera alerta.
10. Amb la flag `mcp` tancada, la superficie no existeix i no s'emet cap token.
11. El cataleg de tools no accedeix a repositoris ni a PostgreSQL, i una prova ho comprova.
12. Cap token, secret ni argument cru apareix a logs, jobs, traces, auditoria o respostes.

## Decisions

| # | Decisio | Estat | Resolucio | Alternativa descartada o pendent | Cost de canviar-la despres |
| --- | --- | --- | --- | --- | --- |
| D1 | Qui emet els tokens | **Aprovada** 24-08-2026 | Control Hub, authorization server propi i acotat a MCP | Keycloak o IdP extern (hauria reobert `adr/0003`) | Alt: canvia desplegament i operacio |
| D2 | Format de token | **Aprovada** 24-08-2026 | Opac de referencia, hash a PostgreSQL, revocacio immediata | JWT signat amb JWKS | Mitja: la validacio ja esta aillada |
| D3 | Registre de clients | **Aprovada** 24-08-2026 | Manual pel propietari; sense DCR a la 10.1 | DCR (RFC 7591) amb aprovacio previa | Baix: additiu |
| D4 | Redirects loopback | **Aprovada** 24-08-2026 | Permesos a `127.0.0.1` amb path exacte i port lliure (RFC 8252); PKCE els guarda | Nomes HTTPS registrats | Baix, pero hauria deixat fora tot client d'escriptori |
| D5 | Vida del access token | **Aprovada** 24-08-2026 | 30 minuts, amb refresh rotatiu i deteccio de reus | 15, 60 o 480 minuts | Baix: es configuracio, no esquema |
| D6 | Primera llista de tools | **Aprovada** 24-08-2026 | Les sis de la taula, cadascuna revisable per separat | Reduir-la a suport i infraestructura, o ampliar-la amb projectes i comerc | Baix: cada tool s'aprova per separat |
| D7 | Proteccio de possessio | **Aprovada** 24-08-2026 | Bearer a la 10.1, amb el risc residual declarat; DPoP mes endavant | DPoP o mTLS obligatoris ja ara | Mitja: afecta clients existents, pero la columna del `jkt` es additiva |
| D8 | Portal de client | **Aprovada** 24-08-2026 | Fase a part: no entra a la 10 | Especificar-lo i implementar-lo aqui | Baix |

D1, D2, D3 i D6 son decisions preses i la resta de l'especificacio les dona per fixades. D4, D5, D7
i D8 continuen sent propostes: el text les descriu com si s'aprovessin, pero cap d'elles s'escriu en
codi fins que el propietari les resolgui.

## Alternatives descartades

- **Clau d'API amb permisos del portador.** Es el que fa tothom i es exactament el que aquesta fase
  existeix per evitar: sense audience, sense scopes, sense consentiment i sense revocacio granular.
- **Exposar els repositoris o un endpoint SQL a MCP.** Contradiu `ARCHITECTURE.md` i converteix cada
  regla de permis en una que es pot saltar pel cami curt.
- **Reutilitzar els grants OAuth de connectors (7B) com a autoritzacio MCP.** Son tokens d'un altre
  emissor, per a una altra audience i amb un altre significat; barrejar-los es la confusio de tokens
  que el threat model classifica com a critica.
- **Servidor MCP com a proces separat amb acces propi a PostgreSQL.** Duplicaria permisos i tenancy
  en un segon lloc, i els dos divergirien.
- **Tools configurables per tenant en runtime.** Fa impossible que el propietari aprovi cada tool i
  converteix el cataleg en superficie d'atac.
