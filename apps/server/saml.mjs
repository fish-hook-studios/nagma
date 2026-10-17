// SAML 2.0 single sign-on for teams. A team admin connects the team's identity provider (its
// metadata XML, a metadata URL fetched once, or the entity ID, sign-in URL and certificate typed in)
// and lists the email domains it signs in. Signing in with an address on one of those domains goes to
// that provider (SP-initiated, HTTP-Redirect binding), and the provider posts its answer back to the
// team's assertion consumer service (ACS).
//
// Signature checking and XML canonicalisation are done by @node-saml/node-saml (xml-crypto), never by
// hand. On top of what it checks (the assertion's signature is required, audience, NotBefore and
// NotOnOrAfter, InResponseTo against requests this server made), this module checks the
// SubjectConfirmationData Recipient and the Response Destination against the ACS URL, the issuer
// against the configured IdP entity ID, refuses an assertion ID it has seen before (kept until the
// assertion expires, across restarts), only accepts RelayState that is a path on the app's own
// origin, and only signs in addresses on the team's domains. Accounts are found or made, and sessions
// started, by the same helpers as OpenID Connect sign-in.
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SAML } from "@node-saml/node-saml";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { parseObject } from "./json-body.mjs";
import { saveLater } from "./atomic-write.mjs";

const REQUEST_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMPTY = { enabled: false, domains: [], idpEntityId: "", ssoUrl: "", binding: "redirect", certs: [], source: "manual", updatedAt: null };

// A path on the app's own origin ("/", "/files?x=1"), or "/" for anything else (other origins,
// protocol-relative "//host", backslashes, control characters).
export function safeRelayPath(value) {
    const v = String(value ?? "");
    if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\\\u0000-\u001f\u007f]/.test(v) || v.length > 1000) return "/";
    try {
        const u = new URL(v, "http://app.invalid");
        return u.origin === "http://app.invalid" ? `${u.pathname}${u.search}` : "/";
    } catch {
        return "/";
    }
}

