# Runbook - Disaster recovery

**Objectiu:** recuperar el core amb RPO <= 1 hora i RTO <= 4 hores.

## Precondicions

- Backup xifrat verificat fora de la VPS.
- Manifest de versions i checksums.
- Clau de desxifrat sota custodia separada.
- Imatges OCI disponibles per digest.
- DNS i credencials d'infraestructura accessibles.

## Procediment

1. Declarar incident, hora i responsable.
2. Preservar evidencia si existeix sospita de compromís.
3. Provisionar una VPS neta amb la versio certificada.
4. Instal·lar Docker Engine/Compose i configuracio base.
5. Restaurar secrets de plataforma des de custodia.
6. Restaurar PostgreSQL i object storage.
7. Desplegar exactament els digests del manifest.
8. Executar migracions nomes si el backup ho requereix.
9. Validar healthchecks, integritat, login, tenant scope i jobs.
10. Canviar transit/DNS i monitorar.
11. Documentar dades potencialment perdudes respecte l'RPO.

## Validacio mensual

- Restauracio en host net i aillat.
- Mesura de temps per pas.
- Smoke tests automatitzats.
- Comparacio de recomptes i checksums.
- Registre de resultat, desviacions i accions.

No es considera valid un backup que no s'ha pogut restaurar.
