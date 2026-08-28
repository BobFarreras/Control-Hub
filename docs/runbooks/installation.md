# Runbook d'instal·lacio de Control Hub

> **On es aixo.** La `v0.4.1` es va instal·lar el 28 d'agost de 2026 en una VPS compartida amb
> altres serveis, darrere un Traefik que ja hi corria, amb un relay real i un domini real: aquest
> document ja no descriu un cami previst, sino un que algu ha recorregut. En va destapar quatre
> defectes --la propietat dels secrets, l'adreca interna de l'API gravada a la imatge, els moduls
> que no arribaven als contenidors i l'emissor MCP-- tots amb la mateixa forma: res no havia
> executat mai l'stack composat de produccio. La `v0.4.2` els tanca i afegeix a CI el pas que els
> hauria vist. El reverse proxy no viu en aquest repositori i no s'edita mai: l'instal·lador mira
> el que ja corre i, o be escriu les etiquetes que aquell proxy llegeix sol, o be deixa un fitxer
> que copia la persona que instal·la. `docs/specifications/deployment.md` diu per que.

## Model d'alta

Control Hub no ofereix registre public. Cada instal·lacio crea un tenant i un primer
`Owner` mitjancant un bootstrap administratiu d'un sol us. Despres, `Owner` o
`Administrator` conviden membres amb rols i permisos explicits.

Cap client comparteix base de dades, secrets o domini amb una altra instal·lacio en
el model self-hosted. El model intern continua sent tenant-aware per permetre una
futura modalitat SaaS sense redissenyar l'autoritzacio.

## Recorregut d'una instal·lacio comercial

### 1. Preparacio

- VPS Linux compatible, Docker Engine i Compose v2.
- Domini DNS controlat pel client.
- SMTP transaccional per verificacions, invitacions i recuperacions.
- Emmagatzematge extern xifrat per backups.
- Release OCI immutable i manifest de versions verificat.

### 2. Instal·lacio

Un comandament. Es descarrega el paquet de la release, s'extreu, i s'executa des d'alli:

```sh
curl -fsSLO https://github.com/BobFarreras/Control-Hub/releases/latest/download/control-hub-install.tar.gz
mkdir -p /opt/control-hub && tar -xzf control-hub-install.tar.gz -C /opt/control-hub
cd /opt/control-hub && sudo ./install.sh
```

Descarregar i despres executar, mai `curl | sh` (D7): entre les dues linies hi ha el moment en que
algu pot llegir que s'executara. `install.sh` es publica tambe com a fitxer solt de la release,
precisament per poder-lo llegir abans.

Pregunta sis coses, una per pantalla i amb el que ja s'ha respost a la vista: **domini**, **correu i
nom del primer Owner**, **organitzacio**, **SMTP**, **quins moduls**, i **on van els backups**. Cada
resposta es valida alli mateix --el domini ha de resoldre, l'SMTP ha d'acceptar una connexio-- i no
tres passos mes tard, quan tornar enrere vol dir tornar a fer-ho tot.

**No demana cap contrasenya que pugui generar.** Els sis secrets seus surten de `/dev/urandom` i
van directament a `$SECRETS_DIRECTORY` com a fitxers `0400`: `postgres_admin_password`,
`postgres_app_password`, `better_auth_secret`, `database_url`, `migration_database_url` i
`connector_key_ring`. Cap d'aquests valors passa per la pantalla ni per `.env`. **La de l'Owner
tampoc la demana**: rep un enllac i se la posa ell. El que no s'escriu no s'enganxa a cap
historial.

Cada fitxer es propietat del **usuari que el llegeix**, no de `root`: uid 70 els dos de PostgreSQL
i uid 1000 la resta. No es una preferencia --es l'unic lloc on aixo es pot decidir. Compose ignora
`uid`, `gid` i `mode` en un secret, i munta el fitxer amb la propietat que te a la maquina, aixi
que un secret de `root` es un secret que el seu contenidor no pot obrir. El directori segueix sent
`0700` de `root`, o sigui que anomenar un propietari aqui no dona acces a ningu que no en tingues.

