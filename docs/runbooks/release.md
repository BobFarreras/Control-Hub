# Runbook de publicacio d'una versio

Com es talla una release de Control Hub: de codi fusionat a artefactes que algu pot instal·lar.
**Instal·lar-la es l'altra meitat i viu a [`installation.md`](installation.md).** Aquest document
acaba on aquell comenca.

Qui el segueix necessita poder fusionar a `develop` i a `main` i poder empenyer una etiqueta al
repositori. No cal tocar cap servidor: tot passa a GitHub.

## Que publica cada cosa

`.github/workflows/release.yml` s'activa amb dues coses, i fan feines diferents:

| Disparador | Que fa | Es una release? |
| --- | --- | --- |
| Push a `develop` | Construeix les quatre imatges i les puja amb l'etiqueta `edge` | **No.** Sense manifest, sense firma, sense SBOM |
| Etiqueta `v*.*.*` | Tot: imatges, firma, SBOM, provinenca, manifest, release de GitHub | Si |

**`main` no publica res per si sol.** El seu paper es un altre: `ci.yml` no s'executa quan
s'empeny una etiqueta, i el gate del workflow exigeix que el commit que l'etiqueta assenyala ja
tingui els resultats de les portes penjats. Aquests resultats hi son perque aquell commit ha passat
per CI en fusionar-se a `main`.

`edge` no vol dir res i no ho ha de voler dir: existeix perque el cami d'instal·lacio es pugui
exercitar contra el que hi ha a `develop` avui, no perque ningu en depengui.

## Que en diu `BRANCHING.md`

Aquell document descriu una branca `release/*`: surt de `develop`, es fusiona a `main`, s'etiqueta
i es reintegra a `develop`. Existeix per a **l'estabilitzacio** --quan una versio ha de rebre
correccions de regressio mentre `develop` continua avancant--, i aqui no n'hi ha cap: `develop` i
`main` coincidiran, o sigui que la branca seria una branca buida que nomes porta el commit de
versio. Per aixo el pas 2 va directament a `develop`.

**Quan si que en cal una:** si entre el commit de versio i l'etiqueta ha d'entrar feina que no va a
la release, o si la validacio troba una regressio que cal corregir sense arrossegar la resta de
`develop`. Llavors segueix `BRANCHING.md`, i el pas 3 fusiona `release/vX.Y.Z` a `main`.

L'etiqueta signada que demana `BRANCHING.md` ja surt sola: aquest repositori te `tag.gpgsign true`
amb `gpg.format ssh`, de manera que `git tag -a` firma amb la clau SSH configurada. Si la firma
falla, el comandament falla i no queda cap etiqueta a mitges.

## Els quatre passos

### 1. Fusiona el que ha d'entrar a `develop`

Per pull request, com sempre. Vuit portes obligatories i la branca ha d'estar al dia.

Aixo **ja publica**: el push a `develop` republica les imatges `edge`. Es esperat i no cal fer-hi
res, pero val la pena saber que la primera fusio amb aquest workflow a dins va publicar la primera
imatge publica sense que ningu ho demanes explicitament.

### 2. El commit de versio

**Aquest es el pas que es salta tothom, i el simptoma no apareix fins despres d'instal·lar.**

`apps/api/src/version.ts` llegeix la versio d'`apps/api/package.json` **en temps de construccio** i
es el que una instal·lacio reporta quan se li pregunta quina versio es. Si el `package.json` diu
`0.3.0` i l'etiqueta diu `v0.4.0`, la instal·lacio compara `0.3.0` amb el manifest, veu que hi ha
una versio mes nova, i **el banner d'actualitzacio diu «actualitza» contra la versio que la persona
acaba d'instal·lar**, per sempre.

Un commit `chore(release): v0.4.0` a `develop` que puja:

- `package.json` de l'arrel
- `apps/api/package.json`, `apps/web/package.json`, `apps/worker/package.json`
- els onze `packages/*/package.json`
- `CHANGELOG.md`, amb que porta la versio
- `README.md`, alli on surti el numero
- `docs/development/current-state.md`

El commit `cb0db58` (v0.3.0) es el patro exacte: quinze `package.json` en total. Per comprovar que
no en queda cap enrere, amb la versio anterior:

```bash
git ls-files '*package.json' | xargs grep -ln '"version": "0\.3\.0"'
```

Ha de tornar zero linies abans d'etiquetar. `git ls-files` i no `grep -r`, perque
`apps/web/.next/` conte una copia generada del `package.json` que no es puja mai i faria que la
comprovacio no arribes a zero.

### 3. `develop` cap a `main`

Pull request de `develop` a `main`, i fusiona. Les mateixes vuit portes, i `main` tambe exigeix
que la branca estigui al dia.

El commit de fusio que en surt es **el commit que s'etiquetara**. No n'hi ha d'haver cap altre a
sobre.

### 4. L'etiqueta

```bash
git checkout main && git pull --ff-only
git tag -a v0.4.0 -m "Control Hub v0.4.0"
git push origin v0.4.0
```

Etiqueta anotada, no lleugera: porta autor i data, i es el que el workflow adjunta a la release. Amb
la configuracio d'aquest repositori tambe queda firmada; `git tag -v v0.4.0` ho comprova, i necessita
el fitxer d'`allowed_signers`.

