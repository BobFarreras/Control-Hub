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

Per `develop`:

- Pull request obligatoria per a contribuïdors, amb bypass per a administradors.
- CI obligatoria.
- Converses resoltes.
- Bloquejar force push i eliminacio.

Les rulesets es configuren al repositori GitHub; no es poden imposar nomes amb fitxers versionats.
