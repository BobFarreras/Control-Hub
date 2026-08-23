# Control Hub - Pla d'implementacio per fases

Aquest document converteix l'arquitectura en un pla de treball revisable. Cada fase produeix un increment executable amb qualitat de producte final, es valida abans de continuar i no barreja funcionalitats de fases futures.

Les fases ordenen dependències i revisions; no representen prototips ni versions de qualitat reduida. Tot codi integrat ha de ser mantenible, segur, migrable, observable, internacionalitzat i apte per a una distribucio comercial. Quan una capacitat encara no estigui disponible, es dissenya el contracte necessari i es manté desactivada, en lloc d'introduir una implementacio descartable.

## Model de seguiment

Cada fase passa pels estats seguents:

```text
Proposta -> Aprovada -> En desenvolupament -> En revisio -> Acceptada
```

Per tancar una fase cal:

- Complir tots els criteris d'acceptacio.
- Superar lint, typecheck, tests i build.
- Revisar seguretat, permisos i tenant scope.
- Actualitzar documentacio i decisions.
- Fer una demostracio funcional.
- Crear un commit o release identificable.
- Obtenir aprovacio abans d'iniciar la fase seguent.

Quan aparegui una decisio no coberta, l'agent presentara 2 o 3 opcions seleccionables amb una recomanacio i no continuara amb una assumpcio d'alt impacte. La decisio aprovada quedara documentada.

Els canvis urgents poden entrar fora de fase, pero han de quedar documentats i provats.

## Fase 0 - Governanca i especificacions

**Objectiu:** eliminar decisions ambigues abans de crear el runtime.

La visio i l'abast aprovats es defineixen a `PRODUCT_REQUIREMENTS.md`. Aquesta fase els converteix en models, ADR i contractes implementables.

### Implementacio

- Crear `docs/adr`, `docs/specifications`, `docs/runbooks` i `docs/security`.
- Escriure ADR de tenancy, autenticacio, connectors, secrets, cues i desplegament.
- Definir convencions de codi, commits, branching i releases.
- Aprovar el sistema visual, motion, responsive i accessibilitat.
- Aprovar arquitectura i workflow de `ca`, `es` i `en`.
- Definir matriu inicial de rols i permisos.
- Definir classificacio de dades i politica de retencio.
- Definir RPO, RTO i procediment de recuperacio.
- Crear plantilles per features, ADR i runbooks.

### Entregables

- ADR aprovats.
- Abast de Release 1.0 descompost en increments i especificacions revisables.
- Especificacio d'autenticacio i tenant context.
- Contracte inicial de connectors.
- Model d'errors i auditoria.
- Matriu de permisos.
- Threat model inicial.
- `DESIGN_SYSTEM.md` i `INTERNATIONALIZATION.md` aprovats.

### Revisio del propietari

- Confirmar usuaris, rols i responsabilitats reals.
- Confirmar dades que es poden emmagatzemar.
- Aprovar RPO/RTO i costos operatius.
- Aprovar que la primera distribucio sigui single-tenant.

### Criteri de sortida

No queda cap decisio estructural necessaria per crear el monorepo i l'esquema inicial.

## Fase 1 - Fonaments executables

**Objectiu:** obtenir una aplicacio buida pero completa, reproduible i desplegable.

### Implementacio

- Inicialitzar pnpm workspaces i Turborepo.
- Crear `apps/web`, `apps/api` i `apps/worker`.
- Crear packages de configuracio, contractes, domini, base de dades i observabilitat.
- Activar TypeScript estricte, ESLint, format i imports controlats.
- Crear `packages/ui` amb tokens, temes i primitives compartides.
- Crear `packages/i18n` amb routing, formatters i missatges `ca`, `es` i `en`.
- Preparar PostgreSQL, Redis i Docker Compose.
- Afegir healthchecks i graceful shutdown.
- Crear `.env.example` i validacio de configuracio en arrencar.
- Configurar Vitest, Testcontainers i Playwright.
- Crear CI amb install, lint, typecheck, tests, build i secret scan.
- Aplicar el checklist de hardening als contenidors i contract tests de seguretat als limits compartits.
- Activar Dependabot per npm i Docker quan existeixin els manifests corresponents.

### Entregables

- `docker compose up` inicia tot el core.
- Web accessible amb estat del sistema.
- `/health/live` i `/health/ready` a l'API.
- Worker connectat a una cua de prova.
- Migracio inicial executable.
- Pipeline CI en verd.

