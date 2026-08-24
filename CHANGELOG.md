# Changelog

Les versions segueixen [SemVer](https://semver.org/lang/ca/). Aquest fitxer diu **que ha canviat
per a qui fa servir el producte**; el relat tecnic de com s'hi ha arribat es a
`docs/development/history/` i el punt de continuacio a `docs/development/current-state.md`.

## Sense publicar

### Consum i costos variables (Fase 8.1)

- Nova seccio **Consum i costos** amb Resum, Costos i Pressupostos, separada de les despeses
  recurrents perque mostra consum variable, cobertura de valoracio i frescor de fonts.
- Els perfils tecnics poden veure volum i salut sense imports; els costos i pressupostos respecten
  els permisos financers, i les accions de pressupost nomes apareixen quan es poden executar.
- Els estats parcials i obsolets expliquen quina dada o font falta en comptes de dependre nomes
  d'un color.
- **OpenCode local** pot enviar tokens a la VPS amb un collector per dispositiu. La connexio surt
  per HTTPS i no inclou converses, codi, paths, diffs ni ordres.

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
