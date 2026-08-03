# Especificacio de projectes i temps

**Estat:** aprovada pel propietari el 2026-08-03. Planificada com a Fase 5B, despres dels
tickets. El cost per hora es per persona, decisio del propietari.

Aquest document segueix `docs/templates/feature-spec-template.md`. Els imports i el
tractament monetari reutilitzen les decisions ja aprovades a `commerce.md`; on hi hagi
diferencia, mana aquest document per als projectes i el temps.

## Problema i usuaris

L'empresa ven entregues: automatitzacions n8n, webs, agents de veu i software a mida.
Control Hub ja sap qui es el client i que li ven de forma recurrent, pero no sap **quina
feina concreta hi ha en curs** ni **quant costa fer-la**. Avui aquesta informacio viu al cap
de les persones i a converses de missatgeria.

La consequencia practica es que la Fase 8 podra calcular el cost d'infraestructura i d'IA per
client, pero no el cost de les persones, que en una empresa de serveis es la partida gran. El
marge que es mostri sense hores sera optimista i no reconciliable.

- `Owner`: decideix preus i sap si un client dona perdues.
- `Administrator`: obre projectes, hi assigna responsables i en segueix l'estat.
- `Technical`: imputa les seves hores i consulta la seva propia feina.

## Abast

- Projectes per client, amb estat, dates, responsable i historial.
- Imputacio de temps a un projecte o a un ticket, amb marca de facturable.
- Barems de cost per persona i de venda per client o projecte, versionats per data d'efecte.
- Rendibilitat per projecte i per client.
- Vincle opcional de ticket a projecte.

## Fora d'abast

- **Emissio de factures.** Igual que a `commerce.md`, Control Hub calcula i justifica; no
  factura. Aixo inclou prorrateig i numeracio fiscal.
- **Aprovacio de fulls d'hores.** No hi ha flux de revisio ni tancament de periode; les
  imputacions son responsabilitat de qui les crea i queden auditades.
- **Temporitzadors en temps real.** La primera versio registra entrades manuals amb durada.
  Un cronometre es UI sobre el mateix contracte i pot arribar despres sense migracio.
- **Barem de venda per persona.** El preu es per client o projecte. Amb un equip de dues
  persones, distingir tarifa per perfil afegeix una dimensio que ningu consultara encara.
- **Planificacio de capacitat.** Saber quantes hores queden lliures es una fase propia.
- **Projectes multi-client.** Un projecte pertany a un unic client.

## Decisions

1. Un projecte pertany a exactament un client.
2. Una imputacio pertany a **exactament un** projecte o un ticket, mai a cap ni a tots dos.
3. El client d'una imputacio es **derivat**, no desat: desar-lo crearia una segona veritat que
   es pot desincronitzar del projecte o del ticket.
4. El cost per hora es **per persona** (membership). El preu de venda per hora es per client o
   per projecte, i el mes especific guanya.
5. Els barems son **append-only amb data d'efecte**, com `plan_prices`. Una imputacio es
   valora amb el barem vigent el dia treballat, mai amb el d'avui: recalcular l'historic amb
   una tarifa nova reescriuria el marge de projectes ja tancats.
6. Els imports son enters en unitats menors amb moneda ISO 4217 explicita. Cap calcul amb
   coma flotant. No s'agreguen monedes diferents en una sola quantitat.
7. El temps es desa en **minuts enters**. Els segons son soroll en feina facturable i les
   hores decimals obliguen a arrodonir dues vegades.
8. Un projecte tancat no accepta imputacions noves. Reobrir-lo es una accio explicita i
   auditada.

## Fluxos

**Obrir i seguir un projecte.** Un `Administrator` crea el projecte sobre un client existent,
hi posa responsable i data prevista. L'estat avanca `draft -> active -> delivered -> closed`.
`on_hold` i `canceled` son sortides possibles des de qualsevol estat no terminal. Cada canvi
escriu un event append-only amb qui, quan i des de quin estat.

**Imputar temps.** Qualsevol membre registra minuts contra un projecte o un ticket, amb la
data treballada, si es facturable i una nota breu. La data treballada pot ser anterior a avui;
no pot ser futura.

