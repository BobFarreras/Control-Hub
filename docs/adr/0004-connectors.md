# ADR-0004 - Connectors per ports i adaptadors

**Estat:** proposada

## Decisio

Els connectors s'implementen dins el monorepo i es registren en build-time. No es carregara codi arbitrari en runtime. Cada connector implementa contractes versionats de configuracio, salut, sincronitzacio i webhooks.

Les instancies pertanyen a un tenant. El worker executa I/O extern amb timeout, retry limitat, rate limit, circuit breaker quan calgui i idempotencia.

## Consequencies

- Tipatge, revisio i supply-chain controlats.
- Un connector defectuos no pot saltar limits de tenant.
- Afegir connectors requereix una release, que es preferible a plugins remots no fiables durant 1.x.
