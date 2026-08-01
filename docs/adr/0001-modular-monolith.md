# ADR-0001 - Monolit modular

**Estat:** aprovada

## Context

Control Hub inclou molts dominis, pero comparteix identitat, permisos, dades i operacio. Separar-los en serveis des del principi augmentaria xarxa, consistencia i desplegament sense una necessitat mesurada.

## Decisio

Un monorepo TypeScript amb tres unitats desplegables (`web`, `api`, `worker`) i moduls de domini interns. PostgreSQL es la font de veritat i els connectors son adaptadors.

## Consequencies

- Transaccions i desplegament simples.
- Limits modulars verificats per imports i tests.
- Un modul nomes es separa per una necessitat mesurable d'escalat, aillament o disponibilitat.
