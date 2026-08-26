# Runbook - rotacio i recuperacio de secrets de plataforma

## Objectiu i registre

Rotar els secrets bootstrap sense exposar-ne el valor ni deixar una instal·lacio en un estat que
no es pugui recuperar. Cada execucio necessita un ticket d'operacio amb responsable, entorn,
classe de secret, inici i final, versio o fingerprint no reversible anterior i nou, comprovacions,
rollback i revocacio. No s'hi adjunten valors, captures de terminals ni sortides de processos.
Aquest ticket es l'evidencia d'auditoria de la rotacio.

Aquest runbook no substitueix `connector-key-rotation.md`: hi enllaca per a l'anell de claus. Les
credencials tenant-scoped es roten des de la superficie de connectors, no des d'aquest canal.

## Controls comuns

### Precondicions

1. Declarar una finestra, una persona executora i una segona persona que valida la revocacio.
2. Aturar deploys concurrents i comprovar que la release actual esta sana.
3. Confirmar que la copia anterior continua disponible al gestor extern i que el rollback ha
   estat assajat amb una dada de prova. No copiar el valor al ticket.
4. Generar el substitut al proveidor o amb un CSPRNG. No reutilitzar valors entre entorns.
5. Si s'usa Bitwarden, crear una versio nova del mateix secret immutable i conservar la revisio
   anterior durant la finestra; el manifest no canvia.

### Publicacio i validacio

1. Materialitzar una release de mounts nova amb `deploy-with-bitwarden.mjs` o el mecanisme
   equivalent de fitxers root-owned.
2. Desplegar per digest i esperar readiness d'API i worker.
3. Executar la comprovacio especifica de la classe abans de revocar res.
4. Registrar nomes IDs d'operacio, revisions externes, timestamps, resultat i actor.

### Rollback i tancament

Si readiness o la prova funcional fallen, restaurar els mounts anteriors i reconciliar la release
anterior. No revocar el valor vell. Quan la validacio es verda, revocar-lo al sistema d'origen,
repetir la prova negativa quan sigui possible i tancar el ticket. Una rotacio sense revocacio
confirmada queda oberta, no completada.

## `BETTER_AUTH_SECRET`

Better Auth rep una sola clau de signatura; Control Hub no implementa verificacio amb dues claus.
Canviar-la invalida els artefactes signats amb l'anterior i pot tancar sessions actives. Per tant
no existeix una rotacio transparent: es una finestra d'identitat anunciada i curta.

### Procediment

1. Verificar un login, MFA/passkey i recuperacio de contrasenya abans de la finestra.
2. Fer backup de PostgreSQL i conservar el mount anterior. El backup no substitueix la clau.
3. Anunciar que les sessions es poden tancar i bloquejar temporalment mutacions sensibles.
4. Generar almenys 32 bytes aleatoris i publicar-los com `BETTER_AUTH_SECRET_FILE` nomes a l'API.
5. Reiniciar l'API, comprovar readiness i iniciar una sessio nova amb MFA.
6. Validar que una cookie anterior ja no autoritza una peticio i que la sessio nova si.
7. Tancar la finestra i registrar l'hora a partir de la qual les sessions noves son valides.

**Rollback:** restaurar el mount i la release anterior. Les sessions creades durant l'intent poden
deixar de ser valides; comunicar un segon login. No alternar claus repetidament.

**Recuperacio:** si es perd la clau, publicar-ne una de nova i forcar un nou login de tothom. Les
dades d'empresa no es perden. Investigar l'abast si la causa es una possible filtracio.

## `CONNECTOR_KEY_RING`

La rotacio preventiva es additiva: clau nova activa, claus antigues nomes de lectura. Cada sobre
porta `key_id`; per aixo no es re-xifra cap fila en una rotacio ordinaria. Seguir íntegrament
`docs/runbooks/connector-key-rotation.md` i conservar base de dades i anell en canals separats.

Abans de retirar una clau, la consulta de totes les credencials — incloses revocades — ha de donar
zero files per aquell `key_id`. La validacio exigeix obrir un sobre antic i segellar-ne un de nou.
Si la clau s'ha filtrat, seguir el procediment d'incident del mateix runbook: rotar les credencials
al proveidor, reintroduir-les perquè quedin segellades amb la clau nova i només llavors retirar la
clau compromesa.

**Rollback:** tornar a l'anell sencer anterior; com que la rotacio preventiva no reescriu files,
els sobres continuen sent llegibles. **Recuperacio:** restaurar PostgreSQL i l'anell corresponent
des de canals separats i provar una lectura en un tenant de prova.

## Client secrets OAuth de Google i Microsoft

### Precondicions

- Confirmar al proveidor que el client admet dos secrets simultanis. Si no, programar una finestra
  amb pausa dels exchanges; no revocar primer.
