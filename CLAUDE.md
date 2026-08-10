# Control Hub

Aquest fitxer es carrega automaticament en obrir una sessio. Es deliberadament curt: **no
duplica cap norma**, perque dues copies d'una regla acaben divergint i llavors no se sap quina
mana. Nomes diu on son.

## Que llegir, per aquest ordre

1. `docs/development/current-state.md` — on es el projecte i quin es el seguent pas.
2. `AGENTS.md` — **les normes vinculants**: arquitectura, seguretat, dades, proves,
   empaquetat, documentacio i Definition of Done. Mana sobre qualsevol costum general.
3. `docs/development/troubleshooting.md` — fallades ja diagnosticades. Mira-hi abans de
   dedicar temps a un simptoma estrany.
4. L'especificacio del modul que toques, a `docs/specifications/`.

`README.md` es l'index de tota la documentacio i `docs/README.md` el dels documents interns.

## Recordatoris que costen cars si s'obliden

- **No es redueix cap control de seguretat per fer passar una prova.** L'MFA obligatoria, els
  permisos i l'aillament entre tenants no es negocien.
- **Cap secret al repositori**, ni a codi, fixtures, logs o documentacio.
- **La documentacio canvia en el mateix commit que el comportament.** Deixar
  `current-state.md` mentint es un defecte.
- **No fer commit, push ni desplegar** si no s'ha demanat explicitament.
- Documents de producte en catala; codi i comentaris en angles.
