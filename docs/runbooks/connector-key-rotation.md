# Runbook - Rotar l'anell de claus dels connectors

Rotar la clau mestra que segella les credencials de connector. **No es un desplegament**: es una
operacio d'operacio, i el codi no canvia.

La decisio que l'ordena es `docs/adr/0008-connector-credential-vault.md`. La regla que no es
negocia: **la clau no pot ser llegible des de la mateixa capa d'automatitzacio que protegeix.**
Si un workflow d'n8n pot arribar a la copia de la clau, un workflow compromes obre totes les
credencials de tots els connectors i el xifrat no ha servit de res.

## Que es una rotacio i que no

Cada sobre xifrat porta escrit a sobre **amb quina clau es va segellar** (`key_id`). Rotar es
publicar una clau nova com a **activa** i deixar l'antiga a l'anell com a **retirada**:

- la clau activa segella tot el que s'escrigui a partir d'ara;
- les retirades no segellen res, pero segueixen obrint el que ja van segellar.

Per tant **una rotacio no reescriu cap fila**. No hi ha passada de re-xifrat, no hi ha finestra
de manteniment i no hi ha risc de deixar credencials il·legibles a mitja feina.

El que **no** aconsegueix una rotacio ordinaria: si la clau antiga s'ha filtrat, qui la tingui
segueix podent obrir tot el que es va segellar amb ella, perque aquells sobres no han canviat.
Aixo es una **fuga**, no una rotacio, i te el seu propi procediment mes avall.

## Custodia

| On | Que hi ha | Qui hi arriba |
|---|---|---|
| VPS | Docker secret amb l'anell sencer, injectat al proces | nomes els contenidors de l'API i del worker |
| Gestor de contrasenyes | copia de recuperacio, xifrada al client i amb registre d'acces | les persones amb acces a la caixa forta |
| Sobre `age` de break-glass | copia segellada, fora del gestor | qui tingui la clau privada `age`, guardada a part |

El Drive nomes pot contenir **el sobre `age`**, mai el text pla: l'historial de revisions i la
paperera conserven copies que no s'esborren quan s'esborra el fitxer.

## Abans de comencar

1. Comprova que ningu esta desant credencials en aquest moment (una escriptura a mig fer amb dos
   processos amb anells diferents no es corrupcio, pero et deixara buscant per que un sobre porta
   un `key_id` que no esperaves).
2. Tingues a ma l'anell actual **sencer**. Una rotacio que perd una clau retirada converteix en
   il·legibles les credencials segellades amb ella, i l'unica sortida es tornar-les a donar d'alta
   una per una al proveidor.
3. Anota quines claus estan realment en us:

   ```sql
   select key_id, count(*) from connector_credentials where revoked_at is null group by key_id;
   ```

## Procediment

**1. Genera la clau nova.** 32 bytes, base64:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

**2. Composa l'anell nou.** L'identificador de la clau ha de dir quan es va crear, perque es el
que apareixera als sobres durant anys. JSON en una linia:

```json
{"activeKeyId":"2026-08-clau","keys":{"2025-11-clau":"<clau antiga>","2026-08-clau":"<clau nova>"}}
```

L'anell es valida en arrencar i refusa el que es dubtos: una clau que no son 32 bytes en base64,
dues claus amb el mateix material (una retirada que no ha retirat res), o un `activeKeyId` que no
es a l'anell. Un anell mal format **atura l'arrencada**, tant si el flag `connectors` esta obert
com si no — un secret amb una errata ha de fallar el dia que es desplega, no el dia que algu desa
una credencial.

**3. Publica el secret.** A la VPS, com a Docker secret. Mai a un `.env` versionat, mai al repositori.

**4. Reinicia l'API i el worker.** Tots dos llegeixen l'anell a l'arrencada. Reinicia'ls a la
vegada o l'un darrere l'altre; no importa l'ordre, perque tots dos anells contenen les dues claus.

**5. Comprova l'arrencada.** Cap dels dos processos ha d'escriure:

```
connectors are enabled but CONNECTOR_KEY_RING is unset: credentials cannot be stored or read
```

Si hi surt, el secret no ha arribat al proces: les rutes de credencials i d'adreces d'entrada no
s'han declarat, i a la pantalla d'integracions aquelles seccions no surten.

**6. Comprova que segella i que obre.** Les dues comprovacions son diferents i totes dues calen:

- **Obre**: llenca una comprovacio de salut d'una integracio que ja tingui credencial (boto
  "Comprovar salut"). El worker obre el sobre antic amb la clau retirada; si l'execucio surt
  correcta, la clau retirada segueix servint.
- **Segella**: desa una credencial qualsevol (pot ser la mateixa, tornada a escriure). El sobre
  nou ha de portar el `key_id` nou:

  ```sql
  select key_id, rotated_at from connector_credentials order by rotated_at desc limit 5;
  ```

**7. Actualitza les copies.** Gestor de contrasenyes i sobre `age`, tots dos amb l'anell **sencer**,
no nomes amb la clau nova.

## Quan es pot treure una clau retirada

Nomes quan cap fila la nomena:

```sql
select count(*) from connector_credentials where key_id = '<clau retirada>';
```

Si el compte es zero, la clau pot sortir de l'anell. Compta tambe les revocades: una credencial
revocada conserva el sobre, i el dia que algu la vulgui auditar voldra poder obrir-la. Treure una
clau que encara nomena alguna fila no dona cap error a l'arrencada — dona un error el dia que el
worker intenti obrir aquell sobre, que es el pitjor moment per descobrir-ho.

## Si la clau s'ha filtrat

Una rotacio ordinaria **no arregla una fuga**: els sobres antics segueixen oberts per a qui tingui
la clau antiga. Cal, per aquest ordre:

1. Rotar l'anell (el procediment de dalt), perque tot el que s'escrigui a partir d'ara quedi fora
   de l'abast de la clau filtrada.
2. **Tornar a escriure totes les credencials**, una per una, perque es re-segellin amb la clau
   nova. No hi ha cap ordre que ho faci sola i es a proposit: el text pla no viu enlloc del
   sistema, aixi que la unica manera de re-segellar una credencial es tornar-la a introduir. Fes
   servir la rotacio en dos slots (escriure la nova, promoure-la) per no deixar cap integracio
   sense credencial mentre dura.
3. **Rotar tambe les credencials al proveidor**, no nomes aqui. El que s'ha filtrat es el que
   obria els sobres; qui hagi obert un sobre ja te la credencial del proveidor, i canviar-la de
   lloc no la caduca.
4. Treure la clau filtrada de l'anell quan la consulta de mes amunt doni zero.
5. Deixar constancia: la superficie de connectors escriu auditoria de cada escriptura i de cada
   revocacio de credencial, i aquesta es la traça que dira quan es va tancar la finestra.

## Que no ha de passar mai

- L'anell no ha d'anar mai a un fitxer del repositori, ni a un `.env` versionat, ni a un log.
  L'objecte `KeyRing` es nega a imprimir-se — `toJSON` i el hook d'inspeccio nomes donen els
  identificadors — precisament perque un objecte d'entorn acaba en un log tard o d'hora.
- Cap workflow d'automatitzacio ha de poder llegir la copia de recuperacio. Es la regla de l'ADR.
- Perdre l'anell **no perd dades empresarials**: nomes obliga a tornar a donar d'alta les
  credencials dels connectors. Val la pena saber-ho el dia que sembli una catastrofe.
