# Connectar OpenCode des d'un ordinador

El plugin rep els events del mateix OpenCode i envia el consum per HTTPS a la VPS. **No envia
converses, codi, paths, diffs ni ordres.** No cal servidor local, port, cron ni Task Scheduler.

Especificacio: `docs/specifications/connector-opencode.md`. Rotacio del secret:
`docs/runbooks/connector-key-rotation.md`.

## 1. Crear la integracio

Amb `connectors` i `usage_costs` activats, obre **Integracions**, tria **OpenCode local** i crea una
instancia per dispositiu. Activa-la i crea l'endpoint d'ingress.

Control Hub mostra una sola vegada:

- l'adreca completa que acaba en `/api/v1/webhooks/<publicId>`;
- el secret de firma.

La mateixa pantalla construeix l'ordre amb l'adreca i mostra el secret per enganxar-lo al prompt
ocult. Si es perden, revoca l'endpoint i crea'n un altre.

## 2. Instal·lar i vincular el plugin

Executa una sola vegada l'ordre que mostra Control Hub a l'ordinador on utilitzes OpenCode:

```powershell
npx @control-hub/opencode@0.2.0 configure --url "<adreca>"
```

Quan ho demani, enganxa el secret. L'entrada es oculta i el secret no queda a l'historial de la
shell ni a la llista de processos.

La CLI:

- afegeix `@control-hub/opencode@0.2.0` al `plugin` global d'OpenCode;
- desa la vinculacio a `~/.config/opencode/control-hub.json` amb permisos restrictius;
- crea l'ID del dispositiu i el salt local de pseudonimitzacio.

No llegeix ni modifica `auth.json` ni cap clau de proveidor. Si `opencode.json` porta comentaris i
no es JSON estricte, la CLI retorna `OPENCODE_CONFIG_NOT_JSON` sense sobreescriure'l: afegeix el
paquet manualment al seu array `plugin` i torna a executar l'ordre.

```json
{
  "plugin": ["@control-hub/opencode@0.2.0"]
}
```

Reinicia OpenCode despres de la primera instal·lacio. Els paquets npm configurats s'instal·len
automaticament amb Bun quan OpenCode arrenca.

## 3. Comprovar-ho

1. Executa una sessio curta a OpenCode.
2. Espera que la sessio quedi idle.
3. A Control Hub, obre **Consum i costos > Resum**: la font `ingress_usage` ha de tenir una passada
   completa i el volum ha d'incloure el nou event.
4. Torna a obrir i tancar la mateixa sessio sense consumir: el volum no ha de canviar.

Una fallada de xarxa no interromp OpenCode; el plugin registra nomes `DELIVERY_DEFERRED` i reintenta
al proxim idle. Comprova instancia activa, endpoint no revocat, rellotge, API, Valkey i worker.

## 4. Collector fallback

Per entorns on no es poden carregar plugins, continua disponible el collector Node documentat a
l'especificacio. Requereix `opencode serve` a loopback i una execucio periodica; no es el cami
recomanat per a usuaris finals.