### Proves minimes

- Arrencada en un entorn net.
- API disponible i PostgreSQL preparat.
- Readiness falla quan una dependencia obligatoria no esta disponible.
- Un job de prova es processa una sola vegada logicament.
- Build de les tres aplicacions.
- Smoke visual en light/dark i els tres idiomes.

### Revisio del propietari

- Provar l'arrencada local amb una unica ordre.
- Revisar estructura i noms del repositori.
- Confirmar que no hi ha funcionalitats de negoci prematures.

### Criteri de sortida

Qualsevol desenvolupador pot clonar, configurar i executar el projecte seguint el README.

## Fase 2 - Identitat, tenants i seguretat base

**Objectiu:** establir la frontera de seguretat abans d'introduir dades empresarials.

### Implementacio

- Usuaris, tenants, memberships, rols i permisos.
- Login, logout, expiracio i revocacio de sessions.
- MFA obligatoria per a tots els comptes; tots els rols de Control Hub son de personal intern.
- Tenant context derivat de la sessio.
- Middleware d'autenticacio i autoritzacio.
- RLS i repositoris tenant-scoped.
- Audit log append-only per accions sensibles.
- Rate limiting, headers de seguretat i proteccio CSRF.

### Entregables

- Administrador inicial creat mitjancant bootstrap controlat.
- Gestio basica d'usuaris i membres.
- Matriu de permisos aplicada a API i UI.
- Pantalla de sessions actives i revocacio.
- Registre d'accessos i canvis administratius.

### Proves minimes

- Un tenant no pot llegir ni modificar dades d'un altre.
- Un identificador manipulat no evita el tenant scope.
- Un rol sense permis rep `403`.
- Sessions expirades o revocades reben `401`.
- Operacions privilegiades generen auditoria.

### Revisio del propietari

- Validar el flux d'alta del primer administrador.
- Provar cada rol amb comptes reals de demostracio.
- Revisar informació mostrada a l'auditoria.

### Criteri de sortida

Les barreres de tenant i permisos estan provades abans de crear moduls de negoci.

## Fase 3 - CRM professional

**Objectiu:** centralitzar leads, clients, contactes i activitat.

### Implementacio

- Leads amb origen, estat, responsable i historial.
- Conversio controlada de lead a client.
- Clients i contactes amb dades de facturacio i comunicacio.
- Notes, tasques i timeline d'activitat.
- Cerca, filtres, ordenacio i paginacio server-side.
- Importacio i exportacio CSV amb validacio.
- Dashboard comercial inicial.

### Entregables

- Flux complet des de lead fins a client.
- Fitxa de client amb contactes i activitat.
- Assignacio de responsables.
- Importador amb previsualitzacio d'errors.

### Proves minimes

- Regles de transicio d'estat.
- Conversio idempotent de lead.
- Deteccio de duplicats dins del tenant.
- Importacions parcials no deixen dades incoherents.
- Permisos d'`Owner`, `Administrator` i lectura per `Technical`.

### Revisio del propietari

- Introduir una mostra de clients reals anonimitzada.
- Validar camps, estats, filtres i flux comercial.
- Aprovar el dashboard abans d'afegir mes moduls.

### Criteri de sortida

El CRM substitueix de manera fiable el registre manual del flux comercial basic.

## Fase 4 - Productes, plans i subscripcions

**Objectiu:** representar l'oferta comercial i calcular ingressos recurrents.

### Implementacio

- Productes, versions, plans i preus.
- Subscripcions, renovacions, pauses i cancel·lacions.
- Moneda, impostos i periodicitat explicits.
- MRR, ARR, cost, marge i dates de renovacio.
- Historial de canvis de preu i pla.
- Alertes de renovacio.

### Entregables

- Cataleg versionat.
- Subscripcions associades a clients.
- Dashboard financer basic.
- Alertes configurables de renovacio.

### Proves minimes

- Calculs monetaris sense floating point.
- MRR per diferents periodicitats.
- Canvis de pla amb historial immutable.
- Dates limit i zones horaries.
- Autoritzacio d'operacions financeres.

### Revisio del propietari

- Comparar calculs amb una mostra manual coneguda.
- Confirmar terminologia comercial i estats.
- Aprovar informes i alertes.

### Criteri de sortida

