# Problemes coneguts i com resoldre'ls

Cada entrada d'aquest document ve d'una fallada real que va costar temps. L'ordre es per on
apareix el simptoma, no per importancia.

Aixo **no** son normes: les normes viuen a `AGENTS.md` i als documents canonics, i aquest
fitxer hi remet quan cal. Aqui nomes hi ha simptomes, la causa que hi havia a sota i que es va
fer. Si trobes una fallada nova que t'ha costat mes de mitja hora, afegeix-la.

## Metode

Dues regles que han estalviat mes temps que cap altra cosa:

- **Verifica l'artefacte a la maquina abans de reconstruir res.** `node apps/api/dist/server.js`
  triga dos segons i una reconstruccio d'imatge uns vuit minuts. Diagnosticar a base de
  reconstruir va costar hores en una sessio, i cada error en tapava el seguent.
- **Quan una reproduccio passa a la primera, sospita.** Comprova que la condicio hi era de
  debo abans de concloure que el problema no existeix. Vegeu l'entrada de `docker exec` mes
  avall: una reproduccio que no va inserir mai les dades feia passar el test per falta de
  dades, no per la correccio.

## Empaquetat i desplegament

Les regles completes son a `AGENTS.md`, seccio "Empaquetat i desplegament". Aqui, els
simptomes.

### La imatge no arrenca i el log parla de descarregar un gestor de paquets

**Causa.** El servei arrencava passant per pnpm, i corepack intenta descarregar-se un gestor
en arrencar. Aixo necessita xarxa i un HOME escrivible; els contenidors son `read_only`.

**Solucio.** Els serveis arrenquen amb `node`, mai amb un gestor de paquets.

### `docker compose build` falla amb `required variable ... is missing a value`

**Causa.** `compose.yaml` declara les variables amb la forma `${VAR:?missatge}`. Compose
interpola el fitxer **sencer** abans de fer res, i ho fa a cada ordre que el llegeix: `build`,
`up`, `logs` i `down`. Donar les variables nomes al pas que aixeca l'stack deixa els altres
tres fallant per una variable absent en comptes de per res real.

**Solucio.** Exporta `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD` i `BETTER_AUTH_SECRET`
a l'ambit que cobreixi **totes** les ordres de compose. A CI, a nivell de job.

### Un contenidor diu `Permission denied` sobre un fitxer de `/run/secrets`

**Simptoma.** PostgreSQL no arriba a `healthy` i el log diu `cat: can't open
'/run/secrets/postgres_app_password': Permission denied`, o `migrate` acaba amb el mateix error
sobre `migration_database_url`. Els fitxers existeixen i el `compose` els declara amb `uid`, `gid`
i `mode` correctes.

**Causa.** Compose **ignora** `uid`, `gid` i `mode` en un secret: son atributs de Swarm. Ho diu a
cada execucio amb `WARN[0000] secrets uid, gid and mode are not supported, they will be ignored`,
i despres munta el fitxer amb la propietat que te **a la maquina**. Un secret d'arrel es un secret
que el contenidor no pot llegir, digui el que digui el fitxer de compose. PostgreSQL inicialitza
com a uid 70 i les imatges de Node corren com a uid 1000.

**Solucio.** Torna a executar `deploy/install.sh`: des de la `v0.4.2` assigna la propietat a cada
execucio, no nomes quan crea el fitxer. Si has de fer-ho a ma, `chown 70:70` als dos de PostgreSQL
i `chown 1000:1000` a la resta, amb mode `0400` i el directori `0700` d'arrel. Els secrets d'OAuth
que crees tu (`google_oauth_client_secret`, `microsoft_oauth_client_secret`) tambe son uid 1000.

Si PostgreSQL ja havia arrencat amb el volum a mitges, el `chown` sol no n'hi ha prou: el script
que crea el rol `control_hub_app` corre nomes sobre un directori de dades buit. Cal
`docker compose down` i esborrar el volum `<projecte>_postgres-data` abans de tornar-hi.

### L'enllac de verificacio del correu respon `Internal Server Error`

**Simptoma.** Qualsevol ruta `/api/...` demanada des del navegador dona 500. El log del contenidor
`web` diu `Failed to proxy http://127.0.0.1:4000/api/... Error: connect ECONNREFUSED`. Les pagines
es renderitzen be i l'API respon si se li demana directament.

**Causa.** `apps/web/next.config.ts` reenvia `/api` i `/health` amb un *rewrite* de Next, i la
destinacio d'un rewrite es **resol quan es compila**, no quan arrenca el servidor. La imatge
publicada s'havia construit sense `API_INTERNAL_URL`, aixi que portava gravat
`http://127.0.0.1:4000` --ella mateixa, des de dins del seu contenidor-- i cap variable d'entorn
en temps d'execucio ho canvia. El valor del contenidor arriba a `apps/web/src/lib/api.ts`, que es
un cami diferent: per aixo les crides del servidor funcionaven.

**Solucio.** Ja resolt: `deploy/Dockerfile` posa `ENV API_INTERNAL_URL` abans del `pnpm build`, i
`scripts/container-secrets.test.mjs` obliga que coincideixi amb el que dona `compose.yaml`. Si
torna a apareixer, mira si algu ha afegit un rewrite nou amb un valor que nomes existeix en temps
d'execucio.

### El menu lateral surt buit amb moduls actius a `.env`

**Simptoma.** `CONTROL_HUB_FLAGS` es a `.env` amb els moduls escollits, l'instal·lador els va
reportar al final, i no n'apareix cap. `docker exec <contenidor> printenv CONTROL_HUB_FLAGS` no
imprimeix res.

**Causa.** Cap fitxer de compose anomenava la variable, i una variable que el compose no anomena
no arriba mai al contenidor --el `--env-file` serveix per interpolar el fitxer, no per exportar-la.
El registre llegeix l'absencia com a «cap modul», que es identic a una instal·lacio ben connectada
que no n'ha triat cap.

**Solucio.** Ja resolt: `compose.yaml` la passa a `web`, `api` i `worker`, i
`scripts/install.test.mjs` exigeix que **cada** nom que `install.sh` escriu a `.env` l'anomeni
algun fitxer de compose o consti a la llista del que es llegeix nomes a la maquina.

### No arriba mai l'avis de versio nova, i els connectors no se sincronitzen sols

**Simptoma.** El banner d'actualitzacio no apareix encara que hi hagi una versio publicada, cap
alerta no s'envia, i els connectors nomes fan res quan algu els executa a ma. L'stack sembla sa:
`docker compose up -d --wait` va acabar be i la web i l'API responen.

**Causa.** El `worker` no esta corrent. Mira-t'ho amb la columna d'estat i el comptador de
reinicis, no amb `ps` a seques:

```sh
docker compose ps -a
docker inspect -f '{{.Name}} {{.State.Status}} {{.RestartCount}}' $(docker compose ps -aq)
```

Un `RestartCount` que puja vol dir que el proces no sobreviu a l'arrencada. Fins a la v0.4.2 el
worker exigia `BETTER_AUTH_SECRET` --heretat del schema que comparteix amb l'API-- i cap fitxer de
compose li'n donava cap, aixi que moria en bucle a totes les instal·lacions que hi ha hagut mai.
`--wait` no ho veia perque el worker no te healthcheck, i amb `restart: unless-stopped` un servei
que ressuscita cada dos segons te el mateix aspecte que un que funciona.

