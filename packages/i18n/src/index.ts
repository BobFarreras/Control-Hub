export const locales = ["ca", "es", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ca";

const dictionaries = {
  ca: {
    navigation: { label: "Navegacio principal", dashboard: "Dashboard", customers: "Clients", products: "Productes", subscriptions: "Subscripcions", support: "Suport", infrastructure: "Infraestructura", integrations: "Integracions", settings: "Configuracio" },
    header: { search: "Cerca global", healthy: "Sistema preparat", theme: "Canviar tema", language: "Idioma", account: "Compte" },
    dashboard: { eyebrow: "OPERACIONS EN TEMPS REAL", title: "Centre de control", description: "Visio unificada del negoci, serveis i automatitzacions.", revenue: "Ingressos recurrents", customers: "Clients actius", incidents: "Incidencies obertes", automations: "Automatitzacions", companyHealth: "Salut de l'empresa", activity: "Activitat recent", noData: "Les metriques apareixeran quan connectem les primeres fonts.", ready: "Fonaments preparats" }
  },
  es: {
    navigation: { label: "Navegacion principal", dashboard: "Dashboard", customers: "Clientes", products: "Productos", subscriptions: "Suscripciones", support: "Soporte", infrastructure: "Infraestructura", integrations: "Integraciones", settings: "Configuracion" },
    header: { search: "Busqueda global", healthy: "Sistema preparado", theme: "Cambiar tema", language: "Idioma", account: "Cuenta" },
    dashboard: { eyebrow: "OPERACIONES EN TIEMPO REAL", title: "Centro de control", description: "Vision unificada del negocio, servicios y automatizaciones.", revenue: "Ingresos recurrentes", customers: "Clientes activos", incidents: "Incidencias abiertas", automations: "Automatizaciones", companyHealth: "Salud de la empresa", activity: "Actividad reciente", noData: "Las metricas apareceran al conectar las primeras fuentes.", ready: "Fundamentos preparados" }
  },
  en: {
    navigation: { label: "Primary navigation", dashboard: "Dashboard", customers: "Customers", products: "Products", subscriptions: "Subscriptions", support: "Support", infrastructure: "Infrastructure", integrations: "Integrations", settings: "Settings" },
    header: { search: "Global search", healthy: "System ready", theme: "Change theme", language: "Language", account: "Account" },
    dashboard: { eyebrow: "REAL-TIME OPERATIONS", title: "Control center", description: "A unified view of business, services and automations.", revenue: "Recurring revenue", customers: "Active customers", incidents: "Open incidents", automations: "Automations", companyHealth: "Company health", activity: "Recent activity", noData: "Metrics will appear after the first sources are connected.", ready: "Foundations ready" }
  }
} as const;

export function isLocale(value: string): value is Locale { return locales.includes(value as Locale); }
export function getDictionary(locale: Locale) { return dictionaries[locale]; }