MRR, renovacions i marges es poden justificar a partir de dades auditables.

## Fase 5 - Suport, tickets i incidencies

**Objectiu:** gestionar peticions de clients i problemes operatius.

### Implementacio

- Tickets, prioritats, estats, categories i assignacions.
- Comentaris interns i comunicacions visibles al client.
- SLA, venciments i escalats.
- Incidencies vinculades a serveis, clients o tickets.
- Notificacions i historial.
- Preparacio de canals entrants sense acoblar-los al domini.
- `tickets.project_id` nullable des de la primera migracio. La Fase 5B hi penja, i afegir la
  columna despres obligaria a migrar dades ja escrites.

### Entregables

- Safata de suport.
- Fitxa de ticket i timeline.
- Regles de SLA i alertes.
- Conversio d'error o alerta en incidencia.

### Proves minimes

- Visibilitat de comentaris interns.
- Calcul de SLA amb horaris configurats.
- Idempotencia de missatges entrants.
- Permisos de suport i clients.

### Revisio del propietari

- Simular un cicle complet de ticket.
- Validar prioritats, SLA i escalats.
- Aprovar plantilles de notificacio.

### Criteri de sortida

Una incidencia es pot registrar, assignar, resoldre i auditar de principi a fi.

## Fase 5B - Projectes i temps

**Objectiu:** saber quina feina hi ha en curs i quant costa fer-la.

Especificacio aprovada a `docs/specifications/projects-and-time.md`. Va despres dels tickets
perque les imputacions han de poder penjar tant d'un projecte com d'un ticket; l'unica cosa
que la Fase 5 li deu es la columna `tickets.project_id`.

Es numera 5B i no 6 per no renumerar les fases posteriors, que ja tenen dependencies
documentades entre elles.

### Implementacio

- Projectes per client, amb estat, responsable, dates i historial append-only.
- Imputacio de temps a un projecte o a un ticket, amb marca de facturable.
- Barem de cost per persona i de venda per client o projecte, versionats per data d'efecte.
- Rendibilitat per projecte i per client, per moneda.
- Permisos `projects:read`, `time:log`, `time:manage` i `rates:manage`.

### Entregables

- Safata de projectes i fitxa amb activitat.
- Formulari d'imputacio rapid.
- Informe de marge per projecte i per client.
- Pantalla de barems restringida a `Owner`.

### Proves minimes

- Publicar un barem nou no altera el cost d'una imputacio anterior.
- Una imputacio sense projecte ni ticket, o amb tots dos, es rebutjada per la base de dades.
- Un `Technical` rep `403` a cost i a marge.
- Un tenant no veu projectes, imputacions ni barems d'un altre.

### Revisio del propietari

- Comparar el marge calculat d'un projecte real amb un calcul manual conegut.
- Validar que la imputacio diaria es prou rapida per fer-se de veritat.
- Confirmar qui pot veure els costos per hora.

### Criteri de sortida

El marge per client es pot justificar a partir d'hores i barems auditables.

## Fase 5C - Registre de jornada

**Objectiu:** complir l'obligacio de registre horari i saber les hores reals de cada mes.

Especificacio a `docs/specifications/attendance.md`. Va despres de la Fase 5B perque la
conciliacio contra hores imputades necessita que les imputacions existeixin.

**No s'activa en produccio sense confirmacio de la gestoria.** L'obligacio de l'article 34.9
de l'Estatut dels Treballadors depen de la relacio laboral existent, i hi ha hagut iniciativa
de reforma cap a un registre digital amb acces remot de la Inspeccio.

### Implementacio

- Log append-only d'events de fitxatge amb hora de servidor.
- Correccions amb autor i motiu, sense esborrar l'original.
- Resum mensual i exportacio per a la gestoria.
- Acces de cada persona al seu propi registre, sense permis addicional.
- Conciliacio entre hores registrades i hores imputades.
- Permisos `attendance:record` i `attendance:manage`.

### Entregables

- Fitxatge d'un sol clic amb estat visible.
- Resum mensual imprimible.
- Exportacio per interval de dates.
- Informe de conciliacio.

### Proves minimes

- Cap event es pot modificar ni esborrar.
- Una sortida sense entrada previa es rebutjada.
- Una sessio que travessa mitjanit s'atribueix al dia d'inici.
- Un membre no pot llegir el registre d'un altre, i fer-ho amb permis queda auditat.

