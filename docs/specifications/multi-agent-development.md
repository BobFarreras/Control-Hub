# Especificacio de la Fase X: desenvolupament multi-agent

**Estat:** aprovada.

## Objectiu

Permetre que de dos a quatre agents de programacio treballin simultaniament sobre Control Hub
sense compartir directori, branca activa, processos, build output, secrets locals, serveis ni
base de dades.

## Invariants

1. Cada tasca te un identificador, un agent, una branca temporal i un worktree exclusiu.
2. `main` i `develop` no son branques de treball.
3. Cada workspace te projecte Compose, volums, ports i `.env` propis.
4. Les credencials es generen aleatoriament; no es copia cap `.env` existent.
5. Cap workspace o agent rep secrets de produccio.
6. La base es crea des de totes les migracions i dades sintetiques opcionals.
7. La destruccio es nega si hi ha canvis sense commit i no elimina la branca.
8. Un scope exactament compartit o un bloc de ports repetit fa fallar la validacio.
9. Els checks de qualitat i la PR continuen sent la frontera d'integracio.
10. Turbo utilitza una cache dins de cada filesystem; no resol la cache des del Git common dir.
11. Els ports publicats no tenen fallbacks silenciosos: han d'estar declarats al `.env` del
    workspace. Els ports interns dels contenidors son estables i privats a cada xarxa Compose.

## Contracte local

`.agents/task.schema.json` versiona el manifest portable de tasca. Cada worktree genera dins
`.agent/`, ignorat per Git:

- `task.json`: tasca, agent, branca, base, scope i recursos protegits;
- `workspace.json`: a mes, ruta, projecte Compose, ports i data de creacio;
- `.env`: secrets efimers, origins, ports i URLs de la base i la cua.

Els scopes son patrons declaratius. En aquest increment es detecta coincidencia exacta; no es
pretén inferir tots els conflictes possibles de Git.

## Lifecycle

```text
create -> provision -> working -> validate -> commit -> push -> PR -> merge -> destroy
```

`create` crea branca, worktree i identitat. `provision` instal·la amb lockfile, aixeca PostgreSQL,
Valkey i Mailpit propis i aplica totes les migracions. `destroy` retira contenidors, volums i
worktree nomes amb confirmacio i arbre net.

## Fora d'abast inicial

- Control plane remot, scheduler, dashboard o cua de tasques.
- Coder, Daytona o Kubernetes.
- Creacio automatica de Supabase branches o Vercel previews.
- Locks distribuïts i resolucio automatica de conflictes semantics.
- Secrets de staging o produccio dins els workspaces.

## Criteris d'acceptacio

1. Dos workspaces creats des del mateix repositori reben branques, paths, ports i projectes
   Compose diferents.
2. `.env` i manifests locals no apareixen a `git status`.
3. El web respecta `WEB_PORT` i l'API publicada respecta `API_PORT`.
4. La validacio refusa branca, path, scope o ports incoherents.
5. La destruccio no elimina un workspace brut ni una branca.
6. El flux funciona en Windows PowerShell i Linux/macOS mitjancant Node i Git.
