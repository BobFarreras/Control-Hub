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

La politica final RGPD i contractual s'aprovara abans de la primera release comercial.
