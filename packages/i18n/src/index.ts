export const locales = ["ca", "es", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ca";

const dictionaries = {
  ca: {
    navigation: { label: "Navegacio principal", dashboard: "Dashboard", customers: "Clients", products: "Productes", subscriptions: "Subscripcions", support: "Suport", infrastructure: "Infraestructura", integrations: "Integracions", settings: "Configuracio" },
    header: { search: "Cerca global", healthy: "Sistema preparat", theme: "Canviar tema", language: "Idioma", account: "Compte" },
    dashboard: { eyebrow: "OPERACIONS EN TEMPS REAL", title: "Centre de control", description: "Visio unificada del negoci, serveis i automatitzacions.", revenue: "Ingressos recurrents", customers: "Clients actius", incidents: "Incidencies obertes", automations: "Automatitzacions", companyHealth: "Salut de l'empresa", activity: "Activitat recent", noData: "Les metriques apareixeran quan connectem les primeres fonts.", ready: "Fonaments preparats" }
    ,auth: { title: "Accedeix a Control Hub", subtitle: "Operacions, infraestructura i seguretat en un sol lloc.", email: "Correu electronic", password: "Contrasenya", signIn: "Iniciar sessio", otp: "Codi de verificacio", verify: "Verificar", forgot: "Has oblidat la contrasenya?", error: "No s'ha pogut iniciar la sessio.", resetTitle: "Restablir contrasenya", sendLink: "Enviar enllac", sent: "Si el compte existeix, rebras un correu.", newPassword: "Nova contrasenya", updatePassword: "Actualitzar contrasenya" },
    security: { title: "Seguretat del compte", secondFactor: "Segon factor", mfaDescription: "Activa TOTP per accedir als moduls protegits.", sessions: "Sessions actives", signOut: "Tancar sessio", revoke: "Revocar", currentPassword: "Contrasenya actual", enableTotp: "Activar TOTP", addPasskey: "Afegir passkey", unknownDevice: "Dispositiu desconegut", unknownIp: "IP desconeguda", backupCodes: "Codis de recuperacio" }
  },
  es: {
    navigation: { label: "Navegacion principal", dashboard: "Dashboard", customers: "Clientes", products: "Productos", subscriptions: "Suscripciones", support: "Soporte", infrastructure: "Infraestructura", integrations: "Integraciones", settings: "Configuracion" },
    header: { search: "Busqueda global", healthy: "Sistema preparado", theme: "Cambiar tema", language: "Idioma", account: "Cuenta" },
    dashboard: { eyebrow: "OPERACIONES EN TIEMPO REAL", title: "Centro de control", description: "Vision unificada del negocio, servicios y automatizaciones.", revenue: "Ingresos recurrentes", customers: "Clientes activos", incidents: "Incidencias abiertas", automations: "Automatizaciones", companyHealth: "Salud de la empresa", activity: "Actividad reciente", noData: "Las metricas apareceran al conectar las primeras fuentes.", ready: "Fundamentos preparados" }
    ,auth: { title: "Accede a Control Hub", subtitle: "Operaciones, infraestructura y seguridad en un solo lugar.", email: "Correo electronico", password: "Contrasena", signIn: "Iniciar sesion", otp: "Codigo de verificacion", verify: "Verificar", forgot: "Has olvidado la contrasena?", error: "No se ha podido iniciar sesion.", resetTitle: "Restablecer contrasena", sendLink: "Enviar enlace", sent: "Si la cuenta existe, recibiras un correo.", newPassword: "Nueva contrasena", updatePassword: "Actualizar contrasena" },
    security: { title: "Seguridad de la cuenta", secondFactor: "Segundo factor", mfaDescription: "Activa TOTP para acceder a los modulos protegidos.", sessions: "Sesiones activas", signOut: "Cerrar sesion", revoke: "Revocar", currentPassword: "Contrasena actual", enableTotp: "Activar TOTP", addPasskey: "Anadir passkey", unknownDevice: "Dispositivo desconocido", unknownIp: "IP desconocida", backupCodes: "Codigos de recuperacion" }
  },
  en: {
    navigation: { label: "Primary navigation", dashboard: "Dashboard", customers: "Customers", products: "Products", subscriptions: "Subscriptions", support: "Support", infrastructure: "Infrastructure", integrations: "Integrations", settings: "Settings" },
    header: { search: "Global search", healthy: "System ready", theme: "Change theme", language: "Language", account: "Account" },
    dashboard: { eyebrow: "REAL-TIME OPERATIONS", title: "Control center", description: "A unified view of business, services and automations.", revenue: "Recurring revenue", customers: "Active customers", incidents: "Open incidents", automations: "Automations", companyHealth: "Company health", activity: "Recent activity", noData: "Metrics will appear after the first sources are connected.", ready: "Foundations ready" }
    ,auth: { title: "Access Control Hub", subtitle: "Operations, infrastructure and security in one place.", email: "Email address", password: "Password", signIn: "Sign in", otp: "Verification code", verify: "Verify", forgot: "Forgot your password?", error: "Unable to sign in.", resetTitle: "Reset password", sendLink: "Send link", sent: "If the account exists, you will receive an email.", newPassword: "New password", updatePassword: "Update password" },
    security: { title: "Account security", secondFactor: "Second factor", mfaDescription: "Enable TOTP to access protected modules.", sessions: "Active sessions", signOut: "Sign out", revoke: "Revoke", currentPassword: "Current password", enableTotp: "Enable TOTP", addPasskey: "Add passkey", unknownDevice: "Unknown device", unknownIp: "Unknown IP", backupCodes: "Backup codes" }
  }
} as const;

export function isLocale(value: string): value is Locale { return locales.includes(value as Locale); }
export function getDictionary(locale: Locale) { return dictionaries[locale]; }
