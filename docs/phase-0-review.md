# Revisio de Fase 0

## Objectiu

Convertir la visio de Control Hub en decisions, contractes i controls implementables abans del runtime.

## Entregables completats

- Estructura documental canonica.
- ADR de monolit, tenancy, identitat, connectors, secrets, cues i desplegament.
- Matriu inicial de rols i permisos.
- Contracte d'API i errors.
- Model d'auditoria.
- Classificacio, retencio i governanca de dades.
- Requisits operatius i capacitat de referencia.
- Threat model inicial.
- Runbook de disaster recovery.
- Convencions i plantilles.

## Decisions aprovades previament

- Producte professional incremental, no prototip descartable.
- Release 1.0 amb tots els dominis declarats.
- Owner, Administrator i Technical.
- Correu/contrasenya, MFA i compatibilitat amb passkeys.
- Docker Compose, monolit modular i connectors opcionals.

## Decisions aprovades en revisio

- ADR-0002: tenancy.
- ADR-0003: Better Auth integrat.
- ADR-0004: connectors compilats, sense plugins arbitraris runtime.
- ADR-0005: xifrat de credencials i custodia de clau mestra.
- ADR-0006: BullMQ amb servidor Redis-compatible i outbox PostgreSQL.
- ADR-0007: Ubuntu LTS x86_64 com a plataforma certificada inicial.
- Matriu inicial de permisos.
- SLO i capacitat de referencia.

## Evidencia

- `git diff --check`.
- CI `Repository standards` i `Application checks`.
- Revisio manual d'enllacos i estats ADR.

## Riscos residuals

- L'abast de Release 1.0 es ampli i necessita una descomposicio estricta per increments.
- L'opcio d'identitat canvia el perfil operatiu del producte.
- Els objectius de capacitat s'han de validar amb benchmark durant implementacio.
- La politica RGPD i llicencia comercial necessiten revisio especialitzada abans de vendre.

## Estat

**Acceptada.** La PR es pot fusionar a `develop` quan CI estigui en verd.
