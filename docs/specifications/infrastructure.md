# Especificacio d'infraestructura i connector n8n

**Fase 7, partida en 7.1 i 7.2.** Estat: **aprovada** pel propietari el 12 d'agost de 2026.
Revisio 2, que respon les quatre esmenes de la seva revisio del mateix dia.

> **Per que 7.1 i 7.2, i no 7A i 7B.** `IMPLEMENTATION_PLAN.md` ja reserva **Fase 7B** per a
> una cosa diferent —accions i credencials OAuth, encara en proposta—, i dos "7B" al mateix
> repositori es una confusio garantida. Les lletres queden per a subfases senceres, com la 5B i
> la 5C; els decimals, per a les dues entregues d'aquesta.

Aquesta especificacio diu com Control Hub ensenya l'estat real de les automatitzacions d'n8n i,
despres, de la VPS i els seus serveis, **sense assumir-ne el control intern**. No inventa cap
marc: els connectors que hi entren s'escriuen contra el contracte de la Fase 6 tal com esta, i on
el contracte no arriba es diu explicitament que es un forat de la plataforma i s'arregla alli.

Manen sobre aquest document: `IMPLEMENTATION_PLAN.md` (seccio "Fase 7"),
`docs/specifications/connectors.md`, `docs/specifications/connector-security.md`,
`docs/specifications/data-governance.md`, `ADR-0004`, `ADR-0006` i `ADR-0008`. Cap norma
d'aquells documents es repeteix aqui.

## Problema i usuaris

Avui l'estat de la VPS viu a tres llocs que no es parlen: Prometheus, la UI d'n8n i el cap de qui
recorda que un backup s'havia de revisar. Quan una automatitzacio d'un client falla de nit, ningu
ho sap fins que el client ho diu.

- **`Owner`** i **`Technical`** declaren l'inventari, escriuen les regles d'alerta i diagnostiquen.
- **`Administrator`** nomes llegeix: veu si una cosa esta amunt, no la toca.

El valor de la fase no es cap grafic: es que una execucio fallida d'un workflow d'un client
arribi a una incidencia sense que ningu hagi hagut de mirar.

## La fase, partida

**Si, val la pena partir-la**, i no per obediencia: la particio cau per una junta que ja hi era.
Els dos connectors no comparteixen cap dada, cap taula i cap pantalla; l'unica cosa que
comparteixen es la plataforma, i la plataforma la necessita el primer que arribi. La 7.1 paga els
tres pedacos de plataforma i estrena el motor d'alertes amb **la unica regla que beu de dades
seves**; la 7.2 nomes hi afegeix files a les mateixes taules.

| | 7.1 — Plataforma, n8n i pantalla | 7.2 — Prometheus, inventari i alertes d'infraestructura |
|---|---|---|
| Plataforma | G1, G2 i G3 | — |
| Connectors | `n8n` | `prometheus` |
| Taules noves | `connector_records`, `connector_operation_state`, `infra_automation_links`, `infra_alert_rules`, `infra_alert_events` | `infra_hosts`, `infra_services` |
| Regles d'alerta | El motor sencer, amb `workflow_failed` | `service_down`, `certificate_expiring`, `backup_stale` |
| Pantalla | `/{locale}/infrastructure`: automatitzacions i alertes | La mateixa, mes hosts, serveis i les seves metriques |

**La 7.1 entregada tota sola te valor**: veus tots els workflows d'n8n amb el seu estat, quines
execucions han fallat i de quin client son, hi entres amb un clic, i una execucio fallida obre una
incidencia sense que ningu miri. No cal cap host declarat per a res d'aixo.

La 7.2 no pot anar primer: el seu connector necessita el magatzem de registres i el programador que
paga la 7.1.

## Abast de la 7.1

- **Connector `n8n`**: workflows i execucions per l'API oficial, mes ingress signat per als errors
  que n8n ens empeny.
- **Associacio empresarial** d'un workflow amb un client.
- **Enllac extern validat** cap a cada workflow a la UI d'n8n.
- **Motor de regles d'alerta** i el seu historial, amb la regla `workflow_failed`, que obre
  incidencies amb deduplicacio.
- **Pantalla `/{locale}/infrastructure`**: automatitzacions, el seu estat i les alertes vives.
- **Els tres forats de la plataforma de la Fase 6** que aquesta fase descobreix.

## Abast de la 7.2

- **Inventari declarat** de hosts i serveis, amb la clau amb que cada un es reconeix a les dades
  observades.
- **Connector `prometheus`**: CPU, RAM, disc, uptime, estat de contenidors i estat de sondes
  (certificats i backups).
- **Tres regles d'alerta mes**: `service_down`, `certificate_expiring` i `backup_stale`.
- **La pantalla creix**: dashboard tecnic amb les xifres dels hosts, i detall de host i servei.

## Fora d'abast, a les dues

- **Qualsevol operacio sobre la VPS o sobre un proveidor.** No es reinicia res, no es desplega
  res, no es crea ni es reactiva cap workflow; no hi ha shell, SSH ni API de Docker. **Aquesta
  fase nomes llegeix.** `infrastructure:operate` autoritza declarar inventari i regles, no tocar
  la maquina. Com entraria una capacitat d'accio esta dissenyat al final del document i **no
  s'implementa**.
- **Cap agent instal·lat a la VPS ni el socket de Docker exposat.** Els contenidors es veuen pel
  que els exporters ja publiquen.
