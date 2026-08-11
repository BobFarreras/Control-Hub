# ADR-0008 - Vault logic de credencials de connector

**Estat:** aprovada

**Context:** l'ADR-0005 decideix *on* viuen les credencials de connector (payload xifrat a
PostgreSQL, clau mestra injectada fora de la base) pero no fixa *amb que* es xifren. La Fase 6
necessita aquesta decisio abans d'escriure la primera migracio, perque el format del ciphertext
no es pot canviar despres sense reescriure dades ja xifrades.

## Decisio

Xifrat autenticat **AES-256-GCM** amb `node:crypto`, sense cap dependencia nova.

Un **anell de claus** versionat s'injecta per Docker secret o variable d'entorn i el valida
`packages/config` en arrencar: una clau activa per escriure i zero o mes claus retirades que
nomes es poden llegir. Cada ciphertext porta a sobre el `key_id` i el nonce que l'han produit,
de manera que rotar la clau mestra no obliga a reescriure res: el registre antic se segueix
podent obrir amb la clau amb que es va segellar.

Les funcions de segellat i obertura viuen a `packages/persistence`, al costat del repositori que
escriu la columna. **Nomes el worker obre un sobre**; l'API escriu i mai desxifra.

## Alternatives descartades

- **`pgcrypto` dins de PostgreSQL.** La clau viatjaria dins de sentencies SQL i acabaria a
  `pg_stat_statements`, als logs de consulta lenta i a qualsevol traça de la connexio. A mes
  lligaria el format del xifrat al motor de base de dades.
- **Secret manager extern (Vault, Infisical) des del dia 1.** Millor custodia, pero afegeix un
  servei obligatori a una instal·lacio que ha de poder viure sola en una VPS. L'ADR-0005 el
  reserva per a secrets de plataforma, no per a credencials per tenant.

## Controls

- Clau de 32 bytes; nonce de 12 bytes aleatori i **mai reutilitzat** amb la mateixa clau.
- `tenant_id` i `instance_id` entren com a **additional authenticated data**: un ciphertext
  mogut a un altre tenant no obre, encara que la clau sigui la mateixa.
- Tag GCM verificat abans de retornar res; un ciphertext manipulat falla, no degrada.
- Desxifrat just-in-time al worker; el text pla no s'assigna mai a un camp d'un objecte que
  pugui acabar a un log, a un job payload o a una resposta.
- `last_used_at`, `rotated_at`, `expires_at` i `revoked_at` son metadades separades del sobre i
  si es poden llegir per API.
- Claus diferents per entorn. Perdre l'anell de claus vol dir tornar a donar d'alta les
  credencials, no perdre dades empresarials.

## Custodia

Decidida pel propietari l'11 d'agost de 2026.

- **En operacio:** Docker secret a la VPS, injectat al proces. Mai al repositori ni a cap `.env`
  versionat.
- **Copia de recuperacio:** entrada en un gestor de contrasenyes, xifrada al client i amb registre
  d'acces.
- **Break-glass:** una copia segellada amb `age` fora del gestor. El Drive nomes pot contenir
  aquest sobre, mai el text pla: l'historial de revisions i la paperera del Drive conserven
  copies que no s'esborren quan s'esborra el fitxer.

La regla que ho ordena tot: **la clau no pot ser llegible des de la mateixa capa d'automatitzacio
que protegeix.** Si un workflow d'n8n pot arribar a la copia, un workflow compromes obre totes les
credencials de tots els connectors i el xifrat no ha servit de res.

## Consequencies

- El format del sobre (`key_id`, nonce, tag, ciphertext) es contracte de dades: canviar-lo exigeix
  una ADR nova i una migracio de reescriptura.
- La rotacio de la clau mestra es una operacio d'operacio documentada a runbook, no un
  desplegament: publicar la clau nova com a activa i deixar l'antiga com a llegible.
- Un backup de PostgreSQL sense l'anell de claus no filtra credencials, cosa que simplifica la
  politica de backups.
