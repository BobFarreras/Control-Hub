# Especificacio de la Fase 9: empaquetat, publicacio i instal·lacio

**Estat:** aprovada. D1 i D2 les va decidir el propietari el 26 d'agost de 2026. D3 a D7 les va
delegar el mateix dia --«et deixo el teu criteri professional»--, de manera que hi son com a
decisions preses i amb el raonament escrit, no com a preferencies. Delegar no es igual que no
decidir: qualsevol es pot revisar, pero cap increment ha d'esperar-la.

## Objectiu

Que una persona amb una VPS i un domini pugui tenir Control Hub funcionant sense compilar res, i
que una instal·lacio existent sapiga quan hi ha una versio nova sense que ningu la canvii per
sorpresa.

## El que avui no existeix

Aquest apartat no es context, es la llista de feina. `docs/runbooks/installation.md` ja descriu el
procediment d'alta, pero descriu passos que **encara no es poden fer**, i aquesta especificacio
existeix per fer-los possibles.

| El runbook diu | La realitat |
| --- | --- |
| «Release OCI immutable i manifest de versions verificat» | No hi ha cap registre ni cap manifest. Res publica imatges. |
| «Descarregar imatges OCI per digest, mai `latest`» | `compose.yaml` no dona `image:` a cap servei nostre: nomes `build:`. Una instal·lacio **compila el codi al servidor**. |
| «Configurar domini, TLS» | No hi ha cap reverse proxy al repositori. Tots els ports publicats son `127.0.0.1`. |
| «el job OCI equivalent» per al primer Owner | Nomes existeix `pnpm bootstrap:owner`, que vol el codi font i pnpm. |
| Actualitzacio com a llista de set passos manuals | Res dins el producte diu que n'hi hagi una de disponible. ~~La versio no la veu cap persona i no distingeix dos builds del mateix numero.~~ Resolt per P1: versio i identificador de construccio, visibles a **Seguretat**. |

La release `v0.3.0` del 24 d'agost es codi versionat i etiquetat, no una instal·lacio: **no s'ha
desplegat mai res enlloc**.

## Invariants

1. Una instal·lacio **mai** s'actualitza sola. Avisa; qui decideix es una persona.
2. Control Hub **no parla amb el dimoni de Docker**. Ni per actualitzar-se, ni per reiniciar-se, ni
   per saber quins contenidors corren. `AGENTS.md` prohibeix exposar el socket de Docker al panell,
   i un boto que s'actualitza a si mateix el necessita: es la mateixa regla, no una d'analoga.
3. Cada servei es una imatge propia amb una etapa de runtime propia, com ja fa `deploy/Dockerfile`.
4. Una versio instal·lada es un **digest**, no una etiqueta. Les etiquetes es mouen; els digests no.
5. La imatge no conte cap secret, cap `.env` ni cap credencial. Els secrets entren nomes com a
   fitxers muntats, tal com ja fa `compose.production.yaml`.
6. Les migracions corren en un job separat que ha d'acabar be abans que arrenqui res mes, i una
   fallada conserva la versio anterior arrencable.
7. L'instal·lador es pot tornar a executar sobre una instal·lacio existent sense trencar-la.
8. Res del que l'instal·lador pregunti s'escriu a l'historial de la terminal ni a cap log.

## Decisions

**D1 — Les imatges son publiques a GHCR.** Decidida el 26 d'agost de 2026. Qualsevol pot
descarregar-les sense credencials, que es la diferencia entre codi obert que la gent pot fer servir
i codi obert que nomes pot llegir. Es possible perque l'invariant 5 ja es cert: la imatge no porta
res que sigui de ningu. El que si que exposa es el calendari de versions, i aixo s'accepta.

**D2 — La primera instal·lacio va a la VPS actual, darrere el Traefik que ja hi ha.** Decidida el
26 d'agost de 2026. El TLS i els certificats ja funcionen alli, es el que la guia de la Fase 12 ja
assumia per a S11, i desbloqueja el motiu concret per desplegar ara: un client MCP real vol HTTPS i
cap workspace local l'hi pot donar. El risc acceptat es la veinatge amb l'n8n de produccio dels
clients; l'apartat de limits el tracta.

