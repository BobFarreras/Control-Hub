# Especificacio de registre de jornada

## Experiencia de consulta

- La pantalla personal separa quatre subseccions estables: **Resum**, **Calendari**,
  **Registre** i, nomes per a qui te `attendance:manage`, **Equip**. La navegacio viu a la
  sidebar compartida; no es duplica en tabs locals.
- **Resum** es la porta d'entrada operativa: estat i accio de fitxatge, total del dia i del mes,
  proxims dies del calendari laboral, sol·licituds personals i, si hi ha permis, incidencies i
  sol·licituds pendents de l'equip. No mostra celebracions ni notificacions inventades: cada
  bloc ha de tenir una font de dades real.
- **Calendari** mostra l'any natural complet de la persona, amb selector d'any a la URL,
  llegenda amb icona, text i color, i accions per sol·licitar vacances o registrar absencies.
  El calendari anual es una projeccio de les mateixes dades tenant-scoped; no crea un segon
  model de calendari.
- Els dies del calendari es poden seleccionar amb ratoli o teclat. El primer dia inicia la
  seleccio i el segon en tanca un rang inclusiu; una seleccio nova substitueix l'anterior. Les
  accions reben aquest rang com a valor inicial, pero el servidor torna a validar les dates.
- **Registre** conserva el detall mensual de dies, sessions i events, amb el mes seleccionat a
  la URL. **Equip** conserva el resum, conciliacio, sol·licituds i exportacio mensuals.
- El calendari rep sempre el rang mensual complet (`from` i `to`) com a contracte explicit. No
  dedueix el mes dels dies amb fitxatges: un mes sense cap moviment continua mostrant tots els
  dies i permet consultar o sol·licitar vacances i absencies.
- Les consultes de festius, vacances i absencies cobreixen tot el mes visible, inclosos els
  extrems que no tenen fitxatges. El comportament es identic els dotze mesos i en canvis d'any.
- Les taules de dies, moviments i equip reutilitzen la taula professional del producte, amb
  ordre recent-primer per defecte, ordenacio, filtres, paginacio i preferencies per usuari i
  tenant quan correspongui.

**Estat:** aprovada pel propietari el 2026-08-04. Fase 5C, despres de projectes i temps.
No s'activa en produccio sense confirmacio de la gestoria.

> **Aixo no es assessorament juridic.** El contingut legal d'aquesta seccio s'ha de confirmar
> amb la gestoria abans d'activar el modul en produccio, i molt especialment si esta en
> tramitacio alguna reforma del registre horari.

## Problema i usuaris

Moltes jurisdiccions obliguen a registrar la jornada. El modul implementa el **mecanisme**
(registre inalterable, correccions amb rastre, acces de la persona, exportacio i retencio
configurable); **quina llei l'obliga i durant quant de temps es conserva es configuracio de la
instal·lacio**, no una constant del producte. Vegeu l'agnosticisme a `PRODUCT_REQUIREMENTS.md`.

### Cas de la primera instal·lacio: Espanya

L'article 34.9 de l'Estatut dels Treballadors, introduit pel Reial decret llei 8/2019,
obliga a registrar diariament l'hora d'inici i de fi de la jornada de cada persona
treballadora. Els registres s'han de conservar **quatre anys** i han d'estar a disposicio de
la persona, dels seus representants i de la Inspeccio de Treball.

Aixo fixa els valors inicials d'aquesta instal·lacio. Una instal·lacio a un altre pais els
canviara sense tocar codi: el termini de retencio es un parametre, no un `4` escrit enlloc.

Tres punts que la gestoria ha de confirmar abans d'activar-ho:

1. **A qui aplica.** L'obligacio cobreix les persones per compte d'altri. Si els socis actuals
   no tenen relacio laboral, pot no aplicar-los avui; el dia que hi hagi una contractacio,
   aplica immediatament.
2. **Reforma en tramitacio.** Hi ha hagut iniciativa per exigir registre digital amb acces
   remot per part de la Inspeccio. Si prospera, canvia requisits tecnics d'aquest document.
3. **Conveni aplicable.** Pot afegir obligacions sobre pauses i hores extraordinaries que aqui
   no es cobreixen.

