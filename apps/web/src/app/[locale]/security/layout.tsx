import { isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require-session";

export default async function SecurityLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  return children;
}