**D3 — Publica una etiqueta de versio. `develop` publica una imatge `edge`.** Cada commit publicat
es una promesa: algu se'l pot descarregar i dependre'n sense que ningu hagi decidit que aquell
commit valgues res. Una etiqueta es un acte deliberat i vol dir «aixo ho mantinc». `edge` no vol dir
res, i per aixo es pot trencar: existeix per provar la instal·lacio contra el que hi ha ara, no per
instal·lar-hi res de debo.

**D4 — Suport nomes de l'ultima versio; finestra de rollback d'una.** Son dues coses diferents amb
respostes oposades, i confondre-les es el que fa que la pregunta sembli dificil.

Arreglar defectes de versions velles: **cap**. Una persona sola que promet mantenir tres versions
promet temps que no te, i la promesa es trenca el primer mes. «Actualitza a l'ultima» es el que fan
els productes autoallotjats petits i es honest.

Poder tornar enrere: **una versio**, i aixo no es una promesa sino una propietat que s'ha de
construir. Les imatges tornen enrere de franc; la base de dades no. Si la migracio ja ha corregut i
ha eliminat una columna, la versio anterior ja no arrenca contra aquella base, per molt digest antic
que es posi al `compose`. Per tant la regla operativa no es quantes imatges es guarden, es aquesta:

> **Cap migracio elimina res que la versio anterior encara faci servir.** S'afegeix en una versio,
> es deixa de fer servir a la seguent, i s'elimina a la tercera.

`AGENTS.md` ja demana migracions «compatibles amb desplegament gradual». El que falta es una prova
que ho **verifiqui** --arrencar la versio N-1 contra una base migrada a N--, perque sense
exercitar-ho la compatibilitat es una intencio i no un fet. Al registre s'hi conserven deu digests.

**D5 — La instancia consulta, pero no informa.** Un `GET` a un fitxer estatic, un cop al dia, i la
comparacio es fa aqui. No s'envia versio, ni nombre d'usuaris, ni identificador, ni res.

Tres condicions que fan que aixo sigui acceptable, i cap es opcional:

1. **Ho fa el worker, mai el navegador.** Amb el navegador, cada persona que obre Control Hub li
   dona la seva IP a GitHub sense saber-ho. No es un detall d'implementacio: es la diferencia entre
   consultar tu i consultar en nom dels teus usuaris.
2. **No s'envia res.** El que igualment es revela es la IP del servidor i que existeix, cosa que no
   es pot evitar consultant --i per aixo cal la tercera condicio.
3. **Es pot apagar** amb una variable documentada, i el runbook diu exactament que surt i cap on.

L'alternativa, que nomes ho digui qui executa el comandament, s'ha descartat pel motiu que la fa
temptadora: no demana res a ningu, i per aixo no avisa mai. El banner existeix per als dies que
ningu pensa en Control Hub, que son la majoria i son quan surt una actualitzacio de seguretat.

**D6 — Es firma i es publica SBOM des de la primera versio; verificar-ho no s'exigeix.** El passat
no es pot firmar: ajornar-ho un any deixa un any de versions sense firmar per sempre, i la resposta
a «com se que aquesta imatge es teva» passa a ser «des de la 1.2 endavant» en comptes de «sempre».
Avui costa poc, perque la firma sense claus per OIDC no obliga a custodiar cap clau privada --que
era exactament el motiu pel qual ningu firmava res.

Exigir la verificacio a l'instal·lador es una decisio diferent i es respon que no: afegeix una
dependencia a la maquina de qui instal·la per protegir d'un atac que avui no te ningu al davant. Es
publica la firma, es documenta el comandament per verificar-la, i qui vulgui que ho faci. Produir-ho
es barat i irreversible cap enrere; exigir-ho es car i sempre s'hi es a temps.

