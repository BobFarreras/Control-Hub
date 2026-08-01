# Convencions d'enginyeria

## TypeScript

- `strict` i opcions addicionals de seguretat aprovades al tsconfig base.
- ESM i APIs web estandard quan siguin portables.
- Sense `any` injustificat, non-null assertions disperses o errors ignorats.
- Tipus de domini independents de Fastify, React, Drizzle i proveidors.

## Moduls

```text
domain -> application -> ports
adapters -> ports
api/web/worker -> application
```

Imports inversos o entre internals de moduls queden bloquejats per lint.

## Naming

- Codi, APIs i schemas en angles.
- UI en catala, castella i angles mitjancant claus.
- Fitxers kebab-case; components i tipus PascalCase; valors camelCase.
- Events en passat: `customer.created.v1`.
- Permisos: `domain:action`.

## Git i releases

- `BRANCHING.md` i Conventional Commits.
- Una feature, un objectiu revisable.
- SemVer i changelog.
- No editar migracions publicades.
- Feature flags tipades, amb propietari i data de retirada; no substitueixen permisos.

## Dependencies

- Justificacio, llicencia, manteniment, mida i risc abans d'afegir.
- Una llibreria per responsabilitat tret de necessitat demostrada.
- Lockfile obligatori i upgrades automatitzats revisats.
