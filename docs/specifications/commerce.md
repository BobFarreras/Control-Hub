# Especificacio de productes i subscripcions

**Estat:** aprovada per a la Fase 4.

## Decisions economiques

- Els imports es desen com enters en unitats menors i amb moneda ISO 4217 explicita.
- El preu es net. L'impost es desa separat en basis points (`10000` = 100%).
- Els totals nets, impostos i bruts es calculen per separat; no s'utilitza `floating point`.
- Les periodicitats inicials son `free`, `monthly`, `quarterly`, `semiannual` i `annual`.
- Control Hub calcula metriques operatives, pero no emet factures ni aplica prorrateig.
- Un canvi de pla es efectiu en una data concreta i crea historial immutable.
- Les metriques mai agreguen monedes diferents en una sola quantitat.

## Cataleg versionat

Un producte conte versions i cada versio conte plans. Els preus son snapshots immutables:
publicar un preu nou crea una fila nova i les subscripcions existents conserven el preu
contractat fins a un canvi explicit. Codis de producte i pla son estables dins del tenant.

## Subscripcions

Una subscripcio pertany a un client i referencia un pla i un preu concrets. Els estats son
`active`, `paused` i `canceled`. Pausar, reprendre, cancel·lar o canviar de pla genera un
event append-only amb els snapshots necessaris per justificar l'estat i les metriques.

## Metriques

- ARR net: mensual x12, trimestral x4, semestral x2, anual x1 i gratuït x0.
- MRR net: ARR dividit entre 12 amb arrodoniment half-up a unitats menors.
- Cost i marge utilitzen la mateixa normalitzacio temporal.
- L'impost no forma part de MRR, ARR ni marge net.
- Les subscripcions pausades o cancel·lades no contribueixen a metriques recurrents.

## Renovacions

Cada subscripcio activa conserva `renewal_at` i `renewal_alert_days`. Una alerta queda
activa quan la renovacio cau dins la finestra configurada. Totes les dates es desen en UTC
i la UI les presenta amb el locale de l'usuari.

## Autoritzacio

- `Owner` i `Administrator`: gestionen cataleg i subscripcions.
- `Owner` i `Administrator`: poden consultar metriques financeres.
- `Technical`: sense acces financer per defecte.
- Totes les mutacions exigeixen MFA, tenant scope i auditoria backend.