- **Cap grafic historic.** Per que, i com entraria despres, a la decisio 3.
- **Enviament de notificacions fora del panell** (correu, Slack, telefon). Una alerta obre una
  incidencia; que se'n fa despres es del modul de suport.
- **La VPS i l'n8n reals.** La fase es desenvolupa contra dobles i fixtures capturats. Connectar
  produccio es la revisio del propietari, no un increment.
- **Correu, IA i costos variables.** Son Fase 8 i han de cabre en el mateix magatzem de registres
  que la 7.1 estrena, sense eixamplar-lo.

## El que falla de la Fase 6

La restriccio de la fase es que **un connector s'afegeix implementant el contracte i prou**. En
provar-ho contra el codi real n'apareixen tres punts on el contracte no arriba. Cap dels tres
s'arregla al connector: son plataforma, amb la seva propia prova, i els connectors no se
n'assabenten.

| # | Que falla avui | On es veu |
|---|---|---|
| G1 | El runtime compta els `records` d'una operacio i **els llenca**; el `cursor` del veredicte no el desa ningu | `apps/worker/src/connectors/runtime.ts:172` |
| G2 | L'unica operacio que algu encua es el health check. **No hi ha manera de programar-ne cap altra** | `apps/worker/src/index.ts` |
| G3 | Amb `destination: "operator_allowlist"`, la guarda **no comprova la base configurada**: una instancia pot arribar a qualsevol origen de l'allowlist, inclos el d'un altre servei | `apps/worker/src/connectors/guarded-fetch.ts:141` |

G1 es una decisio amb consequencies: el magatzem es **generic i sense forma**
(`instance_id, operation, external_id, data jsonb`). L'alternativa —taules per modul i un
projector per tipus de connector al worker— tornaria a posar un `switch (connectorType)` al nucli,
que es exactament el que l'`ADR-0004` va treure. El modul d'infraestructura **no rep res del
worker: llegeix.**

**Aquesta fase si que afegeix fitxers a `packages/domain`, `packages/application` i `apps/api`**:
es un modul de producte i la seva logica va alli. El que no pot passar es que **afegir un
connector** ho exigeixi. El pla d'increments ho fa comprovable: els increments de connector (A4 i
B1) toquen `packages/connectors/src/built-in/` i el seu test, i cap fitxer mes.

## Decisions

1. **L'inventari es declara, no es descobreix** (7.2). Un servei que ningu ha declarat i que no
   respon no es una alerta, es soroll; i un servei declarat que ha deixat d'apareixer a les
   metriques es precisament el cas que s'ha de veure.

2. **Les consultes de Prometheus viuen al codi del connector**, revisades amb la release. La
   configuracio de la instancia nomes diu la URL base i quines etiquetes li interessen. Una PromQL
   escrita a un camp de formulari es una transformacio configurable per l'usuari —fora d'abast a
   `connectors.md`— i deixa la pantalla sense saber quina forma te el que dibuixa.

3. **`connector_records` guarda l'estat actual, no la serie.** L'upsert per `externalId` sobreescriu:
   de `host:vps-1` n'hi ha **una fila**, amb l'ultima lectura i la seva hora. Es una perdua
   deliberada, i cal dir-la sencera:

   - **El que si que hi ha historial** son les coses que ja neixen amb identitat propia. Una
     execucio d'n8n es `execution:<id>`, i cada execucio es una fila diferent: la llista
     d'execucions fallides **es** una serie sense que haguem fet res.
   - **El que no hi ha** es evolucio d'una magnitud: no es pot dibuixar la CPU de les ultimes 24
     hores, perque nomes en tenim l'ultim valor. La Fase 7 ensenya **estat actual amb l'edat de la
     lectura** i cap grafic historic.
   - **Com entraria una serie temporal despres, sense refer res.** No fent-nos una base de series:
     Prometheus ja n'es una. Entraria com una **operacio de consulta a demanda** al connector
     (`range_query`, contra `/api/v1/query_range`), amb el resultat servit a la pantalla sense
     passar per `connector_records`, que seguiria sent el que es: l'estat actual. Ni el magatzem,
     ni el programador, ni cap taula d'aquesta fase caldria tocar-los.

4. **Els registres caduquen i es purguen, i qui ho decideix es el manifest.** Cada operacio declara
   quina forma te el que retorna i quant ha de viure:

   | Forma | Que vol dir | Purga |
   |---|---|---|
   | `state` | Una fila per cosa observada, sobreescrita a cada passada | 30 dies despres de `last_seen_at`: una cosa que el proveidor ha deixat d'anomenar |
   | `event` | Una fila per fet, que no torna | 90 dies despres de `first_seen_at` |

   A mes, un sostre dur de **20 000 files per `(instancia, operacio)`**: en passar-lo es
   retallen les mes velles i queda un avis `RECORDS_TRIMMED` al log i a la salut de la instancia.
   Un proveidor que ens inunda ha de fer soroll, no omplir la taula en silenci. La purga es una
   escombrada horaria del worker, per lots acotats, i els valors surten a `data-governance.md` al
   mateix commit.

5. **L'enllac cap a n8n el construim nosaltres.** Mai s'obre una URL que ha vingut del proveidor:
   es composa `baseUrl` configurada mes `/workflow/<id>`, es valida a l'hora de dibuixar-la
   (mateix origen que el configurat, esquema declarat, sense credencials embegudes) i surt amb
   `target="_blank"` i `rel="noopener noreferrer"`. Una `webhookUrl` que ens arribi dins d'un
   workflow es dada, no destinacio.