A banda de l'obligacio, el propietari vol un total d'hores mensual per persona.

- `Owner` i `Administrator`: consulten el registre de tothom i n'exporten per a la gestoria.
- Qualsevol membre: fitxa i consulta **sempre** el seu propi registre.

## Abast

- Fitxar entrada i sortida, amb pauses opcionals.
- Correccions amb rastre i motiu.
- Resum mensual per persona.
- Acces de cada persona al seu propi registre.
- Exportacio per a la gestoria i per a un requeriment d'inspeccio.
- Conciliacio contra les hores imputades a projectes i tickets.

## Fora d'abast

- **Biometria.** Empremta o reconeixement facial son dades de categoria especial i l'AEPD hi
  ha estat molt restrictiva. Una sessio autenticada i una marca de temps de servidor son
  suficients i molt menys problematiques.
- **Geolocalitzacio.** Mateixa rao: proporcionalitat. No es recull.
- **Nomina i calcul d'hores extraordinaries.** Depen del conveni i no es feina d'aquesta
  plataforma.
- **Planificacio de torns.**

## Funcionalitats afegides (Increment 10)

- **Calendari laboral:** festius del tenant, dies no laborables, vacances aprovades, absències i bloquejos personals.
- **Vista de calendari accessible:** mostra estat diari, hores registrades, absències i incidències de registre.
- **Canvi taula/calendari:** l'usuari pot alternar entre vista de taula i vista de calendari, conservant el mes seleccionat a la URL.
- **Navegació de mes amb fletxes accessibles:** sense textos "mes anterior/seguent", amb `aria-label` i tooltip.
- **Navegacio anual accessible:** selector d'any amb anterior, seguent i valor explicit a la
  URL; el canvi d'any no altera el registre ni depen que hi hagi fitxatges.

## Decisions

1. **El fitxatge i la imputacio d'hores son registres separats.** Un compleix la llei, l'altre
   calcula marge. Si les imputacions a projecte fossin el registre legal, corregir on van dues
   hores tocaria un document legal, i els totals no quadrarien mai perque no tot el temps
   treballat es imputable a un client: reunions internes, administracio, formacio, comercial.
   Quan dos totals no quadren, ningu se'n fia de cap dels dos.
2. **El registre es append-only.** Un fitxatge no s'edita. Una correccio es un registre nou
   que apunta a l'anterior, amb autor i motiu. Es aixo el que fa el registre defensable davant
   d'una inspeccio: si l'empresa pot reescriure'l en silenci, no prova res.
3. **La marca de temps la posa el servidor.** El rellotge del navegador no es font de veritat.
4. Tot es desa en UTC i es mostra en la zona horaria del tenant.
5. Un dia pot tenir diverses sessions. Una sessio que travessa mitjanit s'atribueix al dia en
   que va comencar.
6. **Cada persona pot llegir sempre el seu registre.** No es una funcionalitat opcional: no
   poder-hi accedir es, en si mateix, un incompliment.
7. Llegir el registre d'una altra persona queda auditat.
8. Els registres no es poden esborrar abans del **termini de retencio configurat**. Quatre
   anys es el valor de la primera instal·lacio, no el valor del producte.
9. El producte no assumeix cap jornada legal, cap limit d'hores ni cap regim de descansos: son
   coses que canvien per pais i per conveni. El modul registra i suma; no jutja.

### Decisions afegides el 7 d'agost de 2026

10. **Les pauses son opcionals per instal·lacio, i venen apagades.** L'article 34.9 obliga a
    registrar inici i fi de jornada; el que passa entremig depen del conveni, i moltes empreses
    fan torn seguit sense descomptar l'esmorzar ni el dinar. Amb les pauses apagades el boto
    nomes fa entrar i sortir, i la pausa que algu es deixa oberta no pot ni existir. Qui les
    necessiti les activa.

    Apagar-les **no altera el passat**: els events de pausa ja escrits continuen comptant igual,
    perque el registre es append-only i un canvi de configuracio no pot moure hores ja
    registrades. La configuracio decideix nomes que es pot escriure a partir d'ara.

