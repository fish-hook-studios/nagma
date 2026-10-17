// SAML sign-in for teams (refusals, RelayState, replay) and server-side fetches (link previews and
// SAML metadata URLs) that must never reach private, loopback or link-local addresses.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { safeRelayPath } from "../saml.mjs";
import { call, signUp, startServer } from "./helpers.mjs";

// A throwaway self-signed certificate (public part only) for an identity provider that signs nothing.
const IDP_CERT = `-----BEGIN CERTIFICATE-----
MIIDITCCAgmgAwIBAgIUWg0LXmkh0BvNQ5lhO4fwt+lXLGYwDQYJKoZIhvcNAQEL
BQAwHzEdMBsGA1UEAwwUdGVzdC1pZHAuZXhhbXBsZS5vcmcwIBcNMjYxMDE1MDMw
NTE3WhgPMjEyNjA5MjEwMzA1MTdaMB8xHTAbBgNVBAMMFHRlc3QtaWRwLmV4YW1w
bGUub3JnMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoNeiIntpnE6d
PgsFbpgUJZfRB/oph4VQKE4z+IgxOwefO+hAuS6vavyEGUpD7FjBFTh7Oa6498K/
PZBh98PfT4NnfUQxy/VYtpSOsKd/87gBkqv1gcKrHVYOH8pVtSc1VE1ZG8CWjtva
CdAFdRQMUtVhh3OonPonQiBTbM6oRG4h9eLaiPUNauSIYXR4zCFfRpSklKTze5l9
iwinz10sElk7k1NgHTSoaeAYG75bis29gyzse83Q8OBRgZKFbLHoWwPP5b+txGpQ
9AB6/XFLRzXRQtwicAMYdRH+poTLpQmXHaIwKL2IS3y6hnq2EPW4wjwcJ+RgKNw1
xScQShR3dwIDAQABo1MwUTAdBgNVHQ4EFgQUlVX4fq7nScZH13qRps5GNKhpfcsw
HwYDVR0jBBgwFoAUlVX4fq7nScZH13qRps5GNKhpfcswDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEAb4Ys2L6MBavnmFoGC6eUvLEbuGhF6KNdmRTO
uX6IEDeaxiuLzwzfV/Seutjrcsy0F3Dl9SqKfgrz4DhvDDrANPrX26sNQLRFCv/c
V5/3i7XcxnXy+B2zE0k77jFH1fR/GIssJszNebneuGYTqZ0ClA7AEU5q4FI+MfDY
JTEQomxcQxGqAaTOGLskpsOdhil9iEGrDmidmJ1+fHBJ//0A6kHuZun+486usYAe
6wVVetge7dtxRvOVv2/DNDo2hq3muojhV3j0XYMSjDInyqGrPc7fqzdb0YzZ2tc8
pHhTO8u32qbSxxxLePsbqFxboOyj+jMOFdqAiXgCiPZE4GFWhQ==
-----END CERTIFICATE-----`;

