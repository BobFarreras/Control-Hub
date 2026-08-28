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

### Tres buits que P3 va destapar, dels quals en queda un

1. **Les imatges de tercers van per etiqueta, no per digest.** `postgres:17-alpine`,
   `valkey/valkey:8-alpine` i `axllent/mailpit:v1.27` es resolen al que aquella etiqueta vulgui dir
   el dia de la instal·lacio, de manera que dues instal·lacions de la *mateixa* versio de Control
   Hub poden no portar el mateix PostgreSQL. L'invariant de descarregar per digest, doncs, avui
   nomes es cert per a les nostres quatre. Fixar-les vol dir que el manifest les reculli, o sigui
   tocar P2 un altre cop.
2. ~~**Mailpit arrenca en una instal·lacio de produccio.**~~ Resolt per P7, i mes barat del que
   semblava: el perfil va a l'overlay de produccio, que ni desenvolupament ni la CI carreguen mai,
   de manera que alli no es mou res.
3. ~~**El directori d'instal·lacio necessita mes que els fitxers de Compose.**~~ Resolt per P7: la
   release publica `control-hub-install.tar.gz`, amb els fitxers de Compose, l'script que
   PostgreSQL munta, i els dos comandaments a l'arrel.

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
propietat de `root` que `installation.md` ja especifica. **No demana cap contrasenya que pugui
generar** --i, sobretot, no demana la de l'Owner: el que no s'escriu no s'enganxa a cap historial.
L'unica que pregunta es la del relay SMTP, que no es seva i no se la pot inventar; P8 diu com
la tracta.

Al final imprimeix que ha fet i on ha deixat cada cosa, i **que no ha fet**: quins moduls han quedat
apagats, quins connectors falten per configurar, i quan toca el primer backup.

Executar-lo dues vegades no ha de trencar res. Detecta el que ja hi es i pregunta nomes el que
falta.


### El que P7 en va concretar

**El primer Owner no te contrasenya que ningu hagi triat.** L'invariant 8 diu que res del que
l'instal·lador pregunti acaba en un historial, i la contrasenya es la resposta que ho fa dificil:
escrita es a l'historial, impresa es a l'scrollback, i guardada es al disc mentre duri la
instal·lacio. Aixi que no la pregunta. El compte es crea amb 32 bytes de `randomBytes` que ningu no
veu mai i que no son recuperables, i tot seguit l'Owner rep l'enllac per posar-se la seva --el
mateix circuit que fa servir qualsevol altre membre, en comptes d'una segona porta que nomes
existeix per al primer compte. El preu esta acceptat i escrit: aquell correu es l'unic cami cap a
aquell compte, o sigui que si no surt, la instal·lacio no te amo. Per aixo l'SMTP es valida abans i
per aixo el fracas d'enviar-lo es sorollos.

**El bootstrap ha de viure dins la imatge, i no pot ser la imatge de migracions.** El runbook
anomenava «el job OCI equivalent» des del principi i no existia: `bootstrap.ts` nomes corria amb el
codi font. Ara es una segona entrada del bundle de l'API, perque necessita exactament aquell tancat
--Better Auth, el provisionament-- i una imatge que nomes s'executa un cop es una imatge mes per
construir, firmar i recordar de mantenir al dia. Corre amb les credencials de **migracio** i no les
d'aplicacio: `control_hub_app` te `select` sobre `tenants` i res mes, cosa correcta i precisament el
motiu pel qual l'API no pot fer-ho ella sola. La manera de tenir-ho al `compose.yaml` sense que
arrenqui mai es un perfil: un servei sota perfil no surt a cap `up`, `pull` ni `ps` que no
l'anomeni, de manera que es una feina que viu al fitxer en comptes d'un servei que casualment no es
reinicia.

**Tornar a executar-lo es el cas normal, no el rar.** Una primera instal·lacio s'atura a mitges
--falta un registre DNS, l'SMTP no respon-- i la sortida es tornar-hi. Cada resposta ja donada surt
com a valor per defecte llegit de `.env`, i **cap secret ja escrit no es regenera**. Aquesta segona
part no es comoditat: les contrasenyes dels rols les posa un script que PostgreSQL executa sobre un
directori de dades buit i mai mes, o sigui que regenerar-les escriuria una configuracio que no pot
connectar amb la seva propia base, i el simptoma s'assemblaria a un volum corromput i no a una
segona execucio.

