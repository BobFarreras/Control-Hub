# Especificacio del connector de Supabase

> Estat: **aprovada pel propietari el 24 d'agost de 2026**, amb el compromis de seguretat que la
> seccio "Seguretat" descriu sencer i no s'amaga.
>
> Especificacions relacionades: `connectors.md` (el contracte), `connector-security.md`
> (l'allowlist i el `guarded-fetch`), `connector-vercel.md` (el precedent: mateix perimetre,
> mateix disseny de franja) i `infrastructure.md` (el model de maquines i serveis). Aquest
> document no en repeteix cap regla: hi remet.

## Problema

Cada base de dades de client viu a Supabase, i el mode de fallada tipic del pla petit no el diu
ningu: **el projecte es pausa sol** per inactivitat, i tot el que en depen —web, app, n8n si hi
llegeix— es queda sense resposta fins que algu ho descobreix perque un client es queixa.

Supabase ja sap l'estat de cada projecte i la seva API respon en una crida. El que falta es que
arribi al mateix lloc on ja es veuen les VPS, les automatitzacions i els projectes de Vercel.

## Abast

Un connector, una operacio de lectura, cap escriptura. Nomes projectes: **cap** taula, columna,
fila, funcio, secret, backup ni log d'un projecte. El que interessa es si el projecte hi es, no que
hi ha a dins.

**Fora d'abast**, i deliberadament:

- **Pausar, restaurar, crear o esborrar res.** Cap operacio d'escriptura, ni avui ni com a extensio
  prevista: aixo es la fase 7B i te el seu contracte. El connector nomes declara `operations`, mai
  `actions`, i la seva manifest no en te cap.
- **Qualsevol dada de dins del projecte.** Taules, files, funcions Edge, backups, logs, advisors de
  seguretat o rendiment: tot aixo demana un token *per projecte*, no el de gestio del compte, i es
  una altra pregunta.
- **Facturacio i cost.** Ja es una seccio a part (`communications-usage-costs.md`) i barrejar-hi
  Supabase abans que aquella seccio ho decideixi seria avançar-se.
- **Dominis i certificats.** El domini per defecte de Supabase (`<ref>.supabase.co`) no es un
  domini de client; si mai n'hi ha un de personalitzat, ja el veuria el blackbox del Prometheus.

## Decisions

### 1. Un token de gestio de Supabase no es de nomes lectura, i no hi ha manera de fer-ho

**Aquesta es la decisio que calia prendre abans de picar cap linia, i el propietari l'ha presa amb
el risc sencer a la taula.** Un Personal Access Token de Supabase porta, textualment, "the same
privileges as your user account": el mateix token que llista projectes els pot pausar, esborrar,
tocar la facturacio i gestionar membres de l'organitzacio. No existeix cap abast reduit per a un
PAT. L'unica manera de tenir un token limitat de veritat es una app OAuth2 amb `projects:read`, que
demana el tram OAuth2 de la Fase 7B —avui **zero codi**— i que es un connector diferent, no aquest.

Es va valorar esperar aquell tram. **Es descarta per ara**: la Fase 7B esta pensada per Gmail i
Microsoft Graph amb accions confirmades i IMAP, no per llegir l'estat d'un projecte, i construir-la
nomes per aixo hauria significat aixecar tota una plataforma —PKCE, `state`, grants, refresh amb
lease— per estalviar-se un camp d'un formulari.

**El risc resultant, dit sencer:** una fuita d'aquest token, o del vault que el guarda, dona a qui
el tingui la capacitat de pausar o esborrar qualsevol projecte de qualsevol client de l'organitzacio
Supabase connectada. Les mitigacions son les que ja existeixen i cap de noves:

- El token no viatja mai fora de la capcalera `Authorization`, com tots els altres.
- El connector **nomes crida `GET`**. No hi ha cap camí de codi que hi faci un `POST`, `PATCH` o
  `DELETE`: la manifest no declara `actions` i el contracte de connector no en permet cap fora del
  que declara.
- El vault, l'aillament de tenant i l'auditoria son els mateixos que per a qualsevol altra
  credencial: aquest connector no en rebaixa cap.
- **La pantalla d'incorporacio ho diu amb aquestes paraules**, no amb un eufemisme: el
  `credentialHint` d'aquest connector es la unica pista de credencial de tot el producte que avisa
  d'un privilegi que no volem i no podem treure.

Quan la plataforma OAuth2 arribi per al correu, migrar aquest connector a `projects:read` es un
manifest nou i una credencial nova, no una reescriptura: el disseny de sota —una operacio, un
`externalId`, una projeccio— no canvia gens.

### 2. Una operacio, forma `state`: no hi ha equivalent al desplegament de Vercel

A Vercel calia distingir un estat (el projecte) d'un esdeveniment (un build que passa i s'acaba).
Supabase no te aquest segon eix: **l'estat es tota la historia**. Un projecte pausat no ha "petat"
en un instant que calgui recordar; esta pausat ara, i deixara d'estar-ho quan la propera lectura ho
digui. Per aixo nomes cal `pull_supabase_projects`, forma `state`, com `pull_projects` de Vercel
pero sense el seu parell d'esdeveniments.

