# AGENTS.md

Aquest fitxer defineix les normes per a qualsevol agent que treballi al repositori Control Hub.

## Prioritats

1. Preservar seguretat, integritat de dades i aillament entre tenants.
2. Complir els documents canonics i ADR vigents.
3. Mantenir canvis petits, revisables i verificats.
4. Preferir patrons existents abans d'introduir dependencies o abstraccions.

## Abans de modificar codi

- Llegir `README.md`, `ARCHITECTURE.md` i els ADR relacionats.
- Revisar `git status` i no revertir canvis aliens.
- Localitzar les proves i convencions del modul afectat.
- Aclarir criteris d'acceptacio quan no es puguin deduir de la documentacio.
- No afegir dependencies sense justificar manteniment, llicencia i impacte de seguretat.

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
