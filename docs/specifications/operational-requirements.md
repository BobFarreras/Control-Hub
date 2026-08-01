# Requisits operatius

## Objectius inicials

- Disponibilitat mensual del core: 99.5% per perfil single-VPS, excloent manteniment anunciat.
- RPO: maxim 1 hora.
- RTO: maxim 4 hores.
- Restauracio completa provada mensualment.
- P95 API interactiva: menys de 400 ms sense comptar dependencies externes.
- P95 navegacio web: resposta visual inicial menys de 2.5 s a la xarxa objectiu.

## Capacitat de referencia

La primera prova de capacitat certificara com a minim:

- 25 usuaris concurrents.
- 100.000 clients/contactes combinats per tenant.
- 1.000.000 events d'auditoria.
- 100 connectors configurats.
- 100 jobs/minut sostinguts amb burst documentat.

Aquests son criteris de prova, no limits comercials. Qualsevol afirmacio superior necessita benchmark.

## Suport

- Produccio de referencia: Ubuntu LTS x86_64, Docker Engine i Compose v2.
- Navegadors: dues versions estables mes recents de Chrome, Edge, Firefox i Safari.
- Timezone configurable; persistencia UTC.
- SMTP obligatori per fluxos d'identitat; proveidor substituible.

## SLO i alertes

Cada servei defineix SLI de disponibilitat, latencia i errors. Alertes han de tenir propietari, severitat, runbook i politica d'agrupacio. No s'alerta per metriques sense accio possible.
