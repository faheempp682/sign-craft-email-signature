import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FetchError, checkUrl, fetchPage, type FetchOptions } from "./fetch-page";

/* A real local web server stands in for "the internet". The default guard would (correctly) refuse 127.0.0.1,
   so tests that need to reach it opt out of the address check and the port rule. The guard itself is tested below. */
const reachLocal: FetchOptions = { isAllowedAddress: () => true, allowAnyPort: true, timeoutMs: 3000 };

let server: http.Server;
let base: string;
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://x");
    const html = "<html><head><title>Hi</title></head><body><p>Jane Doe</p></body></html>";
    switch (url.pathname) {
      case "/ok":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
        break;
      case "/gzip":
        res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" }).end(zlib.gzipSync(html));
        break;
      case "/br":
        res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "br" }).end(zlib.brotliCompressSync(html));
        break;
      case "/latin1":
        res.writeHead(200, { "Content-Type": "text/html; charset=iso-8859-1" }).end(Buffer.from("<p>Jos\xe9</p>", "latin1"));
        break;
      case "/plain":
        res.writeHead(200, { "Content-Type": "text/plain" }).end("Jane Doe, Designer");
        break;
      case "/json":
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
        break;
      case "/pdf":
        res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4");
        break;
      case "/missing":
        res.writeHead(404, { "Content-Type": "text/html" }).end("nope");
        break;
      case "/redirect":
        res.writeHead(302, { Location: "/ok" }).end();
        break;
      case "/redirect-private":
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
        break;
      case "/redirect-loopback-ip":
        res.writeHead(302, { Location: "http://[::1]:1/" }).end();
        break;
      case "/redirect-file":
        res.writeHead(302, { Location: "file:///etc/passwd" }).end();
        break;
      case "/loop":
        res.writeHead(302, { Location: "/loop" }).end();
        break;
      case "/big": {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<p>" + "a".repeat(5000) + "</p>");
        break;
      }
      case "/bomb": {
        // 60 MB of zeros compresses to about 60 KB: a classic decompression bomb.
        res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024)));
        break;
      }
      case "/hang":
        break; // never answers
      default:
        res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  requests.length = 0;
  vi.restoreAllMocks();
});

const fail = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(FetchError);
  return err as FetchError;
};

describe("fetchPage: reading pages", () => {
  it("returns the HTML of a normal page", async () => {
    const r = await fetchPage(`${base}/ok`, reachLocal);
    expect(r.html).toContain("Jane Doe");
    expect(r.truncated).toBe(false);
    expect(r.url).toBe(`${base}/ok`);
  });

  it("decodes gzip and brotli responses", async () => {
    expect((await fetchPage(`${base}/gzip`, reachLocal)).html).toContain("Jane Doe");
    expect((await fetchPage(`${base}/br`, reachLocal)).html).toContain("Jane Doe");
  });

  it("honours the declared charset", async () => {
    expect((await fetchPage(`${base}/latin1`, reachLocal)).html).toContain("José");
  });

  it("accepts plain text", async () => {
    expect((await fetchPage(`${base}/plain`, reachLocal)).html).toContain("Designer");
  });

  it("follows a redirect", async () => {
    const r = await fetchPage(`${base}/redirect`, reachLocal);
    expect(r.url).toBe(`${base}/ok`);
    expect(r.html).toContain("Jane Doe");
  });

  it("adds https:// to a bare domain", () => {
    expect(checkUrl("acme.com/team").toString()).toBe("https://acme.com/team");
  });
});

