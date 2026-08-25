# Control Hub Branching Strategy

Control Hub utilitza un GitFlow lleuger. Els contribuïdors entreguen fases i features per
pull request. El propietari del repositori pot fer bypass administratiu per publicar
canvis validats directament mentre sigui l'unic desenvolupador.

## Branques permanents

### `main`

- Representa produccio i la darrera release estable.
- Rep normalment `release/*` o `hotfix/*`; el propietari pot publicar una actualitzacio
  validada directament durant l'etapa de desenvolupament individual.
- Cada merge de release ha de generar un tag semantic `vMAJOR.MINOR.PATCH`.
- El push directe queda restringit als administradors amb bypass; force push i eliminacio
  han d'estar bloquejats per a tothom.

### `develop`

- Integra el treball aprovat per a la proxima release.
- Rep `feature/*` i `fix/*` mitjancant pull request quan hi ha contribuïdors. El propietari
  pot integrar directament despres d'executar les validacions locals obligatories.
- Ha d'estar sempre desplegable a staging.
- El push directe queda restringit als administradors amb bypass; force push i eliminacio
  han d'estar bloquejats per a tothom.

## Branques temporals

Les branques son referencies Git, no carpetes del repositori.

| Prefix | Neix de | Torna a | Us |
|---|---|---|---|
| `feature/` | `develop` | `develop` | Nova capacitat o increment funcional |
| `fix/` | `develop` | `develop` | Correccio no urgent detectada durant desenvolupament |
| `release/` | `develop` | `main` i `develop` | Estabilitzacio d'una versio |
| `hotfix/` | `main` | `main` i `develop` | Correccio urgent de produccio |
| `docs/` | `develop` | `develop` | Documentacio sense canvi funcional |
| `chore/` | `develop` | `develop` | Tooling o manteniment |
| `agent/<agent>/` | `develop` | `develop` | Tasca concurrent en un workspace aillat |

Format recomanat:

```text
feature/CH-123-customer-import
fix/CH-184-renewal-timezone
release/v1.4.0
hotfix/v1.4.1-session-revocation
docs/connector-contract
```

Noms en minuscules, ASCII i kebab-case. Una branca correspon a un objectiu revisable.

## Flux de feature

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/CH-123-customer-import

# Treball i commits atomics