6. **Una alerta es dedupa amb una restriccio, no amb una lectura.** Un index unic parcial sobre
   `(tenant_id, rule_id, dedup_key) where status = 'firing'` fa que el segon dispar actualitzi el
   primer. Dos workers que avaluen alhora, o un proveidor que repeteix un webhook, no poden
   creuar-se: la base ho refusa. La incidencia penja de l'alerta viva, no de cada dispar.

7. **Una regla sense dades no esta verda: esta afamada.** Cada regla porta un pressupost de
   frescor. Si la dada que necessita es mes vella, la regla queda `starved` i es dibuixa com a
   tal. Aixo tanca dues coses alhora: que una regla que ningu alimenta no doni sensacio de
   cobertura, i que **perdre de vista un proveidor no dispari totes les seves regles** —una
   caiguda d'n8n no ha de produir una allau d'alertes falses, sino una sola alerta que diu que
   l'hem perdut de vista.

8. **El token d'n8n es una credencial del vault** (`kind: "api_token"`), s'obre just a temps dins
   la crida que el necessita i viatja a la capcalera `X-N8N-API-KEY`. Mai a una query string, mai
   a un log: el `redactingLogger` del runtime ja el treu de qualsevol frase que n8n ens torni.

9. **Els sondejos no comparteixen cua amb l'escalacio de suport.** El detall es a "Programacio i
   repartiment de cua".

## Arquitectura

```text
+------------------------------------------------------------------+
| apps/web  /{locale}/infrastructure   (automatitzacions, alertes)  |
+------------------------------------------------------------------+
                     |  /api/*        (cap crida a internet)
                     v
+------------------------------------------------------------------+
| apps/api  routes/infrastructure.ts  -> casos d'us                 |
+------------------------------------------------------------------+
        |                                          ^
        v                                          | llegeix
+---------------------------+          +--------------------------------+
| packages/application      |          | connector_records              |
|  infrastructure.ts        |          | connector_operation_state      |
| packages/domain           |          | (escrits NOMES pel worker)     |
|  infrastructure.ts (pur)  |          +--------------------------------+
+---------------------------+                      ^
        |                                          | upsert per externalId
        v                                          |
+---------------------------+          +--------------------------------+
| infra_automation_links    |          | apps/worker                    |
| infra_alert_rules         |<---------|  runtime + reconciliador       |
| infra_alert_events        | alertes  |  cua `connectors`              |
| infra_hosts, infra_services (7.2)     |  escombrada d'alertes i purga  |
| incidents (ja existent)   |          +--------------------------------+
+---------------------------+                      |
                                                   v
                                       +--------------------------------+
                                       | packages/connectors            |
                                       |  built-in/n8n.ts        (7.1)   |
                                       |  built-in/prometheus.ts (7.2)   |
                                       +--------------------------------+
```

La fletxa que no hi es torna a explicar el disseny: **de `packages/connectors` no en surt cap
linia cap al modul d'infraestructura**, i el modul no en surt cap cap al worker. Es toquen a
`connector_records`, i nomes en un sentit.

## Els connectors

Cap dels dos toca `packages/domain`, `packages/application` ni `apps/api`. Cap dels dos afegeix
pantalla de configuracio: la d'integracions ja els mostra, perque llegeix el cataleg.

### `n8n` (7.1)

| | |
|---|---|
| Config | `baseUrl` (allowlistada), `includeArchived: false`, `executionsWindowHours` (1..168, per defecte 24) |
| Credencials | `api_token` (capcalera `X-N8N-API-KEY`) i `ingress_signing` |
| Egress | `operator_allowlist`, esquemes `http` i `https` |
| Operacions | `pull_workflows` (`GET /api/v1/workflows`, forma `state`, cada 15 min) i `pull_executions` (`GET /api/v1/executions?status=error&includeData=false`, amb cursor, forma `event`, cada 5 min) |
| Ingress | Si. Un **error workflow** d'n8n ens signa i ens empeny l'execucio fallida |
| `externalId` | `workflow:<id>` i `execution:<id>` |

**Del que n8n ens dona, en desem una projeccio, mai el cos.** Un workflow d'n8n porta els seus
nodes a dins, i els parametres d'un node contenen habitualment claus d'API, cadenes de connexio i
dades del client que algu ha escrit a l'editor; una execucio porta els items que hi han passat.
Desar-ho seria convertir Control Hub en una copia de tots els secrets de tots els workflows de tots
els clients. Per aixo els esquemes del connector **nomenen els camps que es queden** —d'un
workflow: nom, actiu, arxivat, etiquetes i dates; d'una execucio: workflow, estat, mode i hores— i
la resta cau al parser, abans de construir el registre. Per aixo mateix `pull_executions` demana
`includeData=false` i nomes les fallades: una execucio correcta no la mira ningu, i una instancia
amb milers al dia ompliria la taula de files que no es llegeixen.

**El cursor de `pull_executions` es una marca d'aigua, no una pagina.** El cursor d'n8n apunta cap
enrere, aixi que guardar-lo entre passades seria caminar cap al passat i no veure mai res nou. El
que es desa es l'id mes alt ja llegit; la passada seguent baixa fins que en reconeix un i para. La
finestra `executionsWindowHours` nomes acota **la primera** lectura d'una instancia amb anys
d'historial.