**Dues validacions diferents per a dues coses diferents.** Un domini que encara no resol es l'estat
normal d'una primera instal·lacio, i darrere NAT o un balancejador l'adreca pertany legitimament a
una altra maquina: es un avis que algu pot respondre. Un valor que no es un domini es un error de
teclat, i tot el que ve despres --el certificat, les passkeys, l'enllac de l'Owner-- l'hereta. El
mateix amb l'SMTP: es comprova que accepti una connexio, i no s'envia res. Un instal·lador que
demostres que pot enviar correu l'hauria d'enviar a algu, i l'unica adreca que coneix es d'una
persona a qui ningu no ha avisat que tot aixo estigui passant.

**No toca el reverse proxy.** A la maquina que descriu D2, el Traefik ja hi corre i es compartit amb
serveis d'altra gent. L'instal·lador escriu `traefik-control-hub.yaml` al seu propi directori i diu
on copiar-lo; editar la configuracio viva d'un proxy compartit es com una instal·lacio en tomba una
altra. La consequencia es diu clarament al final: **fins que algu no hi copii el fitxer, res no es
accessible des de fora**. *(El contingut d'aquell fitxer era el mateix per a tothom, cosa que P8 va
haver de corregir: la regla de no tocar el proxy es manté, la de no mirar-lo no.)*

**El paquet es un arbre de fitxers, no un YAML.** Es el buit 3 que P3 va destapar: `compose.yaml`
munta `deploy/postgres/init-app-user.sh` des del host, i sense aquell fitxer PostgreSQL arrenca
sense rol d'aplicacio i la fallada apareix molt mes tard com un error de permisos. La release
publica `control-hub-install.tar.gz` amb els sis fitxers de Compose, aquell script, i els dos
comandaments a l'arrel. `install.sh` es publica tambe solt, per poder-lo llegir abans d'executar-lo
--que es tot el que vol dir D7.

**I Mailpit ja no arrenca en produccio**, el buit 2. Es un caca-correus amb
`MP_SMTP_AUTH_ACCEPT_ANY` i no te res a fer en un servidor de client. La solucio va resultar ser
d'una linia i no la que P3 temia: el perfil va a l'overlay de produccio, que ni desenvolupament ni
la CI carreguen mai, de manera que alli no es mou res. El mateix overlay fa `SMTP_HOST` obligatori,
perque un valor per defecte hauria estat una instal·lacio que segueix entregant l'enllac de l'Owner
a un contenidor de la mateixa maquina, en silenci.

**Que les dues meitats no es desviin, ho subjecten proves i no comentaris.** `install.sh` valida el
`release.env` igual que `update.sh`, i `scripts/install.test.mjs` passa cada corrupcio pels dos
scripts en comptes de demanar a qui editi que els mantingui en linia. La llista de moduls que el
runbook publica es compara amb el registre de `packages/config/src/flags.ts`, perque un script de
shell no pot contenir aquella llista sense que se n'aparti. Dotze mutacions sobre `install.sh` --el
`chown`, el mode, la reexecucio, cada peca de la validacio, el domini, l'adreca de l'Owner-- posen
la suite vermella.

### El que P8 en va concretar

P7 es va escriure contra una instal·lacio de mentida. La primera maquina de debo --la de D2, amb
Supabase, n8n i el Traefik dels clients a sobre-- va trobar tres coses en cinc minuts, i totes tres
tenien la mateixa forma: **l'instal·lador donava per suposat l'estat de la maquina en comptes de
mirar-lo**.

**El relay SMTP vol autenticar-se, i el producte no en sabia.** `createMailSender` construia el
transport amb `host`, `port`, `secure` i `from`. Cap proveidor transaccional --Brevo, SendGrid,
Mailgun, Postmark, SES-- accepta correu sense usuari i clau, o sigui que la unica configuracio
possible era un relay obert, que a la practica vol dir cap. I aixo no es un detall de configuracio:
l'invariant que diu que el correu de l'Owner es l'unic cami cap al compte converteix «no es pot
configurar el correu» en «la instal·lacio no te amo».

Aixi que ara pregunta l'usuari i, si n'hi ha, la contrasenya. **L'invariant 8 es mante i no
s'afluixa**: la resposta no s'ecoa a la pantalla, no passa per cap linia d'ordres i no arriba a
`.env` --va a `smtp_password`, un sete fitxer `0400` d'uid 1000, i el contenidor la rep com
`SMTP_PASSWORD_FILE` com qualsevol altre secret. La diferencia amb la de l'Owner es que aquella
l'instal·lador se la pot inventar i aquesta no. Sense usuari no hi ha fitxer i el transport no
autentica, que es el cas de desenvolupament i el d'un relay a la mateixa xarxa.

