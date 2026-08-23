# Especificacio de l'onboarding de connectors (fase 7.3)

> Estat: **proposta**, pendent d'aprovacio. No s'ha escrit codi.
>
> Especificacions relacionades: `infrastructure.md` (el model d'infraestructura i el connector
> `prometheus`), `connectors.md` (el contracte) i `connector-security.md` (l'allowlist i el
> `guarded-fetch`). Aquest document no en repeteix cap regla: hi remet.

## Problema

La 7.2 va deixar la cadena tecnica sencera —el connector llegeix, el planificador el crida, les
lectures es projecten sobre maquines i serveis i la pantalla les ensenya— i va deixar la part
humana sense fer. Connectar la primera VPS de debo va costar una tarda, i cap dels tres entrebancs
era un defecte del codi:

1. La migracio `0037` no estava aplicada, i el dialeg responia **"No s'ha pogut completar
   l'operacio"**. Un 404 sense codi acaba a `errorUnknown`, que es la frase que no diu res.
2. Ningu no sabia que calia posar l'origen a `CONNECTOR_INTERNAL_ALLOWLIST` ni que Prometheus
   nomes escolta a `127.0.0.1` de dins la maquina. Tots dos fets son certs, correctes i estaven
   escrits nomes en un runbook.
3. Un cop connectat, la pantalla no diu enlloc **que** esta veient el connector. Si el `hostname`
   declarat i l'etiqueta `instance` no coincideixen caracter per caracter, les lectures arriben,
   no s'enganxen a res, i el que es llegeix es "Cap lectura" —el mateix que si la VPS fos morta.

El cost no era teclejar. Era no saber que fallava. Aixo es el que ataca la fase.

## Abast

Tres increments, independents entre ells i entregables per separat.

- **C1 — La comprovacio guiada.** Que el panell digui que li falta i que has de fer, amb l'ordre
  ja escrita, en comptes de fer-te llegir un runbook o endevinar un 404.
- **C2 — La infraestructura amb moltes maquines.** El resum general de salut, i filtres, perque
  una segona VPS no converteixi la pantalla en una llista il·legible.
- **C3 — El descobriment.** Ensenyar els `instance` que el connector veu i encara no s'han
  declarat, amb un boto per declarar-los. El descobriment proposa; una persona declara.

## Fora d'abast

- **Executar res.** Cap ordre de shell, cap `ssh`, cap escriptura a `.env`, cap canvi al tallafocs.
  Vegeu la primera decisio.
- **Desar credencials d'acces a maquines.** Cap clau SSH, cap contrasenya de root, cap `sudo`.
- **Cap connector nou.** La fase treballa amb `n8n` i `prometheus`, els dos que ja hi ha.
- **Instal·lar res a la VPS.** Ni `node-exporter`, ni `cadvisor`, ni `blackbox_exporter`.
- **Reescriure el tauler d'automatitzacions.** El C2 hi afegeix; no el redissenya.

## Decisions

### El programari diagnostica i escriu ordres; no n'executa cap

Perque el panell obris el tunel per tu, li hauries de donar una clau SSH amb shell a la maquina, i
llavors el pitjor cas d'un panell compromes deixa de ser "algu sap quanta RAM gastes" i passa a ser
"algu te totes les teves maquines". El runbook `connect-a-vps.md` ho diu des del primer paragraf:
Control Hub demana l'API de consulta i res mes.

A mes, construir una ordre de shell a partir d'un camp de formulari on algu escriu una adreca es
injeccio d'ordres de manual. I el tunel SSH es, en si mateix, un pegat de desenvolupament: en
produccio no n'hi ha d'haver cap, perque el worker ha de correr on ja arriba al Prometheus.
Automatitzar-lo seria invertir en la peca que volem esborrar.

Per tant el C1 **genera** l'ordre amb els valors ja substituits, diu **on** s'ha d'executar —al
teu ordinador, no a la VPS— i despres **comprova** el resultat. Qui l'executa es una persona.

### L'allowlist es de desplegament i no s'edita des de cap pantalla

`CONNECTOR_INTERNAL_ALLOWLIST` no es de tenant i no ho sera. Un formulari que hi deixes afegir un
origen deixaria que un tenant apunti un connector a la base de dades del propi panell. El C1 pot
dir que hi falta i ensenyar la linia per copiar; no la pot escriure.

