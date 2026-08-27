# Govern de dades

**Estat:** primera versio, 7 d'agost de 2026. Escrit perque
`docs/specifications/attendance.md` hi remet per al termini de retencio del registre de jornada.

> **Aixo no es assessorament juridic.** Diu que fa el producte i quins parametres te. Quina norma
> obliga cada termini, i durant quant, ho ha de confirmar la gestoria o l'assessoria legal de cada
> instal·lacio.

## Que guarda el producte que sigui dada personal

| Dada | On viu | Qui hi te acces |
| --- | --- | --- |
| Nom i correu de cada membre | `user`, `memberships` | El propi, i qui te `members:manage` |
| Segon factor (secret TOTP) | Taules de Better Auth | Ningu: no es mostra despres d'enrolar-lo |
| Registre de jornada | `attendance_events` | El propi sempre; el de tothom, amb `attendance:manage` |
| Hores imputades a projectes | `time_entries` | Qui te `projects:read`; el cost, nomes amb `financials:read` |
| Auditoria d'accessos i canvis | `audit_log` | Qui te `audit:read` |
| Metadata del cataleg de credencials | `credential_catalog_entries` | Segons `credentials:read`; tecnics nomes assignades |

La referencia externa de Bitwarden es metadata sensible xifrada i no forma part de llistats,
exports, logs ni auditoria. Els valors del vault i la master password no entren a Control Hub.

**El registre de jornada es el mes sensible dels cinc**, i no perque contingui res espectacular:
un any de fitxatges diu a quina hora arriba i marxa una persona cada dia, i aixo es un patro de
presencia. Per aixo el modul no recull ni ubicacio ni biometria, i per aixo llegir el registre
d'una altra persona deixa rastre a `audit_log` (`attendance.read_other`) encara que qui ho fa hi
tingui dret.

## Terminis de retencio

| Dada | Termini | On es configura |
| --- | --- | --- |
| Registre de jornada | **4 anys** a la primera instal·lacio | `tenant_settings.attendance_retention_years` |
| Auditoria | Mentre visqui el tenant | Sense parametre, encara |
| Hores imputades | Mentre visqui el projecte | Sense parametre, encara |

El `4` surt de l'article 34.9 de l'Estatut dels Treballadors i **es un valor d'aquesta
instal·lacio, no del producte**: una instal·lacio a un altre pais el canvia sense tocar codi.

## Que passa avui amb una peticio d'esborrat

Cal saber-ho abans que arribi la peticio, no despres.

**El registre de jornada no es pot esborrar.** Ni passat el termini de retencio. El rol de
l'aplicacio te `select` i `insert` sobre `attendance_events` i res mes, i un trigger rebutja
`update` i `delete` encara que algu ho intenti amb SQL directe.

Es deliberat, i te un cost conegut: quan el termini de retencio venci, aquestes files continuaran
existint fins que s'escrigui una purga. **La purga encara no existeix.** Es va decidir aixi perque
els dos riscos no son simetrics: no poder esborrar a temps es una conversa que es pot tenir, i
esborrar de mes es irreversible.

Quan es faci, la purga ha de:

1. Ser una tasca explicita, no un efecte secundari de res.
2. Correr amb un rol propi, no amb el de l'aplicacio.
3. Deixar constancia a `audit_log` de quantes files ha esborrat i de quin periode.
4. Refusar qualsevol fila dins del termini configurat del seu tenant.

**Davant d'una peticio d'esborrat d'una persona, la retencio legal preval durant el periode.**
La resposta correcta no es "no podem", sino: aquest registre es conserva N anys per obligacio
legal, aquest es el termini configurat, i s'esborrara quan venci. Per aixo el termini ha de ser
consultable per qui respon, i no un numero escrit al codi.

## Aillament entre tenants

Totes les taules amb dades de client porten `tenant_id`, `enable row level security` i
**`force row level security`**, i una politica que compara amb `app.tenant_id`. El `force` es el
que fa que la politica valgui tambe per al propietari de la taula. Les proves d'integracio de cada
modul ho comproven escrivint amb un tenant i llegint amb un altre.

## Que falta

- La purga del registre de jornada quan venci la retencio, amb tot el d'aqui dalt.
- Un termini configurable per a l'auditoria.
- Un proces escrit per respondre una peticio d'acces d'una persona al seu propi registre, encara
  que el producte ja li permeti consultar-lo i exportar-lo ell mateix.
