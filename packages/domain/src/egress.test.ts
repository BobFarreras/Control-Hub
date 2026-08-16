import { describe, expect, it } from "vitest";
import { classifyAddress, isAllowedEgressAddress, isOriginBoundHeader } from "./egress.js";

describe("addresses a connector may reach", () => {
  it("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isAllowedEgressAddress(address)).toBe(true);
    }
  });

  it("refuses the machine it is running on", () => {
    expect(classifyAddress("127.0.0.1")).toBe("loopback");
    expect(classifyAddress("127.255.255.254")).toBe("loopback");
    expect(classifyAddress("::1")).toBe("loopback");
    expect(classifyAddress("0.0.0.0")).toBe("unspecified");
    expect(classifyAddress("::")).toBe("unspecified");
  });

  it("refuses the private ranges the panel and the database live in", () => {
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.10", "fd00::1", "fc00::1"]) {
      expect(isAllowedEgressAddress(address)).toBe(false);
    }
    // The edges of 172.16/12, which is the range people get wrong.
    expect(classifyAddress("172.15.0.1")).toBe("public");
    expect(classifyAddress("172.32.0.1")).toBe("public");
  });

  it("refuses the cloud metadata service, which is the address that matters most", () => {
    expect(classifyAddress("169.254.169.254")).toBe("link_local");
    expect(classifyAddress("fe80::1")).toBe("link_local");
    expect(isAllowedEgressAddress("169.254.169.254")).toBe(false);
  });

  it("refuses carrier-grade NAT, multicast, documentation and reserved space", () => {
    expect(classifyAddress("100.64.0.1")).toBe("shared");
    expect(classifyAddress("224.0.0.1")).toBe("multicast");
    expect(classifyAddress("ff02::1")).toBe("multicast");
    expect(classifyAddress("192.0.2.1")).toBe("documentation");
    expect(classifyAddress("2001:db8::1")).toBe("documentation");
    expect(classifyAddress("255.255.255.255")).toBe("reserved");
    expect(classifyAddress("198.18.0.1")).toBe("reserved");
  });

  it("sees through an IPv4 address wearing an IPv6 costume", () => {
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyAddress("::ffff:169.254.169.254")).toBe("link_local");
    expect(classifyAddress("::ffff:7f00:1")).toBe("loopback");
    expect(classifyAddress("64:ff9b::10.0.0.1")).toBe("private");
    expect(classifyAddress("2002:7f00:0001::")).toBe("loopback");
    expect(classifyAddress("::ffff:1.1.1.1")).toBe("public");
  });

  it("refuses an octet spelled in a way the operating system would read differently", () => {
    // Every one of these is a real bypass against a parser that trusts Number().
    for (const address of ["0x7f.0.0.1", "127.1", "017700000001", "2130706433", " 127.0.0.1 x", "1.1.1.256"]) {
      expect(classifyAddress(address)).toBe("invalid");
    }
    expect(isAllowedEgressAddress("2130706433")).toBe(false);
  });

  it("refuses an address with a zone index rather than parsing it away", () => {
    expect(classifyAddress("fe80::1%eth0")).toBe("invalid");
  });

  it("calls anything it cannot parse invalid, which is never allowed", () => {
    for (const address of ["", "not-an-address", "example.com", "1:2:3:4:5:6:7:8:9", "::ffff::1"]) {
      expect(classifyAddress(address)).toBe("invalid");
      expect(isAllowedEgressAddress(address)).toBe(false);
    }
  });

  it("expands the compressed form the same way in either position", () => {
    expect(classifyAddress("2606:2800:220:1::")).toBe("public");
    expect(classifyAddress("::2")).toBe("public");
  });
});

describe("headers that must not follow a redirect", () => {
  it("names the ones that carry a credential, whatever their case", () => {
    expect(isOriginBoundHeader("Authorization")).toBe(true);
    expect(isOriginBoundHeader("COOKIE")).toBe(true);
    expect(isOriginBoundHeader("x-api-key")).toBe(true);
    expect(isOriginBoundHeader("accept")).toBe(false);
    expect(isOriginBoundHeader("user-agent")).toBe(false);
  });
});
