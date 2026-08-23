# Especificacio del connector de Vercel (fase 7.4)

> Estat: **proposta**. El propietari va demanar el connector el 23 d'agost de 2026 i s'ha
> implementat el que aquest document fixa. **La superficie queda oberta i no s'ha escrit**: on es
> dibuixa un projecte i quina regla d'alerta jutja un desplegament fallit es la seccio "El que
> queda obert", i te una decisio que no es meva.
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
| Ingress | No. Vercel te webhooks i signen; **no s'implementa a la 7.4** i la rao es a "El que queda obert" |
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

## Pla de proves

Unitaries, amb un `http` fals: no hi ha xarxa a la suite. Cobreixen els vuit criteris, la
paginacio, la finestra, la projeccio camp a camp i el recorregut de totes les peticions per
comprovar on es i on no es el token. Es el mateix esquema que `n8n.test.ts`, que es la referencia.

## El que queda obert

**On es dibuixa un projecte de Vercel.** El connector desa registres correctes; ara mateix ningu
no els ensenya, i cap regla d'alerta els jutja. El model d'infraestructura son **maquines i
serveis**, i un servei pertany a una maquina —`hostId` es obligatori—: un projecte de Vercel no es
de cap maquina, i inventar-ne una que es digui "Vercel" seria posar una mentida a una taula per no
haver de decidir.

Hi ha precedent per a la sortida bona: **les automatitzacions d'n8n**. No son ni maquines ni
serveis; es llegeixen dels registres i tenen la seva propia franja a la pantalla, amb una taula
d'enllac petita per lligar-les a un client. Tres opcions, i la decisio es del propietari:

| Opcio | Que costa | Que es perd |
|---|---|---|
| **Franja propia**, com les automatitzacions | Una migracio d'enllac, un metode de repositori, un cas d'us, una ruta i una franja de pantalla | Res. Es la que diu la veritat |
| **Nomes alertes**, sense pantalla | Una regla `deployment_failed` i prou | No es pot veure que hi ha; nomes t'assabentes quan peta |
| **Forcar-ho a l'inventari** | Poc codi | Una maquina inventada. No |

Si la resposta es la primera, el webhook de Vercel entra alli mateix: signa amb HMAC-SHA256 i el
contracte d'ingress ja l'admet. Fer-lo abans que hi hagi on ensenyar-ho seria fer arribar mes
rapid una cosa que no es dibuixa.
