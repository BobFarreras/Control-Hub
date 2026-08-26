# Guia d'implementacio del cataleg de credencials i Bitwarden Password Manager

**Estat:** aprovada el 26 d'agost de 2026; S7 implementat en documentacio.

**Decisio canonica:** `docs/adr/0010-hybrid-credential-custody.md`.

**Referencies de proveidor:** [self-hosting oficial](https://bitwarden.com/help/self-host-bitwarden/)
i [APIs de Password Manager](https://bitwarden.com/help/bitwarden-apis/). Es revisen de nou abans
de cada increment que depengui d'una funcionalitat o llicencia externa.

## Objectiu

Control Hub ha de permetre trobar i governar credencials humanes de l'empresa i dels clients des
d'un sol lloc, sense convertir la seva API en una caixa forta. Bitwarden Password Manager
custodia, xifra, desbloqueja i mostra el valor. Control Hub conserva el context empresarial, els
permisos de navegacio, el cicle de revisio i l'auditoria.

Un registre pot indicar que el client Toni te un acces d'administracio a Hostinger, qui n'es el
responsable i on s'obre al vault. Passwords, TOTP, recovery codes, claus privades i notes secretes
no entren a la base de dades, logs, cues ni navegador de Control Hub.

La pantalla **Configuracio de secrets** existent continua dedicada als secrets tecnics del
runtime. El cataleg de credencials es una superficie diferent.

## Frontera de seguretat

```text
Control Hub                         Bitwarden Password Manager
-------------------------------     ---------------------------------
client, aplicacio i categoria       username i password
responsable i estat                 TOTP i recovery codes
referencia opaca al vault      -->  secure notes i attachments
data de revisio                     desbloqueig amb master password
RBAC, MFA i auditoria d'obertura    xifrat, autofill i sessions
```

- Cada persona te compte, MFA i master password propis a Bitwarden.
- Control Hub no demana, transmet, desa ni registra la master password.
- El backend no manté `bw serve` ni cap sessio de vault desbloquejada.
- La Public API de Bitwarden no es tracta com una API de lectura d'items.
- Les referencies externes es desen xifrades i no apareixen en logs.
- Obrir Bitwarden es navegacio del browser, mai un proxy server-side.
- No s'incrusta el web vault en un `iframe`.
- El vault de connectors i Bitwarden Secrets Manager conserven els seus usos actuals; no
  custodien passwords humans.

## Desplegament

### Etapa A: mateixa VPS, fronteres independents

La primera instal·lacio pot compartir host per reduir cost, pero no stack ni trust boundary:

```text
reverse proxy / TLS
   |-- control.empresa.example --> stack Control Hub
   `-- vault.empresa.example   --> stack oficial Bitwarden
```

Requisits:

- projecte Compose, directori operatiu i release independents;
- subdomini HTTPS dedicat i cookies restringides al seu host;
- cap xarxa Docker comuna si la integracio no la necessita;
- base de dades, volums, secrets i backups separats;
- imatges fixades per digest o versio i actualitzacions provades en staging;
- health checks, limits, logs i alertes independents;
- cap base de dades publicada a Internet;
- restauracio de cada producte sense dependre de l'altre.

S'usa la distribucio oficial self-hosted adequada a una organitzacio. Bitwarden Lite nomes es
tria despres de validar funcionalitat, suport, llicencia, creixement i recuperacio, no pel nombre
de contenidors.

### Etapa B: VPS dedicada per Bitwarden

La referencia funcional sera `provider + installation_id + opaque_reference`, no una IP o URL
construida. Aixi la migracio no canvia el domini del cataleg.

1. Preparar la nova VPS amb hardening, TLS, monitoratge i backups.
2. Restaurar una copia en una xarxa aillada i validar comptes, col·leccions, attachments i MFA.
3. Reduir TTL DNS i programar la finestra.
4. Aturar escriptures, fer backup final i restaurar-lo a la nova instancia.
5. Canviar DNS i validar web, desktop, mobil i extensions.
6. Conservar l'anterior instancia apagada i aillada durant el rollback.
7. Destruir copies temporals i revocar credencials antigues.

Control Hub nomes modifica la `base_url` publica de la instal·lacio amb Owner, MFA i auditoria.

## Model de domini

### `password_manager_installations`

- `id`, `tenant_id`, `provider=bitwarden`;
- `display_name` i `base_url` HTTPS validada;
- `deployment_mode=cloud|self_hosted_shared_vps|self_hosted_dedicated_vps`;
- `status=active|degraded|disabled`;
- timestamps i versio de configuracio;
- cap API key, token o master password.

No es fa health check arbitrari a la URL. Una comprovacio futura ha d'usar el client sortint
protegit contra SSRF i una allowlist.

### `credential_catalog_entries`

- `id`, `tenant_id`, `installation_id`;
- `client_id` i `company_subscription_id` opcionals amb FK tenant-scoped;
- `application_name`, `category`, `environment` i `account_label` no secret;
- `owner_membership_id`;
- `status=active|review_due|revoked|archived`;
- `opaque_reference_ciphertext` i `opaque_reference_key_id`;
- dates de revisio, timestamps i `version` per concurrencia optimista.

No es desen URLs completes d'items si incorporen IDs. L'adaptador valida la referencia i genera
una destinacio sota la `base_url` registrada. Si no hi ha deep link oficial estable, s'obre la
col·leccio o el vault general amb una instruccio de cerca no secreta.

### Auditoria

`credential_catalog_events` es append-only i registra alta, edicio, responsable, revisio,
arxiu, revocacio i intents d'obertura. Desa actor, tenant, timestamp, request ID i resultat amb
camps allowlisted; mai referencia externa, correu complet o secret. Retencio inicial: 90 dies.

## Autoritzacio

- `Owner`: configura instal·lacions i administra tot el cataleg.
- `Administrator`: administra entrades amb `credentials:manage`, pero no la instal·lacio.
- `Technical`: llegeix i obre entrades assignades amb `credentials:read`.
- resta: deny by default.

Tota consulta aplica `tenant_id` al backend i RLS. Crear, editar, arxivar, canviar permisos o
obrir exigeix sessio recent i MFA. Bitwarden torna a autoritzar l'acces real al vault.
L'offboarding revoca primer l'usuari a Bitwarden i despres l'acces al cataleg.

## UX

Nova subseccio **Seguretat > Contrasenyes**:

- cerca i filtres per client, aplicacio, categoria, responsable i estat;
- llistat paginat, detall, historial i data de revisio;
- accio **Obrir a Bitwarden** amb el domini de destinacio visible;
- alta guiada: crear l'item a Bitwarden i registrar-ne la referencia;
- avisos per revisio vençuda, responsable absent o instal·lacio deshabilitada.

No hi ha camps password, copia de valors, previsualitzacio ni autofill propi. La primera entrega
inclou `ca`, `es`, `en`, teclat, lector de pantalla, dark mode, responsive i reduced motion.

## Contracte API inicial

- `GET|POST /api/v1/password-manager/installations`
- `PATCH /api/v1/password-manager/installations/{id}`
- `GET|POST /api/v1/credential-catalog`
- `GET|PATCH /api/v1/credential-catalog/{id}`
- `POST /api/v1/credential-catalog/{id}/open-intents`
- `POST /api/v1/credential-catalog/{id}/reviews`
- `POST /api/v1/credential-catalog/{id}/archive`

`open-intents` reautentica, autoritza i audita abans de retornar una destinacio HTTPS de vida
curta o una instruccio de navegacio. No recupera l'item ni retorna la referencia opaca. Les
mutacions sensibles son idempotents i els errors RFC 9457 no exposen detalls interns.

## Integracions posteriors

Cada integracio requereix validar pla, llicencia i contracte oficial vigent:

- Public API per membres, grups, col·leccions, policies i event logs;
- SCIM o Directory Connector per provisionament i offboarding;
- SSO/OIDC per reduir friccio d'identitat;
- conciliacio de referencies orfes sense llegir passwords.

La Vault Management API basada en un CLI local desbloquejat no forma part de l'arquitectura del
servidor. Una excepcio futura requereix ADR i threat model nous.

## Operacio i recuperacio

- backups Bitwarden separats, xifrats i amb copia off-site;
- claus de backup per un canal diferent del de Control Hub;
- restauracio trimestral en entorn aillat i RPO/RTO propis;
- break-glass amb dos responsables, mai una master password compartida;
- alertes de backup, certificat, disc, autenticacio i versio vulnerable;
- actualitzacio primer en staging, backup verificat i rollback;
- si Bitwarden cau, el cataleg continua visible pero l'obertura queda deshabilitada i Control Hub
  no ofereix cap copia del secret.

## Increments

### S7 — Especificacio i threat model

**Implementat** a `docs/specifications/credential-catalog.md` i
`docs/security/credential-catalog-threat-model.md`. El contracte fixa domini, fluxos, permisos,
tenancy, API, UX, rollout i proves; el threat model cobreix redirects, referencies opaques,
offboarding i el blast radius de la VPS compartida. La matriu de dependencia externa valida les
funcions oficials disponibles i deixa cost, pla, termes i regio com a gate explicit abans d'S11.

### S8 — Domini, persistencia i permisos

**Implementat** amb vocabulari i transicions al domini, els permisos `credentials:read`,
`credentials:open`, `credentials:manage` i `vault:manage`, casos d'us desacoblats i un repositori
PostgreSQL. La migracio `0058_credential_catalog.sql` crea instal·lacions, entrades i events amb
RLS forçada, FKs compostes tenant-scoped, concurrencia optimista i historial append-only. Les
referencies usen AES-256-GCM amb context propi de tenant i entrada; les lectures ordinàries no
seleccionen cap columna de l'envelope.

### S9 — API i auditoria

**Implementat** amb la flag `credential_catalog`, els deu endpoints inicials publicats a OpenAPI,
errors RFC 9457, validacio dels deep links HTTPS contra l'origen registrat, RBAC, MFA i sessio
recent per configurar instal·lacions i obrir entrades. Els open intents reconstrueixen una
destinacio allowlisted, responen amb `Cache-Control: no-store`, tenen rate limit reforcat i
auditen exclusivament identificadors i resultats, mai URLs ni referencies.

### S10 — UI del cataleg

**Implementat** a **Seguretat > Contrasenyes** amb llistat filtrable i paginat, detall, alta
guiada, configuracio Owner de Bitwarden, revisio, revocacio, arxiu/restauracio i navegacio amb
`noopener`, `noreferrer` i validacio defensiva de l'origen. La UI no te cap camp de password ni
cap accio de copiar valors; inclou `ca`, `es`, `en`, teclat, focus, responsive, dark mode i
reduced motion.

### S11 — Bitwarden a la mateixa VPS

Stack oficial independent, reverse proxy, hardening, backups, monitoratge i runbooks.

### S12 — Pilot i VPS dedicada

Pilot no critic, restauracio, simulacre de caiguda i runbook de migracio a VPS dedicada.

## Proves obligatories

- unit: estats, permisos, referencia i navegacio;
- persistencia: RLS, tenant creuat, FKs, concurrencia i arxiu;
- API: MFA absent, rol insuficient, referencia manipulada, open redirect i rate limit;
- UI: teclat, focus, domini visible, errors i sessio expirada;
- seguretat: cap valor o referencia en logs, traces, metriques, jobs, errors o analytics;
- contracte: Bitwarden simulat; CI no depen d'una instancia real;
- operacio: backup, restauracio, actualitzacio, rollback i migracio assajats.

## Criteris per separar VPS

S'executa la migracio quan entra una credencial de client o produccio d'impacte alt, hi ha
competencia sostinguda de recursos, divergeixen RPO/RTO, ho exigeix compliance o cal reduir el
blast radius. Compartir VPS es una etapa economica controlada, no l'arquitectura final.

## Definition of Done

Una persona autoritzada pot localitzar una credencial pel context, superar MFA, obrir-la a
Bitwarden i deixar evidencia d'auditoria. Una persona no autoritzada o d'un altre tenant no pot
inferir-ne l'existencia. Cap API, prova, log, job o backup ordinari de Control Hub conte el valor
o la referencia, i Bitwarden es pot restaurar i migrar a una VPS dedicada sense migrar el domini
del cataleg.
