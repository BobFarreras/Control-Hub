# Contribuir a Control Hub

## Abans de treballar

1. Llegir `AGENTS.md`, `ARCHITECTURE.md` i les especificacions relacionades.
2. Confirmar criteris d'acceptacio i riscos.
3. Crear una branca segons `BRANCHING.md`.
4. No incloure secrets, dades personals ni exports reals.

## Desenvolupament

- Seguir els limits modulars i el tenant scope.
- Afegir `ca`, `es` i `en` per qualsevol text visible.
- Validar light, dark, teclat i reduced motion per qualsevol UI.
- Actualitzar contractes, OpenAPI, migracions i documentacio quan correspongui.
- Afegir proves de comportament i casos negatius.

## Commits

Utilitzar Conventional Commits:

```text
feat(connectors): add n8n health synchronization
fix(auth): reject revoked sessions
docs(architecture): define connector lifecycle
test(tenancy): cover cross-tenant access denial
chore(ci): add pull request validation
```

## Pull request

- Omplir tota la plantilla.
- Mantenir un sol objectiu per PR.
- Adjuntar captures light/dark i tres idiomes quan canviï UI.
- Indicar migracions, variables, riscos i rollback.
- No marcar una comprovacio com a feta si no s'ha executat.

## Definition of Done

La Definition of Done de `AGENTS.md` es obligatoria. Una aprovacio visual no substitueix proves, seguretat, permisos, migracions o observabilitat.
