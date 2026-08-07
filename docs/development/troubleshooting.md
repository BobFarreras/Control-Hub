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

### `Applied migration changed` sense que ningu hagi tocat la migracio

**Causa.** Els checksums es calculaven sobre els bytes crus, i un checkout Windows i un Linux
discrepen sobre un fitxer identic pels finals de linia.

**Solucio.** Ja resolt: els checksums es calculen sobre contingut normalitzat
(`packages/database/src/migration-fingerprint.ts`). Si torna a apareixer, mira si algu ha
afegit un calcul de hash nou que no hi passi.

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

## Seguretat i CI

### Gitleaks marca una constant que no es cap credencial

**Causa.** La regla `generic-api-key` es d'entropia: no distingeix una clau d'una constant
publicada. Va passar amb el vector de prova de la RFC 6238 a `tests/e2e/totp.spec.ts`.

**Solucio.** `// gitleaks:allow` a la linia concreta, amb un comentari que expliqui per que no
es un secret. **Mai** un allowlist a `.gitleaks.toml` que tot el repositori heretaria: aixo
canvia el que el scanner deixa de mirar per sempre.

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

**Causa.** `core.autocrlf=true` fa el checkout amb CRLF i Prettier espera LF. Falla per a tot
el repositori, hagis tocat el que hagis tocat.

**Solucio.** No executis `prettier --write .`: generaries un diff de centenars de fitxers. Per
comprovar els teus, compara ignorant els finals de linia:

```bash
diff <(pnpm exec prettier "$f" | tr -d '\r') <(cat "$f" | tr -d '\r')
```

CI corre sobre Linux i es l'autoritat sobre el format.

**Comparar nomes els fitxers que tens modificats ara no n'hi ha prou.** Un fitxer que has creat en
un commit anterior de la mateixa sessio ja no surt a `git diff`, i CI el continua veient. La
comprovacio local equivalent a la de CI es intersecar les dues llistes: agafar tot el que Prettier
marca i quedar-te nomes amb el que tambe difereix ignorant els finals de linia.

```bash
pnpm exec prettier --list-different . | tr -d '' | while read -r f; do
  diff -q <(pnpm exec prettier "$f" | tr -d '') <(tr -d '' < "$f") >/dev/null || echo "$f"
done
```

Sobre aquest repositori, la primera llista te 71 fitxers i la segona n'hauria de tenir zero. Aixo va
costar un CI en vermell despres d'haver dit que estava en verd.

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

### `Applied migration changed` a la base de verificacio local

**Causa.** Diferent de la de CI d'aqui dalt: aqui la migracio **si** que ha canviat. Passa quan
s'aplica una migracio mentre encara s'esta escrivint i despres s'edita el fitxer. La base es queda
amb un esquema que ja no es el que descriu el repositori.

**Solucio.** Recrear la base d'usar i llencar (`drop database ... with (force)`, `create database`),
`pnpm db:migrate:verify` i `pnpm db:seed:verify`. **No reparar el checksum a ma:** deixaria una base
que diu que te aplicada una migracio que no te, i el seguent que hi verifiqui res verificara contra
un esquema que CI no tindra mai.

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
