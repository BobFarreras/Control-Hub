# Estat actual i continuacio

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

## Punt de projecte

Les fases 0 a 5B estan implementades. El producte executa web, API i worker en monorepo,
amb PostgreSQL, Valkey, Better Auth, tenancy, RBAC, MFA, CRM, cataleg comercial,
subscripcions de clients, subscripcions contractades per l'empresa, suport amb tickets i SLA, i
projectes amb imputacio de temps, barems versionats i rendibilitat.

**La Fase 5B esta tancada: fusionada a `develop` i amb la seva porta de revisio passada.** El
marge d'un projecte real s'ha comparat amb un calcul manual i quadra, i esta escrit com a prova a
`tests/e2e/rates.authenticated.spec.ts` perque continui quadrant. Especificacio a
`docs/specifications/projects-and-time.md`. Que inclou:

- `packages/config/src/flags.ts`: el registre de feature flags del repositori, el primer que hi
  ha. Cada flag es declara amb propietari i data de retirada, i s'activa amb `CONTROL_HUB_FLAGS`.
  `projects_and_time` apagada vol dir que l'API no declara les rutes i la web no mostra ni el
  menu ni les pantalles. Un nom no declarat s'ignora i s'avisa a l'arrencada.
- `packages/domain/src/projects.ts`: estats i transicions del projecte, arrodoniment half-up amb
  `BigInt`, resolucio del barem per data d'efecte, lectura de durades (`90` i `1h 30m`) i marge
  per moneda. Pur, 25 tests, sense base de dades.
- `0016_projects_and_time.sql`: projectes, historial append-only, barems de cost i de venda,
  imputacions, i la clau forana composta que obliga el projecte d'un ticket a ser del mateix
  client. RLS i `force row level security` a totes. `0017_projects_permissions.sql` afegeix
  `projects:read`, `time:log`, `time:manage` i `rates:manage` amb backfill per als tenants que
  ja existeixen.
- `packages/application/src/projects.ts`: `ProjectsService` i el port `ProjectsRepository`.
  Valida el xor de la imputacio, rebutja dates futures i projectes tancats, retorna la
  imputacio ja desada quan es repeteix un `clientReference`, i nomes deixa editar hores d'una
  altra persona amb `time:manage`.
- `packages/persistence/src/projects-repository.ts`: adaptador contra PostgreSQL. Els dies
  viatgen com a `YYYY-MM-DD` i no com a instants, i els barems es carreguen sencers per
  resoldre'ls al domini en comptes de fer una consulta per hora imputada.
- `apps/api/src/routes/projects.ts`: llistat, alta, fitxa, canvi d'estat, imputacions, barems i
  rendibilitat per projecte i per client. Cost i marge sempre darrere `financials:read`, al
  servei i a la ruta. Cap import de cost a l'auditoria.
- `apps/web`: pantalla de projectes amb `SmartDataTable`, fitxa amb historial, formulari
  d'imputacio i bloc de rendibilitat. El bloc financer no arriba al navegador de qui no te
  `financials:read`: el servidor no el demana, no s'amaga amb CSS.

- `apps/web/src/app/[locale]/projects/rates/page.tsx`: la pantalla de barems. Cost per hora per
  persona i preu de venda per tipus de servei, client o projecte, cadascun amb el seu formulari i el seu historial
  publicat, amb la fila vigent marcada, i el panell de tipus de servei. Els imports es converteixen a unitats menors a
  `apps/web/src/lib/money.ts`, **mai per coma flotant**, i es refusa un tercer decimal en comptes
  d'arrodonir-lo. 17 tests.
- Primitives compartides a `apps/web/src/components/`: `form-field.tsx` (Field, SelectField,
  SelectControl, TextField, ToggleField), `help.tsx` (`?` amb tooltip i `?` amb dialeg),
  `status-pill.tsx` i `metric-tile.tsx`. El desplegable visible es un listbox tematitzat light/dark
  amb teclat i lector de pantalla; un `<select>` intern conserva el contracte dels formularis.