const form = (fields) => ({ raw: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

// Addresses no server-side fetch may reach, in the spellings that slip past naive checks.
const PRIVATE_URLS = [
    "http://127.0.0.1/",
    "http://127.0.0.1:80/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://0.0.0.0/",
    "http://localhost/",
    "http://localhost./",
    "http://LOCALHOST/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://10.0.0.1/",
    "http://172.16.5.4/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[fec0::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[ff02::1]/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://example.com:8080/",
    "http://user:pass@example.com/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
    "javascript:alert(1)",
    "not a url",
    "",
];

describe("server-side fetches refuse private addresses", () => {
    let server, a, teamId;
    before(async () => {
        server = await startServer();
        a = await signUp(server, "Fetcher");
        teamId = (await call(server, "POST", "/teams", { token: a.token, body: { name: "SSRF team" } })).body.id;
    });
    after(async () => server?.stop());

    test("link previews need an account", async () => {
        assert.equal((await call(server, "GET", `/unfurl?url=${encodeURIComponent("https://example.com/")}`)).status, 401);
    });

    // Regression: IPv6 forms of private IPv4 addresses (::ffff:7f00:1 as the URL parser writes
    // ::ffff:127.0.0.1, NAT64, 6to4, IPv4-compatible) and parts of the private IPv6 ranges (fe80::/10
    // beyond fe80, fec0::/10, multicast) were treated as public, and IP literals skip the DNS check.
    test("link previews: every private spelling is refused before any request", async () => {
        for (const url of PRIVATE_URLS) {
            const r = await call(server, "GET", `/unfurl?url=${encodeURIComponent(url)}`, { token: a.token });
            assert.equal(r.status, 400, `${url}: ${r.status} ${r.text}`);
        }
        assert.ok(server.alive());
    });

    test("SAML metadata URLs: every private spelling is refused", async () => {
        for (const url of PRIVATE_URLS.filter(Boolean)) {
            const r = await call(server, "POST", `/teams/${teamId}/saml/metadata`, { token: a.token, body: { url } });
            assert.equal(r.status, 400, `${url}: ${r.status}`);
            assert.match(r.body.error, /can't be fetched|public/, url);
        }
        // Nothing was stored.
        const s = await call(server, "GET", `/teams/${teamId}/saml`, { token: a.token });
        assert.equal(s.body.enabled, false);
        assert.equal(s.body.ssoUrl, "");
    });

    test("SAML metadata XML with a DOCTYPE (entity expansion) is refused", async () => {
        const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><EntityDescriptor entityID="&b;"/>`;
        const r = await call(server, "POST", `/teams/${teamId}/saml/metadata`, { token: a.token, body: { xml } });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /DOCTYPE/);
        const ext = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>`;
        assert.equal((await call(server, "POST", `/teams/${teamId}/saml/metadata`, { token: a.token, body: { xml: ext } })).status, 400);
    });
});

describe("SAML sign-in refusals", () => {
    let server, admin, team, other;
    before(async () => {
        server = await startServer({ NAGMA_PUBLIC_URL: "http://nagma.test" });
        admin = await signUp(server, "SAML admin");
        team = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "SAML team" } })).body;
        other = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "No SAML" } })).body;
        const r = await call(server, "PUT", `/teams/${team.id}/saml`, { token: admin.token, body: { domains: "corp.example", ssoUrl: "https://idp.example.org/sso", idpEntityId: "https://idp.example.org", cert: IDP_CERT, enabled: true } });
        assert.equal(r.status, 200, r.text);
    });
    after(async () => server?.stop());

    test("turning SAML on needs a URL, a certificate and a domain; bad values are refused", async () => {
        const t = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "Half set up" } })).body;
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { enabled: true } })).status, 400);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { ssoUrl: "http://idp.example.org/sso" } })).status, 400);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { ssoUrl: "javascript:alert(1)" } })).status, 400);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { cert: "not a cert" } })).status, 400);
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { domains: "not_a_domain" } })).status, 400);
        // A domain another team signs in can't be taken.
        assert.equal((await call(server, "PUT", `/teams/${t.id}/saml`, { token: admin.token, body: { domains: "corp.example" } })).status, 400);
    });

    test("sign in with SSO routes by email domain", async () => {
        const saml = await call(server, "GET", "/auth/sso?email=someone@corp.example");
        assert.equal(saml.body.method, "saml");
        const none = await call(server, "GET", "/auth/sso?email=someone@elsewhere.example");
        assert.equal(none.body.method, null);
        assert.equal((await call(server, "GET", "/auth/saml/start?domain=elsewhere.example")).status, 404);
    });

    test("the sign-in request goes to the IdP; a return address on another origin becomes /", async () => {
        for (const [ret, relay] of [["/files?x=1", "/files?x=1"], ["https://evil.example/", "/"], ["//evil.example/", "/"], ["/\\evil.example", "/"], ["javascript:alert(1)", "/"], ["/ok\nSet-Cookie: x", "/"]]) {
            const r = await call(server, "GET", `/auth/saml/start?domain=corp.example&return=${encodeURIComponent(ret)}`);
            assert.equal(r.status, 302);
            const to = new URL(r.headers.get("location"));
            assert.equal(to.origin, "https://idp.example.org");
            assert.equal(to.searchParams.get("RelayState"), relay, ret);
            assert.ok(to.searchParams.get("SAMLRequest"));
        }
    });

    test("the ACS refuses garbage, unsigned and misaddressed responses, unknown teams and teams without SAML", async () => {
        const acs = `/auth/saml/${team.id}/acs`;
        assert.equal((await call(server, "POST", acs, form({}))).status, 400);
        for (const SAMLResponse of ["garbage", Buffer.from("<not-xml").toString("base64"), Buffer.from("<Response/>").toString("base64"), "%%%"]) {
            const r = await call(server, "POST", acs, form({ SAMLResponse }));
            assert.equal(r.status, 401, SAMLResponse);
            assert.match(r.text, /Sign-in failed/);
            assert.equal(r.headers.get("location"), null);
        }
        const now = new Date().toISOString();
        const later = new Date(Date.now() + 5 * 60_000).toISOString();
        const unsigned = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" Version="2.0" IssueInstant="${now}" Destination="http://nagma.test${acs}"><saml:Issuer>https://idp.example.org</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_a1" Version="2.0" IssueInstant="${now}"><saml:Issuer>https://idp.example.org</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">boss@corp.example</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later}" Recipient="http://nagma.test${acs}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${now}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>http://nagma.test/auth/saml/${team.id}/metadata</saml:Audience></saml:AudienceRestriction></saml:Conditions></saml:Assertion></samlp:Response>`;
        const r = await call(server, "POST", acs, form({ SAMLResponse: Buffer.from(unsigned).toString("base64"), RelayState: "/" }));
        assert.equal(r.status, 401);
        assert.equal(r.headers.get("location"), null);
        const elsewhere = unsigned.replace(`Destination="http://nagma.test${acs}"`, 'Destination="https://other.example/acs"');
        const d = await call(server, "POST", acs, form({ SAMLResponse: Buffer.from(elsewhere).toString("base64") }));
        assert.equal(d.status, 401);
        assert.match(d.text, /meant for somewhere else/);
        // No account was made for the unsigned assertion's email.
        assert.equal((await call(server, "POST", "/auth/signup", { body: { name: "Boss", email: "boss@corp.example", password: "longenough1" } })).status, 200);
        assert.equal((await call(server, "POST", "/auth/saml/nosuchteam1/acs", form({ SAMLResponse: "x" }))).status, 404);
        assert.equal((await call(server, "POST", `/auth/saml/${other.id}/acs`, form({ SAMLResponse: "x" }))).status, 400);
        const big = await call(server, "POST", acs, form({ SAMLResponse: "A".repeat(1_100_000) }));
        assert.equal(big.status, 413);
        assert.ok(server.alive());
    });

    test("error pages escape what they show", async () => {
        const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"><x/></samlp:Response>`;
        const r = await call(server, "POST", `/auth/saml/${team.id}/acs`, form({ SAMLResponse: Buffer.from(xml).toString("base64") }));
        assert.equal(r.status, 401);
        assert.ok(!r.text.includes("<script>"));
        assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
    });

    test("SP metadata is served for real teams only", async () => {
        const m = await call(server, "GET", `/auth/saml/${team.id}/metadata`);
        assert.equal(m.status, 200);
        assert.match(m.text, /AssertionConsumerService/);
        assert.match(m.text, new RegExp(`/auth/saml/${team.id}/acs`));
        assert.equal((await call(server, "GET", "/auth/saml/nosuchteam1/metadata")).status, 404);
    });

    test("safeRelayPath: paths on this origin only", () => {
        const table = [
            ["/", "/"],
            ["/files?id=1", "/files?id=1"],
            ["/a/../b", "/b"],
            ["https://evil.example/", "/"],
            ["http:/evil.example", "/"],
            ["//evil.example", "/"],
            ["///evil.example", "/"],
            ["/\\evil.example", "/"],
            ["\\\\evil.example", "/"],
            ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
            ["javascript:alert(1)", "/"],
            ["/x\r\nLocation: https://evil.example", "/"],
            ["/x\u0000", "/"],
            ["", "/"],
            [null, "/"],
            [undefined, "/"],
            [{ toString: () => "//evil.example" }, "/"],
            [`/${"a".repeat(2000)}`, "/"],
        ];
        for (const [input, out] of table) assert.equal(safeRelayPath(input), out, String(input));
    });
});