**Solucio.** Actualitzar a la v0.4.2 o posterior. El worker ja no demana una clau que no llegeix
--no autentica ningu-- i CI comprova que cap contenidor s'hagi reiniciat sol despres d'aixecar
l'stack. Si l'estat es un altre, el log del contenidor diu quina variable falta:
`docker compose logs worker | head -40`.

### `Applied migration changed` sense que ningu hagi tocat la migracio

**Causa.** Els checksums es calculaven sobre els bytes crus, i un checkout Windows i un Linux
discrepen sobre un fitxer identic pels finals de linia.

**Solucio.** Ja resolt: els checksums es calculen sobre contingut normalitzat
(`packages/database/src/migration-fingerprint.ts`). Si torna a apareixer, mira si algu ha
afegit un calcul de hash nou que no hi passi.

### `pnpm lint` analitza centenars de fitxers de `.next-agent`

**Simptoma.** El lint d'un workspace falla amb errors de project service sobre chunks, manifests
i tipus dins `apps/web/.next-agent`, especialment mentre `pnpm dev` continua actiu.

**Causa.** La Fase X va afegir `.next-agent` al `.gitignore`, pero no a la llista d'ignores de
flat ESLint. Ignorar un artefacte a Git no impedeix que `eslint .` el recorri.

**Solucio.** `eslint.config.mjs` ignora `**/.next-agent/**`, igual que `.next` i `.next-verify`.
No s'ha d'aturar la preview ni esborrar-ne la cache per validar codi font.

## Proves end-to-end

El procediment complet es a `DEVELOPMENT.md`, seccio "Proves end-to-end autenticades".

### Totes les mutacions responen 403 `ORIGIN_DENIED`

**Causa.** `APP_ORIGIN` i l'origen real del navegador no son la mateixa cadena. L'API compara
l'origen a cada peticio que escriu, i `http://127.0.0.1:3001` contra `http://localhost:3001`
son origens diferents encara que siguin la mateixa maquina.

**Solucio.** `APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` identics. De passada: alternar entre
`localhost` i `127.0.0.1` tambe crea contextos de cookie diferents al navegador.

### Un clic o un desplegable no fa res, i sembla que el producte estigui trencat

**Causa.** La interaccio va arribar **abans que React hidrates**. El marcatge ja hi es i es
visible, o sigui que l'espera automatica de Playwright queda satisfeta, pero encara no hi ha
cap handler connectat: l'esdeveniment es perd sense deixar rastre. Apareix i desapareix segons
com de carregada estigui la maquina, cosa que ho fa semblar un defecte del producte.

**Solucio.** `waitForHydration()` a `tests/e2e/support/fixture.ts`, que espera la clau
`__reactProps$` del control concret que es vol tocar. Per descartar-ho a ma: la mateixa accio
feta amb teclat funciona, perque per llavors ja ha hidratat.

### Un desplegable no es troba mai: `getByRole("combobox")` esgota els 15 segons

**Causa.** Aquell camp ja no es un `<select>` natiu. Un desplegable del sistema visual es un
**boto** amb `aria-haspopup="listbox"` al costat d'un `<select>` amagat que nomes porta el valor
del formulari, i aquell `<select>` es `aria-hidden`, o sigui que **cap element de la pantalla
respon al rol `combobox`**. El localitzador espera un control que ja no existeix mentre el camp
es alli, ben visible, i sembla que el producte estigui trencat.

**Solucio.** Localitza'l pel nom accessible: `getByLabel("Estat", { exact: true })` arriba al
boto pel seu `aria-label`. Dues coses a vigilar:

- **El `<label>` embolcallat no serveix.** Per a un `<select>` embolcallat, el text que Playwright
  compara inclou totes les opcions ("ClientFar Harbour LogisticsTramuntana Foods…"), aixi que cap
  coincidencia exacta amb "Client" hi encerta. El control ha de portar `aria-label` propi — si no
  en te, tampoc te nom per a qui fa servir un lector de pantalla, i el que s'ha d'arreglar es la
  pantalla.
- **Un `aria-label` repetit fa fallar el mode estricte.** A la fitxa d'un ticket, l'`aside` de
  metadades i el desplegable d'estat es diuen tots dos "Estat"; cal buscar dins de
  `aside.ticket-meta` i no a tota la pagina.

- **Trobar-lo no es prou: tampoc s'hi pot fer `selectOption`.** El localitzador arriba al boto, i
  `selectOption` hi respon `Element is not a <select> element`. Fes servir l'ajudant
  `selectFieldOption` de `tests/e2e/support/fixture.ts`, que reconeix les dues formes: si es un
  `<select>` natiu el fa servir, i si no, obre el boto i clica l'opcio pel seu text.

Ho va destapar la migracio de tots els `<select>` natius a `SelectControl`, que va canviar els
components sense tocar cap prova: `pnpm check` passava sencer i la suite E2E queia en dos tests
de suport. Es l'unica porta que ho veu.

### Les entrades comencen a fallar a mitja tanda

**Causa.** Les rutes de credencials estan limitades a **deu peticions per minut i per adreca**.
Es la defensa contra forca bruta i no es toca.

**Solucio.** Compta les entrades. Una tanda completa en gasta cinc: dues al projecte `setup` i
tres a `sign-in.authenticated.spec.ts`. Si n'afegeixes, reutilitza l'estat de sessio en comptes
d'entrar de nou.

**El seed tambe compta.** `pnpm db:seed:e2e` entra, activa el segon factor i el verifica, o
sigui que gasta unes quantes peticions de la mateixa quota i des de la mateixa adreca.
Encadenar el seed i la tanda deixa `sign-in.authenticated.spec.ts` sense pressupost: es queda a
`/ca/login` amb el codi correcte i sembla que l'MFA s'hagi trencat. Deixa passar un minut entre
el seed i `pnpm test:e2e:authenticated`. Per descartar-ho, executa nomes aquell test
(`--grep "second factor"`): si passa sol, era la quota.

### El seed end-to-end falla amb `Invalid email or password`

**Causa.** El compte ja existeix a la base `_e2e` d'una tanda anterior, i el seed hi entra amb
la contrasenya que li dones ara. La d'abans nomes vivia a `E2E_CREDENTIALS_FILE`, i si aquell
fitxer ja no hi es no la recuperara ningu.

**Solucio.** Dona-li un `E2E_OWNER_EMAIL` i un `E2E_TENANT_SLUG` nous i el seed crea el compte
des de zero. No cal esborrar res: la base `_e2e` admet mes d'un compte de prova.

### Les captures visuals fallen a CI pero passen localment

**Causa.** Les baselines estan compromeses amb sufix `-win32`, generades en una maquina de
desenvolupament. Un runner Linux renderitza el text diferent.

**Solucio.** Per aixo CI exclou `@visual`. Portar-les a CI vol dir generar baselines Linux en
un contenidor primer.

## Proves d'integracio

### Un test passa localment i falla a CI amb un comptador diferent

**Causa.** Totes les suites d'integracio comparteixen **una sola base de dades**, i turbo
executa els paquets **en paral·lel**. Qualsevol assercio sobre estat global depen de quina
suite hagi corregut abans o alhora. Va passar amb l'escombrada d'escalats: assertia
`recorded === 1` sobre un comptador que recorre tots els tenants, i a CI en trobava dos.

**Solucio.** No assertis mai sobre estat global. Acota't a les dades que el test ha creat: el
seu tenant, el seu ticket. Si de veritat necessites provar un comptador global, el paquet
necessita una base propia, no la compartida.