**Publicar un barem.** L'`Owner` publica un cost per hora per a una persona, o un preu de
venda per a un client o projecte, amb data d'efecte. La fila anterior no es modifica.

**Consultar rendibilitat.** Un rol amb acces financer veu, per projecte i per client, les
hores imputades, les facturables, l'ingres teoric, el cost i el marge.

## Criteris d'acceptacio

- Un projecte no es pot crear sense client existent dins del tenant.
- Una imputacio amb projecte i ticket alhora, o sense cap dels dos, es rebutjada.
- Si un ticket porta projecte, el projecte ha de ser del mateix client que el ticket.
- Una imputacio amb data futura es rebutjada.
- Una imputacio sobre un projecte tancat es rebutjada.
- El cost d'una imputacio del mes passat no canvia quan es publica un barem nou avui.
- Un `Technical` no pot llegir cap cost per hora ni cap marge, ni per API ni per UI.
- Tancar un projecte, publicar un barem i esborrar una imputacio generen auditoria.
- Un tenant no veu projectes, imputacions ni barems d'un altre.

## Permisos i tenancy

Permisos nous, seguint `permissions.md` (deny by default, l'API autoritza permisos i mai
noms de rol):

| Permis | Owner | Administrator | Technical |
|---|:---:|:---:|:---:|
| `projects:read` | X | X | X |
| `projects:manage` | X | X | X |
| `time:log` | X | X | X |
| `time:manage` | X | X |  |
| `rates:manage` | X |  |  |

- `projects:manage` ja existeix al domini i no s'ha fet servir mai; aquesta feature l'estrena.
- `time:log` permet crear i editar **les propies** imputacions. `time:manage` permet tocar les
  de terceres persones.
- `rates:manage` es nomes de l'`Owner`. Un cost per hora es informacio adjacent al sou.
- La lectura de cost i marge va sota `financials:read`, que `Technical` no te.
- Totes les taules noves amb RLS i `force row level security`, com la resta.

## Model de dades i migracio

Taules noves, totes amb `tenant_id` i RLS:

- `projects`: `customer_id`, `code` (estable dins del tenant), `name`, `status`,
  `owner_membership_id`, `started_at`, `due_at`, `closed_at`.
- `project_events`: append-only, historial d'estat amb actor i motiu.
- `member_cost_rates`: `membership_id`, `currency`, `cost_minor_per_hour`, `effective_from`.
  Append-only. Unic per `(membership_id, currency, effective_from)`.
- `billing_rates`: `scope` (`customer` o `project`), `scope_id`, `currency`,
  `amount_minor_per_hour`, `effective_from`. Append-only, mateixa regla d'unicitat.
- `time_entries`: `membership_id`, `project_id` nullable, `ticket_id` nullable, `spent_on`
  (date), `minutes`, `billable`, `note`.

Restriccions a la base de dades, no nomes al domini:

- `check (num_nonnulls(project_id, ticket_id) = 1)` per al xor de la imputacio.
- `check (minutes between 1 and 1440)`.
- Claus foranes compostes amb `tenant_id` per impedir referencies creuades entre tenants.
- Triggers append-only a `project_events`, `member_cost_rates` i `billing_rates`, seguint el
  patro ja aplicat a `plan_prices` i `subscription_events`.

Migracio a la Fase 5: `tickets.project_id` nullable amb clau forana composta. Afegir-lo quan
es creen els tickets evita una migracio de dades despres.

## Calcul

Amb `BigInt`, com `packages/domain`:

```text
cost_minor    = round_half_up(minutes * cost_minor_per_hour / 60)
revenue_minor = billable ? round_half_up(minutes * amount_minor_per_hour / 60) : 0
margin_minor  = sum(revenue_minor) - sum(cost_minor)
```

L'arrodoniment s'aplica **per imputacio**, no sobre la suma. Aixi el total d'un informe es
sempre la suma dels seus components i un client pot reconciliar-lo linia per linia.

Resolucio del barem per a una imputacio del dia `D`:

- Cost: fila de `member_cost_rates` d'aquella persona amb `effective_from <= D` mes recent.
- Venda: fila de `billing_rates` amb `scope = project` mes recent; si no n'hi ha, la de
  `scope = customer`. Si no n'hi ha cap, la imputacio compta hores pero no ingres, i l'informe
  ho mostra com a barem absent en comptes de com a zero.

