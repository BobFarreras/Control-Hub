# Especificacio de la plataforma de connectors

**Fase 6.** Estat: **aprovada** pel propietari l'11 d'agost de 2026.

Aquesta especificacio defineix com Control Hub parla amb sistemes de tercers sense que aquests
sistemes entrin al nucli. No descriu cap proveidor concret: descriu el marc que la Fase 7 (n8n,
Prometheus) i la Fase 8 (correu, IA) hauran de fer servir sense modificar-lo.

Decisions prèvies que manen aqui: `ADR-0004` (connectors per ports i adaptadors), `ADR-0005`
(secrets), `ADR-0008` (vault logic de credencials), `ADR-0006` (cues) i
`docs/specifications/connector-security.md`, que es la norma de seguretat i **no es duplica
aqui**: aquest document diu com s'implementa, no la torna a enunciar.

## Problema i usuaris

Control Hub ja te dades pròpies. El que no te es cap manera d'anar a buscar-ne a fora ni de
rebre'n sense que cada proveidor deixi rastre al domini: una crida HTTP dins d'un cas d'us, un
token a una taula qualsevol, un `if provider === "x"` que creix a cada integracio.

Qui ho fa servir:

- **`Owner`** dona d'alta integracions i decideix quines existeixen.
- **`Technical`** les configura, les prova, en rota credencials i en diagnostica les fallades.
- **`Administrator`** nomes en llegeix l'estat: veu si una integracio esta sana, no la toca.

El valor de la fase no es cap pantalla: es que afegir el proveidor seguent sigui implementar un
contracte i no negociar amb el nucli.

## Abast

- Contracte de connector versionat, amb configuracio, salut, operacions i webhooks.
- Registre de connectors resolt en build-time.
- Instancies de connector per tenant, amb estat i historial.
- Vault de credencials xifrades, amb rotacio i revocacio.
- Politica de crides sortints: timeouts, retries, rate limit, circuit breaker i guarda SSRF.
- Webhooks entrants signats, amb finestra anti-replay i inbox idempotent.
- Un unic connector implementat: **webhook generic**, que serveix de referencia i de prova viva
  del contracte.
- Pantalla d'integracions: alta, prova, desactivacio, rotacio i historial.

## Fora d'abast

- Connectors d'n8n, Prometheus, correu i IA. Son Fase 7 i Fase 8 i hauran de cabre en aquest
  contracte sense eixamplar-lo.
- Carrega de codi de connector en runtime. L'`ADR-0004` la descarta per a tot l'1.x.
- Transformacions de dades configurables per l'usuari. Un connector mapa camps en codi revisat.
- Exposar operacions de connector a MCP. Es Fase 10.

## Decisions

Les que canvien la forma del codi. Les que nomes afecten seguretat son a `connector-security.md`.

1. **El connector no toca mai la base de dades.** Un handler rep un context amb ports (`http`,
   `secrets`, `logger`, `clock`) i retorna dades normalitzades. Qui persisteix es la capa
   d'aplicacio, que ja esta dins del tenant scope. Aixi la promesa de l'`ADR-0004` — "un
   connector defectuos no pot saltar limits de tenant" — deixa de dependre de la disciplina de
   qui escriu el connector i passa a ser estructural: no te cap handle amb què saltar-los.

2. **Tota la sortida a internet passa pel worker.** L'API no fa cap crida externa, ni tan sols
   per provar una connexio. "Provar" encua un health check i la pantalla en llegeix el resultat.
   Aixo evita que un formulari d'administrador es converteixi en un proxy SSRF amb la sessio de
   qui l'omple, i manté l'API amb latencia previsible.

3. **Els webhooks entren per l'API i no s'executen alli.** L'API verifica la firma sobre el cos
   cru, escriu a un inbox i respon. El worker processa. Un proveidor que dispara mil events no
   pot fer caure el panell, i un event que falla es pot reintentar sense demanar-lo al proveidor.