### Escriure a una columna `jsonb` viola un `check` que hauria de passar

**Simptoma.** Un `check (jsonb_typeof(config) = 'object')` rebutja un objecte que evidentment
n'es un. El mateix `insert` executat a `psql` amb el mateix text funciona.

**Causa.** `${JSON.stringify(valor)}::jsonb`. El cast explicit fa que PostgreSQL declari el
parametre com a `jsonb`, i llavors postgres.js torna a serialitzar la cadena que ja li havies
serialitzat. El que arriba no es l'objecte sino la seva representacio com a **cadena** JSON, i
`jsonb_typeof` respon `string`.

**Solucio.** `${tx.json(valor)}`, que es el que fa la resta del repositori. El driver serialitza
una vegada i el tipus del parametre queda correcte sense cap cast.

## Seguretat i CI

### Gitleaks marca una constant que no es cap credencial

**Causa.** La regla `generic-api-key` es d'entropia: no distingeix una clau d'una constant
publicada. Va passar amb el vector de prova de la RFC 6238 a `tests/e2e/totp.spec.ts`.

**Solucio.** `// gitleaks:allow` a la linia concreta, amb un comentari que expliqui per que no
es un secret. **Mai** un allowlist a `.gitleaks.toml` que tot el repositori heretaria: aixo
canvia el que el scanner deixa de mirar per sempre.

Quan una release compara contra una branca antiga, Gitleaks tambe recorre el commit anterior al
comentari. En aquest cas s'afegeix nomes el fingerprint historic exacte a `.gitleaksignore`; no
s'exclou el fitxer ni la regla, i qualsevol deteccio nova continua bloquejant CI.

### Una accio de GitHub avisa que Node 20 esta obsolet

**Causa.** GitHub retira Node 20 dels runners. El 16 de setembre de 2026 desapareix del tot i
les accions que el declaren deixen de funcionar.

**Solucio.** Dependabot obre la PR d'actualitzacio. Fusiona-la. Comprova a la PR que el job
afectat passa abans, que es gratis: el CI de la PR ja corre sobre el codi real.

## Web i build

### `next build` falla amb `Module not found: Can't resolve './flags.js'`

**Causa.** Els paquets del workspace exporten TypeScript cru (`"exports": "./src/index.ts"`) i
els seus imports relatius porten l'extensio `.js` de l'ESM de TypeScript. Els consumidors que
passen per tsup ho resolen; Turbopack, no. Mentre el paquet va ser un sol fitxer ningu ho va
notar: el primer que en va tenir dos (`@control-hub/config`, amb `flags.ts`) va trencar el
build del web, i no el de l'API.

**Solucio.** Dona-li un subcami propi al fitxer, i que el web l'importi directament:

```json
"exports": { ".": "./src/index.ts", "./flags": "./src/flags.ts" }
```

De passada estalvia arrossegar zod cap al web, que no el necessita per llegir una flag.

**Ha tornat a passar.** L'11 d'agost de 2026, amb `@control-hub/contracts`: l'increment 7 de la
Fase 6 hi va afegir `connector-jobs.ts` i el va reexportar des de l'arrel, i el web importa
aquest paquet per l'arrel (`parseCsv`). Mateixa solucio, subcami `./jobs`, i l'API i el worker
importen els noms de feina d'alla. **La regla, per no descobrir-ho una tercera vegada:** el
fitxer arrel d'un paquet que el web importa per l'arrel no pot tenir imports relatius. Es veu
nomes amb `pnpm build` — `typecheck`, `test` i `lint` passen tots tres amb el build trencat.

### La pantalla de projectes respon 404 i el menu no la mostra

**Causa.** `projects_and_time` esta apagada. Amb la flag avall l'API no declara ni tan sols les
rutes, aixi que no es un 403: no hi ha res alla.

**Solucio.** Per ordre, perque son tres causes diferents amb el mateix simptoma:

1. `CONTROL_HUB_FLAGS=projects_and_time` a `.env`.
2. **La variable ha d'estar declarada a `globalEnv` de `turbo.json`.** Turbo 2 corre en mode
   `envMode: strict` i **nomes passa a les tasques les variables declarades**: una variable que
   hi ha al `.env` i no a `turbo.json` no arriba mai al proces, i `pnpm dev` arrenca l'API i el
   web amb la flag apagada sense dir res. Es la causa mes cara de trobar, perque tot sembla ben
   configurat. Per comprovar-ho sense arrencar res:

   ```bash
   pnpm exec turbo run build --filter=@control-hub/api --dry=json
   ```

   La variable ha de sortir a `globalCacheInputs.environmentVariables.specified.env` i, si esta
   posada a l'entorn, tambe a `configured`.
3. **Reinicia els serveis.** Un `pnpm dev` que ja corria quan es va afegir la variable no la te,
   i no la recollira sol.

Si el nom hi es i tot i aixi no funciona, mira el log d'arrencada de l'API: avisa dels noms que
no estan declarats a `packages/config/src/flags.ts`.

**Per que no ho van veure les proves.** Els E2E arrenquen els serveis amb
`pnpm --filter @control-hub/api dev` des de `playwright.config.ts`, saltant-se Turbo, i per tant
hereten l'entorn del shell sencer. Una variable que falti a `turbo.json` passa desapercebuda a
tota la suite i nomes es nota amb `pnpm dev`. Quan afegeixis una variable d'entorn, comprova-la
amb `pnpm dev`, no nomes amb les proves.

### Una entrada de menu apareix a unes pantalles i a d'altres no

**Causa.** Algu ha resolt la flag dins d'un component de client. `process.env` no hi es al
navegador, i la resposta es "apagada" en comptes d'un error. Va passar amb
`/{locale}/security`, que es l'unica pantalla que es un component de client sencer.

**Solucio.** Les flags es resolen **una vegada al layout arrel**, que es servidor, i baixen per
context (`components/feature-provider.tsx`). Cap component de client les llegeix de l'entorn.

### Totes les rutes responen 404, fins i tot `/ca/login`

**Simptoma.** El servidor diu `✓ Ready`, l'API va be, i tota pagina sota `/{locale}` respon 404.
Sembla que s'hagi trencat el routing.

**Com saber que no es el codi.** Prova `/ca/login`: no crida `notFound()` enlloc. Si aquella
tambe fa 404, el segment `[locale]` no s'esta resolent i el problema no es de cap pagina.

**Causa.** La cache de `.next` ha quedat en un estat incoherent. Passa arrencant i aturant
servidors de desenvolupament repetidament, canviant de branca amb el servidor viu, o mesclant un
`pnpm dev` de l'arrel amb un `pnpm --filter @control-hub/web dev`: cadascun escriu al mateix
directori i el manifest de rutes es queda a mitges.

**Solucio.** Atura els processos i esborra **`apps/web/.next` sencera**, no nomes `.next/types`
ni `.next/dev`. Torna a arrencar; el primer arrencatge triga mes perque recompila tot.

Relacionat: canviar de branca amb el servidor viu tambe deixa `.next/types/validator.ts`
referenciant pagines que a la branca nova no existeixen, i llavors `pnpm typecheck` falla amb
`Cannot find module '.../page.js'` sense que el codi tingui res.

### Cada canvi al codi et treu del producte i et porta a login

