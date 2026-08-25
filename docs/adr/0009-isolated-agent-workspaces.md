# ADR 0009: workspaces aillats per a agents de desenvolupament

**Estat:** aprovada.

## Context

Diversos agents han treballat en una mateixa branca i directori. Git separa commits, pero no
processos, fitxers sense commit, caches, ports, secrets locals, volums ni bases de dades. Aixo ha
fet que una validacio pogues incloure canvis aliens i que un commit pogues capturar-los.

La plataforma d'agents de la Fase 11 es una funcionalitat del producte. Aquesta decisio regula
els agents de programacio que modifiquen el repositori i no comparteix el seu domini ni dades.

## Decisio

Cada tasca concurrent utilitza una unitat descartable:

```text
tasca = branca = worktree = entorn = projecte Compose = base de dades = preview local = PR
```

La primera implementacio es local i independent de proveidor: Git worktrees, Docker Compose i
PostgreSQL. Un manifest local relaciona tasca, agent, branca, ruta i ports. Els secrets es generen
per workspace, no es copien del `.env` d'un altre entorn i queden ignorats per Git.

Les branques temporals segueixen `agent/<agent>/<ticket>-<slug>`. La integracio continua passant
per `develop`, PR i les portes existents. La branca es conserva quan es destrueix el workspace;
eliminar-la es una decisio posterior al merge.

Dev Containers defineix l'entorn reproduible, pero no es el provisionador ni rep secrets de
produccio. Coder, Daytona, Codespaces, Supabase Branching i Vercel Preview poden ser adaptadors
posteriors; no formen part del nucli inicial.

## Consequencies

- Dos a quatre agents poden treballar sense compartir estat mutable.
- Cada workspace consumeix volums i ports propis i s'ha de destruir quan deixa de ser necessari.
- Els canvis en fitxers globals encara poden conflictuar al merge; el manifest de scope els
  detecta abans, pero no substitueix contractes ni coordinacio.
- La base de dades local continua sent PostgreSQL portable. No es lliga el desenvolupament a un
  proveidor cloud.
