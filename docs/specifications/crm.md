# Especificacio del CRM

**Estat:** aprovada per a la Fase 3.

## Pipeline de leads

El pipeline inicial es `new`, `contacted`, `qualified`, `proposal`, `won` i `lost`.
Les transicions no poden sortir d'un estat terminal. `won` nomes s'assoleix mitjancant
la conversio idempotent a client. Els codis son estables i les etiquetes es localitzen.
L'arquitectura permetra pipelines configurables sense canviar les dades historiques.

## Duplicats

El correu normalitzat i el telefon en format comparable son claus fortes dins del tenant.
Un nom normalitzat semblant genera un avís, pero no bloqueja. La importacio presenta els
errors abans d'escriure i cada fila valida es processa atomicament.

## Autoritzacio

- `Owner` i `Administrator`: lectura i gestio de leads, clients i activitat.
- `Technical`: lectura per relacionar el CRM amb infraestructura i incidencies.
- L'API autoritza permisos `leads:read`, `leads:manage`, `customers:read` i
  `customers:manage`; mai autoritza pel nom del rol.

## Entitats i invariants

- Tot registre empresarial inclou `tenant_id` i queda protegit per RLS.
- Un lead conserva origen, prioritat, responsable, estat i historial de transicions.
- La conversio crea com a maxim un client per lead i conserva la traçabilitat.
- Els clients tenen contactes, notes, tasques i una timeline append-only.
- Les baixes funcionals utilitzen estat; no s'esborra historial comercial des de la UI.
- Dates en UTC i camps monetaris fora d'aquesta fase.

## API

REST versionada sota `/api/v1`. Llistats amb cerca, filtres, ordenacio i paginacio
server-side. Els errors exposen codis estables, no detalls SQL. Les mutacions rellevants
generen auditoria.
