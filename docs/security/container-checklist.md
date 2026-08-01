# Checklist de hardening de contenidors

Per cada servei de produccio:

- [ ] Imatge minima i fixada per digest.
- [ ] SBOM i scan sense vulnerabilitats bloquejants.
- [ ] Usuari numeric no-root.
- [ ] Root filesystem read-only.
- [ ] Temporals en `tmpfs` amb limits.
- [ ] `cap_drop: ALL`.
- [ ] `no-new-privileges`.
- [ ] Sense privileged, host network/PID/IPC o devices.
- [ ] Sense Docker socket.
- [ ] Mounts allowlisted i read-only quan sigui possible.
- [ ] Xarxes minimes.
- [ ] Cap port de dades public.
- [ ] Limits CPU, memoria i PIDs.
- [ ] Healthcheck sense secrets.
- [ ] Graceful shutdown.
- [ ] Secrets concedits nomes al servei necessari.
- [ ] Logs redaccionats.
- [ ] Backup i restore documentats per dades persistents.