- **Proves E2E autenticades: 13.** Les de projectes creen un projecte pel dialeg real i hi imputen
  hores; les de barems publiquen un cost i un preu i comproven el marge contra l'aritmetica escrita
  a l'assercio, i que **un barem publicat avui no canvia el valor d'una hora de fa un mes**. El job
  `authenticated-end-to-end` porta `CONTROL_HUB_FLAGS=projects_and_time`; sense la variable
  anirien contra un 404.

### Barems per tipus de servei i anul·lacio (revisio del propietari, 7 d'agost de 2026)

El que quedava obert de la Fase 5B ja esta implementat. El propietari va decidir les dues coses que
faltaven i les dues estan a `docs/specifications/projects-and-time.md`:

**Preu de venda per tipus de feina.** Fixar el preu client per client obligava a repetir-lo a cada
client nou. Ara hi ha un cataleg propi de tipus de servei (`service_types`) -- agent d'IA, pagina
web, software a mida, automatitzacio -- i el preu de venda es pot publicar per tipus. La resolucio
te tres nivells i va del mes especific al mes general: **projecte, despres client, despres tipus de
servei**. Es va descartar reutilitzar els productes de la Fase 4: son el cataleg comercial de
subscripcions, i acoblar-hi els projectes faria que renombrar un producte mogues preus.

**Anul·lar un barem publicat per error.** Un barem no s'esborra mai. Es marca amb `annulled_at` i
qui el retira, la fila es queda a l'historial i la resolucio la ignora. Tres consequencies, que son
el motiu de triar-ho aixi:

- L'errada continua sent auditable.
- La unicitat nomes val per a les files vives, aixi que un import mal escrit **es pot corregir el
  mateix dia**. Abans calia esperar a l'endema.
- Retirar un barem no deixa forat: torna a ser vigent el que hi havia abans.

El trigger `reject_rate_mutation` accepta exactament aquest canvi i cap altre, i el rol de
l'aplicacio nomes te `grant update (annulled_at, annulled_by_membership_id)`. Un `update` o un
`delete` sobre qualsevol altra columna rebota tambe amb SQL directe.

**Treure un tipus de servei.** Una `x` a cada etiqueta. Que passa depen de que en depen, i la
pantalla ho diu abans de clicar: si no hi ha res vinculat s'esborra; si hi ha projectes, es
desvinculen i el dialeg avisa que **hauran de tenir barem propi**; i si hi ha algun barem publicat
sota aquell tipus no es pot esborrar, perque canviaria el valor d'hores ja facturades -- llavors es
desactiva, surt dels desplegables per a feina nova i el seu barem continua valorant el que ja
valorava. Les etiquetes desactivades es poden reactivar.

**El codi s'escriu sol.** S'escriu el nom i el codi es va omplint amb els guions posats:
"Pàgina Web" dona `pagina-web`. Es pot sobreescriure, i buidar-lo el torna a lligar al nom.
`toServiceCode` al domini es l'autoritat i qualsevol codi que arribi hi torna a passar, aixi que del
formulari no en pot sortir res invalid.

Fitxers: `0018_service_rates_and_annulment.sql`, i les capes de sempre fins a
`components/rates-workspace.tsx`, que ara porta el panell de tipus de servei, el tercer abast al
formulari de venda i l'accio de retirar a cada historial (amb confirmacio en dos passos, perque no
es pot desfer). El tipus de feina d'un projecte es pot triar al dialeg d'alta i canviar despres a la
seva fitxa: no es append-only, perque es una propietat del projecte i no un preu.

Respostes a les dues preguntes que el propietari va fer, perque son les que decideixen si el model
serveix: **si**, un barem amb data de dema es fa efectiu dema i no abans; i **si**, un mateix
projecte pot haver tingut preus diferents al llarg del temps, i cada hora es valora amb el que era
vigent el dia que es va treballar.

