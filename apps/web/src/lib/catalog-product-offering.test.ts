import { describe, expect, it } from "vitest";
import { catalogProductOffering } from "./catalog-product-offering";

describe("catalogProductOffering", () => {
  it("aggregates only relations belonging to the selected product", () => {
    const result = catalogProductOffering("product-a", {
      versions: [
        { id: "version-a", productId: "product-a" },
        { id: "version-b", productId: "product-b" }
      ],
      plans: [
        { id: "plan-a", productVersionId: "version-a" },
        { id: "plan-b", productVersionId: "version-b" }
      ],
      prices: [
        { id: "price-a", planId: "plan-a" },
        { id: "price-b", planId: "plan-b" }
      ]
    });

    expect(result.versions.map((item) => item.id)).toEqual(["version-a"]);
    expect(result.plans.map((item) => item.id)).toEqual(["plan-a"]);
    expect(result.prices.map((item) => item.id)).toEqual(["price-a"]);
  });
});