### Revisio del propietari

- Confirmar amb la gestoria que la forma del registre es acceptable.
- Comprovar que fitxar es prou rapid per fer-se cada dia.
- Validar l'exportacio amb un mes real.

### Criteri de sortida

Un requeriment d'inspeccio es pot atendre amb una exportacio del sistema, i les hores no
imputables del mes son visibles.

## Fase 6 - Plataforma de connectors

**Objectiu:** integrar proveidors sense contaminar el nucli.

### Implementacio

- Contracte i registre de connectors.
- Configuracio validada i versionada.
- Vault logic de credencials xifrades.
- Health checks, sincronitzacions i estat d'error.
- Timeouts, retries, rate limits i circuit breaker.
- Webhooks signats i idempotents.
- Connector generic de webhook com a referencia.

### Entregables

- Pantalla d'integracions instal·lades.
- Alta, prova, desactivacio i rotacio de credencials.
- SDK intern o plantilla per crear connectors.
- Historial de sincronitzacions i errors.

### Proves minimes

- Credencials mai retornades per l'API.
- Configuracio invalida rebutjada.
- Timeout i rate limit no bloquegen el worker.
- Retry no duplica efectes.
- Un connector fallit no afecta el core.

### Revisio del propietari

- Configurar un connector de prova des de zero.
- Revisar missatges d'error i estat de salut.
- Aprovar l'experiencia abans d'afegir proveidors reals.

### Criteri de sortida

Es pot afegir un nou proveidor implementant el contracte sense modificar el domini.

## Fase 7 - Infraestructura i connector n8n

**Objectiu:** donar visibilitat operativa sobre VPS, serveis i automatitzacions.

### Implementacio

- Inventari de VPS i serveis.
- Connector Prometheus/exporters per CPU, RAM, disc i uptime.
- Estat de contenidors sense exposar Docker socket al web.
- Connector n8n per API, webhooks i metriques oficials.
- Workflows, execucions, errors i associacions empresarials.
- Enllac extern validat cap a cada workflow de n8n.
- Alertes per serveis caiguts, certificats, backups i execucions fallides.

### Entregables

- Dashboard tecnic.
- Detall de VPS i serveis.
- Vista d'automatitzacions n8n.
- Navegacio segura cap a la UI externa de n8n.
- Regles d'alerta i historial d'incidencies.

### Proves minimes

- Caiguda de n8n no afecta Control Hub.
- Tokens n8n no apareixen en URL ni logs.
- URLs externes malicioses es rebutgen.
- Errors temporals respecten backoff.
- Webhooks duplicats no creen incidencies duplicades.

### Revisio del propietari

- Connectar la VPS i instancia n8n reals.
- Comparar dades amb les eines originals.
- Obrir workflows des de Control Hub.
- Forcar una fallada controlada i revisar l'alerta.

### Criteri de sortida

Control Hub mostra l'estat real de la infraestructura i n8n sense assumir-ne el control intern.

## Fase 7B - Accions i credencials OAuth

**Estat: proposta, pendent d'aprovacio.**

**Especificacio acotada per a la Fase 8:**
`docs/specifications/phase-7b-actions-and-oauth.md`. Defineix OAuth2 amb PKCE, outbox d'accions i un
port tipat de bustia per IMAP; continua pendent de vistiplau.

**Objectiu:** que un connector pugui **escriure** al proveidor, i que una credencial que caduca es
renovi sola, sense obrir cap via alternativa d'autoritzacio.

Fins aqui la plataforma nomes sap dues coses: **estirar** dades i **rebre** events. Crear un
workflow a n8n, enviar un correu o publicar a un canal son la tercera, i no hi caben. Va abans de
la Fase 8 perque Gmail i Microsoft Graph son OAuth, no un token que s'enganxa un cop.

Es numera 7B, com la 5B, per no renumerar les fases posteriors.

### Implementacio

- Capacitat `actions` al manifest del connector: nom, esquema d'entrada validat, permis exigit i
  si es reversible.
- Tota accio s'executa a la cua, mai dins la peticio HTTP. L'API accepta, encua i respon `202`.
- Clau d'idempotencia obligatoria: un reintent no crea dos objectes al proveidor.
- Confirmacio humana explicita, i segon factor per a les accions declarades irreversibles.
- Auditoria de qui, que, contra quina instancia i amb quin resultat, amb el cos enviat redactat.
- Tipus de credencial `oauth2`: authorization code amb PKCE, refresh al vault, renovacio
  programada abans de caducar i revocacio.
