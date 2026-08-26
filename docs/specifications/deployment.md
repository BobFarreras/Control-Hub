# Especificacio de la Fase 9: empaquetat, publicacio i instal·lacio

**Estat:** proposada. D1 i D2 decidides pel propietari el 26 d'agost de 2026; D3 a D7 obertes.

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

**D3 — Que dispara una publicacio: una etiqueta, o cada commit a `develop`?** Oberta.

**D4 — Quant dura el suport d'una versio, i quantes enrere es pot fer rollback?** Oberta. Determina
quantes imatges es conserven al registre i quina finestra promet el runbook.

**D5 — L'avis d'actualitzacio consulta la xarxa des de la instancia, o no consulta res?** Oberta.
Una comprovacio periodica contra GitHub es comoda i es una connexio sortint que l'administrador no
ha demanat. L'alternativa es que nomes ho digui qui executa el comandament d'actualitzar.

**D6 — Firma i SBOM: ara o mes tard?** Oberta. La Fase 9 original els incloia. Signar amb cosign i
publicar un SBOM no es car, pero verificar-ho a l'instal·lador si que afegeix una dependencia mes a
la maquina de qui instal·la.

**D7 — L'instal·lador es un script del repositori o un binari descarregable?** Oberta. Un `curl |
sh` es el que fa tothom i es exactament el patro que no volem ensenyar a normalitzar.

## Publicacio

Un workflow nou, separat de `ci.yml` perque el seu error mode es diferent: la CI protegeix
`develop`, aixo publica artefactes.

1. Construeix les quatre imatges des de `deploy/Dockerfile` --`api`, `worker`, `migrate`, `web`--
   per a `linux/amd64` i `linux/arm64`.
2. Les puja a `ghcr.io/bobfarreras/control-hub-{servei}`.
3. Escriu un **manifest de release**: versio, data, commit, i el digest de cadascuna de les quatre.
4. Adjunta el manifest a la release de GitHub.

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

Com se n'assabenta la instancia depen de D5.

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
- **P2** — El workflow de publicacio i el manifest de release. Verificable descarregant les imatges
  publicades i aixecant l'stack sense el codi font.
- **P3** — `compose.release.yaml` i `release.env`: una instal·lacio que fa `pull` i no `build`.
- **P4** — El comandament d'actualitzacio, amb backup, migracions i rollback.
- **P5** — El banner, un cop D5 estigui decidida.
- **P6** — L'instal·lador interactiu.

Cada increment ha de deixar el sistema instal·lable. P2 sense P3 ja te valor: hi ha imatges que
algu pot provar a ma.

## Riscos

**Els builds de Docker estan bloquejats a la maquina del propietari**, per interceptacio de TLS i
per espai al disc. P2 i P3 nomes es podran verificar a CI o directament a la VPS, i aixo s'ha de
tenir en compte en planificar-los: no hi haura la volta rapida de provar-ho local primer.

**Publicar imatges publiques es un compromis public.** Algu les pot descarregar i dependre'n. D4
existeix per decidir quant val aquest compromis abans de fer-lo, no despres.

**El manifest de release es un artefacte de confianca.** Si algu el pot canviar, pot fer que una
instal·lacio descarregui una imatge que no es la nostra. Publicar-lo a la release de GitHub el posa
darrere el mateix control d'acces que el repositori; D6 decideix si aixo n'hi ha prou.
