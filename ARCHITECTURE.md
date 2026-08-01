# Control Hub Architecture

## Principis

Control Hub es un monolit modular desplegable en contenidors. El nucli es independent dels proveidors i les integracions es connecten mitjancant ports i adaptadors.

```text
Browser
  |
  v
Next.js Web -----> Fastify API -----> Application use cases
                         |                     |
                         |              Domain modules
                         |                     |
                         +------> PostgreSQL adapters
                         +------> Queue port -> Redis/BullMQ -> Worker
                         +------> Connector ports -> External systems
```

## Unitats desplegables

- `web`: UI Next.js; no conte regles de negoci critiques.
- `api`: autenticacio, autoritzacio, OpenAPI i execucio de casos d'us.
- `worker`: jobs asincrons, sincronitzacions i notificacions.
- `postgres`: font de veritat.
- `redis`: cua i coordinacio efimera.

n8n, proxies, monitoratge i object storage son serveis externs o perfils opcionals.

## Estructura prevista

```text
apps/
  web/
  api/
  worker/
packages/
  domain/
  application/
  database/
  auth/
  connectors/
  observability/
  contracts/
  ui/
deploy/
  compose.yaml
  profiles/
docs/
  adr/
  architecture/
  product/
  runbooks/
  specifications/
```

## Moduls de domini

- Identity and access.
- Tenants and memberships.
- Leads and customers.
- Products, plans and subscriptions.
- Tickets, incidents and SLA.
- Infrastructure inventory and health.
- Integrations and credentials.
- Usage, costs and margins.
- Audit and notifications.

Els moduls es comuniquen mitjancant casos d'us o events interns tipats. No importen implementacions internes d'altres moduls.

## Tenancy i autoritzacio

Una instal·lacio es single-tenant inicialment, pero totes les dades empresarials estan preparades per multiples tenants.

```text
Authenticated principal
  -> tenant membership
  -> permission set
  -> request context
  -> use case
  -> tenant-scoped repository
  -> database constraints + RLS
```

Els permisos utilitzen accions explicites, per exemple `customers:read` o `integrations:manage`. Els rols agrupen permisos, pero el codi autoritza permisos, no noms de rol dispersos.

## Connectors

Un connector implementa un port estable del core i declara capacitats. La configuracio es validada i les credencials es referencien, no es propaguen com a objectes globals.

```ts
export interface Connector {
  readonly manifest: ConnectorManifest;
  validateConfiguration(input: unknown): Promise<ValidationResult>;
  checkHealth(context: ConnectorContext): Promise<HealthResult>;
  synchronize(context: ConnectorContext): Promise<SyncResult>;
}
```

Una instancia de connector pertany a un tenant i conserva estat de sincronitzacio, versio, errors i audit trail. Les crides externes incorporen timeout, backoff limitat, circuit breaking quan sigui necessari i claus d'idempotencia.

### n8n

El connector n8n consumeix API oficial, webhooks i metriques. Emmagatzema metadades necessaries per cercar i relacionar workflows, pero n8n continua sent el propietari dels workflows i execucions. Els enllacos obren la UI externa sense transmetre secrets.

### VPS

La salut s'obte de Prometheus/exporters o d'un agent restringit. Les accions operatives permeses es modelen com ordres concretes i auditables; no existeix execucio arbitraria de shell des del panell.

## Dades

PostgreSQL es la font de veritat. Redis pot perdre's i reconstruir-se sense perdre estat empresarial. Els jobs persistents han de poder reprendre's de forma idempotent.

Les taules tenant-scoped inclouen `tenant_id`. Les referencies externes utilitzen uniques compostes. Les credencials es guarden xifrades amb versionat de claus; la clau mestra s'injecta fora de PostgreSQL.

## APIs i events

- REST JSON versionat sota `/api/v1` i descrit amb OpenAPI.
- Webhooks autenticats, idempotents i protegits contra replay.
- Events interns amb nom, versio, tenant, correlation ID i timestamp.
- MCP reutilitzara casos d'us existents; no accedira directament als repositoris.

## Desplegament

La configuracio segueix principis twelve-factor, amb validacio estricta en arrencar. `compose.yaml` defineix el core i els perfils afegeixen serveis opcionals. No es requereix un DNS, proxy, registry o cloud concrets.

Els contenidors son no-root, tenen healthchecks, filesystem read-only quan sigui viable, limits de recursos i xarxes amb privilegi minim. Les imatges no utilitzen `latest` en produccio.

## Observabilitat

- Logs JSON redaccionats.
- Request/correlation IDs propagats entre API, cua i connectors.
- Metriques RED per serveis i metriques de negoci separades.
- Traces distribuides quan el volum ho justifiqui.
- Alertes accionables amb runbook associat.

## Fiabilitat

- Jobs at-least-once i handlers idempotents.
- Timeouts obligatoris en I/O extern.
- Retries nomes per errors transitoris.
- Graceful shutdown d'API i workers.
- Backups externs xifrats i restauracions provades.
- Migracions expand/contract per mantenir compatibilitat durant actualitzacions.

## Evolucio

Un modul nomes es separara en servei quan existeixi una necessitat mesurable d'escalat, aillament, disponibilitat o propietat d'equip. La separacio conservara els contractes d'aplicacio existents i no duplicara dades sense una estrategia explicita de consistencia.
