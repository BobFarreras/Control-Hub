# Guia d'implementacio de la Fase 12: secrets i credencials

**Estat:** aprovada pel propietari el 25 d'agost de 2026. L'ADR 0010 fixa la custodia hibrida.

## Objectiu

Fer desplegables i rotables els secrets de Control Hub sense convertir el producte en un gestor
de contrasenyes ni crear una dependencia obligatoria d'un proveidor. La instal·lacio ha de poder
usar fitxers de secrets muntats pel runtime i, opcionalment, un gestor extern com Bitwarden
Secrets Manager.

## Frontera de propietat

| Classe | Exemples | Propietari | Control Hub pot mostrar el valor? |
|---|---|---|---:|
| Password humà | comptes de proveidors, recuperacio | Password manager corporatiu | No |
| Secret bootstrap | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CONNECTOR_KEY_RING` | runtime/desplegament | No |
| Client OAuth d'instal·lacio | Google/Microsoft client secret | gestor extern + runtime | No |
| Credencial de connector | PAT, access token, refresh token tenant-scoped | vault intern | No |
| Metadata | origen, versio, expiracio, ultima rotacio | Control Hub | Si |

El `CONNECTOR_KEY_RING` no pot viure al vault que ell mateix obre. Tampoc es copien passwords
humans al vault de connectors. La UI nomes governa referencies, estat, rotacio i revocacio.

## Arquitectura objectiu

```text
password manager corporatiu ── persones

gestor extern de secrets ── machine account de desplegament
          │
          v
