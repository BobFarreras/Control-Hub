# Historic — Fase 5C: registre de jornada

> Text mogut tal qual des de `docs/development/current-state.md` (linies 367-450 de la
> versio anterior a la particio). No s'ha resumit ni reescrit res.

## Fase 5C: registre de jornada (en curs, branca `feature/phase-5c-attendance`)

Especificacio a `docs/specifications/attendance.md`, ampliada el 7 d'agost amb tres decisions del
propietari: **pauses configurables i apagades per defecte**, **cadascu corregeix el seu registre amb
motiu obligatori**, i **fitxar sortida estant en pausa es rebutja**. Govern de dades a
`docs/security/data-governance.md`.

Tot el modul viu darrere la flag `attendance`, apagada per defecte fins que la gestoria confirmi
que la forma del registre li serveix.

Implementat i committat:

- `packages/domain/src/attendance.ts`: sessions derivades del log, estat, pauses, correccions
  encadenades i conciliacio. Pur. Compta temps real transcorregut, aixi que una nit de canvi d'hora
  son cinc hores i no quatre, i una sessio oberta no val zero.
- `0019_attendance.sql` i `0020_attendance_permissions.sql`: log append-only. El rol de
  l'aplicacio te `select` i `insert` i res mes, aixi que un `update` rebota tambe amb SQL directe.
  Un event nomes es pot corregir un cop. **Avui res no pot esborrar un fitxatge**, ni passat el
  termini de retencio: la purga encara no existeix i el perque esta a `data-governance.md`.
- `packages/application/src/attendance.ts` i `packages/persistence/src/attendance-repository.ts`.
  Un fitxatge no envia `occurred_at`: els dos rellotges agafen el `now()` de la transaccio i
  surten iguals, que es el que distingeix un fitxatge d'una declaracio posterior.
- `apps/api/src/routes/attendance.ts`: sis rutes. Llegir el registre d'una altra persona queda
  auditat encara que qui ho fa hi tingui dret.
- `apps/web`: boto a la capcalera de totes les pantalles, pantalla `/attendance` amb el mes
  propi i l'historial complet, i `/attendance/team` amb la vista de tothom, l'exportacio Excel
  (una fila per persona i dia, amb entrada, sortida i hores en format decimal) i la conciliacio.

Verificat: **89 proves de domini, 82 d'aplicacio, 31 d'API, 11 d'integracio de l'esquema, 11 de
l'adaptador i 4 E2E autenticades noves**, aquestes ultimes executades contra la pila de verificacio.

### Increment 10 — Jornada amb calendari laboral (implementat, 9 d'agost de 2026)

L'increment 10 afegeix gestio de festius, vacances, absencies i bloquejos personals, mes una
vista de calendari accessible amb canvi taula/calendari.

**Canvis al model de dades:**
- `0025_attendance_calendar.sql`: taules `attendance_holidays`, `attendance_non_working_days`,
  `attendance_vacations`, `attendance_absences` i `attendance_blocks` amb RLS i claus foranes.
- `0026_attendance_permissions_calendar.sql`: permisos `attendance:holidays` i `attendance:vacations`
  per Owner i Administrator, amb backfill.

**Canvis al domini (`packages/domain/src/attendance.ts`):**
- Tipus nous: `AttendanceHoliday`, `AttendanceNonWorkingDay`, `AttendanceVacation`,
  `AttendanceAbsence`, `AttendanceBlock`, `AttendanceDayStatus`.
- Funcions: `isHoliday`, `isNonWorkingDay`, `isVacationDay`, `isAbsenceDay`, `hasBlockOverlap`,
  `deriveDayStatus`.

**Canvis a l'aplicacio (`packages/application/src/attendance.ts`):**
- Nous metodes al servei: `listHolidays`, `createHoliday`, `deleteHoliday`,
  `listNonWorkingDays`, `createNonWorkingDay`, `deleteNonWorkingDay`, `listVacations`,
  `listVacationsByMember`, `createVacation`, `updateVacationStatus`, `listAbsences`,
  `listAbsencesByMember`, `createAbsence`, `listBlocks`, `listBlocksByMember`, `createBlock`,
  `deleteBlock`.
- Nous metodes al repositori amb les seves implementacions a PostgreSQL.

**Canvis a l'API (`apps/api/src/routes/attendance.ts`):**
- Rutes noves: CRUD per a festius, dies no laborables, vacances, absencies i bloquejos.
- Auditoria per a totes les mutacions.

**Canvis a la UI:**
- `apps/web/src/app/[locale]/attendance/page.tsx`: navegacio de mes amb fletxes accessibles
  (`aria-label` i tooltip), sense textos "mes anterior/seguent". Canvi taula/calendari amb
  conservacio del mes a la URL.
- `apps/web/src/components/attendance-record.tsx`: components `TableView` i `CalendarView`.
  El calendari mostra estat diari, hores registrades i incidencies amb text descriptiu, sense
  representar nomes per color.
- `apps/web/src/app/styles.css`: estils per al calendari i el canvi taula/calendari.

**Canvis a i18n:**
- Nous textos per a festius, vacances, absencies, bloquejos i vista de calendari en ca, es i en.

**Proves:**
- 6 proves noves al domini (`packages/domain/src/attendance.test.ts`): festius, dies no
  laborables, vacances, absencies, bloquejos i derivacio d'estat diari.
- Mock del repositori actualitzat a `packages/application/src/attendance.test.ts`.

**Punts pendents:**
- La UI de gestio de festius, vacances, absencies i bloquejos encara no esta implementada
  (nomes les API i el domini).
- La vista de calendari no mostra encara festius, vacances ni absencies (nomes hores
  treballades i sessions obertes). Cal connectar-la amb les dades noves.
- La migracio 0025 i 0026 s'han de pujar a la base de dades de produccio.