### El descobriment proposa, una persona declara

Un `instance` que apareix a Prometheus no es una maquina que vulguem inventariar: un exportador
d'una altra flota, un target de proves o un `cadvisor` que ja esta cobert per la maquina que
l'hostatja son tots `instance` que no volem com a fitxa. Declarar automaticament convertiria la
pantalla en un abocador que ningu no netejaria, i faria desapareixer la decisio de que es teu.

El descobriment, per tant, **no escriu res**. Proposa, i qui te `infrastructure:operate` decideix.

### Un sol inventari amb filtres, no una subseccio per connector

Agrupar per connector agrupa per *com ho llegim*, que es un detall d'implementacio, i no per *que
es la cosa*. Dues VPS llegides per dos Prometheus partirien una sola flota en dues pestanyes, i el
dia que una maquina la llegissin dos connectors no tindria on anar. El filtre respon la mateixa
pregunta sense trencar l'inventari.

## C1 — La comprovacio guiada

### El diagnostic

Es una operacio de lectura sobre una instancia de connector ja creada, que respon **la primera
cosa que falla** de la cadena, en ordre, i s'atura alli. L'ordre no es arbitraria: cada esglao
nomes te sentit si l'anterior es cert.

| # | Que es comprova | Si falla, que es diu |
|---|---|---|
| 1 | La flag `infrastructure` es oberta | (no arriba: sense flag no existeix la ruta) |
| 2 | Les migracions que el modul necessita estan aplicades | quina falta i quina ordre l'aplica |
| 3 | L'origen del `baseUrl` es a `CONNECTOR_INTERNAL_ALLOWLIST` | la linia exacta per copiar a `.env` |
| 4 | El `guarded-fetch` arriba al `baseUrl` | l'ordre del tunel, amb l'adreca ja substituida |
| 5 | La resposta es un Prometheus (`vector(1)`) | que respon una altra cosa en aquell port |
| 6 | El connector veu almenys un `instance` | que Prometheus no raspa res, i on mirar-ho |
| 7 | Algun `instance` coincideix amb un `hostname` declarat | quins veu i quins hi ha declarats |

L'esglao 2 es el que hauria estalviat la tarda. L'esglao 7 es el que separa "la maquina es morta"
de "l'has escrit diferent".

### Que no pot dir mai

El diagnostic **no repeteix mai el `baseUrl`, ni cap adreca de proveidor, ni cap credencial** a la
resposta, al log ni a l'auditoria. Diu *quin* esglao ha fallat i quina forma te la solucio. On la
frase necessita l'adreca —l'ordre del tunel de l'esglao 4— es composa amb el que **la persona
acaba d'escriure al formulari**, no amb el que hi ha desat a la configuracio.

### Els errors del dia a dia

Independentment del diagnostic, cap resposta d'infraestructura no ha de poder acabar a
`errorUnknown` per no portar codi. Cada error del modul porta el seu `code`, i el diccionari te la
frase de tots tres idiomes. Es una prova, no una intencio: la suite enumera els codis i falla si
un no te traduccio.

## C2 — La infraestructura amb moltes maquines

### El resum

Avui `InfrastructureOverview` compta automatitzacions i alertes, i no compta ni maquines ni
serveis: la seccio del B4 va arribar despres. S'hi afegeix el que hi falta, amb la mateixa regla de
sempre —les tres respostes les decideix `currentReading` al domini i la pantalla no en recalcula
cap:

- maquines: quantes n'hi ha, i quantes responen, no responen o no es veuen
- serveis: el mateix repartiment
- el que ja hi ha: automatitzacions i alertes, sense tocar

### Els filtres

Sobre l'inventari, i acumulables: per entorn, per resposta de la lectura (`up` / `down` /
`unknown`), i per connector d'origen. Cap d'ells no canvia el que es llegeix; nomes que se'n
mostra.

### La fitxa d'una maquina

Una ruta propia per maquina, perque una VPS amb quinze serveis no cap dins una targeta. Ensenya el
que ja sap la 7.2 —les xifres del host i la taula de serveis— i hi afegeix d'on ve cada lectura i
quan es va llegir.

## C3 — El descobriment

