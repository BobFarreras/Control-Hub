# Runbook - L'error workflow d'n8n

Muntar, a una instancia d'n8n, el workflow que ens empeny una execucio fallida en el moment que
falla. **No es codi nostre**: n8n no signa res sol, i el node que ho fa l'ha de posar qui
configura la instancia. Per aixo es un runbook i no una migracio.

La decisio que l'ordena es `docs/specifications/infrastructure.md`, connector `n8n`.

## Que compra i que no

Sense error workflow **Control Hub ja veu les execucions fallides**: el sondeig
`pull_executions` les llegeix cada 5 minuts. El que compra el webhook es **immediatesa**, no
cobertura. Si no el muntes, no perds cap fallada; les veus amb fins a cinc minuts de retard.

Per aixo aquest procediment mai es una urgencia, i per aixo tampoc no es opcional a una
instancia de la qual s'espera que ens avisi de seguida.

**El que arriba pel webhook es una projeccio, no el cos.** De tot el que l'error trigger d'n8n
posa a la ma del workflow, Control Hub en llegeix quatre camps —l'id de l'execucio, el seu mode,
l'ultim node executat i l'id i el nom del workflow— i deixa caure la resta abans de desar res.
El missatge d'error d'n8n cita habitualment la peticio que ha fallat, amb les seves capcaleres i
els seus tokens a dins: no ens el volem quedar.

## Abans de comencar

1. La integracio `n8n` ha d'existir a Control Hub, **activa**, amb la credencial `api_token`
   desada i amb `baseUrl` apuntant a la instancia.
2. Has de poder editar workflows a aquella instancia d'n8n.
3. Tingues obert el gestor de contrasenyes: el secret de firma es veu **un sol cop**.

## 1. Encunyar l'adreca i el secret

A Control Hub, **Integracions** → la integracio d'n8n → **Adreca d'entrada** →
**Generar adreca i secret**.

Copia les dues coses al gestor de contrasenyes **abans de tancar el dialeg**. No hi ha cap
manera de tornar a mostrar-les: si es perden, es revoca l'adreca i se'n genera una de nova.

- L'adreca te la forma `https://<el-teu-control-hub>/api/v1/webhooks/<identificador>`.
- El secret es una cadena aleatoria. **Mai al repositori, mai a una nota d'n8n, mai a un log.**

Si la instal·lacio no porta anell de claus (`CONNECTOR_KEY_RING`), aquesta seccio no hi es: aquell
desplegament no pot guardar secrets i, per tant, no pot rebre webhooks. El sondeig segueix
funcionant igual.

## 2. Muntar el workflow a n8n

Crea un workflow nou, anomena'l `<client> - Control Hub error workflow`, amb tres nodes.

**1. Error Trigger.** Sense configuracio. Es el node que n8n activa quan un altre workflow falla.

**2. Un node Code que construeix el cos, el signa i deixa les tres coses a punt.** Fer-ho tot en
un sol node no es estetica: **la firma es fa sobre els bytes que arribaran**, i qualsevol node
entremig que torni a serialitzar el JSON canvia aquests bytes i invalida la firma. El cos ha de
viatjar com la cadena que s'ha signat, ni re-serialitzada ni re-indentada.

```javascript
const crypto = require('crypto');

const error = $input.first().json;

// Nomes els camps que Control Hub llegeix. La resta no li interessa i no ens la volem quedar.
const body = JSON.stringify({
  execution: {
    id: String(error.execution.id),
    mode: error.execution.mode,
    lastNodeExecuted: error.execution.lastNodeExecuted,
    retryOf: error.execution.retryOf ?? null
  },
  workflow: { id: String(error.workflow.id), name: error.workflow.name }
});

const timestamp = String(Math.floor(Date.now() / 1000));
// El segell va dins dels bytes signats: una peticio capturada no es pot reenviar amb una hora nova.
const signature = crypto
  .createHmac('sha256', $env.CONTROL_HUB_SIGNING_SECRET)
  .update(`${timestamp}.${body}`, 'utf8')
  .digest('hex');

return [{ json: { body, timestamp, signature } }];
```

El secret arriba per variable d'entorn de la instancia d'n8n (`CONTROL_HUB_SIGNING_SECRET`), no
escrit dins del node: un workflow s'exporta, es comparteix i acaba a un JSON que algu envia per
correu.

**3. Un node HTTP Request.**

| Camp | Valor |
|---|---|
| Method | `POST` |
| URL | l'adreca encunyada al pas 1 |
| Body Content Type | `Raw` / `JSON`, enviant **`{{ $json.body }}` tal qual** |
| Header `content-type` | `application/json` |
| Header `x-control-hub-timestamp` | `{{ $json.timestamp }}` |
| Header `x-control-hub-signature` | `{{ $json.signature }}` |