### 3. El nom de l'operacio no es `pull_projects`

Es diu `pull_supabase_projects` i no el nom mes curt que Vercel ja fa servir, i no es nomia. La
consulta que dibuixa la franja de Vercel (`listDeployedProjects`, a
`packages/persistence/src/infrastructure-repository.ts`) filtra `connector_records` nomes per
`operation = 'pull_projects'`, sense mirar el tipus de connector: una instancia de Supabase que
escrivis sota el mateix nom d'operacio hi apareixeria barrejada, amb els seus camps buits allà on
Vercel n'espera. Diferenciar el nom evita la barreja sense tocar una consulta ja provada i en
produccio.

### 4. La base no es un camp lliure

`baseUrl` es el literal `https://api.supabase.com` i el formulari no admet cap altre valor. Mateixa
rao que Vercel: deixar-lo lliure donaria el token a qualsevol host que triï qui configura la
instancia, a la primera passada. Egress `configured_base_url`, no `operator_allowlist`.

### 5. Sense organitzacio al formulari

`GET /v1/projects` sense parametres ja torna tots els projectes que el token pot veure, d'totes les
organitzacions. L'inventari de clients d'aquesta empresa viu en una sola organitzacio Supabase per
disseny (vegeu el `CLAUDE.md` de l'empresa: "un projecte per client", una organitzacio). Si mai cal
llegir mes d'una organitzacio amb instancies separades, cada instancia ja te el seu propi token: no
cal un camp per triar-ne una.

### 6. `healthy` es un booleu, com `productionReady` a Vercel

El registre porta `status` (el que diu el proveidor, textual) i `healthy` (`true | false | null`),
pel mateix motiu que Vercel: el motor d'alertes ja sap llegir un booleu d'una lectura. La taula
completa d'estats que Supabase documenta:

| `status` | `healthy` |
|---|---|
| `ACTIVE_HEALTHY` | `true` |
| `INACTIVE` (pausat —el mode de fallada d'aquesta seccio), `ACTIVE_UNHEALTHY`, `INIT_FAILED`, `RESTORE_FAILED`, `PAUSE_FAILED`, `REMOVED` | `false` |
| `COMING_UP`, `GOING_DOWN`, `RESTORING`, `UPGRADING`, `PAUSING`, `RESTARTING`, `RESIZING`, `UNKNOWN`, qualsevol altre no llistat | `null` |

Un projecte en transicio (`PAUSING`, `RESTARTING`...) no es una caiguda, es un projecte fent alguna
cosa: informar-ho com a `false` dispararia una alerta cada vegada que algu actualitzes de versio.
**No hi ha un valor `PAUSED` distint**: Supabase reporta un projecte pausat com `INACTIVE`, igual
que qualsevol altre motiu d'inactivitat —no es pot distingir "pausat pel pla" d'un altre "inactiu"
amb aquest sol camp, i aquest document no ho pretén.

### 7. Del que Supabase ens dona, en desem una projeccio

Es queden: el nom, la regio, l'estat (cru i mapejat), i quan es va crear. Fora, i cadascun pel seu
motiu:

| Camp | Per que no es desa |
|---|---|
| `database.host` | Es un fragment de la cadena de connexio del projecte. No cal per respondre "hi es o no", i publicar-lo duplicaria informacio que ja hauria de viure nomes al vault del client. |
| `organization_id`, `organization_slug` | No afegeix res a la pregunta d'aquest document mentre nomes hi hagi una organitzacio (decisio 5); si mai cal, es un camp per afegir, no per ballar avui. |
| Qualsevol camp de `database` mes enlla de l'existencia del projecte | Vegeu "Fora d'abast": aixo es dins del projecte. |

## El connector

| | |
|---|---|
| Config | `baseUrl` (literal `https://api.supabase.com`) |
| Credencials | `api_token` (capcalera `Authorization: Bearer`) — **privilegi total, vegeu decisio 1** |
| Egress | `configured_base_url`, nomes `https` |
| Operacions | `pull_supabase_projects` (`GET /v1/projects`, forma `state`, cada 5 min) |
| Ingress | No |
| `externalId` | `project:<ref>` |

**El token es una capcalera i prou.** S'obre dins la crida que el necessita i no arriba mai a una
URL, un registre, un log ni un error. Les proves recorren totes les peticions per exigir-ho.

**`GET /v1/projects` no pagina: torna tots els projectes de totes les organitzacions que el token
veu, en una crida.** No hi ha cursor a recorrer i per tant res a truncar a proposit; el sostre de
2000 projectes al schema es una valvula de seguretat, no una mida de pagina, i nomes converteix la
passada en fallada si mai un compte fos tan gran que el sostre calgués revisar.

## Model de dades

**Cap migracio nova per als registres.** Van a `connector_records`, com qualsevol altre connector.

**Cap migracio nova per a l'enllac amb un client, tampoc.** Es reutilitza `infra_project_links`
(migracio `0046`, ja en produccio per als projectes de Vercel). La taula no sap ni li importa de
quin proveidor ve un projecte: nomes lliga `(tenant_id, instance_id, external_id)` a un client i una
nota, i `instance_id` ja diferencia una instancia de Vercel d'una de Supabase sense cap columna
`kind`. Es diferent del cas Vercel-vs-automatitzacions, on es va triar taula propia perque calia
distingir dos **conceptes** diferents dins la mateixa fila; aqui "un projecte allotjat, enllaçat a
un client" es el mateix concepte amb dades diferents a sota, i la taula ja era prou generica.

La ruta d'enllacar (`PUT /api/v1/infrastructure/projects/:instanceId/:externalId/link`) tambe es
reutilitza sense cap canvi: ja nomes pren `instanceId` i `externalId`, mai assumeix de quin
proveidor son.

## Seguretat

- Cap escriptura cap a Supabase, ni una: la manifest no declara `actions`.
- El token nomes viatja a la capcalera `Authorization`, mai a una query string.
- La destinacio esta fixada al codi; la configuracio del tenant no la pot moure.
- Cap resposta del proveidor es desa sencera: nomes els camps que aquest document nomena.
- Cap log del connector porta el token ni el cos de la resposta.
- **El privilegi del token es superior al de qualsevol altra credencial d'aquest producte**, i
  aixo es diu a l'onboarding, no nomes aqui. Vegeu decisio 1: es un risc acceptat pel propietari,
  no un descuit.

## Criteris d'acceptacio

1. Amb un token valid, `pull_supabase_projects` torna un registre per projecte amb nom, regio,
   estat cru, estat mapejat i data de creacio.
2. Cap peticio porta el token fora de la capcalera `Authorization`.
3. Cap registre conte `database.host`, `organization_id` ni cap camp que aquest document no nomeni.
4. Un estat de transicio (`PAUSING`, `RESTARTING`...) dona `healthy: null`, no `false`.
5. `INACTIVE` dona `healthy: false`.
6. Un compte amb mes projectes que el sostre de seguretat falla la passada, no en trunca la
   resposta.
7. Amb una configuracio que no es la base literal, la instancia no es desa.
8. La franja ensenya una fila per projecte llegit, amb el nom, la regio, l'estat i quan es va
   crear.
9. Associar i retirar un client reutilitza `infra_project_links` sense cap migracio nova, i la nota
   sobreviu a retirar l'associacio.
10. Un tenant no veu mai un projecte ni un enllac d'un altre, i la prova ho exigeix contra
    PostgreSQL amb RLS forcada.
11. `credentialHint_supabase_api_token` diu explicitament que el token no es de nomes lectura.

## Pla de proves

Del connector (criteris 1-7), unitaries amb un `http` fals: no hi ha xarxa a la suite. Mateix
esquema que `vercel.test.ts`.

De la franja (criteris 8-10), una capa cadascuna:

| Capa | Que demostra |
|---|---|
| `packages/persistence` (integracio, PostgreSQL) | La lectura de projectes Supabase i que un tenant no en veu res d'un altre amb RLS forcada |
| `packages/application` | Qui pot llegir i qui pot associar |
| `apps/api` | Que la resposta no porta ni token ni cap camp fora d'abast |
| `apps/web` | Que la franja desapareix sota un recollidor que no llegeix projectes Supabase |
| `tests/e2e` | Que una fila diu l'estat i la regio d'un projecte llegit |

## La franja de projectes Supabase

Una franja mes a la pantalla d'infraestructura, separada de la de Vercel perque les dades no son
les mateixes columnes: un projecte de Supabase no te domini de produccio ni framework, te regio i
un estat amb mes valors que "serveix / caiguda".

| Columna | D'on surt |
|---|---|
| Projecte | `data ->> 'name'`, i a sota el recollidor |
| Regio | `data ->> 'region'` |
| Estat | `healthy`: **actiu**, **inactiu**, o **en transicio** quan es `null`; a sota, l'`status` cru del proveidor |
| Creat | `data ->> 'createdAt'`, com a data |
| Client | L'enllac, si algu l'ha fet |
| Llegit | `last_seen_at` de la passada |

Subjecta al filtre de recollidor com la resta de franges (decisio de la 7.3).

## El que segueix sense fer-se, i es diu

**Cap alerta salta encara quan un projecte es pausa.** Mateix motiu que Vercel: demana estendre el
`check` de `infra_alert_rules.kind` i es un increment a part.

**Migrar a OAuth2 no es fa ara.** Decisio 1 ho argumenta sencer: la Fase 7B es per correu, i
construir-la nomes per aquest connector seria el cost equivocat. Quan aquella plataforma existeixi,
Supabase hi migra sense refer el disseny de sota.
