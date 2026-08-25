# ADR-0010 - Custodia hibrida de credencials i secrets

**Estat:** aprovada el 25 d'agost de 2026.

## Context

Control Hub necessita governar passwords compartits de l'empresa i clients, credencials
tenant-scoped de connectors i secrets bootstrap de la instal·lacio. Fer que la mateixa API
desxifri tots tres grups convertiria qualsevol compromis del producte en compromis total de les
identitats humanes, proveidors i infraestructura.

## Decisio

Control Hub es el **cataleg i control plane**, no el password manager:

- Bitwarden Password Manager custodia passwords humans, TOTP, recovery codes i notes protegides.
- Control Hub conserva metadata i una referencia opaca, aplica RBAC/MFA i audita l'obertura, pero
  no rep ni mostra el valor.
- El vault intern dels connectors continua custodiant tokens tenant-scoped sota els ADR 0005 i
  0008; nomes el worker els obre just-in-time.
- Els secrets bootstrap arriben per fitxers `*_FILE` read-only. Bitwarden Secrets Manager es un
  adaptador opcional del pipeline i no una dependencia del core.
- Cada persona usa compte, master password i MFA propis. No hi ha cap master password compartida
  o hardcoded a Control Hub.
- Una instal·lacio sense Bitwarden continua suportada mitjançant fitxers root-owned.

## Controls

- Col·leccions separades per empresa, equip i client; deny by default i offboarding immediat.
- Reautenticacio recent a Control Hub abans d'obrir metadata de credencials sensibles.
- Bitwarden aplica el seu bloqueig, MFA i timeout; Control Hub no intenta reproduir-los.
- Machine account de nomes lectura i projecte per instal·lacio; token fora dels contenidors.
- El pipeline falla tancat en un deploy nou si el gestor no respon i conserva la release viva.
- Logs d'auditoria sense valors ni IDs externs sensibles, amb retencio inicial de 90 dies.

## Alternatives descartades

- **Vault complet dins Control Hub.** Duplica criptografia, clients, autofill, sincronitzacio,
  recuperacio i una superficie d'atac que no forma part del domini del producte.
- **Mostrar valors de Bitwarden dins Control Hub.** Obliga l'API a poder desxifrar credencials
  humanes i trenca la frontera de compromis.
- **Bitwarden obligatori per arrencar.** Redueix portabilitat i disponibilitat d'una instal·lacio
  autohosted; `_FILE` es el contracte base.

## Consequencies

La futura UI pot centralitzar cerca, ownership, permisos, rotacio i auditoria, pero el botó final
obre Bitwarden. La recuperacio d'una master password es responsabilitat de la politica corporativa
de Bitwarden, no de Control Hub. Els dos productes s'han de desplegar, actualitzar i recuperar com
fronteres de seguretat independents.