Verificat executant: 63 proves al domini, 62 a `application`, 62 d'integracio contra PostgreSQL i
**15 proves E2E autenticades**. De les noves d'integracio: retirada, doble retirada, correccio el
mateix dia, `update` directe rebutjat, els tres nivells de resolucio, esborrar un tipus sense res
vinculat, desvincular-ne els projectes i comptar-los, la negativa amb barem publicat (tambe amb el
barem anul·lat), i que desactivar no mou el que el barem ja valorava. Les quatre E2E noves fan el
recorregut per la UI real: preu per tipus de feina amb el del projecte manant-hi per sobre; escriure
900,00 en comptes de 90,00, retirar-ho i publicar el correcte el mateix dia; el codi omplint-se sol
a partir d'un nom amb accent; i la `x` que esborra quan pot i desactiva quan no.

La resta de la fase esta completa, inclosa la pantalla de barems que `IMPLEMENTATION_PLAN.md`
demanava.

La **Fase 5: suport, tickets i SLA** esta tancada: implementada, revisada pel propietari i
fusionada a `develop` amb CI en verd. Especificacio a `docs/specifications/support.md`. Que
inclou:

- `packages/domain/src/support-calendar.ts`: minuts laborables amb finestres per dia, festius,
  torns partits i canvis d'hora. Pur, 9 tests, sense base de dades.
- `0014_support.sql`: horari, festius, objectius de SLA append-only, politica de notificacio,
  tickets amb `project_id` nullable, missatges i events append-only, incidencies i el seu
  vincle amb tickets. RLS i `force row level security` a totes.
- `packages/database/src/support.integration.test.ts`: aillament entre tenants, rebuig de
  client d'un altre tenant, idempotencia per referencia externa i append-only.

- `packages/domain/src/support.ts`: estats i transicions del ticket, i el calcul de SLA amb
  pauses. El rellotge s'atura a `waiting_customer` i `waiting_third_party`, i les pauses es
  resten en minuts laborables, no de rellotge de paret.
- `packages/application/src/support.ts`: `SupportService` i el port `SupportRepository`.
  Copia els objectius vigents en obrir el ticket, marca la primera resposta un sol cop, i
  retorna el missatge ja desat quan es repeteix una referencia externa.

- `apps/api/src/support-repository.ts`: adaptador contra PostgreSQL. Numero de ticket des
  d'un comptador propi, pauses derivades del log d'events, i primera resposta escrita amb
  `where first_response_at is null`.

- `apps/api/src/routes/support.ts`: llistat, alta, fitxa, canvi d'estat, missatges i estat de
  SLA, amb `tickets:read` i `tickets:manage` a cada ruta i auditoria a les mutacions.
- `0015_support_permissions.sql`: `tickets:read` i `support:configure` a la taula de permisos,
  amb backfill per als tenants que ja existeixen.

- Configuracio de suport per API: horari setmanal, festius i objectius de SLA. Escriure exigeix
  `support:configure`; llegir, nomes `tickets:read`, perque la safata ha de poder explicar un
  venciment.

- `packages/persistence`: els set adaptadors de PostgreSQL, moguts fora d'`apps/api` perque el
  worker tambe els necessita i una app no pot importar d'una altra.
- `apps/worker/src/support-escalation.ts`: escombrada periodica que recorre els tenants i
  registra els objectius de SLA incomplerts. Job repetible de BullMQ cada 5 minuts.

- `apps/web/src/app/[locale]/support/page.tsx` i `components/support-inbox.tsx`: safata amb
  `SmartDataTable`, filtres, cerca i temps laborable restant per fila. Entrada "Suport" del
  menu ja cablejada.
- El llistat retorna l'estat de SLA per fila calculat al servidor: una carrega del calendari i
  una consulta de pauses per pagina, independentment de quantes files mostri.

- `apps/web/src/app/[locale]/support/[ticketId]/page.tsx` i `components/ticket-detail.tsx`:
  fitxa amb conversa, canvi d'estat, assignacio i resposta. Els comentaris interns es marquen
  al DOM (`aria-label` i text), no nomes visualment.
- `GET /api/v1/support/tickets/:ticketId` retorna ticket, conversa, estat de SLA i membres
  assignables en una sola crida.

- Alta de tickets des de la safata, amb seleccio de client, prioritat i categoria.

