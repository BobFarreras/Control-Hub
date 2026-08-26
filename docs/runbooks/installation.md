# Runbook d'instal·lacio de Control Hub

> Alguns passos d'aquest runbook descriuen coses que **encara no es poden fer**: no hi ha registre
> d'imatges, ni manifest de versions, ni cap reverse proxy al repositori, i `compose.yaml` compila
> els serveis en comptes de descarregar-los. `docs/specifications/deployment.md` diu quins son i que
> ha d'existir perque aquest document sigui executable de punta a punta.

## Model d'alta

Control Hub no ofereix registre public. Cada instal·lacio crea un tenant i un primer
`Owner` mitjancant un bootstrap administratiu d'un sol us. Despres, `Owner` o
`Administrator` conviden membres amb rols i permisos explicits.

Cap client comparteix base de dades, secrets o domini amb una altra instal·lacio en
el model self-hosted. El model intern continua sent tenant-aware per permetre una
futura modalitat SaaS sense redissenyar l'autoritzacio.

## Recorregut d'una instal·lacio comercial

### 1. Preparacio

- VPS Linux compatible, Docker Engine i Compose v2.
- Domini DNS controlat pel client.
- SMTP transaccional per verificacions, invitacions i recuperacions.
- Emmagatzematge extern xifrat per backups.
- Release OCI immutable i manifest de versions verificat.

### 2. Configuracio

1. Crear el directori d'instal·lacio amb `compose.yaml` i fitxer de release.
2. Generar secrets unics amb entropia criptografica.
3. Configurar domini, TLS, SMTP, timezone, locale i retencio.
4. Validar la configuracio abans d'arrencar contenidors.
5. No exposar PostgreSQL, Valkey ni ports administratius a Internet.

#### Secrets muntats en produccio

Produccio no passa secrets com a valors d'entorn. Preparar un directori fora del checkout,
propietat de `root`, i indicar-lo amb `SECRETS_DIRECTORY`. Cada fitxer conte exactament un valor,
acabat opcionalment amb un salt de linia:

| Fitxer | Lector dins el contenidor |
|---|---|
| `database_url` | UID 1000, API i worker |
| `migration_database_url` | UID 1000, job de migracio |
| `better_auth_secret` | UID 1000, API |
| `postgres_admin_password` | UID de PostgreSQL |
| `postgres_app_password` | UID de PostgreSQL |
| `connector_key_ring` | UID 1000, API i worker, nomes amb connectors |
| `google_oauth_client_secret` | UID 1000, worker, nomes si Google esta configurat |
| `microsoft_oauth_client_secret` | UID 1000, worker, nomes si Microsoft esta configurat |

El directori no pot ser llegible pel grup o altres. Els fitxers d'aplicacio han de ser `0400` i
llegibles per UID 1000; els dos de PostgreSQL, pel UID de la imatge fixada. Compose declara
`mode: 0400`, pero amb fonts `file` algunes versions implementen el secret com un bind mount i no
canvien owner ni mode: s'han de validar al host abans del deploy.

Arrencada del nucli:

```bash
SECRETS_DIRECTORY=/etc/control-hub/secrets docker compose \
  -f compose.yaml -f compose.production.yaml up -d --wait
```

Amb el vault de connectors, afegir `-f compose.production.connectors.yaml`. Per Gmail, afegir
`-f compose.production.google.yaml`; per Microsoft 365,
`-f compose.production.microsoft.yaml`. Els overlays de proveidor son independents i nomes
exigeixen el seu client ID i el seu secret. El key ring entra a API i worker; cada client secret,
nomes al worker. No muntar mai aquest directori al web.

Quan els fitxers provenen de Bitwarden Secrets Manager, no s'escriuen manualment: seguir
`docs/runbooks/bitwarden-secrets-deployment.md`, que valida IDs, versio, permisos i rollback abans
de retirar la release anterior.

### 3. Arrencada i migracions

1. Descarregar imatges OCI per digest, mai `latest`.
2. Executar el job de migracions amb credencials administratives temporals.
3. Arrencar API, worker i web amb el rol runtime de minim privilegi.
4. Verificar healthchecks, logs redaccionats i connectivitat SMTP.

Les migracions no formen part de l'arrencada normal de l'API. Una fallada atura el
desplegament i conserva la versio anterior disponible per rollback.

### 4. Primer Owner

1. Definir temporalment `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`,
   `BOOTSTRAP_OWNER_NAME`, `BOOTSTRAP_TENANT_NAME` i `BOOTSTRAP_TENANT_SLUG`.
2. Executar `pnpm bootstrap:owner` en desenvolupament o el job OCI equivalent.
3. El bootstrap es nega a continuar quan el tenant ja existeix.
4. Eliminar les variables de bootstrap immediatament despres de l'execucio.
5. Verificar el correu, iniciar sessio i activar TOTP abans d'operar.
6. Canviar la contrasenya inicial si l'ha proporcionat l'instal·lador.

### 5. Membres

- No hi ha sign-up public.
- `Owner` i `Administrator` envien invitacions amb expiracio i un sol us.
- El destinatari verifica el correu, defineix la seva propia contrasenya i activa MFA.
- El backend assigna permisos des de la membership del tenant, no des del formulari.
- Desactivar un membre revoca sessions i credencials personals.
- Les identitats de maquina utilitzen service accounts i scopes, mai usuaris compartits.

El flux d'invitacions administratives s'ha de completar abans de distribuir la primera
release instal·lable a tercers.

### 6. Validacio d'acceptacio

- Login, verificacio, recuperacio, MFA i revocacio provats.
- Separacio de rols `Owner`, `Administrator` i `Technical` verificada.
- API, worker, cua, base de dades i correu saludables.
- Backup inicial executat i restauracio provada en un entorn net.
- URL, certificat, timezone, locale i branding aprovats pel client.
- Runbook d'incidencies i canal de suport lliurats.

## Desenvolupament local

1. Crear `.env` a partir de `.env.example`.
2. Substituir tots els secrets i la contrasenya de bootstrap.
3. Executar `pnpm dev:all`.
4. Executar `pnpm bootstrap:owner` nomes si la base no conte cap tenant.
5. Consultar el missatge de verificacio a Mailpit: `http://localhost:8025`.
6. Entrar a `http://localhost:3001`, verificar el compte i activar MFA.

`pnpm dev` nomes inicia processos. `pnpm dev:all` prepara infraestructura, aplica
migracions i inicia l'aplicacio.

## Actualitzacio

1. Llegir release notes i comprovar compatibilitat.
2. Fer i verificar un backup extern.
3. Descarregar imatges per digest.
4. Executar migracions expand/contract.
5. Fer rolling restart quan la topologia ho permeti.
6. Validar healthchecks i fluxos critics.
7. Conservar imatges i configuracio anteriors durant la finestra de rollback.

## Desinstal·lacio i exportacio

Abans de retirar una instal·lacio s'exporten les dades acordades, es verifica el backup,
es revoquen connectors i credencials, i s'aplica la politica de retencio. Eliminar
contenidors no elimina automaticament volums ni backups.