**I res mes.** No afegeixis reintents amb cos regenerat: el segell caduca als 5 minuts i un
reintent que torni a construir el cos ha de tornar a signar-lo, cosa que el node Code ja fa si el
reintent comenca per ell.

## 3. Declarar-lo com a error workflow

A cada workflow que hagi d'avisar: **Settings** → **Error Workflow** → tria el que acabes de
crear. A les instancies on tots els workflows hagin d'avisar, posa'l com a error workflow per
defecte a la configuracio de la instancia.

Un error workflow que ningu ha declarat no s'executa mai, i no hi ha cap avis que ho digui: es
la manera mes habitual que aixo quedi mig fet.

## 4. Comprovar-ho

1. Fes fallar un workflow de proves a proposit (un node HTTP Request contra una adreca que no
   existeix ja ho fa).
2. A n8n, l'execucio de l'error workflow ha de respondre **202** amb el cos buit. 202 vol dir
   **desat**, no processat.
3. A Control Hub, **Infraestructura** → l'alerta corresponent apareix quan la regla que la vigila
   avalua. Si no n'hi ha cap, la fallada hi es igualment com a registre de la instancia.

Una segona entrega del mateix event no duplica res: l'identificador es el d'n8n
(`execution:<id>`), aixi que una reentrega es la mateixa cosa i no una de nova.

## Quan respon 404

**Totes les negatives responen `404` amb el mateix cos**: adreca desconeguda, firma que no
quadra i segell fora de finestra son indistingibles des de fora, i aixo es deliberat —qui provi
adreces a cegues no ha d'aprendre res de la resposta. Des de dins, mira-ho per aquest ordre:

| Causa | Com es reconeix | Que fer |
|---|---|---|
| Rellotge desviat | la instancia d'n8n no te NTP, o va amb hora local | la finestra es de **±5 minuts** en segons Unix; sincronitza el rellotge |
| Cos re-serialitzat | la firma es correcta al node i falla al servidor | envia `{{ $json.body }}` en cru, sense que cap node el torni a convertir |
| Secret equivocat | acabes de rotar, o el vas copiar a una altra instancia | comprova `CONTROL_HUB_SIGNING_SECRET` a n8n contra el gestor de contrasenyes |
| Adreca revocada | algu va generar-ne una de nova | encunya'n una i actualitza el node HTTP Request |
| Capcalera absent | falta `x-control-hub-signature` o `x-control-hub-timestamp` | totes dues son obligatories |

La peticio ha de ser `application/json` i com a molt **1 MiB**. Un cos mes gran es refusa.

## Rotar el secret

La credencial de firma te dues ranures, de manera que una rotacio no te finestra de tall. La
pantalla d'integracions **nomes ensenya metadades** —el valor no surt mai de la caixa forta i cap
ruta d'aquesta API el torna a llegir—, aixi que escriure el valor nou es una crida a l'API amb un
compte que tingui `credentials:rotate`, que es un rol que el segon factor guarda.

1. Genera el secret nou i guarda'l al gestor de contrasenyes abans de fer res mes:

   ```bash
   openssl rand -hex 32
   ```

2. Escriu-lo a la integracio. Com que la ranura primaria ja esta ocupada, el valor nou va a la
   secundaria i aixo **obre una rotacio**: durant la rotacio les dues ranures accepten firmes.

   ```bash
   curl -X PUT https://<el-teu-control-hub>/api/v1/integrations/<instanceId>/credentials/ingress_signing \
     -H 'content-type: application/json' -d '{"secret":"<el-secret-nou>"}'
   ```

3. Canvia `CONTROL_HUB_SIGNING_SECRET` a n8n i reinicia la instancia.
4. Comprova que arriba un event nou, signat ja amb el secret nou (pas 4 de mes amunt).
5. Tanca la rotacio: la secundaria passa a primaria i la vella es revoca, totes dues alhora.

   ```bash
   curl -X POST https://<el-teu-control-hub>/api/v1/integrations/<instanceId>/credentials/ingress_signing/promote
   ```

Una rotacio oberta i mai tancada es una ranura secundaria que no coincideix mai amb res: es
visible a la llista de credencials de la integracio, i s'ha de tancar.

**Canviar d'adreca no es una rotacio.** Una integracio te una sola adreca viva; substituir-la es
revocar-la i encunyar-ne una de nova, i revocar-la revoca tambe el secret que hi signava.

## Que no fa aquest workflow

- **No decideix res.** Que una fallada sigui una alerta ho decideixen les regles de la pantalla
  d'Infraestructura, no n8n.
- **No substitueix el sondeig.** Si la instancia queda incomunicada, el webhook no arriba i el
  sondeig tampoc: les regles queden **afamades** i no verdes, i aixo es el que s'ha de veure.
- **No porta dades del client.** Si algu amplia el cos amb els items de l'execucio, Control Hub
  els refusa: l'esquema nomena els camps que es queden i la resta cau abans de desar-se.