- **Proves end-to-end autenticades.** Per primera vegada hi ha verificacio automatica de
  pantalles amb sessio iniciada. `apps/api/src/seed-e2e.ts` prepara un compte d'usar i llencar
  en una base exclusiva de test i li **enrola** el segon factor per la via normal de Better
  Auth; l'MFA no es toca, i el seed es nega a escriure credencials si el compte no acaba amb
  MFA activada. `tests/e2e/support/totp.ts` genera els codis amb `node:crypto`, fixat als
  vectors publicats de la RFC 6238 a `tests/e2e/totp.spec.ts`. Cobreixen: entrada completa amb
  correu, contrasenya i segon factor (i el rebuig d'un codi incorrecte), la safata amb la
  columna de compromis, la conversa d'un ticket amb la nota interna marcada al DOM per
  `aria-label` i per text, i el canvi d'estat i l'assignacio des de la fitxa. El job
  `authenticated-end-to-end` de `.github/workflows/ci.yml` ho executa a cada push.

**La Fase 5 esta tancada.** El propietari l'ha revisada i aprovada, i la porta que demanava el
pla queda passada.

El primer pas de la Fase 5 per CI va destapar dos defectes que portaven dies al repositori i
que cap validacio local veia: la imatge de contenidors no es podia ni construir, i el test de
l'escombrada d'escalats assertia sobre estat compartit entre suites que corren en paral·lel.
Tots dos corregits; la causa i la solucio son a `troubleshooting.md`.

### Pendents coneguts, no bloquejants

- Alta d'incidencies i el seu vincle amb tickets: l'esquema hi es, la UI no.
- Pantalla de configuracio de suport (horari, festius, objectius): l'API hi es, la UI no.
- L'E2E autenticat cobreix suport i projectes. CRM, productes i subscripcions no tenen encara
  proves amb sessio iniciada, tot i que la infraestructura ja hi es.
- `db:seed:dev` no sembra projectes ni imputacions, aixi que la pantalla de projectes surt buida
  en un entorn local acabat de sembrar.

### Estabilitat del suite E2E (7 d'agost de 2026)

CI va quedar en vermell despres de tancar la 5B, i **no per cap defecte de producte**: eren tres
defectes de les proves, tots de la mateixa familia -- una prova que depen d'un estat que no
controla. Les tres correccions estan a `troubleshooting.md` amb el simptoma sencer.

- **Les proves que muten obren el seu propi ticket.** Canviar `new` a `open` no te tornada, aixi
  que una prova que ho feia sobre una fila sembrada nomes passava al primer intent: **el reintent
  de Playwright passa dins de la mateixa execucio**, molt despres del seed, i hi trobava el ticket
  ja obert. Ara `createTicket` obre el seu pel dialeg real, com ja feien projectes i barems, i
  **res del que sembra `seed-e2e.ts` es muta**. El seed passa de cinc tickets a tres.
- **La fitxa d'un projecte sense barem s'asserta pel que es cert sota les dues lectures.** Amb dos
  workers sobre una sola base, que la suite de barems hagi publicat o no un cost canvia el text del
  tile de marge; el que no canvia es que les hores sense valorar s'avisen en comptes de comptar-se
  com a gratis, i aixo es el que es comprova.
- **La hidratacio s'espera dins del bucle, no abans.** Cada `page.reload()` reemplaça l'element, i
  la segona volta actuava sobre marcatge sense cap handler: el desplegable es movia i no s'enviava
  res. Aquest encara no havia fallat a CI.

La safata es cerca (`?search=`) en comptes de llegir-se de la primera pagina, perque les proves ara
obren tickets propis i vint-i-cinc files noves amagarien les sembrades.

Verificat contra la pila de `pnpm dev:verify`: **15 proves autenticades en verd amb dos workers**,
la forma que fa servir CI, i **en verd dues vegades seguides sense tornar a sembrar entremig** --
que es la propietat que abans no es tenia. Les dues branques de l'assercio del marge s'han
executat: la base acabada de sembrar dona "Cap barem publicat" i, un cop la suite de barems hi ha
publicat un cost, "imputacions sense valorar".

### Millores a la UI de barems (branca `feature/rates-ui-improvements`)

**Toast global.** S'ha creat un sistema de notificacions Toast (`toast.tsx`) que substitueix els
errors inline de la pantalla de barems. Els missatges surten fixos a la part superior de la
viewport, just a sota de la topbar, amb auto-dismiss als 5 segons i boto per tancar manualment.
Suporta variants success, error, warning i info amb els tokens semantics del Design System. El
provider esta integrat al layout arrel (`layout.tsx`).

**Taula de preu de venda amb SmartDataTable.** La taula de barems de venda ha passat d'un
component `RateTable` simple a un `BillingRatesTable` que utilitza `SmartDataTable`. Inclou:
- Cerca per nom, import o data (`InstantSearch`)
- Filtres per tipus d'abast (client, projecte, tipus de servei) i estat (vigent, substituit,
  anul·lat)
