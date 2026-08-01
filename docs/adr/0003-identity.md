# ADR-0003 - Implementacio d'identitat

**Estat:** pendent de decisio

## Requisits

Correu/contrasenya, verificacio, TOTP, recovery codes, passkeys, sessions revocables, service accounts, rate limiting, reautenticacio i futura autoritzacio OAuth per MCP.

## Opcio recomanada - Better Auth integrat

- Runtime TypeScript dins l'API Fastify.
- Dades d'identitat al PostgreSQL de Control Hub.
- Integracio oficial Fastify.
- Plugins oficials per 2FA, passkeys i API keys.
- Menys contenidors, memoria i operacio.

Risc: el producte assumeix mes responsabilitat operativa sobre fluxos d'identitat i upgrades de la llibreria.

## Alternativa - Keycloak extern

- Servidor d'identitat independent amb OIDC/OAuth/SAML.
- TOTP, recovery codes, passkeys, identity brokering i federacio.
- Consola administrativa propia.

Risc: mes consum, backups, configuracio, branding i upgrades; duplica part de l'administracio d'usuaris per una instal·lacio inicial de dues persones.

## Criteri

Escollir Better Auth si es prioritza portabilitat i simplicitat. Escollir Keycloak si federacio empresarial i separacio completa d'identitat son requisits immediats.

## Controls independents de l'opcio

Control Hub conserva memberships, rols i permisos de domini. L'identity provider autentica; l'API autoritza. Cap rol de negoci depen exclusivament de claims externs no verificats.
