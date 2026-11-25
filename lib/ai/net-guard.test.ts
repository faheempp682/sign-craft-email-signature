import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./net-guard";

describe("isPublicAddress: IPv4", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "151.101.1.69", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1"])("allows public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback range"],
    ["10.0.0.1", "private 10/8"],
    ["10.255.255.255", "private 10/8 end"],
    ["172.16.0.1", "private 172.16/12"],
    ["172.31.255.255", "private 172.16/12 end"],
    ["192.168.1.1", "private 192.168/16"],
    ["169.254.169.254", "cloud metadata"],
    ["169.254.0.1", "link-local"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["100.127.255.255", "carrier-grade NAT end"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "this network"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast end"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
    ["192.0.2.1", "documentation"],
    ["198.18.0.1", "benchmarking"],
  ])("blocks %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("isPublicAddress: IPv6", () => {
  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e"])("allows public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["0:0:0:0:0:0:0:1", "loopback long form"],
    ["fe80::1", "link-local"],
    ["fe80::1%eth0", "link-local with zone"],
    ["fc00::1", "unique local"],
    ["fd12:3456:789a::1", "unique local fd"],
    ["ff02::1", "multicast"],
    ["fec0::1", "site-local"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    ["::ffff:7f00:1", "IPv4-mapped loopback, hex form"],
    ["64:ff9b::7f00:1", "NAT64"],
    ["2002:7f00:1::1", "6to4 embedding 127.0.0.1"],
    ["2001:db8::1", "documentation"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo"],
    ["[::1]", "bracketed loopback"],
  ])("blocks %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("allows an IPv4-mapped public address", () => {
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("isPublicAddress: not an IP", () => {
  it.each(["", "localhost", "example.com", "999.1.1.1", "1.2.3", "1.2.3.4.5", "not-an-ip", "::gggg"])("refuses %j", (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});