**El secret de firma el generem nosaltres i l'ha de fer servir un workflow d'n8n.** n8n no signa
res sol: qui configura la instancia ha de posar un node HMAC-SHA256 a l'error workflow amb el
secret que Control Hub encunya un sol cop. Aixo va al runbook i es part de la revisio del
propietari. Sense l'error workflow les execucions fallides arriben igualment pel sondeig; el
webhook les fa immediates.

### `prometheus` (7.2)

| | |
|---|---|
| Config | `baseUrl` (allowlistada), `hostLabels: string[]` (fins a 50), `containerJob?`, `probeJob?` |
| Credencials | Cap per defecte; `api_token` si la instancia esta darrere autenticacio basica |
| Egress | `operator_allowlist`, esquemes `http` i `https` — un Prometheus a la mateixa VPS no te TLS i l'operador ja l'ha hagut de nomenar |
| Operacions | `pull_host_metrics`, `pull_container_state`, `pull_probe_state` — totes forma `state` |
| Ingress | No |
| `externalId` | `host:<label>`, `container:<name>`, `probe:<target>`, `backup:<job>` |

**D'on surten els certificats i els backups**, que era la mancanca de la revisio 1:

| Regla | Metrica | Qui la publica |
|---|---|---|
| `certificate_expiring` | `probe_ssl_earliest_cert_expiry` | `blackbox_exporter`, sondant els dominis que Traefik serveix |
| `service_down` | `probe_success`, i `up` per als exporters | `blackbox_exporter` i el propi Prometheus |
| `backup_stale` | `control_hub_backup_last_success_seconds` | **L'escript de backup de la VPS**, pel textfile collector de `node_exporter` |

Les dues primeres son estandard; la tercera **exigeix una linia a l'escript de backup** que
escrigui el timestamp al fitxer del textfile collector. Es una precondicio de la 7.2, no una feina
de codi, i esta al runbook. Si en la revisio decideixes no desplegar `blackbox_exporter` o no
tocar l'escript, aquelles regles **no cauen del disseny: cauen soles**, perque una regla sense
dades queda `starved` i es veu (decisio 7). Treure-les seria esborrar dues files de configuracio,
no tornar a escriure res.

## Model de dades

Quatre migracions. Se'n van reservar tres i en va caldre una quarta, la `0034`, que la seccio de
cua explica. Al moment d'escriure aixo el numero mes alt del repositori era `0032`; les d'aquesta
fase han quedat de la `0033` a la `0036`, i si una altra sessio se'ns avanca es **renumeren abans
del merge**, mai despres d'haver-les aplicat enlloc. Totes les taules amb `tenant_id`, RLS `enable` + `force` i `unique (tenant_id, id)`.

**`0033_connector_records.sql` — plataforma, tanca G1 (7.1)**

- `connector_records` — `instance_id`, `operation`, `external_id`, `shape` (`state|event`),
  `data jsonb`, `first_seen_at`, `last_seen_at`.
  `unique (tenant_id, instance_id, operation, external_id)`: aquesta clau **es** la idempotencia
  d'un reintent, no una lectura previa. Index per `(tenant_id, instance_id, operation, last_seen_at)`
  per a la purga i per a la llista.
- `connector_operation_state` — `instance_id`, `operation`, `cursor`, `last_run_at`,
  `last_success_at`. `unique (tenant_id, instance_id, operation)`. `last_success_at` es el que la
  pantalla ensenya com a edat de la lectura i el que fa afamar una regla.

**`0034_connector_run_lease.sql` — plataforma, sostre de concurrencia (7.1)**

- Index unic parcial `(tenant_id, instance_id, operation) where status = 'running'` sobre
  `connector_sync_runs`. **L'index es el sostre**, no una lectura previa: dos workers que
  comprovessin alhora si hi ha una execucio en curs tots dos veurien que no, i tots dos tindrien
  rao. La segona insercio xoca i el runtime torna `skipped: already_running`.
- La migracio tanca abans com a `dead_letter` les files `running` que ja hi hagi de mes, per no
  deixar l'index sense poder crear-se.
- El sostre no pot ser permanent: un worker mort a mitja passada deixaria l'operacio bloquejada
  per sempre. `startRun` dona per abandonada tota execucio que porti mes de **10 minuts** en
  `running` (`RUN_ABANDONED`) i li pren el relleu.

**`0035_infrastructure_automations.sql` — modul (7.1)**

- `infra_automation_links` — `(instance_id, external_id)` cap a `customer_id` i notes. **Es
  l'associacio empresarial**; el workflow en si viu a `connector_records` i no es copia.
- `infra_alert_rules` — `name`, `kind`, **`instance_id`**, `target_type`, `target_id`,
  `params jsonb` acotat, `severity`, `freshness_seconds`, `opens_incident`, `enabled`.
  `instance_id` no era a la revisio 2 i cal: una regla llegeix **una** instancia, i sense la
  columna la frescor d'un proveidor es podria confondre amb la d'un altre. `target_id` es un
  `external_id` i per tant text, no uuid — n8n bateja els seus workflows.
