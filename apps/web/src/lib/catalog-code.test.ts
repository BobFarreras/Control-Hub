import { describe, expect, it } from "vitest";
import { toCatalogCode } from "./catalog-code";

describe("toCatalogCode", () => {
  it("creates stable ASCII codes from commercial names", () => {
    expect(toCatalogCode("Pàgina Web Pro", "product")).toBe("pagina-web-pro");
  });

  it("extends short names so they satisfy the catalog invariant", () => {
    expect(toCatalogCode("IA", "product")).toBe("ia-product");
  });
});