**Els ports fixos xoquen amb qui ja hi viu.** `.env` portava `POSTGRES_PORT=5432` escrit a foc, i a
la maquina de D2 aquell port es del `supabase-pooler` des del primer dia. El simptoma arribava tard i
lluny de la causa --`docker compose up` amb *port is already allocated*, despres de generar secrets i
escriure configuracio-- i el pitjor era que **no es podia corregir**: `.env` es reescriu sencer a
cada execucio, o sigui que editar-lo i tornar a executar l'instal·lador desfeia l'edicio.

Ara mira quins ports estan lliures abans d'escriure'ls i, si el que voldria esta ocupat, n'agafa un
de lliure i ho diu. **No ho pregunta**, deliberadament: son ports de `127.0.0.1` que ningu no teclegia
mai, i una pregunta condicional mes es una pregunta que en una maquina no surt i desplaça totes les
respostes seguents --el defecte que P7 ja va pagar. I una segona execucio conserva el que hi havia,
com ja fa amb totes les altres respostes: el port es una resposta mes, no una constant.

**El fitxer de Traefik descrivia un Traefik que no era el d'alli.** L'instal·lador escrivia sempre
el mateix `traefik-control-hub.yaml`, amb `certResolver: letsencrypt` i un servei a
`http://127.0.0.1:3001`. A la maquina de D2 les dues coses son falses: el resolver es diu
`myresolver`, i `127.0.0.1` dins del contenidor de Traefik es el propi Traefik. Pitjor: aquell
Traefik corre amb `--providers.docker=true` **i cap provider de fitxers**, o sigui que el fitxer no
tenia on anar. Escrivia una cosa que semblava correcta, que es la pitjor de les tres maneres de
fallar.

La regla de D2 no canvia --**l'instal·lador no edita la configuracio d'un proxy compartit**-- pero
mirar no es intervenir. Ara inspecciona el proxy que ja corre i actua segons el que troba: si va per
etiquetes, escriu `compose.proxy.yaml` amb les etiquetes del seu propi servei `web`, el resolver i
l'entrypoint que aquell Traefik fa servir de debo, i la xarxa externa per on hi arribara; si troba un
provider de fitxers, escriu el YAML amb el resolver real; i **si no ho pot determinar, no s'ho
inventa**: ho diu, escriu el fitxer generic i avisa que el nom del resolver s'ha de comprovar.
Configurar el seu propi servei perque un proxy el trobi es feina seva; tocar el proxy, no.

`update.sh` carrega `compose.proxy.yaml` si hi es, perque altrament la primera actualitzacio
despublicaria la instal·lacio en silenci.

### El que P9 en va concretar

P8 va sortir de la primera instal·lacio real; P9 surt de la primera que va **arrencar**. Amb
l'instal·lador ja adaptat a la maquina, la `v0.4.1` va aixecar-se i despres va fallar quatre
vegades seguides, i les quatre tenien la mateixa forma: **res no havia executat mai l'stack
composat de produccio**. Els E2E arrenquen les aplicacions a `localhost`, on `127.0.0.1:4000` es
l'API de debo i on les variables hi son perque les posa el propi job. La feina que fan `compose`,
`install.sh` i les imatges publicades no la comprovava ningu, i la instal·lacio d'un client va ser
la primera prova d'integracio d'aquell cami.

**Compose ignora la propietat que li demanes per un secret.** `uid`, `gid` i `mode` son atributs de
Swarm; Compose els avisa i els descarta a cada execucio, i un secret declarat amb `file:` es un
bind mount que arriba amb la propietat que te al host. Els vint-i-sis atributs escampats pels
fitxers de compose llegien com si la questio estigues resolta --i `installation.md` ja advertia que
no ho estava, cosa que ningu no va creure fins que va passar. Els set fitxers eren de `root`,
PostgreSQL inicialitza com a uid 70, i cap contenidor podia obrir el seu. Ara els atributs no hi
son, `install.sh` fa el `chown` a cada execucio --no nomes quan crea el fitxer, o una instal·lacio
existent no es podria reparar tornant-lo a executar-- i una prova impedeix que tornin.