- Ordenacio per abast, import i data
- Paginacio amb preferencies persistides per tenant i usuari
- Les etiquetes i18n s'han afegit als diccionaris de rates (ca, es, en)

**Fitxers afectats:**
- `apps/web/src/components/toast.tsx` (nou)
- `apps/web/src/components/billing-rates-table.tsx` (nou)
- `apps/web/src/components/rates-workspace.tsx` (usa toast + BillingRatesTable)
- `apps/web/src/app/layout.tsx` (ToastProvider)
- `apps/web/src/app/styles.css` (estils toast)
- `packages/i18n/src/index.ts` (etiquetes noves)

## Fase 5C: registre de jornada (en curs, branca `feature/phase-5c-attendance`)

Especificacio a `docs/specifications/attendance.md`, ampliada el 7 d'agost amb tres decisions del
propietari: **pauses configurables i apagades per defecte**, **cadascu corregeix el seu registre amb
motiu obligatori**, i **fitxar sortida estant en pausa es rebutja**. Govern de dades a
`docs/security/data-governance.md`.

Tot el modul viu darrere la flag `attendance`, apagada per defecte fins que la gestoria confirmi
que la forma del registre li serveix.

Implementat i committat:

- `packages/domain/src/attendance.ts`: sessions derivades del log, estat, pauses, correccions
  encadenades i conciliacio. Pur. Compta temps real transcorregut, aixi que una nit de canvi d'hora
  son cinc hores i no quatre, i una sessio oberta no val zero.
- `0019_attendance.sql` i `0020_attendance_permissions.sql`: log append-only. El rol de
  l'aplicacio te `select` i `insert` i res mes, aixi que un `update` rebota tambe amb SQL directe.
  Un event nomes es pot corregir un cop. **Avui res no pot esborrar un fitxatge**, ni passat el
  termini de retencio: la purga encara no existeix i el perque esta a `data-governance.md`.
- `packages/application/src/attendance.ts` i `packages/persistence/src/attendance-repository.ts`.
  Un fitxatge no envia `occurred_at`: els dos rellotges agafen el `now()` de la transaccio i
  surten iguals, que es el que distingeix un fitxatge d'una declaracio posterior.
- `apps/api/src/routes/attendance.ts`: sis rutes. Llegir el registre d'una altra persona queda
  auditat encara que qui ho fa hi tingui dret.
- `apps/web`: boto a la capcalera de totes les pantalles, pantalla `/attendance` amb el mes
  propi i l'historial complet, i `/attendance/team` amb la vista de tothom, l'exportacio Excel
  (una fila per persona i dia, amb entrada, sortida i hores en format decimal) i la conciliacio.

Verificat: **89 proves de domini, 82 d'aplicacio, 31 d'API, 11 d'integracio de l'esquema, 11 de
l'adaptador i 4 E2E autenticades noves**, aquestes ultimes executades contra la pila de verificacio.

### Increment 10 — Jornada amb calendari laboral (implementat, 9 d'agost de 2026)

L'increment 10 afegeix gestio de festius, vacances, absencies i bloquejos personals, mes una
vista de calendari accessible amb canvi taula/calendari.

**Canvis al model de dades:**
- `0025_attendance_calendar.sql`: taules `attendance_holidays`, `attendance_non_working_days`,
  `attendance_vacations`, `attendance_absences` i `attendance_blocks` amb RLS i claus foranes.
