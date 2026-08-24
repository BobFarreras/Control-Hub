# Connectar una VPS al Control Hub

> Aquest document esta escrit per ser **llegit sencer per qui administra la VPS**, sigui una
> persona o un agent. La darrera seccio es un prompt per enganxar tal qual. No inventa cap norma:
> les de seguretat son a `docs/specifications/connector-security.md` i el contracte del connector,
> a `docs/specifications/infrastructure.md`.

## 1. Que necessita el Control Hub, i que no ha de rebre mai

El Control Hub llegeix **una sola cosa** d'una VPS: l'API de consulta d'un Prometheus
(`GET /api/v1/query`). Res mes. En concret **no** necessita, i no se li ha de donar:

- acces SSH, ni un usuari, ni una clau;
- `root`, ni `sudo`, ni cap privilegi al sistema;
- cap credencial d'escriptura enlloc;
- acces al Docker socket, a la base de dades ni a cap fitxer.

Si algu proposa donar-li qualsevol d'aquestes coses per fer-lo funcionar, **la proposta es
incorrecta**: el connector no te cap manera de fer-les servir.

## 2. Com hi arriba, i les tres maneres per ordre de preferencia

Un Prometheus **sense autenticacio ha de quedar-se a `127.0.0.1`**. Obrir-lo a Traefik "perque el
Control Hub hi arribi" es publicar cada metrica de la maquina a qualsevol que endevini el nom, i
cap dels tres camins de sota ho necessita.

1. **El Control Hub corre a la mateixa maquina o a la mateixa xarxa privada.** L'adreca privada va
   a `CONNECTOR_INTERNAL_ALLOWLIST` del desplegament del Control Hub, i ja esta. Es el cas de
   produccio.
2. **Tunel SSH**, per a desenvolupament. Qui desenvolupa obre
   `ssh -N -L 9090:127.0.0.1:9090 <usuari>@<vps>` des de la seva maquina, i el Prometheus de la VPS
   apareix al seu `127.0.0.1:9090`. **A la VPS no s'hi toca res**: el tunel el fa el client.
3. **Proxy invers autenticat sobre TLS**, si de debo cal arribar-hi des de fora. Llavors el
   Prometheus segueix a loopback, el proxy demana credencial i el Control Hub la desa a la caixa
   forta com a `api_token`. Mai a la configuracio.

## 3. El que el connector llegeix

Tres operacions, totes de forma `state` — cada passada llegeix tot el que vigila, i el que deixa
d'anomenar caduca. Les expressions PromQL son **constants al codi**: cap valor de la configuracio
entra mai en una consulta.

| Operacio | Cada | D'on surt |
|---|---|---|
| `pull_host_metrics` | 2 min | `node_exporter`: CPU, memoria, sistema de fitxers, `node_load1`, `node_boot_time_seconds` |
| `pull_container_state` | 5 min | cAdvisor: `container_last_seen`, `container_start_time_seconds`, memoria i CPU |
| `pull_probe_state` | 2 min | `blackbox_exporter`: `probe_success`, `probe_duration_seconds`, `probe_ssl_earliest_cert_expiry`, i `up` |

De tot plegat se'n desa **una projeccio anomenada camp a camp**, mai el joc d'etiquetes sencer:
una etiqueta que algu afegeixi a un `scrape_config` no arriba a cap registre ni a cap pantalla.

## 4. Convencions que la VPS ha de respectar

**`control_hub_` es un espai de noms reservat.** Nomes hi escriuen les metriques que el Control Hub
llegeix. Res mes de la maquina hi ha de publicar.

**`backup_job` es `<maquina>-<que>`**, per exemple `hub-vps-daily`. Dues maquines amb el mateix
valor **fusionen series**, i llavors el `max` amaga la que esta morta. Corregir-ho abans de congelar
el nom es gratis; despres, no.

**El connector identifica una maquina per l'etiqueta `instance`**, filtrada contra la llista
`hostLabels` de la configuracio. **No llegeix cap etiqueta `host`.** Aixo importa perque els
`external_labels` d'un `prometheus.yml` **no apareixen a les consultes locals** — nomes s'apliquen a
federacio, `remote_write` i alertes. Declarar `external_labels: { host: ... }` i esperar-lo a la
lectura no falla: simplement no distingeix res, que es pitjor. Per a mes d'una maquina tampoc cal
cap `relabel_config`: dos `node_exporter` son dos targets i per tant dos `instance` diferents.