**Una destinacio de rewrite es grava quan es compila.** `apps/web/next.config.ts` reenvia `/api` i
`/health` cap a `API_INTERNAL_URL`, i el `pnpm build` del Dockerfile corria sense aquella variable:
la imatge publicada portava a dins `http://127.0.0.1:4000` --ella mateixa-- i responia
`Internal Server Error` a tota peticio del navegador cap a `/api`, l'enllac de verificacio del
primer Owner inclos. El valor en temps d'execucio arriba a `apps/web/src/lib/api.ts`, que es un
cami diferent, aixi que el servidor funcionava i el navegador no.

**Una variable que cap fitxer de compose anomena no arriba enlloc.** `CONTROL_HUB_FLAGS` i
`MCP_ISSUER` s'escrivien a `.env`, es reportaven a la pantalla final i no sortien mai d'alli: el
`--env-file` interpola el fitxer, no exporta res. Una instal·lacio que havia demanat un modul
arrencava amb tots apagats, que es indistingible d'una que no n'ha demanat cap.
`NEXT_PUBLIC_DEFAULT_LOCALE` era pitjor encara: no el llegia ningu, ni tan sols al codi.

I la guarda, que es el que fa que P9 no sigui nomes quatre correccions. Dues, perque cap de les
dues sola hauria vist les quatre:

- **Estatica.** Cada nom que `install.sh` escriu a `.env` l'ha d'anomenar algun fitxer de compose,
  o constar amb el seu motiu a la llista del que es llegeix nomes a la maquina. I cap fitxer de
  compose pot declarar `uid`, `gid` o `mode` en un secret.
- **Executada.** El job `Container image` ja aixecava l'stack; ara tambe demana al contenidor `web`
  una ruta `/api` --l'unica peticio que distingeix una imatge ben construida d'una que respondra
  500 a tothom-- comprova que els moduls escollits han arribat als tres serveis que els llegeixen,
  i torna a aixecar-ho tot amb `compose.production.yaml` i els secrets com a fitxers muntats amb la
  propietat que `install.sh` els dona.

Aixo tanca la verificacio que P2 va deixar oberta: aixecar l'stack de produccio de debo, encara que
sigui amb imatges construides al moment en comptes de descarregades per digest.

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
- **P4** — *Fet, i deliberadament de dues meitats.* La prova de compatibilitat N-1: la suite de
  l'ultima etiqueta contra una base migrada a HEAD, mes una comprovacio estatica de les migracions
  noves. La dinamica sola te un forat mesurat --veure mes avall--, i per aixo no va sola.
- **P5** — *Fet.* El comandament d'actualitzacio: valida la release, fa el backup, descarrega per
  digest, migra, i nomes despres reemplaca. POSIX sh i docker, res mes --una instal·lacio de client
  no te repositori ni Node, i aquest no es el fitxer que ha de comencar a demanar-ne.
- **P6** — *Fet.* El banner i la comprovacio diaria del worker: el worker demana el manifest un
  cop al dia i compara aqui, i `Owner` i `Administrator` veuen quina feina representa
  l'actualitzacio.
  Sense boto, i sense que el navegador consulti res --les tres condicions de D5.
- **P7** — *Fet.* L'instal·lador interactiu: sis preguntes, una per pantalla, validades alli
  mateix; genera tots els secrets ell mateix i no en demana cap; es pot tornar a executar; i crea el
  primer Owner sense que ningu no triï cap contrasenya. Tanca dos dels tres buits que P3 va
  destapar.
- **P8** — L'instal·lador mira la maquina abans d'escriure-hi: autenticacio del relay SMTP com a
  sete secret muntat, ports triats entre els que estan lliures i conservats entre execucions, i la
  configuracio del proxy escrita segons el proxy que hi ha de debo --o, si no es pot determinar, dit
  en comptes d'endevinat. Surt de la primera instal·lacio real, no d'una idea.
- **P9** — Els quatre defectes que va destapar la primera instal·lacio que va arrencar --propietat
  dels secrets, adreca interna de l'API gravada a la imatge, moduls i emissor MCP que no sortien de
  `.env`-- i, sobretot, les dues guardes que els haurien vist: la comprovacio estatica del que
  `.env` promet i el que el compose entrega, i un CI que aixeca l'stack de produccio i li demana
  una ruta `/api` a traves del contenidor `web`. Tanca la verificacio que P2 va deixar oberta.

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

### El que P4 en va concretar

El gate `Previous version` de `ci.yml` te dues meitats, i cap de les dues sola no n'hi ha prou.

