# ADR-0005 - Secrets de plataforma i credencials de connectors

**Estat:** proposada

## Decisio

Separar dos tipus:

- Secrets de plataforma: fitxers Docker secrets o secret manager extern.
- Credencials de connector: payload xifrat a PostgreSQL per tenant.

Una clau mestra versionada s'injecta fora de PostgreSQL. El worker desxifra nomes durant l'execucio. L'API mai retorna el secret, nomes metadades i estat de rotacio.

## Controls

- Xifrat autenticat amb nonce unic.
- Key ID i versio a cada ciphertext.
- Redaccio estructurada de logs.
- Rotacio sense downtime.
- Backup de claus amb custodia separada.
- Secrets diferents per entorn.