**El nom d'un job de raspat no s'ha de canviar sense avisar.** `containerJob` i `probeJob` de la
configuracio l'anomenen; canviar-lo a la VPS deixa el Control Hub llegint el buit, i el buit vol dir
"ha desaparegut".

**La metrica del backup** l'escriu l'escript al textfile collector del `node_exporter`, en aquesta
forma:

```
control_hub_backup_last_success_seconds{backup_job="<maquina>-<que>"} <unix seconds>
control_hub_backup_size_bytes{backup_job="<maquina>-<que>"} <bytes>
```

Un escript de backup que **no** l'emet deixa la regla `backup_stale` en `starved` — visible a la
pantalla, no silenciosa. Es el disseny, pero un backup que ningu vigila val menys.

## 5. Comprovacions, totes de lectura

A la VPS, contra el Prometheus local. Cap d'aquestes escriu res:

```bash
# Els jobs que hi ha i si responen. Els valors d'`instance` que surtin son els que
# el Control Hub necessita: son els candidats a `hostLabels`.
curl -s 'http://127.0.0.1:9090/api/v1/query?query=up' | jq '.data.result[].metric'

# El que el connector fa servir de salut: ha de tornar `success`.
curl -s 'http://127.0.0.1:9090/api/v1/query?query=vector(1)' | jq '.status'

# L'espai de noms reservat: nomes hi han de sortir les series del backup.
curl -s --data-urlencode 'query={__name__=~"control_hub_.*"}' \
  http://127.0.0.1:9090/api/v1/query | jq '.data.result[].metric'

# Els noms dels contenidors que cAdvisor publica: son els `container:<nom>` a declarar.
curl -s 'http://127.0.0.1:9090/api/v1/query?query=container_last_seen' \
  | jq -r '.data.result[].metric.name' | sort -u

# Els targets sondats: son els `probe:<target>` a declarar.
curl -s 'http://127.0.0.1:9090/api/v1/query?query=probe_success' \
  | jq -r '.data.result[].metric.instance' | sort -u
```

## 6. Que s'ha de reportar a qui configura el Control Hub

Aquests set valors, i prou. Cap d'ells es un secret:

| Que | Exemple | On va al Control Hub |
|---|---|---|
| Adreca del Prometheus | `http://127.0.0.1:9090` | `baseUrl` de la integracio, i `CONNECTOR_INTERNAL_ALLOWLIST` |
| Etiquetes `instance` de les maquines | `node-exporter:9100` | `hostLabels`, i el camp **Etiqueta** de cada maquina |
| Job del col·lector de contenidors | `cadvisor` | `containerJob` |
| Job del sondador | `blackbox` | `probeJob` |
| Noms dels contenidors a vigilar | `n8n`, `postgres` | serveis `container:<nom>` |
| Targets sondats | `https://exemple.tld/healthz` | serveis `probe:<target>` |
| Valors de `backup_job` | `hub-vps-daily` | serveis `backup:<valor>` |

## 7. Del costat del Control Hub

Quan la VPS ja reporta els valors de la seccio 6, queden tres passos a la installacio del Control
Hub. Cap d'ells es toca a la VPS.

**1. Afegir l'origen a `CONNECTOR_INTERNAL_ALLOWLIST`, dins la linia que ja hi ha.** La variable es
una llista separada per comes, i l'origen nou s'afegeix sense treure els que hi son:

```
CONNECTOR_INTERNAL_ALLOWLIST=https://n8n.exemple.tld,http://127.0.0.1:9090
```

**Escriure-la dues vegades no acumula: la segona linia guanya i la primera desapareix sense dir-ho.**
Es el comportament de `--env-file` de Node, i el simptoma es cruel — el connector nou funciona i
l'antic deixa de funcionar, o al reves, i cap missatge no parla mai de l'allowlist. Comprova sempre
quin valor queda de debo:

```bash
node --env-file=.env -e "console.log(process.env.CONNECTOR_INTERNAL_ALLOWLIST)"
```

La comparacio es exacta per esquema, nom i port: `http://127.0.0.1:9090` no admet el port 9091 ni
`https`. Un origen que hi consti queda **tambe** exempt de la regla que refusa adreces privades: es
l'unica manera que una adreca de loopback o de xarxa interna sigui abastable, i per aixo la llista
ha de dir origens concrets i mai res que s'hi assembli.

