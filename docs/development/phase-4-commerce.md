# Fase 4: productes, plans i subscripcions

## Abast implementat

- Cataleg tenant-scoped de productes, versions, plans i snapshots de preu.
- Imports enters, moneda ISO 4217, impostos en basis points i costos separats.
- Subscripcions vinculades a clients amb quantitat, renovacio i finestra d'alerta.
- Pausa, represa, cancel·lacio, canvi de pla i renovacio amb historial append-only.
- MRR, ARR, cost anual i marge anual agrupats per moneda.
- UI operativa responsive en `ca`, `es` i `en`, compatible amb light i dark.
- Permisos backend `products:manage`, `subscriptions:manage` i `financials:read` amb MFA.
- Subscripcions contractades per l'empresa separades de les subscripcions venudes a clients.
- Navegacio de Productes i Despeses amb submenus i rutes independents.
- Franges compactes de KPI i accions, amb ajuda contextual per MRR, ARR i marge.
- Preferencies de llistat persistides i dades representatives opcionals per desenvolupament.

## Regles operatives

Els preus publicats no s'editen. Per canviar un preu es publica un snapshot nou; les
subscripcions existents mantenen el snapshot contractat fins a un canvi de pla explicit.
Control Hub no prorrateja ni genera factures. Una renovacio avanca la data segons la
periodicitat utilitzant calendari UTC i limita correctament els finals de mes.

Les metriques nomes inclouen subscripcions actives i es presenten separades per moneda.
MRR s'arrodoneix una vegada despres d'agregar l'ARR de cada moneda.

## Desenvolupament local

1. Executar `pnpm db:migrate` per aplicar `0010_commerce.sql`, `0011_subscription_renewals.sql`, `0012_company_subscriptions.sql` i `0013_user_table_preferences.sql`.
2. Iniciar el projecte amb `pnpm dev`.
3. Obrir `http://localhost:3001/ca/products` amb un Owner o Administrator amb MFA. Les subscripcions venudes son a `/ca/products/customer-subscriptions` i les contractades per l'empresa a `/ca/expenses/subscriptions`.
4. Crear producte, versio, pla i preu, en aquest ordre.
5. Crear una subscripcio per a un client existent i validar metriques i alertes.

Les proves d'integracio necessiten `TEST_DATABASE_URL` i `TEST_DATABASE_ADMIN_URL` sobre
una base de dades migrada i exclusiva de test.