- `0026_attendance_permissions_calendar.sql`: permisos `attendance:holidays` i `attendance:vacations`
  per Owner i Administrator, amb backfill.

**Canvis al domini (`packages/domain/src/attendance.ts`):**
- Tipus nous: `AttendanceHoliday`, `AttendanceNonWorkingDay`, `AttendanceVacation`,
  `AttendanceAbsence`, `AttendanceBlock`, `AttendanceDayStatus`.
- Funcions: `isHoliday`, `isNonWorkingDay`, `isVacationDay`, `isAbsenceDay`, `hasBlockOverlap`,
  `deriveDayStatus`.

**Canvis a l'aplicacio (`packages/application/src/attendance.ts`):**
- Nous metodes al servei: `listHolidays`, `createHoliday`, `deleteHoliday`,
  `listNonWorkingDays`, `createNonWorkingDay`, `deleteNonWorkingDay`, `listVacations`,
  `listVacationsByMember`, `createVacation`, `updateVacationStatus`, `listAbsences`,
  `listAbsencesByMember`, `createAbsence`, `listBlocks`, `listBlocksByMember`, `createBlock`,
  `deleteBlock`.
- Nous metodes al repositori amb les seves implementacions a PostgreSQL.

**Canvis a l'API (`apps/api/src/routes/attendance.ts`):**
- Rutes noves: CRUD per a festius, dies no laborables, vacances, absencies i bloquejos.
- Auditoria per a totes les mutacions.

**Canvis a la UI:**
- `apps/web/src/app/[locale]/attendance/page.tsx`: navegacio de mes amb fletxes accessibles
  (`aria-label` i tooltip), sense textos "mes anterior/seguent". Canvi taula/calendari amb
  conservacio del mes a la URL.
- `apps/web/src/components/attendance-record.tsx`: components `TableView` i `CalendarView`.
  El calendari mostra estat diari, hores registrades i incidencies amb text descriptiu, sense
  representar nomes per color.
- `apps/web/src/app/styles.css`: estils per al calendari i el canvi taula/calendari.

**Canvis a i18n:**
- Nous textos per a festius, vacances, absencies, bloquejos i vista de calendari en ca, es i en.

**Proves:**
- 6 proves noves al domini (`packages/domain/src/attendance.test.ts`): festius, dies no
  laborables, vacances, absencies, bloquejos i derivacio d'estat diari.
- Mock del repositori actualitzat a `packages/application/src/attendance.test.ts`.

**Punts pendents:**
- La UI de gestio de festius, vacances, absencies i bloquejos encara no esta implementada
  (nomes les API i el domini).
- La vista de calendari no mostra encara festius, vacances ni absencies (nomes hores
  treballades i sessions obertes). Cal connectar-la amb les dades noves.
- La migracio 0025 i 0026 s'han de pujar a la base de dades de produccio.

## El següent increment (previ a la 5C, ja superat)

### Que falta per tancar la fase, i el que ho bloqueja

**CI esta en vermell a `develop` (`0881bee`), nomes al job `authenticated-end-to-end`.** Els
altres set jobs passen: lint, format, typecheck, unit, integracio, build, imatge i secrets.

El que diu el log de CI, que es el punt de partida de la propera sessio:

```
⨯ Error: The destination stream closed early.
⨯ Error: SUPPORT_LOAD_ERROR
⨯ Error: PROJECT_LOAD_ERROR
```

Fallen proves de **suport, projectes i barems alhora**, no de jornada. El simptoma visible es un
`<select>` buit i deshabilitat, pero la causa no es la pantalla: **les crides a l'API no serveixen
les llistes**. Passa amb **dos workers i una base sembrada de zero**, que es la combinacio que en
local no s'havia provat mai.

**El forat de metodologia, que es el que cal tapar primer.** `pnpm check` es lint, format,
typecheck, test i build: **no inclou les E2E autenticades**. Per aixo "verd en local" no volia dir
res sobre aquest job. Cal un `pnpm check:e2e` que sembri una base neta i corri **la suite sencera
amb dos workers**, igual que CI, i que sigui el que es passa abans de cada push.

