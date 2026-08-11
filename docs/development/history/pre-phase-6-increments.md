# Historic — increments de consolidacio previs a la Fase 6

> Text mogut tal qual des de `docs/development/current-state.md` (linies 3-121, 591-674 i
> 677-685 de la versio anterior a la particio). No s'ha resumit ni reescrit res.
>
> Les linies 3-121 eren la nota de capcalera del fitxer i per aixo conserven el prefix `>` de
> blockquote: es text mogut sense tocar.

> Els increments 0-11 de consolidacio previs a la Fase 6 estan implementats i validats. La
> implementacio queda integrada a `develop`; el punt de continuacio es la revisio funcional
> final i l'obertura de la Fase 6.
> El detall i els checks de cada increment son a
> `docs/development/pre-phase-6-product-polish.md`.
>
> Primer increment implementat en aquesta branca: el toast global ara apareix a baix a la
> dreta, respecta la safe-area, s'adapta a mobil i desactiva l'animacio amb reduced motion.
> L'alta de projecte tambe proposa inici avui i entrega 30 dies naturals despres; si es canvia
> l'inici, l'entrega es recalcula fins que l'usuari l'edita manualment.
> Els leads perduts es poden recuperar amb motiu obligatori. Tornen a l'ultim estat actiu
> registrat, o a `new` quan no n'hi ha cap, i la reobertura queda a l'historial i l'auditoria.
> L'exportacio de leads genera un Excel professional al backend, respecta cerca i filtres,
> neutralitza formules, incorpora metadades i queda auditada.
> La importacio guiada ha començat amb una plantilla Excel `crm-leads-v1`, descarregable des
> del dialeg, amb full d'instruccions, columnes estables i prioritats restringides. La UI llegeix
> CSV i XLSX, rebutja formules, suggereix i permet corregir el mapatge, i previsualitza sense
> escriure. La confirmacio usa una referencia unica per tenant, lot i fila: un reintent no
> duplica leads, ni tan sols quan no tenen correu o telefon. Les files valides s'importen de
> forma atomica, els errors no bloquegen la resta, el resultat queda auditat sense PII i es pot
> descarregar com a CSV. El punt de continuacio es l'increment 4, la fitxa 360 del client.
> La plantilla inclou una pestanya d'exemple separada que no s'importa. La previsualitzacio
> identifica per fila el camp incorrecte i explica per que la confirmacio encara no es pot fer.
> L'increment 4 ha començat per la fitxa de client: mostra les dades empresarials que ja
> existeixen, contacte principal, tasques obertes, propera tasca i ultima activitat. Contactes,
> notes, tasques i timeline tenen estats buits accionables; encara falten les relacions amb
> interessos, serveis, projectes i suport abans de marcar la vista 360 com a completa.
> Les conversions noves amb empresa i persona diferenciades creen el contacte principal dins
> la mateixa transaccio. Un client antic sense contactes pot recuperar-lo explicitament del
> lead original; `source_lead_id` evita duplicats en reintents i conserva la traçabilitat.
> La fitxa agrega serveis contractats, projectes i tickets amb consultes acotades al tenant i
> enllaços directes. No envia imports ni costos: la capa financera continua separada per
> permisos. Encara falten els interessos comercials i les dades ampliades del client.
> Les dades existents del client es poden editar amb validacio backend, auditoria dels camps
> afectats i control optimista per `updatedAt`; una sessio antiga no sobreescriu canvis nous.
> L'edicio queda integrada camp a camp a la targeta empresarial, amb desament o cancel·lacio
> explicits, sense un formulari separat que trenqui la composicio de la fitxa. La capçalera
> separa les dades mestres de quatre metriques compactes i els panells buits ja no imposen
> alçades artificials.
> Els opcionals buits no es trameten com emails o URLs invalides, els errors d'esquema retornen
> `INVALID_INPUT`, i la concurrencia compara `updated_at` a la precisio de mil·lisegons que
> conserva el navegador.
> El lloc web accepta `domini.tld` i `www.domini.tld` sense protocol i els desa normalitzats
> amb `https://`; els protocols diferents d'HTTP(S) continuen rebutjats.
> La fitxa incorpora oportunitats vinculades al cataleg amb pipeline complet, historial
> append-only, unicitat mentre son obertes i imports estimats protegits per `financials:read`.
> L'increment 4 queda tancat: identificacio fiscal, idioma i zona horaria son editables inline,
> i les adreces d'oficina, facturacio, enviament o altres es gestionen separadament amb una
> principal per tipus, RLS i auditoria sense PII. El punt de continuacio es l'increment 5,
> simplificar el cataleg comercial.
> L'increment 5 ha començat per la jerarquia de la portada: ara resumeix productes, plans i
> ofertes publicades, deixa una sola alta principal i mou versions, plans i preus al producte
> corresponent. L'assistent crea producte, versio activa, pla i preu en una unica transaccio tenant-scoped;
> valida tots els camps abans d'escriure, genera codis editables des del nom i audita una sola
> operacio. Un conflicte tardà desfà les quatre files. Les modalitats comercials viuen al pla:
> subscripcio, manteniment, compra unica o servei per projecte, amb periodicitats incompatibles
> rebutjades tant al domini com a PostgreSQL. La fitxa dedicada del producte mostra la seva
> jerarquia completa amb una lectura tenant-scoped. L'increment 5 queda tancat i el punt de
> continuacio es l'increment 6, serveis, subscripcions i compres dels clients.
> L'increment 6 ha començat amb la decisio COM-2 aprovada: `customer_services` sera el contracte
> comercial unificat i la recurrencia una extensio opcional nomes per subscripcions i manteniments.
> `commerce.md` fixa estats, invariants, permisos i un backfill idempotent des de `subscriptions`.
> `0028_customer_services.sql` crea el contracte pare, la recurrencia opcional i l'historial
> append-only amb RLS, claus tenant-scoped i indexos operatius. El backfill conserva els UUID de
> les subscripcions i els seus events i es idempotent. L'adaptador nou llegeix producte, pla, preu,
> responsable, projecte i recurrencia sense N+1, i crea servei, recurrencia i event en una sola
> transaccio. La migracio local deixa zero subscripcions sense backfill i zero recurrències en
> compres uniques o serveis per projecte. Els casos d'us validen dates, quantitat, oferta i
> coherencia de recurrencia abans de la transaccio. `GET` i `POST /api/v1/commerce/customer-services`
> ofereixen filtres tenant-scoped, MFA i auditoria; els imports nomes formen part de la resposta
> amb `financials:read`. Les rutes antigues de subscripcions continuen disponibles durant el
> desplegament gradual. La pantalla de Serveis de clients ja ofereix una taula responsive amb
> filtres instantanis integrats a la taula generalitzada, imports protegits per permisos, alta
> guiada i enllaços directes a client, producte i
> projecte; la fitxa 360 consumeix el nou model unificat. Les accions de cicle de vida permeten
> pausar i reprendre serveis recurrents, completar compres i serveis de projecte, i cancel·lar
> contractes actius o pausats amb motiu obligatori. Cada transicio es atomica, tenant-scoped,
> controlada contra concurrencia i registrada a l'historial append-only i a l'auditoria. La
> taula integra a les capçaleres els filtres d'estat, renovacions properes i recurrents sense
> renovacio, sense una barra paral·lela. Els avisos no usen una finestra global: comparen cada renovacio amb els seus
> `renewal_alert_days` i la destaquen visualment. L'exportacio Excel respecta els filtres
> actius, neutralitza formules, inclou metadades i omet totes les columnes monetaries sense
> `financials:read`. L'E2E autenticat crea un servei propi, el pausa, el repren, el cancel·la
> amb motiu, el filtra des de la capçalera i descarrega l'Excel real; pot repetir-se sense
> dependre de l'estat del seed. L'increment 6 queda tancat.
> L'increment 7 ha començat amb la decisio COM-3 aprovada: `company_subscriptions` evoluciona
> de manera additiva i conserva IDs i dades existents. El model ampliat separa inventari
> operatiu i imports financers, incorpora compte, responsable, llicencies, centre de cost,
> etiqueta de pagament, dates contractuals i enllaç al gestor de secrets sense desar secrets.
> La migracio additiva `0029_company_subscriptions_polish.sql` ja esta aplicada localment: amplia
> el registre sense perdre IDs, completa `canceled_at` a les files antigues, crea l'event inicial
> idempotent i incorpora RLS, claus tenant-scoped, indexos i triggers de transicio i historial
> append-only. L'adaptador persisteix els camps operatius i l'event `created` en una sola
> transaccio, resol el responsable sense N+1 i admet filtres parametritzats. La prova d'integracio
> real confirma persistencia, historial i aillament entre tenants. Els casos d'us i l'API
> versionada ja cobreixen filtres, alta amb tots els camps operatius i les accions explicites
> `activate`, `pause`, `resume` i `cancel`; la cancel·lacio exigeix motiu, les escriptures comparen
> l'estat esperat i totes les mutacions queden auditades sense copiar dades sensibles. La lectura
> requereix `subscriptions:manage` i nomes exposa import, moneda i periodicitat sota `financials`
> quan també hi ha `financials:read`. La pantalla ja es diu **Eines i despeses recurrents** i
> reutilitza `SmartDataTable`: filtres d'estat, categoria i renovacio dins les capçaleres,
> ordenacio, paginacio i preferencies de columnes. Mostra compte, responsable, llicencies,
> renovacio, cost condicionat al permis i accessos directes a la plataforma i al gestor de
> secrets. L'alta recull el contracte operatiu complet i la taula permet activar, pausar,
> reprendre i cancel·lar amb motiu. L'edicio envia nomes els camps modificables amb
> `expectedUpdatedAt`; el cas d'us recompon i revalida el contracte complet, la persistencia
> rebutja versions obsoletes i registra l'event append-only `updated`. Les renovacions dins la
> finestra propia de cada contracte es destaquen i es poden filtrar, igual que els registres
> actius sense data de renovacio. L'exportacio Excel conserva aquests filtres, neutralitza
> formules, inclou metadades i omet imports, moneda i periodicitat sense `financials:read`; tampoc
> exporta notes ni l'enllaç al gestor de secrets. L'E2E autenticat cobreix alta, edicio, pausa,
> represa, cancel·lacio motivada, filtre i descarrega. L'adaptador converteix explicitament
> `amount_minor` (PostgreSQL `bigint`) a un nombre segur abans d'entrar al cas d'us, de manera que
> l'edicio revalida el mateix contracte numeric que l'alta. El camp de compte accepta tant correu
> com usuari de plataforma, tal com fixa COM-3, i les altes, edicions i transicions informen amb
> el sistema global de toasts en lloc de banners locals. L'increment 7 queda tancat i el punt de
> continuacio es l'increment 9, la safata de suport explicable, ja que l'increment 8 consta com
> implementat.


