# Plantilla - Prompt d'inici de sessio

Com obrir una sessio de treball sobre Control Hub amb un agent.

**Ha de ser curt.** `CLAUDE.md` es carrega sol i ja envia a `docs/development/current-state.md`,
a `AGENTS.md` i a `docs/development/troubleshooting.md`. Repetir aqui la llista de documents
nomes gasta context i, pitjor, crea una segona copia de les normes que quedara desactualitzada.
El prompt ha de dir **que es vol**, no **com funciona el repositori**.

## Plantilla

```text
[Objectiu en una frase: que ha d'existir quan acabem.]

Situa't primer: llegeix docs/development/current-state.md i confirma que descriu la
realitat (branca, ultims commits, estat de CI). Si no quadra, corregeix-lo abans de res.

Abast d'aquesta sessio:
- [punt 1]
- [punt 2]

Restriccions que no es poden saltar:
- [seguretat, dades, compatibilitat, decisions ja preses...]

Branca: [nom], sortint de develop segons BRANCHING.md.
Especificacio: [ruta].

No facis commit ni push fins que t'ho demani. Quan acabis, digue'm que has verificat
executant i que no.
```

## Que no cal posar-hi

- La llista de documents canonics: ja hi es a `CLAUDE.md`.
- Recordatoris de no tocar l'MFA, no escriure secrets o no barrejar refactors: son normes
  d'`AGENTS.md` i s'apliquen sempre.
- L'stack ni l'arquitectura: son a `ARCHITECTURE.md`.

## Que si que val la pena posar-hi

- **Decisions ja preses** que l'agent no pot deduir dels documents, i qui les ha pres.
- **Restriccions amb motiu.** "No desactivis l'MFA" es una norma; "l'MFA obligatoria es una
  decisio del propietari d'aquesta setmana documentada a SECURITY_ARCHITECTURE.md" evita que
  l'agent la posi en questio a mitja feina.
- **Detalls d'entorn que costen temps de descobrir**: ports, bases de dades exclusives,
  variables que han de coincidir. Si es repeteixen, van a `DEVELOPMENT.md`, no al prompt.
- **Que consideres verificat.** Si vols evidencia d'execucio i no afirmacions, digue-ho.

## Al tancar la sessio

Demana explicitament que quedi actualitzat `docs/development/current-state.md` i, si hi ha
hagut cap diagnosi cara, `docs/development/troubleshooting.md`. Es norma a `AGENTS.md`, pero
dir-ho fa que no s'ajorni.
