export function catalogProductOffering<
  Version extends { id: string; productId: string },
  Plan extends { id: string; productVersionId: string },
  Price extends { id: string; planId: string }
>(productId: string, catalog: { versions: readonly Version[]; plans: readonly Plan[]; prices: readonly Price[] }) {
  const versions = catalog.versions.filter((version) => version.productId === productId);
  const versionIds = new Set(versions.map((version) => version.id));
  const plans = catalog.plans.filter((plan) => versionIds.has(plan.productVersionId));
  const planIds = new Set(plans.map((plan) => plan.id));
  const prices = catalog.prices.filter((price) => planIds.has(price.planId));
  return { versions, plans, prices };
}