Una operacio de lectura que torna, per a una instancia de connector, els `instance` que ha vist a
la darrera passada, cadascun amb: com es diu, si ja esta declarat i, si ho esta, contra quina
fitxa. El que no esta declarat porta un boto que obre el dialeg de declarar **ja omplert** amb el
`hostname` correcte —que es exactament l'unic camp que es va escriure malament la primera vegada.

Es llegeix del que ja hi ha desat als registres del connector. **No dispara cap consulta nova** a
Prometheus: obrir una pantalla no ha de poder generar trafic cap enfora.

## C4 — El selector de serveis

El C3 proposa **maquines**; aixo proposa **serveis**. Mateixa idea un nivell mes avall, i la
mateixa regla de sempre: el programari ensenya el que el col·lector ja ha vist, i una persona tria.

Una operacio de lectura torna, per a una instancia de connector, tot el que hi ha desat als seus
registres que **pot ser un servei** —els prefixos `container:`, `probe:` i `backup:`— i de cada un
diu la clau sencera, quina mena sembla, quin nom se li proposa, on s'ha vist i si ja esta declarat.
Els prefixos `host:` i `workflow:` no hi surten: el primer es una maquina i ja el proposa el C3, i
el segon no es infraestructura.

La pantalla es una llista amb **una casella per servei**, agrupada per mena, a la fitxa de la
maquina. El que ja esta declarat hi surt marcat i sense casella: es informacio, no una accio.
Marcar-ne uns quants i confirmar **els declara tots alhora, en una sola transaccio**, amb el nom
proposat, la mena del prefix i l'estat esperat `up`. Qualsevol d'ells s'edita despres des de la
fitxa, com un servei declarat a ma.

### El que la llista no sap, i no fingeix saber

Un registre de contenidor porta l'etiqueta del col·lector que l'ha vist —el cAdvisor—, **no la de
la maquina declarada**, que surt del `node_exporter`. Son dues etiquetes de la mateixa maquina i
res, a les dades, no les lliga. Aixi que la llista **ofereix tot el que la instancia veu**, digui el
que digui aquella etiqueta, i la mostra al costat de cada fila perque qui tingui dues maquines les
sapiga distingir. Filtrar per una correspondencia inventada amagaria serveis reals sense dir per
que, i un servei amagat costa mes que un de sobrer.

### Els noms proposats

El nom surt de la clau sense el prefix, que es el que una persona reconeix: `container:n8n` es
proposa com a `n8n`. La taula demana entre 3 i 120 caracteres, aixi que un nom que quedaria mes
curt cau a la clau sencera i un de mes llarg es talla. **El nom es una proposta i s'edita; la clau
no**, perque es el que fa la coincidencia.

## C5 — Una pantalla que depen del que has triat

### El problema

La pantalla ho ensenya tot alhora, sempre. Qui obre Infraestructura per mirar la VPS es troba al
davant la taula de vint-i-dues automatitzacions d'un n8n que en aquell moment no li importa, i qui
la obre per mirar les automatitzacions es troba les maquines. Son dues feines diferents amb el
mateix titol.

I ho ensenya ocupant lloc encara que no tingui res a dir: un panell d'alertes de l'alcada d'un
panell sencer per escriure-hi «cap alerta viva», una fila de maquina amb el mig buit, i el
descobriment ocupant una pantalla per ensenyar un desplegable. L'espai que sobra no es neutre:
empeny cap avall el que si que importa.

### El selector, i que canvia

Un selector de recollidor a dalt de tot, **amb el mateix component de seleccio que fa servir la
resta del producte**, no amb pindoles proprias d'aquesta pantalla. Opcions: «Tot» i una per cada
instancia habilitada.

La regla del que s'ensenya no es una taula de correspondencies entre menes de connector i
seccions —aixo envelliria el dia que hi hagi un connector nou— sino una sola frase: **una seccio
que no te res d'aquell recollidor no es dibuixa.** Amb el Prometheus triat no hi ha
automatitzacions perque no n'ha llegit cap; amb l'n8n triat no hi ha maquines pel mateix motiu. El
dia que un connector llegeixi les dues coses, sortiran les dues, sense tocar res.

La tria viu a la barra d'adreces i sobreviu a recarregar. **Un identificador d'instancia no es una
adreca de proveidor**: es el mateix UUID que ja viatja pels camins de l'API, i la regla que ho
prohibeix parla d'adreces i credencials, no d'identificadors nostres.