L'instal·lador aplica la propietat **a cada execucio**, no nomes quan crea el fitxer: una
instal·lacio feta amb la `v0.4.1` te els set fitxers de `root` i no arrenca, i tornar a executar
l'instal·lador es com es repara sense que ningu hagi de saber quin fitxer cal canviar.

L'unica que pregunta es la del relay SMTP, que no es seva i no se la pot inventar. S'escriu amb
l'eco apagat i acaba a `smtp_password`, un sete fitxer `0400` d'uid 1000, sense passar mai per
`.env`.

**Es pot tornar a executar.** Cada resposta ja donada surt com a valor per defecte llegit de `.env`,
cap secret ja escrit es regenera --refer-lo deixaria PostgreSQL amb el vell, perque el rol es crea
un sol cop sobre un directori de dades buit-- i una organitzacio que ja existeix no es un error.
Aturar-se a mitges i tornar-hi es el cas normal d'una primera instal·lacio.

Al final imprimeix on ha deixat cada cosa i, sobretot, **que no ha fet**: no ha tocat Traefik, no ha
configurat cap connector, no ha fet cap backup, i no hi ha res programat que copii els backups fora
de la maquina.

#### El domini i el TLS

L'instal·lador no instal·la cap reverse proxy i **no n'edita cap**. A la VPS que D2 descriu, Traefik
ja hi corre i es compartit amb serveis d'altra gent; un instal·lador que n'editi la configuracio
viva es com una instal·lacio en tomba una altra.

Pero mirar no es intervenir. Abans, escrivia sempre el mateix `traefik-control-hub.yaml`, amb
`certResolver: letsencrypt` i un servei a `http://127.0.0.1:3001`. A la maquina de D2 les dues coses
son falses --el resolver es diu una altra cosa, i `127.0.0.1` dins del contenidor de Traefik es el
propi Traefik-- i aquell Traefik ni tan sols llegeix fitxers: corre amb `--providers.docker`. O
sigui que el fitxer no tenia on anar. Escrivia una cosa que semblava correcta, que es la pitjor de
les tres maneres de fallar.

Ara inspecciona el proxy que ja corre i fa una de tres coses:

| El que troba | El que fa |
| --- | --- |
| Traefik amb `--providers.docker`, i en pot llegir xarxa, entrypoint i resolver | Escriu `compose.proxy.yaml` amb les etiquetes del seu propi servei `web`. **No s'ha de copiar res**: es carrega amb la resta de la pila i Traefik el troba sol. |
| Traefik amb un provider de fitxers | Escriu `traefik-control-hub.yaml` amb el resolver i l'entrypoint reals. Copiar-lo al directori dinamic i recarregar. |
| Res, o no prou per estar-ne segur | Escriu `traefik-control-hub.yaml` generic, **diu quins valors son una suposicio** i quins ha pogut llegir. |

El resolver i l'entrypoint els busca primer als arguments del mateix Traefik
(`--certificatesresolvers.<nom>.acme...`, `--entrypoints.<nom>.address=:443`) i, si alli no hi son
--es habitual tenir-los en un fitxer estatic--, a les etiquetes dels contenidors que aquell Traefik
ja encamina. Llegir-ho d'un vei segueix sent llegir aquesta maquina. **El que no fa mai es
inventar-se un nom**: un resolver inventat es una configuracio que sembla acabada i no treu mai cap
certificat, i per aixo, quan no el sap, no escriu les etiquetes.

A `compose.proxy.yaml` el port del `loadbalancer` es el **3001, el de dins del contenidor**, i no el
que s'ha publicat a `127.0.0.1`: Traefik arriba al web per la xarxa compartida, on el port publicat
no existeix. I el servei `web` es queda a les dues xarxes (`application` i la del proxy) perque una
llista en un overlay substitueix en comptes de fusionar-se, i deixar-hi nomes la del proxy seria un
web que Traefik veu i que no arriba a la seva propia API.

`update.sh` carrega `compose.proxy.yaml` si hi es. Sense aixo, la primera actualitzacio tornaria a
aixecar els contenidors sense les etiquetes i l'adreça deixaria de respondre sense res a cap log.

**Si s'ha escrit el fitxer i no les etiquetes, fins que no es copii res no es accessible des de
fora.**

