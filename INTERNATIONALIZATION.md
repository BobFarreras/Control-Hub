# Control Hub Internationalization

Control Hub suporta des del primer executable:

- `ca`: catala, idioma inicial del projecte.
- `es`: castella.
- `en`: angles.

## Principis

- Cap text visible queda hardcoded en components o casos d'us.
- Les claus descriuen significat, no el text original: `tickets.actions.create`.
- Backend i domini retornen codis estables; la capa de presentacio els tradueix.
- Noms de clients, connectors, models, workflows, IDs i logs tecnics no es tradueixen.
- Dates, hores, nombres, monedes i plurals utilitzen `Intl`, no concatenacio manual.
- Catala, castella i angles tenen la mateixa cobertura abans de fusionar una feature.

## Resolucio del locale

Ordre de prioritat:

1. Preferencia guardada de l'usuari.
2. Locale de la ruta o cookie de la instal·lacio.
3. `Accept-Language` a la primera visita.
4. Locale per defecte configurat pel tenant.
5. Fallback final `ca`.

El selector d'idioma canvia la preferencia sense perdre la ruta ni l'estat segur de la pantalla.

## Rutes

La UI web utilitzara prefix de locale:

```text
/ca/dashboard
/es/dashboard
/en/dashboard
```

URLs tecniques i API no es localitzen:

```text
/api/v1
/health/live
/health/ready
/webhooks/*
/mcp
```

## Estructura de missatges

```text
packages/i18n/
  src/
    config.ts
    routing.ts
    formatter.ts
  messages/
    ca.json
    es.json
    en.json
```

Exemple:

```json
{
  "tickets": {
    "title": "Tickets",
    "actions": {
      "create": "Crear ticket"
    },
    "count": "{count, plural, =0 {Cap ticket} one {# ticket} other {# tickets}}"
  }
}
```

Els fitxers es divideixen per domini quan el volum ho requereixi, mantenint el mateix schema tipat als tres idiomes.

## API i errors

L'API retorna codis i parametres estructurats:

```json
{
  "type": "https://control-hub.example/problems/permission-denied",
  "code": "permission_denied",
  "status": 403,
  "params": {
    "permission": "integrations:manage"
  }
}
```

La UI tradueix `code`. L'API pot localitzar correus, exports o documents quan rep un locale explicit, pero els logs interns conserven codis estables.

## Dades locals

- Dates i hores es guarden en UTC; es mostren en la timezone del tenant o usuari.
- Moneda es guarda amb codi ISO 4217 i import en unitats menors.
- Percentatges i unitats utilitzen formatters centralitzats.
- No es guarden cadenes ja formatejades a la base de dades.
- Contingut empresarial creat per usuaris no es tradueix automaticament.

## Layout i traduccio

- Els controls permeten com a minim un 35% d'expansio.
- No es fixen amplades segons una traduccio concreta.
- Truncament nomes per dades secundaries i sempre amb acces al text complet.
- Frases no es construeixen concatenant fragments traduïts.
- Plurals, genere i seleccions utilitzen ICU MessageFormat.

## Workflow de desenvolupament

1. Definir claus i text base en catala amb la feature.
2. Afegir castella i angles en el mateix canvi.
3. Executar validacio de schemas, claus absents i claus orfes.
4. Provar pseudo-localitzacio o expansio de text.
5. Revisar captures en els tres idiomes.

CI falla quan falta una clau, hi ha schemas diferents, sintaxi ICU invalida o un component introdueix text visible fora del sistema de missatges.

## Contingut inicial compartit

La navegacio, autenticacio, configuracio, errors globals, estats de salut, permisos, dates i accions comunes es tradueixen durant la Fase 1. Cada modul posterior aporta el seu propi namespace.