**Una etiqueta empesa no es mou.** Si assenyala el commit equivocat, la sortida no es reetiquetar
--una etiqueta moguda deixa firmes valides sobre bytes diferents, que es exactament el problema que
firmar per digest evita-- sino publicar la seguent versio de correccio.

**Atencio: concorrència de CI.** Si `ci.yml` te `cancel-in-progress: true` (que ho te), fer push
de la tag gairebe alhora que el push a `develop` pot cancel·lar els check-runs sobre el mateix
commit SHA, fent que el gate rebutgi la release. Per evitar-ho, assegura't que `develop` ja hagi
passat CI completament (totes les portes verdes) abans de fer push de la tag. Si ja has fet la tag
i el gate ha fallat, crea un commit buit a `main` i reetiqueta:

```bash
git checkout main
git commit --allow-empty -m "chore: prepare release"
git push origin main
git tag -a v0.4.X -m "Control Hub v0.4.X"
git push origin v0.4.X
```

## Que passa llavors, i quant triga

1. **Gate.** Consulta els *check runs* del commit i exigeix les nou portes:
   `Repository standards`, `Application checks`, `Previous version`, `End to end`,
   `Authenticated end to end`, `Container image`, `Secret scan`, `Vulnerable dependencies`,
   `Static analysis`. `skipped` i `cancelled` compten com a fracas: una porta que no s'ha executat
   no ha passat. Espera fins a 45 minuts i despres es nega.

   CodeQL **no** hi es a proposit: l'app de seguretat avancada de GitHub informa sobre commits de
   pull request, i en un push a `develop` no produeix cap check suite, de manera que exigir-lo feia
   que cada publicacio `edge` esgotes el termini. No s'afluixa res: la proteccio de branca ja
   bloqueja la fusio si CodeQL no ha passat al pull request. Ho explica `scripts/release-gate.mjs`.

2. **Publish.** Construeix les quatre imatges per a `linux/amd64` **i `linux/arm64`**. L'arm64 va
   sota emulacio i es de llarg la part mes lenta: el timeout del job es de dues hores i no es
   generos per casualitat. Despres firma els quatre digests amb cosign sense claus (OIDC), hi
   adjunta SBOM i provinenca, escriu el manifest i puja els artefactes.

El workflow **no es cancel·la a mitges** (`cancel-in-progress: false`): una publicacio interrompuda
pot deixar tres imatges de quatre pujades, que es una release que existeix a mitges.

### El que queda publicat

A `https://github.com/BobFarreras/Control-Hub/releases/latest/download/<nom>`, i els noms no porten
mai el numero de versio perque una instal·lacio ha de poder demanar-los sense saber quina versio
demanar:

| Fitxer | Qui el llegeix |
| --- | --- |
| `release.json` | El worker, un cop al dia, per saber si hi ha versio nova |
| `release.env` | `install.sh` i `update.sh`, per saber quins digests aixecar |
| `install.sh` | Qui instal·la, per llegir-lo abans d'executar-lo |
| `update.sh` | Publicat cada cop, perque una instal·lacio vella en pugui agafar un de nou a ma |
| `control-hub-install.tar.gz` | El paquet sencer: els fitxers de Compose, l'script que PostgreSQL munta i els dos comandaments |

`update.sh` viaja amb la release des de la qual s'actualitza, no cap a la qual: una instal·lacio que
corre 1.0.0 fa servir la copia que ja te per arribar a 1.1.0.

## Comprovar que ha anat be

```bash
gh release view v0.4.0 --json assets --jq '.assets[].name'
curl -fsSL https://github.com/BobFarreras/Control-Hub/releases/latest/download/release.json
docker manifest inspect ghcr.io/bobfarreras/control-hub-api:0.4.0
```

Els cinc artefactes, un manifest amb els quatre digests, i les quatre imatges resolubles per
etiqueta de versio. Que el `release.json` sigui llegible sense autenticar-se es el que fa que la
comprovacio diaria del worker funcioni.

Verificar la firma es opcional i no forma part del cami d'instal·lacio, pero es pot fer:

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/BobFarreras/Control-Hub/\.github/workflows/release\.yml@refs/tags/v0\.4\.0$' \
  ghcr.io/bobfarreras/control-hub-api@sha256:<digest del manifest>
```

Sempre **per digest, mai per etiqueta**: una firma sobre una etiqueta no diu res una setmana mes
tard, perque l'etiqueta es pot moure i la firma segueix verificant --contra bytes diferents.

## Quan alguna cosa falla

**El gate es nega dient que falta una porta.** Mira quina, al log del job `Required checks`. La
causa habitual no es que hagi fallat sino que no s'ha executat sobre aquell commit: `skipped` compta
com a fracas. Un commit a `main` que no hagi passat per un pull request pot no tenir-les totes.

**La publicacio falla a mitges.** Torna a executar el workflow des de la interficie d'Actions: les
imatges ja pujades es tornen a pujar amb el mateix contingut i el pas d'adjuntar fa `--clobber`.
No cal una etiqueta nova.

**Has etiquetat el commit equivocat.** No moguis l'etiqueta. Publica la seguent versio de correccio
sobre el commit correcte.

## Despres

La release existeix; instal·lar-la es una feina diferent i esta a
[`installation.md`](installation.md). El primer que llegira aquests artefactes es
`control-hub-install.tar.gz` a la maquina de desti, i fins que no hi hagi una release publicada
`releases/latest/download/release.json` respon 404 i l'instal·lador no te res a descarregar.
