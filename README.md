# Control Hub

Plataforma empresarial autohosted per centralitzar clients, leads, productes, subscripcions, tickets, infraestructura, automatitzacions, costos i salut operativa.

## Estat

Versio publicada: **v0.4.1**.

La Fase 2 proporciona identitat Better Auth, tenants, RBAC, MFA, passkeys, sessions revocables, RLS i auditoria append-only. La Fase 3 afegeix el CRM professional. La Fase 4 incorpora cataleg versionat, subscripcions, renovacions, alertes i metriques recurrents auditables per moneda. La Fase 5 tanca suport, tickets i SLA amb rellotge d'horari laboral, escalats al worker i proves end-to-end amb sessio iniciada. La Fase 5B hi afegeix projectes per client, imputacio de temps, barems de cost i de venda versionats per data d'efecte, i rendibilitat per moneda; queda darrere la feature flag `projects_and_time`. La Fase 6 aporta la plataforma de connectors —contracte, vault de credencials i webhooks signats— i la Fase 7.1 el connector n8n amb la pantalla d'infraestructura.

**Les fases 6 i 7.1 queden darrere les flags `connectors` i `infrastructure`, totes dues apagades.** Amb una flag tancada les seves rutes no es declaren i el modul respon 404: publicar-les no les activa.

L'estat detallat i el punt de continuacio son a [`docs/development/current-state.md`](docs/development/current-state.md), que es el primer document a llegir en obrir una sessio.

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
- Sentry per observabilitat d'errors a producció.
- Connectors opcionals per n8n, VPS, correu, IA, monitoratge i altres APIs.

n8n es una aplicacio externa: Control Hub en consulta l'estat mitjancant APIs, webhooks i metriques, i pot obrir la seva URL. No l'incrusta ni en depen per funcionar.

## Documentacio

- [`CHANGELOG.md`](CHANGELOG.md): que ha canviat a cada versio publicada.
- [`Control_Hub_decisio_arquitectura.md`](Control_Hub_decisio_arquitectura.md): decisions aprovades i roadmap.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): arquitectura logica i fonaments tecnics.
- [`AGENTS.md`](AGENTS.md): normes per als agents que modifiquin el repositori.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md): fases, entregables, proves i punts d'aprovacio.
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): sistema visual, temes, components, motion i accessibilitat.
- [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md): catala, castella, angles i regles de localitzacio.
- [`BRANCHING.md`](BRANCHING.md): branques, pull requests, releases i hotfixes.
- [`docs/runbooks/installation.md`](docs/runbooks/installation.md): instal·lacio, primer Owner, membres i actualitzacions.
- [`docs/runbooks/release.md`](docs/runbooks/release.md): publicar una versio -- commit de versio, etiqueta, artefactes i comprovacions.
- [`docs/runbooks/connector-key-rotation.md`](docs/runbooks/connector-key-rotation.md): rotar l'anell de claus que segella les credencials dels connectors.
- [`docs/runbooks/platform-secret-rotation.md`](docs/runbooks/platform-secret-rotation.md): rotar i recuperar secrets bootstrap sense exposar-ne els valors.
- [`docs/runbooks/n8n-error-workflow.md`](docs/runbooks/n8n-error-workflow.md): muntar a n8n el workflow que ens empeny una execucio fallida, signada.
- [`docs/runbooks/connect-a-vps.md`](docs/runbooks/connect-a-vps.md): preparar una VPS perque el Control Hub en llegeixi l'estat, i el prompt per a l'agent que l'administra.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): convencions per contribuir.
- [`SECURITY.md`](SECURITY.md): reporting privat i politica de seguretat.
- [`SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md): baseline d'aplicacio, xarxa, contenidors, dades i supply chain.
- [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md): visio, Release 1.0, usuaris, moduls i connectors.
- [`docs/README.md`](docs/README.md): index d'ADR, especificacions, seguretat, runbooks i plantilles.
- [`DEVELOPMENT.md`](DEVELOPMENT.md): requisits, ordres, URLs i arrencada local.
- [`docs/development/agent-workspaces.md`](docs/development/agent-workspaces.md): treball simultani
  amb una branca, entorn, serveis i base de dades independents per tasca.
- [`docs/development/current-state.md`](docs/development/current-state.md): estat implementat i punt de continuacio.
- [`docs/development/troubleshooting.md`](docs/development/troubleshooting.md): fallades ja diagnosticades, amb causa i solucio.
- [`docs/development/writing-a-connector.md`](docs/development/writing-a-connector.md): afegir un proveidor nou implementant el contracte de connector.
- [`docs/development/dependency-log.md`](docs/development/dependency-log.md): que ha entrat, quan i de quina mida era el salt. Generat amb `pnpm deps:log`.

## Arrencada local

```powershell
corepack enable
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm bootstrap:owner
pnpm dev
```

Control Hub queda disponible a `http://localhost:3001`. Per executar tot el core en contenidors: `docker compose up --build`.

## Roadmap immediat

1. **Instal·lar la v0.4.1 a la VPS** darrere el Traefik que ja hi corre, que es el primer cop que el cami d'instal·lacio es recorre de debo i no en una instal·lacio de mentida.
2. **Encendre les flags dels moduls que ja estan llestos** --`connectors`, `infrastructure`, `usage_costs`, `connector_oauth`, `connector_actions`, `mail`, `mcp` i `credential_catalog`--, una decisio operativa separada de publicar-les.
3. **Fixar les imatges de tercers per digest** --PostgreSQL, Valkey i Mailpit encara van per etiqueta, o sigui que dues instal·lacions de la mateixa versio poden no portar el mateix PostgreSQL.

La Fase 9 —empaquetat, instal·lador i distribucio— **esta lliurada**: cada versio publica quatre imatges firmades per digest, i `install.sh` i `update.sh` cobreixen la instal·lacio i l'actualitzacio amb nomes POSIX sh i docker. Com es publica una versio es a [`docs/runbooks/release.md`](docs/runbooks/release.md) i com s'instal·la a [`docs/runbooks/installation.md`](docs/runbooks/installation.md).

Fases ja lliurades: 5B (projectes i temps), 5C (registre de jornada), 6 (plataforma de connectors), 7.1 (infraestructura i connector n8n), 7.2 (inventari, connector Prometheus i alertes), 7.3 (incorporacio guiada), 7B (OAuth delegat i accions confirmades), connectors de Vercel i Supabase, consum variable de la Fase 8, la bustia de suport, 9 (empaquetat, instal·lador i distribucio), 10 (MCP i servidor de recursos OAuth 2.1), la part de la 12 que cataloga credencials humanes sense desar-ne el valor, i la X (desenvolupament multi-agent).

Les fases i les seves portes d'aprovacio son a [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), que mana sobre aquest resum.

## Seguretat

No es poden versionar `.env`, tokens, claus, certificats privats, dumps, backups ni credencials. Les vulnerabilitats no s'han de publicar en issues publics; el canal privat de reporting es definira abans de la primera release.

## Llicencia

El projecte es privat i propietat de l'empresa. Abans de distribuir-lo comercialment s'afegira una llicencia explicita i es revisaran les llicencies de totes les dependencies i integracions.
