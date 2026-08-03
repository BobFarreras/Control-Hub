# Especificacio de registre de jornada

**Estat:** proposta. Fase 5C, despres de projectes i temps.

> **Aixo no es assessorament juridic.** El contingut legal d'aquesta seccio s'ha de confirmar
> amb la gestoria abans d'activar el modul en produccio, i molt especialment si esta en
> tramitacio alguna reforma del registre horari.

## Problema i usuaris

L'article 34.9 de l'Estatut dels Treballadors, introduit pel Reial decret llei 8/2019,
obliga a registrar diariament l'hora d'inici i de fi de la jornada de cada persona
treballadora. Els registres s'han de conservar **quatre anys** i han d'estar a disposicio de
la persona, dels seus representants i de la Inspeccio de Treball.

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
- **Vacances, permisos i baixes.** Modul adjacent i habitual, pero diferent; barrejar-lo
  converteix un registre legal en una eina de planificacio.
- **Nomina i calcul d'hores extraordinaries.** Depen del conveni i no es feina d'aquesta
  plataforma.
- **Planificacio de torns.**

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
8. Els registres no es poden esborrar abans dels quatre anys.

## Fluxos

**Fitxar.** Un boto a l'aplicacio, amb sessio iniciada, escriu un event amb l'hora del
servidor. L'estat actual (dins, fora, en pausa) es dedueix de l'ultim event de la persona.

**Corregir.** Qui te el permis escriu un event de correccio que apunta a l'original, amb el
motiu. L'original no desapareix; els totals passen a comptar el valor corregit i l'historial
mostra les dues coses.

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
- L'hora la fixa el servidor: enviar una hora des del client no la canvia.
- Una sortida sense entrada previa es rebutjada.
- Un fitxatge amb hora futura es rebutjat.
- Una sessio que comenca a les 23:00 i acaba a les 01:00 compta dues hores el dia d'inici.
- L'informe de conciliacio no confon hores registrades amb hores imputades.
- Llegir el registre d'una altra persona genera auditoria.
- Un tenant no veu registres d'un altre.

## Permisos i tenancy

| Permis | Owner | Administrator | Technical |
|---|:---:|:---:|:---:|
| `attendance:record` | X | X | X |
| `attendance:manage` | X | X |  |

- `attendance:record` permet fitxar i llegir **el propi** registre. La lectura propia no depen
  de cap permis addicional a proposit.
- `attendance:manage` permet llegir el registre de tothom, corregir-lo i exportar-lo. Fins i
  tot amb aquest permis, corregir es append-only i auditat.
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

Restriccions a la base de dades:

- Trigger append-only: cap `update` ni `delete` sobre `attendance_events`.
- `check (occurred_at <= recorded_at)`: no es pot fitxar en el futur.
- `corrects_event_id` amb clau forana composta amb `tenant_id`, i exigeix `reason`.
- Index per `(tenant_id, membership_id, occurred_at)` per als informes mensuals.
- La retencio de quatre anys es documenta a `data-governance.md`; l'esborrat abans d'aquest
  termini queda bloquejat.

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
POST   /api/v1/attendance/corrections     (attendance:manage)
GET    /api/v1/attendance/export          (attendance:manage)
GET    /api/v1/attendance/reconciliation  (attendance:manage + financials:read)
```

- El cos de `POST /events` no accepta hora: nomes el tipus. L'hora la posa el servidor.
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
  de quatre anys preval durant el periode. Cal que consti a `data-governance.md` per poder
  respondre-hi amb fonament.
- **Elevacio per rol.** `attendance:manage` dona lectura del registre de tothom; per aixo
  `Technical` no el te tot i tenir permisos operatius amplis.

## Observabilitat i auditoria

- Auditoria: `attendance.recorded`, `attendance.corrected`, `attendance.exported`,
  `attendance.read_other`.
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

## Rollout, feature flag i rollback

- Migracions additives. Cap relacio amb `time_entries`: son taules independents que nomes es
  troben a l'informe de conciliacio.
- Feature flag tipada `attendance`, amb propietari i data de retirada.
- **Abans d'activar-ho en produccio**, confirmar amb la gestoria que aplica i que la forma del
  registre es acceptable. Activar-ho no substitueix aquesta conversa.
- Rollback: desactivar la flag amaga el modul; els registres ja escrits es conserven, perque
  esborrar-los seria precisament el que la retencio prohibeix.
