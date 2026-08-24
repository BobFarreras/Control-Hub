# Especificacio del connector de Vercel (fase 7.4)

> Estat: **proposta**. El propietari va demanar el connector el 23 d'agost de 2026 i s'ha
> implementat el que aquest document fixa. La pregunta que quedava oberta —on es dibuixa un
> projecte— **la va respondre el mateix dia**: franja propia, com les automatitzacions d'n8n. El
> que segueix sense fer-se es l'alerta, i esta dit al final.
>
> Especificacions relacionades: `connectors.md` (el contracte), `connector-security.md`
> (l'allowlist i el `guarded-fetch`) i `infrastructure.md` (el model de maquines i serveis).
> Aquest document no en repeteix cap regla: hi remet.

## Problema

Cada web de client viu a Vercel, i les dues coses que van malament alli no les diu ningu:

1. **Un build que peta.** Algu fa push un divendres, el desplegament de produccio falla, i el que
   hi ha servit segueix sent el d'abans. Ningu no se n'assabenta fins que el client demana per que
   no hi es el canvi —o pitjor, fins que ningu no ho demana i el canvi es dona per fet.
2. **Una produccio caiguda.** Un projecte que fa mesos que no es toca pot quedar-se sense
   desplegament valid, pausat per limit de despesa, o amb el domini apuntant enlloc.

Tot dos son fets que Vercel ja sap i que la seva API respon en una crida. El que falta no es la
informacio: es que arribi al mateix lloc on ja miren les VPS i les automatitzacions.

## Abast

Un connector, dues operacions de lectura, cap escriptura. Es el mateix perimetre que `prometheus`
i `n8n`: llegeix el proveidor, en desa una projeccio, i no toca `packages/domain`,
`packages/application` ni `apps/api`.

**Fora d'abast**, i deliberadament:

- **Desplegar, tornar enrere, pausar o esborrar res.** Cap operacio d'escriptura, ni avui ni com a
  extensio prevista: aixo es la fase 7B i te el seu contracte.
- **Els logs de build.** El text d'un build conte variables d'entorn impreses, URLs amb token i
  claus que algu ha fet servir a un script. El que ens diu que un build ha fallat es l'estat, i
  aquell no cal llegir-lo.
- **Analitiques, us i facturacio.** Es una altra pregunta i es d'una altra fase.
- **Els dominis i els certificats.** Ja els llegeix la sonda `blackbox` del Prometheus, i tenir-ho
  dues vegades vol dir tenir dues respostes diferents el dia que discrepin.

## Decisions

### 1. Un projecte es un estat; un desplegament es un esdeveniment

Es la decisio que fa que la resta encaixi, i es la que va costar. El model d'infraestructura
llegeix **estats**: una cosa hi es o no hi es, i el que val es l'ultima lectura. Un desplegament no
es aixo. Un desplegament passa, acaba, i el seguent no el substitueix: "l'ultim build ha fallat" no
vol dir "aixo esta caigut", perque el que hi ha servit segueix essent l'anterior, que va anar be.

Per tant **dues operacions i dues formes**:

- `pull_projects`, forma `state`: un registre per projecte, sobreescrit cada passada, amb l'estat
  actual de la seva produccio. Aixo respon "que hi ha, i com esta ara".
- `pull_deployments`, forma `event`: un registre per desplegament fallit, que no torna mai i
  caduca per edat. Aixo respon "quan i que ha petat".

Barrejar-les seria mentir en una de les dues direccions: o un build fallit apagaria un projecte que
esta perfectament servit, o una produccio caiguda quedaria tapada pel proper build verd.

### 2. La base no es un camp lliure

`baseUrl` es el literal `https://api.vercel.com` i el formulari no admet cap altre valor. A `n8n` i
a `prometheus` la base la posa l'operador perque la instancia es seva i viu on ell la va posar;
aqui el proveidor es un i te una sola adreca. Deixar-lo lliure obriria un cami que no serveix per a
res legitim: **una base que apunta a un host de qui configura la instancia rep el token de Vercel a
la primera passada**. Es tanca a l'esquema, no a una revisio.

Per aixo l'egress es `configured_base_url` i no `operator_allowlist`: no hi ha res a allowlistar,
la destinacio ja esta escrita al codi.

### 3. Nomes els desplegaments que han fallat, i nomes els de produccio

Un desplegament correcte no el mira ningu, i un compte d'agencia en fa desenes al dia. Es demanen
`state=ERROR` i, si `includePreview` no s'activa, `target=production`: mentre algu treballa, els
seus previews peten tot el mati i cap d'aquelles files no es una cosa a fer.

Qui vulgui vigilar tambe els previews ho activa, i llavors ho ha demanat.

### 4. Sense cursor: una finestra fixa, i el motiu es un forat de debo

`n8n` desa una marca d'aigua i para quan reconeix una execucio. Aqui **no**, i la diferencia es
justificada.

L'API de Vercel ordena per **quan es va crear** el desplegament, no per quan va acabar. Un build
que arrenca a les 10:00 i peta a les 10:07 te `created` de les 10:00; si a les 10:05 haguessim
mogut la marca d'aigua a un desplegament posterior, aquella fallada **no es llegiria mai mes**. La
marca d'aigua es correcta per a un identificador que creix quan el fet acaba, i incorrecta per a un
que creix quan el fet comenca.

Aixi que cada passada llegeix la mateixa finestra —`deploymentsWindowHours`, per defecte 24— i
torna `cursor: null`. Es pot fer perque el volum ho permet: un compte d'agencia no fa 500 builds
fallits en un dia, i si en fes tants la pregunta no seria aquesta. Rellegir es gratis: el registre
te la mateixa `externalId` i el desat es un `upsert`.

### 5. Del que Vercel ens dona, en desem una projeccio

La mateixa regla que a `n8n`, per la mateixa rao. Del projecte es queden el nom, el framework,
quan es va crear i l'estat de la seva produccio. Del desplegament fallit: el projecte, l'estat,
l'entorn, quan es va crear, i la branca i el commit.

**Fora, i cadascun pel seu motiu:**

| Camp | Per que no es desa |
|---|---|
| `creator` | Es el nom i el correu d'una persona que treballa per al client. Saber qui va fer el push no fa res per saber que el build ha petat. |
| `meta.githubCommitMessage` | Es text lliure escrit per algu. La branca i el sha identifiquen el build sense obrir la porta a desar el que hi hagi escrit. |
| `build logs`, `env`, `functions` | Vegeu "Fora d'abast": es exactament on viuen els secrets d'un projecte. |

Es queda, en canvi, **l'alies de produccio** del projecte —el domini que serveix. No es cap
adreca de proveidor ni cap secret: es el web public del client, i es el que fa que una fila digui
alguna cosa a qui la llegeix en comptes de `prj_8kQ2...`.

### 6. `productionReady` es un booleu, i ho es a proposit

El registre d'un projecte porta `productionReady: true | false | null`. El motor d'alertes ja sap
llegir un camp booleu d'una lectura i entendre'l com "aixo no respon" (`downFlagsForPrefix` a
`packages/domain/src/infrastructure.ts`). El dia que un projecte es pugui declarar, encendre
l'alerta es **una linia**, no un motor nou.

`null` —un projecte que no s'ha desplegat mai— no es una caiguda i no ho ha de semblar: el motor
nomes reacciona a `false`.

## El connector

| | |
|---|---|
| Config | `baseUrl` (literal `https://api.vercel.com`), `teamId?`, `includePreview: false`, `deploymentsWindowHours` (1..168, per defecte 24) |
| Credencials | `api_token` (capcalera `Authorization: Bearer`) |
| Egress | `configured_base_url`, nomes `https` |
| Operacions | `pull_projects` (`GET /v9/projects`, forma `state`, cada 5 min) i `pull_deployments` (`GET /v6/deployments?state=ERROR`, forma `event`, cada 5 min) |
| Ingress | No. Vercel te webhooks i signen; **no s'implementa ara** i la rao es al final |
| `externalId` | `project:<id>` i `deployment:<uid>` |

**El `teamId` es opcional perque un compte personal no en te.** Un token d'equip, en canvi, no
respon res sense ell: sense `teamId` la mateixa crida torna els projectes personals de qui va
encunyar el token, que son zero, i la pantalla diria "no hi ha res" quan la resposta era "no ho has
dit". Per aixo la comprovacio de salut fa la crida **amb el `teamId` posat**: verifica el token i
l'abast alhora, que es el parell que ha d'estar be.

**El token es una capcalera i prou.** S'obre dins la crida que el necessita i no arriba mai a una
URL, un registre, un log ni un error. Les proves recorren totes les peticions per exigir-ho.

**Una passada de `pull_projects` ha de ser sencera.** Es forma `state`, i retornar el que cabia
caducaria la resta: mes pagines de les que s'accepten llegir en una passada es una **fallada**, no
una truncacio. `pull_deployments`, que es forma `event`, si que pot parar: el que no ha llegit avui
ho llegira a la passada seguent, perque la finestra no s'ha mogut.

## Model de dades

**Cap migracio.** Els registres van a `connector_records`, que existeix des de la `0033`, amb la
seva forma i la seva caducitat. Es exactament el que el contracte de connector va comprar.

## Seguretat

- Cap escriptura cap a Vercel, ni una.
- El token nomes viatja a la capcalera `Authorization`, mai a una query string.
- La destinacio esta fixada al codi; la configuracio del tenant no la pot moure.
- Cap resposta del proveidor es desa sencera: nomes els camps que aquest document nomena.
- Cap log del connector porta el token, l'alies ni el cos de la resposta.

## Criteris d'acceptacio

1. Amb un token valid, `pull_projects` torna un registre per projecte amb l'estat de la produccio,
   i `pull_deployments` nomes els desplegaments fallits de la finestra.
2. Cap peticio porta el token fora de la capcalera `Authorization`.
3. Amb `includePreview` desactivat, cap desplegament de preview arriba a un registre.
4. Un projecte que no s'ha desplegat mai te `productionReady: null`, i no `false`.
5. Cap registre conte el creador, el missatge de commit ni cap camp que aquest document no nomeni.
6. Una resposta amb mes pagines de les acceptades falla a `pull_projects` i nomes avisa a
   `pull_deployments`.
7. Un `401` es `unauthorized` i un `403` es `forbidden`: la diferencia entre "el token no val" i
   "el token no arriba a aquest equip" es la que fa que algu sapiga que tocar.
8. Amb una configuracio que no es la base literal, la instancia no es desa.
9. La franja ensenya una fila per projecte llegit, amb l'estat de produccio i l'ultim build fallit
   com a dues columnes separades.
10. Un projecte sense cap build fallit a la finestra ho diu amb una paraula —«Cap»— i no amb un
    guio ni una cel·la buida, que es llegeixen com una lectura que falta.
11. Retirar l'associacio amb un client conserva la nota.
12. L'enllac sobreviu a la desaparicio del registre del projecte i hi torna a quadrar quan torna.
13. Un tenant no veu mai un projecte ni un enllac d'un altre, i la prova ho exigeix contra
    PostgreSQL amb RLS forcada.
14. La fila diu quan es va crear el projecte i quan es va desplegar el que se serveix, sense que
    aixo obligui a desar cap registre de builds correctes.

## Pla de proves

Del connector (criteris 1-8), unitaries amb un `http` fals: no hi ha xarxa a la suite. Cobreixen
la paginacio, la finestra, la projeccio camp a camp i el recorregut de totes les peticions per
comprovar on es i on no es el token. Es el mateix esquema que `n8n.test.ts`, que es la referencia.

De la franja (criteris 9-13), una capa cadascuna, perque cadascuna respon una cosa diferent:

| Capa | Que demostra |
|---|---|
| `packages/persistence` (integracio, PostgreSQL) | Les dues unions, l'ultim build fallit de cada projecte, i que un tenant no veu res d'un altre amb RLS forcada |
| `packages/application` | Qui pot llegir i qui pot associar, i que la nota sobreviu a retirar el client |
| `apps/api` | Que la resposta no porta ni adreca del proveidor ni token, camp a camp |
| `apps/web` | Que la franja desapareix sota un recollidor que no llegeix projectes |
| `tests/e2e` | Que una fila diu alhora que produccio serveix i que l'ultim build va fallar |

## La franja de projectes (increment V2)

**Decidit el 23 d'agost de 2026: franja propia, com les automatitzacions d'n8n.** Un projecte de
Vercel no es ni una maquina ni un servei —un servei porta `hostId` obligatori—, i inventar una
maquina que es digui "Vercel" seria posar una mentida a una taula per no haver de decidir. Les
altres dues sortides es descarten: nomes alertes deixaria el producte sense poder respondre "que
tinc desplegat", i forcar-ho a l'inventari es la maquina inventada.

### El que ensenya una fila

Una fila per projecte, i respon les dues preguntes de la seccio "Problema" alhora:

| Columna | D'on surt |
|---|---|
| Projecte | `data ->> 'name'`, i a sota el recollidor i el `framework` —el que es, no una columna a part |
| Domini | `data ->> 'productionAlias'`, o res si no n'hi ha |
| Produccio | `productionReady`: **serveix**, **caiguda**, o **mai desplegada** quan es `null`; a sota, quan es va desplegar el que se serveix |
| Creat | `data ->> 'createdAt'`, com a **data** i no com a edat: un projecte fet al gener no es una lectura antiga |
| Ultim build fallit | El registre `deployment:<uid>` mes recent d'aquell projecte, amb la branca i quan |
| Client | L'enllac, si algu l'ha fet |
| Llegit | `last_seen_at` de la passada, perque cap xifra observada es dibuixa sense edat |

**«Quan es va desplegar el que se serveix» es l'ultim build bo, i surt de franc.** Produccio nomes
apunta a un desplegament que va acabar, aixi que mentre la fila digui *serveix*, aquella data **es**
la del darrer build correcte. Es el motiu pel qual la decisio 3 —desar nomes els desplegaments que
han fallat— no deixa cap pregunta sense resposta: el build bo que interessa ja hi es, i la resta
seria l'historial de builds de tothom.

**L'estat de produccio i l'ultim build fallit son dues columnes i no una**, que es la decisio 1
duta a la pantalla: un projecte pot estar servint perfectament i haver tingut un build fallit fa
deu minuts, i aixo es exactament el que algu ha de veure. Ajuntar-les obligaria a triar quina de
les dues veritats s'amaga.

### Model de dades

Una migracio, `0046_vercel_project_links.sql`, amb una sola taula:

`infra_project_links` — `tenant_id`, `instance_id`, `external_id`, `customer_id?`, `notes?`,
`created_at`, `updated_at`. Clau `(tenant_id, instance_id, external_id)`, FK composta cap a
`connector_instances (tenant_id, id)` amb `on delete cascade`, FK cap a `customers` amb
`on delete set null`, RLS `enable` + `force` i la politica d'aillament de sempre.

**Per que una taula nova i no `infra_automation_links`.** Les dues tenen avui la mateixa forma
—instancia, identificador extern, client, nota— i la temptacio es fusionar-les. No: una taula
compartida necessitaria una columna `kind` que **cada consulta ha de recordar filtrar**, i el dia
que algu se n'oblidi un projecte sortira a la taula d'automatitzacions. El cost de la duplicacio
es una migracio de vint linies; el cost de l'altre cami es un defecte que no es veu.

**L'enllac sobreviu al registre**, com el d'una automatitzacio i pel mateix motiu: un registre
s'esborra quan el proveidor deixa d'anomenar-lo i es torna a crear si torna, i una associacio
comercial no pot desapareixer perque un projecte va estar dues setmanes pausat.

### API

Dues rutes, calcades a les d'automatitzacions perque fan la mateixa feina:

| Ruta | Permis | Que fa |
|---|---|---|
| `GET /api/v1/infrastructure/projects` | `infrastructure:read` | Tots els projectes llegits, amb l'estat, l'ultim build fallit i l'enllac |
| `PUT /api/v1/infrastructure/projects/:instanceId/:externalId/link` | `infrastructure:operate` | Associa amb un client, o retira l'associacio amb `customerId: null` i conserva la nota |

La resposta **no porta cap adreca de proveidor**: viatgen `instanceId` i `externalId`, i el domini
de produccio, que es public i es del tenant. L'auditoria desa el client, mai la nota.

### La pantalla

Una franja mes a la pantalla d'infraestructura, entre les automatitzacions i les alertes, i **subjecta
al filtre de recollidor** igual que la resta (decisio de la 7.3): qui mira el recollidor de maquines
no vol una taula de projectes buida, la vol absent.

**L'enllac al domini es compon i es comprova al servidor**, com el d'una automatitzacio i pel mateix
motiu: un alies es el que ha contestat un proveidor, i res del que arriba d'un proveidor es
converteix en desti al navegador. Nomes un nom de maquina net —sense port, sense cami, sense
credencials— arriba a ser una ancora, sempre `https`; la resta es dibuixa com a text.

### El que segueix sense fer-se, i es diu

**Cap alerta salta encara quan un build peta.** Aixo demana una regla `deployment_failed` —alterar
el `check` de `infra_alert_rules.kind`, avaluar-la al domini i deixar-la triar al formulari— i es
un increment a part. Fins llavors, un build fallit es veu **quan algu mira la pantalla**, que es
mes del que hi havia i menys del que fa falta.

**El webhook de Vercel tampoc.** Signa amb HMAC-SHA256 i el contracte d'ingress ja l'admet; el que
compra es immediatesa, i la immediatesa nomes val la pena quan hi ha alerta que la faci servir.

**Les visites tampoc, i no es nomes que quedi per fer.** Vercel exposa `GET
/v1/query/web-analytics/visits/{count,aggregate}` amb el mateix token de nomes lectura que ja fem
servir per a projectes i desplegaments —tecnicament encaixaria a la mateixa crida. Pero **Web
Analytics es un producte a part que cada projecte ha d'activar explicitament**, i no es fa amb
l'API: es un interruptor al tauler de Vercel per projecte, mes afegir `@vercel/analytics` (o el
`<script>` equivalent) al codi de la web. Comprovat contra el compte real: dels projectes que ja
veu aquest connector, cap no el te activat —`GET .../visits/count` hi respon `404 Web Analytics
not found`, no pas zero visites. Implementar-ho avui voldria dir una franja que, per a tots els
clients actuals, nomes sap dir que no sap res, i cap manera de distingir «encara no ha vingut
ningu» de «ningu no ho ha activat». Quan un client faci aquest pas pel seu compte, la crida es
trivial d'afegir: es el mateix patro que projectes i desplegaments, amb un `dataset` mes.