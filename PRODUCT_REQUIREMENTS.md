# Control Hub - Requisits de producte

**Estat:** visio i abast aprovats; detall funcional pendent de les especificacions de cada modul.

## 1. Visio

Control Hub es el centre operatiu unic de l'empresa. Ha de permetre entendre i gestionar negoci, clients, productes, projectes, subscripcions, suport, automatitzacions, infraestructura, errors, IA, costos i salut general sense saltar entre eines per obtenir una visio global.

El producte es diu **Control Hub**. El nom legal i marca de l'empresa operadora encara no estan decidits i seran configurables com a identitat del tenant, sense quedar hardcoded al producte.

## 2. Usuaris inicials

La primera instal·lacio sera utilitzada principalment per dues persones: el responsable de l'empresa i el responsable tecnic. El model de permisos, pero, ha de ser valid per comercialitzar el producte i afegir equips sense redissenyar l'autoritzacio.

### Rols inicials

#### Owner

- Control complet del tenant.
- Gestio de membres, rols, facturacio, configuracio i dades.
- Acces a negoci, finances, operacions, tecnologia i auditoria.
- Aprovacio de les accions de maxim impacte.

#### Administrator

- Gestio operativa d'usuaris, clients, productes, subscripcions, tickets i configuracio funcional.
- Consulta d'auditoria segons permisos.
- Sense capacitat implicita per transferir propietat, eliminar el tenant o accedir a secrets en clar.

#### Technical

- Gestio d'infraestructura, connectors, automatitzacions, errors, observabilitat i costos tecnics.
- Acces a metriques i diagnosi.
- Operacions sensibles limitades per permisos i confirmacio.
- Sense permisos financers o empresarials no relacionats, tret que s'assignin explicitament.

Els rols agrupen permisos. L'API autoritza permisos concrets i permet combinar rols. Inicialment una persona pot ser `Owner` i l'altra pot combinar `Administrator` i `Technical`.

### Identitats no humanes

- Service accounts per integracions i automatitzacions.
- API clients amb scopes i rotacio de credencials.
- MCP clients en la fase corresponent.

No utilitzen sessions humanes ni comparteixen comptes personals.

## 3. Abast de Release 1.0

Release 1.0 es una versio comercial completa. Inclou tots els dominis aprovats a la documentacio, entregats incrementalment amb qualitat final.

### Governanca i identitat

- Tenants i configuracio de marca.
- Usuaris, memberships, rols i permisos.
- Sessions, MFA, recuperacio i auditoria.
- Preferencies de tema, idioma i timezone.

### CRM i activitat comercial

- Dashboard empresarial.
- Leads, estats, origen, prioritat i responsable.
- Clients, contactes, notes, tasques i activitat.
- Conversio de lead a client.
- Importacio, exportacio, cerca i filtres.

### Productes i projectes

- Productes propis, projectes i versions.
- Plans, preus, costos i marges.
- Associacio amb clients, infraestructura, connectors i incidencies.
- Estat, responsables, documentacio i activitat.

### Subscripcions i finances operatives

- Subscripcions, renovacions, pauses i cancel·lacions.
- MRR, ARR, costos fixos, costos variables i marge.
- Monedes, periodicitat, historial i alertes.
- Visibilitat financera operativa; no substitueix la comptabilitat legal.

### Suport i operacions

- Tickets, prioritats, categories, assignacions i comentaris.
- SLA, escalats, notificacions i historial.
- Incidencies vinculades amb serveis, errors, clients i projectes.
- Entrada manual, web, correu i connectors de comunicacio aprovats.

### Infraestructura

- Inventari de VPS, serveis, contenidors i endpoints.
- CPU, RAM, disc, uptime, latencia i certificats.
- Estat de backups i restauracions.
- Alertes i incidencies.
- Sense terminal SSH arbitrari ni Docker socket exposat al web.

### Automatitzacions

- Salut de n8n.
- Workflows, estat i execucions.
- Errors, durada, ultima execucio i associacions de negoci.
- Enllac segur cap a la UI externa de n8n.
- Control Hub continua operatiu sense n8n.

### IA i consum

- Proveidor, model, tokens, unitats i cost.
- Consum per tenant, client, producte, projecte i execucio.
- Pressupostos, limits i alertes.
- Errors i salut dels proveidors.
- Politica de privacitat i redaccio de contingut sensible.

### Errors i salut empresarial

- Errors d'aplicacio agregats i relacionats amb incidencies.
- Salut comercial, financera, operativa i tecnica.
- Alertes accionables, tendencias i timestamps de dades.
- Estat parcial quan un proveidor no respon.

### Distribucio i administracio del producte

- Docker Compose portable.
- Configuracio, backups, restauracio, actualitzacio i rollback.
- Canals de release i imatges OCI verificables.
- Runbooks, SBOM i politica de vulnerabilitats.
- Light/dark/system i `ca`, `es`, `en`.

### Agnosticisme respecte de qui l'instal·la

Control Hub es un producte que una tercera empresa ha de poder instal·lar i operar, no una eina
interna. La primera instal·lacio es la de casa, pero **cap regla de negoci d'una empresa
concreta pot viure al codi**.