#### Els ports de 127.0.0.1

Quatre serveis publiquen un port a `127.0.0.1`: el web, l'API, PostgreSQL i Redis. En una maquina
compartida no tots quatre estan lliures --a la de D2, el `5432` es del `supabase-pooler` des del
primer dia-- i abans es donaven per bons: `docker compose up` fallava amb *port is already
allocated* despres d'haver generat els secrets i escrit la configuracio.

Ara l'instal·lador mira que hi ha escoltant abans d'escriure `.env`, i si el port que voldria esta
ocupat n'agafa el seguent lliure i ho diu:

```
Ports
  web: 3001 is taken, using 3002.
  postgres: 5432 is taken, using 5433.
```

**No ho pregunta.** Son ports interns que ningu no teclegia mai, i una pregunta condicional mes es
una pregunta que en segons quina maquina no surt i desplaça totes les respostes seguents.

**Una segona execucio conserva els que ja hi havia i no torna a mirar**, perque en un re-run qui
te aquells ports ocupats es la mateixa instal·lacio: mirar-ho la faria fugir dels seus propis
ports, i amb ells de l'adreça que se li va donar al reverse proxy. Si cal canviar-ne un, s'edita
`.env` i el valor editat es el que la seguent execucio llegira com a seu.

En una maquina sense `ss` ni un `netstat` POSIX no es pot mirar res: es queden els ports preferits
i, si un esta ocupat, torna a fallar a `docker compose up` com abans. No hi ha manera de fer-ho
millor sense demanar-li a la maquina alguna cosa que no te.

#### El relay SMTP i la seva credencial

Gairebe cap relay transaccional accepta una sessio sense autenticar, i el primer missatge que
rebutjaria es l'enllac amb que l'Owner entra al seu propi compte. Per aixo l'instal·lador pregunta
l'usuari del relay i, si n'hi ha, la contrasenya.

Cap proveidor concret no esta cablejat enlloc: el que cal es un host, un port i, gairebe sempre,
una credencial. A Resend l'usuari es literalment `resend` i la contrasenya es una API key, cosa
que va be al model d'aqui --se'n genera una de nova, es respon la pregunta i la vella es revoca,
sense tocar res mes. Sigui quin sigui, el domini del remitent s'ha de verificar amb SPF i DKIM
**abans** d'instal·lar: l'instal·lador prova la connexio al relay, i el bootstrap hi envia
l'enllac de l'Owner tot seguit.

**Totes dues o cap.** Un usuari sense contrasenya autentica amb una de buida i el relay rebutja
cada missatge; una contrasenya sense usuari es un secret muntat que ningu no llegeix. La
configuracio refusa arrencar amb mitja credencial, i l'instal·lador s'atura abans d'escriure res.
Deixar l'usuari en blanc es la manera --l'unica-- de configurar un relay sense credencials: Mailpit
en desenvolupament, o un relay a la mateixa xarxa de confianca.

| On viu | Que hi ha |
| --- | --- |
| `SMTP_USER` a `.env` | L'usuari. No es secret, i es el que decideix si es carrega l'overlay. |
| `smtp_password` a `$SECRETS_DIRECTORY` | La contrasenya, `0400` d'uid 1000, muntada a `api` i `bootstrap`. |
| `compose.production.smtp.yaml` | El muntatge. Nomes es carrega quan `SMTP_USER` te valor. |

L'overlay va a part de `compose.production.yaml` perque una entrada `secrets:` anomena un cami que
ha d'existir: una instal·lacio sense credencial no podria arrencar amb aquest bloc al fitxer base.
El `worker` no el rep --no envia correu-- i el `web` no rep cap secret.

En una segona execucio l'usuari torna a sortir com a valor per defecte i la contrasenya es pot
deixar en blanc per conservar la que hi ha. Aquest es l'unic secret que l'instal·lador si que
reescriu quan se n'escriu un de nou: es d'algu altre i canvia. Si s'esborra l'usuari, el fitxer es
queda on era i l'overlay deixa de carregar-se; esborrar-lo es una decisio manual.

#### Moduls