**Causa.** `requireSession` tractava igual dues coses diferents: que l'API digui que la sessio no
val, i que l'API no respongui. Amb `catch { authenticated = false }`, una connexio refusada
acabava en una redireccio a login. I l'API es reinicia sola a cada edicio d'un fitxer seu
(`tsx watch`), aixi que qualsevol navegacio dins d'aquella finestra de dos segons et feia fora
amb la sessio perfectament valida a PostgreSQL. Es veia a la taula `session`: quatre files noves
en trenta-cinc minuts, cada una un login que ningu necessitava fer.

**Solucio.** Tres respostes en comptes de dues. Nomes una negativa que l'API hagi donat de debo
porta a login; una connexio refusada, un 5xx o un cos illegible llancen `ApiUnreachableError`, i
`app/[locale]/error.tsx` mostra que el servei no respon amb un boto de tornar a provar. La sessio
no es toca.

**Com comprovar-ho sense esperar que passi.** Arrenca nomes el web (`pnpm --filter
@control-hub/web dev`, sense API) i demana una pagina protegida amb una cookie qualsevol: ha de
sortir l'avis, no el formulari d'entrada. Hi ha set tests a
`apps/web/src/lib/require-session.test.ts` que fixen la regla.

### Un canvi a un paquet del workspace no es veu al navegador fins que recarregues

**Simptoma.** Edites un text a `packages/i18n` o un component a `packages/ui` i `localhost:3001`
no canvia. Un canvi dins d'`apps/web`, en canvi, apareix a l'instant. Sembla que l'HMR estigui
trencat, i no ho esta: la consola diu `[HMR] connected`.

**Prova per confirmar-ho** (dos canvis identics en llocs diferents):

1. Canvia un text de `packages/i18n/src/index.ts` → el navegador no es mou.
2. Canvia un literal de qualsevol fitxer d'`apps/web` → apareix a l'instant, i **de retruc**
   apareix tambe el canvi de l'i18n, perque la recompilacio l'ha arrossegat.

**Causa.** Turbopack infereix la seva arrel a `apps/web` i no vigila res per damunt.

**El que NO funciona.** Posar `turbopack: { root: <arrel del monorepo> }` a `next.config.ts`.
Sembla la solucio evident i **trenca l'aplicacio**: canviar l'arrel canvia la resolucio de
moduls, i amb la disposicio aillada de pnpm els paquets que viuen a `apps/web/node_modules`
deixen de trobar-se. El simptoma es `Cannot find module '@fontsource-variable/hanken-grotesk'`,
respostes 500 i peticions de quatre minuts. Si algu ho prova, cal revertir-ho **i esborrar
`apps/web/.next/dev`**, perque la cache que ha escrit la configuracio trencada sobreviu al
canvi i el servidor continua fallant amb la config ja arreglada.

**Estat.** Sense solucio aplicada. La convivencia actual es recarregar el navegador quan es toca
un paquet del workspace. Val la pena tornar-hi despres d'actualitzar a Next 16.3, que reescriu
el watcher i la cache de disc de Turbopack.

## Entorn de desenvolupament a Windows

### `pnpm format:check` falla en fitxers que no has tocat

**Resolt el 12 d'agost de 2026.** Es deixa escrit perque el que el va causar es facil de tornar a
fer sense adonar-se.

**Causa.** Els finals de linia tenien dos amos que no es posaven d'acord. `.gitattributes` diu
`text=auto`, aixi que el repositori guarda LF i un checkout de Windows escriu CRLF; i
`prettier.config.mjs` deia `endOfLine: "lf"`. Resultat: `format:check` vermell **a tots els
fitxers del repositori**, haguessis tocat el que haguessis tocat.

**Que es va fer.** `endOfLine: "auto"` a `prettier.config.mjs`. Git ja normalitza els finals de
linia i es qui te aquesta feina; Prettier hi tornava a opinar amb una altra resposta. De 305
fitxers en vermell es va passar a 10 violacions reals -- una llista amb tres-cents falsos positius
no la mira ningu, i aquelles deu van viure amagades tota la Fase 6.

**No hi tornis a posar `lf`.** Si algun dia es vol LF tambe al working tree de Windows, el lloc es
`.gitattributes` (`* text=auto eol=lf`) i cal renormalitzar el checkout; no el formatador.

### Totes les pagines responen 500 amb `ECONNREFUSED` i sembla que el codi estigui trencat

**Simptoma.** El web arrenca perfectament (`Ready in 1.4s`), i despres cada pagina peta amb
`API_UNREACHABLE` i un `ECONNREFUSED 127.0.0.1:4000` al mig d'un stack trace de `requireSession`.

**Causa.** Gairebé sempre, **Docker Desktop no s'esta executant**, aixi que no hi ha ni PostgreSQL
ni Valkey. L'API arrenca igualment -- `/health/live` respon 200 -- pero no pot fer res. La pista
bona no es a la consola del web sino aqui:

```bash
curl -s http://127.0.0.1:4000/health/ready
```

Amb `{"status":"not_ready", ... "postgres":{"status":"down"}}` ja no cal buscar res mes al codi.

Un segon `ECONNREFUSED` al 4000 pot ser una altra cosa i no s'ha de confondre: si apareix nomes
durant els primers segons, es que el web ha demanat la sessio abans que l'API acabes d'arrencar, i
desapareix sol.

**Solucio.** Obrir Docker Desktop, esperar que digui que esta en marxa, i `pnpm infra:up`. O
directament `pnpm dev:all`, que aixeca la infraestructura, migra i despres arrenca.

**Ja no hauria de tornar a passar sense avis:** `pnpm dev` executa abans `scripts/check-infra.mjs`,
que comprova que Docker respon i que els contenidors hi son, i si no s'atura amb un missatge que
diu que fer. Nomes informa; no engega res sol, perque un script que arregla coses en silenci es un
script que amaga que les ha arreglat.

### Next.js peta amb `range start index ... out of range for slice`

**Causa.** La cache persistent de Turbopack s'ha corromput. No te res a veure amb el codi.

**Solucio.** `rm -rf apps/web/.next` i torna-ho a executar.

### Una ordre `docker exec` amb heredoc no fa res i no es queixa

**Causa.** `docker exec` sense `-i` no connecta stdin. `psql` no rep res, acaba sense error, i
sembla que l'SQL s'hagi executat.

**Solucio.** `docker exec -i`. I comprova sempre el resultat (`select count(*)`) abans de
concloure res a partir d'aquella ordre: aixo va invalidar una reproduccio sencera d'un error.

### `apps/web/next-env.d.ts` surt modificat despres de `pnpm dev:verify`

**Causa.** Next escriu aquest fitxer amb el `distDir` que esta fent servir. L'stack de verificacio
fa servir `.next-verify`, aixi que el reescriu apuntant-hi. No es un canvi teu i no ha d'anar a cap
commit: si hi va, el `typecheck` de qualsevol altre desenvolupador apunta a un directori que ell no
te construit.

**Solucio.** `git checkout -- apps/web/next-env.d.ts` en acabar. Un `pnpm dev` normal el torna a
escriure be tot sol, pero convé revertir-lo abans de fer commit i no despres.

### El primer intent d'una prova E2E passa i el reintent falla

**Simptoma.** CI en vermell amb `Expected "new", Received "open"`. El primer intent havia fet
exactament la seva feina; el reintent troba el ticket ja obert i no pot tornar a obrir-lo.

