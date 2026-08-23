import { UsagePage } from "@/components/usage-page";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return <UsagePage locale={(await params).locale} mode="budgets" />;
}
