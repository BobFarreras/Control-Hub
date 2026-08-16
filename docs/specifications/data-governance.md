# Governanca i classificacio de dades

## Classes

| Classe | Exemples | Controls |
|---|---|---|
| Publica | Documentacio publica | Integritat |
| Interna | Metriques agregades, cataleg | Tenant scope |
| Confidencial | Clients, tickets, imports, costos | Xifrat, permisos, auditoria |
| Secreta | Tokens, claus, recovery codes | Xifrat fort, redaccio, acces minim |

## Regles

- Minimitzacio: no guardar dades que no tinguin finalitat definida.
- PostgreSQL guarda UTC, imports menors i moneda ISO 4217.
- PII no apareix a metriques; logs utilitzen identificadors o hashes quan sigui suficient.
- Exports requereixen permis i auditoria.
- Soft delete nomes quan existeix una necessitat de recuperacio; no substitueix eliminacio legal.
- Eliminacio de tenant es un workflow asincron, verificable i irreversible despres del periode de gracia.
- Backups hereten la classificacio mes alta de les dades contingudes.

## Retencio inicial

- Auditoria de seguretat: 365 dies.
- Logs d'aplicacio: 30 dies.
- Metriques tecniques detallades: 90 dies.
- Jobs completats: 30 dies, resum posterior quan sigui necessari.
- Dades de negoci: mentre existeixi relacio o obligacio definida.
- Registres estirats d'un proveidor (`connector_records`), per forma declarada al manifest del
  connector: `state` 30 dies sense tornar-lo a veure, `event` 90 dies. A mes, un sostre de 20.000
  files per operacio i instancia, que esborra les mes velles primer.

Els registres estirats son **una copia del que el proveidor diu ara**, no evidencia del que hem
fet nosaltres: per aixo caduquen, mentre que una execucio de connector o una entrada d'ingress no.
La caducitat de cada forma respon a una cosa diferent — un `state` caduca quan el proveidor deixa
d'anomenar-lo, un `event` perque es vell — i el sostre no es retencio sino un limit de dany: un
proveidor que hem llegit malament ha de fer soroll, no omplir la taula en silenci. La purga corre
cada hora al worker i **no depen de la flag `infrastructure`**, perque les files escrites mentre
estava oberta han de caducar encara que despres es tanqui.

La politica final RGPD i contractual s'aprovara abans de la primera release comercial.