11. **Cada persona corregeix el seu propi registre, amb motiu obligatori.** Substitueix
    l'assignacio anterior, que reservava tota correccio a `attendance:manage`.

    El cas que ho decideix es real i frequent: entrada a les 08:00, pausa a les 12:00 per anar
    al metge, torna a les 13:00 i no ho marca. A les 16:00 el registre diu quatre hores de
    pausa i quatre de feina, quan n'ha treballat set. Amb la regla anterior aquell dia queda
    malament fins que un administrador el mira, i es el registre de la persona -- el document
    que la llei li reconeix -- el que en surt perjudicat.

    La correccio no afluixa cap garantia: continua sent append-only, l'original es queda
    consultable, exigeix motiu, i queda auditada amb qui la va fer i quan. El que es defensa
    davant d'una inspeccio no es que ningu hagi corregit mai res, sino que tota correccio es
    visible i que **la versio anterior no ha desaparegut**. `attendance:manage` continua podent
    corregir el de tothom.

12. **Fitxar sortida estant en pausa es rebutja, i la pantalla pregunta en comptes de suposar.**
    Tancar la pausa implicitament a la sortida deixaria un registre amb una pausa que no acaba
    enlloc i un total que nomes s'explica llegint el codi. Davant d'una pausa oberta la pantalla
    demana **quan es va tornar** i escriu la correccio corresponent; el que no fa mai es desar
    en silenci un numero que ja sap que probablement es fals. El mateix criteri val per a una
    sessio que ningu ha tancat: surt com a oberta, mai com a zero.

### Decisions afegides l'agost de 2026 (Increment 10)

