# Control Hub

Plataforma empresarial autohosted per centralitzar clients, leads, productes, subscripcions, tickets, infraestructura, automatitzacions, costos i salut operativa.

## Estat

Projecte en fase de fonaments i especificacio arquitectonica. Encara no hi ha una aplicacio executable.

Control Hub es construeix des del primer increment com a producte professional instal·lable. El roadmap es incremental, pero no utilitza prototips descartables ni una implementacio reduida que requereixi reconstruir el nucli.

## Direccio tecnica

- Monolit modular TypeScript.
- Next.js per a la interfície.
- Fastify per a l'API versionada.
- Worker separat per jobs i sincronitzacions.
- PostgreSQL com a font de veritat.
- Redis i BullMQ per cues.
- Docker Compose portable per desplegar en VPS Linux.
- Single-tenant per instal·lacio, amb model intern tenant-aware.
- Connectors opcionals per n8n, VPS, correu, IA, monitoratge i altres APIs.

n8n es una aplicacio externa: Control Hub en consulta l'estat mitjancant APIs, webhooks i metriques, i pot obrir la seva URL. No l'incrusta ni en depen per funcionar.

## Documentacio

- [`Control_Hub_decisio_arquitectura.md`](Control_Hub_decisio_arquitectura.md): decisions aprovades i roadmap.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): arquitectura logica i fonaments tecnics.
- [`AGENTS.md`](AGENTS.md): normes per als agents que modifiquin el repositori.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md): fases, entregables, proves i punts d'aprovacio.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): sistema visual, temes, components, motion i accessibilitat.
- [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md): catala, castella, angles i regles de localitzacio.
- [`BRANCHING.md`](BRANCHING.md): branques, pull requests, releases i hotfixes.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): convencions per contribuir.
- [`SECURITY.md`](SECURITY.md): reporting privat i politica de seguretat.
- [`SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md): baseline d'aplicacio, xarxa, contenidors, dades i supply chain.
- [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md): visio, Release 1.0, usuaris, moduls i connectors.
- [`docs/README.md`](docs/README.md): index d'ADR, especificacions, seguretat, runbooks i plantilles.
- [`DEVELOPMENT.md`](DEVELOPMENT.md): requisits, ordres, URLs i troubleshooting local.

## Roadmap immediat

1. Crear ADR detallats per tenancy, connectors, secrets i desplegament.
2. Inicialitzar monorepo, toolchain i Docker Compose.
3. Implementar autenticacio, tenant context, permisos i auditoria.
4. Construir els primers moduls de negoci.
5. Afegir connectors sobre contractes estables.

## Seguretat

No es poden versionar `.env`, tokens, claus, certificats privats, dumps, backups ni credencials. Les vulnerabilitats no s'han de publicar en issues publics; el canal privat de reporting es definira abans de la primera release.

## Llicencia

El projecte es privat i propietat de l'empresa. Abans de distribuir-lo comercialment s'afegira una llicencia explicita i es revisaran les llicencies de totes les dependencies i integracions.
