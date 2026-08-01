# Model d'auditoria

L'auditoria es append-only i separada dels logs de diagnosi.

## Event

```text
id, occurred_at, tenant_id
actor_type, actor_id, session_id
action, resource_type, resource_id
outcome, reason_code
request_id, source_ip_hash, user_agent_summary
changes, metadata, schema_version
```

## Requisits

- `changes` conte allowlisted before/after; mai secrets.
- Timestamps del servidor en UTC.
- Fallades d'autoritzacio rellevants també es registren.
- Consultes d'auditoria estan auditades.
- Retencio configurable, minim inicial de 365 dies per events de seguretat.
- Exportacio verificable i paginada.
- Cap update/delete des de l'aplicacio ordinaria.

## Accions obligatories

Login, logout, MFA, recuperacio, revocacio, memberships, rols, exports, eliminacions, credencials, connectors, operacions d'infraestructura, canvis financers i configuracio de seguretat.