4. **Els hosts interns els declara l'operador, no el tenant.** Un administrador de tenant no pot
   apuntar un connector a `127.0.0.1` ni a la xarxa privada de la VPS. Els destins interns
   legitims (n8n, Prometheus) viuran en una allowlist d'entorn, `CONNECTOR_INTERNAL_ALLOWLIST`,
   que es configuracio d'instal·lacio. Sense aquesta separacio, "URL configurable" i "SSRF
   autoritzat" son la mateixa cosa.

5. **L'estat del circuit viu a Valkey; l'evidencia, a PostgreSQL.** El comptador d'un circuit
   breaker es operacio efimera i reconstruible. El que ha de sobreviure a un reinici es el
   registre de què es va intentar i què va fallar, i aixo va a `connector_sync_runs`. Es el que
   diu l'`ADR-0006`: Redis no es font de veritat.

6. **Els secrets de verificacio d'ingress es mostren una sola vegada.** La regla "credencials mai
   retornades per l'API" es refereix a les credencials *del proveidor*. El secret amb que
   signarà els webhooks el generem nosaltres i algu l'ha de copiar al proveidor: es retorna
   nomes al cos de la resposta que el crea, queda segellat, i cap endpoint de lectura el torna a
   ensenyar mai. Rotar-lo vol dir generar-ne un de nou amb el mateix cami.

7. **La configuracio es revalida abans de cada execucio, no nomes en desar.** Un schema pot
   canviar de versio amb una release mentre una instancia porta configuracio antiga desada.
   Executar-la sense revalidar es la manera d'arribar a produccio amb un camp que ja no vol dir
   el que deia.

## Arquitectura

```text
                    navegador
                        |  /api/*
                        v
+---------------------------------------------------+
|  apps/api            (cap crida a internet)        |
|   routes/integrations.ts  -> casos d'us            |
|   routes/webhooks.ts      -> firma + inbox + encua |
+---------------------------------------------------+
        |                                   |
        | packages/application              | BullMQ
        |  connectors.ts (casos d'us)       |
        v                                   v
+------------------------+     +----------------------------------+
| packages/persistence   |     |  apps/worker                     |
|  connector-repository  |<--->|   connectors/runtime.ts          |
|  credential-vault      |     |   connectors/guarded-fetch.ts    |
+------------------------+     +----------------------------------+
        |                                   |
        v                                   | ports (http, secrets, logger, clock)
+------------------------+                  v
| PostgreSQL   RLS       |     +----------------------------------+
|  connector_instances   |     |  packages/connectors             |
|  connector_credentials |     |   contract.ts   registry.ts      |
|  connector_sync_runs   |     |   built-in/generic-webhook.ts    |
|  connector_endpoints   |     +----------------------------------+
|  connector_inbox       |                  |
+------------------------+                  v
                               +----------------------------------+
                               | packages/domain/connectors.ts    |
                               |  salut, backoff, circuit breaker |
                               |  (pur, sense I/O)                |
                               +----------------------------------+
```

La fletxa que no hi es explica el disseny: **de `packages/connectors` no en surt cap linia cap a
`persistence`**. Un connector no pot llegir ni escriure res; nomes rep i retorna.

### On va cada cosa

| Peça | On | Per que alli |
|---|---|---|
| Regles pures: salut derivada, backoff, circuit breaker, redaccio | `packages/domain/src/connectors.ts` | Son decisions deterministes i es proven sense xarxa ni base de dades |
| Contracte, registre i connectors integrats | `packages/connectors` (nou) | Cal un lloc que ni l'API ni el worker "posseeixin", perque tots dos el llegeixen |
| Casos d'us: alta, prova, rotacio, desactivacio | `packages/application/src/connectors.ts` | Coordinen domini i ports, com la resta de moduls |
| Repositoris tenant-scoped i vault | `packages/persistence` | El vault es "com s'escriu aquesta columna", i viu al costat de qui l'escriu (`ADR-0008`) |
| `guarded-fetch`, execucio, reintents | `apps/worker/src/connectors/` | Es l'unic proces amb sortida a internet (decisio 2) |
| Rutes i ingress | `apps/api/src/routes/` | Transport, com sempre |

