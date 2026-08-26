# Integracio de la bustia de suport

**Estat:** aprovada per implementar (M4, 25 d'agost de 2026)

## Objectiu i frontera de domini

La bustia importa correu reduit i segur perque una persona el classifiqui. El ticket continua
sent l'unic propietari de la conversa, l'SLA i l'estat; el correu es nomes un adaptador d'entrada
i sortida. No es crea un segon sistema de tickets ni es classifica automaticament per una
coincidencia d'adreca.

No es desa MIME cru, HTML remot ni adjunts. El cos disponible a M4 es la previsualitzacio
normalitzada de fins a 4.000 caracters que projecten M1/M2.

## Flux

1. El connector desa el missatge com `pending`, idempotent per canal i identificador extern.
2. La UI suggereix un client si el remitent coincideix amb el correu de facturacio o un contacte.
3. Un membre amb `tickets:manage` pot vincular-lo a un ticket obert del mateix client, crear-ne
   un de nou amb els objectius SLA vigents, o descartar-lo.
4. Classificar bloqueja la fila, valida tenant, client i ticket, importa el contingut i canvia
   l'estat dins una sola transaccio. Dos operadors no poden classificar el mateix correu.
5. Descartar no elimina dades: conserva qui i quan ho ha decidit.
6. Les respostes surten pel flux confirmat de M3. El ticket mostra l'estat persistent de
   l'enviament (`queued`, `running`, `succeeded`, `failed` o `unknown`). `succeeded` confirma
   acceptacio del proveidor, no lectura ni lliurament final al destinatari.

## API

- `GET /api/v1/support/mailbox?status=&search=&page=&pageSize=` — `tickets:read`.
- `GET /api/v1/support/mailbox/tickets?customerId=` — tickets no tancats, `tickets:read`.
- `POST /api/v1/support/mailbox/:messageId/classify` — `tickets:manage`; `ticketId` vincula i,
  sense `ticketId`, `priority` crea el ticket.
- `POST /api/v1/support/mailbox/:messageId/discard` — `tickets:manage`.

El `tenant_id` i el membre classificador provenen exclusivament de la sessio. L'auditoria no
inclou cos, assumpte ni adreca del remitent.

## Criteris d'acceptacio

- Llistat paginat i filtrable dels tres estats, amb suggeriment de client no vinculant.
- Classificacio atomica a ticket existent i a ticket nou; reclassificacio refusada.
- Refus de ticket tancat, client d'un altre tenant o ticket d'un altre client.
- Descart reversible nomes mitjancant un futur cas d'us explicit, mai per edicio directa.
- UI `ca`, `es` i `en`, responsive, accessible per teclat i darrere la flag `mail`.
- Safata de dues columnes amb llista, lector i seleccio multiple; el descart massiu accepta fins
  a 100 pendents en una sola transaccio i no elimina evidencia.
- Estat de lliurament visible al ticket i E2E autenticats del flux critic.
