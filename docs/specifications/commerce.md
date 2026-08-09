# Especificacio de productes i subscripcions

**Estat:** aprovada i ampliada durant la consolidacio previa a la Fase 6.

## Decisions economiques

- Els imports es desen com enters en unitats menors i amb moneda ISO 4217 explicita.
- El preu es net. L'impost es desa separat en basis points (`10000` = 100%).
- Els totals nets, impostos i bruts es calculen per separat; no s'utilitza `floating point`.
- Les periodicitats son `free`, `one_time`, `monthly`, `quarterly`, `semiannual` i `annual`.
- Control Hub calcula metriques operatives, pero no emet factures ni aplica prorrateig.
- Un canvi de pla es efectiu en una data concreta i crea historial immutable.
- Les metriques mai agreguen monedes diferents en una sola quantitat.

## Cataleg versionat

Un producte conte versions i cada versio conte plans. Els preus son snapshots immutables:
publicar un preu nou crea una fila nova i les subscripcions existents conserven el preu
contractat fins a un canvi explicit. Codis de producte i pla son estables dins del tenant.

### Model mental de la interfície

La portada del cataleg es centra en productes comercials. Mostra el nom, estat, descripcio,
nombre de plans i ofertes publicades; no exposa versions, plans i preus com quatre altes globals
que competeixen entre elles. La versio es conserva per traçabilitat, pero la seva gestio viu dins
del producte. Cada pla i la publicacio del seu preu viuen dins la versio corresponent.

L'unica accio principal de la portada es crear un producte. L'alta guiada completa de producte,
primera versio, pla i preu ha de ser atomica: la UI no pot encadenar quatre peticions que deixin
un cataleg parcial si una falla.

Cada pla declara una modalitat comercial: `subscription`, `maintenance`, `one_time` o
`project_service`. La modalitat viu al pla perquè un mateix producte pot oferir, per exemple,
una compra inicial i un manteniment recurrent. `one_time` i `project_service` exigeixen un preu
`one_time`; `subscription` i `maintenance` no l'admeten. L'aplicacio i PostgreSQL protegeixen
aquesta coherencia, també si s'intenta canviar la modalitat d'un pla que ja te preus publicats.

La fitxa dedicada del producte carrega nomes la seva jerarquia completa mitjançant una consulta
tenant-scoped. Mostra versions, plans, modalitat i snapshots de preu; la portada continua sent el
punt de gestio contextual per afegir versions, plans i preus.

## Serveis de clients

### Decisio COM-2: contracte comercial unificat

S'aprova `customer_services` com a contracte comercial pare. Representa tot allo que un client
te o ha tingut contractat: subscripcio, manteniment, compra unica o servei per projecte. Una
compra unica no es modela com una subscripcio cancel·lada i la recurrencia es opcional.

Cada servei referencia el client, el pla i el snapshot de preu contractat. La modalitat es copia
del pla en el moment de l'alta perquè el contracte historic no canviï si el cataleg evoluciona.
També conserva quantitat, data de contractacio, inici, fi opcional, responsable intern opcional i
projecte opcional. El projecte ha de pertanyer al mateix tenant i client.

Els estats comuns son:

- `active`: contracte vigent o compra lliurada que continua formant part dels actius del client;
- `paused`: servei recurrent suspes temporalment; nomes per subscripcio o manteniment;
- `completed`: compra o servei per projecte finalitzat satisfactoriament;
- `canceled`: contracte resolt o compra anul·lada, amb data efectiva obligatoria.

Les transicions generen `customer_service_events` append-only. Cap canvi de pla, preu, estat,
renovacio o vinculacio amb projecte reescriu l'historial.

### Recurrencia opcional

`customer_service_recurrence` existeix nomes per a `subscription` i `maintenance`. Conte el
periode actual, propera renovacio, renovacio automatica i dies d'avis. `one_time` i
`project_service` no poden tenir aquesta fila. PostgreSQL protegeix amb triggers aquesta
coherencia, a mes de les validacions del domini.

El preu contractat continua apuntant a `plan_prices`: es un snapshot immutable amb moneda,
import net, cost, impost i periodicitat. La UI calcula total net, impost i brut amb enters; els
imports financers nomes arriben a qui te `financials:read`.

### Autoritat i permisos

- `subscriptions:manage` permet llegir i gestionar serveis de clients durant aquest increment;
- les mutacions exigeixen MFA i auditoria backend;
- tota lectura i escriptura aplica `tenant_id` des del context autenticat;
- responsable i projecte es validen per claus foranes compostes del mateix tenant;
- la fitxa CRM pot mostrar relacions no financeres sense enviar imports al navegador.

### Migracio des de `subscriptions`

La migracio es additiva i gradual:

1. Crear `customer_services`, `customer_service_recurrence` i `customer_service_events`, amb RLS,
   claus, restriccions i indexos.
2. Copiar cada `subscription` a un servei amb modalitat `subscription` o `maintenance` segons el
   pla, preservant identificadors de client, pla, preu, quantitat i dates.
3. Copiar la recurrencia i transformar `subscription_events` en events del servei, mantenint una
   referencia unica a l'origen per fer el backfill idempotent.
4. Canviar repositori, API i UI al model nou i verificar paritat de recompte, estat i metriques.
5. Mantenir les taules antigues en nomes lectura durant una versio de desplegament. Eliminar-les
   requereix una migracio posterior, backup i pla de rollback aprovats.

No hi ha dual-write permanent: durant el desplegament gradual, les mutacions continuen al model
antic fins que el backfill i el canvi de lectura estan preparats; el tall al model nou es fa en una
migracio transaccional. Pressupostos i factures futurs podran referenciar `customer_service_id`,
pero no formen part d'aquest increment.

## Metriques

- ARR net: mensual x12, trimestral x4, semestral x2, anual x1, compra unica x0 i gratuït x0.
- MRR net: ARR dividit entre 12 amb arrodoniment half-up a unitats menors.
- Cost i marge utilitzen la mateixa normalitzacio temporal.
- L'impost no forma part de MRR, ARR ni marge net.
- Les subscripcions pausades o cancel·lades no contribueixen a metriques recurrents.

## Renovacions

Cada subscripcio activa conserva `renewal_at` i `renewal_alert_days`. Una alerta queda
activa quan la renovacio cau dins la finestra configurada. Totes les dates es desen en UTC
i la UI les presenta amb el locale de l'usuari.

## Autoritzacio

- `Owner` i `Administrator`: gestionen cataleg i subscripcions.
- `Owner` i `Administrator`: poden consultar metriques financeres.
- `Technical`: sense acces financer per defecte.
- Totes les mutacions exigeixen MFA, tenant scope i auditoria backend.