### Els KPI

Compactes —la majoria porten un sol numero i n'ocupen sis— i **segueixen la seleccio**:
«Automatitzacions 22» no es dibuixa quan el que mires es una VPS. Un comptador d'una cosa que la
seleccio no conte no s'ensenya a zero: no s'ensenya.

### Els panells que no tenen res a dir

Cap panell buit ocupa l'espai d'un panell ple. Les alertes passen a ser una franja que nomes hi es
quan hi ha alguna cosa viva; el descobriment i el selector de serveis deixen de ser panells de la
pantalla general i van dins la vista del recollidor, que es on tenen sentit.

### Els filtres que queden

El filtre «per connector d'origen» del C2 desapareix d'aqui: ja es el selector de dalt, i
preguntar-ho dues vegades es com una llista acaba reduida a un recollidor que no es el del titol.

Els altres dos —entorn i resposta— passen del grup de caselles al component de seleccio general, i
amb aixo deixen de ser acumulables: una resposta cada un, amb «Qualsevol» com a primera. **Es una
correccio deliberada del C2**, no un descuit: cap caselleta i un «Qualsevol» trian volen dir el
mateix, i nomes un dels dos es llegeix d'un cop d'ull. Qui necessiti dos entorns alhora te la
flota sencera, que es el que hi havia abans de demanar res.

### Que no canvia

- **L'inventari segueix sent un de sol.** Aixo es un filtre de que es mira, no una subseccio per
  connector: la decisio de mes amunt segueix dempeus, i el C2 ja declarava el filtre «per connector
  d'origen». Aixo el converteix en el principi que ordena la pantalla.
- **No canvia res del que es llegeix ni del que es desa.** Cap taula nova, cap migracio, cap ruta
  nova: la pantalla ja llegeix l'inventari i les integracions, i la seleccio nomes decideix que se'n
  dibuixa.

## C6 — La maquina d'un cop d'ull

### El problema

El C5 va deixar la pantalla neta i seguia sense servir. Amb el Prometheus triat, tot el que deia
d'una VPS amb vint contenidors era una fila de maquina i tres etiquetes darrere d'un boto. El
recollidor tenia els vint contenidors desats; ningu no els dibuixava. La consequencia practica es
que despres de mirar la pantalla calia obrir un terminal igualment, que es exactament el que el
modul existeix per estalviar.

### Que s'ensenya

Tot el que el recollidor ha llegit, agrupat per mena —maquines, contenidors, sondes, copies— i
**cada cosa amb l'estat que se'n sap ara mateix** i les xifres que porta la lectura.

**L'estat es el mateix que fa servir l'inventari**, decidit per la mateixa funcio (`currentReading`)
sobre els mateixos registres, tant si algu ho ha declarat com si no. Un contenidor dibuixat
«Respon» aqui i «No respon» a la fitxa de la maquina seria el producte discutint amb ell mateix.

**Es llegeix sol en obrir.** El boto que hi havia guardava la pregunta equivocada: el motiu
d'obrir aquesta pantalla *es* aquesta pregunta. Res no surt cap a Prometheus en cap dels dos
casos —les dues rutes llegeixen registres ja desats— i per aixo el cost de treure el boto es una
consulta a la nostra propia base.

### Que no canvia

**Declarar segueix sent una decisio d'una persona.** La decisio «el descobriment proposa, una
persona declara» segueix dempeus i les alertes segueixen sent nomes sobre el que s'ha declarat.
L'unic que canvia es que ara es decideix amb l'estat al davant en comptes d'una clau nua.

### La comanda del tunel

La que proposa el diagnostic porta tres opcions que no son decoracio, cadascuna una manera com la
primera versio va fallar fent-la servir:

- `-L 127.0.0.1:<port>:...` — sense el `127.0.0.1:` del davant, `ssh` publica el port a totes les
  interficies i un Prometheus que es va deixar deliberadament al loopback de la VPS acaba obert a
  la xarxa d'aquest ordinador.
- `-o ExitOnForwardFailure=yes` — sense aixo un reenviament que no s'ha pogut obrir deixa l'`ssh`
  connectat i sense reenviar res, i el panell diu que l'adreca no respon mentre hi ha una sessio
  amb bona cara.
