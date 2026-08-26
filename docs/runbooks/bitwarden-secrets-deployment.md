# Runbook - desplegament amb Bitwarden Secrets Manager

## Objectiu

Materialitzar els secrets de maquina per ID immutable i actualitzar Control Hub sense passar
valors a Git, arguments de proces, Compose o contenidors no autoritzats. `bws` s'executa al host;
no forma part de les imatges de Control Hub ni del core.

## Precondicions

- Organitzacio de Bitwarden Secrets Manager i un projecte exclusiu per instal·lacio.
- Machine account amb permis **Can read**, mai escriptura, nomes sobre aquest projecte.
- Access token amb expiracio operativa sota custodia del runner o de root a la VPS.
- `bws` 2.1.0 instal·lat a un path absolut, després de verificar la signatura/release i el
  checksum de l'artefacte oficial. La CLI no es vendora ni redistribueix amb Control Hub.
- Docker Engine i Compose v2, checkout immutable de la release i usuari root operatiu.

Bitwarden documenta que el token pertany a una machine account i limita l'accés als projectes
assignats. El token no es recuperable després de crear-lo; es guarda abans de tancar el dialeg i
no entra al manifest.

## Alta inicial

1. Crear un projecte per instal·lacio, per exemple `control-hub-production-acme`.
2. Crear una machine account `control-hub-deployer-acme` i assignar-li nomes lectura.
3. Crear cada secret amb els noms de `compose.production*.yaml`.
4. Copiar `deploy/secrets/bitwarden.manifest.example.json` fora del checkout com
   `/etc/control-hub/bitwarden-manifest.json`.
5. Substituir cada placeholder pel `projectId` i `id` immutable reals. No usar noms ni
   `bws secret list` durant un deploy.
6. Crear `/var/lib/control-hub/secrets` propietat de root i mode `0700`.
7. Guardar el token de machine account al gestor de credencials del runner o com a credencial
   protegida de systemd. No usar `--access-token`, perquè els arguments son visibles a `/proc`.

El manifest real conte IDs externs sensibles i queda ignorat per Git. No conte valors, pero no
s'adjunta a incidencies ni logs.

## Deploy

Carregar `BWS_ACCESS_TOKEN` nomes al proces root que executa l'adaptador. Exemple per al nucli,
vault de connectors i Google:

```bash
cd /opt/control-hub/releases/<release>
export BWS_ACCESS_TOKEN="$(systemd-creds cat control-hub-bws-token)"
node scripts/deploy-with-bitwarden.mjs \
  --bws /usr/local/bin/bws \
  --manifest /etc/control-hub/bitwarden-manifest.json \
  --secrets-root /var/lib/control-hub/secrets \
  -- /usr/bin/docker compose \
    -f compose.yaml \
    -f compose.production.yaml \
    -f compose.production.connectors.yaml \
    -f compose.production.google.yaml \
    up -d --wait
unset BWS_ACCESS_TOKEN
```

Per Microsoft, substituir l'overlay de Google. Si no hi ha connectors, no afegir cap overlay ni
cap ID que el desplegament no consumeixi.

## Mecànica i garanties

1. Comprova root, paths absoluts, versio exacta de `bws`, manifest regular sense symlinks i
   mapping allowlisted sense IDs duplicats.
2. Adquireix un lock exclusiu; dos deploys simultanis fallen amb `DEPLOY_LOCKED`.
3. Executa `bws secret get <ID> --output json` amb timeout. Valida `id`, `projectId`, mida,
   contingut i `revisionDate` abans d'escriure.
4. Materialitza una release germana sota un directori root `0700`. Els fitxers son `0600`:
   UID 1000 per API/worker/migrador i UID 70 per PostgreSQL; la metadata queda root-only.
5. Canvia `current` amb `rename` al mateix filesystem; fins aqui una fallada no toca els secrets
   vius.
6. Elimina `BWS_ACCESS_TOKEN`, secrets directes i variables `*_FILE` de l'entorn del subprocess
   de deploy. Nomes li injecta `SECRETS_DIRECTORY=<...>/current`.
7. Si Compose falla, restaura el directori anterior i torna a executar el mateix command per
   reconciliar contenidors que ja haguessin pres els mounts nous.
8. En exit elimina la release anterior. En refus elimina staging. No hi ha fallback a `.env`.

Els events JSON registren resultat, deployment ID, secret ID i `revisionDate`; mai `value`, token,
stderr de `bws`, path del manifest o variables d'entorn.

## Validacio

```bash
stat -c '%U %a %n' /var/lib/control-hub/secrets /var/lib/control-hub/secrets/current/*
docker inspect control-hub-api-1 --format '{{json .Config.Env}}'
docker inspect control-hub-web-1 --format '{{json .Mounts}}'
docker compose -f compose.yaml -f compose.production.yaml config --quiet
```

- Directori root `700`; fitxers `600` amb l'owner esperat al host i mounts read-only al contenidor.
- Cap `BWS_ACCESS_TOKEN`, password, URL amb credencials o key ring a `Config.Env`.
- Cap mount al web.
- Readiness d'API i worker, login i una operacio de connector controlada.

## Fallades i rollback

- `BWS_FETCH_FAILED`, timeout o resposta invalida: el directori `current` i l'stack existent no
  canvien.
- `BWS_VERSION_MISMATCH`: instal·lar la versio aprovada o revisar el canvi en una PR; no editar el
  manifest a cegues.
- `DEPLOY_COMMAND_FAILED`: secrets anteriors restaurats i reconciliacio completada.
- `DEPLOY_ROLLBACK_FAILED`: `current` apunta als secrets anteriors, pero l'stack pot ser parcial;
  declarar incident i repetir manualment el command amb `SECRETS_DIRECTORY` apuntant a `current`.
- `DEPLOY_LOCKED`: comprovar si hi ha un deploy actiu. No eliminar el lock fins confirmar que no
  existeix cap proces propietari.

No eliminar ni rotar el token anterior de machine account fins que un deploy complet amb el nou
token hagi acabat i la validacio sigui verda.