- `infra_alert_events` — `rule_id`, `dedup_key`, `status` (`firing|resolved`), `severity`,
  `summary jsonb` acotat, `started_at`, `last_seen_at`, `occurrences`, `resolved_at`,
  `acknowledged_at`, `acknowledged_by_membership_id`, `incident_id`. Index unic parcial
  `(tenant_id, rule_id, dedup_key) where status = 'firing'`. Les resoltes es guarden 180 dies:
  son evidencia, i les treu `purge_alert_events(p_resolved_before, p_batch_limit)`, amb la
  mateixa forma que la purga de registres — finestra per argument i `security definer`.

**Que es pot esborrar i que no.** `infra_automation_links` i `infra_alert_rules` tenen `delete`:
desassociar un workflow i esborrar una regla son actes ordinaris i auditats. `infra_alert_events`
**no en te**: un esdeveniment es la constancia que va passar una cosa, i l'unic que en treu cap es
la purga de retencio.

**`0036_infrastructure_hosts.sql` — modul (7.2)**

- `infra_hosts` — `name`, `hostname` (l'etiqueta amb que Prometheus l'anomena), `environment`,
  `notes`. `unique (tenant_id, name)`.
- `infra_services` — `host_id`, `name`, `kind` (`container|http|database|automation`),
  `match_key`, `expected_state`, `customer_id` opcional.

`incidents` **no es modifica**: la `0014` ja te la forma que cal i aquesta fase li dona el primer
escriptor.

## Programacio i repartiment de cua

Aquesta seccio es la G2 sencera, i respon les tres coses que no poden fallar: orfes, circuit obert
i saturacio.

**Cua propia.** Els sondejos van a una cua nova, `connectors`, amb el seu propi `Worker` dins del
mateix proces i concurrencia propia. La cua `system` es queda amb l'escombrada d'escalacio i la
resta. Amb una sola cua, quatre instancies penjades a 30 s de pressupost ocuparien les quatre
places i l'escalacio de suport esperaria: es una degradacio d'un modul que se n'emporta un altre,
i la separacio la fa impossible per construccio, no per calibratge.

**Una execucio alhora per `(instancia, operacio)`.** Si arriba la passada seguent i l'anterior
encara consta `running`, la nova acaba sense fer res (`skipped: already_running`). El sostre de
concurrencia d'una instancia lenta es, doncs, **una placa**, i no depen de com de lenta sigui. Ho
imposa l'index unic parcial de la `0034`, amb un arrendament de 10 minuts perque un worker mort no
deixi l'operacio bloquejada per sempre.

**La cadencia surt del manifest**, no de la configuracio del tenant: `pull_workflows` cada 15
minuts, `pull_executions` cada 5. La plataforma imposa un minim de 60 segons, perque un connector
no es pugui autoconcedir un sondeig per segon.

**El calendari es reconcilia, no es manté.** Cada dos minuts el worker compara els calendaris vius
a Valkey amb les instancies habilitades i:

- **esborra el calendari d'una instancia que ja no existeix, o esta deshabilitada, o el connector
  de la qual ja no es al registre** — un calendari que sobreviu a la seva instancia es una crida
  fantasma que ningu sap d'on surt;
- **allarga la cadencia ×10, amb sostre d'una hora, mentre el circuit estigui obert**, i la
  restaura en tancar-se;
- **els esborra tots si la flag `infrastructure` esta apagada.**

Es reconciliacio i no una crida al moment de deshabilitar **a proposit**: una eliminacio que depen
que una peticio arribi deixa un orfe el dia que aquella peticio falla. La reconciliacio no en pot
deixar cap, perque no recorda res — mira el que hi ha.

**L'escombrada d'alertes i la purga de registres** son dues feines programades mes, cada 2 minuts
i cada hora, a la cua `system`, amb la mateixa forma que `sweepSupportEscalations`.

## Avaluacio de regles i alertes

**Qui.** Una escombrada del worker, cada **2 minuts**, i el mateix codi cridat immediatament quan
entra un webhook d'error d'n8n. Una funcio, dos disparadors: no hi pot haver una alerta que el
webhook creii i l'escombrada no reconegui, perque calculen la mateixa clau.

**Recomputable, com l'escalacio de suport.** Cada passada calcula el veredicte de cada regla
**des de l'estat actual** —`connector_records` mes les regles— i no des del que ha canviat des de
l'ultima. Perdre una passada no perd cap alerta: la seguent arriba a la mateixa conclusio. Una
regla que ja no es certa es resol; una que ho segueix sent puja `occurrences` i `last_seen_at`.

**La logica es pura i viu al domini** (`packages/domain/src/infrastructure.ts`): entren les regles,
els registres i el rellotge; surt una llista de veredictes `firing | resolved | starved`. Es prova
sense base de dades ni xarxa.

**Frescor abans que veredicte.** Si la dada que la regla necessita es mes vella que
`freshness_seconds`, el veredicte es `starved` i no `firing`: no sabem si el servei ha caigut o si
hem perdut de vista qui ens ho havia de dir. La perdua de vista te la seva propia alerta, una per
instancia.

**La incidencia.** Amb `opens_incident`, la primera vegada que una alerta passa a `firing` obre una
fila a `incidents` amb la gravetat de la regla i queda lligada per `incident_id`. Mentre l'alerta
segueix viva no se n'obre cap altra —ho impedeix l'index unic parcial— i en resoldre's, la
incidencia passa a `monitoring`; tancar-la es d'una persona.

## Permisos i tenancy

Cap permis nou i cap backfill: `infrastructure:read` i `infrastructure:operate` existeixen des de
la `0003` i la matriu de `permissions.md` ja els reparteix.