- `-o ServerAliveInterval=30` — un tunel sense transit el tanca el que hi hagi al mig, en silenci,
  i les lectures s'aturen sense error enlloc.

## C7 — El defecte del C6, i la pantalla que hi cabia

### El defecte: vint contenidors vius dibuixats morts

El C6 va donar estat a tot el que el recollidor llegeix. L'estat era fals: **tot el que no estava
declarat sortia «No respon»**, i com que en una VPS acabada de connectar no hi ha res declarat,
sortien «No respon» els vint contenidors, les cinc sondes i la copia de seguretat. La pantalla
deia que la maquina era morta mentre la maquina anava.

La causa es una linia sola. La lectura es demanava a `readInventoryState`, i aquella consulta
**selecciona els registres pel conjunt de claus ja declarades**: per a un servei que ningu no ha
declarat —que son precisament els que es descobreixen— no en torna cap. I `currentReading`, quan
la passada s'ha fet i el registre no hi es, respon `down`, que es la resposta correcta a la
pregunta que li estaven fent i una mentida sobre la que li volien fer.

La correccio es llegir els registres alla on ja es sabia quins son: `readServiceDiscoveryState`
ja consultava `connector_records` d'aquell recollidor per triar els prefixos descobribles, i ara
en torna el registre sencer i la frescor de les operacions. `discoverServices` decideix l'estat
amb aquells, i cap consulta nova s'hi afegeix —n'hi ha una de menys.

**Per que la prova no ho va veure.** La prova d'aplicacio sembrava el registre al repositori fals
per `inventoryState`, que es exactament el cami que a produccio no en tenia cap. Provava que
`currentReading` sap decidir, no que la dada hi arriba. La prova d'ara sembra el que el repositori
real torna, sense res declarat, que es el cas que fallava.

### El buit que quedava

El C5 i el C6 van treure panells buits i en van deixar la forma. Aquesta pantalla ho corregeix
amb quatre decisions, cap d'elles decorativa:

- **Els comptadors son una franja, no fitxes.** Cada xifra tenia caixa, vora i el seu propi
  encoixinat per dir un numero. Ara son cel·les d'una mateixa franja separades per una linia: el
  numero al davant, la paraula a sota i el desglos en petit. Ocupen el que diuen.
- **El selector porta la marca del proveidor.** Una llista de recollidors es llegeix per quin
  proveidor es cadascun molt abans que pel nom que algu li va posar. La marca es la nostra, en el
  color del proveidor, mai el seu logotip ni res demanat a un servidor de fora.
- **El filtre puja a la linia del titol.** Titol, filtres i el boto d'afegir eren tres bandes
  apilades, cada una gairebé buida, fent una sola pregunta entre les tres.
- **La franja de «cap alerta» ocupa el que diu.** Una banda de l'ample de la pantalla amb sis
  paraules a dins es llegeix com un panell que no ha carregat.

- **L'espai entre bandes el posa la pila, no cada banda.** Un marge a cadascuna es un marge a
  mantenir en ordre cada cop que se n'afegeix, se'n treu o se'n mou una, i el que passava era
  exactament aixo: la franja d'alertes tocava el panell de sota.

### Tot el que hi ha, alhora

**Sense recollidor triat es dibuixen tots.** Fins ara no se'n dibuixava cap, amb l'argument que
una llista de dos recollidors junts no diu res de cap dels dos. L'argument era bo i responia una
altra pregunta: no s'han de barrejar en una llista, i per aixo cadascun te el seu panell sota el
seu nom. Qui obre Infraestructura vol la salut de les maquines sencera i d'un cop, no una pantalla
que li demana una tria abans de dir-li res.

**Un recollidor que no llegeix res d'aixo no es dibuixa.** Un n8n llegeix automatitzacions, que
tenen la seva taula en aquesta mateixa pantalla; preguntar-li quines maquines i quins contenidors
veu es una pregunta sense subjecte, i respondre-hi «encara no ha desat cap lectura» es un panell
disculpant-se per una pregunta que ningu no li ha fet. **Una fallada si que es dibuixa**: no poder
preguntar-ho val la pena dir-ho.