**D7 — Un script al repositori, executat despres de descarregar una release.** No `curl | sh`, que
demana confiar en un servidor just en el moment en que no es pot inspeccionar que envia; que ho faci
tothom no el fa millor. I un binari no compra res: el desti es un servidor Linux que ja te Docker
--si no el te, l'instal·lador tampoc serveix--, aixi que compilar i firmar per a tres plataformes
per estalviar un `tar -xzf` es feina que no es paga.

Queda anotada una tercera via per mes endavant: **l'instal·lador com a contenidor**, sense cap
dependencia mes enlla del Docker que ja hi ha. Te complicacions reals amb el TTY i amb els permisos
dels fitxers que escriu al host, i per aixo no es la primera versio.

## Publicacio

Un workflow nou, separat de `ci.yml` perque el seu error mode es diferent: la CI protegeix
`develop`, aixo publica artefactes.

1. Construeix les quatre imatges des de `deploy/Dockerfile` --`api`, `worker`, `migrate`, `web`--
   per a `linux/amd64` i `linux/arm64`.
2. Les puja a `ghcr.io/bobfarreras/control-hub-{servei}`.
3. Les **firma** sense claus, per OIDC, i hi adjunta **SBOM i provinenca**.
4. Escriu un **manifest de release**: versio, data, commit, i el digest de cadascuna de les quatre.
5. Adjunta el manifest a la release de GitHub.

Una etiqueta `v*` fa tot aixo. Un commit a `develop` fa nomes 1 i 2, amb l'etiqueta `edge` i sense
manifest: no es una release i no ha de tenir-ne la forma.

El manifest es l'unic artefacte que una instal·lacio llegeix. No conte cap URL a on connectar-se ni
res sobre qui l'ha instal·lat.

Cap imatge es publica sense que les nou portes de `ci.yml` hagin passat sobre el mateix commit. La
porta `Container image` ja construeix i aixeca l'stack; publicar es el pas seguent d'aquell cami, no
un de paral·lel.

### El que P2 en va concretar

`.github/workflows/release.yml`, i tres coses que l'especificacio deixava obertes:

**On es llegeix el manifest.** A
`https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.json`, una URL que no
canvia mai: GitHub la resol sempre a l'ultima release publicada. Per aixo el fitxer adjunt es diu
sempre igual i el numero de versio no surt enlloc de l'adreca --si hi sortis, una instal·lacio hauria
de saber quina versio demanar abans de poder-ho preguntar, que es exactament el que no sap.

**Que hi ha a dins.** Versio, instant, commit, els quatre digests, i un apartat `work` amb les dues
dades que el banner necessita per dir **quina feina representa** l'actualitzacio: quantes migracions
noves porta i si la configuracio ha canviat. Les dues es calculen al moment de publicar, comparant
amb l'etiqueta anterior --les migracions, comptant fitxers nous a `packages/database/migrations`, que
equival a comptar-ne els canviats nomes perque `AGENTS.md` prohibeix editar-ne una de publicada; la
configuracio, mirant si `.env.example` s'ha mogut. Es calculen alli i no a la instal·lacio perque
alli hi ha els dos commits, i a la instal·lacio no n'hi ha cap dels dos.

**Com s'exigeixen les nou portes.** Un job previ consulta els *check runs* del commit i es nega si en
falta cap. Funciona per a una etiqueta perque els resultats pengen del commit i no de la referencia:
`ci.yml` no s'executa en fer push d'una etiqueta, pero el commit que l'etiqueta assenyala ja hi ha
passat a `main`. A `develop` el workflow arrenca del mateix push que la CI, aixi que esperar es el
cas normal i no un error --espera fins a 45 minuts i despres es nega. `skipped` i `cancelled` compten
com a fracas: una porta que no s'ha executat no ha passat.

Una consequencia que val la pena tenir present abans de fusionar res: **el primer commit a `develop`
amb aquest workflow a dins publica la primera imatge `edge` publica**. No cal fer res mes perque
passi.

## Com una instal·lacio nomena la seva versio

Un fitxer `release.env` al directori d'instal·lacio, amb els quatre digests i la versio llegible.
Un overlay `compose.release.yaml` dona `image:` a cada servei llegint-ne els valors, i **no dona
`build:`**, de manera que una instal·lacio de produccio no te ni pot tenir el codi font.