### Increment 9 — Safata de suport explicable (implementat, 10 d'agost de 2026)

L'increment 9 millora la safata de tickets amb informacio SLA explicable i columnes noves.

**Canvis al domini (`packages/domain/src/support.ts`):**
- Nous tipus: `InboxSlaStatus` (5 estats: `on_time`, `near`, `breached`, `paused`,
  `not_configured`), `InboxSlaDetail`, `InboxSlaInfo`, `InboxActiveTarget`.
- Funcions: `deriveInboxSlaStatus` (deriva l'estat visual), `estimateDeadline` (estima la data
  limit basant-se en la taxa actual de consum), `inboxSlaInfo` (construeix la info completa
  per a cada fila de la safata).
- L'estat `near` s'activa al 80% del target; `paused` detecta rellotges aturats
  (`waiting_customer` / `waiting_third_party`).

**Canvis a l'aplicacio (`packages/application/src/support.ts`):**
- `TicketListRow` i `InboxTicket` inclouen `updatedAt` i `inboxSla: InboxSlaInfo`.
- `TicketDetail` inclou `inboxSla`.
- El metode `listInbox` calcula `inboxSla` per cada ticket en una sola passada.

**Canvis a la persistencia (`packages/persistence/src/support-repository.ts`):**
- `listColumns` inclou `t.updated_at as "updatedAt"` al SELECT.

