# Guia operativa de workspaces per agents

Aquesta guia es per al propietari i per qualsevol agent de programacio. Les normes obligatories
son a `AGENTS.md`; aqui hi ha les ordres del dia a dia.

## Quan s'utilitza

Sempre que dues tasques puguin estar actives alhora. Cada agent necessita el seu directori,
branca, `.env`, PostgreSQL, Valkey, Mailpit, ports i build output. Obrir dues terminals dins el
mateix checkout no crea aillament.

## 1. Crear una tasca

Des del repositori coordinador net:

```powershell
pnpm agent:workspace create CH-241 codex mailbox-ui develop
```

Arguments:

1. ticket estable (`CH-241`);
2. agent en kebab-case (`codex`, `claude`, `opencode`);
3. slug curt de la tasca;
4. referencia base, `develop` per defecte.

L'ordre crea al directori pare una carpeta com
`Control-Hub-ch-241-mailbox-ui` i la branca
`agent/codex/ch-241-mailbox-ui`. No copia el `.env` actual: genera secrets locals i un bloc de
ports nou. La terminal mostra les URLs, mai els secrets.

No hi ha cap port de host global ni cap nom de projecte Compose compartit. El `.env` generat
declara tots els ports publicats i un `COMPOSE_PROJECT_NAME` unic. En el checkout normal,
Compose deriva el nom del projecte del directori; dins un workspace d'agent utilitza el nom
generat. Els ports interns `3001`, `4000`, `5432`, `6379`, `1025` i `8025` es mantenen estables
intencionadament: son contractes privats de la xarxa Docker i no poden col·lidir entre projectes.

## 2. Preparar-lo

```powershell
Set-Location "..\Control-Hub-ch-241-mailbox-ui"
corepack enable
pnpm agent:provision
```

`provision` executa la instal·lacio immutable, aixeca PostgreSQL, Valkey i Mailpit d'aquell
workspace i aplica totes les migracions a la seva base buida. Docker Desktop ha d'estar actiu.
Les ordres Turbo escriuen a `.turbo-workspace` dins aquest mateix filesystem; no comparteixen la
cache ni els logs del checkout coordinador.

Despres:

```powershell
pnpm dev
```

La URL exacta es a `.agent/workspace.json` i tambe es mostra amb:

```powershell
pnpm agent:workspace status
```

Per tant, l'agent ha d'incloure aquesta URL exacta al seu handoff; no s'ha de pressuposar
`localhost:3001`.

## 3. Declarar el scope

L'agent edita el camp `scope` de `.agent/task.json`, per exemple:

```json
{
  "scope": ["apps/web/src/components/support-mailbox.tsx", "packages/i18n/src/index.ts"]
}
```

Abans de modificar codi:

```powershell
pnpm agent:validate
```

Una coincidencia exacta amb un workspace actiu retorna `SCOPE_COLLISION`. Aixo obliga a coordinar
el contracte o serialitzar el fitxer compartit. No es un lock distribuït ni prediu qualsevol
conflicte semantic.

## 4. Provar el que nomes es veu amb un navegador

La suite autenticada de Playwright no corre dins un workspace acabat de crear, i el motiu no es
obvi: `agent:provision` prepara la base de desenvolupament, pero `seed-e2e` es nega a escriure a
cap base el nom de la qual no acabi en `_e2e`. Es una guarda deliberada -- el script reescriu el
compte que troba -- i vol dir que cada workspace necessita una segona base i un segon entorn.

Un cop per workspace: crear `control_hub_e2e` al PostgreSQL d'aquell workspace, escriure un
`.env.verify` que sigui una copia del `.env` amb ports propis, aquella base i secrets nous,
aplicar-hi les migracions i sembrar-hi la llavor. Despres ja s'hi pot llancar la suite.

Detalls que costen una tarda si no es diuen:

- **Els ports del stack de verificacio no els reparteix ningu.** El bloc que genera `create`
  cobreix el stack de `dev` -- web, API, PostgreSQL, Valkey, Mailpit -- i no el de verificacio.
  Tria una parella que no faci servir cap altre workspace i deixa-la escrita al `.env.verify`. Si
  dos workspaces trien la mateixa, la segona suite falla dient nomes que el servidor no arrenca.
- **`APP_ORIGIN` i `PLAYWRIGHT_BASE_URL` han de ser la mateixa cadena** -- `check:e2e` s'hi nega
  altrament -- i `NEXT_DIST_DIR` ha de ser diferent del que fa servir `pnpm dev`, o els dos
  servidors es trepitgen el build.
- **`scripts/run-local-command.mjs` necessita `npm_execpath`**, o sigui que s'ha d'executar des de
  pnpm. Per passar-li un `--env-file` que no sigui `.env`, crida el binari de pnpm des de node:
  `node --env-file=.env.verify <ruta>/pnpm.cjs --filter @control-hub/database migrate`.
- **Els flags importen.** Una pantalla darrere un flag que el `.env.verify` no encen no existeix
  per a la suite, i la prova falla parlant d'un selector que no apareix enlloc.

## 5. Entregar

L'agent executa les comprovacions exigides per `AGENTS.md`, revisa el diff, crea commits atomics,
fa push de la seva branca i obre una PR contra `develop`. Cap agent fusiona o publica si el
propietari no ho ha demanat.

Un handoff ha d'indicar:

```text
task, branch, commit/PR, validations, changed files, migrations, residual risks
```

## 6. Veure els workspaces actius

Des de qualsevol checkout del repositori:

```powershell
pnpm agent:workspace list
git worktree list
```

## 7. Destruir després del merge