### El que P3 en va concretar

Dos fitxers i no un, i la separacio es la part que val: **una actualitzacio reescriu `release.env`
sencer i no toca mai `.env`**. El primer el genera `scripts/release-env.mjs` a partir del manifest;
el segon es de qui administra. Res del que hagi configurat a ma corre perill en actualitzar, i cap
variable d'una versio anterior sobreviu a la seguent --que es el residu perillos, perque una
referencia d'imatge caducada encara funciona: descarrega, arrenca, i executa codi vell amb el numero
de versio nou.

`build: !reset null`, no simplement ometre'l. Compose fusiona per defecte, aixi que sense el reset
el servei portaria imatge i definicio de construccio alhora, i un `docker compose up --build`
--que es el que algu escriu per costum quan un contenidor fa coses rares-- tornaria a compilar
d'un arbre de codi que alli no hi es.

Llegir el manifest es validar-lo. Ve d'internet, aixi que `parseManifest` no se'n creu cap camp:
en separa les peces, les torna a passar pel mateix constructor que el va produir, i compara. La
comprovacio que importa es que **les quatre imatges comparteixin espai de noms** --quatre
referencies que cadascuna sembla correcta pero venen de dos registres diferents no es una forma que
una release pugui tenir, i es exactament la forma que tindria una imatge substituida.

El limit d'aixo, dit i no insinuat: un manifest **no esta firmat**, o sigui que un valor editat de
manera coherent hi passa. El que no pot fer es que una instal·lacio descarregui res que no siguin
els quatre digests que anomena --i aquests si que estan firmats (D6), i un digest que ningu ha
publicat no es pot descarregar. El manifest diu que hi ha una versio nova; no es el que fa que les
imatges siguin de fiar.

### Tres buits que P3 va destapar i que no resol

1. **Les imatges de tercers van per etiqueta, no per digest.** `postgres:17-alpine`,
   `valkey/valkey:8-alpine` i `axllent/mailpit:v1.27` es resolen al que aquella etiqueta vulgui dir
   el dia de la instal·lacio, de manera que dues instal·lacions de la *mateixa* versio de Control
   Hub poden no portar el mateix PostgreSQL. L'invariant de descarregar per digest, doncs, avui
   nomes es cert per a les nostres quatre. Fixar-les vol dir que el manifest les reculli, o sigui
   tocar P2 un altre cop.
2. **Mailpit arrenca en una instal·lacio de produccio.** Es un caca-correus de desenvolupament amb
   `MP_SMTP_AUTH_ACCEPT_ANY`, i encara que nomes publiqui a `127.0.0.1`, no te res a fer en un
   servidor de client. Treure'l demana perfils de Compose, cosa que canvia com arrenca l'stack de
   desenvolupament i de CI: no es una linia i no es feina de P3.
3. **El directori d'instal·lacio necessita mes que els fitxers de Compose.** `compose.yaml` munta
   `deploy/postgres/init-app-user.sh` des del host, o sigui que el paquet que es descarrega ha de
   portar-lo. No es codi font de l'aplicacio i no contradiu l'invariant, pero si que vol dir que la
   release ha d'incloure un petit arbre de fitxers i no nomes YAML. Es feina de P7.

La meitat d'aixo ja existeix i s'ha de reaprofitar en comptes de duplicar-la. `apps/api/src/version.ts`
ja resol el problema dificil --el runtime no te `package.json` al costat, aixi que tsup hi estampa
un literal a la construccio i el manifest nomes es llegeix quan no hi ha bundle-- i `/health/live`
ja publica el numero. Els quatre paquets comparteixen versio, o sigui que el numero que diu l'API es
el de la release.

Hi falten dues coses, i la segona es la que importa per a `edge`:

1. **Ningu la veu.** Es a una ruta de salut que consulten les sondes, no una persona. Ha d'arribar a
   la pantalla de seguretat, al costat de la resta d'informacio d'instal·lacio.
