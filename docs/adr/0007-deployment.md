# ADR-0007 - Docker Compose portable

**Estat:** proposada

## Decisio

Docker Engine i Compose v2 son el target de produccio 1.x. El core funciona en qualsevol VPS Linux compatible; Ubuntu LTS x86_64 es la plataforma de referencia inicial.

`compose.yaml` defineix web, API, worker, PostgreSQL i cua. Perfils opcionals afegeixen proxy, monitoratge i n8n.

## Controls

- Imatges OCI immutables i no-root.
- Healthchecks i graceful shutdown.
- Xarxes de minim privilegi.
- PostgreSQL i cua sense ports publics.
- Limits de recursos.
- Volums i backups documentats.
- Configuracio validada abans d'arrencar.

## Evolucio

ARM64 i altres distribucions s'incorporen quan CI i proves d'instal·lacio les certifiquin. Kubernetes no forma part del suport 1.x.
