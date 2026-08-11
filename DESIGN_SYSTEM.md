# Control Hub Design System

Aquest document es la font canonica per a la UI de Control Hub. Les captures i HTML de `stitch_avant_business_ecosystem/` son referencies visuals, no codi de produccio.

## Direccio visual

Control Hub utilitza un sol sistema visual amb dos temes equivalents:

- **Light - Luminous Precision:** superfícies clares, profunditat tonal, violeta per accions i teal per dades i salut.
- **Dark - Obsidian Flux:** superfícies fosques, geometria tecnica, cyan per salut i accions, blau/violeta per dades especialitzades.

La jerarquia, posicio, mida i comportament dels components no canvien entre temes. El tema nomes substitueix tokens visuals.

## Principis de producte

- Interfície operativa, densa i facil d'escanejar; no es una landing page.
- Informacio i accions abans que decoracio.
- Una mateixa gramatica visual a dashboard, CRM, tickets, infraestructura i connectors.
- Color mai com a unic indicador d'estat.
- Components estables: loading, errors o textos llargs no poden moure el layout.
- Cap card dins d'una altra card. Els panells de pagina son layouts, no cards decoratives.
- Glass i glow son accents limitats, no el fons de totes les superfícies.

## Tokens semantics

El codi consumeix noms semantics. No s'utilitzen colors hex directament als components.

| Token | Light | Dark | Us |
|---|---:|---:|---|
| `canvas` | `#f7f9fb` | `#0b0e14` | Fons de l'aplicacio |
| `surface` | `#ffffff` | `#10131a` | Panell principal |
| `surface-subtle` | `#f2f4f6` | `#191c22` | Controls i files |
| `surface-raised` | `#eceef0` | `#1d2026` | Hover i elements elevats |
| `text` | `#191c1e` | `#e1e2eb` | Text principal |
| `text-muted` | `#5f5969` | `#bac9cd` | Text secundari |
| `border` | `#d8d4df` | `#3b494c` | Separadors i focus de suport |
| `brand` | `#6b38d4` | `#00daf8` | Accio primaria i seleccio |
| `brand-contrast` | `#ffffff` | `#001f25` | Contingut sobre brand |
| `accent` | `#00687a` | `#b7c4ff` | Dades i accions secundaries |
| `success` | `#087a55` | `#52e0b0` | Estat correcte |
| `warning` | `#9a5b00` | `#ffbd66` | Advertencia |
| `danger` | `#ba1a1a` | `#ffb4ab` | Error i accio destructiva |
| `info` | `#00687a` | `#7bdff2` | Informacio |

S'han de generar variants de `hover`, `pressed`, `selected` i `subtle` mitjancant tokens, comprovant contrast WCAG AA. Els colors de marca de connectors nomes s'utilitzen en la seva icona o identificador.

## Tipografia

- **UI i titols:** Hanken Grotesk.
- **Text extens:** Hanken Grotesk; Inter nomes si les proves de llegibilitat ho justifiquen.
- **Dades:** JetBrains Mono per IDs, IPs, imports tabulars, metriques, timestamps i logs.

Escala base:

| Rol | Mida | Pes | Line-height |
|---|---:|---:|---:|
| Page title | 32px | 700 | 40px |
| Section title | 20px | 600 | 28px |
| Card title | 16px | 600 | 24px |
| Body | 16px | 400 | 24px |
| Compact body | 14px | 400 | 20px |
| Label | 13px | 600 | 16px |
| Data | 14px | 500 | 20px |

No s'escala la tipografia amb viewport width. Letter spacing es `0`; les labels uppercase no depenen d'un tracking negatiu.

## Layout

- Sidebar desktop: 264px; collapsible a 72px quan la densitat ho requereixi.
- Topbar: 64px estable.
- Contingut: `max-width: 1600px`, amb 24px de gutter desktop i 16px mobile.
- Grid: 12 columnes desktop, 8 tablet i 4 mobile.
- Espaiat: escala de 4px amb composicio principal en multiples de 8px.
- Panells: gaps de 12px o 16px segons densitat.
- Cards: radi maxim de 8px.

Breakpoints funcionals, no basats en dispositius concrets:

- `compact`: menys de 768px; sidebar substituida per navegacio mobile.
- `medium`: 768-1199px; grids reduits i panells apilables.
- `wide`: 1200px o mes; navegacio lateral i layouts densos.

Les taules no es transformen automaticament en cards. En compact utilitzen columnes prioritzades, scroll horizontal o vista de detall.

## Shell de l'aplicacio

La shell compartida conte:

- Identitat de Control Hub i tenant actiu.
- Navegacio principal per dominis.
- Cerca global.
- Salut general resumida.
- Notificacions.
- Selector d'idioma.
- Selector de tema.
- Menu d'usuari.

Desktop utilitza sidebar i topbar. Mobile utilitza topbar compacta i navegacio inferior o drawer; mai replica una sidebar desktop comprimida.

### Densitat operativa

- El context de pagina (`eyebrow`, titol i descripcio) viu sempre a la topbar compartida; no es repeteix com una capcalera dins del contingut.
- KPI, resums i accions principals comparteixen una franja compacta sempre que siguin comparables i hi hagi espai.
- Les sigles i metriques no evidents inclouen ajuda contextual accessible per hover i focus, traduida a `ca`, `es` i `en`.
- Les pantalles noves reutilitzen `PageTopbar`, `MetricHelp` i les franges de resum existents abans de crear variants locals.
- Les pantalles internes configuren el retorn de `PageTopbar`. El control conserva la navegacio
  real entre pantalles de Control Hub i utilitza una ruta pare segura quan la URL s'ha obert
  directament; no es creen enllacos locals de "tornar" dins del contingut.

## Components obligatoris

- Button: icon, primary, secondary, ghost i destructive.
- IconButton amb tooltip i accessible name.
- Input, textarea, select, combobox i date picker.
- Checkbox, switch, segmented control, slider i stepper.
- DataTable amb sort, filtres, paginacio, seleccio i empty state.
- Tabs per canviar vistes, no per executar accions.
- StatusIndicator amb icona, text i color.
- Metric, chart, timeline i activity feed.
- Dialog, drawer, popover, dropdown i toast.
- Skeleton, progress, empty, error i permission-denied states.
- ConnectorCard i HealthPanel com a components de domini reutilitzables.

S'utilitzaran icones Lucide. No s'introdueixen SVG manuals quan existeix una icona adequada.

## Estats

Tots els components de dades han de definir:

- Initial loading amb skeleton de mida estable.
- Refresh discret sense buidar la vista.
- Empty state amb una accio rellevant.
- Error recuperable amb retry.
- Permission denied diferenciat de not found.
- Stale/offline amb timestamp de l'ultima dada valida.
- Partial data quan falla un connector.

Estats de salut normalitzats:

```text
healthy | degraded | warning | failed | unknown | disabled
```

## Motion

El moviment comunica canvi d'estat o relacio espacial. No s'utilitza com a decoracio continua.

- Hover/focus: 120-160ms `ease-out`.
- Entrades de popover/dialog: 160-200ms.
- Canvis de layout: 200-240ms, nomes quan ajuden a seguir l'element.
- Press: escala maxima `0.98`; cards no salten 4px en una eina operativa.
- Status pulse: nomes durant connexio, sincronitzacio o incident actiu.
- Charts: transicio de dades fins a 300ms; sense reanimar en cada render.
- Marquee, glows pulsants permanents i parallax queden prohibits.

Amb `prefers-reduced-motion: reduce`, s'eliminen transformacions, pulses i animacions no essencials. Loading conserva una alternativa no animada.

## Dark i light mode

- Modes disponibles: `light`, `dark`, `system`.
- Primera visita: preferencia del sistema.
- Usuari autenticat: preferencia persistida al perfil.
- Abans d'hidratar, el servidor o script inicial aplica el tema per evitar flash.
- Charts, logos i recursos visuals han de tenir variants o colors semantics.
- El canvi de tema no reinicia formularis ni estat de pagina.

## Accessibilitat

- WCAG 2.2 AA com a objectiu minim.
- Navegacio completa per teclat i focus visible.
- Touch targets minims de 44x44px en dispositius touch.
- Semantica HTML abans d'ARIA.
- Icon-only buttons amb nom accessible i tooltip visual.
- Charts amb resum textual o taula equivalent.
- Errors de formulari associats al camp i resumits quan calgui.
- Zoom al 200% sense perdua de contingut o solapaments.

## Regles de contingut

- Text curt, factual i orientat a accions.
- No mostrar instruccions permanents sobre com usar la pantalla.
- Dates, imports i unitats es formategen segons locale.
- IDs i noms tecnics no es tradueixen.
- Labels i botons han de suportar expansio de text del 35% sense truncament injustificat.

## Validacio visual

Cada feature visual es valida com a minim en:

- Light i dark.
- Catala, castella i angles.
- 390x844, 768x1024, 1440x900 i 1920x1080.
- Teclat, zoom 200% i reduced motion.
- Loading, empty, error, partial i dades llargues.

Playwright ha de generar captures estables per les pantalles principals. Les regressions visuals s'han d'aprovar deliberadament.
