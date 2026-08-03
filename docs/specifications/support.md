# Especificacio de suport, tickets i SLA

**Estat:** proposta. Pendent d'aprovacio del propietari.

Correspon a la Fase 5 del pla. Segueix `docs/templates/feature-spec-template.md` i reutilitza
les decisions ja aprovades a `commerce.md` (diners i historial immutable) i a
`projects-and-time.md` (vincle de projecte i imputacio d'hores).

## Problema i usuaris

Les peticions dels clients arriben per missatgeria, correu i trucades. No queda registre de
que s'ha demanat, qui ho porta ni quant fa que espera. Quan una cosa es perd, ningu se
n'assabenta fins que el client ho torna a preguntar, i no hi ha manera de saber si aixo passa
sovint o si es va concentrar en un client concret.

- `Owner`: vol saber la carrega, els incompliments i quins clients consumeixen mes suport.
- `Administrator`: reparteix la feina i vigila els venciments.
- `Technical`: resol, deixa constancia del que ha fet i imputa el temps.

## Abast

- Tickets amb prioritat, estat, categoria, responsable i historial.
- Comentaris interns i comunicacions marcades com a visibles per al client.
- SLA de primera resposta i de resolucio, amb rellotge d'horari laboral.
- Escalats quan un objectiu esta a punt d'incomplir-se o ja s'ha incomplert.
- Incidencies operatives, vinculables a clients i a tickets.
- Notificacions internes i historial.
- Contracte per a canals entrants, preparat pero no connectat.

## Fora d'abast

Amb el motiu, perque no es reobri per descuit:

- **Enviar res al client.** El correu sortint es Fase 8 i el portal es Fase 10. Aqui nomes es
  marca la visibilitat. Decisio del propietari: de moment es respon des del correu de sempre.
- **Bustia entrant.** Cap IMAP ni webhook connectat. Es deixa el contracte perque quan arribi
  no calgui migrar dades ni reobrir el domini.
- **SLA per client.** Els objectius son per prioritat i iguals per a tothom. Decisio del
  propietari; ampliar-ho despres no migra dades, nomes afegeix una resolucio en cascada.
- **Reassignacio automatica.** Un escalat notifica; no mou el ticket de mans. Amb un equip de
  dues persones, reassignar sol nomes genera soroll.
- **Enquestes de satisfaccio i base de coneixement.**
- **Importacio de calendaris oficials de festius.** Els festius s'introdueixen a ma.

## Decisions

1. Estats: `new`, `open`, `waiting_customer`, `waiting_third_party`, `resolved`, `closed`.
   `closed` es terminal. Des de `resolved` es pot reobrir; reobrir escriu event i no esborra
   les marques de temps anteriors.
2. **El rellotge del SLA s'atura a `waiting_customer` i a `waiting_third_party`.** No es pot
   mesurar per un termini mentre s'espera resposta d'algu altre; sense aixo, l'indicador
   mesura la lentitud del client i no la nostra.
3. El rellotge nomes corre dins de l'horari de suport configurat, en la zona horaria del
   tenant, i salta caps de setmana i festius.
4. Els objectius de SLA son **append-only amb data d'efecte**, com els barems i els preus. Un
   ticket es mesura contra l'objectiu vigent el dia que es va obrir: canviar els objectius
   avui no pot convertir en compliments els incompliments del mes passat.
5. Prioritats: `low`, `normal`, `high`, `urgent`. Mateix vocabulari que els leads pero tipus
   propi, perque canviar-ne un no arrossegui l'altre en silenci.
6. Un ticket pertany sempre a un client. El projecte es opcional, i si hi es ha de ser del
   mateix client.
7. La visibilitat d'un missatge (`internal` o `customer`) es part del registre des del primer
   dia, encara que res no la consumeixi encara.
8. `first_response_at` s'escriu un sol cop, amb el primer missatge visible per al client
   escrit per un membre. No es pot moure enrere.

## Fluxos

**Obrir i resoldre.** Un membre crea el ticket sobre un client, amb assumpte, prioritat i
categoria. En crear-lo es desa una copia dels objectius de SLA vigents. S'assigna, es
treballa, s'hi deixen comentaris, i quan es dona per fet passa a `resolved`. Es tanca despres,
manualment o per inactivitat.

**Esperar el client.** Quan cal informacio de fora, el ticket passa a `waiting_customer` i el
rellotge s'atura. En tornar a `open`, continua on era.

**Escalar.** Un proces periodic marca els tickets que han superat un objectiu o que hi son a
prop, i genera notificacio interna. L'estat d'escalat es visible a la safata.

**Registrar una incidencia.** Un problema operatiu (una caiguda, un error recurrent) es
registra com a incidencia i es pot vincular a un o mes tickets i a un client. A la Fase 7 hi
podran penjar serveis i execucions d'n8n.

**Imputar temps.** Les hores dedicades a un ticket es registren segons
`projects-and-time.md`, contra el ticket i no contra el projecte.

## Criteris d'acceptacio

- Un comentari intern no apareix mai en cap resposta marcada com a visible per al client.
- El SLA d'un ticket obert divendres a les 18:00 no consumeix el cap de setmana.
- Un festiu configurat no compta com a temps de SLA.
- El temps en `waiting_customer` no compta.
- Publicar objectius de SLA nous no altera el compliment d'un ticket ja obert.
- Un ticket amb projecte d'un altre client es rebutjat.
- Dos missatges entrants amb la mateixa referencia externa creen un unic missatge.
- `first_response_at` no canvia despres del primer missatge visible.
- Tancar, reassignar i canviar la prioritat generen auditoria.
- Un tenant no veu tickets, missatges ni incidencies d'un altre.

## Permisos i tenancy

| Permis | Owner | Administrator | Technical |
|---|:---:|:---:|:---:|
| `tickets:read` | X | X | X |
| `tickets:manage` | X | X | X |
| `support:configure` | X | X |  |

- `tickets:manage` ja existeix a `permissions.md` per als tres rols.
- `support:configure` cobreix objectius de SLA, horari i festius. Son parametres que canvien
  el que compta com a incompliment, i per tant no toca a qui nomes resol tickets.
- Totes les taules noves amb RLS i `force row level security`.

## Model de dades i migracio

- `tickets`: `customer_id` obligatori, `project_id` nullable, `reference` (serie llegible per
  tenant), `subject`, `description`, `status`, `priority`, `category`,
  `assignee_membership_id`, `opened_at`, `first_response_at`, `resolved_at`, `closed_at`,
  `first_response_target_minutes`, `resolution_target_minutes`.
- `ticket_messages`: `ticket_id`, `author_membership_id` nullable (nul quan vindra d'un canal
  entrant), `body`, `visibility` (`internal` o `customer`), `external_reference` nullable.
  Append-only.
- `ticket_events`: append-only, historial d'estat, assignacio i prioritat amb actor i motiu.
- `sla_targets`: `priority`, `first_response_minutes`, `resolution_minutes`, `effective_from`.
  Append-only, unic per `(priority, effective_from)`.
- `support_schedule`: `weekday`, `opens_at`, `closes_at`, i zona horaria del tenant.
- `support_holidays`: `holiday_on` (date), unic per tenant.
- `incidents`: `title`, `severity`, `status`, `started_at`, `resolved_at`, `customer_id`
  nullable.
- `incident_tickets`: relacio N a N entre incidencies i tickets.

Restriccions a la base de dades:

- Claus foranes compostes amb `tenant_id`, com a la resta del projecte.
- El projecte d'un ticket ha de compartir client: clau forana composta
  `(tenant_id, customer_id, project_id)` contra `projects`.
- `unique (tenant_id, external_reference)` a `ticket_messages`: es aixo el que fa idempotent
  un missatge entrant, no una comprovacio a l'aplicacio.
- Triggers append-only a `ticket_messages` i `ticket_events`.
- `tickets.project_id` nullable des d'aquesta primera migracio (vegeu Fase 5B).

Els objectius es **copien** al ticket en obrir-lo (`first_response_target_minutes`,
`resolution_target_minutes`) en comptes de referenciar la fila vigent. Es el mateix criteri
que els preus contractats a `commerce.md`: el compliment d'un ticket antic ha de ser
justificable sense reconstruir quina configuracio hi havia aquell dia.

## Calcul del SLA

El temps consumit es mesura en **minuts laborables**: la interseccio entre l'interval
transcorregut i les finestres de `support_schedule`, descomptant `support_holidays` i els
periodes en que el ticket estava en espera.

```text
consumed = business_minutes(opened_at, now_or_first_response) - paused_business_minutes
breached = consumed > target_minutes
```

- Tot es desa en UTC; l'horari s'interpreta en la zona horaria del tenant.
- El calcul es pur i deterministic, i viu a `packages/domain` perque es pugui provar sense
  base de dades.
- Un ticket sense horari configurat no es mesura: es mostra com a SLA no configurat, no com a
  compliment. Un zero i una configuracio absent no poden semblar el mateix.

## API, events i idempotencia

```text
GET    /api/v1/tickets
POST   /api/v1/tickets
GET    /api/v1/tickets/:ticketId
PATCH  /api/v1/tickets/:ticketId/status
PATCH  /api/v1/tickets/:ticketId/assignment
PATCH  /api/v1/tickets/:ticketId/priority
POST   /api/v1/tickets/:ticketId/messages
GET    /api/v1/tickets/:ticketId/sla
GET    /api/v1/support/sla-targets
POST   /api/v1/support/sla-targets
GET    /api/v1/support/schedule
PUT    /api/v1/support/schedule
GET    /api/v1/incidents
POST   /api/v1/incidents
PATCH  /api/v1/incidents/:incidentId/status
```

- Els llistats segueixen `smart-data-table.md`.
- `POST /messages` accepta `externalReference` opcional. Repetir-lo retorna el missatge ja
  creat amb `200` en comptes de crear-ne un de nou. Aixo es el contracte que un canal entrant
  consumira a la Fase 8 sense tocar el domini.
- Els codis d'error segueixen `errors-and-api.md`.

## UX, i18n i accessibilitat

- Safata amb `SmartDataTable`: filtres per estat, prioritat, responsable i client, i indicador
  de venciment visible d'un cop d'ull.
- El venciment no es comunica nomes amb color: cal text o icona, perque un dalto no depengui
  del vermell per veure que una cosa s'ha incomplert.
- La fitxa mostra la conversa en ordre cronologic, amb els comentaris interns clarament
  diferenciats. La diferencia no pot ser nomes visual: el marcatge ha de ser al DOM.
- Textos a `ca`, `es` i `en`. Durades i dates amb el locale de l'usuari.

## Threat model

- **Fuita d'un comentari intern.** Es el risc principal. La visibilitat es l'unica porta, i
  qualsevol superficie futura (portal, correu) l'ha de llegir. Un test ha de comprovar que un
  missatge intern no apareix mai en una consulta de visibilitat de client.
- **Contingut sensible al cos dels missatges.** Els clients enganxen contrasenyes i claus als
  tickets. Els cossos no s'escriuen mai als logs, i la politica de retencio de
  `data-governance.md` els cobreix.
- **Referencia externa manipulable.** Quan hi hagi canal entrant, `externalReference` vindra
  de fora. Es unica per tenant i no s'utilitza mai per autoritzar res, nomes per deduplicar.
- **Referencies creuades de tenant.** Projecte, client i incidencia d'un ticket es validen amb
  claus foranes compostes, no amb comprovacions a l'aplicacio.

## Observabilitat i auditoria

- Auditoria: `ticket.created`, `ticket.assigned`, `ticket.status.changed`,
  `ticket.priority.changed`, `ticket.sla.breached`, `sla_target.published`,
  `support.schedule.updated`, `incident.created`, `incident.status.changed`.
- Metriques: tickets oberts per prioritat, incompliments per setmana, temps mitja de primera
  resposta.
- Cap cos de missatge als logs ni a les metriques.

## Pla de proves

- **Domini:** minuts laborables travessant un cap de setmana i un festiu; pausa a
  `waiting_customer`; transicions d'estat valides i invalides; objectiu copiat immutable.
- **Integracio amb PostgreSQL:** RLS a totes les taules noves; append-only de missatges i
  events; rebuig d'un projecte d'un altre client; unicitat d'`external_reference`.
- **Permisos:** `Technical` pot resoldre pero no configurar SLA ni horari.
- **Visibilitat:** un comentari intern no surt mai per la superficie de client.

## Rollout, feature flag i rollback

- Migracions additives; cap columna existent canvia de significat.
- Feature flag tipada `support_desk`, amb propietari i data de retirada.
- El proces d'escalat corre al worker, amb la cua que ja existeix. Si es para, els tickets no
  es perden: el calcul de SLA es derivat i es recalcula en consultar-lo.
- Rollback: desactivar la flag deixa les taules i no afecta CRM, commerce ni projectes.
