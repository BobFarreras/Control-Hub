import { getCommerceDictionary, getDictionary, isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTopbar } from "@/components/page-topbar";
import { ProductCatalogDetail } from "@/components/product-catalog-detail";
import { getProductCatalogDetail } from "@/lib/commerce-data";
import { requireSession } from "@/lib/require-session";

export default async function ProductPage({ params }: { params: Promise<{ locale: string; productId: string }> }) {
  const { locale, productId } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const t = getDictionary(locale);
  const labels = getCommerceDictionary(locale);
  const detail = await getProductCatalogDetail(productId);
  if (!detail) notFound();

  return (
    <div className="app-shell">
      <AppSidebar locale={locale} labels={t.navigation} />
      <div className="workspace">
        <PageTopbar
          eyebrow={labels.eyebrow}
          title={detail.product.name}
          description={labels.productDetails}
          themeLabel={t.header.theme}
          back={{ label: t.header.back, fallbackHref: `/${locale}/products` }}
        />
        <main className="compact-main">
          <ProductCatalogDetail detail={detail} labels={labels} locale={locale} />
        </main>
      </div>
    </div>
  );
}
