# Guia d'implementacio de la Fase 12: secrets i credencials

**Estat:** proposta tecnica preparada per a aprovacio del propietari.

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

1. **Recomanada:** suport generic `*_FILE` com a contracte base i adaptador Bitwarden al pipeline,
   no dins del proces web.
2. Bitwarden Password Manager per credencials humanes; Bitwarden Secrets Manager per maquina.
3. Cap pantalla que permeti llegir, copiar o exportar secrets bootstrap.
4. El token de machine account es l'unic secret arrel extern de la VPS i te projecte, permisos de
   nomes lectura, expiracio operativa i rotacio documentada.
5. Una instal·lacio sense Bitwarden continua suportada amb fitxers root-owned muntats read-only.

Abans d'implementar cal aprovar aquestes cinc decisions i confirmar llicencia, retencio de logs i
model de disponibilitat del gestor escollit.

## S1 — Inventari i classificacio

- Inventariar cada variable sensible, consumidor, owner, entorn i procediment de rotacio.
- Marcar `public_config | bootstrap_secret | runtime_secret | tenant_credential | ephemeral`.
- Prohibir duplicats entre `.env`, Compose, CI i configuracio manual.
- Afegir un test que impedeixi declarar un secret nou sense classificacio.

Sortida: `docs/security/secrets-inventory.md`, sense valors reals.

## S2 — Resolucio segura de configuracio

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

## S3 — Empaquetat i desplegament

- Muntar secrets a `/run/secrets` com fitxers read-only, un per secret.
- API rep secrets que necessita per iniciar OAuth; worker rep els necessaris per exchange/refresh.
- Web no rep secrets de proveidor ni key ring.
- Migrador rep `MIGRATION_DATABASE_URL` temporal i la perd quan acaba.
- Contenidors `read_only`, usuari no-root i cap secret dins la imatge, layer o build arg.
- Backup inclou dades xifrades; el key ring es copia per un canal separat i provat.

## S4 — Integracio Bitwarden

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

## S5 — Rotacio i recuperacio

- `BETTER_AUTH_SECRET`: procediment compatible amb sessions i finestra definida.
- `CONNECTOR_KEY_RING`: rotacio per addicio, re-encriptacio verificada i retirada posterior segons
  l'ADR 0008.
- OAuth client secret: solapament si el proveidor ho permet; prova d'exchange abans de retirar.
- Database/SMTP: credencial nova, rollout, comprovacio i revocacio de l'antiga.
- Machine account: dos tokens durant una finestra curta, prova i revocacio.

Cada runbook inclou precondicions, backup, validacio, rollback i evidencia d'auditoria.

## S6 — UI i observabilitat

Una pagina Owner **Configuracio de secrets** pot mostrar exclusivament:

- font (`file`, `external_manager`, `environment`);
- configurat/no configurat;
- fingerprint no reversible o versio externa;
- ultima càrrega, ultima rotacio i consumidor;
- health del proveidor sense revelar paths interns ni IDs sensibles.

No hi ha camps password, botons de copiar, exports ni API de lectura. Les mutacions de secrets
bootstrap continuen al canal d'operacions; la UI pot generar una instruccio o job d'aprovacio,
pero no transportar el valor.

Metriques i logs: disponibilitat del resolver, edat de rotacio i resultat; mai valors, headers,
paths amb identificadors o tokens.

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