Diferencies que van amagar el problema durant tres tandes: local corria nomes
`attendance.authenticated.spec.ts`, amb un worker, sobre una base amb un dia de dades acumulades i
a Windows; CI corre 19 proves, amb dos workers, base neta i Linux.

Ja resolt i no cal tornar-hi:

- La flag `attendance` es al workflow, i les proves de jornada fallen de pressa dient el nom de la
  variable si no hi es.
- `actionTimeout: 15_000` i `navigationTimeout: 30_000` a `playwright.config.ts`: una tanda
  vermella triga 3 minuts en comptes de 9.
- Els dos errors de lint de l'exportacio Excel.

Pendent, a banda d'aixo: la revisio del propietari i la confirmacio de la gestoria abans d'encendre
la flag en produccio.

## El seguent increment (previ a la 5C, ja superat)

**El seguent pas es la Fase 5C: registre de jornada**, amb especificacio aprovada a
`docs/specifications/attendance.md`. Pendent de confirmacio de la gestoria abans d'activar-la en
produccio, i per aixo estrenara la feature flag amb `attendance`: el codi pot estar desplegat i
apagat mentre s'espera la confirmacio, que es exactament per aixo que existeix el registre de
flags.

La 5C concilia hores registrades contra hores imputades a projectes i tickets, aixi que depen de la
5B, que ja esta tancada i amb el marge verificat, i tambe amb els barems per tipus de servei i
l'anul·lacio ja implementats. **Es comenca en una sessio i una branca noves.**

L'auditoria previa a la Fase 5 i les correccions aplicades estan a
`docs/phase-5-preflight-audit.md`.

## Decisions de suport vigents

- Horari de suport: dilluns a divendres, 08:00 a 16:00, `Europe/Madrid`.
- El rellotge del SLA s'atura fora d'horari i mentre s'espera el client.
- Objectius de SLA per prioritat, iguals per a tots els clients.
- Les incidencies no tenen SLA de client: tenen gravetat, i nomes `critical` avisa fora
  d'horari.

## Superficie executable

- Web canonica: `http://localhost:3001`.
- API interna: `http://127.0.0.1:4000`; el navegador usa exclusivament `/api/*` via Next.js.
- Rutes operatives: dashboard, CRM, detall de client, productes, subscripcions de clients,
  subscripcions d'empresa, suport, projectes, barems i seguretat.
- `/{locale}/projects` i `/{locale}/projects/{projectId}` nomes existeixen amb
  `CONTROL_HUB_FLAGS=projects_and_time`. Sense la flag responen 404 i el menu no les mostra.
- `/{locale}/commerce` es una redireccio de compatibilitat cap a `/{locale}/products`.
- Locales obligatoris: `ca`, `es` i `en`; temes obligatoris: light i dark.

## Decisions UI vigents

- `PageTopbar` es la capcalera canonica: eyebrow, titol i descripcio aprofiten la topbar.
- KPI i accions principals comparteixen franges compactes.
- `MetricHelp` explica sigles i metriques per hover i focus amb text traduit.
- `SmartDataTable` proporciona paginacio server-side, cerca instantania, ordenacio,
  filtres i preferencies de columnes persistides per tenant i usuari.
- `ToastProvider` ofereix notificacions efimeres (auto-dismiss 5s) per errors i confirmacions.
  Ubicat a la part superior de la viewport, just a sota de la topbar. Utilitzar `useToast()` des
  de qualsevol component de client.
- CRM permet canviar visualment les etapes actives del lead; Guanyat converteix el lead
  en client i Perdut es una accio terminal separada.
- Tota UI nova ha de seguir `DESIGN_SYSTEM.md` i reutilitzar aquestes primitives.

## Dades i migracions recents

- `0012_company_subscriptions.sql`: despeses recurrents de l'empresa amb RLS.
- `0013_user_table_preferences.sql`: preferencies de taula per tenant i usuari amb RLS.
- `0029_company_subscriptions_polish.sql`: evolucio additiva de les despeses recurrents,
  responsable tenant-scoped, dates contractuals, historial append-only i backfill idempotent.