**Causa.** La prova mutava una fila sembrada, i el moviment no te tornada: `new` a `open` es
irreversible i un responsable no es pot treure des de la pantalla. **Un reintent passa dins de la
mateixa execucio, molt despres del seed**, aixi que tornar a sembrar abans de cada tanda no ho
arregla: nomes amaga el problema fins que alguna cosa provoca el primer reintent.

**Solucio.** Ja resolt: les proves que muten obren el seu propi ticket pel dialeg real
(`createTicket` a `support.authenticated.spec.ts`), com les de projectes i barems ja feien. La
regla, que val per a tota prova nova: **res del que sembra `seed-e2e.ts` es muta**, i cap prova
depen de l'estat que hagi deixat una altra passada ni el seu propi primer intent. Ara el suite es
pot correr dos cops seguits sense sembrar entremig, i aixo es el que s'ha de comprovar abans de
donar per bona una prova nova.

### Una prova E2E passa o falla segons quin worker acabi primer

**Simptoma.** `projects.authenticated.spec.ts` esperava `imputacions sense valorar` i rebia
`Cap barem publicat`. Marcada com a *flaky*: al reintent passava.

**Causa.** CI corre amb dos workers sobre **una sola base de dades**. La suite de barems publica un
cost per l'unica persona del tenant, i aquell cost val per a tots els projectes des del seu dia
d'efecte. Mentre no ho ha fet, la fitxa d'un projecte no pot valorar res i el tile ho diu d'una
manera; despres, les hores tenen cost pero encara no preu de venda, i ho diu d'una altra. Quin dels
dos textos surt no depen del producte, sino de quin worker acaba primer.

**Solucio.** Assertar el que es cert sota les dues lectures -- que les hores sense valorar
s'avisen, en comptes de comptar-se com a gratis -- i no la redaccio concreta d'una de les dues.
Quan una prova toqui estat compartit entre suites, pregunta't que passa si l'altra suite encara no
ha corregut.

### Un desplegable no envia res despres d'un `page.reload()`

**Simptoma.** `page.waitForResponse` esgota el temps de la prova esperant una peticio que no s'ha
arribat a fer mai. La pantalla, a la captura, es perfecta.

**Causa.** El mateix defecte d'hidratacio de sempre, pero amagat en un bucle: `waitForHydration` es
cridava **un sol cop abans del bucle**, i cada `reload` reemplaça l'element. La segona volta actua
sobre marcatge acabat de servir i sense cap handler encara, el desplegable es mou i React no
se n'assabenta.

**Solucio.** Tornar a agafar el localitzador i tornar a esperar la hidratacio **dins** del bucle,
despres de cada recarrega. Un localitzador de Playwright es una consulta, no un element: sobreviu a
la recarrega i per aixo no es queixa.

### `Applied migration changed` a una base local d'usar i llencar

**Causa.** Diferent de la de CI d'aqui dalt: aqui la migracio **si** que ha canviat. Passa quan
s'aplica una migracio mentre encara s'esta escrivint i despres s'edita el fitxer. La base es queda
amb un esquema que ja no es el que descriu el repositori.

**Solucio.** Recrear la base d'usar i llencar (`drop database ... with (force)`, `create database`)
i tornar a migrar. Per a la de verificacio, despres `pnpm db:migrate:verify` i `pnpm db:seed:verify`.
**No reparar el checksum a ma:** deixaria una base que diu que te aplicada una migracio que no te, i
el seguent que hi verifiqui res verificara contra un esquema que CI no tindra mai.

**El migrador s'atura a la primera discrepancia**, aixi que la base es queda tambe sense cap de les
migracions posteriors. `control_hub_test` va estar des del 7 fins a l'11 d'agost amb la `0018` mal
aplicada i dotze migracions sense aplicar. Localment aixo pot passar desapercebut molt de temps: les
suites d'integracio se salten soles quan no hi ha `TEST_DATABASE_URL`, i qui no les exporta no veu
mai que la base ha quedat enrere. Val la pena comprovar de tant en tant que el recompte de
`schema_migrations` coincideix amb el nombre de fitxers a `packages/database/migrations`:

```bash
docker exec control-hub-postgres-1 psql -U control_hub_admin -d control_hub_test -c "select count(*) from schema_migrations;"
```

### Una tanda verda que no ha provat res del que creus

**Simptoma.** `pnpm test` acaba verd i el recompte diu «passades» i «saltades» sense mes. Les
proves que toquen l'esquema, l'RLS i l'aillament entre tenants son a les saltades, i alli hi poden
estar mesos sense que ningu ho noti: una suite saltada no es vermella.

**Causa.** Les suites d'integracio se salten soles quan no hi ha `TEST_DATABASE_URL`. Es
deliberat —no tothom te la base aixecada— i te el cost que la porta sembla mes verda del que es.

**Que fer.** Exportar les dues variables i tornar-hi. A PowerShell, en una sola linia:

```text
$env:TEST_DATABASE_URL="postgres://control_hub_app:local_only@127.0.0.1:55434/control_hub_test"; $env:TEST_DATABASE_ADMIN_URL="postgres://control_hub_admin:local_admin_only@127.0.0.1:55434/control_hub_test"; pnpm test
```

Amb les dues posades no s'ha de saltar res: **1.413 proves, cap saltada**, el 23 d'agost de 2026.
Si en surten de saltades, les variables no han arribat a `vitest`.

**Abans, la base ha d'estar al dia**, i normalment no ho esta: ni el migrador de desenvolupament
ni el de verificacio la toquen. Es migra apuntant el migrador a la base de test:

```text
MIGRATION_DATABASE_URL="postgres://control_hub_admin:local_admin_only@127.0.0.1:55434/control_hub_test" pnpm --filter @control-hub/database migrate
```

El 23 d'agost de 2026 estava a la `0039` amb sis migracions per aplicar. La comprovacio rapida de
si ha quedat enrere es la de l'apartat anterior: comparar el recompte de `schema_migrations` amb el
nombre de fitxers de `packages/database/migrations`.

### Correr el suite autenticat contra la pila de verificacio

No es cap error, pero costa de reconstruir cada vegada. Amb `pnpm dev:verify` aixecat a 3002:

```bash
PLAYWRIGHT_BASE_URL="http://127.0.0.1:3002" E2E_CREDENTIALS_FILE="$PWD/.e2e/verify-credentials.json" pnpm test:e2e:authenticated
```

Les dues variables han d'anar juntes: la primera perque `APP_ORIGIN` de `.env.verify` es
`http://127.0.0.1:3002` i han de ser la mateixa cadena, i la segona perque el fitxer de credencials
de la pila de verificacio no es el de `.e2e/credentials.json`. Per repetir una prova concreta sense
tornar a passar pel segon factor, `--project authenticated --no-deps` reaprofita la sessio ja
guardada.

### Una prova E2E espera dos minuts un element que no pot existir

**Simptoma.** A CI, `waiting for locator('.clock-control') to be visible` fins a esgotar el temps,
tres vegades per reintent, i el log no diu res mes. En local passa.

**Causa.** El modul esta darrere una flag i **la flag no hi era a CI**. Sense ella l'API no declara
les rutes, `/api/v1/attendance/me` respon 404, el layout no rep estat i no dibuixa el control. La
prova espera un element que no pot arribar mai.

Va costar una tanda sencera perque el fitxer de CI **es va editar i el canvi no va entrar al
commit**, i no ho vaig comprovar. Un `git add -A` no es una verificacio.