13. **Festius del tenant i dies no laborables son conceptes separats.** Els festius de suport
    (dies que l'oficina tanca) no son automaticament els de jornada. Cada tenant configura els
    seus festius i dies no laborables per als seus treballadors.

14. **Vacances, absències i bloquejos personals son registres separats.** Vacances i absències
    comparteixen el flux `pending`, `approved` i `rejected`; els bloquejos personals (hores no
    disponibles) continuen sent registres directes. Una absència no afecta el calendari fins que
    ha estat aprovada.

15. **La vista de calendari és accessible.** No es representa només per color: cada dia té text
    descriptiu del seu estat (laborable, festiu, vacances, absència, etc.).

16. **Navegació de mes amb fletxes accessibles.** Els textos "mes anterior/seguent" s'eliminen;
    les fletxes conserveixen `aria-label` i tooltip per accessibilitat.

17. **Aprovar i rebutjar es una operacio privilegiada i auditada.** Qualsevol membre pot
    sol·licitar vacances o absencies propies amb `attendance:record`. Nomes
    `attendance:vacations` pot resoldre-les. La resposta desa qui l'ha resolt i quan; rebutjar no
    elimina la sol·licitud.

## Fluxos

**Fitxar.** Un boto a l'aplicacio, amb sessio iniciada, escriu un event amb l'hora del
servidor. L'estat actual (dins, fora, en pausa) es dedueix de l'ultim event de la persona.

**Corregir.** S'escriu un event de correccio que apunta a l'original, amb el motiu. L'original
no desapareix; els totals passen a comptar el valor corregit i l'historial mostra les dues coses,
amb qui va fer la correccio i quan. Cadascu pot corregir el seu registre; `attendance:manage`
pot corregir el de qualsevol.

**Consultar el mes.** Cada persona veu els seus dies, el total i les correccions. Amb permis
de gestio, es veu el de tothom.

**Exportar.** Un interval de dates surt en format taula, amb persona, dia, entrades, sortides,
total i correccions, per lliurar a la gestoria o atendre un requeriment.

**Conciliar.** Un informe mensual compara hores registrades i hores imputades a projectes i
tickets. La diferencia es el temps no imputable, i veure'l es una de les coses mes utils que
pot donar aquest modul: es el cost real d'estructura.

## Criteris d'acceptacio

- Una persona pot consultar el seu registre sense cap permis addicional.
- Una persona no pot consultar el registre d'una altra.
- Cap event de fitxatge es pot modificar ni esborrar; una correccio en crea un de nou.
- Una correccio conserva l'original consultable i en registra autor i motiu.
- Una correccio sense motiu es rebutjada.
- Una persona pot corregir el seu registre i **no** el d'una altra sense `attendance:manage`.
- L'hora la fixa el servidor: enviar una hora des del client no la canvia. L'unica manera
  d'escriure una hora passada es una correccio, i llavors consta que ho es.
- Una sortida sense entrada previa es rebutjada.
- Una sortida estant en pausa es rebutjada; primer es tanca la pausa.
- Amb les pauses apagades, un event de pausa nou es rebutjat, pero els que ja hi ha continuen
  comptant igual als totals.
- Un fitxatge amb hora futura es rebutjat.
- Una sessio que comenca a les 23:00 i acaba a les 01:00 compta dues hores el dia d'inici.
- L'informe de conciliacio no confon hores registrades amb hores imputades.
- Llegir el registre d'una altra persona genera auditoria.
- Un tenant no veu registres d'un altre.
- **(Increment 10)** La vista de calendari mostra estat diari, hores registrades, absències i incidències.
- **(Increment 10)** No es representa només per color: cada dia té text descriptiu del seu estat.
- **(Increment 10)** El canvi taula/calendari conserva el mes seleccionat a la URL.
- **(Increment 10)** Les fletxes de navegació de mes tenen `aria-label` i tooltip.
- **(Increment 10)** Festius del tenant i dies no laborables es configuren per tenant.
- **(Increment 10)** Vacances, absències i bloquejos personals es modelen com a taules separades.
- Seleccionar un o dos dies al calendari preomple un rang inclusiu de sol·licitud i funciona amb
  teclat, focus visible i sense dependre del color.
- Una absencia nova queda `pending` i no pinta el dia com a absent fins que
  `attendance:vacations` l'aprova.
- Un membre sense `attendance:vacations` rep `403` si intenta aprovar o rebutjar una absencia.
- Resoldre vacances i absencies conserva la peticio, l'autor, el moment i una entrada d'auditoria.
- El Resum mostra nomes dades obtingudes dels contractes de jornada i diferencia l'absencia de
  dades d'un estat correcte.
- El Calendari mostra sempre els dotze mesos de l'any seleccionat, inclosos anys sense moviments.
- El calendari anual no comunica cap estat nomes amb color: cada categoria te icona, text i una
  descripcio accessible als dies afectats.
- L'any del Calendari i el mes del Registre i Equip formen part de la URL i es poden compartir.
- La sidebar mostra Resum, Calendari i Registre a qualsevol membre amb `attendance:record`, i
  Equip nomes amb `attendance:manage`.

## Permisos i tenancy

| Permis | Owner | Administrator | Technical |
|---|:---:|:---:|:---:|
| `attendance:record` | X | X | X |
| `attendance:manage` | X | X |  |
| `attendance:holidays` | X | X |  |
| `attendance:vacations` | X | X |  |

- `attendance:record` permet fitxar, llegir **el propi** registre i **corregir-lo**. Ni la
  lectura ni la correccio del propi registre depenen de cap permis addicional, a proposit: son
  el document que la llei reconeix a la persona, i fer-los dependre de la disponibilitat d'algu
  perjudica precisament qui la norma protegeix. Tota correccio exigeix motiu, conserva
  l'original i queda auditada.
- `attendance:manage` permet llegir el registre de tothom, corregir-lo i exportar-lo. Fins i
  tot amb aquest permis, corregir es append-only i auditat.
- `attendance:record` permet tambe llegir els festius i dies no laborables que afecten el propi
  calendari. `attendance:holidays` permet crear-los i eliminar-los per al tenant.
- `attendance:vacations` permet gestionar sol·licituds de vacances (aprovar/rebutjar).
- La conciliacio contra hores imputades exigeix a mes `financials:read`, perque revela cost.
- RLS i `force row level security`, com la resta.

## Model de dades i migracio

Un unic log d'events, i les sessions i els totals es deriven:

- `attendance_events`: `membership_id`, `kind` (`clock_in`, `clock_out`, `pause_start`,
  `pause_end`), `occurred_at`, `recorded_at`, `source` (`web`, `api`),
  `corrects_event_id` nullable, `reason` nullable.

Un log d'events es la forma natural d'un registre que no es pot modificar. Modelar-ho com una
fila per sessio amb `ended_at` obligaria a actualitzar files, que es exactament el que no ha
de poder passar.

### Taules addicionals (Increment 10)

- `attendance_holidays`: festius del tenant. `tenant_id`, `date`, `name`, `created_at`.
- `attendance_non_working_days`: dies no laborables (caps de setmana, etc.). `tenant_id`,
  `day_of_week` (0-6), `created_at`.
- `attendance_vacations`: vacances aprovades. `tenant_id`, `membership_id`, `start_date`,
  `end_date`, `status` (`pending`, `approved`, `rejected`), `approved_by` nullable,
  `approved_at` nullable, `notes` nullable, `created_at`.
- `attendance_absences`: absències (baixes mèdiques, permisos). `tenant_id`, `membership_id`,
  `start_date`, `end_date`, `type` (`sick_leave`, `personal_leave`, `other`), `status`
  (`pending`, `approved`, `rejected`), `approved_by` i `approved_at` nullables, `document_url`
  nullable, `notes` nullable, `created_by`, `created_at`.
- `attendance_blocks`: bloquejos personals (hores no disponibles). `tenant_id`, `membership_id`,
  `date`, `start_time`, `end_time`, `reason`, `created_at`.

Restriccions a la base de dades:

- Trigger append-only: cap `update` ni `delete` sobre `attendance_events`.
- `check (occurred_at <= recorded_at)`: no es pot fitxar en el futur.
- `corrects_event_id` amb clau forana composta amb `tenant_id`, i exigeix `reason`.
- Index per `(tenant_id, membership_id, occurred_at)` per als informes mensuals.
- El termini de retencio viu a `tenant_settings` i es documenta a `data-governance.md`;
  l'esborrat abans d'aquest termini queda bloquejat.
- **Si les pauses es registren** viu al mateix lloc, apagat per defecte. Es configuracio de
  l'installacio, no una columna del log: canviar-la no pot moure cap hora ja registrada.

## Calcul

```text
sessions        = parelles clock_in / clock_out per persona, en ordre d'occurred_at
worked_minutes  = suma de les sessions del dia, menys les pauses tancades
month_total     = suma dels dies del mes en la zona horaria del tenant
unbilled        = worked_minutes - minuts imputats a projectes i tickets del mateix periode
```

- Una sessio oberta no compta fins que es tanca; el resum la mostra com a oberta, no com a
  zero. Un zero i una sessio sense tancar no poden semblar el mateix.
- Els events corregits no entren als totals, pero segueixen sent consultables.
- `unbilled` pot ser negatiu si algu ha imputat mes hores de les que ha fitxat. Aixo no
  s'amaga: es precisament el senyal que un dels dos registres esta malament.

## API, events i idempotencia

```text
POST   /api/v1/attendance/events          (clock_in, clock_out, pause_start, pause_end)
GET    /api/v1/attendance/me
GET    /api/v1/attendance/summary
GET    /api/v1/attendance                 (attendance:manage)
POST   /api/v1/attendance/corrections     (el propi; el d'altri, attendance:manage)
GET    /api/v1/attendance/export          (attendance:manage)
GET    /api/v1/attendance/reconciliation  (attendance:manage + financials:read)
POST   /api/v1/attendance/holidays        (attendance:holidays)
GET    /api/v1/attendance/holidays        (attendance:record)
DELETE /api/v1/attendance/holidays/:id    (attendance:holidays)
POST   /api/v1/attendance/vacations       (attendance:record; own request)
GET    /api/v1/attendance/vacations       (attendance:record; own or attendance:vacations)
PUT    /api/v1/attendance/vacations       (attendance:vacations)
POST   /api/v1/attendance/absences        (attendance:record)
GET    /api/v1/attendance/absences        (attendance:record)
PUT    /api/v1/attendance/absences        (attendance:vacations)
POST   /api/v1/attendance/blocks          (attendance:record)
GET    /api/v1/attendance/blocks          (attendance:record)
DELETE /api/v1/attendance/blocks/:id      (attendance:record)
```

- El cos de `POST /events` no accepta hora: nomes el tipus. L'hora la posa el servidor.
- `POST /corrections` **si** accepta hora, perque una correccio serveix precisament per dir que
  una cosa va passar abans. Exigeix motiu, apunta a l'event que substitueix, i queda registrat
  que es va escriure mes tard: `occurred_at` es el que es declara i `recorded_at` el del
  servidor. Corregir el registre d'una altra persona demana `attendance:manage`.
- Fitxar es naturalment repetible per error de xarxa. Accepta `clientReference` opcional, unic
  per membership, perque un reintent no generi dues entrades.
- Els codis d'error segueixen `errors-and-api.md`.

## UX, i18n i accessibilitat

- Un boto gran i sense friccio a la capcalera, amb l'estat actual visible sempre. Si fitxar
  costa mes de dos segons, no es fara.
- L'estat no es comunica nomes amb color: text o icona, perque no depengui de distingir verd
  i vermell.
- El resum mensual es la pantalla que consultara la gestoria: ha de ser imprimible i
  exportable sense preparacio.
- Textos a `ca`, `es` i `en`. Hores amb el locale de l'usuari.

## Threat model

- **Falsificacio del registre.** Es l'amenaca principal i inclou l'empresa mateixa. Append-only
  amb hora de servidor i auditoria de correccions; una direccio no pot reescriure historial en
  silenci.
- **Privacitat.** Un registre de jornada revela patrons de presencia: es dada personal. Es
  recull el minim imprescindible, sense ubicacio ni biometria, i l'acces al registre d'altri
  queda auditat.
- **Conflicte entre supressio i retencio.** Davant d'una peticio d'esborrat, la retencio legal
  configurada preval durant el periode. Cal que consti a `data-governance.md` per poder
  respondre-hi amb fonament, i el termini ha de ser consultable per qui respon.
- **Elevacio per rol.** `attendance:manage` dona lectura del registre de tothom; per aixo
  `Technical` no el te tot i tenir permisos operatius amplis.

## Observabilitat i auditoria

- Auditoria: `attendance.recorded`, `attendance.corrected`, `attendance.exported`,
  `attendance.read_other`, `attendance.holiday_created`, `attendance.holiday_deleted`,
  `attendance.vacation_requested`, `attendance.vacation_approved`, `attendance.vacation_rejected`,
  `attendance.absence_created`, `attendance.block_created`, `attendance.block_deleted`.
- `attendance.read_other` es deliberat: consultar quan entra i surt una persona ha de deixar
  rastre encara que qui ho fa hi tingui dret.
- Metriques: hores registrades per setmana. Cap dada individual a les metriques.

## Pla de proves

- **Domini:** derivacio de sessions des dels events, dia que travessa mitjanit, pauses,
  correccio que substitueix el valor sense esborrar l'original, sessio oberta.
- **Integracio amb PostgreSQL:** trigger append-only; sortida sense entrada rebutjada; RLS;
  hora futura rebutjada.
- **Permisos:** un membre no pot llegir el registre d'un altre; `Technical` no pot exportar.
- **Conciliacio:** hores registrades i hores imputades no es barregen mai en un sol total.
- **(Increment 10) Festius i dies no laborables:** CRUD complet, validació de dates, tenant scope.
- **(Increment 10) Vacances:** fluxe de sol·licitud/aprovació, estats, permisos.
- **(Increment 10) Absències:** creació, validació de dates, adjunts.
- **(Increment 10) Bloquejos:** creació, validació d'hores, overlap.
- **(Increment 10) Vista de calendari:** representació correcta d'estats, accessibilitat.
- **(Increment 10) Navegació de mes:** fletxes accessibles, conservació de paràmetres.

## Rollout, feature flag i rollback

- Migracions additives. Cap relacio amb `time_entries`: son taules independents que nomes es
  troben a l'informe de conciliacio.
- Feature flag tipada `attendance`, amb propietari i data de retirada.
- **Abans d'activar-ho en produccio**, confirmar amb la gestoria que aplica i que la forma del
  registre es acceptable. Activar-ho no substitueix aquesta conversa.
- Rollback: desactivar la flag amaga el modul; els registres ja escrits es conserven, perque
  esborrar-los seria precisament el que la retencio prohibeix.
