# Control Hub - Arquitectura de seguretat

Aquest document es el baseline canonic de seguretat. No es pot garantir absencia absoluta de vulnerabilitats; l'objectiu es reduir probabilitat, limitar impacte, detectar abus i recuperar-se mitjancant defensa en profunditat.

Control Hub segueix OWASP ASVS nivell 2 com a baseline d'aplicacio i NIST SSDF per al cicle de desenvolupament segur. Controls de nivell superior s'apliquen a identitat, secrets, infraestructura i operacions critiques.

## Principis

- Deny by default i minim privilegi.
- Zero trust entre browser, serveis, connectors i xarxes.
- Autenticacio no substitueix autoritzacio.
- Tenant scope a totes les operacions empresarials.
- Secrets mai en URLs, logs, imatges o responses.
- Validar inputs al limit on entren.
- Egress es un privilegi, no una capacitat universal.
- Fallar tancat en seguretat i conservar evidencia.
- Cap administracio arbitraria de la VPS des del panell.

## Superficie exposada

Produccio publica exclusivament:

```text
443/tcp -> reverse proxy -> web/API
80/tcp  -> redireccio a HTTPS, si es necessari
```

No es publiquen PostgreSQL, cua, exporters, Grafana, Prometheus, Docker API, SSH intern de l'aplicacio ni ports de debug. SSH de manteniment del host queda fora de Control Hub, restringit per firewall, claus i politica operativa.

## Zones de xarxa

```text
Internet
  -> edge/proxy
      -> frontend network: web, API
          -> application network: API, worker
              -> data network: PostgreSQL, queue
              -> connector egress: destinations aprovades
      -> monitoring network: collectors read-only
```

- Xarxes Docker separades i no attachables externament.
- Serveis només connectats a les xarxes imprescindibles.
- Firewall del host amb inbound deny by default.
- Egress del worker restringit quan la plataforma ho permeti.
- Metadata endpoints cloud, loopback, link-local, RFC1918 i xarxes internes bloquejats per defecte als connectors HTTP.

## Hardening de contenidors

Cada imatge de produccio:

- Build multi-stage des d'imatge minima fixada per digest.
- Usuari numeric no-root i sense shell quan sigui viable.
- `read_only: true` i `tmpfs` per temporals.
- `cap_drop: [ALL]`; afegir capabilities només amb justificacio.
- `security_opt: [no-new-privileges:true]`.
- Seccomp/AppArmor per defecte o perfil mes restrictiu validat.
- Sense mode privileged, host network, host PID/IPC ni devices.
- Sense muntar `/var/run/docker.sock`.
- Volums allowlisted, sense muntar arrel o directoris sensibles del host.
- Limits de CPU, memoria, PIDs i fitxers.
- Healthcheck sense credencials.
- Graceful shutdown i timeout.

Docker rootless es preferible quan sigui compatible amb el perfil de desplegament. Si s'utilitza daemon rootful, l'acces al socket queda limitat exclusivament a administracio del host.

## Aplicacio web i API

- HTTPS obligatori; HSTS despres de validar domini i certificats.
- Cookies `Secure`, `HttpOnly`, `SameSite` i prefix `__Host-` quan correspongui.
- CSRF per operacions basades en cookie, verificacio Origin/Fetch Metadata i tokens quan calgui.
- CORS amb origins exactes; mai reflectir Origin ni utilitzar wildcard amb credencials.
- CSP estricta amb nonce/hash; prohibir inline/eval no aprovats.
- Headers contra clickjacking, MIME sniffing i filtracio de referer.
- Body, headers, query, paginacio i uploads amb limits.
- Zod valida forma; el domini valida invariants.
- Output encoding contextual; cap HTML no fiable.
- Errors publics sense stacks, SQL, paths o secrets.

## Identitat i sessions

