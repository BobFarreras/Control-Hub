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

## 4. Entregar

L'agent executa les comprovacions exigides per `AGENTS.md`, revisa el diff, crea commits atomics,
fa push de la seva branca i obre una PR contra `develop`. Cap agent fusiona o publica si el
propietari no ho ha demanat.

Un handoff ha d'indicar:

```text
task, branch, commit/PR, validations, changed files, migrations, residual risks
```

## 5. Veure els workspaces actius

Des de qualsevol checkout del repositori:

```powershell
pnpm agent:workspace list
git worktree list
```

## 6. Destruir després del merge

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
