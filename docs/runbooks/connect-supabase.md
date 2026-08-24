# Connectar un compte de Supabase

Que en treus: **quins projectes hi ha i si estan actius, pausats o en transicio**, llegit cada cinc
minuts. Que no fa, ara ni despres: **res que escrigui**. El connector no pausa, no restaura, no crea
ni esborra cap projecte, i no toca res de dins —cap taula, fila, funcio ni backup. Es una crida
`GET` i para.

Especificacio: `docs/specifications/connector-supabase.md`. Rotar el token:
`docs/runbooks/connector-key-rotation.md`.

## 1. Llegeix abans de fer res mes: aquest token no es de nomes lectura

**Un Personal Access Token de Supabase te el mateix privilegi que el teu compte.** No hi ha cap
abast reduit per triar al formulari del token: el mateix que llista projectes els pot pausar,
esborrar, tocar la facturacio i gestionar membres de l'organitzacio. No es un descuit nostre —es
com Supabase fa els PAT, i no hi ha manera d'evitar-ho amb un token d'aquest tipus.

El connector nomes crida `GET`: no hi ha cap cami de codi que hi faci un `POST`, `PATCH` o
`DELETE`. Pero si el token o el vault que el guarda es filtressin, qui el tingues podria pausar o
esborrar qualsevol projecte de l'organitzacio connectada. Es un risc acceptat, no resolt: la manera
de resoldre'l de veritat es OAuth2 amb l'abast `projects:read`, que encara no existeix (vegeu "Que
ve despres" mes avall).

Encunya el token a **Account, Access Tokens**, amb un nom que digui per a que es —per exemple
`control-hub-read`— i posa-li caducitat.

## 2. A Control Hub

**Integracions, Nova integracio, Supabase.**

| Camp | Que hi va |
|---|---|
| Nom | Com el vulguis veure a la llista. Per exemple `Supabase — Arrel Estudi` |
| Adreca | Ja ve posada i no es toca: `https://api.supabase.com` |
| Credencial `api_token` | El token del pas 1. S'escriu un cop i no es torna a llegir mai |

No hi ha cap camp d'organitzacio: el token ja nomes veu les organitzacions on el compte que el va
encunyar hi es, i aquesta empresa en te una de sola per disseny (un projecte Supabase per client).

Desa i mira la comprovacio de salut. Ha de dir que va.

## Si diu que no va

| Que diu | Que vol dir | Que has de fer |
|---|---|---|
| `unauthorized` | El token no val, o ha caducat | Encunya'n un de nou i rota'l |
| `forbidden` | El token es bo pero l'organitzacio no li respon | Comprova que el compte que el va encunyar encara hi es |
| `rate_limited` | Massa crides. No es teu: passara sol | Res |

## Que veuras avui, i que no

A **Infraestructura** hi trobaras la franja **Projectes Supabase**: una fila per projecte, amb la
regio, l'estat —actiu, inactiu, o en transicio quan Supabase encara l'esta movent d'un lloc a
l'altre—, quan es va crear i quan en vam llegir. Pots assignar-hi un client, igual que a un projecte
de Vercel: es la mateixa taula d'enllaç per sota, perque associar un projecte allotjat a un client
es la mateixa pregunta sigui quin sigui el proveidor.

**El que encara no hi ha es cap alerta.** Un projecte que es pausa es veu quan algu mira la
pantalla, no et ve a buscar: estendre les regles d'alerta a aquest cas es un increment a part.

## Que ve despres

Quan la plataforma OAuth2 arribi —pensada per al correu, no per aquest connector— Supabase hi pot
migrar a un token `projects:read` de veritat, i deixar de portar el privilegi que aquest document
avisa. Fins llavors, el risc de la seccio 1 es queda tal com es descriu.
