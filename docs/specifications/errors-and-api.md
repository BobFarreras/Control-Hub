# Contracte d'API i errors

## API

- REST JSON sota `/api/v1`.
- OpenAPI es el contracte public.
- IDs opacs; timestamps RFC 3339 UTC.
- Paginacio cursor-based per llistes variables.
- Filtres i sort declarats per endpoint.
- `Idempotency-Key` obligatoria per operacions externes repetibles.

## Problem details

Errors segons RFC 9457 amb extensions estables:

```json
{
  "type": "https://control-hub.example/problems/permission-denied",
  "title": "Permission denied",
  "status": 403,
  "code": "permission_denied",
  "instance": "/api/v1/integrations/01...",
  "requestId": "01...",
  "params": { "permission": "integrations:manage" }
}
```

`title` no conte secrets ni detalls interns. La UI localitza `code`; logs i metriques utilitzen codis estables.

## Classes

- `400` input malformat.
- `401` identitat absent o invalida.
- `403` permis o tenant incorrecte, sense confirmar existencia aliena.
- `404` recurs inexistent dins l'scope visible.
- `409` invariant, versio o idempotencia conflictiva.
- `422` regla de negoci no satisfeta.
- `429` limit superat amb `Retry-After`.
- `503` dependencia temporalment no disponible.

No s'utilitza `200` per representar errors.
