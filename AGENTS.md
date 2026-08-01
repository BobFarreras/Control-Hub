# AGENTS.md

Aquest fitxer defineix les normes per a qualsevol agent que treballi al repositori Control Hub.

## Prioritats

1. Preservar seguretat, integritat de dades i aillament entre tenants.
2. Complir els documents canonics i ADR vigents.
3. Mantenir canvis petits, revisables i verificats.
4. Preferir patrons existents abans d'introduir dependencies o abstraccions.

## Abans de modificar codi

- Llegir `README.md`, `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `INTERNATIONALIZATION.md` i els ADR relacionats.
- Seguir `BRANCHING.md` i `CONTRIBUTING.md` per branques, commits i pull requests.
- Revisar `git status` i no revertir canvis aliens.
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
- Actualitzar documentacio, OpenAPI, migracions i `.env.example` quan correspongui.
- Informar de comprovacions no executades i riscos residuals.
- No fer commit, push, deploy o canvis destructius tret que l'usuari ho demani.

## Git

- Commits atomics amb Conventional Commits.
- No reescriure historial compartit ni utilitzar operacions destructives sense autoritzacio.
- No incloure `.env`, claus, certificats privats, backups, dumps o credencials.
- No barrejar refactors aliens amb una funcionalitat.

## Definition of Done

El canvi compleix els criteris d'acceptacio, respecta l'arquitectura, ailla tenants, aplica permisos, te proves proporcionals, passa les validacions, inclou observabilitat i documentacio necessaries, i es pot desplegar sense exposar dades ni secrets.
