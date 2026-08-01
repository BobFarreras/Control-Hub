# Threat model inicial

Metodologia STRIDE aplicada a les fronteres principals. Es revisa per cada feature sensible.

## Actius

- Identitats, sessions i permisos.
- Dades de clients i finances operatives.
- Credencials de connectors.
- Infraestructura i capacitats operatives.
- Auditoria, backups i claus de xifrat.

## Fronteres de confianca

```text
Browser | Internet | Reverse proxy | Web/API | PostgreSQL
                                      | Worker | Queue
                                      | Connectors | Third-party APIs
                                      | Metrics | VPS agents
```

## Amenaces prioritaries

| Amenaca | Impacte | Controls principals |
|---|---|---|
| Cross-tenant access/IDOR | Critic | Context de tenant, repositoris scoped, RLS, tests negatius |
| Account takeover | Critic | MFA, rate limit, sessions revocables, deteccio, reautenticacio |
| Secret exfiltration | Critic | Xifrat, redaccio, minim privilegi, rotacio, cap secret a responses |
| SSRF via connector/URL | Critic | Allowlist de schemes/hosts, DNS/IP validation, egress policy |
| Webhook forgery/replay | Alt | HMAC, timestamp, nonce/idempotencia, body raw verificat |
| Queue duplicate effects | Alt | Outbox, idempotency keys, handlers at-least-once |
| Supply-chain compromise | Alt | Lockfile, Dependabot, SBOM, scans, actions fixades i signatures |
| Privilege escalation | Critic | Permisos server-side, reauth, auditoria, deny by default |
| Audit tampering | Alt | Append-only, acces restringit, backups, export verificable |
| Backup theft | Critic | Xifrat, custodia de claus separada, access control |
| Malicious MCP/tool call | Critic | OAuth audience/scopes, consentiment, confirmacio, no passthrough |
| Arbitrary host control | Critic | Sense SSH lliure/Docker socket; agent amb comandes allowlisted |

## Requisits de feature

Una feature que toca autenticacio, permisos, diners, secrets, uploads, URLs, webhooks, infraestructura o eliminacio inclou:

1. Actius i actors.
2. Inputs i fronteres.
3. Casos d'abus.
4. Controls preventius i detectius.
5. Tests negatius.
6. Risc residual aprovat.
