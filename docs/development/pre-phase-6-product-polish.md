# Pla de millores abans de la Fase 6

**Estat:** increments 0-11 implementats i validats.
**Branca activa:** `develop` (increments integrats).

## Objectiu

Consolidar els moduls de CRM, cataleg, subscripcions, projectes, suport i jornada abans
d'obrir la Fase 6. El treball es divideix en increments petits i desplegables. Cada increment
actualitza especificacio, domini, persistencia, API, UI, i18n, proves i aquest estat quan
correspongui; no es fa una reescriptura transversal.

## Index d'implementacio

- [x] Increment 0 — Pla, decisions inicials i llenguatge de producte.
- [x] Increment 1 — Leads perduts recuperables i filtre de perduts.
- [x] Increment 2 — Exportacio Excel professional del CRM.
- [x] Increment 3 — Importacio guiada de leads.
- [x] Increment 4 — Fitxa de client com a vista 360.
- [x] Increment 5 — Simplificar el cataleg comercial.
- [x] Increment 6 — Serveis, subscripcions i compres dels clients.
- [x] Increment 7 — Subscripcions contractades per l'empresa.
- [x] Increment 8 — Defaults de dates a l'alta de projectes.
- [x] Increment 9 — Safata de suport explicable.
- [x] Increment 10 — Jornada amb calendari laboral.
- [x] Increment 11 — Toast global a baix a la dreta.

El check indica implementacio i validacio completades. Una decisio documentada sense codi no
marca l'increment com a fet.

## Ordre recomanat

### Increment 0 — decisions i llenguatge de producte

Abans de tocar codi:

1. Aprovar les decisions marcades com a porta en aquest document.
2. Actualitzar `crm.md`, `commerce.md`, `support.md`, `attendance.md` i
   `projects-and-time.md` amb els criteris acceptats.
3. Fixar vocabulari visible: **Cataleg**, **Productes**, **Variants o plans**, **Preus**,
   **Serveis de clients** i **Despeses recurrents de l'empresa**.
4. Fer wireframes de les pantalles amb dades reals del seed abans de modificar el model.

No hi ha migracions en aquest increment.

### Increment 1 — leads perduts recuperables (implementat)

Canvi funcional petit i independent:

- Afegir una accio **Reobrir lead** des de `lost` cap a un estat explicit.
- Registrar actor, data, estat anterior, estat nou i motiu obligatori a l'historial.
- Mantenir `won` terminal: recuperar un client convertit no es el mateix cas d'us.
- Fer visible el filtre `lost`; el backend ja accepta l'estat, pero cal validar el recorregut
  complet, conservar-lo a la URL i cobrir-lo amb E2E.
- Mostrar els perduts fora del pipeline actiu per defecte, amb una vista o filtre clar, sense
  falsejar les metriques comercials.

**Decisio CRM-1:** tornar a l'ultim estat actiu anterior; si no existeix, `new`. La decisio
queda fixada a `crm.md`.

Proves minimes: transicio valida, motiu obligatori, `won` rebutjat, auditoria, RLS, filtre
server-side i E2E de perdre/filtrar/reobrir.

### Increment 2 — exportacio Excel professional del CRM (implementat)

- Substituir el boto ambigu d'exportacio per una descarrega `.xlsx`, reutilitzant el patro de
  jornada: capcaleres localitzades, dates reals, autofilter, fila congelada, amplades llegibles
  i full de metadades.
- Exportar el conjunt filtrat complet, no nomes la pagina visible.
- Separar fulls `Leads` i `Clients`, o oferir una seleccio previa si el volum ho requereix.
- Incloure data d'exportacio, tenant, filtres aplicats i zona horaria; no incloure camps interns.
- Protegir contra formula injection i auditar `crm.exported` sense registrar dades personals.
- Exigir el permis d'exportacio i la reautenticacio que marca l'arquitectura de seguretat.

Proves minimes: workbook llegible, filtres respectats, tres locales, formula injection,
permis insuficient, tenant scope i volum maxim especificat.

### Increment 3 — importacio guiada de leads (implementat)

Progres intern:

- [x] Plantilla Excel versionada amb instruccions, valors restringits i exemple no importable.
- [x] Lectura CSV/XLSX i mapatge de columnes.
- [x] Previsualitzacio completa sense escriptura i errors accionables per fila.
- [x] Confirmacio idempotent i resum descarregable.

