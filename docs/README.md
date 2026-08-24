# Documentacio de Control Hub

## Fonts canoniques

- `PRODUCT_REQUIREMENTS.md`: visio i abast.
- `ARCHITECTURE.md`: arquitectura global.
- `DESIGN_SYSTEM.md`: UI i motion.
- `INTERNATIONALIZATION.md`: locales i format.
- `IMPLEMENTATION_PLAN.md`: fases i gates.

## Directoris

- `adr/`: decisions i alternatives.
- `specifications/`: contractes implementables.
- `security/`: amenaces i controls.
- `runbooks/`: operacio i resposta. `runbooks/installation.md` (instal·lacio i actualitzacions),
  `runbooks/disaster-recovery.md` (recuperacio) i `runbooks/connector-key-rotation.md` (rotar
  l'anell de claus dels connectors, segons `adr/0008-connector-credential-vault.md`) i
  `runbooks/n8n-error-workflow.md` (muntar l'error workflow signat a una instancia d'n8n) i
  `runbooks/connect-a-vps.md` (preparar una VPS perque el Control Hub en llegeixi l'estat, amb
  el prompt per a l'agent que l'administra) i `runbooks/connect-vercel.md` (connectar un
  compte de Vercel amb un token de nomes lectura) i `runbooks/connect-supabase.md` (connectar un
  compte de Supabase amb un Personal Access Token, i el risc que porta) i
  `runbooks/connect-opencode.md` (instal.lar el
  collector local sanititzat i enviar consum a la VPS).
- `templates/`: formats obligatoris, i la plantilla de prompt per obrir sessio amb un agent
  (`templates/session-prompt-template.md`).

La documentacio canvia en la mateixa PR que el comportament afectat.

## Especificacions implementades

- `specifications/crm.md`: leads, clients i activitat comercial.
- `specifications/commerce.md`: productes, plans, preus, subscripcions i metriques.
- `specifications/support.md`: tickets, SLA amb horari laboral i incidencies. Aprovada,
  correspon a la Fase 5.
- `specifications/attendance.md`: registre de jornada, correccions i conciliacio contra hores
  imputades. Aprovada, Fase 5C. Requereix confirmacio de la gestoria.
- `specifications/projects-and-time.md`: entregues per client, imputacio d'hores, barems i
  marge. Aprovada, implementada com a Fase 5B darrere la flag `projects_and_time`.
- `specifications/connectors.md`: contracte de connector, vault de credencials, crides
  sortints i webhooks entrants. Aprovada, Fase 6, en desenvolupament darrere la flag
  `connectors`. La norma de seguretat que ha de complir es
  `specifications/connector-security.md`.
- `specifications/infrastructure.md`: estat de la VPS i de les automatitzacions d'n8n, amb
  registres estirats, alertes i incidencies. Aprovada, Fase 7, partida en 7.1 (plataforma, n8n
  i pantalla) i 7.2 (Prometheus, inventari i alertes), darrere la flag `infrastructure`.
- `specifications/connector-onboarding.md`: connectar una maquina sense endevinar res -- el
  diagnostic que diu que falta, el resum amb moltes maquines i el descobriment que proposa el
  que encara no s'ha declarat. **Proposta**, Fase 7.3, pendent d'aprovacio.
- `specifications/connector-vercel.md`: el connector de Vercel -- projectes com a estat,
  desplegaments fallits com a esdeveniment, i la base fixada al codi. **Proposta**, Fase 7.4;
  el connector esta escrit i la superficie que l'ha de dibuixar, oberta.
- `specifications/connector-supabase.md`: el connector de Supabase -- projectes com a estat,
  privilegi total del PAT acceptat i dit a l'onboarding, i cap migracio nova perque reutilitza la
  taula d'enllaç de Vercel. Aprovada, ampliacio de la Fase 7.4.
- `specifications/communications-usage-costs.md`: especificacio proposada de la Fase 8, partida en
  consum i costos, correu entrant i correu sortint. Aprovada, incloses les ampliacions de model.
- `specifications/connector-opencode.md`: collector local sanititzat d'OpenCode, ingress signat i
  projeccio de tokens sense prompts, codi ni paths. Aprovada, ampliacio de la Fase 8.1.
- `specifications/phase-7b-actions-and-oauth.md`: contracte acotat d'OAuth, accions asincrones i
  transport IMAP que necessita la Fase 8. Aprovat.
- `development/phase-8-implementation-guide.md`: ordre d'increments, portes i checklist per
  implementar la Fase 8 sense acoblar el core als proveidors.
- `development/phase-4-commerce.md`: operacio i validacio local de la Fase 4.
- `development/smart-data-table.md`: contracte dels llistats operatius reutilitzables.
- `development/current-state.md`: handoff, estat implementat i punt de continuacio. **El
  primer document a llegir en obrir una sessio.**
- `development/troubleshooting.md`: fallades reals ja diagnosticades, amb simptoma, causa i
  solucio. Consulta-l'ho abans de dedicar temps a un simptoma estrany.
- `development/writing-a-connector.md`: com afegir un proveidor nou implementant el contracte de
  connector, sense tocar el domini ni l'API.
- `development/dependency-log.md`: quines versions han entrat, quan, i si van entrar soles o
  revisades. **Generat amb `pnpm deps:log`, no s'edita a ma.** El procediment es a
  `BRANCHING.md`, seccio "Actualitzacions de dependencies".