// Where OpenID Connect may send someone back to with their new session in the address: a path on
// this server, or a full address on one of `origins` (the server's own, NAGMA_APP_URL's,
// NAGMA_PUBLIC_URL's), or any loopback address when the server itself was reached on one (a dev
// server on another port). Anything else would hand the session to another site, so it becomes "/".
export function safeReturnUrl(value, origins = [], loopback = false) {
    const v = String(value ?? "");
    if (v.startsWith("/")) return safeRelayPath(v);
    if (/[\\\u0000-\u001f\u007f]/.test(v) || v.length > 2000) return "/";
    let u;
    try {
        u = new URL(v);
    } catch {
        return "/";
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return "/";
    if (u.username || u.password) return "/";
    const allowed = new Set(origins.filter(Boolean).map((o) => {
        try {
            return new URL(o).origin;
        } catch {
            return null;
        }
    }));
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
    if (allowed.has(u.origin) || (loopback && isLoopback)) return `${u.origin}${u.pathname}${u.search}`;
    return "/";
}

// The base64 body of each certificate, whatever form it was pasted in (PEM, or the bare base64 from
// metadata), checked by parsing it.
function normaliseCerts(input) {
    const list = Array.isArray(input) ? input : [input];
    const out = [];
    for (const raw of list) {
        const text = String(raw ?? "").trim();
        if (!text) continue;
        const blocks = text.includes("-----BEGIN") ? [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => m[1]) : [text];
        for (const block of blocks) {
            const body = block.replace(/\s+/g, "");
            if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error("That certificate isn't valid.");
            const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
            try {
                new X509Certificate(pem);
            } catch {
                throw new Error("That certificate isn't valid.");
            }
            if (!out.includes(body)) out.push(body);
        }
    }
    return out;
}

const pemOf = (body) => `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;

function certInfo(body) {
    const c = new X509Certificate(pemOf(body));
    return { subject: c.subject.replace(/\n/g, ", "), validTo: c.validTo, fingerprint: c.fingerprint256 };
}

// Reads an identity provider's metadata: entity ID, single sign-on URL (Redirect binding preferred)
// and signing certificates.
export function parseIdpMetadata(xml) {
    const text = String(xml ?? "");
    if (!text.trim()) throw new Error("Paste the identity provider's metadata XML.");
    if (text.length > 1024 * 1024) throw new Error("That metadata is too large.");
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Metadata with a DOCTYPE isn't accepted.");
    const errors = [];
    const doc = new DOMParser({ onError: (level, msg) => level !== "warning" && errors.push(msg) }).parseFromString(text, "text/xml");
    if (errors.length || !doc?.documentElement) throw new Error("That isn't valid metadata XML.");
    const select = (expr, node = doc) => xpath.select(expr, node);
    const entity = select("//*[local-name()='EntityDescriptor'][*[local-name()='IDPSSODescriptor']]")[0];
    if (!entity) throw new Error("That metadata has no identity provider (IDPSSODescriptor) in it.");
    const idp = select("*[local-name()='IDPSSODescriptor']", entity)[0];
    const services = select("*[local-name()='SingleSignOnService']", idp).map((n) => ({ binding: n.getAttribute("Binding"), location: n.getAttribute("Location") }));
    const service = services.find((s) => s.binding === REDIRECT_BINDING) ?? services.find((s) => s.binding === POST_BINDING);
    if (!service?.location) throw new Error("That metadata has no single sign-on URL for the Redirect or POST binding.");
    const keys = select("*[local-name()='KeyDescriptor'][not(@use) or @use='signing']//*[local-name()='X509Certificate']", idp).map((n) => n.textContent);
    const certs = normaliseCerts(keys);
    if (!certs.length) throw new Error("That metadata has no signing certificate.");
    return { idpEntityId: entity.getAttribute("entityID") ?? "", ssoUrl: service.location, binding: service.binding === POST_BINDING ? "post" : "redirect", certs };
}

export function createSaml(ctx) {
    const { getOrg, saveOrg, teamById, teamRole, userFromReq, readBody, CORS, DATA, fetchPublic, ssoAccount, ssoFinish } = ctx;

    // Requests this server sent, by ID, so a response must answer one of them (InResponseTo).
    // (node-saml's cache provider interface, shared by every team's SAML instance.)
    const pending = new Map();
    const requests = {
        async saveAsync(key, value) {
            const now = Date.now();
            for (const [k, v] of pending) if (now - v.createdAt > REQUEST_TTL_MS) pending.delete(k);
            if (pending.has(key)) return null;
            const item = { value, createdAt: now };
            pending.set(key, item);
            return item;
        },
        async getAsync(key) {
            const item = pending.get(key);
            return item && Date.now() - item.createdAt <= REQUEST_TTL_MS ? item.value : null;
        },
        async removeAsync(key) {
            const item = key ? pending.get(key) : null;
            if (key) pending.delete(key);
            return item?.value ?? null;
        },
    };

    // Assertion IDs already used, with when each stops mattering (its NotOnOrAfter).
    const SEEN = join(DATA, "saml-seen.json");
    let seen = {};
    const loaded = readFile(SEEN, "utf8").then((t) => (seen = JSON.parse(t) ?? {})).catch(() => (seen = {}));
    let seenTimer = null;
    function saveSeen() {
        clearTimeout(seenTimer);
        seenTimer = setTimeout(() => {
            const now = Date.now();
            for (const [k, until] of Object.entries(seen)) if (until < now) delete seen[k];
            saveLater(SEEN, JSON.stringify(seen));
        }, 50);
    }

    const configOf = (t) => ({ ...EMPTY, ...(t?.saml ?? {}) });
    const origin = (req) => (process.env.NAGMA_PUBLIC_URL ?? `http://${req.headers.host}`).replace(/\/$/, "");
    // Where the app lives, for the trip back after signing in: NAGMA_APP_URL (when the app is served
    // from somewhere else, like a dev server), else the public URL, else this server.
    const appOrigin = (req) => new URL(process.env.NAGMA_APP_URL || origin(req)).origin;
    const spEntityId = (req, t) => `${origin(req)}/auth/saml/${t.id}/metadata`;
    const acsUrl = (req, t) => `${origin(req)}/auth/saml/${t.id}/acs`;

    // The team whose SAML connection signs in this domain.
    function teamForDomain(domain) {
        const d = String(domain ?? "").trim().toLowerCase();
        if (!d) return null;
        return getOrg().teams.find((t) => configOf(t).enabled && configOf(t).domains.includes(d) && configOf(t).ssoUrl && configOf(t).certs.length) ?? null;
    }

    function samlFor(req, t) {
        const c = configOf(t);
        return new SAML({
            entryPoint: c.ssoUrl,
            authnRequestBinding: c.binding === "post" ? "HTTP-POST" : "HTTP-Redirect",
            issuer: spEntityId(req, t),
            audience: spEntityId(req, t),
            callbackUrl: acsUrl(req, t),
            idpCert: c.certs.map(pemOf),
            idpIssuer: c.idpEntityId || undefined,
            identifierFormat: EMAIL_FORMAT,
            wantAssertionsSigned: true,
            wantAuthnResponseSigned: false,
            validateInResponseTo: "always",
            requestIdExpirationPeriodMs: REQUEST_TTL_MS,
            cacheProvider: requests,
            acceptedClockSkewMs: CLOCK_SKEW_MS,
            disableRequestedAuthnContext: true,
            signatureAlgorithm: "sha256",
        });
    }

    function spMetadata(req, t) {
        const sp = new SAML({ issuer: spEntityId(req, t), callbackUrl: acsUrl(req, t), idpCert: "unused", identifierFormat: EMAIL_FORMAT, wantAssertionsSigned: true });
        return sp.generateServiceProviderMetadata(null, null);
    }

    function adminView(req, t) {
        const c = configOf(t);
        return {
            ...c,
            certs: c.certs.map((b) => ({ ...certInfo(b), pem: pemOf(b) })),
            sp: { entityId: spEntityId(req, t), acsUrl: acsUrl(req, t), metadataUrl: `${origin(req)}/auth/saml/${t.id}/metadata` },
        };
    }

    // Validates and stores an admin's settings (fields not given keep their value).
    function applyConfig(t, q) {
        const c = configOf(t);
        if (q.domains !== undefined) {
            const domains = [...new Set((Array.isArray(q.domains) ? q.domains : String(q.domains).split(/[\s,;]+/)).map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean))].slice(0, 20);
            for (const d of domains) {
                if (!DOMAIN.test(d)) throw new Error(`"${d}" isn't a domain.`);
                const other = getOrg().teams.find((x) => x.id !== t.id && configOf(x).domains.includes(d));
                if (other) throw new Error(`${d} already signs in through another team's SAML connection.`);
            }
            c.domains = domains;
        }
        if (q.idpEntityId !== undefined) c.idpEntityId = String(q.idpEntityId).trim().slice(0, 500);
        if (q.ssoUrl !== undefined) {
            const v = String(q.ssoUrl).trim();
            if (v) {
                let u;
                try {
                    u = new URL(v);
                } catch {
                    throw new Error("The single sign-on URL isn't a web address.");
                }
                if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) throw new Error("The single sign-on URL must use https.");
            }
            c.ssoUrl = v;
        }
        if (q.binding !== undefined) c.binding = q.binding === "post" ? "post" : "redirect";
        if (q.cert !== undefined || q.certs !== undefined) c.certs = normaliseCerts(q.certs ?? q.cert);
        if (q.source !== undefined) c.source = ["xml", "url", "manual"].includes(q.source) ? q.source : "manual";
        if (q.enabled !== undefined) c.enabled = Boolean(q.enabled);
        if (c.enabled && (!c.ssoUrl || !c.certs.length || !c.domains.length)) throw new Error("Add the sign-in URL, a certificate and at least one domain before turning SAML on.");
        c.updatedAt = Date.now();
        t.saml = c;
        saveOrg();
    }

    // Sign in with SSO: which way an email address signs in.
    function lookup(email, oidc) {
        const domain = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
        if (!domain) return { method: null, error: "Enter your work email." };
        if (teamForDomain(domain)) return { method: "saml", start: `/auth/saml/start?domain=${encodeURIComponent(domain)}` };
        const oidcDomains = String(process.env.NAGMA_OIDC_DOMAINS ?? "").split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
        if (oidc.enabled && (!oidcDomains.length || oidcDomains.includes(domain))) return { method: "oidc", start: "/auth/oidc/start", name: oidc.name };
        return { method: null, error: `Single sign-on isn't set up for ${domain}. Sign in with your password, or ask your admin.` };
    }

    // The values in a verified assertion this module checks itself.
    function assertionFacts(profile) {
        const a = profile.getAssertion?.()?.Assertion;
        const confirmations = (a?.Subject?.[0]?.SubjectConfirmation ?? []).filter((s) => s?.$?.Method === "urn:oasis:names:tc:SAML:2.0:cm:bearer");
        const data = confirmations.map((s) => s.SubjectConfirmationData?.[0]?.$ ?? {});
        const conditionsEnd = a?.Conditions?.[0]?.$?.NotOnOrAfter;
        const ends = [conditionsEnd, ...data.map((d) => d.NotOnOrAfter)].filter(Boolean).map((v) => Date.parse(v)).filter(Number.isFinite);
        return { id: a?.$?.ID ?? null, recipients: data.map((d) => d.Recipient), notOnOrAfter: ends.length ? Math.max(...ends) : null };
    }

    // The unverified assertion ID of a posted response, only used to refuse one seen before early.
    function rawAssertionId(xml) {
        return /<(?:\w+:)?Assertion\b[^>]*\sID="([^"]+)"/.exec(xml)?.[1] ?? null;
    }

    async function serve(req, res, oidc) {
        const url = new URL(req.url ?? "/", "http://local");
        const path = url.pathname;
        const json = (status, body) => (res.writeHead(status, { ...CORS, "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body)), true);
        const page = (status, message) => (res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" }).end(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="font:14px system-ui;margin:15vh auto;max-width:420px;padding:0 16px"><h1 style="font-size:18px">Sign-in failed</h1><p>${String(message).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)}</p><p><a href="${appOrigin(req)}/">Back to Nagma</a></p></body>`), true);

        if (path === "/auth/sso" && req.method === "GET") {
            // Without an email: whether any single sign-on is set up (for the "Sign in with SSO" button).
            if (!url.searchParams.has("email")) return json(200, { available: oidc.enabled || getOrg().teams.some((t) => configOf(t).enabled), name: oidc.enabled ? oidc.name : null });
            return json(200, lookup(url.searchParams.get("email"), oidc));
        }

        if (path === "/auth/saml/start" && req.method === "GET") {
            const t = teamForDomain(url.searchParams.get("domain"));
            if (!t) return json(404, { error: "SAML single sign-on isn't set up for that domain." });
            const relay = safeRelayPath(url.searchParams.get("return"));
            const saml = samlFor(req, t);
            if (configOf(t).binding === "post") {
                const form = await saml.getAuthorizeFormAsync(relay, undefined, {});
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(form);
                return true;
            }
            const to = await saml.getAuthorizeUrlAsync(relay, undefined, {});
            res.writeHead(302, { location: to, "cache-control": "no-store" }).end();
            return true;
        }

        const sp = /^\/auth\/saml\/([A-Za-z0-9_-]{6,64})\/(metadata|acs)$/.exec(path);
        if (sp) {
            const t = teamById(sp[1]);
            if (!t) return json(404, { error: "No such team." });
            if (sp[2] === "metadata" && req.method === "GET") {
                res.writeHead(200, { "content-type": "application/samlmetadata+xml", "content-disposition": `attachment; filename="nagma-sp-metadata.xml"`, "access-control-allow-origin": "*" }).end(spMetadata(req, t));
                return true;
            }
            if (sp[2] === "acs" && req.method === "POST") {
                const c = configOf(t);
                if (!c.enabled || !c.certs.length) return page(400, "SAML single sign-on isn't turned on for this team.");
                let form;
                try {
                    form = new URLSearchParams((await readBody(req, 1024 * 1024)).toString("utf8"));
                } catch {
                    return page(413, "That sign-in response is too large.");
                }
                const SAMLResponse = form.get("SAMLResponse") ?? "";
                if (!SAMLResponse) return page(400, "The identity provider didn't send a sign-in response.");
                await loaded;
                try {
                    const xml = Buffer.from(SAMLResponse, "base64").toString("utf8");
                    const early = rawAssertionId(xml);
                    if (early && seen[`${t.id}:${early}`] > Date.now()) throw new Error("That sign-in response was already used.");
                    // The Response's Destination, when present, must be this ACS.
                    const destination = /<(?:\w+:)?Response\b[^>]*\sDestination="([^"]*)"/.exec(xml)?.[1];
                    if (destination !== undefined && destination !== acsUrl(req, t)) throw new Error("That sign-in response was meant for somewhere else.");
                    const { profile } = await samlFor(req, t).validatePostResponseAsync({ SAMLResponse });
                    if (!profile) throw new Error("The identity provider didn't sign you in.");
                    const facts = assertionFacts(profile);
                    if (!facts.id) throw new Error("The assertion has no ID.");
                    if (!facts.recipients.length || facts.recipients.some((r) => r !== acsUrl(req, t))) throw new Error("The assertion's recipient isn't this server.");
                    if (c.idpEntityId && profile.issuer !== c.idpEntityId) throw new Error("The assertion comes from a different identity provider.");
                    const key = `${t.id}:${facts.id}`;
                    if (seen[key] > Date.now()) throw new Error("That sign-in response was already used.");
                    seen[key] = Math.max(facts.notOnOrAfter ?? 0, Date.now() + REQUEST_TTL_MS) + CLOCK_SKEW_MS;
                    saveSeen();
                    const email = String(profile.email ?? profile.mail ?? (String(profile.nameID ?? "").includes("@") ? profile.nameID : "")).trim().toLowerCase();
                    const domain = email.split("@")[1] ?? "";
                    if (!email || !c.domains.includes(domain)) throw new Error(email ? `${email} isn't on a domain this team's single sign-on covers.` : "The identity provider didn't share an email address.");
                    const name = [profile.firstName ?? profile.givenName ?? profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"], profile.lastName ?? profile.surname ?? profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"]].filter(Boolean).join(" ") || profile.displayName || profile.name || "";
                    const user = ssoAccount(email, typeof name === "string" ? name : "");
                    // Someone on the team's domain who signs in this way joins the team (view only to
                    // start with; admins pick roles and seats).
                    if (!t.members[user.id]) {
                        t.members[user.id] = "view";
                        saveOrg();
                    }
                    ssoFinish(res, user, new URL(safeRelayPath(form.get("RelayState")), appOrigin(req)));
                    return true;
                } catch (error) {
                    console.warn(`SAML sign-in refused for team ${t.id}: ${error?.message ?? error}`);
                    return page(401, `${error?.message ?? "The sign-in response wasn't valid."}`);
                }
            }
            return json(405, { error: "Method not allowed." });
        }

        // Admin settings: /teams/:id/saml (GET, PUT) and /teams/:id/saml/metadata (POST xml or url).
        const m = /^\/teams\/([A-Za-z0-9_-]{6,64})\/saml(?:\/(metadata))?$/.exec(path);
        if (!m) return false;
        const user = userFromReq(req);
        if (!user) return json(401, { error: "Sign in first." });
        const t = teamById(m[1]);
        if (!t || !teamRole(t, user)) return json(404, { error: "No such team." });
        if (teamRole(t, user) !== "admin") return json(403, { error: "Only team admins can do that." });
        if (!m[2] && req.method === "GET") return json(200, adminView(req, t));
        let q = {};
        try {
            q = parseObject(await readBody(req, 2 * 1024 * 1024));
        } catch {
            return json(400, { error: "That request isn't valid." });
        }
        try {
            if (!m[2] && (req.method === "PUT" || req.method === "POST")) {
                applyConfig(t, q);
                return json(200, adminView(req, t));
            }
            if (m[2] === "metadata" && req.method === "POST") {
                let xml = q.xml;
                if (q.url) {
                    const r = await fetchPublic(String(q.url), 1024 * 1024);
                    if (!r) throw new Error("That metadata URL can't be fetched (it must be a public https or http address).");
                    xml = r;
                }
                const parsed = parseIdpMetadata(xml);
                applyConfig(t, { ...parsed, source: q.url ? "url" : "xml" });
                return json(200, adminView(req, t));
            }
        } catch (error) {
            return json(400, { error: error?.message ?? "That didn't work." });
        }
        return json(405, { error: "Method not allowed." });
    }

    return { serve };
}
