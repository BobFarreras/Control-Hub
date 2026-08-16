# Historic — Fase 5B: projectes, temps i barems

> Text mogut tal qual des de `docs/development/current-state.md` (linies 129-233, 314-366
> i 451-505 de la versio anterior a la particio). No s'ha resumit ni reescrit res.
>
> **Unica correccio de contingut**, aprovada explicitament pel propietari: la descripcio del
> toast a "Millores a la UI de barems" deia que els missatges surten a la part superior de la
> viewport. Es fals i ho era ja quan es va escriure — `apps/web/src/app/styles.css:4033` i la
> media query de la linia 4127 el fixen a baix a la dreta, i no hi ha cap regla `top:`. La
> frase queda corregida en comptes de moure's com si fos certa.

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
errors inline de la pantalla de barems. Els missatges surten fixos a baix a la dreta de la
viewport, respectant la safe-area, amb auto-dismiss als 5 segons i boto per tancar manualment.
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
