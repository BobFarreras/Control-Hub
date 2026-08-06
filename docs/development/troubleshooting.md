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

### Next.js peta amb `range start index ... out of range for slice`

**Causa.** La cache persistent de Turbopack s'ha corromput. No te res a veure amb el codi.

**Solucio.** `rm -rf apps/web/.next` i torna-ho a executar.

### Una ordre `docker exec` amb heredoc no fa res i no es queixa

**Causa.** `docker exec` sense `-i` no connecta stdin. `psql` no rep res, acaba sense error, i
sembla que l'SQL s'hagi executat.

**Solucio.** `docker exec -i`. I comprova sempre el resultat (`select count(*)`) abans de
concloure res a partir d'aquella ordre: aixo va invalidar una reproduccio sencera d'un error.
