# Connectar OpenCode des d'un ordinador

El collector llegeix el consum a `localhost` i l'envia per HTTPS a la VPS. **No envia converses,
codi, paths, diffs ni ordres.** La VPS no inicia cap connexio cap a l'ordinador.

Especificacio: `docs/specifications/connector-opencode.md`. Rotacio del secret:
`docs/runbooks/connector-key-rotation.md`.

## 1. Crear la integracio

Amb `connectors` i `usage_costs` activats, obre **Integracions**, tria **OpenCode local** i crea una
instancia per dispositiu. Activa-la i crea l'endpoint d'ingress.

Control Hub mostra una sola vegada:

- l'adreca completa que acaba en `/api/v1/webhooks/<publicId>`;
- el secret de firma.

Desa'ls al gestor de secrets del dispositiu. Si es perden, revoca l'endpoint i crea'n un altre.

## 2. Arrencar l'API local d'OpenCode

OpenCode ha de quedar nomes a loopback. No publiquis el port `4096` a la LAN ni a Internet.

```powershell
$env:OPENCODE_SERVER_PASSWORD = '<contrasenya-local-llarga>'
opencode serve --hostname 127.0.0.1 --port 4096
```

El collector accepta nomes `http://127.0.0.1`, `localhost` o `::1` com a origen OpenCode. La
contrasenya protegeix altres processos locals; mai no viatja al Control Hub.

## 3. Construir el collector

Des d'un checkout de la mateixa release de Control Hub:

```powershell
pnpm --filter @control-hub/connectors build
node packages/connectors/dist/opencode-collector/index.js
```

La segona ordre necessita abans les variables de la seccio seguent. El collector no te
dependencies de runtime fora de Node 22.

## 4. Configuracio

No posis aquests valors a `.env` del repositori. Utilitza el gestor de secrets o l'entorn del
servei local.

```text
OPENCODE_URL=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<contrasenya local d'OpenCode>
CONTROL_HUB_INGRESS_URL=https://controlhub.empresa.example/api/v1/webhooks/<publicId>
CONTROL_HUB_INGRESS_SECRET=<secret mostrat una vegada>
OPENCODE_COLLECTOR_STATE_PATH=<path absolut escrivible>/opencode-collector-state.json
```

El fitxer d'estat porta un ID aleatori, el salt de pseudonimitzacio i el cursor; no porta el secret
ni contingut. Es crea amb permisos restrictius i s'actualitza atomicament. No executis dues copies
amb el mateix fitxer: el lock ho rebutja amb `COLLECTOR_ALREADY_RUNNING`.

## 5. Programar-lo

Una execucio fa una passada i acaba. En Linux/macOS, executa-la cada cinc minuts amb el gestor de
serveis de la instal.lacio (`systemd timer` o `launchd`). En Windows, crea una tasca al Task
Scheduler amb **Run whether user is logged on or not**, interval de cinc minuts i **Do not start a
new instance**.

La comanda es sempre:

```text
node <checkout>/packages/connectors/dist/opencode-collector/index.js
```

Exit `0` indica que tots els lots han rebut `202`. Qualsevol altre exit deixa el cursor on era i
la proxima execucio reintenta el mateix lot. Els logs nomes diuen recompte o un codi estable.

## 6. Comprovar-ho

1. Executa una sessio curta a OpenCode.
2. Executa manualment el collector; ha de respondre `OpenCode usage delivered: <n>`.
3. A Control Hub, obre **Consum i costos > Resum**: la font `ingress_usage` ha de tenir una passada
   completa i el volum ha d'incloure el nou event.
4. Torna a executar-lo: ha de respondre `0` i el volum no ha de canviar.

Si respon `INGRESS_HTTP_404`, comprova instancia activa, endpoint no revocat, rellotge del dispositiu
i secret. `INGRESS_HTTP_500` o `503` no avanca el cursor: revisa API, Valkey i worker i reintenta.
