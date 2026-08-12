# AGENTS.md

Aquest fitxer defineix les normes per a qualsevol agent que treballi al repositori Control Hub.

## Prioritats

1. Preservar seguretat, integritat de dades i aillament entre tenants.
2. Complir els documents canonics i ADR vigents.
3. Mantenir canvis petits, revisables i verificats.
4. Preferir patrons existents abans d'introduir dependencies o abstraccions.

## Abans de modificar codi

Primer, situar-se. Aquests dos responen "on som" i "que ja ens ha mossegat", i estalvien mes
temps que cap altre:

1. `docs/development/current-state.md`: que hi ha implementat, decisions vigents i el punt de
   continuacio. **Es el primer que s'ha de llegir en obrir una sessio.**
2. `docs/development/troubleshooting.md`: fallades reals ja diagnosticades, amb la causa i la
   solucio. Abans de dedicar mitja hora a un simptoma estrany, mira si ja hi es.

Despres, el marc:

- Llegir `README.md`, `DEVELOPMENT.md`, `SECURITY_ARCHITECTURE.md`, `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `INTERNATIONALIZATION.md` i els ADR relacionats.
- `docs/README.md` es l'index d'ADR, especificacions, seguretat, runbooks i plantilles.
- Llegir l'especificacio del modul que es toca abans d'escriure'n una linia. Si no n'hi ha cap
  aprovada, no s'implementa: primer l'especificacio.
- Seguir `BRANCHING.md` i `CONTRIBUTING.md` per branques, commits i pull requests.
- Revisar `git status`, confirmar que la branca surt d'on toca i no revertir canvis aliens.
- Localitzar les proves i convencions del modul afectat.
- Aclarir criteris d'acceptacio quan no es puguin deduir de la documentacio.
- No afegir dependencies sense justificar manteniment, llicencia i impacte de seguretat.

## Dubtes i decisions

- Si existeix un dubte material que pugui afectar arquitectura, domini, dades, seguretat, permisos, UX, operacio, costos o comportament de producte, l'agent ha de preguntar abans d'implementar.
- Quan hi hagi diverses alternatives valides, ha de presentar un selector estructurat amb 2 o 3 opcions mutuament excloents, indicar l'opcio recomanada i resumir l'impacte de cadascuna.
- S'ha d'utilitzar l'eina interactiva de seleccio quan estigui disponible. Si l'entorn no la proporciona, s'ha de formular una pregunta breu i esperar una decisio explicita.
- No s'ha de preguntar per decisions trivials que ja resolguin aquests documents, un ADR, les convencions del repositori o els criteris d'acceptacio.
- No s'han d'inventar requisits per evitar una pregunta ni continuar amb una assumpcio d'alt impacte sense deixar-la aprovada.
- La resposta escollida s'ha de reflectir a l'ADR o especificacio corresponent quan tingui efectes permanents.

## Qualitat de producte

- Control Hub es desenvolupa com a producte professional des del primer increment; no es creen implementacions provisionals destinades a ser reescrites.
- Les fases ordenen l'entrega, pero no redueixen els requisits de seguretat, tenancy, accessibilitat, internacionalitzacio, proves, observabilitat, migracions o operabilitat.
- Una funcionalitat parcial pot quedar desactivada amb feature flag, pero el codi integrat ha de complir la Definition of Done.
- No s'accepten mocks permanents, bypasses, secrets temporals, dades hardcoded ni APIs sense contracte amb la promesa de corregir-los mes endavant.
- Les decisions han de suportar instal·lacio comercial, actualitzacions i manteniment sense redissenyar el nucli.

## Arquitectura obligatoria

- El domini no depen de frameworks, transports ni proveidors.
- Els casos d'us coordinen el domini i depenen de ports/interfaces.
- API, UI, persistencia i connectors son adaptadors.
- La logica critica no viu en components React, routes o controladors.
- Tot acces empresarial inclou `tenant_id` resolt des del context autenticat.
- Cap connector es converteix en dependencia obligatoria del core.
- n8n s'integra nomes per API, webhooks i metriques suportades.
- Les operacions externes han de tenir timeout, retry limitat, idempotencia i observabilitat.

## Seguretat

- No escriure secrets, tokens, PII o credencials a codi, fixtures, logs o documentacio.
- Validar totes les entrades en els limits del sistema.
- Aplicar autenticacio, autoritzacio i tenant scope al backend.
- Utilitzar consultes parametritzades i restriccions de base de dades.
- Verificar signatures i protegir contra replay els webhooks.
- No exposar PostgreSQL, Redis, Docker socket ni SSH al panell.
- Les URLs externes configurables han de validar esquema i host per evitar SSRF i open redirects.
- Les accions destructives requereixen permisos explicits i auditoria.
- No reduir controls de seguretat per fer passar una prova.
- Tot connector compleix `docs/specifications/connector-security.md`; URLs i redirects es tracten com entrada SSRF no fiable.
- Tot contenidor de produccio compleix `docs/security/container-checklist.md` o documenta una excepcio aprovada.

## Dades i migracions

- Imports en unitats menors amb moneda explicita; dates en UTC.
- Migracions versionades, deterministes i compatibles amb desplegament gradual.
- No editar una migracio ja publicada; crear-ne una de nova.
- Canvis destructius exigeixen backup, pla de migracio i rollback documentat.
- Afegir claus foranes, uniques i indexos que protegeixin invariants reals.

## Codi i qualitat

- TypeScript estricte; evitar `any`, casts insegurs i errors ignorats.
- Noms de domini clars i codi en angles; documentacio de producte en catala.
- Comentaris nomes per explicar decisions no evidents.
- Evitar duplicacio significativa, abstraccions especulatives i dependencies circulars.
- APIs publiques versionades i documentades amb OpenAPI.
- Errors externs no han d'exposar detalls interns.
- Cap text visible queda hardcoded: afegir sempre claus `ca`, `es` i `en`.
- Cap component declara colors de producte directament: utilitzar tokens semantics.
- Tota UI nova funciona en light, dark, teclat i reduced motion.
- Tots els desplegables seleccionables (selects) utilitzen `SelectControl` o `SelectField` de
  `@/components/form-field`. No s'utilitzen `<select>` natius d'HTML ni selects de tercers
  (Radix, shadcn, etc.) per a desplegables d'estil propi. `SelectControl` proporciona
  accessible, keyboard navigation, dark mode i consistent visualment. `SelectField` afegeix
  label, hint i error via `Field`.

## Empaquetat i desplegament

Aquestes regles venen de faltes reals que van viure mesos al repositori sense que cap
validacio les detectes. `pnpm build` en verd no diu res sobre l'artefacte que s'entrega.

- **Els serveis arrenquen amb `node`, mai amb un gestor de paquets.** Passar per pnpm fa que
  corepack intenti descarregar-se un gestor en arrencar, cosa que necessita xarxa i un HOME
  escrivible; els contenidors son `read_only` i la imatge no arrencava.
- **Una etapa de runtime per servei.** Una sola imatge compartida feia que l'API i el worker
  portessin Next.js i els seus binaris de plataforma, 417 MB que no importen mai.
- **Nomes s'empaqueten els paquets del workspace** (`noExternal`), perque els seus `exports`
  apunten a TypeScript. La resta queda externa: empaquetar dependencies de tercers no aporta
  res i trenca les que fan `require` en execucio, com `pino`.
- **Les dependencies transitives que una app carrega es declaren a la seva `package.json`.**
  La disposicio aillada de pnpm no les resol des d'un paquet germa.
- **Els checksums de migracio es calculen sobre contingut normalitzat.** Amb els bytes crus,
  un checkout Windows i un Linux discrepen sobre un fitxer identic i el desplegament s'atura
  amb "Applied migration changed" sense que res hagi canviat.
- **CI construeix les imatges i aixeca l'stack.** Cap altra validacio cobreix aquest cami.

### Metode

Verifica l'artefacte compilat **a la maquina** abans de reconstruir una imatge: `node
apps/api/dist/server.js` triga dos segons i una reconstruccio uns vuit minuts. Diagnosticar a
base de reconstruir va costar hores en una sessio, i cada error en tapava el seguent.

Per mesurar que ocupa una imatge, `docker run --rm --entrypoint sh <imatge> -c "du -sh ..."`
respon en segons i evita optimitzar a cegues.

## Documentacio viva

La documentacio d'aquest repositori no es un resum del codi: es el context que fa que la
persona o l'agent seguent no hagi de redescobrir el que ja sabiem. Una documentacio
desactualitzada es pitjor que no tenir-ne, perque s'hi confia.

- **La documentacio canvia en el mateix commit que el comportament que descriu.** No en un
  commit posterior, i no "quan acabem la fase".
- **En obrir sessio, verificar `docs/development/current-state.md` contra la realitat** abans
  de fer-lo servir: branca, ultims commits i estat de CI. Si no quadra, corregir-lo primer.
- **En tancar un increment, actualitzar-lo sempre.** Que s'ha implementat, que queda pendent i
  quin es el punt de continuacio. Cap frase pot quedar dient que falta una cosa que ja s'ha
  fet.
- **Cada fallada que hagi costat mes de mitja hora de diagnosi va a
  `docs/development/troubleshooting.md`**, amb simptoma, causa i solucio. Es el retorn mes alt
  per linia escrita de tot el repositori.
- Les lliçons viuen al costat de la norma que justifiquen, no en un calaix comu: les
  d'empaquetat en aquest fitxer, les d'entorn local a `DEVELOPMENT.md`, les de contracte a
  l'especificacio del modul.
- Si un document i el codi es contradiuen, no s'apedaça el document sense entendre quin dels
  dos te rao. Un `README.md` que promet una fase diferent de la del pla es un defecte, no una
  imprecisio.
- Els documents de producte, en catala; el codi i els comentaris, en angles.

## Proves

- Afegir o actualitzar proves per cada canvi de comportament.
- Unit tests per regles de domini i permisos.
- Integration tests per PostgreSQL, cues i connectors.
- Contract tests per APIs externes; no dependre de serveis reals a CI.
- Playwright per fluxos critics d'usuari.
- Provar casos negatius: tenant incorrecte, rol insuficient, replay, timeout i duplicats.

## Verificacio abans de finalitzar

- Executar format, lint, typecheck, tests i build afectats.
- Revisar el diff complet i confirmar que no hi ha secrets ni fitxers generats accidentals.
- Actualitzar documentacio, OpenAPI, migracions i `.env.example` quan correspongui, i deixar
  `docs/development/current-state.md` dient la veritat sobre el punt on queda el projecte.
- Informar de comprovacions no executades i riscos residuals. **Una comprovacio que no s'ha
  pogut executar es diu, no s'omet:** dir que una cosa passa sense haver-ho vist es la manera
  mes rapida de perdre la confianca de qui revisa.
- No fer commit, push, deploy o canvis destructius tret que l'usuari ho demani.

### Llista de tancament

Abans de donar una feina per acabada, respon aquestes cinc amb un si:

1. Els criteris d'acceptacio de l'especificacio estan coberts per proves que he vist passar.
2. He executat lint, format, typecheck, tests i build, i he reportat el que no he pogut provar.
3. El diff no porta secrets, fitxers generats ni refactors aliens a la feina.
4. `current-state.md` descriu el projecte tal com queda, i cap frase seva ha quedat obsoleta.
5. El que m'ha costat diagnosticar ha quedat escrit a `troubleshooting.md`.

## Git

- Commits atomics amb Conventional Commits.
- No reescriure historial compartit ni utilitzar operacions destructives sense autoritzacio.
- No incloure `.env`, claus, certificats privats, backups, dumps o credencials.
- No barrejar refactors aliens amb una funcionalitat.

## Definition of Done

El canvi compleix els criteris d'acceptacio, respecta l'arquitectura, ailla tenants, aplica permisos, te proves proporcionals, passa les validacions, inclou observabilitat i documentacio necessaries, deixa `docs/development/current-state.md` sincronitzat amb el que hi ha de debo, i es pot desplegar sense exposar dades ni secrets.
