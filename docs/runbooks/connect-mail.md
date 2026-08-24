# Connectar correu entrant

Control Hub pot llegir una bustia de suport per IMAPS, Gmail o Microsoft 365. Els missatges
desconeguts entren a la safata pendent de classificacio; no es creen clients ni tickets de forma
automatica.

## Preparar OAuth a la instal·lacio

Les credencials de l'aplicacio OAuth son globals de cada instal·lacio i s'injecten com a secrets
del desplegament. No es desen al repositori ni es configuren per tenant.

### Google

1. Crear un client OAuth de tipus aplicacio web al projecte de Google Cloud i activar Gmail API.
2. Registrar exactament `https://control-hub.example/api/v1/integrations/oauth/callback/gmail`.
3. Concedir l'scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Injectar `GOOGLE_OAUTH_CLIENT_ID` i `GOOGLE_OAUTH_CLIENT_SECRET` a l'API i al worker.

### Microsoft

1. Registrar una aplicacio web al tenant de Microsoft Entra ID.
2. Registrar exactament
   `https://control-hub.example/api/v1/integrations/oauth/callback/microsoft_graph_mail`.
3. Afegir permisos delegats `Mail.Read`, `offline_access` i `openid`.
4. Injectar `MICROSOFT_OAUTH_CLIENT_ID` i `MICROSOFT_OAUTH_CLIENT_SECRET` a l'API i al worker.

`APP_ORIGIN` ha de coincidir amb l'origen public HTTPS. Els valors formen parelles: si hi ha un
identificador sense secret, o al reves, el worker refusa arrencar.

## Connectar una bustia

Amb `connectors,connector_oauth,mail` activades, crear una integracio Gmail o Microsoft 365,
obrir-ne la fitxa i prémer el boto de connexio. La fitxa mostra estat, scopes i dates, mai tokens.
Un `invalid_grant` deixa la connexio en `reauthorization_required` i cal repetir el consentiment.

Nomes es llegeix la safata d'entrada. No s'envia correu, ni es descarreguen adjunts, ni es
carreguen recursos HTML remots. La classificacio visual pertany a l'M4; mentrestant els missatges
queden persistits com `pending`.