**Solucio.** Dues:

1. `git show <branca>:<fitxer>` despres de fer commit, quan el canvi es el que decideix si una
   feina funciona. La copia de treball i el que hi ha a la branca no son el mateix.
2. Les proves d'un modul darrere una flag comproven **primer** que la ruta hi es, i fallen amb el
   nom de la variable que falta. Un minut de diagnosi en comptes de sis d'espera.

### Una edicio valida torna `INVALID_INPUT` despres de crear el registre

**Simptoma.** L'alta d'una despesa recurrent respon `201`, pero editar-ne nomes el nom respon
`400 INVALID_INPUT`. El payload del `PATCH` es valid i els camps visibles tenen el tipus esperat.

**Causa.** `amount_minor` es un `bigint`. El driver de PostgreSQL el retorna com a text per no
perdre precisio, mentre que el repositori el declarava com a `number` sense convertir-lo. El cas
d'us recompon el contracte complet abans d'editar i `Number.isSafeInteger` rebutja aquest text.

**Solucio.** Normalitzar el tipus a la frontera de persistencia amb
`amount_minor::float8 as "amountMinor"`. La restriccio de la columna ja limita el valor a
`Number.MAX_SAFE_INTEGER`, per tant la conversio es exacta dins el domini admès. La prova
d'integracio ha d'assertar també `typeof created.amountMinor === "number"`; un generic TypeScript
sobre la consulta no converteix el valor en execucio.

### El camp «Compte o correu» rebutja un usuari de plataforma valid

**Simptoma.** Editar una despesa amb un identificador com `workspace-admin` mostra l'error generic,
tot i que l'especificacio permet un correu o un usuari.

**Causa.** La UI usava `type="email"`, l'esquema HTTP exigia `format: "email"` i el cas d'us
aplicava una expressio regular de correu. Les tres capes contradeien COM-3 i el nom visible del camp.

**Solucio.** Tractar-lo com un identificador opac: retallar espais exteriors, conservar majuscules i
limitar-lo a 320 caracters, sense exigir sintaxi de correu. L'E2E ha d'editar-lo amb un usuari que no
sigui email i comprovar el valor renderitzat; provar nomes el nom del servei no cobreix el contracte.

### Una prova de metriques canvia de resultat entre Windows i CI

**Simptoma.** `financialSummary` retorna imports diferents dels esperats nomes al runner Linux,
tot i que cada fila i el calcul son correctes.

**Causa.** La prova triava `catalog.plans[0]` i `catalog.prices[0]` despres d'haver creat mes d'una
oferta. La consulta no promet ordre i PostgreSQL pot retornar qualsevol fila primer; el resultat
depenia del pla d'execucio, no del sistema operatiu.

**Solucio.** Les proves seleccionen la dada que han creat mitjancant una identitat o propietat
estable i relacionen el pla pel seu `planId`. Mai s'utilitza la primera fila d'una consulta sense
`ORDER BY` com si fos part del contracte.

### Una accio nova respon «La operacio no s'ha pogut completar» a la base de desenvolupament

**Simptoma.** L'esborrat d'una integracio fallava a `control_hub` amb el missatge generic, mentre
que el test d'integracio i l'E2E passaven tots dos.

**Causa.** Les tres bases locals no van al mateix ritme. `pnpm db:migrate:verify` migra la de
verificacio i les suites d'integracio migren `control_hub_test`, pero **cap de les dues toca
`control_hub`**, que es la que fa servir `pnpm dev`. La `0036` obre l'unic privilegi de `delete`
sobre `connector_instances`; sense aplicar-la, PostgreSQL refusa la sentencia, l'API respon 500 i
la pantalla mostra la frase generica —que es el que ha de fer: no filtra que ha dit la base.

**Que enganya.** Que les proves passin **no diu res** sobre la base de desenvolupament. Son bases
diferents i el migrador no es global. El recompte de `schema_migrations` es el que ho desmenteix:

```bash
docker exec control-hub-postgres-1 psql -U control_hub_admin -d control_hub -tAc "select name from schema_migrations order by name desc limit 1;"
```

**Solucio.** `pnpm db:migrate` (sense sufix) i tornar a aixecar `pnpm dev`. La comprovacio que
tanca el diagnostic, i que val per a qualsevol migracio que nomes reparteixi privilegis, es
preguntar-los directament en comptes de deduir-los del fitxer:

```bash
docker exec control-hub-postgres-1 psql -U control_hub_admin -d control_hub -tAc "select has_table_privilege('control_hub_app','connector_instances','delete');"
```

**La regla.** Quan una migracio nova nomes canvia permisos, afegir-la al repositori no la fa
efectiva enlloc. Despres d'escriure-la, migra les tres bases o assumeix que la de desenvolupament
et mentira a la primera prova manual.
### Una maquina declarada diu «no respon» i no en dira mai res mes

**Simptoma.** Una maquina acabada de declarar surt amb «No respon / Cap lectura» i no canvia mai,
mentre el recollidor passa cada dos minuts i les altres maquines si que ensenyen xifres.

**Causa.** El que es va declarar no es una maquina. Les xifres d'una maquina venen de
`pull_host_metrics`, que desa un registre `host:<etiqueta>`; si l'etiqueta declarada no es la d'un
`node_exporter`, no hi haura mai cap registre que hi casi. El cas real va ser una URL sondejada amb
blackbox (`https://.../storage/v1/version`) declarada com a maquina des del panell de descobriment.

**Com reconeixer-ho.** Mira si el recollidor te cap lectura de maquina amb aquella etiqueta:

```bash
docker exec control-hub-postgres-1 psql "$DATABASE_URL" -c "select external_id from connector_records where external_id like 'host:%'"
```

Si l'etiqueta declarada no hi es, la fitxa no s'encendra per molt que s'esperi.

**Solucio.** Allo no era una maquina, era un **servei**: declara'l al selector de serveis de la
maquina que el serveix, amb la clau sencera (`probe:https://...`). La fitxa sobrera **no es pot
esborrar des del producte** —no hi ha ruta per fer-ho, a proposit— aixi que de moment cal treure la
fila d'`infra_hosts` a ma.

**La regla.** Una pantalla que ofereix per declarar coses que despres no poden encendre's es pitjor
que una que no ofereix res: fabrica fitxes mortes que despres ningu pot retirar. Si una llista
proposa, ha de proposar nomes el que el magatzem pot arribar a casar.

### La comprovacio guiada diu "reachable" quan la credencial falta

**Simptoma.** La comprovacio guiada d'una integracio n8n (o qualsevol que no sigui Prometheus)
mostra la cadena completa amb l'esglaó `answers` tractat com a "passat", quan en realitat la
integracio no pot ni comencar perque li falta l'API key o la configuracio basica. A mes, el text
de l'esglaó `answers` es el de Prometheus en comptes del del connector real.

**Causa.** L'esglaó `answers_prometheus` era un catch-all per a tots els errors de xarxa que no
eren `UNREACHABLE`, `NETWORK_DNS`, etc. Quan n8n llencava `CREDENTIAL_MISSING` (no podia
construir la crida perque faltava `api_token`), el codi el classificava com a "respostes
obtingudes" en comptes de "no es pot intentar". Això feia dues coses falses: (1) la cadena
tractava la fallada com a evidencia de connectivitat, i (2) el text del panell era el de
Prometheus.

