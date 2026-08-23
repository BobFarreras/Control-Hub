# Especificacio de comunicacions, consum i costos variables

**Fase 8. Estat: aprovada pel propietari el 23 d'agost de 2026, incloses les tres ampliacions de
model de la revisio.**

Aquest document converteix el resum d'`IMPLEMENTATION_PLAN.md` en un contracte implementable. Les
sis decisions originals i les tres ampliacions detectades a la revisio son aprovades. La guia
d'execucio es a
`docs/development/phase-8-implementation-guide.md`.

## Objectiu

Control Hub ha de poder respondre, amb font, cobertura i data:

- quin consum han reportat els proveidors de correu i IA;
- quant ha costat per tenant, client, producte, servei contractat, projecte i execucio;
- quin marge queda quan s'afegeixen els costos variables als costos recurrents i de persones;
- quins pressupostos estan sans, avisant, excedits, parcials o obsolets;
- quins correus s'han incorporat a suport i quin ha estat el resultat de cada resposta.

El sistema informa i reconcilia. No substitueix la factura legal del proveidor ni promet aturar
despesa en temps real.

## Particio de la fase

### 8.1 — Consum, tarifes i costos

- Model normalitzat i append-only de consum.
- Tarifes i tipus de canvi versionats.
- Atribucio a les entitats de negoci existents.
- Pressupostos, alertes i conciliacio.
- Connectors de lectura d'Anthropic i OpenAI quan l'API del compte proporcioni dades suficients.
- Importacio manual auditada quan el proveidor no proporcioni una API de costos adequada.

La 8.1 utilitza les operacions de lectura i el magatzem de registres de connectors ja entregats.
No depen de la Fase 7B.

### 8.2 — Correu entrant

- Salut i lectura incremental de busties per IMAP o API oficial.
- Vinculacio explicita d'una bustia amb el canal de suport del tenant.
- Import idempotent d'un fil com a ticket o missatge de ticket.
- Gmail i Microsoft Graph nomes despres que la Fase 7B entregui OAuth2 amb PKCE, refresh segur i
  revocacio.

### 8.3 — Correu sortint

- Resposta des d'un ticket amb confirmacio humana.
- Job asincron, idempotencia, auditoria i historial de lliurament.
- Estat final `sent | failed | unknown`; acceptar un job no equival a haver enviat el missatge.

La 8.3 depen obligatoriament del contracte d'accions de la Fase 7B. L'SMTP dels correus d'identitat
no es converteix en una via paral.lela per saltar-se aquest contracte.

## Fora d'abast

- Executar models, generar prompts, RAG, entrenament o avaluacions.
- Guardar prompts, respostes o payloads crus d'IA.
- Copiar una bustia sencera com a arxiu permanent.
- Campanyes, newsletters, tracking d'obertures o marketing automation.
- Comptabilitat legal, impostos, pagaments o factures de proveidor.
- Bloquejar un proveidor en superar un pressupost.
- Repartir automaticament costos que la font no permet atribuir.

## Decisions de domini

### Events immutables i valoracions reproduibles

`usage_events` conserva el fet observat: font, identificador extern, operacio, model o SKU,
quantitats i instant. Repetir el mateix identificador no crea una segona fila. Una correccio crea
una `usage_adjustment`; mai modifica ni esborra l'event original.

`usage_valuations` conserva la tarifa, el tipus de canvi i la versio de regles aplicats. Publicar
una tarifa nova no altera informes antics. Revalorar es una operacio explicita que crea una versio
nova i manté l'anterior auditable.

#### Ampliacio aprovada: valoracio de correccions

Una correccio porta les seves propies linies a `usage_adjustment_quantities`, expressades com a
diferencies amb signe. `usage_valuations` deixa de referenciar obligatoriament nomes un event i
porta `event_id` o `adjustment_id`, exactament un dels dos, protegit amb
`check (num_nonnulls(event_id, adjustment_id) = 1)` i FK compostes amb `tenant_id`.

El pressupost suma l'ultima valoracio vigent de cada event i totes les valoracions vigents de les
seves correccions. Aixi una correccio arriba a pressupostos i informes sense mutar el fet original,
i es pot reconciliar cada variacio amb el seu motiu i actor. Una anul.lacio de correccio crea una
correccio inversa; no elimina files.

### Imports i unitats

- Imports en unitats menors i moneda ISO 4217.
- Calculs amb `BigInt` i arrodoniment half-up per linia.
- Quantitats enteres amb unitat allowlistada: `input_token`, `output_token`,
  `cached_input_token`, `request`, `image`, `audio_second`, `compute_millisecond`, `byte` o
  `provider_unit`.
