import type { ProductCatalogDetail as ProductDetail } from "@/lib/api-types";

type Props = {
  detail: ProductDetail;
  labels: Record<string, string>;
  locale: string;
};

const formatMoney = (amountMinor: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);

export function ProductCatalogDetail({ detail, labels: t, locale }: Props) {
  return (
    <section className="product-detail-layout">
      <article className="product-detail-hero">
        <div>
          <span className="catalog-code">{detail.product.code}</span>
          <h2>{detail.product.name}</h2>
          <p>{detail.product.description || t.noProductDescription}</p>
        </div>
        <span className={`state state-${detail.product.status}`}>
          {t[detail.product.status] ?? detail.product.status}
        </span>
      </article>

      <div className="product-detail-summary" aria-label={t.offerStructure}>
        <article>
          <strong>{detail.versions.length}</strong>
          <span>{t.versions}</span>
        </article>
        <article>
          <strong>{detail.plans.length}</strong>
          <span>{t.plans}</span>
        </article>
        <article>
          <strong>{detail.prices.length}</strong>
          <span>{t.publishedOffers}</span>
        </article>
      </div>

      <section className="product-offer-tree">
        <h2>{t.offerStructure}</h2>
        {detail.versions.length === 0 ? <p className="crm-empty">{t.noVersions}</p> : null}
        {detail.versions.map((version) => {
          const plans = detail.plans.filter((plan) => plan.productVersionId === version.id);
          return (
            <article className="product-detail-version" key={version.id}>
              <header>
                <div>
                  <span>{t.version}</span>
                  <strong>{version.version}</strong>
                </div>
                <span className={`state state-${version.status}`}>{t[version.status] ?? version.status}</span>
              </header>
              {plans.length === 0 ? <p className="catalog-inline-empty">{t.noPlans}</p> : null}
              <div className="product-detail-plans">
                {plans.map((plan) => {
                  const prices = detail.prices.filter((price) => price.planId === plan.id);
                  return (
                    <article className="product-detail-plan" key={plan.id}>
                      <header>
                        <div>
                          <strong>{plan.name}</strong>
                          <small>{plan.code}</small>
                        </div>
                        <span className="catalog-model">{t[plan.commercialModel] ?? plan.commercialModel}</span>
                      </header>
                      <p>{plan.description || t.noProductDescription}</p>
                      <div className="product-detail-prices">
                        {prices.map((price) => (
                          <span className="price-chip" key={price.id}>
                            {formatMoney(price.amountMinor, price.currency, locale)} ·{" "}
                            {t[price.interval] ?? price.interval}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