| Accio | Permis | Owner | Administrator | Technical |
|---|---|:---:|:---:|:---:|
| Llegir automatitzacions, hosts, serveis i alertes | `infrastructure:read` | X | X | X |
| Associar un workflow a un client | `infrastructure:operate` | X | | X |
| Escriure regles d'alerta, reconeixer i resoldre | `infrastructure:operate` | X | | X |
| Declarar i editar hosts i serveis (7.2) | `infrastructure:operate` | X | | X |

Tota lectura i escriptura passa per `withTenant`. L'ingress d'n8n entra pel cami que la Fase 6 ja
te i no n'obre cap de nou.

## API

REST sota `/api/v1`, problem details RFC 9457, com la superficie de connectors.

| Metode i ruta | Permis | Fase |
|---|---|---|
| `GET /api/v1/infrastructure/overview` | `infrastructure:read` | 7.1 |
| `GET /api/v1/infrastructure/automations` | `infrastructure:read` | 7.1 |
| `PUT /api/v1/infrastructure/automations/:instanceId/:externalId/link` | `infrastructure:operate` | 7.1 |
| `GET`, `POST /api/v1/infrastructure/alert-rules`, `PATCH`, `DELETE /:id` | read / operate | 7.1 |
| `GET /api/v1/infrastructure/alerts`, `POST /:id/acknowledge`, `/resolve` | read / operate | 7.1 |
| `GET`, `POST /api/v1/infrastructure/hosts`, `GET`, `PATCH /:id` | read / operate | 7.2 |
| `GET`, `POST /api/v1/infrastructure/services`, `PATCH`, `DELETE /:id` | read / operate | 7.2 |

`overview` es un recompte fet de les dues mateixes lectures que la pantalla ja pot fer: quantes
automatitzacions hi ha, quantes corren, quantes tenen client, i les alertes vives per gravetat i
quantes ha vist algu. Porta `observedFrom`, que es **la lectura mes antiga** de les que hi ha
al darrere i no la mes nova: un resum nomes es tan fresc com la cosa mes rancia que hi entra.
Sense res a resumir es `null`, mai l'hora d'ara.

Cap resposta porta una URL de proveidor, ni un token, ni el cos cru d'un event. Les respostes
d'automatitzacions porten `externalId` i el que la pantalla necessita per **construir** l'enllac,
no l'enllac. Tota xifra observada viatja amb la seva hora de lectura. OpenAPI es genera de les
rutes, amb `tags`, `summary` i `description`, i sense response schema, per la mateixa rao que a la
Fase 6.

## Auditoria i observabilitat

Auditades, i tambe quan es deneguen: associar un workflow a un client, crear, editar i esborrar
una regla, reconeixer o resoldre una alerta, i declarar o editar un host o un servei. `metadata`
porta identificadors, mai `params` sencers.

Metriques: registres escrits i purgats per operacio, edat de la darrera lectura per instancia,
calendaris reconciliats i orfes esborrats, alertes vives per gravetat i estat (incloent-hi
`starved`), i profunditat de la cua `connectors`.

## Criteris d'acceptacio

Els cinc del pla, i quatre que la fase no pot tancar sense.

| # | Criteri | Fase | On es prova |
|---|---|---|---|
| 1 | **Una caiguda d'n8n no afecta Control Hub.** Amb la instancia en circuit obert, dashboard, CRM i suport responen igual, el health del sistema segueix `ready`, la pantalla ensenya la dada antiga **amb la seva edat** i les regles queden `starved`, no `firing` | 7.1 | `apps/api/src/app.test.ts`, `circuit-store.unit.test.ts`, unitari de veredictes al domini |
| 2 | **Cap token d'n8n a una URL, una resposta ni un log** | 7.1 | Contract test de `n8n`, `runtime.unit.test.ts` (redaccio), i un test que recorre les respostes d'infraestructura amb un token conegut desat |
| 3 | **Una URL externa maliciosa es rebutja.** Origen diferent del configurat, esquema no declarat, credencials embegudes i `javascript:` no produeixen enllac | 7.1 | Unitari del constructor d'enllac a `apps/web/src/lib` |
| 4 | **Un error temporal respecta el backoff** i no dorm el worker | 7.1 | `job.unit.test.ts`, `runtime.unit.test.ts` |
| 5 | **Un webhook duplicat no crea dues incidencies.** El mateix event dues vegades deixa una alerta viva, una incidencia i `occurrences = 2` | 7.1 | Integracio PostgreSQL sobre l'index unic parcial, i unitari del servei d'alertes |
| 6 | **Un reintent no duplica un registre**, i la purga respecta la forma declarada | 7.1 | `runtime.unit.test.ts` i integracio sobre `connector_records` |
| 7 | **G3 protegeix les dues bandes.** Sota `operator_allowlist` amb `baseUrl`, un origen allowlistat que no es el seu es refusa; **sense `baseUrl`, segueix funcionant**; i `generic-webhook`, que va per `configured_base_url`, es comporta exactament com abans | 7.1 | `guarded-fetch.unit.test.ts`, i la suite de `generic-webhook` sense tocar |
| 8 | **El programador no deixa orfes ni ofega la cua.** Deshabilitar una instancia li treu el calendari; amb la flag apagada no en queda cap; el circuit obert n'allarga la cadencia; i **una instancia penjada no atura les altres ni endarrereix l'escalacio de suport** | 7.1 | Integracio del reconciliador i integracio de cua amb un desti que no respon mai |
| 9 | **Cap tenant veu registres, alertes, incidencies, hosts ni serveis d'un altre**, i **`Administrator` rep `403`** a tot el que canvia i `200` a llegir | 7.1 i 7.2 | Integracio RLS de les taules noves; unitaris del servei d'aplicacio |