Una imputacio sense cost resoluble es un error de configuracio visible, no un cost de zero.

## API, events i idempotencia

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId/status
GET    /api/v1/projects/:projectId/profitability
GET    /api/v1/time-entries
POST   /api/v1/time-entries
PATCH  /api/v1/time-entries/:timeEntryId
DELETE /api/v1/time-entries/:timeEntryId
POST   /api/v1/rates/cost
POST   /api/v1/rates/billing
GET    /api/v1/rates
```

- Els llistats segueixen el contracte de `smart-data-table.md`: paginacio server-side, cerca,
  ordenacio i filtres.
- `POST /api/v1/time-entries` no es idempotent per naturalesa. Accepta un `clientReference`
  opcional, unic per membership, perque un reintent de xarxa no dupliqui hores.
- `profitability` mai barreja monedes: retorna una entrada per moneda, com les metriques
  financeres de la Fase 4.
- Els codis d'error segueixen `errors-and-api.md`.

## UX, i18n i accessibilitat

- Pantalla de projectes amb `SmartDataTable` i `PageTopbar`, com la resta de moduls.
- Imputar hores ha de ser rapid: formulari curt, data per defecte avui, i durada acceptada
  tant en minuts com en format `1h 30m`.
- Els costos i marges no es renderitzen per a qui no te `financials:read`; s'oculten al
  servidor, no amb CSS.
- Textos a `ca`, `es` i `en`. Dates en UTC a la base i amb el locale de l'usuari a la UI.
- Les durades s'anuncien de forma llegible per lectors de pantalla, no com a numero cru.

## Threat model

- **Exposicio de cost per hora.** Es la dada mes sensible d'aquesta feature: permet deduir
  sous. Mai ha de viatjar en una resposta accessible sense `financials:read`, ni aparegut en
  logs. Els camps de cost es redacten a l'observabilitat.
- **Manipulacio d'hores.** Les imputacions justifiquen factures. Editar o esborrar-ne una
  genera auditoria amb el valor anterior; no s'esborren en silenci.
- **Referencies creuades de tenant.** Un `projectId` d'un altre tenant no ha de poder
  vincular-se a un ticket propi: claus foranes compostes amb `tenant_id` i RLS.
- **Escalada per rol.** `Technical` te `projects:manage` per operar, i aixo no li pot obrir
  cap porta a barems ni a marge.

## Observabilitat i auditoria

- Auditoria: `project.created`, `project.status.changed`, `rate.cost.published`,
  `rate.billing.published`, `time_entry.created`, `time_entry.updated`, `time_entry.deleted`.
- Metriques: hores imputades per setmana i nombre de projectes actius, per al dashboard.
- Cap import de cost als logs.

## Pla de proves

- **Domini:** arrodoniment half-up, resolucio de barem per data, marge amb diverses monedes,
  transicions d'estat de projecte.
- **Integracio amb PostgreSQL:** RLS a les quatre taules noves, el xor de la imputacio, el
  rebuig sobre projecte tancat, i que els triggers append-only impedeixen modificar barems.
- **Permisos:** `Technical` rep `403` a cost i a marge; `time:log` no pot editar hores d'una
  altra persona.
- **Reproduibilitat:** publicar un barem nou no altera el cost d'una imputacio anterior.

## Rollout, feature flag i rollback

- Migracions additives: cap columna existent canvia de significat.
- Feature flag tipada `projects_and_time`, amb propietari i data de retirada, segons
  `engineering-conventions.md`. Permet desplegar l'esquema abans d'obrir la UI.
- Rollback: desactivar la flag deixa les taules al seu lloc sense afectar CRM ni commerce.
- `tickets.project_id` es nullable des del primer dia, aixi que la Fase 5 pot sortir abans que
  aquesta feature sense deute de migracio.

## Ordre respecte de la Fase 5

Aquesta feature no bloqueja els tickets. La dependencia real es al reves: si els tickets
surten primer, nomes cal que neixin amb `project_id` nullable. La decisio d'ordre es
comercial, no tecnica, i queda pendent del propietari.