**Canvis a la UI (`apps/web/src/components/support-inbox.tsx`):**
- Columnes noves: data de creacio, objectiu aplicat (primera resposta / resolucio), estat SLA
  (badge clicable), ultima actualitzacio.
- Nou component `SlaStatusBadge` amb 5 estats visuals: a temps (verd), proper (groc),
  incomplert (vermell), pausat (blau), sense configurar (gris).
- Nou component `SlaDetailDialog` que obre al clicar la badge i mostra: objectiu, consumit,
  restant, data limit estimada i pauses.

**Canvis a i18n (`packages/i18n/src/index.ts`):**
- Nous textos per als 5 estats SLA, columnes i dialeg de detall en ca, es i en.

**Proves:**
- 7 proves noves al domini: deriveInboxSlaStatus (7 cases) i estimateDeadline (4 cases),
  inboxSlaInfo (3 casos). Total domini: 28 proves.
- Mock de l'aplicacio actualitzat amb `updatedAt`. Total aplicacio: 26 proves.

**Canvis CSS (`apps/web/src/app/styles.css`):**
- nous estils per a `sla-badge` (on_time, near, paused) i `sla-detail-dialog`.**

### Increment 10 — Detall del ticket redissenyat (implementat, 10 d'agost de 2026)

L'increment 10 millora la pàgina de detall del ticket amb un disseny a dues columnes,
metadades completes i el projecte vinculat visible.