## Pla de proves

- **Unitaris:** veredictes de cada tipus de regla, incloent-hi `starved`; mapatge de gravetat a
  incidencia; constructor i validador de l'enllac extern; read model amb dades caducades.
- **Contract tests** dels connectors, amb la llista de `connector-security.md` i fixtures
  capturats: config invalida, clau desconeguda, credencial absent, `429`, `5xx`, resposta massa
  gran, i que cap incidencia porti el valor rebut.
- **Integracio PostgreSQL:** RLS, deduplicacio d'alertes sota concurrencia, upsert de registres,
  purga per forma i sostre de 20 000 files.
- **Integracio worker:** reconciliacio de calendaris (orfe, flag apagada, circuit obert); una
  instancia penjada que no bloqueja les altres ni l'escalacio.
- **E2E:** amb el flag obert i sessio iniciada, en `ca`: veure les automatitzacions, obrir-ne
  l'enllac extern, veure una alerta viva i reconeixer-la. Amb el flag tancat,
  `/{locale}/infrastructure` respon `404`.

## Rollout, feature flag i rollback

Flag **`infrastructure`**, una per a les dues meitats, apagada per defecte, registrada a
`packages/config/src/flags.ts` amb propietari i data de retirada. Apagada: l'API no declara cap
ruta, **el worker no programa ni reconcilia cap operacio i esborra els calendaris que hi hagi**, la
web no mostra l'entrada i la pantalla respon `404`. **L'entrada "Infraestructura" del menu lateral
deixa de ser `href="#"` i passa a estar darrere el flag**, com Integracions.

Les tres migracions son additives i s'apliquen amb la flag apagada sense efecte observable.
Rollback es apagar la flag.

Variables noves a `.env.example`: cap de propia. Els connectors depenen de
`CONNECTOR_INTERNAL_ALLOWLIST`, que ja existeix, i el `.env.example` guanya un exemple amb els
origens de la VPS comentats.

## Pla d'increments

Cada increment es un commit revisable que passa `pnpm check` pel seu compte, amb la documentacio
al mateix commit.

**7.1 — Plataforma, n8n i pantalla** (increments A1–A6)

| # | Increment | Fitxers que toca | Tanca |
|---|---|---|---|
| A1 | Aquesta especificacio i el flag `infrastructure` | `docs/`, `packages/config/src/flags.ts` | Document aprovat |
| A2 | G1: `0033`, magatzem de registres, cursor, forma i purga | `packages/database`, `packages/application/src/connectors.ts`, `packages/persistence`, `apps/worker` | Criteri 6 |
| A3 | G2 i G3: cadencia al manifest, cua `connectors`, reconciliador, confinament a la base | `packages/connectors/src/contract.ts`, `packages/contracts`, `apps/worker` | Criteris 7 i 8 |
| A4 | Connector `n8n`: operacions i ingress | **`packages/connectors/src/built-in/n8n.ts` i el seu test, i res mes** | Criteri 2, contract tests |
| A5 | `0035`, associacions, motor d'alertes amb `workflow_failed`, casos d'us, API i escombrada | `packages/domain`, `packages/application`, `packages/persistence`, `apps/api`, `apps/worker`, `packages/database` | Criteris 5 i 9 |
| | *Partit en dos commits: dades i domini primer, casos d'us, adaptador, API i worker despres. Un sol commit de dues mil linies no el revisa ningu.* | | |
| A6 | Pantalla, i18n `ca`/`es`/`en`, menu lateral, OpenAPI, runbook de l'error workflow | `apps/web`, `packages/i18n`, `docs/runbooks` | Criteris 1, 3 i 4, E2E |

**7.2 — Prometheus, inventari i alertes d'infraestructura** (increments B1–B4)

| # | Increment | Fitxers que toca | Tanca |
|---|---|---|---|
| B1 | Connector `prometheus`, amb `pull_probe_state` | **`packages/connectors/src/built-in/prometheus.ts` i el seu test, i res mes** | Contract tests |
| B2 | `0036`, inventari de hosts i serveis: casos d'us i API | `packages/application`, `apps/api`, `packages/database` | Criteri 9 sobre les taules noves |
| B3 | Les tres regles d'alerta d'infraestructura | `packages/domain`, `packages/application` | Veredictes, incloent-hi `starved` |
| B4 | Dashboard tecnic i detall de host i servei, OpenAPI, `current-state.md` | `apps/web`, `packages/i18n`, `docs/` | Definition of Done de la fase |

## Com entraria una capacitat d'accio (disseny, no s'implementa a la Fase 7)

El contracte d'avui sap **estirar** (`operations`) i **rebre** (`ingress`). No sap **actuar**: no
hi ha cap cami perque Control Hub escrigui al proveidor. Arribara —reactivar un workflow, enviar
un correu, obrir un tiquet a fora— i aquesta seccio existeix perque la Fase 7 no ens hi tanqui la
porta. **Res d'aixo es construeix ara, i la Fase 7 nomes llegeix.**