`packages/connectors` depen de `@control-hub/domain` i de `zod`, ja present al repositori. De res
mes.

## Contracte de connector

Versionat: `contractVersion` es un numero i un connector declara el que implementa. Trencar-lo
obliga a una versio nova, no a editar l'existent.

```ts
export type ConnectorDefinition<Config> = {
  type: string;                          // "generic-webhook"
  contractVersion: 1;
  configSchema: ZodType<Config>;         // camps allowlisted, sense secrets
  credentialKinds: readonly CredentialKind[];
  capabilities: CapabilityManifest;      // que pot fer i cap a on
  health(context: ConnectorContext<Config>): Promise<HealthReport>;
  operations: Record<string, ConnectorOperation<Config>>;
  ingress?: IngressHandler<Config>;
};
```

El `CapabilityManifest` no es documentacio: es el que el runtime aplica. Declara els esquemes
permesos, si el desti es la URL configurada o un host de l'allowlist interna, si accepta ingress
i quines operacions existeixen. Una operacio que no hi consta no s'executa encara que el codi la
tingui.

El `ConnectorContext` dona `http` (nomes `guarded-fetch`), `secrets.open(kind)` (obre un sobre
just a temps i el text pla no surt de l'abast de la crida), `logger` (redacta per defecte) i
`clock`. **No dona base de dades, ni `fetch` global, ni `process.env`.**

Un `ConnectorOperation` retorna `{ records, cursor, idempotencyKey }`. Persistir es feina de fora.

## Fluxos

**Alta.** `Owner` o `Technical` tria un tipus del registre, omple la configuracio, es valida amb
el schema i es desa la instancia en estat `draft`. Sense credencial no es pot habilitar.

**Credencial.** S'escriu per un endpoint que nomes escriu. Es segella amb la clau activa i queda
com a slot `primary`. La resposta retorna metadades: `keyId`, `rotatedAt`, mai el valor.

**Prova.** Encua un health check. El worker obre el sobre, fa una crida amb la guarda, escriu un
`connector_sync_runs` i actualitza `health_status`. La pantalla llegeix el resultat, amb el codi
d'error tradut i sense detall intern.

**Rotacio.** La credencial nova entra com a `secondary`. Durant la finestra les dues son valides
— per a ingress, la firma es comprova contra totes dues. En promoure-la, la vella es revoca i
queda `revoked_at`. Aixi rotar no exigeix parar el proveidor.

**Desactivacio.** L'instancia passa a `disabled`, les credencials es revoquen, els schedulers
s'aturen i l'ingress respon com si l'endpoint no existis.

**Ingress.** El proveidor firma i envia. L'API verifica, escriu inbox, respon `202`. El worker
processa. Un duplicat es descarta a la clau unica i torna `202` igual.

## Criteris d'acceptacio

Els cinc del pla, amb la forma que tindra la prova que els tanca:

1. **Cap credencial surt per l'API.** Un test recorre totes les respostes dels endpoints
   d'integracions amb una credencial coneguda desada i falla si el text pla o el ciphertext hi
   apareixen a qualsevol profunditat.
2. **Configuracio invalida rebutjada.** Alta i actualitzacio amb un camp desconegut, un tipus
   equivocat i una URL amb esquema no declarat responen `422` amb `code` estable.
3. **Timeout i rate limit no bloquegen el worker.** Amb un desti que no respon mai, la resta de
   jobs de la cua es completen dins del temps esperat.
4. **Un retry no duplica efectes.** El mateix job executat dues vegades deixa una sola fila i una
   sola crida efectiva; el mateix event d'ingress rebut dues vegades, tambe.
5. **Un connector fallit no afecta el core.** Amb una instancia en circuit obert, el dashboard,
   el CRM i el suport responen igual i el health check del sistema segueix `ready`.

I dos mes que la fase no pot tancar sense:

6. Un tenant no veu ni instancies, ni execucions, ni endpoints, ni inbox d'un altre, tampoc amb
   un identificador manipulat.
7. Un `Administrator` rep `403` a alta, rotacio i desactivacio, i `200` a lectura d'estat.

## Permisos i tenancy

Els permisos **ja existeixen** des de la migracio `0003`: `integrations:read`,
`integrations:manage` i `credentials:rotate`. La Fase 6 no n'afegeix cap ni necessita backfill.

| Accio | Permis | Owner | Administrator | Technical |
|---|---|:---:|:---:|:---:|
| Llegir integracions, salut i historial | `integrations:read` | X | X | X |
| Alta, configuracio, habilitar i desactivar | `integrations:manage` | X |  | X |
| Escriure i rotar credencials | `credentials:rotate` | X |  | X |
| Crear i revocar endpoints d'ingress | `integrations:manage` | X |  | X |

Tota lectura i escriptura passa per `withTenant`. L'unica consulta que s'executa fora de tenant
context es la resolucio de l'endpoint d'ingress, perque encara no hi ha tenant: selecciona nomes
`id, tenant_id, instance_id, connector_type, status` per `public_id`, viu en una funcio propia
del repositori i tot el que ve despres ja va dins del tenant resolt. Aquesta excepcio queda
comentada al codi i coberta per un test que falla si la funcio comença a retornar res mes.

## Model de dades i migracio

`0030_connectors.sql`. Totes les taules amb `tenant_id`, RLS `enable` + `force` i `unique
(tenant_id, id)` per poder-hi penjar claus foranes compostes, com la resta del repositori.

- **`connector_instances`** — `connector_type`, `name`, `status` (`draft|enabled|disabled|error`),
  `config jsonb`, `config_version`, `health_status`, `health_checked_at`, `last_error_code`.
  `unique (tenant_id, name)`.
- **`connector_credentials`** — `instance_id`, `kind`, `slot` (`primary|secondary`), `key_id`,
  `nonce bytea`, `ciphertext bytea`, `rotated_at`, `expires_at`, `last_used_at`, `revoked_at`.
  Index unic parcial per `(tenant_id, instance_id, kind, slot) where revoked_at is null`: dues
  credencials vives com a molt, que es exactament la finestra de rotacio.
- **`connector_sync_runs`** — `operation`, `status`
  (`running|succeeded|failed|dead_letter`), `attempt`, `started_at`, `finished_at`, `error_code`,
  `items_processed`. Es l'historial que la pantalla ensenya i l'evidencia que sobreviu al reinici.
- **`connector_webhook_endpoints`** — `public_id` de 32 bytes aleatoris, **unic globalment**
  perque la URL entra sense tenant; `instance_id`, `revoked_at`.
- **`connector_inbox`** — `endpoint_id`, `provider_event_id`, `payload_hash`, `received_at`,
  `status` (`pending|processed|failed|discarded`), `attempts`, `processed_at`.
  `unique (tenant_id, endpoint_id, provider_event_id)` es la idempotencia: no una comprovacio a
  l'aplicacio que dos workers poden creuar, sino una restriccio que la base fa complir.

Cap columna guarda text pla d'una credencial. El cos cru d'un webhook es conserva acotat i amb
la retencio de `data-governance.md`, no indefinidament.

## Crides sortints

Cada crida, i **cada redireccio**, passa la mateixa guarda. El detall normatiu es a
`connector-security.md`; el que aquesta especificacio fixa es que la implementacio es una sola
funcio, `guarded-fetch`, i que cap connector pot fer una crida per un altre cami — la regla es
comprovable perque el context no exposa `fetch`.

Pressupostos per defecte, ajustables per operacio dins d'un maxim: connexio 5 s, capçaleres 5 s,
total 30 s, resposta 5 MiB, 3 redireccions. Retry nomes per errors transitoris, amb backoff
exponencial i jitter complet, calculat per una funcio pura del domini. Esgotat el pressupost
d'intents, el run queda `dead_letter` i visible; no desapareix.

El circuit breaker es una maquina d'estats pura (`closed|open|half_open`) al domini, amb l'estat
efimer a Valkey per tenant i instancia. Un connector en circuit obert no s'intenta i no consumeix
worker.

## Webhooks entrants

`POST /api/v1/webhooks/:publicId`, publica, amb el cos cru preservat nomes en aquesta ruta.

- Firma HMAC-SHA256 sobre `timestamp` mes cos cru, comparada amb `timingSafeEqual`, contra les
  credencials d'ingress vives (una o dues durant la rotacio).
- Finestra de replay de 5 minuts.
- Limit de cos 1 MiB, content type allowlistat, rate limit per `publicId`.
- Idempotencia per identificador d'event del proveidor; si no en dona, `sha256` del cos cru.
- **Endpoint desconegut, firma invalida i timestamp fora de finestra responen igual**: `404` amb
  el mateix cos generic. Qui prova URLs no aprèn quines existeixen.
- Exit: `202` amb cos buit, tant si l'event es nou com si ja el teniem. Processar es del worker.

Un cos ben signat que el connector no pot llegir es l'unica excepcio a la resposta unica: `400`
amb el codi del connector. Per arribar-hi cal la nostra clau de firma, aixi que no diu res a qui
no la te, i qui la te ha de poder veure que ens ha enviat alguna cosa que no sabem interpretar.

La verificacio la fa `ConnectorIngressService`, que obre el secret dins seu i respon si la firma
quadra — mai amb que. Cap handler de l'API rep un objecte que pugui retornar un secret. La ruta
publica queda exempta de la comprovacio d'`Origin` de la resta de l'API: aquella comprovacio
protegeix rutes amb autoritat ambient (una cookie que el navegador adjunta sol) i aquesta no en
te cap.

Processar la inbox arriba amb el primer connector que digui que se n'ha de fer amb un event.
Fins llavors els events queden `pending`: marcar-los `processed` sense que ningu els hagi tocat
seria inventar-se una prova de feina que no s'ha fet.

## API, errors i idempotencia

REST sota `/api/v1`, problem details RFC 9457 amb `code` estable, segons
`docs/specifications/errors-and-api.md`.

| Metode i ruta | Permis | Notes |
|---|---|---|
| `GET /api/v1/connectors` | `integrations:read` | Cataleg del que porta la release, per poder triar |
| `GET /api/v1/integrations` | `integrations:read` | Instancies amb salut; mai credencials |
| `GET /api/v1/integrations/:id` | `integrations:read` | Una instancia; `404` si no es d'aquest tenant |
| `POST /api/v1/integrations` | `integrations:manage` | Valida config; `422` si no passa |
| `PATCH /api/v1/integrations/:id` | `integrations:manage` | Revalida i puja `config_version` |
| `POST /api/v1/integrations/:id/enable` i `/disable` | `integrations:manage` | Enable revalida; disable revoca credencials |
| `POST /api/v1/integrations/:id/health-checks` | `integrations:manage` | Encua; `202` amb l'identificador de la peticio |
| `GET /api/v1/integrations/:id/runs` | `integrations:read` | Historial paginat |
| `GET /api/v1/integrations/:id/credentials` | `integrations:read` | Nomes metadades: ni valor ni `key_id` |
| `PUT /api/v1/integrations/:id/credentials/:kind` | `credentials:rotate` | Nomes escriu; retorna metadades |
| `POST /api/v1/integrations/:id/credentials/:kind/promote` | `credentials:rotate` | Tanca la rotacio |
| `DELETE /api/v1/integrations/:id/credentials/:kind` | `credentials:rotate` | Revoca |
| `GET /api/v1/integrations/:id/endpoints` | `integrations:read` | Metadades: mai el `public_id` |
| `POST /api/v1/integrations/:id/endpoints` | `integrations:manage` | Retorna cami i secret **una vegada** |
| `DELETE /api/v1/integrations/:id/endpoints/:endpointId` | `integrations:manage` | Revoca l'adreca i el seu secret |

El `202` de la comprovacio de salut retorna l'identificador de la peticio encuada, no el d'un
run: el run el crea el worker quan comença, i inventar-ne l'id abans faria que la redelivery
trobes la fila ja oberta i no fes la feina. El resultat apareix a `/runs`.

La creacio d'un endpoint retorna el **cami** (`/api/v1/webhooks/<public_id>`) i no una URL
absoluta: l'unica cosa que l'API sap de la seva adreca publica es una capcalera `Host` que tria
qui truca, i la pantalla ja sap contra quin origen parla. Una instancia te un endpoint viu alhora,
perque el secret de firma viu per instancia i slot; revocar-lo revoca tambe el secret. Rotar
aquest secret son les rutes de credencials, amb el `kind` `ingress_signing`.

Les rutes de credencials i les d'endpoints nomes es declaren si hi ha anell de claus. Sense, la resta de la
superficie funciona i aquestes responen `404`, que es la veritat: no hi ha res amb que segellar.

Les operacions repetibles accepten `Idempotency-Key`: a `health-checks` la clau esdeve
l'identificador del job, i BullMQ refusa el segon amb el mateix. OpenAPI s'actualitza al mateix
increment que la ruta.

## UX, i18n i accessibilitat

Una pantalla, `/{locale}/integrations`, amb `PageTopbar`, `SmartDataTable` i `ToastProvider`, com
la resta: aquesta fase no inventa primitives. Estat de salut amb text a mes de color, perque un
punt verd sol no es accessible. Missatges d'error traduits des del `code`, mai el text del
proveidor. Claus `ca`, `es` i `en` al mateix commit que el component.

La pantalla ha de deixar clar que un secret nomes es veu un cop, **abans** de generar-lo.

## Threat model

| Amenaça | Control |
|---|---|
| SSRF cap a la xarxa interna o a metadades del cloud | `guarded-fetch`: resolucio DNS, filtratge de rangs, connexio a la IP validada, revalidacio de cada redireccio |
| DNS rebinding entre comprovacio i connexio | Connexio a la IP ja validada, amb `Host` fixat |
| Robatori de la base de dades | Credencials segellades amb clau fora de PostgreSQL (`ADR-0008`) |
| Ciphertext mogut a un altre tenant | `tenant_id` i `instance_id` com a AAD: no obre |
| Replay d'un webhook | Finestra de timestamp mes clau unica d'idempotencia |
| Enumeracio d'endpoints d'ingress | `public_id` de 32 bytes i resposta identica per a desconegut i invalid |
| Un tenant apuntant un connector a la VPS | Allowlist interna d'entorn, no editable per tenant |
| Filtracio de secrets per logs | Logger que redacta per defecte; el text pla no surt de l'abast de `secrets.open` |
| Un proveidor que satura el sistema | Rate limit per endpoint, inbox asincron, circuit breaker |
| Escalada per connector defectuos | El connector no rep base de dades ni entorn |

## Observabilitat i auditoria

Metriques per connector i operacio: intents, exits, fallades per codi, latencia, obertures de
circuit i profunditat d'inbox. Logs amb `connectorType`, `instanceId`, `operation`, `status`,
`latencyMs` i `errorCode` — mai URL completa amb query, mai capçaleres.

Auditoria obligatoria, amb les accions de `docs/specifications/audit.md`: alta, canvi de
configuracio, habilitar, desactivar, escriptura i rotacio de credencial, creacio i revocacio
d'endpoint. Tambe les denegades. `metadata` porta `connectorType` i `instanceId`, mai config
sencera.

## Pla de proves

- **Unitaris (domini):** salut derivada, backoff amb jitter dins de limits, transicions del
  circuit breaker, redaccio.
- **Contract tests (connectors):** la llista de `connector-security.md` — config invalida,
  credencial absent, expirada i rotada, timeout, reset, `429`, `5xx`, resposta massa gran, DNS
  rebinding, redireccio interna, IP privada, firma invalida, replay, duplicat, cross-tenant i
  redaccio.
- **Integracio (PostgreSQL):** RLS de les cinc taules, unicitat d'idempotencia sota concurrencia,
  finestra de rotacio de dues credencials, segellat i obertura amb clau retirada, i fallada amb
  ciphertext manipulat.
- **Integracio (worker):** un desti penjat no bloqueja la cua; dead-letter visible.
- **E2E:** alta, prova, rotacio i desactivacio amb sessio iniciada, en `ca` i comprovant que cap
  resposta porta el secret.

## Rollout, feature flag i rollback

Flag `connectors`, apagada per defecte, registrada a `packages/config/src/flags.ts` amb
propietari i data de retirada. Apagada: l'API no declara les rutes, la web no mostra el menu ni
la pantalla, `/{locale}/integrations` respon `404` i el worker no registra schedulers. L'ingress
tambe respon `404`.

La migracio `0030` es additiva i s'aplica amb la flag apagada sense efecte observable. Rollback
es apagar la flag; no cal desfer la migracio.

Variables noves a `.env.example`: `CONNECTOR_KEY_RING` (anell de claus) i
`CONNECTOR_INTERNAL_ALLOWLIST`. Sense la primera, la fase arrenca amb les rutes de credencials
desactivades i ho diu a l'arrencada, en comptes de fallar quan algu prova de desar-ne una.

## Pla d'increments

Cada increment es un commit revisable que passa `pnpm check` pel seu compte.

| # | Increment | Tanca |
|---|---|---|
| 1 | Especificacio, `ADR-0008` i flag `connectors` | Aquest document aprovat |
| 2 | Domini: salut, backoff, circuit breaker, redaccio | Unitaris |
| 3 | `packages/connectors`: contracte, registre, webhook generic | Contract tests de config |
| 4 | Migracio `0030` i repositoris tenant-scoped | RLS i cross-tenant |
| 5 | Vault: anell de claus, segellat, rotacio | Criteri 1, clau retirada, ciphertext manipulat |
| 6 | Worker: `guarded-fetch`, reintents, circuit, runs | Criteris 3, 4 i 5, suite SSRF |
| 7 | API d'integracions, problem details i auditoria | Criteris 2 i 7 |
| 8 | Ingress: firma, replay, inbox, idempotencia | Criteri 4 d'ingress, no enumerable |
| 9 | Pantalla d'integracions, i18n `ca`/`es`/`en` | E2E |
| 10 | OpenAPI, runbook de rotacio, `current-state.md` | Definition of Done |

Els increments 1 a 8 no toquen `packages/ui` ni `apps/web/src/components`, que es on treballa
l'altra sessio oberta. L'increment 9 s'ha de coordinar abans de començar.

## Riscos coneguts

- **El numero de migracio pot xocar.** Si l'altra sessio afegeix una migracio abans, `0030` passa
  a `0031`. Es renumera abans de fer merge, mai despres d'aplicar-la enlloc.
- **La suite SSRF depen de resolucio DNS.** S'ha de poder injectar el resolutor als tests o CI
  sera intermitent.
- **`0025` i `0026` encara no son a produccio.** La `0030` no hi depen, pero desplegar la Fase 6
  arrossega les pendents.

## Decisions de la revisio del propietari (11 d'agost de 2026)

- **Especificacio aprovada.** L'increment 2 pot començar.
- **`Administrator` es queda nomes amb lectura d'integracions.** La matriu de
  `docs/specifications/permissions.md` ja ho deia i el disseny s'hi ajusta; no cal migracio.
- **Custodia de l'anell de claus: gestor de contrasenyes, amb un sobre `age` de break-glass.**
  En operacio es un Docker secret a la VPS. El detall i la regla que l'ordena son a
  `docs/adr/0008-connector-credential-vault.md`; el runbook de rotacio de l'increment 10 hi ha
  de sortir d'aqui.