**La dinamica** es la prova de debo: migra la base a HEAD, treu un `worktree` de l'ultima etiqueta
`v*.*.*` i executa la seva suite d'integracio contra aquella base. Es exactament el que passa a una
instal·lacio que torna enrere: el codi vell contra l'esquema nou. El runner de migracions es
idempotent, per tant la versio anterior no aplica res --nomes funciona o no funciona.

**L'estatica** llegeix nomes les migracions afegides des de l'ultima etiqueta i rebutja `drop
column`, `drop table`, `drop type`, canvis de nom, canvis de tipus i columnes `not null` sense
valor per defecte, si no hi ha un `-- n-1-safe: <per que>` sobre la sentencia. No li cal base de
dades.

**Per que calen les dues, mesurat i no suposat.** Amb la base a la migracio 0059, els 602 tests de
`v0.3.0` passen. Eliminant `tenants.slug` es tornen vermells de seguida --quatre fitxers, `column
"slug" of relation "tenants" does not exist`. Pero eliminant `tenants.status` **es queden verds**:
els tests vells nomes insereixen `(id, slug, name)` i ningu no llegeix aquella columna. La suite
demostra compatibilitat per a tot el que el codi vell exercita i no diu res de la resta, que es
justament la part que ningu no recorda comprovar. La meitat estatica cobreix aquesta banda.

L'escapatoria es un comentari a la migracio i no una llista d'excepcions en un fitxer a part: una
llista es un lloc on les entrades s'acumulen i ningu no les torna a llegir, mentre que una frase al
costat de la sentencia la llegeix qui revisa la migracio, que es qui encara pot dir que no.

**El gate no se salta mai sol.** `scripts/release-gate.mjs` compta un check `skipped` com una
fallada, o sigui que un job amb `if:` que es saltes bloquejaria totes les releases en comptes de
deixar-les passar. Per aixo el job corre sempre i el cami rapid --sense etiqueta previa, o sense
migracions noves-- es *dins* del job. `release.test.mjs` ho subjecta: si algu hi afegeix un `if:` o
un `needs:`, la suite es posa vermella.


### El que P5 en va concretar

`deploy/update.sh`, POSIX sh i docker i res mes. La decisio que ho va determinar tot: **una
instal·lacio de client no te repositori, ni Node, ni cap eina de construccio**, que era tot el sentit
de P3. Un actualitzador que en demanes una hi torna a posar l'arbre de codi per la porta del darrere.

Per aixo la release publica ara **`release.env` al costat de `release.json`**. El manifest segueix
sent la font --el genera i el valida `release-env.mjs` a CI, on hi ha proves-- pero el que
l'actualitzador descarrega ja es la forma que Compose llegeix. L'alternativa era parsejar JSON amb
expressions regulars dins d'un script de shell, que hauria estat la peca fragil de tota
l'actualitzacio.

**L'ordre es la promesa sencera**: valida, fa el backup, descarrega, migra, i nomes despres
reemplaca. Si les migracions fallen, no s'ha tocat res del que corre --les imatges noves s'han
descarregat pero no s'han arrencat mai-- i el comandament diu que conserva: el backup, el
`release.env` que encara anomena la versio en marxa, i les imatges velles. No hi ha rollback perque
no hi ha hagut canvi.

**El backup es comprova, no es dona per fet.** Un `pg_dump` que ha petat a mig canonada deixa un
fitxer, i un fitxer sense comprovar es indistingible d'un backup fins al dia que algu el necessita.
Es verifica que es llegible (`gzip -t`) i que no es ridiculament petit. La contrasenya no surt mai
del contenidor: es llegeix de l'entorn que `postgres` ja te, o sigui que no passa ni per la linia de
comandes ni per cap historial.

**Validar la release es assumir que ve d'internet.** El que importa no es un fitxer malformat --es
un de plausible. Dues propietats aguanten el pes: totes les imatges van per digest, i **les quatre
comparteixen espai de noms**. Quatre referencies que semblen correctes pero venen de dos registres
no es una forma que una release pugui tenir, i es exactament la forma que tindria una imatge
substituida. Tambe es rebutja qualsevol linia de mes: `release.env` el llegeix Compose com a entorn,
o sigui que el que s'hi coli arriba als contenidors.

Les proves executen l'script de debo --`--check` arriba a la descarrega, la validacio i la
comparacio i s'atura abans de necessitar docker--, i les set mutacions que l'afluixen el posen
vermell: acceptar una etiqueta en comptes d'un digest, acceptar dos registres, acceptar linies de
mes, saltar-se la versio, deixar de verificar el backup, acceptar-ne un de buit, i reemplacar abans
de migrar.


