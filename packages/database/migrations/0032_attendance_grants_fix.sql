-- Increment 10: Correccio de grants per a vacances i absencies.
-- Els usuaris necessiten poder cancel·lar les seves pròpies vacances i absencies.

-- Afegir DELETE grant per a vacances (faltava).
grant delete on attendance_vacations to control_hub_app;

-- Afegir DELETE i UPDATE grants per a absencies (faltaven).
grant delete, update on attendance_absences to control_hub_app;
