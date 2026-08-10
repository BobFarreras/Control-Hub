import nodemailer from "nodemailer";

export type MailConfiguration = { host: string; port: number; secure: boolean; from: string };
export type MailSender = ReturnType<typeof createMailSender>;

export function createMailSender(configuration: MailConfiguration) {
  const transport = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return async (message: { to: string; subject: string; text: string }) => {
    await transport.sendMail({ from: configuration.from, ...message });
  };
}