### El que P6 en va concretar

**On es guarda el que el worker troba: a Valkey, no a una taula.** El que es guarda es un fet sobre
un fitxer del servidor d'algu altre, cert fins a la propera mirada; es de la instal·lacio i de cap
tenant, o sigui que una fila en un esquema amb `tenant_id` hauria d'inventar-li un propietari.
Sobreviu un reinici, caduca sol al cap d'una setmana si ningu torna a mirar, i no costa cap
migracio --que per a un fet tan prescindible es el canvi bo en totes direccions. La clau viu a
`packages/contracts`, com un nom de cua: es un acord entre dos processos.

**El manifest te dos lectors i son dos programes diferents.** `scripts/release-manifest.mjs`
l'escriu --Node pelat, dins el workflow, sobre un checkout que ningu ha construit-- i
`packages/contracts/src/release.ts` el llegeix, en TypeScript, dins el worker. Que un format tingui
dues implementacions es un risc de debo, i es respon en comptes d'acceptar-lo: `release.test.ts`
construeix manifests amb el codi del publicador i els llegeix amb el del lector, de manera que el
dia que una banda es desviï de l'altra la suite ho diu.

**La comparacio ordena versions, no en compara la igualtat.** Sembla el mateix i no ho es: una
instal·lacio deliberadament per davant de l'etiqueta publicada --una imatge `edge` que s'esta
provant-- rebria «actualitza» cap enrere. I `1.10.0` contra `1.9.0` es on la comparacio de cadenes
es equivoca. Un avis que menteix un cop es un avis que ningu no torna a llegir.

**Una fallada de xarxa no esborra el que se sabia.** Si la peticio falla, l'estat guardat no es toca:
una comprovacio que no ha pogut arribar a GitHub no sap res de nou, i convertir una actualitzacio
pendent en silenci perque ha fallat un DNS es exactament el fracas que el banner existeix per
evitar.

**«Un cop al dia» te dues meitats.** L'horari de BullMQ n'es una; l'altra es dins la funcio, que no
envia cap peticio si troba una resposta de fa menys de vint hores. Amb aixo, ni reinicis ni repliques
ni execucions manuals poden sumar mes d'una mirada al dia.

**Apagar-ho esborra l'horari, no nomes deixa de crear-ne.** Una branca que nomes s'estalvies
`upsertJobScheduler` deixaria corrent el que hi hagues posat la versio anterior, i llavors
`CONTROL_HUB_UPDATE_CHECK=false` voldria dir «no en surt cap de nova» en comptes de «no en surt cap».
La variable tambe s'anomena explicitament al servei `worker` de `compose.yaml`: aquell fitxer
enumera l'entorn del contenidor, i una variable que no hi es no hi arriba mai --silenciosament.

**El que les proves d'unitat no podien cobrir** es exactament aixo: el cablejat. `scripts/update-check.test.mjs`
subjecta les tres condicions de D5 alli on viuen --que l'interruptor arribi al proces, que apagar-lo
esborri l'horari, que nomes hi hagi una adreca i sigui una constant, que la peticio no porti res que
identifiqui la instal·lacio, que la ruta de l'API no consulti res, i que el runbook digui l'adreca
exacta i com aturar-ho. Sis mutacions que afluixen qualsevol d'aquestes coses la posen vermella.

**El banner no te boto i el navegador no consulta res.** L'API llegeix el que el worker va deixar i
no arriba enlloc; la pantalla rep la feina --quantes migracions, si canvia configuracio-- l'enllac a
les notes, construit a partir del numero de versio i no transportat pel manifest, i el comandament a
copiar. Nomes per a `Owner` i `Administrator`, i comprovat contra la versio que corre abans de
servir-lo: el worker neteja una actualitzacio pendent a la passada seguent, i sense aquesta
comparacio hi hauria fins a un dia en que el banner anomenaria la versio que la persona acaba
d'instal·lar --justament el dia que mira la pantalla per confirmar que ha anat be.

**El rollback nomes existeix si les migracions el permeten.** Es el risc mes facil de creure resolt
sense estar-ho: el `compose` amb el digest antic torna enrere en segons i dona la sensacio que el
rollback funciona, fins al dia que la migracio hagi eliminat alguna cosa i la versio anterior no
arrenqui. P4 existeix nomes per aixo, i va abans del comandament que la gent fara servir.