- Estat de credencial visible: valida, a punt de caducar, caducada, revocada.
- Quota d'accions per instancia i per tenant.

### Entregables

- Contracte d'accions documentat a `docs/development/writing-a-connector.md`.
- Connexio OAuth des de la pantalla d'integracions, amb estat i caducitat visibles.
- Historial d'accions executades.
- Primera accio real: activar i desactivar un workflow d'n8n.

### Proves minimes

- Una accio sense clau d'idempotencia es rebutjada; la mateixa clau dues vegades executa un cop.
- Cap refresh token surt per l'API ni per cap log.
- Una credencial caducada atura les operacions i ho diu, en comptes de repetir `401`.
- Un rol sense el permis de l'accio rep `403`, i la denegacio queda auditada.
- Una accio irreversible sense segon factor es rebutjada.
- Revocar l'autoritzacio al proveidor deixa la instancia en un estat coherent.

### Revisio del propietari

- Autoritzar un proveidor real amb OAuth i veure'n la caducitat.
- Executar una accio i comprovar-la al proveidor.
- Aprovar una a una quines accions poden existir.

### Criteri de sortida

Un connector pot escriure al proveidor amb confirmacio, idempotencia i auditoria, i una credencial
que caduca es renova sense que ningu hi intervingui.

## Fase 8 - Correu, IA i costos variables

**Objectiu:** integrar comunicacions i calcular el cost real per client i producte.

**Especificacio en esborrany:** `docs/specifications/communications-usage-costs.md`, amb la guia
incremental a `docs/development/phase-8-implementation-guide.md`. Separa consum i costos (8.1) del
correu entrant (8.2) i sortint (8.3): OAuth i les accions depenen de la Fase 7B, pero el motor de
costos nomes necessita els connectors de lectura ja entregats.

### Implementacio

- SMTP i recepcio per IMAP o APIs oficials.
- Connectors Microsoft Graph i Gmail segons necessitat.
- Connectors Anthropic i OpenAI.
- Registre normalitzat de model, tokens, unitats i cost.
- Assignacio de consum a tenant, client, producte i execucio.
- Pressupostos, limits i alertes de despesa.
- Politica de redaccio per prompts i contingut sensible.

### Entregables

- Salut dels proveidors.
- Consum i cost agregats.
- Marge real per client i producte.
- Alertes de pressupost.

### Proves minimes

- Conversio de monedes i tarifes versionades.
- Events duplicats no dupliquen costos.
- Contingut sensible no apareix als logs.
- Fallada d'un proveidor no interromp els altres.

### Revisio del propietari

- Comparar una factura real amb el calcul del sistema.
- Aprovar nivell de detall i retencio de dades IA.
- Validar alertes de cost.

### Criteri de sortida

Els costos mostrats son reproduibles, tenen font i es poden reconciliar.

## Fase 8B - Xarxes socials i publicacio

**Estat: proposta, pendent d'aprovacio.**

**Objectiu:** planificar, aprovar i publicar el contingut dels canals dels clients des d'un sol
lloc, i tornar-ne el resultat.

Depen **nomes de la 7B**: sense accions ni OAuth no hi ha publicacio possible. Es numera 8B per
ordre de valor, no per dependencia — si interessa abans que el correu i la IA, es pot avancar
sense tocar res mes.

### Implementacio

