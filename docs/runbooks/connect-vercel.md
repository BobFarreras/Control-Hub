# Connectar un compte de Vercel

Que en treus: **els projectes que hi ha i els desplegaments de produccio que han fallat**, llegits
cada cinc minuts. Que no fa, ara ni despres: **res que escrigui**. El connector no desplega, no
torna enrere, no pausa i no esborra. Es una crida `GET` i para.

Especificacio: `docs/specifications/connector-vercel.md`. Rotar el token:
`docs/runbooks/connector-key-rotation.md`.

## 1. Un token que nomes pugui llegir

Un token de Vercel **hereta el rol de qui l'ha encunyat**. Per aixo un token de nomes lectura no es
una opcio del formulari del token: es una propietat de qui el fa.

- **Equip**: convida un membre amb rol **Viewer** (o fes servir el que ja tinguis), entra amb aquell
  compte i encunya el token des d'alli. Un `Viewer` pot llegir projectes i desplegaments i no pot
  desplegar res.
- **Compte personal**: no hi ha rols, i el token pot fer tot el que pots fer tu. Val per a provar-ho;
  per a un client, val la pena el membre amb rol `Viewer`.

El token es a **Account Settings, Tokens**. Posa-li caducitat —un any com a molt— i abast a l'equip
que toca, no "tots".

## 2. L'identificador de l'equip

A **Team Settings, General**: comenca per `team_`. Copia'l tal qual.

**Si es d'equip i te'l deixes, no falla: no diu res.** La mateixa crida respon amb els projectes
personals de qui va encunyar el token, que son zero, i la pantalla diria "no hi ha res" quan la
resposta era "no ho has dit". Un compte personal, en canvi, el deixa buit i ja esta.

## 3. A Control Hub

**Integracions, Nova integracio, Vercel.**

| Camp | Que hi va |
|---|---|
| Nom | Com el vulguis veure a la llista. Per exemple `Vercel — Arrel Estudi` |
| Adreca | Ja ve posada i no es toca: `https://api.vercel.com` |
| Equip | El `team_...` del pas 2, o buit si es un compte personal |
| Incloure desplegaments de preview | Apagat. Mentre algu treballa, els seus previews peten sense parar |
| Hores de desplegaments a rellegir | 24, tret que vulguis mes historial la primera vegada |
| Credencial `api_token` | El token del pas 1. S'escriu un cop i no es torna a llegir mai |

Desa i mira la comprovacio de salut. Ha de dir que va.

## Si diu que no va

| Que diu | Que vol dir | Que has de fer |
|---|---|---|
| `unauthorized` | El token no val, o ha caducat | Encunya'n un de nou i rota'l |
| `forbidden` | El token es bo pero no arriba a aquest equip | Mira l'identificador de l'equip, i que el membre hi sigui |
| `not_found` | L'equip no existeix amb aquest identificador | Copia'l una altra vegada de Team Settings |
| `rate_limited` | Massa crides. No es teu: passara sol | Res |

## Que veuras avui, i que no

A **Infraestructura** hi trobaras la franja **Projectes desplegats**: una fila per projecte, amb el
domini de produccio, si produccio serveix, l'ultim build que va fallar —amb la branca i quan— i
quan en vam llegir. Pots assignar-hi un client, igual que a una automatitzacio.

**El que encara no hi ha es cap alerta.** Un build que peta es veu quan algu mira la pantalla, no
et ve a buscar: la regla `deployment_failed` es un increment a part i encara no existeix. Si vols
saber-ho abans, mira la pantalla el divendres a la tarda.