`CONTROL_HUB_FLAGS` a `.env`, separats per comes. Un nom que no sigui d'aquesta llista s'ignora i
l'API ho diu al log en arrencar. La llista viu a `packages/config/src/flags.ts` i una prova
comprova que aquesta taula no se n'aparti.

| Modul | Que encen |
| --- | --- |
| `projects_and_time` | Projectes, imputacio de temps, barems i rendibilitat. |
| `attendance` | Registre de jornada, correccions i conciliacio amb les hores imputades. |
| `connectors` | Contracte de connectors, vault de credencials, sortides i webhooks firmats. |
| `infrastructure` | Infraestructura i n8n: registres, operacions programades, alertes. |
| `usage_costs` | Ingesta d'us de proveidors, valoracio reproduible i pressupostos informatius. |
| `mail` | Importacio de la bustia de suport i respostes confirmades. |
| `connector_oauth` | OAuth delegat per a connectors: autoritzacio, refresc i revocacio. |
| `connector_actions` | Accions asincrones confirmades i correu de sortida. |
| `credential_catalog` | Cataleg de metadades i navegacio guardada cap a credencials a Bitwarden. |
| `mcp` | Servidor MCP, servidor de recursos OAuth 2.1 i cataleg d'eines de nomes lectura. |

#### Secrets muntats en produccio

Produccio no passa secrets com a valors d'entorn. Preparar un directori fora del checkout,
propietat de `root`, i indicar-lo amb `SECRETS_DIRECTORY`. Cada fitxer conte exactament un valor,
acabat opcionalment amb un salt de linia:

| Fitxer | Lector dins el contenidor |
|---|---|
| `database_url` | UID 1000, API i worker |
| `migration_database_url` | UID 1000, job de migracio |
| `better_auth_secret` | UID 1000, API |
| `postgres_admin_password` | UID de PostgreSQL |
| `postgres_app_password` | UID de PostgreSQL |
| `connector_key_ring` | UID 1000, API i worker, nomes amb connectors |
| `smtp_password` | UID 1000, API i bootstrap, nomes si el relay demana credencials |
| `google_oauth_client_secret` | UID 1000, worker, nomes si Google esta configurat |
| `microsoft_oauth_client_secret` | UID 1000, worker, nomes si Microsoft esta configurat |

El directori no pot ser llegible pel grup o altres. Els fitxers d'aplicacio han de ser `0400` i
propietat de l'UID 1000; els dos de PostgreSQL, de l'UID 70 de la imatge fixada.

**La propietat es decideix aqui i enlloc mes.** Compose ignora `uid`, `gid` i `mode` en un secret
--son atributs de Swarm, i ho avisa a cada execucio-- i un secret declarat amb `file:` es un bind
mount que arriba al contenidor amb la propietat que te al host. Aquest document ja ho advertia i
els fitxers de compose el contradeien declarant els tres atributs, cosa que llegia com si la
questio estigues resolta; la primera instal·lacio real va arrencar amb els set fitxers de `root` i
cap contenidor podent obrir el seu. Els atributs ja no hi son: `deploy/install.sh` fa el `chown` i
`scripts/container-secrets.test.mjs` impedeix que tornin.

Si prepares el directori a ma --els dos secrets d'OAuth no els crea l'instal·lador-- valida-ho al
host abans de desplegar:

```bash
ls -ln "$SECRETS_DIRECTORY"
```

Arrencada del nucli:

```bash
SECRETS_DIRECTORY=/etc/control-hub/secrets docker compose \
  --env-file .env --env-file release.env \
  -f compose.yaml -f compose.release.yaml -f compose.production.yaml up -d --wait
```

Si el relay demana credencials, afegir `-f compose.production.smtp.yaml` --es el que munta
`smtp_password` a `api` i `bootstrap`, i exigeix `SMTP_USER`.

Amb el vault de connectors, afegir `-f compose.production.connectors.yaml`. Per Gmail, afegir
`-f compose.production.google.yaml`; per Microsoft 365,
`-f compose.production.microsoft.yaml`. Els overlays de proveidor son independents i nomes
exigeixen el seu client ID i el seu secret. El key ring entra a API i worker; cada client secret,
nomes al worker. No muntar mai aquest directori al web.

