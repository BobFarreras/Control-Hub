# Inventari de secrets i credencials

**Estat:** canonic. **No conte valors, paths interns, IDs externs ni fingerprints.**

La font machine-readable que fa complir aquest inventari es `secrets-inventory.json`. Aquest
document explica les fronteres que una llista de variables no pot expressar.

## Classes

| Classe | Exemples | Custodia | Control Hub mostra el valor? |
|---|---|---|---:|
| `public_config` | origins, ports, client IDs | configuracio versionada o runtime | Si, quan no exposa topologia sensible |
| `bootstrap_secret` | key ring, secret de sessio, credencial de base | runtime o Secrets Manager | No |
| `runtime_secret` | secret materialitzat temporalment per un proces | mount read-only | No |
| `tenant_credential` | PAT, OAuth token, password IMAP | vault intern o Password Manager segons l'actor | No |
| `ephemeral` | credencial E2E, token CI, accés del migrador | runner o entorn d'un sol us | No |

Una URL es secreta si incorpora credencials, encara que el seu nom no contingui `SECRET`. Un
path a un fitxer de credencials no es el valor, pero es tracta com a sensible perquè revela on
trobar-lo i no pot sortir en logs o respostes.

## Credencials humanes aprovades

Passwords de subscripcions empresarials, administradors web, hosting, dominis i comptes cedits
per clients viuen a **Bitwarden Password Manager**. Cada persona usa el seu compte, master
password i MFA; no existeix una master password compartida de Control Hub. Les col·leccions
separen empresa, equips i clients.

Control Hub conserva exclusivament metadata empresarial: client, servei, categoria, responsable,
autoritzats, estat, expiracio, rotacio i una referencia opaca per obrir Bitwarden. No rep el
password, el TOTP ni els codis de recuperacio i no implementa cap endpoint per llegir-los.

## Credencials tenant-scoped de connectors

| Tipus actual | Proveidors | Custodia | Consumidor |
|---|---|---|---|
| `api_token` | n8n, Prometheus, Supabase, Vercel | vault intern AES-256-GCM | worker |
| `admin_api_key` | OpenAI, Anthropic | vault intern AES-256-GCM | worker |
| `oauth_access_token` | Gmail, Microsoft Graph | vault intern AES-256-GCM | worker |
| `oauth_refresh_token` | Gmail, Microsoft Graph | vault intern AES-256-GCM | worker |
| `imap_username` / `imap_password` | IMAP | vault intern AES-256-GCM | worker |
| `ingress_signing` | webhooks, OpenCode, n8n | vault intern AES-256-GCM | API/worker |

Aquestes credencials son dades tenant-scoped i segueixen els ADR 0005 i 0008. Bitwarden no
substitueix el vault de connectors: el worker necessita accés just-in-time sense una persona.

## Secrets de maquina

Les variables sensibles actuals, els consumidors, l'owner, els entorns i la rotacio son al JSON
adjacent. `BWS_ACCESS_TOKEN` autentica exclusivament la machine account de nomes lectura del
pipeline. L'adaptador S4 l'elimina de l'entorn abans de cridar Compose i mai entra al web, API,
worker, PostgreSQL o UI.

## Regla d'alta

Qualsevol variable nova que sembli sensible ha d'entrar al JSON en el mateix commit. La prova
`scripts/secrets-inventory.test.mjs` inspecciona exemples d'entorn, esquemes de configuracio,
Compose, workflows i usos de `process.env`; un nom nou sense classificacio falla.

L'inventari no autoritza una variable. Afegir-la continua exigint model d'amenaces, minim
privilegi, canal d'injeccio, redaccio de logs, rotacio, rollback i actualitzacio del consumidor.

S2 ha activat `*_FILE` per `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`,
`CONNECTOR_KEY_RING` i els client secrets OAuth de Google i Microsoft. El camp `fileVariable`
del JSON vincula cada path amb el secret que materialitza; el path no es una segona credencial.
