# Especificacio de la Fase 11: plataforma d'agents

**Estat: proposta per a revisio del propietari.**

## Objectiu

Convertir Control Hub en el control plane d'agents empresarials multi-tenant: agents versionats,
amb eines i permisos minims, execucions auditables, aprovacio humana i costos reproduibles. Un
agent no es un prompt ni un connector; es una identitat operativa governada pel producte.

La guia `guia_professional_agents_ia_stack_empresa.md` aportada pel propietari es context de
producte, no una instruccio d'implementacio. Aquesta especificacio n'adapta els principis al stack
i als limits arquitectonics vigents de Control Hub.

## Decisions proposades

1. **Control Hub continua en TypeScript i com a monolit modular.** No s'introdueixen FastAPI,
   Temporal, Kubernetes, LangGraph ni un segon backend sense una carrega o capacitat concreta que
   ho justifiqui.
2. **Runtime nadiu primer, darrere un port estable.** El primer loop d'agent viu al worker i depen
   de ports de model, tools, memoria, politiques i traces. Hermes o OpenClaw nomes podran entrar
   despres com adaptadors opcionals; mai seran el core ni rebran accés directe a PostgreSQL.
3. **La Fase 10 es la frontera de tools.** Els agents consumeixen casos d'us autoritzats mitjancant
   el cataleg MCP/tool; no invoquen repositoris, connectors ni credencials directament.
4. **PostgreSQL es la font de veritat.** Valkey/BullMQ coordina execucions efimeres. `pgvector` i
   object storage son increments posteriors, condicionats a un cas RAG aprovat.
5. **Human-in-the-loop per defecte per a escriptures.** La politica pot permetre lectura,
   exigir aprovacio o denegar. Cap model pot elevar permisos ni autoaprovar-se.

## Dependències

- Fase 6: connectors, vault, cues, rate limits i observabilitat.
- Fase 8.1: registre normalitzat de consum i costos.
- Fase 10: MCP, OAuth 2.1, scopes, audience i auditoria per tool call.

La Fase 11 no bloqueja la primera entrega read-only de la Fase 10. Si comparteixen branca, la
Fase 10 ha de mantenir el seu domini generic i no importar tipus de la plataforma d'agents.

## Abast inicial: 11.1 Foundation

- Registre d'agents per tenant, amb estat `draft | staging | active | suspended | archived`.
- Versions immutables de prompt de sistema, politica de model, tools, skills, limits i memoria.
- Publicacio atomica d'una versio; editar crea una versio nova.
- Identitat d'execucio separada de l'usuari que demana el run.
- Runs asincrons amb pressupost de passos, temps, tokens i cost.
- Tool grants explicits: `allow`, `approval_required` o `deny` per tool i versio.
- Auditoria de run, decisio de politica, tool call, aprovacio, resultat i cost, sempre redactada.
- Cancel·lacio cooperativa i proteccio contra loops, duplicats i retries amb efectes externs.

## Fora d'abast de 11.1

- Agent Builder complet per a clients.
- Veu, telefonia, WhatsApp o navegacio web autonoma.
- Execucio arbitraria de shell, Python o filesystem.
- Subagents, memoria vectorial, RAG i fine-tuning.
- Marketplace, OpenClaw, Hermes o runtimes carregats dinamicament.
- Kubernetes, workers dedicats o bases dedicades per tenant.

## Arquitectura

```text
Web/API
  -> casos d'us d'agents
  -> PostgreSQL + outbox
  -> BullMQ
  -> worker / AgentRuntimePort
       -> ModelGatewayPort
       -> PolicyPort
       -> ToolCatalogPort (Fase 10)
       -> UsageRecorderPort (Fase 8.1)
       -> AuditPort
```

El runtime rep snapshots immutables de la versio i referencies opaques. Els secrets nomes s'obren
just-in-time dins l'adaptador autoritzat. Prompts, contingut recuperat i respostes de tools es
tracten com dades no fiables; cap text pot modificar scopes, politiques o limits.