- Connectors Meta (pagines de Facebook i comptes d'Instagram professionals), LinkedIn i TikTok,
  cadascun amb les seves operacions de lectura i les seves accions de publicacio.
- Comptes socials com a actiu d'un client: qui els ha autoritzat, quan caduca l'autoritzacio i
  qui de l'equip hi pot publicar en nom seu.
- Calendari editorial amb esborrany, revisio, aprovacio i publicacio programada.
- La publicacio es una accio de la 7B: encuada, idempotent, confirmada i auditada.
- Biblioteca de mitjans amb els fitxers que es publiquen, amb tenant scope i caducitat.
- Recollida de resultats (abast, interaccions) com a operacio de lectura ordinaria.
- Vincle amb el CRM: cada compte i cada publicacio pengen d'un client.

### Entregables

- Calendari editorial i cua d'aprovacio.
- Historial de publicacions amb enllac al post real, construit i validat per nosaltres.
- Informe per client del que s'ha publicat i com ha anat.
- Estat d'autoritzacio de cada canal, amb avis abans de caducar.

### Proves minimes

- Una publicacio programada no surt dues vegades encara que el worker es reinicii.
- Un token caducat atura la cua i avisa; la publicacio no es perd ni s'envia a mitges.
- Una publicacio rebutjada a l'aprovacio no arriba mai al proveidor.
- Un fitxer de la biblioteca no es visible des d'un altre tenant.
- El limit de l'API d'un proveidor no bloqueja els altres canals.

### Revisio del propietari

- Publicar de veritat a un compte de proves de cada xarxa.
- Aprovar el circuit d'aprovacio i qui pot publicar en nom d'un client.
- Confirmar que cada client autoritza els seus propis comptes, amb les seves condicions d'us.

### Criteri de sortida

Una publicacio passa d'esborrany a publicada amb aprovacio sense sortir de Control Hub, i el seu
resultat es veu al mateix lloc.

## Fase 9 - Operacio comercial i distribucio

**Objectiu:** convertir el projecte intern en un producte instal·lable i actualitzable.

### Implementacio

- Imatges OCI multi-arquitectura i fixades per digest.
- Canals `stable`, `beta` i `development`.
- Instal·lador, actualitzador i rollback.
- Migracions expand/contract.
- Ansible per preparar una VPS neta.
- Backup, restore i disaster recovery test.
- SBOM, signatura Cosign i provenance.
- Matriu de compatibilitat i release notes.
- Llicencia del producte i inventari de llicencies de tercers.

### Entregables

- Instal·lacio documentada en una VPS neta.
- Actualitzacio entre dues versions sense perdre dades.
- Restauracio completa en un host nou.
- Runbooks d'operacio i suport.

### Proves minimes

- Instal·lacio automatitzada repetible.
- Rollback davant d'un healthcheck fallit.
- Restauracio dins l'RTO declarat.
- Verificacio de signatures i SBOM.

### Revisio del propietari

- Instal·lar una release sense intervencio del desenvolupador principal.
- Simular actualitzacio, fallada i restauracio.
- Aprovar llicencia, suport i responsabilitats operatives.

### Criteri de sortida

Una tercera empresa pot instal·lar, operar, actualitzar i recuperar Control Hub seguint la documentacio.

## Fase 10 - MCP i portal de client

**Objectiu:** exposar capacitats controlades a agents i clients sense duplicar logica.

### Implementacio

- MCP server basat en els casos d'us existents.
- OAuth 2.1, scopes, audience validation i auditoria per tool call.
- Primera release amb tools de lectura.
- Accions d'escriptura separades i confirmades.
- Portal de client amb permisos i vistes limitades.
- Contract tests de compatibilitat MCP.

### Entregables

- Cataleg de tools documentat.
- Client MCP de prova.
- Portal per tickets, documents i estat de serveis.
- Auditoria unificada d'API, UI i MCP.

### Proves minimes

- Rebuig de tokens amb audience o scopes incorrectes.
- Cap token passthrough a proveidors.
- Separacio estricta entre tenants.
- Confirmacio d'accions destructives.
- Mateix resultat de permisos per REST, UI i MCP.

### Revisio del propietari

- Aprovar individualment cada tool exposada.
- Validar que un client nomes veu els seus recursos.
- Revisar consentiment, auditories i accions sensibles.

### Criteri de sortida

MCP i portal reutilitzen les mateixes regles del core i no obren vies alternatives d'autoritzacio.

## Plantilla de revisio de fase

En acabar cada fase s'ha de presentar:

```md
## Revisio de fase N

- Objectiu:
- Entregables completats:
- Decisions preses:
- Demostracio:
- Tests executats:
- Riscos residuals:
- Deute acceptat:
- Canvis de documentacio:
- Commit o release:
- Estat: pendent d'aprovacio | acceptada
```

## Ordre de treball dins de cada feature

1. Especificacio i criteris d'acceptacio.
2. Threat model proporcional al risc.
3. Model de dades i contracte API.
4. Tests de domini i permisos.
5. Implementacio del cas d'us.
6. Adaptadors de persistencia i transports.
7. UI i flux complet.
8. Observabilitat i auditoria.
9. Proves d'integracio i E2E.
10. Revisio, documentacio i commit.