git push -u origin feature/CH-123-customer-import
```

La pull request apunta a `develop`. Despres del merge, la branca s'elimina.

## Flux de release

```bash
git switch develop
git pull --ff-only origin develop
git switch -c release/v1.4.0
```

En una release nomes s'accepten:

- Correccions de regressions.
- Versions, changelog i documentacio.
- Migracions i runbooks necessaris.
- Resultats de seguretat i validacio.

La branca es fusiona primer a `main`, es crea el tag signat i despres es reintegra a `develop`.

## Flux de hotfix

Un hotfix neix de `main`, incrementa PATCH i conte la correccio minima completa. Despres de validar-lo, es fusiona a `main` i `develop` per evitar divergencia.

## Pull requests

- Commits amb Conventional Commits.
- Titol de PR compatible amb Conventional Commits.
- CI completa en verd.
- Converses resoltes.
- Revisio de CODEOWNERS quan correspongui.
- Squash merge per `feature/*`, `fix/*`, `docs/*` i `chore/*`.
- Merge commit per `release/*` i `hotfix/*` per conservar la topologia de release.
- Cap canvi funcional sense tests proporcionals al risc.

## Actualitzacions de dependencies

Dependabot obre les propostes cada dilluns contra `develop`. Que passi despres depen de com de
gran es el salt, i la linia no la decideix ningu paquet a paquet: la decideix el numero.

**Minor i patch entren sols.** El workflow `dependabot-auto-merge.yml` els activa l'auto-merge i
GitHub els fusiona quan les vuit portes obligatories han passat. Si alguna cau, la proposta es
queda oberta esperant. Ningu no ha de mirar res.

El motiu de no revisar-los a ma es que la revisio no hi afegiria res: CI construeix totes les
imatges, aixeca la pila, corre les dues suites end to end i llegeix el codi amb CodeQL. Qui
llegeixi el mateix diff a ma no en treura mes informacio.

**Els major no entren mai sols.** Una versio major es l'autor dient que ha trencat alguna cosa a
proposit, i aixo es una lectura de changelog, no un semafor. Pitjor encara: **CI en verd no vol
dir que l'aplicacio funcioni**. Les proves cobreixen el que hem escrit nosaltres, no tot el que
fa la llibreria; un canvi de semantica en un reintent, en un format de log o en el moment en que
una connexio es tanca passa totes les portes i es veu el primer dia de produccio.

Per aixo cada major va sol, a la seva branca:

```text
chore/deps-bullmq-6
chore/deps-node-26
agent/codex/ch-241-mailbox-ui
```

Quan treballen diversos agents, `agent/<agent>/<ticket>-<slug>` substitueix temporalment el prefix
funcional: la PR continua indicant si el canvi es feature, fix, docs o chore. La branca es crea
amb `pnpm agent:workspace create`, mai canviant de branca dins el directori d'un altre agent. El
flux operatiu complet es a `docs/development/agent-workspaces.md`.

Una branca, un major. Si dos es barregen i alguna cosa peta, tens dos sospitosos i un sol revert.

I a mes de CI, exercitar a ma el que aquell paquet toca de debo:

| Que puja | Que s'ha de veure funcionar |
|---|---|
| `bullmq`, `ioredis` | El worker: una feina encolada, un reintent, i el lease d'una execucio de connector |
| `node` (imatge) | `docker compose up` sencer, i `/health/ready` responent des del contenidor |
| `fastify`, `@fastify/*` | L'API arrencant amb l'OpenAPI servit, i un `422` amb el problem details sencer |
| `next`, `react`, `lucide-react` | Les pantalles que van canviar per ultim cop, i la hidratacio sense avisos |
| `typescript`, `eslint` | `pnpm check` sencer, que es on es veuen |
| `better-auth` | Login amb MFA, i una sessio caducant |

## El registre

`docs/development/dependency-log.md` diu que ha entrat, quan, i de quina mida era el salt.

**Es genera, no s'escriu**: `pnpm deps:log` el deriva de l'historial de git. Un registre que
s'escriu a ma menteix al tercer mes, i un registre que menteix es pitjor que no tenir-ne.
Regenera'l quan tanquis una tanda de majors. El workflow `dependency-log.yml` el publica cada
dilluns al resum de l'execucio, i alli hi diu si la copia del repositori s'ha quedat enrere.

**Escriu l'assumpte com l'escriuria Dependabot.** Quan el major el puges tu i no ell, el titol
del commit ha de dir `bump <paquet> from <versio> to <versio>` amb un dels prefixos que declara
`dependabot.yml`. Es l'unica part del commit que el generador sap llegir: un assumpte que
descriu el canvi amb les teves paraules acaba a **Sense classificar**, amb el paquet i les
versions en interrogant, i llavors el registre nomes serveix per dir-te quin commit has d'anar
a obrir.

## Flux del propietari

Mentre el repositori tingui un unic desenvolupador, el propietari pot integrar sense PR.
Abans del push ha d'executar `pnpm check` i les proves E2E o d'integracio afectades. Els
GitHub Actions continuen executant-se despres del push i qualsevol fallada s'ha de corregir
immediatament. Aquest bypass no autoritza force push, eliminacio de branques protegides ni
omissio de la Definition of Done.

## Proteccions recomanades a GitHub

Per `main`:

- Pull request obligatoria per a contribuïdors, amb bypass per a administradors.
- Una aprovacio com a minim.
- Aprovacio de CODEOWNERS.
- CI obligatoria.
- Converses resoltes.
- Historial lineal, excepte l'estrategia de release aprovada.
- Bloquejar force push i eliminacio.
- Permetre bypass als administradors mentre s'apliqui el flux de propietari.

Per `develop`, i aixo ja **no es una recomanacio sino l'estat real** des del 16 d'agost de 2026:

- Pull request obligatoria per a contribuïdors, amb bypass per a administradors.
- **Les vuit comprovacions de CI, totes obligatories**: `Repository standards`, `Application
  checks`, `End to end`, `Authenticated end to end`, `Container image`, `Secret scan`,
  `Vulnerable dependencies` i `Static analysis`.
- Branca al dia amb la base abans de fusionar.
- Converses resoltes.
- Bloquejar force push i eliminacio.

Fins llavors nomes dues de les vuit eren obligatories, i la diferencia no era teorica: una
proposta que trencava la imatge de contenidor complia les regles, perque el job que ho detecta
no comptava. Si alguna vegada s'activa l'auto-merge sobre unes portes incompletes, s'automatitza
el forat, no la feina.

**El cost es real i s'accepta a proposit**, pero es menor del que sembla: els vuit jobs corren
en paral·lel, aixi que mana el mes lent i no la suma. La primera tanda amb les vuit obligatories
va trigar **menys de quatre minuts**, amb `Authenticated end to end` com a mes lent (3m56s). Es
el preu de que "verd" vulgui dir alguna cosa, i es barat.

Les rulesets es configuren al repositori GitHub; no es poden imposar nomes amb fitxers versionats.
