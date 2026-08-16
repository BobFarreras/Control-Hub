# Historic del projecte

Aqui hi ha el relat de com hem arribat on som: fases i increments **ja tancats**, amb el detall
que tenien quan es van escriure. `docs/development/current-state.md` nomes diu on som i quin es
el seguent pas; tot el que hi deixa de ser actual acaba aqui.

Aquests fitxers **no es carreguen d'entrada**. Obre'n un quan necessitis saber per que una cosa
es com es, o quan hagis de reconstruir una decisio antiga.

| Fitxer | Que hi trobaras |
| --- | --- |
| [phase-5-support.md](phase-5-support.md) | Fase 5: suport, tickets i SLA. Domini del calendari laboral, pauses, safata, fitxa del ticket i les primeres proves E2E autenticades. |
| [phase-5b-projects-and-rates.md](phase-5b-projects-and-rates.md) | Fase 5B: projectes, imputacio de temps i barems versionats. Inclou la revisio del propietari sobre barems per tipus de servei i anul·lacio, l'estabilitzacio del suite E2E i les millores de la UI de barems. |
| [phase-5c-attendance.md](phase-5c-attendance.md) | Fase 5C: registre de jornada, i l'increment 10 del calendari laboral. |
| [pre-phase-6-increments.md](pre-phase-6-increments.md) | Increments 0-11 de consolidacio previs a la Fase 6: importacio de leads, fitxa 360 del client, simplificacio del cataleg, serveis contractats, eines i despeses recurrents, safata de suport explicable i detall del ticket redissenyat. |

## Com afegir-hi coses

Quan un increment queda tancat, **mou** el seu text de `current-state.md` cap al fitxer que li
toca, en el mateix commit que el declara tancat. Mou-lo tal qual: si es resumeix pel cami, deixa
de ser auditable i ja no serveix per reconstruir res.
