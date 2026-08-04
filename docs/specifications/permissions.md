# Permisos i rols

L'API autoritza permisos; els rols nomes els agrupen. Deny by default.

## Convencio

```text
domain:action
```

Accions comunes: `read`, `create`, `update`, `delete`, `manage`, `export`, `operate`.

## Matriu inicial

| Permis | Owner | Administrator | Technical |
|---|:---:|:---:|:---:|
| `tenant:manage` | X |  |  |
| `members:manage` | X | X |  |
| `roles:manage` | X | X |  |
| `audit:read` | X | X | X |
| `customers:manage` | X | X |  |
| `leads:manage` | X | X |  |
| `projects:manage` | X | X | X |
| `products:manage` | X | X |  |
| `subscriptions:manage` | X | X |  |
| `financials:read` | X | X |  |
| `tickets:read` | X | X | X |
| `tickets:manage` | X | X | X |
| `support:configure` | X | X |  |
| `infrastructure:read` | X | X | X |
| `infrastructure:operate` | X |  | X |
| `integrations:read` | X | X | X |
| `integrations:manage` | X |  | X |
| `credentials:rotate` | X |  | X |
| `usage:read` | X | X | X |
| `security:manage` | X |  | X |

## Regles

- Una membership pot tenir diversos rols.
- Accions critiques exigeixen reautenticacio encara que existeixi permis.
- El frontend pot ocultar accions, pero l'API sempre valida.
- Service accounts tenen scopes explicits, no rols humans.
- Canvis de rol, secrets i operacions d'infraestructura generen auditoria.
- L'Owner no pot eliminar accidentalment l'ultima membership Owner activa.
