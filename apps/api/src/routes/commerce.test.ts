import type { CustomerContractRecord } from "@control-hub/application";
import { describe, expect, it } from "vitest";
import { customerServiceResponse } from "./commerce.js";

const service = {
  id: "service",
  amountMinor: 4900,
  costMinor: 900,
  taxBasisPoints: 2100
} as CustomerContractRecord;

describe("customer service API response", () => {
  it("does not send commercial amounts without financial permission", () => {
    expect(customerServiceResponse(service, false)).toEqual({ id: "service" });
  });

  it("groups commercial amounts when financial permission is present", () => {
    expect(customerServiceResponse(service, true)).toEqual({
      id: "service",
      financials: { amountMinor: 4900, costMinor: 900, taxBasisPoints: 2100 }
    });
  });
});