**Cada cosa es una fitxa, i un grup gros s'emporta la fila.** Vint contenidors en columna al
costat d'un grup que en te un es una barra de despaçament amb mig ample buit al costat. A partir
de vuit, el grup ocupa la fila sencera i hi escampa les seves fitxes. El nom va primer i l'estat
a sota: una columna de vint es recorre buscant un nom, i l'estat es el que es mira quan ja s'ha
trobat.

**Cada grup es plega.** Vint contenidors son el que algu ve a buscar el dia que alguna cosa va
malament i desplaçament tots els altres dies. El plec s'obre pel que no esta be: un grup amb
alguna cosa caiguda o sense veure surt obert, i un grup on tot respon surt tancat amb el recompte
i el desglos al damunt. Es fa amb `<details>`, que es l'unic control que el navegador ja dona
resolt al teclat, al lector de pantalla i a la cerca dins la pagina.

**El selector de serveis de la fitxa ensenya l'estat.** La casella es marca amb el que la cosa fa
ara mateix al costat, no amb una clau nua. I quan una maquina no te cap servei declarat, la frase
diu on mirar en comptes de deixar la pantalla morta.

## Model de dades

**Cap taula nova.** Els increments llegeixen el que ja hi ha: registres de connector, maquines,
serveis i alertes.

**Una migracio, i nomes una: la mena `backup`.** La restriccio de `infra_services.kind` admetia
`container`, `http`, `database` i `automation`, i una copia de seguretat no es cap de les quatre.
Declarar-la com a `automation` faria funcionar l'alerta i deixaria la pantalla dient una cosa que
no es, que es la mena de mentida petita que despres ningu no recorda per que hi era.

## API

Tres rutes noves, totes de lectura, totes darrere la flag `infrastructure` i el permis
`infrastructure:read`:

- `GET /api/v1/infrastructure/connectors/:instanceId/diagnosis` — el C1
- `GET /api/v1/infrastructure/connectors/:instanceId/discovery` — el C3
- El resum ampliat viatja dins la resposta d'inventari que ja existeix — el C2
- `GET /api/v1/infrastructure/connectors/:instanceId/services` — el C4, el que es pot declarar
- `POST /api/v1/infrastructure/hosts/:hostId/services` — el C4, declarar-ne uns quants alhora.
  **Es l'unica de les cinc que escriu**, i per tant l'unica que demana `infrastructure:operate`

Amb la flag tancada, totes son 404, com tota la resta del modul.

## Permisos i tenancy

Llegir el diagnostic i el descobriment es `infrastructure:read`. Declarar una maquina o un servei
des del descobriment segueix sent `infrastructure:operate`, exactament el mateix control que el
dialeg d'avui: el descobriment canvia com s'hi arriba, no qui pot fer-ho. L'aillament entre
tenants no es toca.

## Seguretat

- Cap ordre executada, cap escriptura a `.env`, cap credencial d'acces a maquines desada.
- Cap adreca de proveidor ni cap secret a una resposta, un log, una query string o el repositori.
- El descobriment no genera trafic cap enfora: llegeix registres ja desats.
- El diagnostic no obre cap connexio que el `guarded-fetch` no obriria igualment, ni afegeix cap
  excepcio de TLS.
- El diagnostic es una operacio de lectura i per tant **no s'audita**; declarar des del
  descobriment s'audita igual que declarar des del dialeg, perque es la mateixa operacio.

## Criteris d'acceptacio

1. Amb la migracio del modul sense aplicar, el panell diu quina falta i quina ordre l'aplica.
2. Amb l'origen fora de l'allowlist, ensenya la linia exacta per copiar i no la desa enlloc.
3. Amb el tunel tancat, ensenya l'ordre del tunel amb l'adreca substituida i diu que va al PC.
4. Amb tot obert i el `hostname` mal escrit, diu quins `instance` veu i quins hi ha declarats, en
   comptes de dir "Cap lectura".