fitxers read-only /run/secrets/* ── API, worker, migrador
          │
          v
CONNECTOR_KEY_RING ── vault intern tenant-scoped ── tokens de connectors
```

El core no importa cap SDK de Bitwarden. `packages/config` resol una font tipada i la composicio
del desplegament injecta els valors. Així Docker secrets, systemd credentials, Kubernetes Secrets
o Bitwarden comparteixen contracte.

## Decisions proposades

1. **Aprovada:** suport generic `*_FILE` com a contracte base i adaptador Bitwarden al pipeline,
   no dins del proces web.
2. Bitwarden Password Manager per credencials humanes; Bitwarden Secrets Manager per maquina.
3. Cap pantalla que permeti llegir, copiar o exportar secrets bootstrap.
4. El token de machine account es l'unic secret arrel extern de la VPS i te projecte, permisos de
   nomes lectura, expiracio operativa i rotacio documentada.
5. Una instal·lacio sense Bitwarden continua suportada amb fitxers root-owned muntats read-only.

Les cinc decisions estan aprovades. Bitwarden es opcional, la retencio inicial dels logs
d'auditoria es de 90 dies i un deploy nou falla tancat si el gestor no respon mentre la release
viva conserva els seus mounts. La llicencia concreta es valida abans de contractar o desplegar
l'adaptador, sense alterar el contracte `_FILE`.

## S1 — Inventari i classificacio

- Inventariar cada variable sensible, consumidor, owner, entorn i procediment de rotacio.
- Marcar `public_config | bootstrap_secret | runtime_secret | tenant_credential | ephemeral`.
- Prohibir duplicats entre `.env`, Compose, CI i configuracio manual.
- Afegir un test que impedeixi declarar un secret nou sense classificacio.

Sortida: `docs/security/secrets-inventory.md`, sense valors reals.

## S2 — Resolucio segura de configuracio

**Implementat** a `packages/config/src/secret-file.ts` per als secrets consumits per API i worker.
El resolver es sincron i d'un sol us a l'arrencada, exigeix path absolut, no segueix symlinks,
comprova que el descriptor continua sent el mateix fitxer, limita a 64 KiB i en produccio refusa
permisos de grup o altres. Els errors nomes porten variable i codi estable. Les propietats
sensibles continuen accessibles al composition root, pero son no enumerables: JSON i object spread
no propaguen el valor.

`packages/config` accepta per cada secret una sola font:

```text
GOOGLE_OAUTH_CLIENT_SECRET_FILE=/run/secrets/google_oauth_client_secret
```

- Valor directe i `_FILE` alhora: error d'arrencada.
- Fitxer absent, symlink no aprovat, massa gran, buit o amb permisos insegurs: error estable.
- Lectura una vegada a l'arrencada; el valor cru no sobreviu a l'objecte de configuracio public.
- Errors i validacio mai inclouen el contingut.
- El client ID, domini i callback no son secrets, pero continuen validats.

En desenvolupament es conserva `.env`; produccio prefereix `_FILE`.

Cobertura actual: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `CONNECTOR_KEY_RING`,
`GOOGLE_OAUTH_CLIENT_SECRET` i `MICROSOFT_OAUTH_CLIENT_SECRET`. Les credencials d'un sol us del
migrador i bootstrap s'injectaran com mounts a S3, sense ampliar l'objecte runtime d'API/worker.

## S3 — Empaquetat i desplegament

**Implementat** amb `compose.production.yaml` per al nucli,
`compose.production.connectors.yaml` per al vault opcional i overlays independents
`compose.production.google.yaml` i `compose.production.microsoft.yaml`. Una instal·lacio sense
connectors, o que nomes usa un proveidor, no proporciona secrets ficticis. Tots consumeixen
fitxers sota `SECRETS_DIRECTORY`; dins dels contenidors nomes apareixen a `/run/secrets`.

- Muntar secrets a `/run/secrets` com fitxers read-only, un per secret.
- API rep secrets que necessita per iniciar OAuth; worker rep els necessaris per exchange/refresh.
- Web no rep secrets de proveidor ni key ring.
- Migrador rep `MIGRATION_DATABASE_URL` temporal i la perd quan acaba.
- Contenidors `read_only`, usuari no-root i cap secret dins la imatge, layer o build arg.
- Backup inclou dades xifrades; el key ring es copia per un canal separat i provat.

El migrador usa un entrypoint minim que carrega el mount, elimina la variable `_FILE` i fa
`exec` de Node; en acabar el job desapareixen proces, entorn i mount. PostgreSQL usa els
contractes `_FILE` de la imatge oficial i l'usuari runtime es crea des d'un mount separat.
`scripts/container-secrets.test.mjs` fixa la matriu de concessio, l'absencia de secrets al web i
als build args, i els controls no-root/read-only.

Els valors directes del Compose base es retiren amb `!reset null`. Un `null` YAML ordinari no es
segur en un override: Compose interpreta una variable sense valor com una peticio d'importar-la
de l'entorn del host. La verificacio de S3 inspecciona el model JSON ja fusionat per impedir que
un `.env` local reaparegui dins del contenidor de produccio.

S4 consumeix aquests mounts sense canviar el contracte de S3.

## S4 — Integracio Bitwarden

**Implementat** com a adaptador host-side a `scripts/deploy-with-bitwarden.mjs`, sense SDK ni
dependencia runtime. El manifest fixa versio de `bws`, projecte i mappings per UUID; el manifest
real queda fora de Git. L'adaptador valida identitat i revisio de cada resposta, materialitza en
un staging del mateix filesystem, activa per `rename`, saneja completament l'entorn que rep
Compose i registra metadata sense valors. Un lock impedeix deploys concurrents.

La primera integracio utilitza `bws` fora dels contenidors de Control Hub:

1. machine account de nomes lectura assignada a un projecte per instal·lacio;
2. el pipeline autentica amb un access token guardat pel runner/VPS;
3. recupera secrets per ID immutable, no per cerca amb nom ambigu;
4. escriu fitxers temporals amb permisos `0600` en un directori root-owned;
5. inicia o actualitza l'stack;
6. elimina el material temporal que no sigui el mount viu;
7. registra IDs, versions i resultat, mai valors.

Fallada de Bitwarden durant un restart no ha de destruir els secrets vius. Un deploy nou falla
tancat i conserva la release anterior. No es fa fallback silencios a un `.env` antic.

Una fallada del command de deploy restaura `current` i repeteix el mateix command amb els mounts
anteriors, perquè restaurar el nom del directori no canvia els inodes que un contenidor ja ha
muntat. El runbook complet es `docs/runbooks/bitwarden-secrets-deployment.md`. El seguent increment
es S5, rotacio i recuperacio de cada classe.

## S5 — Rotacio i recuperacio

**Implementat** a `docs/runbooks/platform-secret-rotation.md`, amb precondicions, backup,
validacio, rollback, recuperacio i evidencia d'auditoria per cada classe. El runbook fa explicit
que no totes les classes poden tenir solapament: Better Auth admet una sola clau i la rotacio
invalida artefactes anteriors dins d'una finestra anunciada; PostgreSQL conserva connexions vives
nomes fins que es reciclen.

- `BETTER_AUTH_SECRET`: procediment amb invalidacio de sessions i finestra definida.
- `CONNECTOR_KEY_RING`: rotacio additiva i retirada posterior segons l'ADR 0008. Una rotacio
  preventiva no re-xifra files; el resegellat nomes forma part de la resposta a una fuga.
- OAuth client secret: solapament si el proveidor ho permet; prova d'exchange abans de retirar.
- Database/SMTP: credencial nova, rollout, comprovacio i revocacio de l'antiga.
- Machine account: dos tokens durant una finestra curta, prova i revocacio.

SMTP autenticat encara no forma part del contracte de configuracio actual. S5 no simula una
rotacio inexistent: fixa la porta d'entrada a inventari, `_FILE` i contract tests abans que es
pugui activar el procediment.

## S6 — UI i observabilitat

**Implementat** a `/{locale}/security/secrets` i `GET /api/v1/settings/secrets`. La ruta API
comprova el rol `owner` al backend —tenir `security:manage` com a administrador no es suficient— i
la navegacio nomes mostra l'entrada a un Owner. La resposta es un snapshot immutable creat en
l'arrencada; no hi ha cap endpoint de mutacio ni de lectura de valors.

La pagina Owner **Configuracio de secrets** mostra exclusivament:

- font (`file`, `external_manager`, `environment`);
- configurat/no configurat;
- fingerprint no reversible o versio externa;
- ultima càrrega, ultima rotacio i consumidor;
- health del proveidor sense revelar paths interns ni IDs sensibles.

No hi ha camps password, botons de copiar, exports ni API de lectura de valors. Les mutacions de secrets
bootstrap continuen al canal d'operacions; la UI pot generar una instruccio o job d'aprovacio,
pero no transportar el valor.

`SECRETS_PROVIDER` distingeix desenvolupament amb entorn, mounts del runtime i Bitwarden. Quan el
proveidor es Bitwarden, la UI diu deliberadament que la seva salut es fora del runtime: l'adaptador
host-side no dona el token a l'API. El que l'API si prova es la carrega dels seus mounts. Secrets
nomes consumits pel worker es marquen no observables quan el composition root no en te evidencia.

Les metriques `platform_secret_configured`, `platform_secret_last_loaded_timestamp_seconds` i
`platform_secret_last_rotated_timestamp_seconds` usen un cataleg fix de baixa cardinalitat. La
tercera serie nomes existeix quan hi ha evidencia segura de rotacio; `null` no es converteix en una
data inventada. El log d'arrencada porta proveidor i recomptes, mai valors, headers, paths, IDs ni
tokens.

## Threat model minim

- Compromis de la UI/API: no dona accés als secrets bootstrap.
- Lectura de PostgreSQL: tokens segueixen xifrats i la clau queda fora.
- Compromis del worker: limita egress, scopes i vida dels tokens; es considera un incident de
  credencials i activa rotacio.
- Compromis de la VPS/root: pot llegir secrets vius; es mitiga amb host hardening, acces minim,
  alertes, rotacio i backups separats, no amb criptografia dins el mateix host.
- Gestor extern indisponible: cap deploy nou, stack existent disponible.
- Secret eliminat o rotat malament: rollback versionat i break-glass provat.

## Proves obligatories

- Unit: precedencia, exclusio valor/`_FILE`, limits, newline final i errors redactats.
- Seguretat: symlink/path traversal, permisos, secrets absents de JSON/logs/problem details.
- Contenidor: cap secret a `docker history`, imatge o variables del web; mounts read-only.
- Integracio: provider extern simulat, timeout, versio desconeguda i deploy atomic.
- Rotacio: key ring, OAuth client secret i machine account amb rollback.
- Recuperacio: restaurar base i key ring des de canals separats en un entorn net.

## Rollout

1. S1 inventari, sense canvi d'execucio.
2. S2 suport `_FILE`, mantenint variables directes per compatibilitat.
3. S3 Compose/imatges i validacio de l'artefacte.
4. S4 adaptador Bitwarden opcional.
5. Migrar una instal·lacio pilot, rotar tots els secrets i eliminar `.env` sensibles.
6. S6 metadata a la UI nomes despres que el canal operatiu estigui provat.

Rollback torna a la release anterior i als mounts anteriors; mai reintrodueix secrets en git.

## Criteri de sortida

Una instal·lacio nova arrenca sense secrets dins imatges o fitxers versionats, pot usar fitxers o
Bitwarden sense canviar el core, rota cada classe amb rollback, restaura dades i claus per canals
separats, i cap API, UI, log, job o backup ordinari revela material secret.
