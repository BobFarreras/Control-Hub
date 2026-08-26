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
| Actualitzacio com a llista de set passos manuals | Res dins el producte diu que n'hi hagi una de disponible. No hi ha **cap** `APP_VERSION` ni `BUILD_SHA` enlloc del codi: una instancia no sap quina versio es a si mateixa. |

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

## Com una instal·lacio nomena la seva versio

Un fitxer `release.env` al directori d'instal·lacio, amb els quatre digests i la versio llegible.
Un overlay `compose.release.yaml` dona `image:` a cada servei llegint-ne els valors, i **no dona
`build:`**, de manera que una instal·lacio de produccio no te ni pot tenir el codi font.

La versio llegible arriba a l'aplicacio com a `APP_VERSION`. Avui no existeix cap variable
d'aquestes: s'ha d'afegir, exposar-la a `GET /health/ready` i ensenyar-la a la pantalla de
seguretat. Sense aixo, una instancia no pot dir que es, i tot el que ve despres no te sobre que
comparar.

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

- **P1** — `APP_VERSION`, exposada a readiness i visible a la pantalla de seguretat. Va primer
  perque tot el que ve despres compara contra ella.
- **P2** — El workflow de publicacio: imatges, firma, SBOM i manifest de release. Verificable
  descarregant les imatges publicades i aixecant l'stack sense el codi font.
- **P3** — `compose.release.yaml` i `release.env`: una instal·lacio que fa `pull` i no `build`.
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