**Canvis a la persistència (`packages/persistence/src/support-repository.ts`):**
- LEFT JOIN a `projects` per obtenir `p.name as "projectName"` al `listColumns`.
- Nou mètode `updateCategory` que actualitza el camp `category` amb validació i auditoria.

**Canvis a l'aplicació (`packages/application/src/support.ts`):**
- `TicketListRow` inclou `projectName: string | null`.
- `TicketDetail.ticket` inclou `projectName: string | null`.
- Nou mètode `updateCategory` amb validació (longitud, no buit, ticket no tancat).

**Canvis a l'API (`apps/api/src/routes/support.ts`):**
- Nou endpoint: `PATCH /api/v1/support/tickets/:ticketId/category`
  - Body: `{ category: string }` (min 1, max 60)
  - Permis: `tickets:manage`
  - Auditoria: `ticket.category.changed`

**Canvis als tipus API (`apps/web/src/lib/api-types.ts`):**
- `InboxTicket` inclou `projectName: string | null`.

**Canvis a i18n (`packages/i18n/src/index.ts`):**
- Nous textos: `project`, `noProject`, `openedAt`, `lastUpdate` en ca, es i en.

**Canvis a la UI (`apps/web/src/components/ticket-detail.tsx`):**
- Redisseny complet amb layout a dues columnes (inspirat en project-detail.tsx):
  - Secció d'identitat: número + assumpte + client + projecte (link clicable)
  - Panell lateral de metadades: estat (select), prioritat (badge de color), categoria
    (input editable), responsable (select), objectius SLA (badges), dates
  - Fil de conversa amb missatges i formulari de resposta

**Canvis a CSS (`apps/web/src/app/styles.css`):**
- Nous estils: `.ticket-detail`, `.ticket-identity`, `.ticket-body`, `.ticket-meta`,
  `.ticket-priority-badge`, `.ticket-sla-*`, `.ticket-conversation`, `.ticket-reply`
- Media query `@media (max-width: 760px)`: layout en columna única per a mòbil

**Proves:**
- 5 proves noves per a `updateCategory` (èxit, buit, llarg, tancat, trim).
- Mock de l'aplicació actualitzat amb `projectName` i `updateCategory`.
- Total aplicació: 107 proves (5 noves).
- Typecheck del web app passa.

### Tancament de la consolidacio previa a la Fase 6

La consolidacio previa a la Fase 6 queda tancada amb els increments 0-11 implementats. El gate
local complet passa (`pnpm check`) i la suite autenticada passa amb 24/24 proves, dos workers,
base neta i sense reintents (`pnpm check:e2e`). Les proves E2E comparteixen un helper per conduir
tant els selectors tematitzats com els natius, i el detall de ticket exposa noms accessibles per
als controls d'estat i responsable. Sentry inclou la captura de transicions del router i la
configuracio vigent per eliminar debug logging.
La readiness comprova PostgreSQL i Redis amb un pressupost explicit de 60 peticions per minut;
el limit global continua protegint la resta de rutes i el hook de tancament no queda exposat com
un handler HTTP.