Executa-ho des d'un altre checkout, mai des del workspace que retires:

```powershell
pnpm agent:workspace destroy "C:\ruta\Control-Hub-ch-241-mailbox-ui" --confirm
```

L'ordre:

- es nega si la ruta no es un worktree registrat;
- es nega si hi ha canvis sense commit;
- elimina contenidors i volums exclusius;
- retira el worktree;
- conserva la branca per evitar perdua accidental.

Quan el merge estigui confirmat, la branca es pot eliminar amb el flux Git habitual.

## Que sap un agent automaticament

Els agents compatibles llegeixen l'`AGENTS.md` de l'arrel i, per tant, saben que han d'utilitzar
aquest flux i executar `pnpm agent:validate`. Al prompt nomes cal donar ticket, objectiu i base.
Per seguretat, el propietari continua sent qui assigna tasques que poden tocar fitxers globals o
migracions; el context automatic no substitueix aquesta coordinacio.

## Limit actual

La preview es local. Una PR continua utilitzant CI com a entorn reproduible, pero encara no crea
una URL Vercel ni una branca Supabase. Aquests seran adaptadors posteriors si el volum de treball
els justifica.

## Limits coneguts de l'aillament

Aixo no son objeccions teoriques: es el que aquest repositori fa avui, comprovat el 25 d'agost de
2026 mentre es tancava CH-010. Cap d'aquests punts no te encara una solucio implementada, i
escriure'ls val mes que arreglar-ne un a mitges dins d'una branca que no els toca.

1. **Un worktree sense `.agent/workspace.json` es invisible.** `activeWorkspaceMetadata` salta
   qualsevol worktree que no en tingui, de manera que no compta per a `SCOPE_COLLISION`, ni per a
   `PORT_COLLISION`, ni surt a `pnpm agent:workspace list`. Avui n'hi ha dos en aquesta situacio
   -- `Control-Hub-phase-x` i `Control-Hub-phase8-docs` --, creats abans que existis aquest flux.
   La deteccio de col·lisions, per tant, nomes veu els workspaces que ja segueixen el flux.
   *Remei:* que `validate` avisi dels worktrees registrats sense manifest en comptes d'ignorar-los
   en silenci.

2. **`protectedResources` es declaratiu i prou.** El camp existeix a cada `task.json` i
   `validateTaskManifest` comprova que sigui una llista de textos, pero cap ordre no el consulta
   mai despres. Res no impedeix que un agent editi `packages/database/migrations/**` o
   `.github/workflows/**`: l'unic que ho evita es que l'agent s'ho llegeixi i en faci cas.
   *Remei:* que `validate` compari els fitxers modificats amb els patrons i falli.

3. **`SCOPE_COLLISION` compara cadenes exactes.** `apps/web/src/app/[locale]/mcp/**` i
   `apps/web/src/app/[locale]/mcp/consent/page.tsx` son el mateix fitxer i no col·lideixen, perque
   no son la mateixa cadena. Dos agents poden reclamar el mateix fitxer amb dues escriptures
   diferents i tots dos passar la validacio.
   *Remei:* expandir els patrons a fitxers reals abans de comparar-los.

4. **Ningu no comprova que el que has tocat sigui teu.** El `scope` es una declaracio
   d'intencions: cap pas compara els fitxers modificats amb el que s'ha declarat, i la deriva no
   la detecta res. El mateix recorregut que arreglaria el punt 2 arreglaria aquest.

5. **No hi ha manera de dir "aquest fitxer el compartim".** `docs/development/current-state.md` el
   toca practicament cada tasca, i avui el te CH-012 dins del seu scope. L'unica sortida es
   excloure'l del scope propi i coordinar-ho per fora, que es exactament el que s'ha fet a CH-010:
   la fase 10 hi consta perque el commit va entrar abans que el workspace existis, no perque hi
   hagi cap mecanisme que ho resolgui.

6. **Els flags de CI no segueixen els de les proves.** `agent:provision` genera un `.env` amb tots
   els flags encesos; el job autenticat de CI n'encen cinc. Una pantalla darrere un flag que aquell
   job no encen no existeix per a la suite, i la prova que la condueix no la verifica ningu.

   Amb `mcp` aixo ja esta arreglat: el job l'encen, amb `MCP_ISSUER`, i la prova de consentiment
   d'aquesta fase hi corre de debo.

   La regla general: qui afegeix una prova darrere un flag ha d'encendre'l a CI **al mateix
   commit**, o la prova nomes existeix a la maquina de qui la va escriure.

7. **Una prova no pot esperar transit que un component de servidor no genera.** Ho explica el
   cas de `support-mailbox.authenticated.spec.ts`, que armava un `page.waitForResponse` sobre
   `/api/v1/support/mailbox?status=pending` i despres obria `/ca/support/mail`. Aquella peticio
   no la fa mai el navegador -- la pantalla es un component de servidor i la crida surt del
   servidor de Next --, o sigui que l'espera esgotava el temps sempre, des del commit que la va
   introduir i amb qualsevol flag. Es va perseguir primer com si fos cosa de `mail`, i no ho era.
   Ja esta corregida: asserta sobre el que la pantalla dibuixa. **La regla:** davant una
   pantalla, mira si es de servidor abans d'escriure cap espera de xarxa; si ho es, el que es pot
   observar es l'HTML que arriba, no la peticio que el va omplir.

8. **`git worktree list` acumula entrades `prunable`.** N'hi ha una avui, d'un directori que ja no
   existeix, i `destroy` no s'hi pot fer servir perque exigeix un worktree present. Un
   `git worktree prune` de tant en tant.

