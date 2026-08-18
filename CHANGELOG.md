# Changelog

Les versions segueixen [SemVer](https://semver.org/lang/ca/). Aquest fitxer diu **que ha canviat
per a qui fa servir el producte**; el relat tecnic de com s'hi ha arribat es a
`docs/development/history/` i el punt de continuacio a `docs/development/current-state.md`.

## Sense publicar

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