2. **No distingeix dos builds del mateix numero.** Tot el que surti de `develop` entre dues
   etiquetes dira `0.3.0`, i com que D3 publica precisament una imatge per commit, dues `edge`
   diferents son indistingibles. Cal un identificador de construccio --commit i data-- al costat del
   numero, estampat pel mateix cami que ja funciona.

Sense la segona, «tens l'ultima versio» es una frase que no es pot comprovar en el moment que mes
falta: quan alguna cosa va malament en una imatge de proves.

Les dues no van al mateix lloc, i la diferencia es deliberada. El **numero** es queda a
`/health/live`, que es public perque el web hi fa de proxy i les sondes l'han de poder consultar
sense credencials. L'**identificador de construccio** no hi va: amb ell, una sola peticio anonima
lliga una instal·lacio a un commit concret i, per tant, a qualsevol defecte conegut d'aquell commit.
Viu a `GET /api/v1/settings/installation`, que demana sessio i rol `Owner` o `Administrator` --els
dos que poden actuar sobre una actualitzacio-- i es el que llegeix la pantalla de seguretat.

## Avis d'actualitzacio

Un banner, per a `Owner` i `Administrator` nomes, que diu que hi ha una versio nova i **quina feina
representa**: si porta migracions, si canvia configuracio, si demana algun pas manual. Un avis que
nomes diu «hi ha una versio nova» trasllada la feina de decidir sense donar res per decidir-la.

El banner no te cap boto que actualitzi. Te l'enllac a les notes de la versio i el comandament a
copiar. Aixo no es prudencia: es l'invariant 2, i l'alternativa demana el socket de Docker.

Se n'assabenta pel cami de D5: el worker demana el manifest un cop al dia, sense enviar res, i la
comparacio es fa a la instancia. Ni una linia d'aixo passa pel navegador.

## L'actualitzacio

Un comandament al directori d'instal·lacio, que en ordre: llegeix el manifest nou, fa el backup,
descarrega les imatges per digest, executa el job de migracions, i nomes si acaba be reemplaca els
serveis. Si les migracions fallen, l'stack anterior segueix en peu i el comandament diu que ha
passat i que conserva.

Aixo es el que `installation.md` ja descriu com a set passos manuals. La feina es que sigui un
comandament en comptes d'una llista que algu ha de recordar.

## L'instal·lador

Interactiu a la terminal, un pas per pantalla, amb el que ja s'ha respost visible a dalt --l'estil
que el propietari va demanar explicitament. Pregunta domini, correu del primer Owner, SMTP, quins
moduls encendre, i on van els backups. Valida cada resposta **en el moment**: que el DNS apunti
aqui abans de continuar, que l'SMTP accepti una connexio abans de donar-lo per bo. Una configuracio
que nomes falla tres passos mes tard es una configuracio que s'ha de tornar a fer sencera.

Genera els secrets ell mateix, amb entropia criptografica, i els escriu com els fitxers `0400`
propietat de `root` que `installation.md` ja especifica. **No demana cap contrasenya a l'usuari**:
el que no s'escriu no s'enganxa a cap historial.

Al final imprimeix que ha fet i on ha deixat cada cosa, i **que no ha fet**: quins moduls han quedat
apagats, quins connectors falten per configurar, i quan toca el primer backup.

Executar-lo dues vegades no ha de trencar res. Detecta el que ja hi es i pregunta nomes el que
falta.

## Traefik i els limits de compartir maquina

Tots els ports de `compose.yaml` es publiquen a `127.0.0.1`, cosa que ja es la meitat de la feina:
el Traefik que ja corre a la VPS els pot arribar sense que ningu de fora hi arribi. Cal la
configuracio de ruta i certificat per al domini nou, i **res mes s'obre**. PostgreSQL, Valkey i
Mailpit no surten de `127.0.0.1` ni tenen per que.

El que aquesta especificacio no resol es la veinatge: Control Hub i l'n8n de produccio dels clients
compartiran CPU, memoria i disc. S'accepta per a la primera instal·lacio i s'ha de vigilar amb
limits de recursos als serveis; el dia que molesti, la sortida ja esta escrita a la guia de la Fase
12, que preveu moure's a una VPS dedicada.

