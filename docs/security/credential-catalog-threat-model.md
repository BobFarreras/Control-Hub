# Threat model del cataleg de credencials

**Estat:** aprovat per implementar (Fase 12 S7, 26 d'agost de 2026).

## Actius i actors

Actius: existencia i context de credencials, referencies Bitwarden, permisos, historial,
installation ID/key, backups i disponibilitat del vault. Els valors del vault no son actius de
Control Hub perquè no hi han d'entrar mai.

Actors: Owner, Administrator, Technical assignat, usuari Bitwarden, operador de VPS, API/worker,
atacant autenticat d'un altre tenant, browser compromes i atacant amb acces parcial al host.

## Fronteres

```text
Browser -- Internet -- Control Hub web/API -- PostgreSQL
   |                       |
   `---- Bitwarden web ----' (nomes navegacio; cap canal de valors)

VPS compartida: dos stacks i dades separats, pero un mateix kernel/root
VPS dedicada: frontera de host addicional
```

## Amenaces i controls

| Amenaca | Impacte | Controls preventius | Deteccio/prova |
| --- | --- | --- | --- |
| IDOR o consulta cross-tenant | Critic | tenant de sessio, repositori scoped, FK composta, RLS forçada | tests negatius amb dos tenants |
| Escalada per rol o assignacio | Critic | RBAC backend, deny by default, MFA i reauth | matriu de rols i auditoria de denegacions |
| Open redirect o URL manipulada | Alt | HTTPS, host exacte registrat, parser allowlisted, destinacio reconstruida | corpus d'URLs, DNS/IP i parametres hostils |
| Exfiltracio de referencia | Alt | xifrat contextual, no responses de lectura, `no-store`, redaccio | tests de logs, traces, errors i serialitzacio |
| Robatori per historial/browser | Alt | `noopener,noreferrer`, Referrer-Policy, cap secret a URL de Control Hub | E2E de headers i pestanya externa |
| CSRF o obertura involuntaria | Alt | POST, same-site, CSRF del contracte d'identitat, confirmacio explicita | tests sense token/origen valid |
| Clickjacking del vault | Alt | no iframe; respectar CSP del proveidor | test que cap component renderitza embed |
| Confondre `revoked` amb revocacio real | Alt | estat operatiu explicit i checklist/offboarding | alerta de conciliacio i UX diferenciada |
| Compromis de Control Hub | Critic | cap valor/master password, referencia insuficient sense Bitwarden auth | prova d'exfiltracio limitada |
| Compromis root de VPS compartida | Critic | stacks, xarxes, volums i backups separats; hardening; migracio prevista | alertes host i criteri de VPS dedicada |
| Bitwarden indisponible | Alt | cataleg read-only, sense fallback de valors | simulacre de caiguda |
| Backup robat | Critic | xifrat, claus i canals separats, acces minim | restauracio i inventari de copies |
| Insider autoritzat | Alt | minim privilegi, col·leccions Bitwarden, auditoria d'obertura, revisions | alertes per patrons i revisio periodica |
| Supply-chain Bitwarden | Critic | distribucio oficial, versions fixades, staging, SBOM/scans | gate d'actualitzacio i CVE |

## Inputs no fiables

- `base_url`: nomes HTTPS, sense credencials, query o fragment; host normalitzat i allowlisted;
- enllaç d'item: mida limitada, parser versionat, origen exacte i parametres coneguts;
- labels i cerca: longitud i Unicode validats, consultes parametritzades i output encoding;
- IDs de client, subscripcio i membre: mai autoritat per si sols; FK i tenant backend;
- paginacio i ordenacio: camps allowlisted i limits estrictes.

## Casos d'abus obligatoris

1. Un Technical canvia l'ID d'una fitxa per una d'un altre tenant.
2. Un Administrator intenta configurar una instal·lacio sense ser Owner.
3. Un usuari enganxa una URL Bitwarden amb host semblant, userinfo, port o encoding ambigu.
4. Un atacant substitueix ciphertext, nonce o `key_id` entre files.
5. Una sessio sense MFA o antiga intenta crear un open intent.
6. Un crawler o analytics captura la destinacio.
7. Bitwarden esta caigut i l'usuari demana una copia local.
8. Un membre desactivat a Control Hub encara existeix a Bitwarden, i a l'inreves.
9. Un backup de Control Hub es restaura sense el key ring correcte.
10. Root del host compartit intenta llegir ambdos stacks.

## Risc residual i gates

Compartir VPS conserva un blast radius de root/kernel que Docker no elimina. S'accepta nomes per
pilot sense credencials critiques, amb backups separats i criteris de migracio actius. Abans de
credencials de clients o produccio d'impacte alt, Owner i responsable de seguretat revisen la
migracio a VPS dedicada.

Un deep link revela l'identificador de l'item al browser autoritzat. No es un secret suficient per
obrir el vault, pero es metadata sensible; per aixo no es persisteix en histories, logs ni
analytics de Control Hub mes enlla del necessari per navegar.

Qualsevol integracio que permeti a l'API llegir items desxifrats, mantenir una sessio Bitwarden
desbloquejada o actuar en nom de tots els usuaris queda bloquejada fins a una ADR nova.