- `0016_projects_and_time.sql`: projectes, historial, barems i imputacions. Tres garanties que
  no viuen al domini: el xor de la imputacio (`num_nonnulls(project_id, ticket_id) = 1`), el
  trigger que rebutja hores sobre un projecte tancat (SQLSTATE propi `CH001`), i la clau forana
  composta `tickets(tenant_id, project_id, customer_id)` que obliga el projecte d'un ticket a
  ser del mateix client.
- `0017_projects_permissions.sql`: permisos nous amb backfill per als tenants existents.
- `pnpm db:seed:dev`: dades representatives locals, idempotents i sense esborrar dades. **Encara
  no sembra projectes ni imputacions.**

## Decisions de projectes i temps vigents

- Els barems son append-only amb data d'efecte. Una imputacio es valora amb el barem vigent el
  **dia treballat**, mai amb el d'avui.
- Els dies (`spent_on`, `effective_from`) viatgen com a `YYYY-MM-DD` de la base a la pantalla i
  mai es converteixen a instant: un barem vigent des del dia 1 val per a la feina del dia 1
  sigui quina sigui la zona horaria de qui ho llegeix.
- L'arrodoniment es half-up i **per imputacio**, no sobre la suma, de manera que un total sempre
  es la suma de les linies que un client pot veure.
- Les hores d'un projecte inclouen les imputades als seus tickets. La feina de suport d'un
  projecte es feina del projecte.
- Una imputacio sense barem resoluble no compta com a cost zero: surt a l'informe com a barem
  absent.
- La durada s'envia com a text (`90` o `1h 30m`) i la llegeix un unic parser del domini.

## Observabilitat

Sentry esta implementat al servei web (Next.js) per capturar errors en produccio.
Configuracio completa a `docs/observability/SENTRY.md`.

| Servei | Estat | Paquet |
|--------|-------|--------|
| web | ✅ | `@sentry/nextjs` |
| api | ❌ futur | `@sentry/node` |
| worker | ❌ futur | `@sentry/node` |

Variables d'entorn necessaries (a `apps/web/.env.local`):
- `NEXT_PUBLIC_SENTRY_DSN` (client-side)
- `SENTRY_DSN` (server-side)
- `SENTRY_AUTH_TOKEN` (build/source maps)
- `SENTRY_ORG=digitai-studios`
- `SENTRY_PROJECT=control-hub`

**Important:** Les variables han d'estar a `apps/web/.env.local`, NO al `.env` arrel del monorepo.
La CSP a `next.config.ts` ha d'incloure `https://o4510557342400512.ingest.de.sentry.io` al `connect-src`.
En desenvolupament Sentry esta desactivat; els errors van a la consola.

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

## Validacio abans de continuar

La consolidacio previa a la Fase 6 queda tancada amb els increments 0-11 implementats. El gate
local complet passa (`pnpm check`) i la suite autenticada passa amb 24/24 proves, dos workers,
base neta i sense reintents (`pnpm check:e2e`). Les proves E2E comparteixen un helper per conduir
tant els selectors tematitzats com els natius, i el detall de ticket exposa noms accessibles per
als controls d'estat i responsable. Sentry inclou la captura de transicions del router i la
configuracio vigent per eliminar debug logging.
La readiness comprova PostgreSQL i Redis amb un pressupost explicit de 60 peticions per minut;
el limit global continua protegint la resta de rutes i el hook de tancament no queda exposat com
un handler HTTP.

```powershell
pnpm infra:up
pnpm db:migrate
pnpm dev
pnpm check
pnpm test:e2e
```

Les proves d'integracio PostgreSQL requereixen `TEST_DATABASE_URL` i
`TEST_DATABASE_ADMIN_URL` sobre una base exclusiva de test.

Les proves end-to-end autenticades necessiten la seva propia base, acabada en `_e2e`, i
`pnpm db:seed:e2e` abans de cada tanda. El procediment complet es a `DEVELOPMENT.md`. Dos
detalls que fan perdre temps si no es saben: `APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` han de ser
la mateixa cadena, i les proves esperen que React hidrati abans de tocar res, perque un clic
anterior a la hidratacio es perd i sembla que el producte no respongui.