Quan els fitxers provenen de Bitwarden Secrets Manager, no s'escriuen manualment: seguir
`docs/runbooks/bitwarden-secrets-deployment.md`, que valida IDs, versio, permisos i rollback abans
de retirar la release anterior.

### 3. Arrencada i migracions

1. Descarregar imatges OCI per digest, mai `latest`. Ho fa `compose.release.yaml` sol: llegeix els
   quatre digests de `release.env` i cap servei nostre hi conserva `build:`, o sigui que no hi ha
   res que pugui compilar-se ni per equivocacio amb `up --build`.
2. Executar el job de migracions amb credencials administratives temporals.
3. Arrencar API, worker i web amb el rol runtime de minim privilegi.
4. Verificar healthchecks, logs redaccionats i connectivitat SMTP.

Les migracions no formen part de l'arrencada normal de l'API. Una fallada atura el
desplegament i conserva la versio anterior disponible per rollback.

Aquests quatre passos els fa `install.sh` sol. Queden escrits aqui perque son el que s'ha de
comprovar quan alguna cosa no ha anat be, i perque una instal·lacio que s'aixeca a ma --per exemple
despres d'una restauracio-- els segueix igualment.

### 4. Primer Owner

L'instal·lador el crea al final, i **ningu no tria cap contrasenya per a ell**. El compte es crea
amb una contrasenya de 32 bytes que no es mostra, no es guarda i no es recuperable, i tot seguit
l'Owner rep el correu per posar-se la seva --el mateix circuit que fa servir qualsevol altre membre
de la instal·lacio, en comptes d'una segona porta que nomes existeix per al primer compte.

De manera que l'unic cami cap a aquell compte es aquell correu, i per aixo l'SMTP es valida abans:

1. L'Owner obre l'enllac, es posa contrasenya i verifica l'adreca.
2. Activa TOTP abans d'operar. L'MFA es obligatoria i no es negocia.
3. Des d'alli convida la resta amb rols i permisos explicits.

Si l'SMTP no funcionava, el compte existeix pero l'enllac no ha sortit: es arregla l'SMTP i
s'utilitza **«he oblidat la contrasenya»** a la pantalla d'entrada. No es torna a executar el
bootstrap --es nega quan ja hi ha una organitzacio, que es exactament el que fa que tornar a
executar l'instal·lador sigui segur.

A ma, si cal fer-ho separat de l'instal·lador:

```sh
docker compose --env-file .env --env-file release.env \
  -f compose.yaml -f compose.release.yaml -f compose.production.yaml \
  --profile bootstrap run --rm bootstrap
```

El servei `bootstrap` viu darrere un perfil de Compose: no arrenca amb cap `up`, no surt a cap `ps`
i s'ha de demanar pel seu nom. Porta les credencials de migracio i no les d'aplicacio, perque
`control_hub_app` te `select` sobre `tenants` i res mes --cosa correcta, i precisament el motiu pel
qual l'API no pot fer aixo ella sola.

En desenvolupament el cami segueix sent `pnpm bootstrap:owner`, que si que accepta
una contrasenya per `.env` perque alli no hi ha correu que valgui.

### 5. Membres

- No hi ha sign-up public.
- `Owner` i `Administrator` envien invitacions amb expiracio i un sol us.
- El destinatari verifica el correu, defineix la seva propia contrasenya i activa MFA.
- El backend assigna permisos des de la membership del tenant, no des del formulari.
- Desactivar un membre revoca sessions i credencials personals.
- Les identitats de maquina utilitzen service accounts i scopes, mai usuaris compartits.

El flux d'invitacions administratives s'ha de completar abans de distribuir la primera
release instal·lable a tercers.

### 6. Validacio d'acceptacio

- Login, verificacio, recuperacio, MFA i revocacio provats.
- Separacio de rols `Owner`, `Administrator` i `Technical` verificada.
- API, worker, cua, base de dades i correu saludables.
- Backup inicial executat i restauracio provada en un entorn net.
- URL, certificat, timezone, locale i branding aprovats pel client.
- Runbook d'incidencies i canal de suport lliurats.

## Desenvolupament local