- Un event pot tenir diverses linies; no es força tot a tokens.

### Tarifes versionades

`usage_rates` identifica proveidor, SKU, unitat, escala, import, moneda, font i `effective_from`.
Es append-only i admet anul.lacio auditada, com els barems de projectes.

Prioritat de cost:

1. cost final reportat pel proveidor per l'event;
2. tarifa exacta vigent quan va ocorrer;
3. estat `unpriced`, mai cost zero.

El connector normalitza consum. No decideix tarifes ni escriu PostgreSQL.

### Atribucio explicita

Un event pertany sempre al tenant i pot referenciar una instancia i execucio de connector, client,
producte, servei contractat o projecte. Les referencies utilitzen FK compostes amb `tenant_id`.

La referencia mes especifica deriva les superiors quan el model existent ho garanteix. No es
guarden dues veritats contradictories. Si la font no permet atribuir, el cost queda a
`unattributed`; no es reparteix proporcionalment entre clients.

Les `usage_attribution_rules` son versionades i comparen metadades allowlistades amb valors exactes.
No accepten SQL, expressions, plantilles ni codi configurat per l'usuari. Cada valoracio registra
quina regla i versio s'ha aplicat.

### Moneda original i canvi amb evidencia

El tenant configura una moneda d'informe. Cada cost conserva l'import i moneda originals.
`exchange_rates` desa parell, dia UTC, fraccio entera `numerator/denominator`, font i instant
d'importacio.

La conversio utilitza el tipus del dia de l'event i arrodoniment half-up per linia. Si falta, la
linia continua visible en moneda original i el consolidat queda `partial`; mai s'utilitza el tipus
d'avui per reescriure historic. La primera entrega admet importacio manual auditada. Cap servei de
canvi extern es obligatori per arrencar el core.

### Pressupostos informatius

Un pressupost defineix import, moneda, periode calendaritzat, llindars i un sol abast entre tenant,
client, producte, servei contractat o projecte. Els estats son:

- `healthy`: cobertura completa i sota llindar;
- `warning`: ha superat un llindar intermedi;
- `exceeded`: ha superat l'import;
- `stale`: alguna font obligatoria no s'ha actualitzat dins la finestra;
- `partial`: falten tarifa, canvi o atribucio.

Els canvis creen events idempotents. `warning` i `exceeded` no bloquegen crides externes. Un
pressupost amb dades parcials o obsoletes mai es mostra com a sa.

#### Ampliacio aprovada: fonts obligatories del pressupost

Cada via d'ingestio te una fila `usage_sources`. Una font es `connector` —amb instancia i operacio—
o `manual` —amb un codi estable del tenant—, exactament una de les dues formes. La font conserva
`last_complete_at`; una importacio manual nomes el mou quan el lot es declara complet, no per cada
fila parcial.

Cada pressupost declara com a minim una font a `usage_budget_sources`: `budget_id`, `source_id`,
`max_age_minutes` i `required`. Una font de connector deriva l'estat de
`connector_operation_state`; `max_age_minutes` decideix quan la seva ultima passada completa deixa
de ser vigent.

Un pressupost es `stale` si qualsevol font `required` no te una passada completa dins la seva
finestra. Una font opcional obsoleta fa l'informe `partial`, no `stale`. Desactivar o eliminar una
instancia no converteix el pressupost en sa: la vinculacio es conserva i queda stale fins que un
gestor substitueix la font o desactiva explicitament el pressupost. Les FK compostes impedeixen
vincular una font d'un altre tenant.

### Minimitzacio del contingut

Els events d'IA no guarden prompts, respostes, headers, payloads crus ni identificadors personals
del proveidor. Nomes metadades necessaries per deduplicar, mesurar i atribuir.

El correu te dues capes:

- `connector_records` conserva temporalment headers allowlistats, identificador de fil,
  participants normalitzats, timestamps i preview redactat;
- quan un missatge s'incorpora a suport, el cos necessari passa a `ticket_messages` i hereta la
  retencio de negoci del ticket.

HTML remot, pixels, scripts i contingut actiu no es carreguen. Els adjunts queden fora del primer
increment de correu.

## Arquitectura

```text
proveidor -> connector de lectura -> worker -> connector_records
                                         |
                                         v
                                  normalitzador d'us
                                         |
                  +----------------------+------------------+
                  v                      v                  v
             usage_events       usage_valuations     salut/staleness
                  |                      |
                  +-----------+----------+
                              v
                    pressupostos i informes

bustia -> registre temporal -> import idempotent -> suport
ticket -> accio 7B -> worker -> proveidor -> estat de lliurament
```

