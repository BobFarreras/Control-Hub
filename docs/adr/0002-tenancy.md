# ADR-0002 - Single-tenant desplegable i domini tenant-aware

**Estat:** proposada

## Decisio

Cada instal·lacio atendra inicialment una empresa, pero totes les dades empresarials inclouran `tenant_id`. El tenant es deriva de la identitat autenticada i es propaga en un `RequestContext` immutable.

Controls acumulatius:

- Repositoris tenant-scoped.
- Claus i uniques compostes.
- Foreign keys que preserven tenant quan sigui viable.
- PostgreSQL RLS per taules sensibles.
- Tests negatius cross-tenant.
- Credencials i auditoria separades.

## Consequencies

Permet instal·lacions independents i evolucio SaaS sense redissenyar el domini. Afegeix disciplina obligatoria a cada consulta i migracio.