// The whole sign-in with a real signature: an identity provider made here (openssl for its
// certificate) signs assertions for this server. Skipped where openssl isn't installed.
let openssl = true;
try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
    openssl = false;
}

describe("SAML sign-in with signed assertions", { skip: openssl ? false : "openssl isn't installed" }, () => {
    let server, admin, team, key, cert, dir, SignedXml;
    const ACS = () => `http://nagma.test/auth/saml/${team.id}/acs`;
    before(async () => {
        ({ SignedXml } = await import("xml-crypto"));
        dir = await mkdtemp(join(tmpdir(), "nagma-idp-"));
        execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "idp.key"), "-out", join(dir, "idp.crt"), "-subj", "/CN=idp.corp.example", "-days", "2"], { stdio: "ignore" });
        key = await readFile(join(dir, "idp.key"), "utf8");
        cert = await readFile(join(dir, "idp.crt"), "utf8");
        server = await startServer({ NAGMA_PUBLIC_URL: "http://nagma.test" });
        admin = await signUp(server, "Admin");
        team = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "Signed" } })).body;
        const r = await call(server, "PUT", `/teams/${team.id}/saml`, { token: admin.token, body: { domains: "corp.example", ssoUrl: "https://idp.corp.example/sso", idpEntityId: "https://idp.corp.example", cert, enabled: true } });
        assert.equal(r.status, 200, r.text);
    });
    after(async () => {
        await server?.stop();
        if (dir) await rm(dir, { recursive: true, force: true });
    });

    // Starts a sign-in and returns the request ID the server is waiting for.
    async function requestId(ret = "/") {
        const r = await call(server, "GET", `/auth/saml/start?domain=corp.example&return=${encodeURIComponent(ret)}`);
        const xml = inflateRawSync(Buffer.from(new URL(r.headers.get("location")).searchParams.get("SAMLRequest"), "base64")).toString("utf8");
        return /ID="([^"]+)"/.exec(xml)[1];
    }

    function response({ inResponseTo, email = "worker@corp.example", assertionId = `_a${randomUUID()}`, recipient = ACS(), audience = `http://nagma.test/auth/saml/${team.id}/metadata`, issuer = "https://idp.corp.example", sign = true }) {
        const now = new Date(Date.now() - 1000).toISOString();
        const later = new Date(Date.now() + 5 * 60_000).toISOString();
        const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${later}" Recipient="${recipient}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${now}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion>`;
        let signed = assertion;
        if (sign) {
            const sig = new SignedXml({ privateKey: key, canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#", signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
            sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
            sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } });
            signed = sig.getSignedXml();
        }
        const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${ACS()}" InResponseTo="${inResponseTo}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`;
        return Buffer.from(xml).toString("base64");
    }

    test("a signed assertion signs in, joins the team as a viewer and keeps RelayState on this origin", async () => {
        const id = await requestId("/files?x=1");
        const r = await call(server, "POST", `/auth/saml/${team.id}/acs`, form({ SAMLResponse: response({ inResponseTo: id }), RelayState: "https://evil.example/steal" }));
        assert.equal(r.status, 302, r.text);
        const to = new URL(r.headers.get("location"));
        assert.equal(to.origin, "http://nagma.test");
        assert.equal(to.pathname, "/");
        const token = /sso=([A-Za-z0-9_-]+)/.exec(to.hash)[1];
        const me = await call(server, "GET", "/auth/me", { token });
        assert.equal(me.body.email, "worker@corp.example");
        const t = await call(server, "GET", `/teams/${team.id}`, { token });
        assert.equal(t.body.role, "view");
    });

    test("the same response twice is refused (replay)", async () => {
        const id = await requestId();
        const body = response({ inResponseTo: id });
        assert.equal((await call(server, "POST", `/auth/saml/${team.id}/acs`, form({ SAMLResponse: body }))).status, 302);
        const again = await call(server, "POST", `/auth/saml/${team.id}/acs`, form({ SAMLResponse: body }));
        assert.equal(again.status, 401);
        assert.match(again.text, /already used/);
    });

    test("refused: a request the server didn't make, the wrong recipient, audience, issuer or domain, a tampered or unsigned assertion", async () => {
        const cases = [
            ["unknown request", async () => response({ inResponseTo: "_never-asked" })],
            ["wrong recipient", async () => response({ inResponseTo: await requestId(), recipient: "https://other.example/acs" })],
            ["wrong audience", async () => response({ inResponseTo: await requestId(), audience: "https://other.example/sp" })],
            ["wrong issuer", async () => response({ inResponseTo: await requestId(), issuer: "https://evil-idp.example" })],
            ["email outside the team's domains", async () => response({ inResponseTo: await requestId(), email: "ceo@other.example" })],
            ["unsigned", async () => response({ inResponseTo: await requestId(), sign: false })],
            ["tampered after signing", async () => Buffer.from(Buffer.from(response({ inResponseTo: await requestId() }), "base64").toString("utf8").replace("worker@corp.example", "admin@corp.example")).toString("base64")],
        ];
        for (const [label, make] of cases) {
            const r = await call(server, "POST", `/auth/saml/${team.id}/acs`, form({ SAMLResponse: await make() }));
            assert.equal(r.status, 401, `${label}: ${r.status} ${r.text.slice(0, 200)}`);
            assert.equal(r.headers.get("location"), null, label);
        }
        // A response for one team isn't accepted by another team's ACS.
        const other = (await call(server, "POST", "/teams", { token: admin.token, body: { name: "Other" } })).body;
        await call(server, "PUT", `/teams/${other.id}/saml`, { token: admin.token, body: { domains: "other-corp.example", ssoUrl: "https://idp.corp.example/sso", cert, enabled: true } });
        const r = await call(server, "POST", `/auth/saml/${other.id}/acs`, form({ SAMLResponse: response({ inResponseTo: await requestId() }) }));
        assert.equal(r.status, 401);
    });
});