- Conservar client ID, redirect URIs i scopes sense canvis. Canviar-los alhora invalida la prova.
- Tenir una integracio de prova; no usar el correu personal d'una persona com a smoke test.

### Procediment

1. Crear el secret nou al proveidor i actualitzar el mount Google o Microsoft.
2. Desplegar API i worker sense eliminar el secret anterior del proveidor.
3. Completar un authorization-code exchange nou amb PKCE des de la UI.
4. Executar una renovacio i una operacio read-only del connector; confirmar auditoria i absencia
   de `invalid_client`.
5. Revocar el secret anterior al proveidor i repetir una renovacio controlada.

**Rollback:** mentre el secret anterior sigui viu, restaurar el mount anterior. Despres de
revocar-lo, el rollback es crear un tercer secret, no intentar recuperar el valor revocat.

**Recuperacio:** si cap secret funciona, crear-ne un de nou, desplegar-lo i reconnectar només els
grants que el proveidor hagi invalidat. No esborrar tokens xifrats fins confirmar que no es poden
renovar.

## PostgreSQL

La instal·lacio actual usa el rol `control_hub_app`. PostgreSQL aplica un canvi de password a les
connexions noves; les connexions ja obertes poden continuar fins que es reciclen. La finestra de
solapament es, per tant, deliberada i curta, no dos passwords simultanis pel mateix rol.

### Procediment

1. Fer un backup verificat i comprovar una restauracio recent. Conservar el mount anterior.
2. Generar el password nou i canviar `control_hub_app` des d'una sessio administrativa amb una
   variable `psql`; no posar-lo a l'argument, historial o SQL literal.
3. Publicar alhora el nou `DATABASE_URL_FILE` per API/worker i `POSTGRES_APP_PASSWORD_FILE` per al
   contracte operatiu. Reiniciar API i worker per buidar pools antics.
4. Comprovar readiness, migracio en mode de verificacio, login, una lectura i una escriptura.
5. Confirmar que una connexio nova amb la credencial anterior falla i tancar connexions antigues
   de la release retirada.

**Rollback:** abans de tancar la finestra, tornar a assignar el password anterior al rol i
restaurar els mounts. Si hi ha sospita de fuga, no restaurar-lo: generar un tercer valor.

**Recuperacio:** el password d'aplicacio es reemplaçable amb acces administratiu. Si tambe es perd
l'acces admin, aplicar `disaster-recovery.md` sobre una instancia neta; no relaxar `pg_hba.conf` en
produccio per recuperar l'acces.

## SMTP autenticat

Control Hub no declara avui `SMTP_USERNAME` ni `SMTP_PASSWORD`: el transport local de Mailpit i la
configuracio actual no tenen credencial SMTP. Per tant no hi ha cap secret SMTP que S5 pugui rotar
ni es pot marcar aquesta prova com executada.

Quan s'aprovi SMTP autenticat, ha d'entrar primer a l'inventari, implementar `SMTP_PASSWORD_FILE`
i tenir contract tests. La rotacio seguira el patro del proveidor: crear credencial nova, publicar
el mount, enviar un missatge a una bústia de prova, confirmar recepcio a Mailpit/proveidor, revocar
l'anterior i repetir. El rollback conserva l'anterior fins a la prova; si el proveidor no permet
solapament, necessita finestra de manteniment.

## Token de machine account de Bitwarden

### Procediment

1. Crear un token nou per la mateixa machine account o una de substitucio amb **Can read** només
   sobre el projecte de la instal·lacio. Fixar una expiracio curta segons politica corporativa.
2. Sense revocar l'anterior, executar un deploy complet amb el token nou des del credential store
   del runner. No usar `--access-token` ni enganxar-lo al shell history.
3. Validar revisions recuperades, permisos dels mounts, readiness, login i operacio de connector.
4. Revocar el token anterior a Bitwarden i verificar que un fetch amb l'antic falla sense mostrar
   la resposta ni el token als logs.
5. Registrar machine account, projecte, ID/revisio de deploy, actor i revocacio; mai el token.

**Rollback:** abans de revocar, restaurar el token anterior al credential store i repetir el
deploy. Despres de revocar, crear un token nou; els tokens no es recuperen.

**Recuperacio:** si Bitwarden no respon, no desplegar. La release viva conserva els mounts. Usar
el break-glass només amb incident declarat, dues persones i evidencia; després rotar tots els
secrets que s'hagin materialitzat per aquell canal.

## Assaig trimestral

En un entorn aillat, executar una rotacio de cada classe aplicable i un rollback abans de
revocacio. Com a mínim una vegada l'any, restaurar PostgreSQL i el `CONNECTOR_KEY_RING` en una
instal·lacio neta. El resultat ha d'indicar durada, RPO/RTO observat, passos no aplicables i accions
correctores; mai valors secrets.