Flux recomanat en cinc passos:

1. **Descarregar plantilla versionada** `.xlsx` i `.csv`, amb exemples, camps obligatoris,
   formats i valors permesos.
2. **Pujar fitxer** amb limits de mida, files i tipus; el fitxer es tracta com a entrada no
   fiable i no s'executa cap formula.
3. **Mapar columnes**: suggerir coincidencies, permetre corregir-les i ignorar columnes
   desconegudes. La BD no es mostra mai com a contracte d'importacio.
4. **Previsualitzar i validar** totes les files sense escriure: valides, avisos de possible
   duplicat i errors accionables amb numero de fila.
5. **Confirmar** un lot idempotent. Cada fila valida es atomica; el resum final es pot
   descarregar i el lot queda auditat.

La plantilla porta `template_version`; els adaptadors mantenen compatibilitat amb versions
publicades. L'import no crea clients, productes ni responsables desconeguts per intuicio.

**Porta de decisio CRM-2:** els duplicats forts. Recomanacio: ometre'ls i mostrar-los per
revisio; no sobreescriure dades existents durant una importacio de leads.

Proves minimes: CSV i XLSX, delimitadors i BOM, emails/telèfons, duplicats, reintent del lot,
fitxer malformat, limits, formula injection, RLS i E2E del flux complet.

### Increment 4 — fitxa de client com a vista 360 del CRM

Progres intern:

- [x] Resum operatiu amb dades CRM existents, contacte principal, propera tasca i activitat.
- [x] Dades empresarials visibles, formulari de contacte complet i estats buits accionables.
- [x] Conversio amb contacte principal i recuperacio idempotent des del lead original.
- [x] Edicio inline auditada, amb desament explicit i control de concurrencia.
- [x] Relacions no financeres amb serveis, projectes i suport, agregades sense N+1.
- [x] Interessos comercials de producte i oportunitats amb pipeline complet, selector accessible i
  probabilitat guiada en passos de 10% amb barra semantica.
- [x] Ampliacio opcional de dades fiscals, idioma, zona horaria i adreces.

Primer s'omple la fitxa actual amb dades i relacions existents; despres s'amplia el model.

- Capcalera: nom comercial/legal, estat, identificacio fiscal, idioma, zona horaria,
  responsable, origen, canals i adreces.
- Resum: contacte principal, propera tasca, ultima activitat, projectes actius, tickets oberts,
  serveis actius, renovacio propera i valor recurrent per moneda.
- Pestanyes: **Resum**, **Contactes**, **Activitat**, **Tasques**, **Interessos**, **Serveis i
  compres**, **Projectes**, **Suport** i **Documents** quan pressupostos/factures existeixin.
- Els productes interessats son oportunitats comercials, no subscripcions. Cal una relacio
  `customer_product_interests` amb etapa, probabilitat opcional, import estimat per moneda,
  proper pas, responsable i historial.
- Els productes contractats surten de serveis/compres de client; projectes i tickets es
  consulten als seus moduls, sense duplicar-los al CRM.
- Afegir estats buits amb accio directa perquè una fitxa nova no sembli trencada.

**Porta de decisio CRM-3:** dades fiscals i adreces requerides. Recomanacio: modelar
organitzacio, contactes i adreces separadament; fer-les opcionals fins que pressupostos i
facturacio defineixin els obligatoris legals.

Proves minimes: agregacio sense N+1, permisos financers (les quantitats no arriben al browser
si no pertoquen), tenant scope, estats buits i E2E de la vista 360.

### Increment 5 — simplificar el cataleg comercial

Progres intern:

- [x] Portada centrada en productes, amb resum de plans/ofertes i una unica accio principal.
- [x] Versions, plans i publicacio de preus contextualitzats dins de cada producte.
- [x] Alta guiada atomica de producte, primera versio, pla i preu publicat.
- [x] Modalitats comercials al nivell del pla, amb compatibilitat de periodicitat protegida al domini i a PostgreSQL.
- [x] Fitxa dedicada de producte amb jerarquia tenant-scoped de versions, plans i preus publicats.

Model mental visible:

```text
Producte (Agent WhatsApp, Pagina web, Software a mida...)
  -> Versio (canvis funcionals publicables)
      -> Pla o variant (Basic, Pro, projecte unic, manteniment...)
          -> Preu publicat (snapshot immutable per moneda i periodicitat)
```

- La pantalla principal mostra targetes o taula de **productes**, amb tipus, estat, oferta
  resumida, nombre de plans i accions principals.
- L'alta guiada crea producte i primera oferta en un sol assistent. `Afegir versio`, `Afegir
  pla` i `Publicar preu` passen a la fitxa del producte, amb ajuda contextual; no competeixen
  tots com a accions principals.
- Un producte pot ser recurrent, manteniment, compra unica o servei/projecte. La periodicitat
  pertany a l'oferta/preu, no al nom del producte.
- Un projecte comercialitzat pot convertir-se en producte sense vincular el registre historic
  del projecte al cataleg. El producte es la plantilla/oferta; cada venda crea un servei o
  compra de client i, si cal execucio, un projecte.
- Gestio per `products:manage` (Owner i Administrator avui), mai per noms de persona. La lectura
  necessaria per pressupostar es un permis separat si s'incorporen rols comercials.

**Porta de decisio COM-1:** conservar `versions`. Recomanacio: conservar-les al domini per
traçabilitat, pero ocultar-les del flux habitual fins que es publiqui una nova versio real.

### Increment 6 — serveis, subscripcions i compres dels clients

Progres intern:

- [x] Model unificat aprovat: `customer_services` com a contracte pare i recurrencia opcional.
- [x] Estats, invariants, permisos i pla de migracio gradual documentats a `commerce.md`.
- [x] Migracio additiva, backfill idempotent i adaptador de persistencia.
- [x] API i casos d'us de serveis de clients.
- [x] Taula professional, filtres, alta guiada i integracio amb la fitxa 360.
- [x] Accions de cicle de vida amb historial append-only i cancel·lacio motivada.
- [x] Filtres integrats a la taula i alertes segons la finestra de renovacio de cada contracte.
- [x] Exportacio Excel professional amb filtres, auditoria i permisos financers.
- [x] Proves d'integracio, permisos financers i E2E.

Canviar el nom visible de “Subscripcions de clients” a **Serveis de clients**. La taula ha de
representar el que cada client te contractat, no nomes recurrencia:

- client i producte/oferta;
- modalitat: subscripcio, manteniment, compra unica o servei per projecte;
- estat; data de contractacio; inici; propera renovacio o fi;
- preu net, impostos, total, moneda i periodicitat;
- responsable, renovacio automatica, dies d'avis i enllac a client/projecte;
- data de cancel·lacio o baixa quan existeixi.

Filtres: client, producte, modalitat, estat, renovacio propera, responsable i moneda. Vistes
rapides: actius, vencen aviat, sense data de renovacio i cancel·lats.

**Decisio COM-2 aprovada:** `customer_services` es el contracte comercial pare i te una
recurrencia opcional; una compra unica no fingeix ser una subscripcio cancel·lada. L'especificacio
i el pla de migracio son a `commerce.md`.

No s'implementen pressupostos ni factures dins aquest increment: es preparen identificadors i
linies de contracte perquè el modul financer futur els pugui referenciar.

### Increment 7 — subscripcions contractades per l'empresa

Progres intern:

- [x] Revisio del model actual i decisio COM-3 aprovada.
- [x] Camps, invariants, permisos i pla de migracio additiva documentats.
- [x] Migracio, backfill idempotent i persistencia.
- [x] API i casos d'us.
- [x] Taula generalitzada, filtres, edicio i cicle de vida.
  - [x] Taula generalitzada, filtres integrats, alta completa i cicle de vida.
  - [x] Edicio segura amb control de concurrencia i event `updated`.
- [x] Alertes, exportacio i proves E2E.

Canviar el nom visible a **Eines i despeses recurrents** per evitar confondre-les amb clients.
Taula recomanada:

- proveidor i servei/pla;
- categoria, estat i responsable intern;
- usuari del compte (normalment correu corporatiu, classificat com a dada sensible);
- URL oficial validada (`https`, allowlist o confirmacio de host) amb acces rapid;
- import, moneda, periodicitat, proper cobrament/renovacio i dies d'avis;
- metode de pagament com a etiqueta no secreta (`Visa empresa ···· 1234`), mai credencials;
- centre de cost, notes i enllac al gestor de secrets, no el secret mateix;
- cancel·lacio requerida abans de, renovacio automatica i propietari de la baixa.

Vistes: renovacions properes, sense responsable, cost mensual equivalent per moneda i eines
duplicades. Qualsevol URL configurable segueix la proteccio SSRF/open redirect del repositori.

### Increment 8 — defaults coherents als formularis (projectes implementat)

- Crear una utilitat unica de **data civil del tenant**; no derivar el dia amb UTC al navegador.
- En nou projecte: inici = avui a la zona del tenant; entrega = avui + 30 dies naturals.
- Recalcular entrega nomes mentre l'usuari no l'hagi editat. Si canvia l'inici abans d'editar
  l'entrega, mantenir el desfasament de 30 dies.
- Aplicar el mateix patro als formularis nous que tinguin una semantica equivalent, no a totes
  les dates indiscriminadament.

**Porta de decisio PRJ-1:** 30 dies naturals o laborables. Recomanacio inicial: naturals,
perquè “30 dies” no depengui del calendari de suport; si el negoci promet dies laborables cal
un calendari de projecte propi.

Proves: canvi de mes/any, DST, zones extremes, edicio manual i E2E de l'alta.

Implementat el 8 d'agost de 2026 per a l'alta de projectes: inici segons el dia civil del
navegador i entrega 30 dies naturals despres. L'entrega segueix els canvis de l'inici fins que
l'usuari l'edita. Queda pendent exposar la zona horaria del tenant al web; fins llavors el valor
inicial usa la zona del dispositiu, sense convertir la data civil per UTC.

### Increment 9 — safata de suport explicable

Millora immediata de la taula:

- data de creacio;
- objectiu aplicat (primera resposta o resolucio);
- temps consumit, temps restant i data/hora limit estimada;
- estat de mesura: a temps, proper, incomplert, pausat o sense configuracio;
- prioritat, client, responsable i ultima actualitzacio.

El text "incomplert" ha d'obrir un detall que expliqui l'objectiu copiat al ticket, calendari,
pauses i instant d'incompliment. No s'ha de recalcular contra una politica nova.

Canals d'entrada, per fases:

1. **Ara:** alta interna manual per vosaltres dos; ja existeix i es el fallback operatiu.
2. **Canal entrant per correu:** webhook/API d'un proveidor o connector, verificacio de
   signatura, deduplicacio per `externalReference`, mapatge segur del remitent al client,
   cua, quarantena per missatges ambigus i adjunts escanejats. No fer parsing IMAP dins el core.
3. **Portal de client:** formulari autenticat amb entitlements; el client nomes veu els seus
   tickets i mai notes internes. Pot viure als panells dels productes consumint l'API de
   Control Hub, sense duplicar la base de tickets.

**Porta de decisio SUP-1:** primer canal extern. Recomanacio: portal/API autenticada abans del
correu automatic, perquè identifica tenant i client de manera fiable. El correu es mes flexible
pero necessita quarantena i mes operacio. Aquesta decisio amplia l'abast de fases aprovades i
no s'implementa sense actualitzar el roadmap.

Implementat el 10 d'agost de 2026:

- Domini: tipus `InboxSlaStatus` (5 estats), `InboxSlaDetail`, `InboxSlaInfo`, funcions
  `deriveInboxSlaStatus`, `estimateDeadline` i `inboxSlaInfo`.
- Persistencia: `updatedAt` al SELECT de listTickets.
- Servei: `TicketListRow` i `InboxTicket` amb `updatedAt` i `inboxSla`. `TicketDetail` amb
  `inboxSla`. `listInbox` calcula l'estat per cada ticket en una sola passada.
- UI: columnes noves (creat, objectiu, estat SLA, ultima actualitzacio), badge clickable amb
  5 estats visuals i dialeg de detall amb objectiu, consumit, restant, data limit i pauses.
- i18n: nous textos en ca, es i en per als 5 estats, columnes i dialeg.
- Proves: 7 noves al domini (deriveInboxSlaStatus, estimateDeadline, inboxSlaInfo).

### Increment 10 — jornada amb calendari laboral (implementat)

- Treure els textos "mes anterior/seguent" i conservar fletxes amb `aria-label` i tooltip.
- Afegir vista mensual accessible: estat diari, hores registrades, absencia i incidencies de
  registre. No representar nomes per color.
- Separar conceptes: festius del tenant, dies no laborables del calendari, vacances aprovades,
  absencies i bloquejos personals. Els festius de suport no son automaticament els de jornada.
- Permetre canvi taula/calendari i conservar mes seleccionat a la URL.

**Porta de decisio ATT-1:** abast de vacances. Recomanacio: primer calendari de lectura amb
festius i dies no laborables; sol·licitud/aprovacio de vacances en un increment propi, perquè
afegeix saldos, politiques, aprovacions i dades laborals sensibles.

Implementat el 9 d'agost de 2026:

- Migracions additives: `0025_attendance_calendar.sql` (taules de festius, vacances, absencies i
  bloquejos) i `0026_attendance_permissions_calendar.sql` (permisos nous + backfill).
- Domini a `packages/domain/src/attendance.ts`: tipus nous (`AttendanceHoliday`,
  `AttendanceNonWorkingDay`, `AttendanceVacation`, `AttendanceAbsence`, `AttendanceBlock`,
  `AttendanceDayStatus`) i funcions pures (`isHoliday`, `isNonWorkingDay`, `isVacationDay`,
  `isAbsenceDay`, `hasBlockOverlap`, `deriveDayStatus`).
- Aplicacio i repositori: CRUD complet per a totes les entitats amb permisos i auditoria.
- API: rutes per a festius, dies no laborables, vacances, absencies i bloquejos.
- UI: navegacio de mes amb fletxes accessibles, canvi taula/calendari amb conservacio del mes a
  la URL, vista de calendari amb estat diari i text descriptiu.
- Proves: 6 proves noves al domini (festius, dies no laborables, vacances, absencies, bloquejos,
  derivacio d'estat diari).

### Increment 11 — toast global a baix a la dreta (implementat)

- Moure el contenidor a baix a la dreta amb tokens semantics i safe-area.
- En mobil, ocupar amplada disponible sense tapar navegacio ni controls fixos.
- Mantenir `aria-live`; els errors persistents o que requereixen decisio no desapareixen als
  cinc segons i continuen visibles al formulari corresponent.
- Localitzar l'etiqueta de tancar i verificar pila, focus, reduced motion i contrast.

Aquest increment es purament UI i es pot entregar aviat, pero no s'ha de barrejar amb el canvi
de model de CRM o commerce.

Implementat el 8 d'agost de 2026: posicio inferior dreta, safe-area, amplada responsive,
focus visible del boto de tancament i animacio desactivada amb `prefers-reduced-motion`.

## Com s'executa cada increment

1. Confirmar la porta de decisio afectada i actualitzar l'especificacio.
2. Escriure criteris d'acceptacio i casos negatius.
3. Fer migracio additiva si cal; mai editar-ne una de publicada.
4. Implementar domini i casos d'us abans dels adaptadors.
5. Afegir API versionada, permisos, tenant scope, auditoria i OpenAPI.
6. Implementar UI amb `SmartDataTable`, tokens semantics, `ca`/`es`/`en`, teclat, light/dark i
   reduced motion.
7. Executar proves unitàries, integracio, API i E2E de l'increment.
8. Executar format, lint, typecheck i build afectats; revisar el diff i secrets.
9. Actualitzar `current-state.md` i `troubleshooting.md` si la diagnosi ha costat mes de mitja hora.
10. Revisar funcionalment abans de començar l'increment seguent.

## Sequencia de lliuraments proposada

1. Toast i defaults de projecte (baix risc, feedback immediat).
2. Leads perduts.
3. Exportacio CRM.
4. Importacio guiada.
5. Fitxa 360 de client amb dades existents.
6. Simplificacio de la UI del cataleg.
7. Nou contracte de serveis/compres de clients.
8. Eines i despeses recurrents de l'empresa.
9. Safata SLA explicable.
10. Calendari de jornada.
11. Canal extern de suport, nomes quan SUP-1 i el roadmap estiguin aprovats.

La fitxa 360 es divideix expressament: primer agrega dades existents; els interessos comercials
i el nou contracte de serveis entren quan els seus models hagin estat aprovats. Aixo evita que
una pantalla obligui a improvisar el domini.