- Better Auth sota `/api/auth/*` amb PostgreSQL.
- Correu verificat, contrasenya i MFA TOTP obligatori per rols privilegiats.
- Passkeys WebAuthn amb RP ID i origins allowlisted.
- Hash i parametres versionats segons recomanacio vigent de la llibreria.
- Rate limiting per IP, identitat i tenant amb proteccio anti-enumeracio.
- Sessions server-side revocables i rotacio despres d'elevacio de privilegi.
- Reautenticacio per secrets, rols, exports, eliminacio i operacions d'infraestructura.
- Recovery tokens single-use, curts i emmagatzemats com hash.
- Auditoria de login, MFA, recovery, revocacio i canvis de permisos.

## Autoritzacio i tenancy

- Permisos server-side a cada cas d'us.
- `tenant_id` deriva de la sessio/membership, mai del body com a autoritat.
- Repositoris scoped, constraints compostes i RLS en dades sensibles.
- Respostes cross-tenant no confirmen existencia.
- Service accounts amb scopes, expiracio, rotacio i propietari.
- Accions massives i destructives tenen preview, confirmacio i auditoria.

## Secrets i criptografia

- Secrets de plataforma per Docker secrets o secret manager.
- Credencials de connector xifrades amb AEAD i nonce unic.
- Master keys externes a PostgreSQL i backups de dades.
- Key version a cada ciphertext i procediment de rotacio.
- Comparacions de tokens en constant time quan sigui aplicable.
- CSPRNG per tokens, nonces i IDs de seguretat.
- TLS valida certificat i hostname; no existeix `rejectUnauthorized: false` en produccio.

## Fitxers i imports

- Mida, MIME real, extensio i esquema allowlisted.
- Nom intern generat; el nom d'usuari es metadada escapada.
- Emmagatzematge fora de paths executables.
- Antivirus/sandbox per tipus de risc quan s'habilitin adjunts.
- CSV protegeix contra formula injection en exports.
- ZIP amb limits de ratio, fitxers, paths i mida descomprimida.
- XML desactiva DTD i external entities.

## Supply chain i CI

- Lockfile immutable i dependencies allowlisted.
- Dependabot, audit, SAST, secret scan i image scan.
- CodeQL, Gitleaks i Trivy quan existeixi runtime.
- SBOM SPDX/CycloneDX i provenance de release.
- Actions de CI fixades i permisos minimals.
- Imatges signades i desplegades per digest abans de comercialitzar.
- Cap secret de produccio disponible en PRs o builds no confiables.

## Observabilitat de seguretat

- Request/correlation ID entre proxy, API, worker i connector.
- Logs JSON redaccionats i sense bodies sensibles per defecte.
- Auditoria separada i append-only.
- Alertes per auth failures, canvis de rol, secrets, SSRF blocks, webhooks invalids, rate limits i exports.
- Clock sincronitzat per signatures, TOTP i investigacio.

## Backups i resposta

- Backups xifrats, immutables quan sigui possible i externs a la VPS.
- RPO <= 1 hora i RTO <= 4 hores verificats.
- Restauracio mensual en host net.
- Runbook d'incident: contenir, preservar evidencia, rotar, recuperar, comunicar i corregir causa arrel.
- Una credencial exposada es revoca; eliminar-la de Git no es suficient.

## Gates obligatoris

Cap release entra a produccio sense:

1. Threat model actualitzat.
2. Tests d'autoritzacio i tenant negatius.
3. Scans de dependencies, secrets, codi i imatge.
4. Migracio i rollback.
5. Backup/restore compatible.
6. Logs i alertes redaccionats.
7. Revisio de configuracio Docker i ports publicats.
8. Vulnerabilitats critiques o altes resoltes o risc formalment acceptat.

## Referencies normatives

- OWASP ASVS 5.0.
- OWASP Cheat Sheet Series: SSRF, CSRF, authentication, sessions, web services i uploads.
- NIST SP 800-218 Secure Software Development Framework.
- Docker Engine security, rootless mode i Compose secrets.