**Solucio.** Esglaó nou `prepared` abans de `reachable`, amb el seu propi vocabulari
(`CREDENTIAL_MISSING`, `INVALID_CONFIG`, `OPERATION_NOT_DECLARED`). El text de l'esglaó
`answers` ara es generic o especific per connector (n8n, Prometheus) segons `connectorType` de
la instancia. Els rungs de scraping/matching nomes s'emeten per `connectorType === "prometheus"`,
perque les consultes PromQL i el parseig de registres son especifics de Prometheus.

Per verificar-ho: crea una instancia n8n sense API key, activa-la, i demana la comprovacio guiada.
L'esglaó `prepared` ha de mostrar l'error i el text d'n8n, i `reachable` no ha d'apareixer.

### Una variable del `.env` no te el valor que hi has escrit

**Simptoma.** Cada passada d'un connector mor amb `DESTINATION_NOT_ALLOWLISTED` contra una adreca
que es a `CONNECTOR_INTERNAL_ALLOWLIST`. La linia hi es, escrita be, i el reinici no canvia res.

**Causa.** La variable estava escrita **dues vegades** al `.env`, en linies diferents. El
`--env-file` de Node es queda l'ultima aparicio i descarta les anteriors sense dir-ho, aixi que el
valor viu era el de la segona linia i el que algu llegia al fitxer era el de la primera. Cap avis,
cap error: nomes una variable que no diu el que sembla.

**Com reconeixer-ho.** Pregunta-ho al mateix parser que ho llegeix, no al fitxer:

```bash
node --env-file=.env -e "console.log(process.env.CONNECTOR_INTERNAL_ALLOWLIST)"
```

Si el que surt no es tot el que hi ha escrit, la clau esta duplicada. `grep -n` per la clau ho
confirma en una linia.

**Solucio.** Una sola linia amb tots els origens separats per comes. L'allotja tambe la seccio 7
de `docs/runbooks/connect-a-vps.md`, que es on s'hi afegeixen maquines noves.

**La regla.** Un valor d'entorn no es comprova mirant el fitxer: es comprova preguntant-l'hi al
proces. I **la llista es llegeix un sol cop en arrencar el worker**, aixi que afegir-hi un origen
sense reiniciar tampoc no fa res.

### Un connector diu «mai comprovat, mai executat» mentre el worker el consulta cada cinc minuts

**Simptoma.** La integracio surt `Activa` i alhora `Sense comprovar / Mai`. No hi ha cap fila a
`connector_sync_runs` ni a `connector_operation_state` per a aquell connector, cap lectura a
`connector_records`, i les pantalles que en depenen diuen «Cap lectura». El worker esta amunt i
altres connectors del mateix tenant funcionen.

**Causa.** El treball peta a `startRun`, abans que existeixi la fila de run. Sense fila no hi ha
res per tancar, cap salut per registrar i cap estat d'operacio per escriure: la passada no deixa
rastre enlloc. `connector_sync_runs.job_id` tenia un `check` de 120 caracters i l'identificador el
composa BullMQ, no nosaltres: per a un treball repetitiu es
`repeat:connector:<tenant>:<instancia>:<operacio>:<timestamp>`, que amb dos UUID son 104
caracters abans del nom de l'operacio. El limit era, de fet, un limit sobre com de llarg pot
dir-se una operacio, i no ho deia enlloc. `pull_workflows` (119) i `pull_executions` (120) hi
cabien; `pull_probe_state` (121), `pull_host_metrics` (122) i `pull_container_state` (125) no.
El 23514 de PostgreSQL arriba a `mapConstraint`, que el converteix en `INVALID_INPUT`.

**Com reconeixer-ho.** El motiu de la fallada es a la cua, no a la base de dades, perque la base
no en va saber mai res:

```bash
docker exec control-hub-valkey-1 valkey-cli zrevrange bull:control-hub-connectors:failed 0 0
```

I amb l'identificador que en surt:

```bash
docker exec control-hub-valkey-1 valkey-cli hget "bull:control-hub-connectors:<id>" failedReason
```

**Solucio.** La `0040` puja el `check` a 200. Aplica-la a les tres bases: `pnpm db:migrate`,
`pnpm db:migrate:verify` i la de test.

**La regla.** Un limit de llargada sobre un valor que composa una llibreria de tercers es un limit
sobre alguna altra cosa que ningu ha escrit. Si el capem, que sigui amb marge i amb el motiu al
costat.
# OAuth torna a Integracions pero continua desconnectat

**Simptoma:** el proveidor torna amb `?oauth=connected`, l'intent queda `received`, no apareix cap
grant i l'outbox conserva `published_at = null`. Els jobs `connector-oauth-outbox` fallen amb
`Custom Id cannot contain :`.

**Causa:** BullMQ reserva `:` dins dels identificadors. El relay construia `oauth:<uuid>`; el
mateix defecte existia preventivament a `action:<uuid>`.

**Solucio:** utilitzar `oauth-<uuid>` i `action-<uuid>`. No s'ha de marcar l'outbox com publicada
abans que `Queue.add` acabi; així una passada posterior recupera automàticament els intents.

### La UI nova continua executant una consulta o un cataleg antics

**Simptoma.** La safata de correu falla amb una relacio que ja s'ha corregit al codi, o el detall
del ticket diu que no hi ha Gmail tot i que la instancia i el grant OAuth son actius.

**Causa.** API i web estaven aixecats abans d'integrar M3/M4. La base conserva l'error real
(`customer_contacts` en comptes de `contacts`) i el Server Component conserva el contracte antic
del cataleg fins que els processos de desenvolupament recompilen.

**Solucio.** Comprovar el proces viu, no nomes el fitxer: les rutes M4 han de respondre 401 sense
sessio —404 significa que el servidor encara no les te— i la consulta tenant-scoped de remitents
ha de trobar el Gmail habilitat amb grant actiu. Reiniciar API/web/worker si el watcher no ho ha
fet. El detall del ticket usa `/api/v1/support/mail-senders`, no el cataleg general d'Integracions.

### Una resposta externa desapareix en recarregar el ticket

**Simptoma.** Despres de premer `Revisar enviament` sembla que la resposta s'ha enviat, pero en
recarregar no hi ha missatge ni estat de lliurament.

**Causa.** La primera accio nomes encunya la confirmacio d'un sol us; no crea ni request, ni
delivery, ni outbox. Si `connector_action_confirmations.consumed_at` es nul i no existeix cap fila
a `connector_action_requests`, no hi ha hagut cap intent d'enviament.

**Solucio.** La UI mostra la segona decisio en un dialeg modal inequívoc. Nomes `Confirmar i
enviar` consumeix la confirmacio i crea request, missatge, delivery i outbox en una transaccio.

### Turbo reutilitza cache i logs d'un altre worktree

**Simptoma.** `turbo typecheck` diu `cache hit` en un worktree acabat de crear i els logs
reproduits contenen paths absoluts del checkout principal.

**Causa.** Turbo resol el directori Git comu dels worktrees i pot reutilitzar la seva cache. El
filesystem del codi es diferent, pero la cache per defecte no queda aillada de manera fiable.

**Solucio.** Les ordres arrel passen `--cache-dir=.turbo-workspace`. Aquest directori existeix
dins de cada worktree i esta ignorat per Git. No es retira l'opcio per estalviar temps: una cache
compartida invalida l'evidencia de quina revisio s'ha comprovat i pot filtrar paths o logs entre
tasques.