1. Crear `.env` a partir de `.env.example`.
2. Substituir tots els secrets i la contrasenya de bootstrap.
3. Executar `pnpm dev:all`.
4. Executar `pnpm bootstrap:owner` nomes si la base no conte cap tenant.
5. Consultar el missatge de verificacio a Mailpit: `http://localhost:8025`.
6. Entrar a `http://localhost:3001`, verificar el compte i activar MFA.

`pnpm dev` nomes inicia processos. `pnpm dev:all` prepara infraestructura, aplica
migracions i inicia l'aplicacio.

## Comprovacio d'actualitzacions

Un cop al dia, **el worker** demana un fitxer i compara aqui. Quan hi ha una versio nova, els rols
`Owner` i `Administrator` veuen un avis a dalt de qualsevol pantalla que diu **quina feina
representa** --quantes migracions porta i si canvia configuracio-- amb l'enllac a les notes i el
comandament a copiar. L'avis no te cap boto que actualitzi: aplicar una actualitzacio vol dir
substituir contenidors, i una pantalla que ho pogues fer necessitaria el socket de Docker.

**Que surt d'aquesta maquina, exactament:**

| | |
| --- | --- |
| Peticio | `GET https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.json` |
| Cos | cap |
| Capceleres | nomes `accept: application/json` |
| Frequencia | una cada 24 hores, com a maxim |
| Qui la fa | el contenidor `worker`. **Mai el navegador** |

No s'envia la versio instal·lada, ni el nombre d'usuaris, ni cap identificador, ni res que
distingeixi una instal·lacio d'una altra: el fitxer es el mateix per a tothom i la comparacio es fa
aqui. El que igualment es revela es la IP del servidor i que existeix, i aixo no es pot evitar
consultant --per aixo es pot apagar.

**Per apagar-ho**, a `.env`:

```sh
CONTROL_HUB_UPDATE_CHECK=false
```

i reiniciar el worker. No vol dir «deixa d'avisar»: vol dir que **no surt res** d'aquesta maquina.
La comprovacio programada s'esborra en arrencar, de manera que la que hi hagues deixat la versio
anterior tampoc no queda corrent. Amb aixo apagat, saber que hi ha una versio nova es feina de qui
la va instal·lar.

El navegador no consulta res, ni amb aixo ences ni amb aixo apagat. Llegeix el que aquesta
instal·lacio ja sabia.

## Actualitzacio

Un comandament al directori d'instal·lacio:

```sh
./update.sh --check   # que hi ha de nou, sense tocar res
./update.sh           # actualitza
```

Fa, en aquest ordre: llegeix la release nova i la valida, **fa el backup**, descarrega les imatges
per digest, executa el job de migracions, i **nomes si aixo acaba be** reemplaca els serveis.

Si les migracions fallen s'atura alli. L'stack anterior segueix dret --no se n'ha tocat res-- i el
comandament diu que ha fet i que conserva: el backup, el `release.env` que encara anomena la versio
que corre, i les imatges velles, que no s'esborren. No cal desfer res perque no s'ha fet res.

Aixo son els set passos manuals que aquest runbook demanava abans. El que hi guanyem no es comoditat:
una llista de set passos es una llista que algu executa a les 23:00 amb alguna cosa trencada, i el
pas 2 --el backup-- es el que se salta, perque els altres sis semblen la feina de debo.

**El que el comandament no fa:** no comprova les firmes de les imatges (D6 diu explicitament que
verificar no s'exigeix; qui vulgui pot fer-ho a part amb `cosign verify`), i no valida els fluxos
critics despres d'arrencar --aixo segueix sent feina de qui actualitza.

**Rollback.** Mentre duri la finestra d'una versio: `cp release.env.previous release.env` i tornar a
aixecar l'stack. Si les migracions ja havien passat, cal restaurar tambe el backup, i el comandament
imprimeix les tres linies exactes quan aixo passa.

## Desinstal·lacio i exportacio

Abans de retirar una instal·lacio s'exporten les dades acordades, es verifica el backup,
es revoquen connectors i credencials, i s'aplica la politica de retencio. Eliminar
contenidors no elimina automaticament volums ni backups.