- `packages/connectors`: adaptadors i mapatge de proveidor, sense repositoris.
- `packages/domain`: unitats, valoracio, FX, pressupostos i estats purs.
- `packages/application`: ingestio, deduplicacio, atribucio i casos d'us.
- `packages/persistence`: repositoris tenant-scoped.
- `apps/worker`: tota I/O externa, sincronitzacio, valoracio i alertes.
- `apps/api`: transport, permisos i OpenAPI; cap I/O de proveidor.
- `apps/web`: consum, costos, mancances, pressupostos i suport.

## Model de dades proposat

No es reserva cap numero de migracio mentre altres branques treballen en paral.lel. S'assigna des
del `develop` vigent abans de cada increment.

### Consum

- `usage_events`: font, `external_id`, instant, SKU/model, estat i referencies d'atribucio. Unic
  `(tenant_id, source_instance_id, external_id)`.
- `usage_event_quantities`: event, unitat, quantitat i qualificador allowlistat.
- `usage_adjustments`: event original, correccio, motiu i actor o font.
- `usage_adjustment_quantities`: correccio, unitat i diferencia entera amb signe.
- `usage_rates`: proveidor, SKU, unitat, escala, import, moneda, vigencia, font i anul.lacio.
- `usage_valuations`: event XOR correccio, versio, imports, tarifa/font, canvi, estat i mancances.
- `exchange_rates`: parell, dia, fraccio i font.
- `usage_attribution_rules`: metadada allowlistada, valor, desti, vigencia i prioritat.
- `usage_budgets`: abast XOR, periode, import, moneda i llindars.
- `usage_sources`: font de connector XOR manual, identificador estable i ultima passada completa.
- `usage_budget_sources`: pressupost, font, finestra de vigencia i obligatorietat.
- `usage_budget_events`: canvi d'estat append-only i clau d'idempotencia.
- `usage_monthly_snapshots`: revisio mensual finalitzada per dimensions, moneda i cobertura.

Totes les taules empresarials porten RLS `enable` + `force`, FK compostes i indexes per periode,
font i abast. Les evidencies no admeten `delete` del rol d'aplicacio; la purga reglada usa una
funcio dedicada i auditada.

### Correu

- `mailbox_bindings`: instancia, carpeta o label, canal de suport, politica i cursor.
- `mail_imports`: identificador extern, ticket/missatge, regla, estat i error estable.
- `mail_deliveries`: ticket message, accio, idempotency key, estat i identificador extern.

No es crea una segona taula permanent de cossos: el contingut de negoci viu a suport.

## Permisos

| Accio | Permis | Owner | Administrator | Technical |
|---|---|:---:|:---:|:---:|
| Llegir volum i salut sense imports | `usage:read` | X | X | X |
| Llegir costos, FX, pressupostos i marge | `financials:read` | X | X |  |
| Publicar o anul.lar tarifes i FX | `usage:manage` | X |  |  |
| Gestionar pressupostos | `budgets:manage` | X | X |  |
| Configurar connectors | `integrations:manage` | X |  | X |
| Llegir correu importat | `tickets:read` | X | X | X |
| Importar o respondre | `tickets:manage` + permis d'accio 7B | X | X | X |

Separar `budgets:manage` de `usage:manage` permet que Administrator gestioni pressupostos sense
publicar tarifes. L'API no retorna camps financers a qui nomes te `usage:read`.

## API proposada

```text
GET  /api/v1/usage/overview
GET  /api/v1/usage/events
GET  /api/v1/usage/costs
GET  /api/v1/usage/attribution-gaps
GET  /api/v1/usage/rates
POST /api/v1/usage/rates
POST /api/v1/usage/rates/:rateId/annul
GET  /api/v1/usage/exchange-rates
POST /api/v1/usage/exchange-rates
GET  /api/v1/usage/budgets
POST /api/v1/usage/budgets
PATCH /api/v1/usage/budgets/:budgetId
GET  /api/v1/crm/customers/:customerId/variable-costs
GET  /api/v1/products/:productId/variable-costs
POST /api/v1/support/mail/import
POST /api/v1/tickets/:ticketId/mail-replies
GET  /api/v1/tickets/:ticketId/mail-deliveries
```

Els llistats son paginats server-side. Els exports financers exigeixen `financials:read`, permis
d'export i auditoria. Els errors segueixen `errors-and-api.md`.

