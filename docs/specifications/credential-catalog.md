# Cataleg de credencials humanes

**Estat:** aprovada per implementar (Fase 12 S7, 26 d'agost de 2026).

**ADR:** `docs/adr/0010-hybrid-credential-custody.md`.

**Guia:** `docs/development/phase-12-password-manager-integration-guide.md`.

## Problema i usuaris

L'empresa necessita localitzar accessos compartits per client, aplicacio i responsable sense
desar-ne el valor a Control Hub. Owners, administradors autoritzats i tecnics assignats han de
poder trobar la fitxa, superar una comprovacio d'acces recent i obrir l'item corresponent a
Bitwarden Password Manager. Bitwarden continua sent l'unic sistema que desxifra el valor.

## Abast

- registrar instal·lacions Bitwarden amb configuracio publica;
- catalogar metadata empresarial i una referencia externa opaca xifrada;
- cercar, filtrar, revisar, arxivar i revocar fitxes;
- obrir un item de Bitwarden amb reautenticacio, MFA, RBAC i auditoria;
- relacionar una fitxa amb un client o subscripcio del mateix tenant;
- desplegar Bitwarden com a frontera independent, encara que inicialment comparteixi VPS.

## Fora d'abast

- rebre, desar, revelar, copiar o exportar passwords, TOTP, recovery codes o master passwords;
- incrustar el web vault, implementar autofill o substituir clients Bitwarden;
- mantenir un CLI o Vault Management API desbloquejats al servidor;
- importar exports de vault en text pla;
- prometre SSO, SCIM o automatitzacio de membres sense pla i contracte aprovats;
- usar Bitwarden Secrets Manager o el vault de connectors per a credencials humanes.

## Fluxos

### Configurar una instal·lacio

1. Un Owner amb MFA recent registra nom, mode de desplegament i `base_url` HTTPS.
2. El backend normalitza i valida la URL; no hi fa cap peticio.
3. La configuracio queda tenant-scoped i auditada sense tokens.

### Crear una fitxa

1. La UI indica que l'item s'ha de crear primer a Bitwarden.
2. Un membre autoritzat introdueix metadata no secreta i enganxa l'enllaç oficial de l'item.
3. El backend exigeix que l'origen coincideixi exactament amb la instal·lacio registrada, extreu
   l'identificador segons un parser versionat i rebutja fragments o parametres desconeguts.
4. La referencia es xifra amb context `credential_catalog_reference`, tenant i registre.
5. La resposta no retorna la referencia ni l'enllaç original.

### Obrir una credencial

1. `POST .../open-intents` exigeix permis, assignacio si aplica, MFA i autenticacio recent.
2. El backend audita l'intent i genera una destinacio sota la `base_url` registrada.
3. La resposta porta `Cache-Control: no-store`; la UI obre una pestanya amb `noopener,noreferrer`.
4. Bitwarden torna a exigir sessio/desbloqueig i autoritza l'item amb els seus permisos.

### Revisar, revocar i arxivar

Una revisio confirma metadata i ownership, mai el valor. Revocar marca que l'acces extern s'ha de
retirar i crea una tasca operativa; no afirma que Bitwarden ja l'hagi revocat. Arxivar es
reversible i no elimina auditoria. No hi ha eliminacio fisica des de l'API ordinaria.

## Criteris d'acceptacio

- cap request o response conte camps de valor secret;
- un membre d'un altre tenant no pot inferir instal·lacions ni fitxes;
- `Owner` configura la instal·lacio; la resta aplica els permisos definits;
- tota obertura exigeix MFA i autenticacio recent, i queda auditada;
- l'enllaç nomes pot apuntar al host HTTPS registrat i al format oficial allowlisted;
- una referencia manipulada, antiga o desxifrable amb un altre context falla tancada;
- client, subscripcio, responsable i instal·lacio pertanyen al mateix tenant;
- llistat paginat i filtrable sense exposar referencies;
- UI `ca`, `es`, `en`, accessible, responsive, dark mode i reduced motion;
- Bitwarden indisponible no degrada a una copia local del secret;
- Control Hub i Bitwarden es poden restaurar i migrar independentment.

## Permisos i tenancy

Permisos nous:

- `credentials:read`: llistar i llegir fitxes visibles;
- `credentials:open`: crear un intent d'obertura;
- `credentials:manage`: crear, editar, revisar, revocar i arxivar;
- `password_manager:manage`: configurar instal·lacions, reservat a Owner.

`Owner` rep tots quatre. `Administrator` pot rebre els tres primers. `Technical` pot rebre
`credentials:read` i `credentials:open`, limitats a entrades assignades o compartides. Tot acces
aplica `tenant_id` a repositori i RLS. Els permisos de Control Hub no substitueixen els de
Bitwarden.

## Model de dades i migracio

Les taules i enums son els definits a la guia. La migracio es additiva, determinista i inclou:

- FKs compostes per impedir relacions cross-tenant;
- RLS i `force row level security`;
- index per tenant, estat, revisio i responsable;
- unicitat de nom d'instal·lacio dins del tenant;
- `version` per rebutjar lost updates;
- events append-only sense `update` ni `delete` per al rol runtime.

La referencia s'emmagatzema amb `key_id`, nonce, ciphertext i auth tag o l'envelope equivalent
del port criptografic existent. No es pot cercar per referencia i no se'n desa cap hash que actuï
com a oracle.

## API, events i idempotencia

El contracte inicial es el de la guia i es publica a OpenAPI. Les mutacions accepten una clau
d'idempotencia quan un doble enviament pugui duplicar events. Els errors segueixen RFC 9457.

`open-intents` retorna exclusivament `{ destination, expiresAt }`, amb expiracio curta de la
instruccio de Control Hub; no converteix l'URL permanent de Bitwarden en un bearer token. No hi ha
redirect backend generic. Tota destinacio es reconstrueix des de dades allowlisted.

## UX, i18n i accessibilitat

La subseccio es **Seguretat > Contrasenyes**, diferenciada visualment de **Secrets**. La fitxa
mostra client, aplicacio, compte etiquetat, responsable, estat i revisio. El domini Bitwarden es
visible abans d'obrir. No hi ha camps semblants a una caixa forta. Els desplegables utilitzen
`SelectControl` o `SelectField`.

## Threat model

El threat model vinculant es `docs/security/credential-catalog-threat-model.md`. Els riscos
principals son IDOR cross-tenant, escalada de permisos, open redirect, exfiltracio de referencia,
compromis simultani per compartir VPS i confusio entre cataleg i revocacio real.

## Observabilitat i auditoria

- metriques de recomptes i latencia amb labels fixes, mai client, email o referencia;
- events d'alta, canvi, revisio, revocacio, arxiu i obertura amb before/after allowlisted;
- cap URL completa en access logs, traces, analytics o error reporting;
- alerta per intents refusats repetits, referencies invalides i divergencia d'offboarding.

## Pla de proves

- unit: parser d'enllaç, estats, visibilitat, permisos i envelope context;
- integracio: RLS, FKs cross-tenant, concurrencia, events immutables i rotacio de key ring;
- API: MFA, reauth, rol, IDOR, open redirect, cache headers i rate limit;
- UI: flux Owner, Technical assignat, teclat, focus, i18n i errors;
- contracte: Bitwarden simulat; cap dependencia externa a CI;
- operacio: backup, restauracio i canvi de `base_url` en un pilot separat.

## Rollout, feature flag i rollback

Flag `credential_catalog`, desactivada per defecte. El rollout comença amb dades ficticies i un
tenant pilot. Desactivar la flag retira UI i endpoints de producte, pero conserva dades i
auditoria. El rollback de codi no elimina taules. No entren credencials critiques fins haver
restaurat Bitwarden i Control Hub per separat.

## Dependencia i llicencia de Bitwarden

La validacio del 26 d'agost de 2026 fixa aquests gates:

- self-hosting base disponible, pero funcionalitats pagades requereixen llicencia activa;
- l'organitzacio empresarial self-hosted i SSO/policies s'han de validar contra el pla Enterprise;
- Public API per gestio organitzativa no dona acces als items del vault;
- els deep links oficials requereixen que l'usuari estigui autenticat i autoritzat;
- cada instal·lacio te installation ID/key propis, tractats com secrets de plataforma;
- SMTP de Bitwarden per invitacions es configuracio del seu stack, no l'SMTP de Control Hub.

Abans de S11, el propietari aprova cost, pla, termes, regió i politica de cloud communication.

Referencies revisades:

- [Self-host Bitwarden](https://bitwarden.com/help/self-host-bitwarden/)
- [Llicencies self-hosted](https://bitwarden.com/help/licensing-on-premise/)
- [APIs de Password Manager](https://bitwarden.com/help/bitwarden-apis/)
- [Enllaços oficials a items](https://bitwarden.com/help/link-to-an-item/)
