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

## Decisions pendents d'aprovacio

1. ADR-0002: tenancy.
2. ADR-0003: Better Auth integrat o Keycloak extern.
3. ADR-0004: connectors compilats, sense plugins arbitraris runtime.
4. ADR-0005: xifrat de credencials i custodia de clau mestra.
5. ADR-0006: BullMQ amb servidor Redis-compatible i outbox PostgreSQL.
6. ADR-0007: Ubuntu LTS x86_64 com a plataforma certificada inicial.
7. Matriu inicial de permisos.
8. SLO i capacitat de referencia.

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

**Pendent d'aprovacio.** No iniciar Fase 1 fins tancar les decisions pendents.