### El workspace assigna ports nous pero el web prova d'obrir 3001

**Simptoma.** El manifest i `.env` indiquen un port propi, pero `pnpm dev` falla amb
`EADDRINUSE 127.0.0.1:3001`. El worker pot fallar alhora perquè una credencial OAuth opcional es
una cadena buida.

**Causa.** Turbo funciona en mode estricte: una variable al `.env` que no sigui a `globalEnv` no
arriba al procés fill. D'altra banda, `KEY=` no es una variable absent; Zod rep una cadena buida i
la refusa si el camp opcional exigeix longitud quan existeix.

**Solucio.** `WEB_PORT` i `VERIFY_WEB_PORT` formen part de `globalEnv`. El generador de workspace
omet completament les credencials opcionals no configurades; no les escriu com a valors buits.

### Windows deixa el directori del worktree despres del cleanup

**Simptoma.** Contenidors i volums desapareixen, pero `git worktree remove` acaba amb
`Filename too long` i queda un directori orfe amb `node_modules`.

**Causa.** pnpm pot crear paths que superen el tractament historic de `MAX_PATH` de Git for
Windows. Git retira el registre del worktree abans d'acabar de suprimir tots els fitxers.

**Solucio.** El CLI recorre el target ja validat i elimina nomes una allowlist d'arbres generats:
`node_modules`, `.next*`, `.turbo*`, `dist`, coverage i reports. Tambe retira el `.env` i el
manifest `.agent` locals. Git continua sent qui elimina tot el codi versionat. No s'utilitza un
glob ni es toca cap directori pare.

### Una prova d'integracio falla amb `append-only` a la neteja, i al segon intent passa

**Simptoma.** Un `afterAll` peta amb `support history is append-only` (o el disparador equivalent
d'una altra taula) mentre les proves del mateix fitxer passen totes. Es reexecuta la mateixa feina
sense canviar res i surt verda.

**Causa.** `alter table ... disable trigger` es DDL: afecta tota la base de dades, no la sessio que
l'executa. Turbo executa `test:integration` de catorze paquets en paral·lel contra una sola
`TEST_DATABASE_URL`, aixi que el `finally` d'una altra suite pot tornar a apujar el disparador entre
el `disable` d'aquesta i el seu `delete`. Nomes pot produir vermells falsos --un disparador reactivat
fa fallar una neteja, no pot fer que una assercio d'append-only passi en silenci--, pero un CI que
falla per atzar ensenya a reexecutar sense llegir.

**Solucio.** Cap suite ho fa ja: es fa servir `set session_replication_role = 'replica'` i
`'origin'` sobre la connexio d'administracio, que val nomes per a aquella sessio. Ho guarda
`scripts/integration-teardown.test.mjs`, que falla si algu hi torna.

**Compte en fer el canvi.** `session_replication_role = 'replica'` no es equivalent a
`disable trigger`: tambe suprimeix els disparadors de clau forana, o sigui que dins d'aquella
finestra els `on delete cascade` no es disparen. Un `delete from tenants` alli deixa totes les files
filles enrere i peta despres contra la restriccio. La finestra ha de cobrir nomes els `delete` de les
taules append-only.

## Releases i desplegament

### La release gate rebutja el commit de la tag

**Simptoma.** El release workflow `release.yml` dispara el job `Required checks`, que executa
`scripts/release-gate.mjs`. El gate mira check-runs pel commit SHA de la tag, pero no en troba
totes les que calen (n'hi falten algunes de `pending` o simplement no hi son) i rebutja la
publicacio. La tag ja existeix a GitHub pero no ha publicat res.

**Causa.** `ci.yml` te `concurrency: { group: ..., cancel-in-progress: true }`. Quan es fa push
d'una tag des de `develop`, el push a `develop` dispara CI sobre el mateix commit SHA que la tag.
Si la tag es fa gairebe alhora, `cancel-in-progress` cancel·la els check-runs que ja estaven
corrent sobre aquell SHA —els mateixos que el gate busca— per reemplaçar-los pels de la tag, pero
els nous encara no han comencat o estan a cua. El gate els mira abans que existeixin i falla.

**Solucio.** Abans de fer push de la tag, crear un commit buit a `main` per donar al tag un SHA
net:

```bash
git checkout main
git commit --allow-empty -m "chore: prepare v0.4.X"
git push origin main
git tag v0.4.8
git push origin v0.4.8
```

Aixi la tag apunta a un commit de `main` que mai ha corregut CI amb `cancel-in-progress`, i el
gate troba tots els check-runs.

**Prevencio.** Si `BRANCHING.md` o el procediment de release no ja ho diu, afegir-ho: la tag
sempre ha d'apuntar a un commit de `main` que no comparteix SHA amb cap push a `develop`.

### La VPS reporta una versio antiga despres de publicar una tag nova

**Simptoma.** Despres de publicar `v0.4.8`, la VPS segueix dient `v0.4.6` (o la versio anterior)
a `/health/live`. Les imatges Docker s'han actualitzat i el codi nou hi es, pero el numero de
versio no canvia.

**Causa.** `tsup.config.ts` estampa `__API_VERSION__` llegint `package.json` al moment de
compilar el bundle (`readFileSync(new URL("package.json", import.meta.url))`). Si `package.json`
no esta actualitzat quan es construeix la imatge Docker, el bundle porta el numero de versio
antic. Aixo passa quan es fa la tag sense haver fet commit del bump de versio a `package.json`.

**Solucio.** L'ordre correcta es:

1. Actualitzar `package.json` (arrel, `apps/api`, `apps/worker`) amb la versio nova
2. Fer commit del bump
3. Fusionar a `develop` i despres a `main`
4. Fer push de la tag des de `main`

Mai fer la tag abans del bump de `package.json`. El procediment de release a
`docs/runbooks/release.md` ho ha de reflectir.

**Com comprovar-ho abans de publicar:**

```bash
# Verificar que package.json diu la versio correcta
node -e "console.log(require('./package.json').version)"
# Hauria de dir 0.4.8

# Verificar que la tag apunta al commit correcto
git log --oneline -1 v0.4.8
# Ha de ser el commit que包含 el bump de versio
```

### write() de credencials crea un slot secundari en lloc de reemplacar el primary

**Simptoma.** Despres de rotar una credencial des del panell d'Integracions, el worker continua
llegant l'antiga. La pantalla mostra la nova credencial com a activa, pero les operacions del
connector fallen amb l'error de l'antiga (token caducat, permisos insuficients, etc.).

**Causa.** `write()` a `packages/application/src/connector-credentials.ts` escrivia la credencial
nova a un slot secundari (rotacion window) en comptes de reemplacar el primary. El worker sempre
llegeix el `primary`, aixi que la nova credencial es desava pero mai es feia servir.

**Solucio.** `write()` ara crida `repository.revokeCredentials()` abans d'escriure, assegurant
que la credencial nova sempre sigui el `primary` que el worker llegeix. Les proves
`connector-credentials.test.ts` comproven el comportament de reemplacament.

**Com verificar-ho:** despres de rotar una credencial, mira a la base de dades que nomes n'hi ha
una de viva i es la nova:

```bash
docker exec control-hub-postgres-1 psql "$DATABASE_URL" \
  -c "SELECT id, slot, revoked_at FROM connector_credentials WHERE instance_id = '<id>' ORDER BY created_at DESC;"
```

Ha d'haver-hi una sola fila sense `revoked_at`.