Regla practica, aplicable a qualsevol especificacio nova:

- Horaris, festius, objectius de servei, prioritats, categories, monedes, impostos, barems i
  politiques de retencio son **dades del tenant**, no constants.
- El que hi ha al codi son els **tipus i els limits**; el que hi ha a la base de dades son els
  **valors**. Un horari de 08:00 a 16:00 es dada inicial d'una instal·lacio, mai un valor per
  defecte codificat.
- Els exemples d'una especificacio (n8n, una VPS concreta, un client concret) son
  il·lustratius. Si un exemple acaba a l'esquema, es un error de disseny.
- El que depen de la jurisdiccio (obligacions laborals, fiscals, terminis de conservacio) es
  configurable i queda documentat com a tal. La instal·lacio de casa n'es un cas, no la norma.

Els textos i les dades de mostra que nomes serveixen a la primera instal·lacio viuen al seed,
i el seed no forma part del producte.

### Capacitats planificades dins l'arquitectura 1.x

- MCP de lectura i operacions controlades.
- Portal de client amb permisos limitats.

Aquestes capacitats reutilitzen el mateix domini, permisos i auditoria. No justifiquen una arquitectura paral·lela.

## 4. Connectors de Release 1.0

El framework de connectors forma part del core. Els proveidors son adaptadors opcionals.

### Connectors inicials

- n8n.
- Prometheus i exporters per VPS.
- SMTP.
- IMAP.
- Microsoft Graph.
- Gmail / Google Workspace.
- Anthropic.
- OpenAI.
- Sentry.
- Object storage S3-compatible.
- Generic webhook.

Cada connector ha de proporcionar configuracio tipada, credencials xifrades, health check, capacitats, compatibilitat de versio, timeouts, retries, rate limiting, sincronitzacio, errors i auditoria.

### Extensibilitat

Afegir un connector no pot requerir modificar entitats de negoci ni afegir condicionals de proveidor al core. La documentacio incloura una plantilla i contract tests reutilitzables.

## 5. Autenticacio

### Metodes humans

- Correu electronic verificat i contrasenya.
- MFA TOTP obligatori per `Owner`, `Administrator` i `Technical`.
- Recovery codes d'un sol us, xifrats i regenerables.
- Passkeys/WebAuthn com a metode addicional compatible amb la mateixa identitat.
- Recuperacio de contrasenya amb token curt, single-use i revocacio de sessions.

### Requisits

- Hash de contrasenya resistent i parametres versionats.
- Politica contra contrasenyes compromeses sense imposar regles de composicio contraproduents.
- Rate limiting i proteccio contra credential stuffing.
- Sessions server-side revocables amb rotacio segura.
- Cookies `Secure`, `HttpOnly` i `SameSite` adequat.
- Reautenticacio per accions critiques.
- Registre d'accessos, MFA, recuperacions i revocacions.
- Cap token d'autenticacio a local storage.

### Identitats de maquina

- Credencials separades de comptes humans.
- Scopes de minim privilegi.
- Expiracio i rotacio.
- Identificador i auditoria per cada client.

La llibreria o servei concret s'aprovara en un ADR despres d'avaluar manteniment, portabilitat, WebAuthn, MFA, Fastify i llicencia comercial.

## 6. Experiencia de producte

- Sistema visual definit a `DESIGN_SYSTEM.md`.
- Mateixa arquitectura de components en light i dark.
- Catala, castella i angles amb cobertura equivalent.
- Cerca global i navegacio coherent entre dominis.
- Dashboards configurats per rol i permisos.
- Estats de loading, empty, error, stale, partial i permission denied.
- WCAG 2.2 AA, teclat, reduced motion i responsive.

## 7. Qualitat comercial

Cada increment integrat ha de ser:

- Tenant-scoped i autoritzat.
- Migrable i compatible amb actualitzacions.
- Observable i auditable.
- Internacionalitzat.
- Accessible.
- Provat segons risc.
- Documentat i recuperable.
- Sense dependències obligatories de proveidors opcionals.

No es publicara Release 1.0 fins que tot l'abast declarat tingui proves, runbooks, backup/restore verificat i criteris d'acceptacio aprovats.

## 8. Mesures d'exit

- La direccio pot entendre la salut global de l'empresa des d'un sol lloc.
- El responsable tecnic pot detectar errors i serveis degradats sense revisar manualment cada plataforma.
- Clients, productes, projectes, subscripcions, tickets i costos estan relacionats.
- Les dades de connectors indiquen font i ultima sincronitzacio.
- Una instal·lacio nova es pot configurar, actualitzar i restaurar seguint documentacio.
- Un connector nou es pot afegir sense modificar el nucli de negoci.

## 9. Decisions pendents de Fase 0

- Llibreria o servei d'identitat.
- Matriu detallada de permisos.
- Esquema de domini i dades.
- Volum, SLO i retencio esperats.
- Proveidors de correu i observabilitat de la primera instal·lacio.
- Branding configurable i nom legal del tenant.
- Ordre exacte dels increments dins Release 1.0.
- Politica comercial, llicencia i suport.