`IMPLEMENTATION_PLAN.md` ja en porta una proposta sencera, **"Fase 7B - Accions i credencials
OAuth"**, amb OAuth i quotes que aqui no es toquen. Aquesta seccio no la substitueix: diu la
part que afecta **el contracte**, que es la que la Fase 7 podria tancar sense voler si no la
tingues escrita. Les dues coincideixen en el que importa —cua i mai dins la peticio, clau
d'idempotencia obligatoria, confirmacio humana, auditoria de l'intent i de la denegacio—, i si
algun dia divergeixen, mana el pla.

**On aniria.** Al manifest, al costat de les operacions:
`actions: Record<string, { input: ZodType, effect: "create" | "update" | "delete", retrySafe: boolean }>`,
amb la mateixa regla que ja governa les operacions: **una accio que no consta al manifest no es
pot despatxar encara que el codi hi sigui**, i `defineConnector` peta en carregar el modul si el
manifest i les implementacions no diuen el mateix. El handler rebria el context d'avui —cap base
de dades, cap `fetch` global— mes la clau d'idempotencia, i retornaria l'identificador extern del
que ha creat.

**Per que no toca `packages/domain`.** El domini guarda regles pures: salut derivada, backoff,
circuit breaker, redaccio. Una accio no n'afegeix cap. El que creix es `packages/connectors` (el
contracte), `packages/application` (el cas d'us amb el permis i l'auditoria) i `apps/api` (la
ruta) — la plataforma, un sol cop. Despres d'aixo, **cap proveidor nou hauria de tornar-los a
tocar**, que es exactament la promesa que aquesta fase esta comprovant per a la lectura.

**Quin permis.** Un de nou, `connectors:execute`, amb migracio i backfill; no `integrations:manage`,
que autoritza configurar el nostre costat i no causar efectes al costat de l'altre. I **segon
factor**, com escriure una credencial: qui pot fer que passi una cosa a fora ha d'haver demostrat
qui es en aquella sessio.

**Per que confirmacio humana.** Perque l'efecte no es reversible des d'aqui: qui es penedeix d'un
workflow creat a n8n l'ha d'anar a esborrar a n8n. La forma seria en dos temps —una crida que
retorna **que passaria**, un resum llegible i un testimoni de curta durada, i una segona que
l'executa— de manera que una pantalla no pugui disparar escriptures al proveidor amb un sol clic i
un `csrf` afortunat. Es la defensa contra el diputat confus, i tambe contra el dit relliscos.

**Per que clau d'idempotencia obligatoria.** Perque el cami te tres punts on una peticio es
repeteix sense que ningu ho vulgui: el doble clic, el reintent de la cua i el timeout que salta
despres que la peticio ja hagi sortit. "Un reintent no pot crear dos workflows" **no es una
propietat d'un handler acurat**: es una restriccio unica sobre `(tenant_id, instance_id, action,
idempotency_key)` en una taula `connector_action_runs`, on el segon intent troba el resultat del
primer i el retorna. La clau viatja tambe al proveidor quan aquest en suporta. I una accio amb
`retrySafe: false` **no la reintenta mai la cua** davant d'una fallada ambigua: queda per a una
persona, amb el que se sap i el que no.

**Que se n'auditaria.** L'intent i la denegacio, sempre: qui, quina accio, sobre quina instancia,
amb quina clau d'idempotencia, els camps d'entrada allowlistats —mai el payload sencer—, el
resultat i l'identificador extern del que s'hagi creat. Una accio es l'unica cosa d'aquest sistema
que deixa rastre al sistema d'un altre; el nostre registre ha de poder respondre "aixo ho vam fer
nosaltres, aquest dia, i ho va demanar aquesta persona".

## Riscos coneguts

- **El numero de migracio pot xocar.** Les d'aquesta fase van de la `0033` a la `0036` i es
  renumeren **abans del merge** si una altra sessio se'ns avanca, mai despres d'aplicar-les
  enlloc.
- **La forma de l'API d'n8n canvia entre versions.** Es fixa la versio contra la qual s'han
  capturat les fixtures i el contract test la nomena; quan la VPS pugi de versio, el test es el
  que ho dira.
- **L'error workflow es feina manual a n8n**, i la metrica de backup es una linia a l'escript de
  la VPS. Cap de les dues es codi nostre; totes dues son al runbook i a la revisio del propietari.
  Sense elles la fase funciona, mes lenta i amb dues regles afamades que es veuen.
- **Un Prometheus sense les metriques que esperem** (sense cAdvisor, sense blackbox) deixa
  l'operacio corresponent sense res a retornar. El connector ho ha de reportar com a
  `unverifiable`, no com a exit amb zero contenidors.
- **Les finestres de retencio son provisionals.** Els 30 i 90 dies i el sostre de 20 000 files
  surten d'un calcul, no d'un mes de dades reals: al moment d'escriure aixo ningu sap quantes
  execucions fa l'n8n de la VPS. Son **constants del codi i files de `data-governance.md`, no
  esquema**, aixi que revisar-les quan la 7.1 porti un mes sondejant de debo no costa cap migracio.
  Si el sostre es queda curt, el que ho dira es l'avis `RECORDS_TRIMMED`, que per aixo hi es.
- **La 7.2 depen de la 7.1.** Si la 7.1 s'atura a mig cami, la 7.2 no te ni magatzem ni programador.
  L'ordre no es negociable.
