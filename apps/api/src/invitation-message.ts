export function invitationMessage(locale: "ca" | "es" | "en", url: string) {
  if (locale === "es")
    return {
      subject: "Control Hub - Invitacion",
      text: `Has recibido una invitacion a Control Hub. El enlace caduca en 48 horas: ${url}`
    };
  if (locale === "en")
    return {
      subject: "Control Hub - Invitation",
      text: `You have been invited to Control Hub. This link expires in 48 hours: ${url}`
    };
  return {
    subject: "Control Hub - Invitacio",
    text: `Has rebut una invitacio a Control Hub. L'enllac caduca en 48 hores: ${url}`
  };
}
