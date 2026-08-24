# Especificacio del connector local d'OpenCode

**Estat:** aprovada pel propietari el 24 d'agost de 2026. Opcio A: collector local sanititzat.

## Objectiu

Importar a Consum i costos el volum generat per OpenCode als ordinadors de l'equip, encara que
Control Hub s'executi en contenidors a una VPS. La connexio sempre surt del dispositiu per HTTPS;
la VPS no obre connexions cap a ordinadors, xarxes domestiques ni serveis `localhost`.

## Topologia

```text
OpenCode local -> collector local -> HTTPS signat -> ingress Control Hub -> cua -> worker -> usage_events
```

Cada dispositiu es una instancia `opencode` independent. Control Hub genera una adreca d'ingress i
un secret per instancia amb el mecanisme existent de connectors. Revocar l'endpoint o desactivar la
instancia atura aquell dispositiu sense afectar els altres.

## Minimitzacio de dades

El collector consulta `GET /session` i `GET /session/:id/message` de l'API local d'OpenCode. No usa
l'export de sessio, perque inclou transcript, adjunts i diffs.

L'unic payload acceptat es un lot estricte amb:

- versio de schema, identificador estable del lot i identificador aleatori del dispositiu;
- per event: ID del missatge assistant, instant, proveidor, model i comptadors enters de tokens;
- referencia de projecte pseudonimitzada amb HMAC local.

Mai no surten del dispositiu prompts, respostes, reasoning, noms o paths de fitxer, diffs, ordres,
sortides de terminal, titols, errors del proveidor, variables d'entorn ni configuracio d'OpenCode.
Els camps desconeguts es rebutgen; no se silencien.

El cost calculat per OpenCode no s'importa com a cost reportat per event: el model financer actual
desa imports en unitats menors i arrodonir cada missatge inferior a un cent falsejaria el total.
Control Hub valora els tokens amb tarifes versionades. Una futura importacio de cost agregat haura
de conservar precisio suficient i evidencia reconciliable.

## Contracte d'ingress

- Connector build-time `opencode`, sense egress ni operacions programades.
- `POST /api/v1/webhooks/:publicId`, cos JSON maxim 1 MiB.
- HMAC-SHA256 sobre `<unix_seconds>.<raw_body>` amb els headers existents.
- Finestra anti-replay de cinc minuts i comparacio constant-time.
- Lot maxim de 500 events; strings i enters tenen limits explicits.
- Idempotencia del lot a `connector_inbox` i de cada event a `usage_events`.
- La resposta `202` significa desat i encuat, no processat.
- Si la cua no accepta el job, la ruta falla i el collector reintenta; la inbox deduplica el lot.

L'API nomes autentica, valida el contracte i desa. El worker torna a validar el payload, projecta
registres `data.usage`, els persisteix i nomes llavors marca la inbox com `processed`.

## Collector

El collector es un executable Node sense dependencies de runtime alienes al repositori. Rep la
configuracio per variables d'entorn o flags, valida que OpenCode sigui loopback, pagina sessions,
construeix lots deterministes, els firma i els envia amb timeout. El cursor i els IDs ja entregats
viuen en un fitxer local escrit atomicament; una fallada no avanca l'estat.

El collector no registra secrets ni payloads. Els logs contenen recompte, durada i codi estable.
Admet una execucio unica per cron/Task Scheduler; la concurrencia sobre un mateix estat es rebutja
amb lock local.

## Criteris d'acceptacio

1. Un lot valid crea quantitats diferenciades per input, output, reasoning, cache read i cache
   write sense cap contingut de la sessio.
2. Reenviar el mateix lot o missatge no duplica volum ni cost.
3. Firma invalida, timestamp caducat, instancia desactivada i payload amb camps extra no arriben al
   worker.
4. Una fallada de cua provoca reintent segur i una fallada de worker no marca la inbox processada.
5. Un tenant no pot veure ni processar inbox, font o events d'un altre.
6. El collector no envia cap dels camps prohibits, inclosos en fixtures negatives.
7. La integracio es configurable des de la UI en `ca`, `es` i `en`, amb endpoint i secret mostrats
   una sola vegada.
8. Hi ha runbook per Linux, macOS i Windows i comprovacio de health local sense exposar OpenCode.

## Fonts oficials

- `https://opencode.ai/docs/server/`: servidor local, Basic Auth i endpoints de sessions/missatges.
- `https://opencode.ai/v2/docs/api/session/v2-session-export`: evidencia que l'export inclou
  transcript i fitxers i, per tant, queda fora del connector.
