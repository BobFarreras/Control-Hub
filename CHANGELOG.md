# Changelog

Les versions segueixen [SemVer](https://semver.org/lang/ca/). Aquest fitxer diu **que ha canviat
per a qui fa servir el producte**; el relat tecnic de com s'hi ha arribat es a
`docs/development/history/` i el punt de continuacio a `docs/development/current-state.md`.

## v0.4.4 - 2026-08-28

### Millores

- **`update.sh` actualitza `CONTROL_HUB_FLAGS` automàticament**: Si el `.env` té el default antic (`projects_and_time`), l'actualització el canvia a tots els deu mòduls (`projects_and_time,attendance,connectors,infrastructure,usage_costs,mail,connector_oauth,connector_actions,credential_catalog,mcp`).
- **`install.sh` detecta n8n automàticament**: Si hi ha un contenidor n8n a la mateixa màquina, l'instal·lador afegeix la seva URL a `CONNECTOR_INTERNAL_ALLOWLIST` perquè els connectors puguin connectar-hi sense configuració manual.
- **`update.sh` detecta n8n automàticament**: Si `CONNECTOR_INTERNAL_ALLOWLIST` està buit i hi ha un n8n, l'actualització l'afegeix.

### Correccions

- **Simplificada la detecció de n8n**: S'ha eliminat l'ús de `docker ps --format` per compatibilitat amb entorns de test i sistemes amb versions antigues de Docker.

## v0.4.3 - 2026-08-28

Una versio que fa que l'instal·lador proposi tots els moduls per defecte, en lloc de nomes
`projects_and_time`. El connector key ring es genera sempre (com abans) i ara tambe es carrega
l'overlay `compose.production.connectors.yaml` quan la flag `connectors` es activa, tant a
`install.sh` com a `update.sh`. Aquesta simetria evita que una actualitzacio perdi el muntatge del
key ring.

### Instal·lacio

- **L'instal·lador proposa tots els deu moduls per defecte.** Fins ara el default era
  `projects_and_time` i un operador que volia mes havia de teclejar la llista sencera. Un nom
  mal escrit s'ignora silenciosament, i el simptoma --un modul que no apareix-- es indistingible
  d'un modul que no s'ha encés. Ara el default es
  `projects_and_time,attendance,connectors,infrastructure,usage_costs,mail,connector_oauth,connector_actions,credential_catalog,mcp`,
  i un operador treu el que no necessita en lloc de recordar el que necessita.
- **`install.sh` i `update.sh` carreguen els mateixos overlays.** L'overlay de connectors es
  carrega quan la flag `connectors` es activa, tant a la instal·lacio com a l'actualitzacio.
  Abans nomes el carregava `install.sh`, i una actualitzacio hauria perdut el muntatge del key
  ring sense deixar rastre a cap log.
- **Avis sobre OAuth quan `connector_oauth` es activa.** L'informe final de l'instal·lador diu
  ara que cal registrar aplicacions a Google Cloud i Azure AD i configurar les variables
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID` i
  `MICROSOFT_OAUTH_CLIENT_SECRET`. El modul s'encen pero els proveïdors no funcionen fins que
  es configurin.

## v0.4.2 - 2026-08-28

La versio que surt de la primera instal·lacio que va **arrencar**. La v0.4.1 va fer que
l'instal·lador funciones en una maquina de debo; aquesta arregla el que va passar despres, i les
sis coses tenen la mateixa forma: **res no havia executat mai l'stack composat de produccio**. Les
proves end-to-end arrenquen les aplicacions a `localhost`, on `127.0.0.1:4000` es l'API de debo i
on les variables hi son perque les posa el propi job.

> **En actualitzar des de la v0.4.1, cal agafar el comandament nou primer.** El `update.sh` que va
> instal·lar la v0.4.1 nomes sap descarregar `release.env`, aixi que no et portaria cap d'aquestes
> correccions que no visqui dins d'una imatge. Una sola vegada:
>
> ```sh
> curl -fsSLo update.sh https://github.com/BobFarreras/Control-Hub/releases/latest/download/update.sh
> chmod +x update.sh
> ./update.sh
> ```

### Correccions

- **El menu lateral ja mostra els moduls escollits.** `CONTROL_HUB_FLAGS` s'escrivia a `.env`, es
  reportava a la pantalla final de la instal·lacio i no sortia mai d'alli: cap fitxer de compose
  l'anomenava, i el `--env-file` interpola el fitxer, no exporta res. Una instal·lacio que havia
  demanat un modul arrencava amb tots apagats, que es indistingible d'una que no n'ha demanat cap.
  `MCP_ISSUER` tenia el mateix forat, adormit darrere una bandera.
- **Els enllacos del correu ja funcionen.** Tota peticio del navegador cap a `/api` responia
  `Internal Server Error`, incloent l'enllac amb que el primer Owner es posa la contrasenya. La
  destinacio d'un rewrite de Next es grava quan es compila la imatge i el `pnpm build` corria sense
  `API_INTERNAL_URL`, o sigui que la imatge publicada apuntava a ella mateixa.
- **Els contenidors poden llegir els seus secrets.** Compose ignora `uid`, `gid` i `mode` en un
  secret --son atributs de Swarm-- i els mostrava com un avis a cada execucio. Els set fitxers
  arribaven amb la propietat que tenien al host, que era `root`, i PostgreSQL inicialitza com a uid
  70. L'instal·lador assigna ara la propietat **a cada execucio**, no nomes quan crea el fitxer, de
  manera que tornar-lo a executar repara una instal·lacio feta amb la v0.4.1.
- **El worker arrenca.** No ho havia fet mai, en cap versio: exigia un `BETTER_AUTH_SECRET` que no
  llegeix enlloc i que cap fitxer de compose li donava, aixi que moria a l'arrencada i es
  reiniciava en bucle. Amb ell queien **la comprovacio de versio nova** --el banner
  d'actualitzacio no havia pogut apareixer mai--, les alertes, els horaris dels connectors i la
  recollida de consum. Si vens de qualsevol versio anterior, aquestes quatre coses comencen a
  funcionar ara.
- **Una actualitzacio entrega tambe el que no viu dins d'una imatge.** `update.sh` descarregava
  nomes `release.env`; els fitxers de compose, l'script d'inici de PostgreSQL i l'instal·lador es
  quedaven a la versio que havia instal·lat la maquina. Ara llegeix tambe el paquet publicat, i
  substitueix els fitxers del producte i cap dels teus: `.env`, `release.env` i
  `compose.proxy.yaml` no es toquen mai, i un paquet que en porti cap --o un cami que surti del
  directori-- es rebutja abans de reemplacar res. El que substitueix queda a `previous/`, que es el
  que necessita un rollback juntament amb `release.env.previous`.
- `NEXT_PUBLIC_DEFAULT_LOCALE` ja no existeix. No el llegia ningu: `defaultLocale` es una constant.

### El que ho impedeix a partir d'ara

- Cada nom que l'instal·lador escriu a `.env` l'ha d'anomenar algun fitxer de compose, o constar
  amb el seu motiu com a llegit nomes a la maquina.
- La construccio d'imatges de CI aixeca l'stack i li demana al contenidor `web` una ruta `/api`
  --l'unica peticio que distingeix una imatge ben construida d'una que respondra 500 a tothom--,
  comprova que cap contenidor s'hagi reiniciat sol, i torna a aixecar-ho tot amb els secrets com a
  fitxers muntats amb la propietat que els dona l'instal·lador.
- Les proves executen `update.sh` sencer. Tota la meitat que hi ha sota `--check` no s'havia
  executat mai enlloc.

## v0.4.1 - 2026-08-28

La versio que fa que l'instal·lador arrenqui en una maquina de debo. Preparant la primera
instal·lacio real van sortir tres coses, totes amb la mateixa forma: **donava per suposat l'estat
de la maquina en comptes de mirar-lo.**

### Instal·lacio

- **El relay SMTP es pot autenticar.** `SMTP_USER` i `SMTP_PASSWORD`, totes dues o cap.
  L'instal·lador demana l'usuari i la contrasenya del relay, la contrasenya s'escriu amb l'eco
  apagat i acaba en un sete fitxer `0400` de `root`, muntat a `api` i `bootstrap` per
  `compose.production.smtp.yaml`. No passa mai per `.env` ni per cap historial. Sense aixo cap
  proveidor transaccional accepta el correu, i el primer missatge que rebutjaria es l'enllac amb
  que el primer Owner entra al seu propi compte. Deixar l'usuari en blanc segueix sent la manera
  de configurar un relay sense credencials.
- **Els ports es trien mirant quins son lliures.** Anaven escrits a foc, i el 5432 xoca amb
  qualsevol PostgreSQL que ja corri a la maquina. Ara mira que hi ha escoltant abans d'escriure
  `.env`, agafa el seguent lliure i ho diu. Una segona execucio conserva els que ja hi havia.
- **La configuracio del reverse proxy descriu el proxy que hi ha.** Abans escrivia sempre el
  mateix `traefik-control-hub.yaml`, amb un resolver que es diu `letsencrypt` i un servei a
  `127.0.0.1`; en una VPS amb Traefik llegint etiquetes de Docker les dues coses son falses i el
  fitxer no te on anar. Ara inspecciona el proxy que ja corre i, o be escriu `compose.proxy.yaml`
  amb les etiquetes reals --resolver, entrypoint i xarxa llegits d'aquella maquina--, o be escriu
  el fitxer amb els valors reals per a un provider de fitxers, o be escriu el generic **dient**
  **quins valors son una suposicio**. No s'inventa mai un nom de resolver: un d'inventat es una
  configuracio que sembla acabada i no treu mai cap certificat.
- `update.sh` carrega els dos overlays nous quan toca. Sense aixo, la primera actualitzacio
  trauria la instal·lacio del proxy sense deixar res a cap log.

## v0.4.0 - 2026-08-27

Una versio que es publica, s'instal·la i s'actualitza sola, i la frontera per on un agent extern
entra al producte sense que ningu li doni una clau amb permisos totals.

### Desplegament, instal·lacio i actualitzacions (Fase 9)

- **Cada versio publica quatre imatges** --web, API, worker i migracions-- per a `linux/amd64` i
  `linux/arm64`, **firmades per digest** amb cosign sense claus, amb SBOM i provinenca. Una
  instal·lacio aixeca digests, no etiquetes: dues instal·lacions de la mateixa versio corren
  exactament els mateixos bytes.
- **`install.sh` fa sis preguntes** --domini, primer Owner, organitzacio, SMTP, moduls i
  backups--, valida cada resposta alli mateix, genera els sis secrets, els escriu com a fitxers
  `0400` de `root`, aixeca l'stack i crea el primer Owner. Nomes POSIX sh i docker: cap node, cap
  pnpm, cap jq, cap openssl.
- **No pregunta cap contrasenya ni n'imprimeix cap.** El compte del primer Owner es crea amb 32
  bytes que ningu no veu mai, i l'Owner rep un enllac per posar-se la seva. El preu esta acceptat i
  dit: aquell correu es l'unic cami cap al compte, o sigui que l'SMTP es prova **abans** de crear
  res.
- **Tornar a executar l'instal·lador es el cas normal**, no un accident: les respostes ja donades
  surten com a valors per defecte i cap secret ja escrit no es regenera.
- **`update.sh` actualitza en set passos i s'atura on toca.** Fa el bolcat de la base **abans** de
  descarregar res, i el verifica --un `pg_dump` que mor a mig cami deixa un arxiu valid de 20 bytes
  que `gzip -t` accepta, i una copia que ningu no pot restaurar es pitjor que cap copia. Si les
  migracions fallen, la versio anterior segueix corrent intacta. El fitxer que anomena els digests
  de la versio que funcionava es conserva, perque es tot el que un rollback necessita.
- **La instal·lacio avisa que hi ha versio nova, i no ho fa el navegador.** Un cop al dia el worker
  demana el manifest publicat i deixa el resultat a Valkey; la peticio no identifica ningu i no diu
  ni quina versio corre. `CONTROL_HUB_UPDATE_CHECK=false` **esborra** l'horari, no nomes deixa
  d'afegir-ne un. L'avis diu quanta feina representa l'actualitzacio i ofereix `./update.sh` per
  copiar: **no hi ha cap boto que actualitzi**, perque l'alternativa vol el socket de Docker a
  l'abast d'un navegador.
- La guia sencera es a `docs/runbooks/installation.md`, i com es publica una versio a
  `docs/runbooks/release.md`.

### Agents i MCP: OAuth 2.1 davant del producte (Fase 10)

- **Control Hub ja pot ser servidor de recursos.** Un agent o una eina externa s'autoritza amb
  OAuth 2.1 --emissor propi, PKCE, redirects a `127.0.0.1` per als clients d'escriptori i
  `resource` obligatori-- i rep un token opac de referencia que viu trenta minuts. El refresh rota
  i en guarda el llinatge, i revocar-lo talla la branca sencera.
- **Un cataleg de sis eines de nomes lectura** --llistar i obrir clients, llistar i obrir tickets, i
  dos resums--, i l'autoritat es decideix al moment de gastar el token, no al moment d'emetre'l:
  cap agent no hereta mes del que la persona que el va connectar podia veure. Cada projeccio
  retorna menys del que ensenya la pantalla.
- **Pantalles noves** per connectar un agent, decidir que pot llegir, administrar-los i rotar-ne les
  claus sense tallar-li el servei.
- Amb la flag tancada **no existeix ni `/mcp` ni cap ruta d'OAuth**: no s'emet cap token i no es
  publica cap cataleg. Purgar codis i tokens caducats, en canvi, no consulta la flag --el que es va
  escriure mentre era oberta ha de caducar igualment.

### Correu entrant i bustia de suport

- **Connectors de correu entrant** per IMAP, Google i Microsoft. **No es desa MIME cru, ni HTML
  remot, ni adjunts**: nomes una previsualitzacio normalitzada de fins a 4.000 caracters.
- **Classificar es un acte d'una persona, no una coincidencia d'adreca.** La UI suggereix un client
  si el remitent quadra, i un membre amb `tickets:manage` vincula el correu a un ticket obert, en
  crea un de nou amb els objectius d'SLA vigents, o el descarta. Descartar no elimina res: conserva
  qui ho ha decidit i quan. Dos operadors no poden classificar el mateix correu.
- **Les respostes surten pel flux confirmat**, i el ticket mostra l'estat real de l'enviament.
  `succeeded` vol dir que el proveidor l'ha acceptat --no que ningu l'hagi llegit.
- **OAuth delegat per als connectors**, amb refresh concurrent, revocacio i tokens segellats al
  vault.

### Credencials humanes i secrets de plataforma (Fase 12, parcial)

- **Un cataleg per trobar un acces compartit** --de quin client es, quina aplicacio, qui en respon--
  **sense desar-ne mai el valor**. Obrir-lo porta a Bitwarden, i nomes despres de reautenticar-se,
  amb MFA, permisos i auditoria. Control Hub no rep, no desa, no revela i no exporta cap password.
- **Rotar i recuperar els secrets bootstrap sense exposar-ne els valors**, amb el runbook a
  `docs/runbooks/platform-secret-rotation.md`.

### Desenvolupament

- **De dos a quatre agents poden treballar alhora sobre el repositori** sense compartir directori,
  branca, processos, secrets locals, ports ni base de dades. Cada tasca te el seu worktree, el seu
  projecte Compose i les seves credencials generades; cap workspace no rep mai secrets de
  produccio, i destruir-ne un es nega si hi ha canvis sense commit.

### Nota d'activacio

**Els moduls nous queden darrere la seva feature flag, apagada**: `mcp`, `mail`,
`connector_oauth`, `connector_actions` i `credential_catalog`. Publicar aquesta versio no
n'encen cap. L'instal·lador pregunta quins vols i escriu `CONTROL_HUB_FLAGS` a `.env`; el valor per
defecte es nomes `projects_and_time`, i es pot canviar despres editant aquell fitxer.

## v0.3.0 - 2026-08-24

Infraestructura operable, connectors de proveidors i control reproduible del consum variable.

### Consum i costos variables (Fase 8.1)

- Nova seccio **Consum i costos** amb Resum, Costos i Pressupostos, separada de les despeses
  recurrents perque mostra consum variable, cobertura de valoracio i frescor de fonts.
- Els perfils tecnics poden veure volum i salut sense imports; els costos i pressupostos respecten
  els permisos financers, i les accions de pressupost nomes apareixen quan es poden executar.
- Els estats parcials i obsolets expliquen quina dada o font falta en comptes de dependre nomes
  d'un color.
- **OpenCode local** pot enviar tokens a la VPS amb un plugin global per dispositiu. La connexio surt
  per HTTPS i no inclou converses, codi, paths, diffs ni ordres.

### Supabase, llegit des del Control Hub (Fase 7.4)

- **Els projectes de Supabase i el seu estat** es llegeixen cada cinc minuts. Cap ordre cap
  enfora: el connector no pausa, no restaura, no crea ni esborra res, i no toca cap dada de dins
  d'un projecte.
- **El token de gestio de Supabase no es de nomes lectura, i es diu sencer**: porta el mateix
  privilegi que el compte que el va encunyar, i no hi ha manera de limitar-lo sense la plataforma
  OAuth2 que encara no existeix. La pantalla d'incorporacio ho avisa amb aquestes paraules.
- **Els projectes es dibuixen a Infraestructura**, en una franja propia i separada de la de
  Vercel: regio, estat —actiu, inactiu o en transicio, mai una caiguda falsa mentre Supabase mou
  el projecte d'un lloc a un altre— i quan es va crear. S'associen a un client amb la mateixa
  taula que un projecte de Vercel: cap migracio nova.
- Com connectar-hi: `docs/runbooks/connect-supabase.md`. **Encara no salta cap alerta** quan un
  projecte es pausa: es veu quan algu mira la pantalla.

### Vercel, llegit des del Control Hub (Fase 7.4)

- **Els projectes de Vercel i els desplegaments de produccio que han fallat** es llegeixen cada
  cinc minuts amb un token de nomes lectura. Cap ordre cap enfora: el connector no desplega, no
  torna enrere i no pausa res.
- **Un projecte es un estat i un desplegament es un esdeveniment**, i es desen com a tals: que
  l'ultim build hagi petat no vol dir que el web estigui caigut, perque el que se serveix segueix
  sent l'anterior.
- **Del que Vercel respon se'n desa nomes el que s'ha nomenat**: ni qui va fer el push, ni el
  missatge del commit, ni els logs del build, que es on viuen els secrets d'un projecte.
- **Els projectes es dibuixen a Infraestructura**, amb franja propia: el domini de produccio, si
  produccio serveix i quan es va desplegar el que se serveix, quan es va crear el projecte i amb
  que esta fet, l'ultim build que va fallar —amb la branca i quan— i quan en vam llegir. Es poden
  associar a un client, com les automatitzacions.
- **Produccio i l'ultim build fallit son dues columnes i no una**: un web pot estar servint
  perfectament i haver tingut un build que peta fa deu minuts, i les dues coses son certes.
- Com connectar-hi: `docs/runbooks/connect-vercel.md`. **Encara no salta cap alerta** quan un
  build peta: un build fallit es veu quan algu mira la pantalla.

### Posar en marxa un recollidor sense endevinar (Fase 7.3)

- **Una comprovacio guiada** que diu en quin punt s'ha aturat una integracio que no llegeix res,
  esglao a esglao, en comptes de deixar la pantalla buida sense explicacio.
- **El recollidor ensenya el que veu**: les maquines i els serveis que ja te desats, amb el que
  encara no ha declarat ningu marcat com a tal, i es poden declarar des d'alli —d'un en un o
  marcant-ne uns quants.
- **La pantalla depen del recollidor que tries**: la taula del que no has triat no surt buida,
  no surt.
- **Fitxa d'una maquina** amb el que se'n llegeix, qui ho ha llegit i quan.
- **Una maquina pot respondre a diverses etiquetes.** Un Prometheus agrupa per objectiu de scrape,
  no per ordinador: una sola VPS reporta amb `node-exporter:9100`, `cadvisor:8080` i
  `127.0.0.1:9090`. Ara es diu quines etiquetes son seves, i la seva fitxa ensenya **tot el que
  els recollidors hi veuen, declarat o no**. Declarar passa a voler dir «vull alertes d'aixo», no
  «vull veure-ho».

- **L'API ja diu quina versio es.** `/health/live` i el document OpenAPI de `/api/docs` anunciaven
  `0.1.0` durant tota la `v0.2.0`, perque el numero estava escrit a ma al costat d'on es registra
  i res no el feia mentir quan la release avancava. Ara surt del manifest del paquet.

## v0.2.0 - 2026-08-16

Dues fases senceres que la `v0.1.0` no tenia.

### Plataforma de connectors (Fase 6)

- Contracte de connector amb registre en temps de compilacio, de manera que afegir un proveidor
  no toca ni el domini ni l'API.
- Vault de credencials segellades amb un anell de claus versionat, lligat al tenant que les fa
  servir i no al que les anomena.
- Webhooks signats, execucions amb lease, tallafocs de reintents i sostre de peticions.
- Pantalla d'integracions: triar una plataforma, respondre nomes el que aquella plataforma
  demana, i connectar-la sense sortir de la pantalla.

### Infraestructura i connector n8n (Fase 7.1)

- Connector `n8n` que llegeix workflows i execucions de la instancia, amb la seva cadencia
  propia i el seu error workflow documentat a `docs/runbooks/n8n-error-workflow.md`.
- Pantalla `/{locale}/infrastructure`: que corre, com de vella es la lectura i que esta trencat.
- Una integracio te pagina propia, amb la seva configuracio, credencials i execucions paginades,
  i **es pot esborrar** i no nomes aturar.
- La taula d'integracions respon sense obrir res: marca del connector, salut amb el motiu, i
  l'edat de la lectura en comptes d'una data que obliga a restar.

### Seguretat i cadena de subministrament

- Les vuit comprovacions de CI passen a ser obligatories a `develop` i a `main`. Fins ara nomes
  n'hi havia dues, i una proposta que trencava la imatge de contenidor complia les regles.
- Els minor i els patch de Dependabot es fusionen sols quan totes passen. Els major, mai.
- `docs/development/dependency-log.md`, derivat de l'historial amb `pnpm deps:log`.
- Les capcaleres que torna un proveidor s'acumulen en un mapa sense prototip. El nom d'una
  capcalera el tria qui hi ha a l'altre extrem del socket, i escriure'l damunt d'un objecte
  corrent fa que `constructor` o `__proto__` vulguin dir coses que no havien de voler dir.

### Nota d'activacio

**Els moduls `connectors` i `infrastructure` queden darrere la seva feature flag, apagada.** Amb
la flag tancada les rutes no es declaren i el modul respon 404. Publicar aquesta versio no
n'activa cap: encendre-les es una decisio a part.

## v0.1.0 - 2026-08-10

Primera versio etiquetada: nucli executable, identitat amb Better Auth, tenants, RBAC, MFA,
passkeys, sessions revocables, RLS i auditoria append-only; CRM; cataleg comercial amb plans,
preus, subscripcions i metriques recurrents; suport amb tickets i SLA; projectes amb imputacio
de temps; i registre de jornada.