## Retencio proposada

- Events, correccions i valoracions: 24 mesos per defecte, configurable pel tenant.
- Snapshots mensuals: mentre existeixi relacio comercial o obligacio definida.
- Registres temporals de bustia no importats: 30 dies.
- Imports i lliuraments: mateixa retencio que el ticket.
- Contingut d'IA: no es desa.

La politica definitiva necessita revisio RGPD i contractual abans de Release 1.0.

### Ampliacio aprovada: historic posterior a la purga

Abans de purgar events d'un mes, el worker crea una revisio immutable a
`usage_monthly_snapshots`, separada per tenant, mes, font, dimensions d'atribucio, SKU, moneda
original i moneda d'informe. Conserva quantitats, cost, cobertura, percentatge atribuït,
`observed_through`, fonts i mancances; no conserva contingut ni IDs individuals.

Una revisio nomes es `finalized` quan totes les fonts obligatories del periode son completes i no
hi ha valoracions pendents. La purga nomes pot eliminar events coberts per una revisio finalitzada
i fora de legal hold. Una correccio tardana crea una revisio mensual nova; no modifica la vella.
Els informes de marge anteriors a la finestra d'events llegeixen l'ultima revisio finalitzada, de
manera que els 24 mesos de detall no esborren l'historic financer.

## Observabilitat i auditoria

- Metriques: retard d'ingestio, duplicats, events sense preu, cost no atribuït, valoracions
  parcials, pressupostos excedits i lliuraments fallits.
- Cap prompt, cos de correu, adreca completa, import financer o secret als logs.
- Auditoria: tarifa/FX, regla d'atribucio, pressupost, import, resposta i revaloracio.
- Cada informe porta `observedThrough`, fonts, percentatge atribuït i mancances.

## Criteris d'acceptacio

1. Repetir un event extern no duplica consum ni cost.
2. Una tarifa nova no modifica el cost historic.
3. Una correccio crea evidencia nova i no muta l'event original.
4. Cap conversio perd import original, tipus, font o dia.
5. Una mancança produeix `partial`, `stale` o `unpriced`, mai un zero inventat.
6. El cost no atribuible queda separat.
7. Technical veu volum i salut, pero rep `403` a imports, pressupostos i marge.
8. Cap referencia pot travessar tenants.
9. Prompts, respostes i payloads crus no arriben a PostgreSQL, jobs, logs ni errors.
10. Repetir un missatge extern crea un sol missatge de ticket.
11. Una resposta sense confirmacio, idempotency key o permis es rebutjada.
12. La fallada d'un proveidor no interromp els altres i nomes marca la seva cobertura stale.
13. Un pressupost parcial o stale no es mostra `healthy`.
14. El marge separa monedes originals i nomes consolida amb FX reproduible.

## Pla de proves

- Domini: escales, `BigInt`, half-up, FX racional, prioritats i propagacio d'estats.
- Connectors: fixtures versionades, paginacio, rate limit, errors i redaccio.
- PostgreSQL: RLS, FK compostes, append-only, deduplicacio concurrent i purga.
- Worker: at-least-once, retry transitori, circuit breaker i alertes idempotents.
- API: permisos negatius, camps financers absents, paginacio i OpenAPI.
- E2E: cost parcial, atribucio, pressupost, import i resposta confirmada.
- Seguretat: secrets, SSRF, OAuth state/PKCE/replay i HTML no fiable.

## Rollout

- Flags separades `usage_costs` i `mail`.
- Migracions additives i expand/contract.
- Apagar una flag atura ingestio i oculta API/UI, pero la purga continua.
- Cap proveidor es obligatori per arrencar el core.
- Rollback preserva events i correus ja incorporats a suport.

## Decisions aprovades pel propietari el 23 d'agost de 2026

1. Particio 8.1, 8.2 i 8.3.
2. No desar prompts/respostes; el cos de correu nomes persisteix a suport.
3. El cost no atribuït no es reparteix automaticament.
4. Pressupostos informatius, no bloquejos de proveidor.
5. Moneda d'informe amb FX versionat i importacio manual inicial.
6. Retencio inicial de 24 mesos per costos i 30 dies per correu temporal, pendent de revisio legal.

## Ampliacions aprovades pel propietari el 23 d'agost de 2026

1. Fonts canoniques i fonts obligatories explicites per pressupost a `usage_sources` i
   `usage_budget_sources`.
2. Valoracions amb event XOR correccio i quantitats de correccio amb signe.
3. Snapshots mensuals versionats abans de purgar el detall.
