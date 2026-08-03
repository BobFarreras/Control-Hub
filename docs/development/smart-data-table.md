# Smart DataTable

`SmartDataTable` es el patro canonic per a llistats operatius de Control Hub.

## Contracte

- El servidor controla paginacio, ordenacio i filtres; el frontend no carrega datasets complets.
- Cada taula declara un `table_id` estable i una allowlist de columnes a l'API.
- Visibilitat, ordre, amplada i mida de pagina es persisteixen per tenant i usuari.
- Les preferencies no contenen dades empresarials ni poden alterar queries fora de les opcions declarades.
- Una columna marcada `locked` no es pot ocultar quan conte identitat o accions imprescindibles.
- En pantalles compactes la taula conserva semantica tabular i utilitza scroll horitzontal.

## Seguretat

`user_table_preferences` aplica RLS per tenant. `user_id` deriva de la sessio i mai del body. L'API rebutja `table_id`, columnes, amplades i mides de pagina no allowlisted.

## Integracio

La primera implementacio cobreix `crm.leads` i `crm.customers`. Nous moduls han d'afegir la seva allowlist backend, definir columnes amb renderers purs i exposar totals i paginacio des del repositori.
