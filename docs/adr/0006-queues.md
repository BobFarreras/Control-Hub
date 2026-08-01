# ADR-0006 - Redis-compatible i BullMQ

**Estat:** proposada

## Decisio

BullMQ coordina jobs asincrons sobre un servidor compatible amb el protocol Redis suportat. PostgreSQL conserva l'estat empresarial i l'outbox; la cua es pot reconstruir.

Semantica `at-least-once`:

- Handlers idempotents.
- Idempotency key per efecte extern.
- Retries nomes per errors transitoris.
- Dead-letter state inspeccionable.
- Graceful shutdown i locks amb expiracio.

## Consequencies

Redis no es font de veritat. Una confirmacio de job no substitueix persistencia o auditoria a PostgreSQL.
