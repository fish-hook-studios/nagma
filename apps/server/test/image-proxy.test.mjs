// The image proxy for pasted layers (image-proxy.mjs): signed-in only, image hosts only, no
// redirects, images only, 50 MB at most. A mock image host on this machine stands in for the real
// one through NAGMA_TEST_IMAGE_HOSTS, which only this suite sets.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { allowedImageUrl } from "../image-proxy.mjs";
import { IMAGE_HOSTS } from "../interop-hosts.mjs";
import { call, signUp, startServer } from "./helpers.mjs";

// The real image host, its registrable domain and a sibling host on that domain.
const IMAGE_HOST = IMAGE_HOSTS[0];
const IMAGE_DOMAIN = IMAGE_HOST.split(".").slice(-2).join(".");
const SIBLING_HOST = `s3-alpha.${IMAGE_DOMAIN}`;

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

describe("image proxy", () => {
    let server;
    let mock;
    let host;
    let token;
    before(async () => {
        mock = createServer((req, res) => {
            const path = new URL(req.url, "http://x").pathname;
            if (path === "/img/ok") return res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length }).end(PNG);
            if (path === "/img/expired") return res.writeHead(403, { "content-type": "application/xml" }).end("<Error>AccessDenied</Error>");
            if (path === "/img/redirect") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
            if (path === "/img/html") return res.writeHead(200, { "content-type": "text/html" }).end("<h1>hi</h1>");
            if (path === "/img/svg") return res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
            if (path === "/img/declared-big") return res.writeHead(200, { "content-type": "image/png", "content-length": String(60 * 1024 * 1024) }).end();
            if (path === "/img/streamed-big") {
                res.writeHead(200, { "content-type": "image/png" });
                const chunk = Buffer.alloc(1024 * 1024);
                let sent = 0;
                const pump = () => {
                    while (sent < 52) {
                        sent++;
                        if (!res.write(chunk)) return void res.once("drain", pump);
                    }
                    res.end();
                };
                res.on("error", () => {});
                return pump();
            }
            res.writeHead(404).end();
        });
        await new Promise((r) => mock.listen(0, "127.0.0.1", r));
        host = `127.0.0.1:${mock.address().port}`;
        server = await startServer({ NAGMA_TEST_IMAGE_HOSTS: host });
        token = (await signUp(server)).token;
    });
    after(async () => {
        await server?.stop();
        mock?.closeAllConnections?.();
        await new Promise((r) => mock.close(r));
    });

    const proxy = (url, t = token) => call(server, "GET", `/image-proxy?url=${encodeURIComponent(url)}`, { token: t });

    it("needs a signed-in account", async () => {
        const r = await proxy(`http://${host}/img/ok`, null);
        assert.equal(r.status, 401);
    });

    it("passes an image from an allowed host through", async () => {
        const res = await fetch(`${server.url}/image-proxy?url=${encodeURIComponent(`http://${host}/img/ok`)}`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/png");
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    });

    it("reports an expired link", async () => {
        const r = await proxy(`http://${host}/img/expired`);
        assert.equal(r.status, 410);
    });

    it("refuses redirects instead of following them", async () => {
        const r = await proxy(`http://${host}/img/redirect`);
        assert.equal(r.status, 502);
    });

    it("refuses answers that aren't raster images (HTML, SVG)", async () => {
        assert.equal((await proxy(`http://${host}/img/html`)).status, 415);
        assert.equal((await proxy(`http://${host}/img/svg`)).status, 415);
    });

    it("refuses images over 50 MB, declared or streamed", async () => {
        assert.equal((await proxy(`http://${host}/img/declared-big`)).status, 413);
        assert.equal((await proxy(`http://${host}/img/streamed-big`)).status, 413);
    });

    it("refuses other hosts, private addresses and odd links", async () => {
        for (const url of [
            "https://example.com/a.png",
            "http://127.0.0.1:1/img/ok",
            `https://${host}/img/ok`,
            "https://169.254.169.254/latest/meta-data",
            "https://10.0.0.1/a.png",
            "https://[::1]/a.png",
            `http://${IMAGE_HOST}/img/a`,
            `https://${IMAGE_HOST}.evil.example/img/a`,
            `https://evil.example/${IMAGE_HOST}/img/a`,
            `https://user:pw@${IMAGE_HOST}/img/a`,
            `https://${IMAGE_HOST}:8443/img/a`,
            "file:///etc/passwd",
            "not a url",
            "",
        ]) {
            const r = await proxy(url);
            assert.equal(r.status, 400, url);
        }
    });

    it("allows only https links on the image host (without the test hosts)", () => {
        const saved = process.env.NAGMA_TEST_IMAGE_HOSTS;
        delete process.env.NAGMA_TEST_IMAGE_HOSTS;
        try {
            assert.ok(allowedImageUrl(`https://${IMAGE_HOST}/img/ab/cd/0123?Expires=1&Signature=x`));
            assert.equal(allowedImageUrl(`https://${IMAGE_HOST.toUpperCase()}/img/a`)?.test, false);
            assert.equal(allowedImageUrl(`http://${host}/img/ok`), null);
            assert.equal(allowedImageUrl(`https://${IMAGE_DOMAIN}/img/a`), null);
            assert.equal(allowedImageUrl(`https://${SIBLING_HOST}/img/a`), null);
        } finally {
            if (saved !== undefined) process.env.NAGMA_TEST_IMAGE_HOSTS = saved;
        }
    });
});