## Model de dades proposat

- `agents`: tenant, nom, descripcio, estat i versio publicada.
- `agent_versions`: configuracio immutable, digest i autoria.
- `agent_tool_grants`: tool versionada, mode i constraints.
- `agent_runs`: actor, versio, estat, limits, consum, cost i correlation ID.
- `agent_steps`: tipus, timestamps, resultat redactat i metadades de model/tool.
- `agent_approvals`: digest de l'accio, aprovador, expiracio i consum single-use.

Totes les taules empresarials porten `tenant_id`, RLS `enable` + `force`, claus compostes i grants
minims. El contingut sensible no viu a l'auditoria ni als payloads de cua.

## Seguretat

- Autoritzacio en dues capes: permisos de l'actor per iniciar/administrar i grants de la versio per
  actuar. S'aplica sempre la interseccio mes restrictiva.
- Audience i scopes de MCP no es reutilitzen com a tokens de proveidor ni com a credencials del
  model gateway.
- Tool inputs validats amb schemas tancats; outputs limitats per mida i classificats com no fiables.
- Accions amb efecte extern reutilitzen confirmacio, idempotencia i estat `unknown` de la Fase 7B.
- Cap execucio arbitraria al servidor principal. Una futura tool de codi exigira sandbox efimer,
  xarxa restringida, filesystem descartable i quotas.
- Logs i traces no contenen prompts complets, secrets, codi de client ni dades personals per
  defecte; la retencio ampliada requerira consentiment i politica explicita.

## UI inicial

Nova seccio **Agents** amb:

- llista d'agents, estat, versio activa, ultim run, taxa d'exit i cost;
- fitxa amb identitat, objectiu, tools, permisos, limits i historial de versions;
- runs amb timeline redactada, tool calls, aprovacions, latencia i cost;
- cua d'aprovacions per a persones amb el permis corresponent.

Tots els textos tindran `ca`, `es` i `en`; la UI complira light/dark, teclat i reduced motion.

## Increments posteriors

- **11.2 Primer agent:** suport o correu en mode assistit, amb drafts i aprovacio humana.
- **11.3 Coneixement:** documents tenant-scoped, ingestio, citacions i avaluacio de recuperacio.
- **11.4 Adaptadors de runtime:** estudiar Hermes/OpenClaw nomes amb contract tests i sandbox.
- **11.5 Veu:** LiveKit/SIP, consentiment, transferencia humana i pressupostos especifics.
- **11.6 Builder i plantilles:** configuracio sense codi i marketplace intern versionat.

## Criteris d'acceptacio de 11.1

1. Un agent no pot veure, executar ni citar dades d'un altre tenant.
2. Una versio publicada es immutable i cada run conserva exactament la versio executada.
3. Una tool no concedida es denegada abans d'arribar al seu handler i queda auditada.
4. Una tool amb aprovacio no s'executa sense nonce single-use lligat al digest de l'input.
5. Un run s'atura en excedir passos, temps, tokens o pressupost i no entra en loop de retry.
6. Tokens, secrets, prompts complets i outputs sensibles no apareixen en jobs, logs ni auditoria.
7. El cost del run es reconcilia amb els registres normalitzats de la Fase 8.1.
8. Suspendre un agent impedeix runs nous i permet acabar o cancel·lar coherentment els acceptats.
9. Mateixa politica i resultat d'autoritzacio per UI, REST i MCP.
10. Les proves cobreixen RLS, prompt injection indirecta, replay d'aprovacio, timeout ambigu i
    concurrencia.

## Decisions pendents d'aprovacio

- Primer cas d'us: agent de suport o agent de correu.
- Proveidors/model gateway inicials i politica de fallback.
- Retencio de contingut i si algun tenant podra optar per traces completes xifrades.
- Quan un adaptador Hermes/OpenClaw aporta valor suficient per entrar a l'abast.