**2. Reiniciar el worker.** L'allowlist es llegeix **un sol cop, en arrencar**. Mentre el worker
visqui amb el valor vell seguira fallant amb `DESTINATION_NOT_ALLOWLISTED` encara que el `.env` ja
sigui correcte, i el fitxer semblara desmentir la pantalla.

**3. En desenvolupament, obrir el tunel.** El Prometheus de la VPS nomes escolta al `127.0.0.1`
**d'alla**, aixi que la maquina que corre el worker se l'ha de portar al seu propi loopback:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:9090:127.0.0.1:9090 <usuari>@<vps>
```

El tunel viu mentre visqui aquella ordre. `ExitOnForwardFailure` evita el cas pitjor, que es un
tunel que sembla obert pero no reenvia res perque el port local ja estava ocupat.

### Comprovar-ho sense obrir cap pantalla

```bash
# El tunel: ha de tornar les series `up` de la VPS.
curl -s "http://127.0.0.1:9090/api/v1/query?query=up" | jq -r ".data.result[].metric.instance"
```

I la passada seguent del connector ha de deixar de dir `DESTINATION_NOT_ALLOWLISTED`:

```sql
select operation, status, error_code, started_at
from connector_sync_runs
order by started_at desc
limit 5;
```

Si les passades passen a `succeeded` pero la maquina segueix sense lectures, llavors el que falla es
una altra cosa: `hostLabels` no conte l'etiqueta `instance` que la VPS publica. La comprovacio
guiada de la integracio ho diu amb aquestes mateixes paraules.

## 8. El que no s'ha de fer mai

- Publicar el Prometheus sense autenticacio, ni tan sols "temporalment".
- Donar al Control Hub cap acces al sistema, ni credencials d'escriptura.
- Escriure un token, una contrasenya o una URL amb credencials a la configuracio d'una integracio:
  els secrets van a la caixa forta, i una URL amb usuari i contrasenya es refusada.
- Afegir un `relabel_config` "perque el Control Hub distingeixi maquines": no fa falta i canvia el
  contracte de totes les series.
- Reutilitzar un `backup_job` entre maquines.
- Canviar el nom d'un job de raspat sense dir-ho.

## 9. Prompt per a l'agent que administra la VPS

> Has de preparar aquesta VPS perque el Control Hub en pugui llegir l'estat, i despres reportar els
> valors que necessita. El Control Hub **nomes** llegira l'API de consulta del Prometheus local; no
> li has de donar cap acces al sistema, ni cap credencial d'escriptura, ni obrir cap port a fora.
>
> Fes, per aquest ordre:
>
> 1. **Comprova** amb les consultes de lectura de la seccio 5 quins jobs hi ha, quins valors
>    d'`instance` publiquen, quins contenidors veu el col·lector i quins targets se sonden. No
>    modifiquis res mentre comproves.
> 2. **Verifica que el Prometheus escolta nomes a loopback.** Si esta publicat sense autenticacio,
>    atura't i digues-ho: es una troballa, no una cosa a arreglar pel teu compte.
> 3. **Comprova la metrica de backup.** Ha d'existir
>    `control_hub_backup_last_success_seconds{backup_job="<maquina>-<que>"}` per a cada feina de
>    copia. Si un escript de backup no l'emet, proposa el canvi amb el diff i **espera aprovacio**
>    abans d'aplicar-lo. Respecta la convencio `<maquina>-<que>`: un valor repetit entre maquines
>    fusiona series i amaga la que esta morta.
> 4. **No afegeixis `external_labels` ni cap `relabel_config`** per identificar la maquina. El
>    connector llegeix l'etiqueta `instance`, i els `external_labels` no surten a les consultes
>    locals.
> 5. **Reporta** la taula de la seccio 6 amb els valors reals, i digues explicitament que **no** has
>    canviat.
>
> Regles que no es negocien: cap canvi que obri un port, relaxi TLS, afegeixi una excepcio a un
> tallafocs o toqui fail2ban sense aprovacio explicita; cap secret a un fitxer versionat, a un log
> ni a una sortida; i qualsevol cosa que no puguis verificar, la reportes com a dubte en comptes de
> donar-la per bona.

## On es la resta

| Que busques | On es |
| --- | --- |
| Les normes de seguretat d'un connector | `docs/specifications/connector-security.md` |
| El contracte del connector `prometheus` | `docs/specifications/infrastructure.md` |
| Rotar l'anell de claus de les credencials | `docs/runbooks/connector-key-rotation.md` |
| Instal·lacio i actualitzacions | `docs/runbooks/installation.md` |
