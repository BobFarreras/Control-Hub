# Seguretat de connectors

Els connectors processen dades no fiables i credencials privilegiades. S'executen al worker, mai al browser, i no reben acces general al host.

## Registre i configuracio

- Tipus de connector registrat en build-time.
- Schema Zod versionat amb camps allowlisted.
- URL base separada de paths o recursos.
- `https` obligatori en produccio, excepte endpoints locals explicitament administrats.
- Configuracio validada en alta i abans d'executar.
- Capability manifest limita operacions disponibles.
- Credencial referenciada per ID opac; no inclosa al job payload.

## Prevencio SSRF

Per cada connexio i redirect:

1. Parsejar amb `URL`, sense concatenacio manual.
2. Permetre nomes schemes declarats; HTTP connectors no accepten `file`, `ftp`, `gopher`, `data` o similars.
3. Normalitzar hostname i rebutjar credencials embegudes a URL.
4. Resoldre DNS i bloquejar loopback, link-local, multicast, metadata cloud, xarxes privades i rangs reservats, tret d'una allowlist administrativa explicita.
5. Connectar a la IP validada i revalidar redirects per evitar DNS rebinding.
6. Limitar redirects, ports, resposta, durada i bytes.
7. No propagar headers sensibles a un host diferent.

Connectors de serveis interns, com n8n o Prometheus a la mateixa VPS, utilitzen destinacions preconfigurades i allowlisted; no converteixen el panell en un proxy generic.

## Ingress i webhooks

- Endpoint especific per provider i instancia, amb identificador no predictible.
- Firma HMAC o mecanisme oficial verificada sobre raw body abans de parsejar.
- Timestamp i finestra curta contra replay.
- Event/provider ID com idempotency key amb unique constraint.
- Limits de body, content type i rate per connector.
- Processament asincron: validar, persistir inbox, respondre i executar al worker.
- Secrets de verificacio rotables amb finestra controlada de dues claus.
- Resposta no revela existencia de tenants, workflows o recursos.

## Crides sortints

- Timeouts de connect, headers i body.
- Retry amb exponential backoff i jitter només per errors transitoris.
- Pressupost maxim d'intents; estat dead-letter visible.
- Circuit breaker per dependencies degradades.
- Idempotency key del proveidor quan existeixi.
- Rate limiter per tenant, connector i proveidor.
- User-Agent identificable sense dades sensibles.
- TLS estricte; mTLS quan el proveidor ho requereixi.

## Dades

- Minimitzar camps enviats i rebuts.
- Mapatge explicit; no persistir payload complet per defecte.
- PII i prompts classificats abans de sortir del sistema.
- Logs només amb connector ID, operacio, status, latencia i error code redaccionat.
- Responses no fiables no es renderitzen com HTML ni s'executen.
- Fitxers segueixen la politica d'uploads abans de persistir-se.

## Credencials

- Xifrades per tenant i connector.
- Desxifrades just-in-time al worker.
- Mai retornades per API, UI, events, jobs o errors.
- Scopes de minim privilegi i comptes tecnics dedicats.
- `last_used_at`, `rotated_at`, expiracio i health separats.
- Revocacio immediata quan un connector es desactiva o es compromet.

## Aillament i operacions

- Connectors no importen repositoris interns fora dels ports aprovats.
- Cap execucio arbitraria de scripts, SQL, shell, SSH o Docker API.
- Operacions VPS son comandes tipades i allowlisted en un agent separat.
- n8n nomes via API, webhooks i metriques oficials; mai taules internes.
- Un connector fallit no bloqueja el core ni altres connectors.

## Contract tests obligatoris

- Configuracio invalida.
- Credential absent, expirada i rotada.
- Timeout, reset, 429, 5xx i resposta massa gran.
- DNS rebinding, redirect intern i IP privada bloquejada.
- Firma webhook invalida, replay i duplicat.
- Retry sense duplicar efectes.
- Cross-tenant i scopes insuficients.
- Redaccio de secrets en logs i errors.
- Desactivacio i circuit breaker.