5. Cap resposta del diagnostic no conte el `baseUrl` desat, cap credencial ni cap adreca desada.
6. El resum compta maquines i serveis pel seu estat, i els numeros surten de `currentReading`.
7. Els filtres no canvien cap estat (acumulables fins al C5; una resposta cada un a partir d'alla).
8. El descobriment marca el que ja esta declarat i omple el dialeg amb el `hostname` vist.
9. El descobriment no fa cap consulta a Prometheus.
10. Amb la flag `infrastructure` tancada, les rutes noves responen 404.
11. Cap error del modul no cau a `errorUnknown`: tots porten codi i tots tres idiomes.
12. El selector ofereix `container:`, `probe:` i `backup:`, i cap altre prefix.
13. El que ja esta declarat surt marcat i sense casella, i no es pot declarar dues vegades.
14. Declarar-ne uns quants es **una sola transaccio**: si un falla, no se'n desa cap.
15. El selector tampoc no fa cap consulta a Prometheus.

16. Triar un recollidor amaga les seccions que no tenen res d'aquell recollidor.
17. Un comptador d'una cosa que la seleccio no conte no es dibuixa, ni tan sols a zero.
18. Cap panell buit no ocupa l'espai d'un panell ple.
19. La tria del recollidor es a l'adreca i sobreviu a recarregar.
20. Els filtres d'entorn i de resposta fan servir el mateix component de seleccio que la resta del
    producte.

21. El que el recollidor llegeix surt agrupat per mena i cada cosa amb el seu estat, declarada o no.
22. L'estat d'una cosa sense declarar el decideix la mateixa funcio que el d'una de declarada.
23. Obrir la vista d'un recollidor no envia res a cap proveidor.
24. La comanda del tunel lliga el reenviament al loopback i no publica el port a la xarxa.
25. L'estat d'una cosa sense declarar es el que en diu el registre del recollidor, no `down` per
    no estar declarada.
26. Sense cap recollidor triat es dibuixa el que llegeix cadascun, cada un sota el seu nom.
27. Un grup de coses on tot respon surt plegat, i un que en te alguna de caiguda o sense veure,
    obert. Plegar i desplegar es fa amb el teclat.
28. Cap marca de proveidor demana res a cap servidor de fora.
29. Un recollidor que no llegeix res del que aquesta vista ensenya no dibuixa cap panell. Una
    fallada en si que en dibuixa un.
30. Un grup amb mes de vuit coses ocupa la fila sencera i les escampa; cap banda de la pantalla
    en toca una altra.

## Pla de proves

Proves abans del codi, com sempre.

- **Domini:** els esglaons del diagnostic com a funcio pura sobre un estat; el recompte del resum;
  la proposta de serveis a partir de registres, amb els prefixos que no hi entren i els noms que
  cauen fora dels limits de la taula.
- **Aplicacio:** l'ordre dels esglaons i que s'atura al primer que falla; el descobriment contra
  registres desats, amb i sense coincidencia.
- **API:** els 404 amb la flag tancada; el permis; i una prova que enumera la resposta del
  diagnostic i falla si hi apareix el `baseUrl` desat o qualsevol credencial.
- **Web:** els filtres; que la pantalla no recalcula cap estat; que la seleccio de recollidor
  amaga les seccions buides i els comptadors que no li pertoquen; i que el recompte d'un tros de
  la flota surt de les lectures que ja porten estat, sense tornar a jutjar-ne cap.
- **E2E:** una llavor amb un `instance` declarat i un que no, i el cami de declarar-lo des del
  descobriment; marcar dos serveis del selector i veure'ls a la fitxa de la maquina; i triar el
  recollidor de Prometheus i comprovar que la taula d'automatitzacions **no hi es**.

## Pla d'increments

Un commit per increment, amb la documentacio a dins, i `current-state.md` actualitzat al mateix
commit. Cada un es entregable sol.

| Increment | Que hi entra |
|---|---|
| C1 | El diagnostic: domini, aplicacio, ruta, pantalla, paraules en ca/es/en, i els codis d'error |
| C2 | El resum ampliat, els filtres i la fitxa per maquina |
| C3 | El descobriment: lectura, pantalla, el dialeg preomplert i l'E2E |
| C4 | El selector de serveis: la migracio de la mena `backup`, la lectura, la declaracio en bloc, la pantalla i l'E2E |
| C5 | La pantalla per recollidor: el selector, els KPI que segueixen la seleccio, els panells buits que deixen d'ocupar lloc, els filtres amb el component generalitzat i l'E2E |
| C6 | La maquina d'un cop d'ull: l'estat de tot el que el recollidor llegeix, la vista en dues columnes i la comanda del tunel que no publica el port |
| C7 | La correccio de l'estat de les coses sense declarar, la franja de xifres, els grups plegables i tots els recollidors alhora |