## El que aixo no fa

- No hi ha actualitzacio automatica, ni per defecte ni com a opcio.
- No hi ha cap panell que arrenqui, aturi o reinicii contenidors.
- No hi ha instal·lacio multi-tenant compartida: cada instal·lacio es un client, tal com ja diu
  `installation.md`.
- No hi ha alta massiva ni cap forma de registre public.

## Increments

- **P1** — *Fet.* Identificador de construccio al costat de la versio que ja existeix, i les dues
  visibles a la pantalla de seguretat. Va primer perque tot el que ve despres compara contra elles.
- **P2** — *Escrit, no exercitat.* El workflow de publicacio: imatges, firma, SBOM i manifest de
  release. El mecanisme te proves; el que encara no te es una execucio. La verificacio de debo
  --descarregar les imatges publicades i aixecar l'stack sense el codi font-- necessita P3, i abans
  necessita que algu publiqui, que es un acte deliberat i no una consequencia d'aquest increment.
- **P3** — *Fet, amb tres buits anotats.* `compose.release.yaml` i `release.env`: una instal·lacio
  que fa `pull` i no `build`. Comprovat component els fitxers de debo: la definicio resultant no te
  cap `build:` i les quatre imatges hi son per digest.
- **P4** — La prova de compatibilitat N-1: arrencar la versio anterior contra una base migrada a la
  nova. Va **abans** del comandament d'actualitzar, perque es el que fa que el rollback de D4
  existeixi de debo en comptes de constar en un document.
- **P5** — El comandament d'actualitzacio, amb backup, migracions i rollback.
- **P6** — El banner i la comprovacio diaria del worker.
- **P7** — L'instal·lador interactiu.

Cada increment ha de deixar el sistema instal·lable. P2 sense P3 ja te valor: hi ha imatges que
algu pot provar a ma.

## Disciplina operativa

Tres coses que no son codi i que son on falla la gent que si que te el codi be.

**Un backup que no s'ha restaurat mai no es un backup.** `installation.md` ja ho demana a la
validacio d'acceptacio. La disciplina es fer-ho de debo un cop, i tornar-ho a fer cada vegada que
l'esquema canvii prou.

**La primera actualitzacio es la prova de veritat, no la instal·lacio.** Instal·lar de zero
funciona sempre; el que trenca es passar de la v1 a la v2 amb dades a dins. Per aixo la primera
actualitzacio s'ha de fer a proposit i aviat, amb una versio que no canvii res, nomes per exercitar
el cami mentre no hi ha res a perdre.

**Una segona instancia, encara que estigui apagada gairebe sempre.** No cal un entorn de staging
permanent; cal poder aixecar-ne un amb dades falses davant d'una actualitzacio que fa respecte.

## Riscos

**Els builds de Docker estan bloquejats a la maquina del propietari**, per interceptacio de TLS i
per espai al disc. P2 i P3 nomes es podran verificar a CI o directament a la VPS, i aixo s'ha de
tenir en compte en planificar-los: no hi haura la volta rapida de provar-ho local primer.

**Publicar imatges publiques es un compromis public.** Algu les pot descarregar i dependre'n. D4
existeix per decidir quant val aquest compromis abans de fer-lo, no despres.

**El manifest de release es un artefacte de confianca.** Si algu el pot canviar, pot fer que una
instal·lacio descarregui una imatge que no es la nostra. Publicar-lo a la release de GitHub el posa
darrere el mateix control d'acces que el repositori, i la firma de D6 permet comprovar-ho a part; el
que no fa cap de les dues coses es protegir de que el compte de GitHub quedi compromes.

**El rollback nomes existeix si les migracions el permeten.** Es el risc mes facil de creure resolt
sense estar-ho: el `compose` amb el digest antic torna enrere en segons i dona la sensacio que el
rollback funciona, fins al dia que la migracio hagi eliminat alguna cosa i la versio anterior no
arrenqui. P4 existeix nomes per aixo, i va abans del comandament que la gent fara servir.