describe("fetchPage: limits", () => {
  it("stops at the byte limit and says it was truncated", async () => {
    const r = await fetchPage(`${base}/big`, { ...reachLocal, maxBytes: 1000 });
    expect(r.truncated).toBe(true);
    expect(r.html.length).toBe(1000);
  });

  it("is not defeated by a decompression bomb: it stops reading after the byte limit", async () => {
    const started = Date.now();
    const r = await fetchPage(`${base}/bomb`, { ...reachLocal, maxBytes: 100_000 });
    expect(r.truncated).toBe(true);
    expect(r.html.length).toBe(100_000);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("gives up on a server that never answers", async () => {
    const err = await fail(fetchPage(`${base}/hang`, { ...reachLocal, timeoutMs: 300 }));
    expect(err.code).toBe("timeout");
  });

  it("stops redirect loops", async () => {
    const err = await fail(fetchPage(`${base}/loop`, { ...reachLocal, maxRedirects: 3 }));
    expect(err.code).toBe("too_many_redirects");
    expect(requests.filter((r) => r === "/loop").length).toBe(4); // the first request plus 3 redirects, then it gives up
  });
});

describe("fetchPage: content types and errors", () => {
  it("refuses non-page content", async () => {
    expect((await fail(fetchPage(`${base}/json`, reachLocal))).code).toBe("unsupported");
    expect((await fail(fetchPage(`${base}/pdf`, reachLocal))).code).toBe("unsupported");
  });

  it("reports an HTTP error with its status", async () => {
    const err = await fail(fetchPage(`${base}/missing`, reachLocal));
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(404);
  });

  it("reports a connection failure plainly", async () => {
    const err = await fail(fetchPage("http://127.0.0.1:1/", reachLocal));
    expect(err.code).toBe("network");
  });
});

describe("SSRF protection (default settings)", () => {
  it.each([
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/admin",
    "http://localhost/",
    "http://LOCALHOST:3000/",
    "http://foo.localhost/",
    "http://10.0.0.5/",
    "http://192.168.0.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://0.0.0.0/",
    "http://2130706433/", // 127.0.0.1 written as one decimal number
    "http://0x7f000001/", // ... in hex
    "http://0177.0.0.1/", // ... in octal
    "http://127.1/", // ... in short form
    "http://intranet/",
    "http://printer.local/",
    "http://db.internal/",
  ])("refuses %s before any network traffic", async (url) => {
    const err = await fail(fetchPage(url));
    expect(err.code).toBe("blocked");
  });

  it("refuses a real local server and never connects to it", async () => {
    const err = await fail(fetchPage(`${base}/ok`)); // 127.0.0.1 with a custom port, default settings
    expect(err.code).toBe("blocked");
    expect(requests).toHaveLength(0);
  });

  it("refuses a public-looking name that resolves to a private address (DNS rebinding / internal DNS)", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _opts: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => {
      cb(null, [{ address: "10.1.2.3", family: 4 }]);
    }) as unknown as typeof dns.lookup);
    const err = await fail(fetchPage("http://totally-public.example/"));
    expect(err.code).toBe("blocked");
    expect(lookup).toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("refuses when ANY resolved address is private, even if another one is public", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_host: string, _opts: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => {
      cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    }) as unknown as typeof dns.lookup);
    expect((await fail(fetchPage("http://mixed.example/"))).code).toBe("blocked");
  });

  it("refuses a redirect to the cloud metadata address", async () => {
    // Allow the first hop (our local server), but keep the real address rule for the redirect target.
    const err = await fail(fetchPage(`${base}/redirect-private`, { allowAnyPort: true, isAllowedAddress: (ip) => ip === "127.0.0.1" }));
    expect(err.code).toBe("blocked");
    expect(requests).toEqual(["/redirect-private"]);
  });

  it("refuses a redirect to an IPv6 loopback literal (only IPv4 127.0.0.1 is allowed for the first hop)", async () => {
    const err = await fail(fetchPage(`${base}/redirect-loopback-ip`, { allowAnyPort: true, isAllowedAddress: (ip) => ip === "127.0.0.1" }));
    expect(err.code).toBe("blocked");
    expect(requests).toEqual(["/redirect-loopback-ip"]); // the first hop was read, the redirect target was never contacted
  });

  it("refuses a redirect to a non-web scheme", async () => {
    const err = await fail(fetchPage(`${base}/redirect-file`, reachLocal));
    expect(err.code).toBe("invalid_url");
  });

  it.each([
    ["file:///etc/passwd", "invalid_url"],
    ["ftp://example.com/", "invalid_url"],
    ["javascript:alert(1)", "invalid_url"],
    ["data:text/html,<script>", "invalid_url"],
    ["http://user:pass@example.com/", "invalid_url"],
    ["https://example.com:8443/", "blocked"],
    ["http://example.com:22/", "blocked"],
    ["", "invalid_url"],
    ["http://", "invalid_url"],
  ])("rejects %j as %s", async (url, code) => {
    expect((await fail(fetchPage(url))).code).toBe(code);
  });

  it("allows an ordinary public address through validation", () => {
    expect(() => checkUrl("https://www.acme.com/team/jane?ref=1#bio")).not.toThrow();
    expect(checkUrl("https://acme.com/#top").hash).toBe("");
  });
});
