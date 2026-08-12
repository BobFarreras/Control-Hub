# Escriure un connector

Aquest document tanca l'entregable de la Fase 6 que diu **"SDK intern o plantilla per crear
connectors"** i el criteri de sortida que diu **"es pot afegir un nou proveidor implementant el
contracte sense modificar el domini"**. Si en algun moment cal tocar `packages/domain`,
`packages/application` o `apps/api` per afegir un proveidor, el que falla es la plataforma i
s'ha d'arreglar alli, no al connector.

El contracte es `packages/connectors/src/contract.ts` i l'exemple viu es
`packages/connectors/src/built-in/generic-webhook.ts`. Llegeix-los tots dos: aquest text explica
**per que** son com son, no els substitueix.

## Que rep un connector, i que no

Un connector **no rep mai una connexio a la base de dades**. Rep ports, retorna dades
normalitzades, i qui decideix que es persisteix es la capa d'aplicacio, que ja es dins d'un
tenant. Per aixo "un connector defectuos no pot creuar la frontera entre tenants" no es una norma
que algu ha de recordar: es una cosa que no es pot ni escriure.

El context que rep (`ConnectorContext`) porta:

| Que | Per a que |
|---|---|
| `instanceId` | Opac. Serveix per construir una clau d'idempotencia que el proveidor accepti |
| `config` | La configuracio **ja validada** pel teu propi esquema |
| `http` | L'unica sortida de xarxa que hi ha. No hi ha `fetch` global ni `process.env` |
| `secrets.open(kind)` | Obre una credencial segellada, just quan la necessites |
| `logger`, `clock` | El rellotge s'injecta perque una prova pugui fixar-lo |

`http` es el `guarded-fetch` del worker: resol el nom, refusa qualsevol adreca que no sigui
publica, **connecta a l'adreca que ha validat** i revalida cada redireccio. No l'has de tornar a
protegir tu, i no el pots evitar.

## Els cinc passos

### 1. L'esquema de configuracio

Zod, i **`z.strictObject`**. Una clau desconeguda s'ha de refusar, no ignorar silenciosament:
qui ha escrit `base_url` en comptes de `baseUrl` ha de veure un error, no una integracio que
sembla configurada i no fa res.

```ts
const configSchema = z.strictObject({
  baseUrl: z.url().startsWith("https://").max(2048),
  pageSize: z.number().int().min(1).max(200).default(50)
});
```

Les incidencies que en surten viatgen a una pantalla i a un log, aixi que la plataforma nomes en
treu **el cami i el codi**, mai el valor rebut — el camp d'un formulari es exactament on algu
enganxa un token per error.

### 2. El manifest de capacitats

No es documentacio: **una operacio que no surt al manifest no es pot despatxar encara que el codi
hi sigui**, i `defineConnector` peta en carregar el modul si el manifest i les operacions no
diuen el mateix.

```ts
capabilities: {
  egress: { schemes: ["https"], destination: "configured_base_url" },
  operations: ["pull_invoices"],
  ingress: false
}
```

`destination` te dos valors i la tria importa: `configured_base_url` limita les crides a la
configuracio de la propia instancia, i `operator_allowlist` a les adreces que l'operador ha
declarat a `CONNECTOR_INTERNAL_ALLOWLIST` — es l'unica manera d'arribar a un servei intern, i cap
tenant no la pot tocar. Si el connector no truca enlloc, `egress: null`.

### 3. Les credencials

Declara nomes els `credentialKinds` que facis servir. El valor l'obres amb `context.secrets.open`
**dins de la crida que el necessita**: guardar-lo en una variable de modul, retornar-lo dins d'un
registre o passar-lo a un logger son tres maneres de convertir un secret just-in-time en un secret
persistent.

Si el connector rep webhooks, el `kind` es `ingress_signing` i **el secret el generem nosaltres**
quan s'encunya l'adreca; el proveidor no ens en dona cap.

### 4. Salut, operacions i entrada

- **`health`** ha de retornar `unverifiable` quan el connector no te res a qui preguntar. Dir
  `ok` sense evidencia es fabricar-la, i el domini es nega a comptar-la.
- **Les operacions** retornen `records` amb un `externalId` per registre i un `cursor` opac. El
  `externalId` es el que fa que un reintent no dupliqui res, i el `cursor` el guarda el runtime
  sense llegir-lo.
- **L'ingress** declara com signa el proveidor, pero **no verifica res**: la comprovacio la fa
  l'API, que es qui te els bytes crus i el secret. Una implementacio per revisar, no una per
  proveidor. El teu `handle` nomes llegeix l'event ja verificat i diu quin identificador te i si
  l'acceptes.

Classifica els errors HTTP amb `failureForStatus(status)`. Que un `429` es pugui reintentar es
una propietat d'HTTP i de la nostra politica de reintents, no del proveidor; si cada connector ho
decideix pel seu compte, la mateixa caiguda es comporta diferent segons qui la topi.

### 5. Registrar-lo

A `packages/connectors/src/index.ts`, dins de `createConnectorRegistry([...])`. Es resol en
**build time**: un connector arriba amb una release revisada, no com a codi carregat en calent
(ADR-0004). No hi ha cap porta per registrar-ne un en execucio, i no se n'hi ha d'afegir cap.

## Que no ha de fer mai un connector

- Tornar el text d'error del proveidor cap amunt. El que viatja es un **codi** nostre; la frase
  que llegeix una persona la posa `packages/i18n` i la tria la pantalla.
- Escriure una credencial, una configuracio sencera o un cos de resposta al log.
- Dormir, reintentar pel seu compte o obrir el seu propi `setTimeout` de reintent. Els reintents
  els fa la cua; un worker adormit es una placa que un proveidor lent ha pres a tots els altres
  tenants.
- Guardar estat entre crides en una variable de modul. Hi ha mes d'una replica.

## Que ha de portar abans de considerar-se fet

1. **Contract tests** com els de `packages/connectors/src/contract.test.ts`: configuracio valida,
   configuracio amb una clau desconeguda, i que les incidencies no portin el valor.
2. Una prova per operacio, amb un `HttpPort` fals — mai xarxa de veritat en un unitari.
3. Si te ingress: una prova que un event repetit dona el mateix `eventId`, i una que un event
   filtrat surt com a **descartat**, no com a inexistent.
4. `pnpm check` verd, i la spec del modul actualitzada **al mateix commit**.

Un connector nou no toca `packages/ui` ni afegeix cap pantalla: la d'integracions ja el mostra,
perque llegeix el cataleg (`GET /api/v1/connectors`) i la configuracio es un camp JSON.
