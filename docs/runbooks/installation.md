# Runbook d'instal·lacio de Control Hub

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
6. Entrar a `http://localhost:3000`, verificar el compte i activar MFA.

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
