# Runbook - Disaster recovery

**Objectiu:** recuperar el core amb RPO <= 1 hora i RTO <= 4 hores.

## Precondicions

- Backup xifrat verificat fora de la VPS.
- Manifest de versions i checksums.
- Clau de desxifrat sota custodia separada.
- Backup de PostgreSQL i copia versionada del `CONNECTOR_KEY_RING` en canals diferents.
- Imatges OCI disponibles per digest.
- DNS i credencials d'infraestructura accessibles.

## Procediment

1. Declarar incident, hora i responsable.
2. Preservar evidencia si existeix sospita de compromís.
3. Provisionar una VPS neta amb la versio certificada.
4. Instal·lar Docker Engine/Compose i configuracio base.
5. Restaurar els secrets de plataforma des de custodia al directori de mounts, sense copiar-los
   al checkout ni al backup ordinari.
6. Restaurar PostgreSQL i object storage des del canal de dades.
7. Recuperar el `CONNECTOR_KEY_RING` des del canal de claus, comprovar-ne el fingerprint esperat
   i muntar-lo nomes a API i worker.
8. Desplegar exactament els digests del manifest.
9. Executar migracions nomes si el backup ho requereix.
10. Validar healthchecks, login i tenant scope; executar una lectura xifrada de connector en un
    tenant de prova per demostrar que base i key ring corresponen.
11. Canviar transit/DNS i monitorar.
12. Documentar dades potencialment perdudes respecte l'RPO.

## Validacio mensual

- Restauracio en host net i aillat.
- Mesura de temps per pas.
- Smoke tests automatitzats.
- Comparacio de recomptes i checksums.
- Restauracio separada de dades i key ring, amb prova de desxifrat sense mostrar el valor.
- Registre de resultat, desviacions i accions.

No es considera valid un backup que no s'ha pogut restaurar.
