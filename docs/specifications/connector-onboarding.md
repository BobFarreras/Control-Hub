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

## Model de dades

**Cap taula nova i cap migracio.** Els tres increments llegeixen el que ja hi ha: registres de
connector, maquines, serveis i alertes. Si durant la implementacio en calgues una, es torna aqui
abans d'escriure-la.

## API

Tres rutes noves, totes de lectura, totes darrere la flag `infrastructure` i el permis
`infrastructure:read`:

- `GET /api/v1/infrastructure/connectors/:instanceId/diagnosis` — el C1
- `GET /api/v1/infrastructure/connectors/:instanceId/discovery` — el C3
- El resum ampliat viatja dins la resposta d'inventari que ja existeix — el C2

Amb la flag tancada, les tres son 404, com tota la resta del modul.

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
7. Els filtres son acumulables i no canvien cap estat.
8. El descobriment marca el que ja esta declarat i omple el dialeg amb el `hostname` vist.
9. El descobriment no fa cap consulta a Prometheus.
10. Amb la flag `infrastructure` tancada, les rutes noves responen 404.
11. Cap error del modul no cau a `errorUnknown`: tots porten codi i tots tres idiomes.

## Pla de proves

Proves abans del codi, com sempre.

- **Domini:** els esglaons del diagnostic com a funcio pura sobre un estat; el recompte del resum.
- **Aplicacio:** l'ordre dels esglaons i que s'atura al primer que falla; el descobriment contra
  registres desats, amb i sense coincidencia.
- **API:** els 404 amb la flag tancada; el permis; i una prova que enumera la resposta del
  diagnostic i falla si hi apareix el `baseUrl` desat o qualsevol credencial.
- **Web:** els filtres acumulables; que la pantalla no recalcula cap estat.
- **E2E:** una llavor amb un `instance` declarat i un que no, i el cami de declarar-lo des del
  descobriment.

## Pla d'increments

Un commit per increment, amb la documentacio a dins, i `current-state.md` actualitzat al mateix
commit. Cada un es entregable sol.

| Increment | Que hi entra |
|---|---|
| C1 | El diagnostic: domini, aplicacio, ruta, pantalla, paraules en ca/es/en, i els codis d'error |
| C2 | El resum ampliat, els filtres i la fitxa per maquina |
| C3 | El descobriment: lectura, pantalla, el dialeg preomplert i l'E2E |
