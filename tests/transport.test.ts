import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeTransport } from "../src/core/transport/node";
import { TransportError, type TransportRequest } from "../src/core/transport/types";

let server: http.Server;
let other: http.Server;
let base: string;
let otherBase: string;
const transport = new NodeTransport();

function echo(req: http.IncomingMessage, res: http.ServerResponse): void {
	const chunks: Buffer[] = [];
	req.on("data", (c: Buffer) => chunks.push(c));
	req.on("end", () => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }));
	});
}

async function listen(handler: http.RequestListener): Promise<[http.Server, string]> {
	const s = http.createServer(handler);
	await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
	return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`];
}

beforeAll(async () => {
	[other, otherBase] = await listen(echo);
	[server, base] = await listen((req, res) => {
		const path = req.url ?? "/";
		if (path === "/gzip") {
			res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "text/plain" });
			res.end(zlib.gzipSync("hello gzip"));
		} else if (path === "/br") {
			res.writeHead(200, { "Content-Encoding": "br" });
			res.end(zlib.brotliCompressSync("hello brotli"));
		} else if (path === "/big") {
			res.end(Buffer.alloc(100_000, 97));
		} else if (path === "/slow") {
			setTimeout(() => res.end("late"), 500);
		} else if (path === "/see-other") {
			res.writeHead(303, { Location: "/echo" }).end();
		} else if (path === "/temp") {
			res.writeHead(307, { Location: "/echo" }).end();
		} else if (path === "/cross") {
			res.writeHead(302, { Location: `${otherBase}/echo` }).end();
		} else if (path === "/loop") {
			res.writeHead(302, { Location: "/loop" }).end();
		} else if (path === "/head-gzip") {
			res.writeHead(200, { "Content-Encoding": "gzip" }).end();
		} else {
			echo(req, res);
		}
	});
});

afterAll(() => {
	transport.dispose();
	server.close();
	other.close();
});

function request(overrides: Partial<TransportRequest>): TransportRequest {
	return {
		method: "GET",
		url: `${base}/echo`,
		headers: [],
		timeoutMs: 0,
		followRedirects: true,
		maxRedirects: 5,
		forwardAuthorizationHeader: false,
		rejectUnauthorized: true,
		maxBodyBytes: 10_000_000,
		...overrides,
	};
}

const json = (body: Uint8Array) => JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown> & { headers: Record<string, string> };

describe("NodeTransport", () => {
	it("sends method, headers and body with defaults and a content length", async () => {
		const body = new TextEncoder().encode('{"a":1}');
		const res = await transport.send(request({ method: "POST", body, headers: [["X-Test", "1"], ["X-Multi", "a"], ["x-multi", "b"]] }));
		expect(res.status).toBe(200);
		const echoed = json(res.body);
		expect(echoed.method).toBe("POST");
		expect(echoed.body).toBe('{"a":1}');
		expect(echoed.headers["content-length"]).toBe("7");
		expect(echoed.headers["x-test"]).toBe("1");
		expect(echoed.headers["x-multi"]).toBe("a, b");
		expect(echoed.headers["user-agent"]).toMatch(/^CarbonWire/);
		expect(echoed.headers["accept-encoding"]).toBe("gzip, deflate, br");
	});

	it("reports timings and reuses keep-alive connections", async () => {
		const first = await transport.send(request({ url: `${base}/echo?fresh` }));
		const second = await transport.send(request({ url: `${base}/echo?reused` }));
		expect(first.timings.total).toBeGreaterThan(0);
		expect(first.timings.total).toBeGreaterThanOrEqual(first.timings.wait);
		expect(second.timings.reusedConnection).toBe(true);
		expect(second.timings.connect).toBe(0);
	});

	it("reports progress through each phase, ending with the bytes received", async () => {
		const phases: string[] = [];
		let last: { received?: number; total?: number } = {};
		await transport.send(request({ url: `${base}/big`, onProgress: (p) => {
			if (phases.at(-1) !== p.phase) phases.push(p.phase);
			last = p;
		} }));
		expect(phases[0]).toBe("connecting");
		expect(phases.slice(-2)).toEqual(["waiting", "downloading"]);
		expect(last.total).toBe(100_000);
	});

	it("decompresses gzip and brotli bodies", async () => {
		expect(new TextDecoder().decode((await transport.send(request({ url: `${base}/gzip` }))).body)).toBe("hello gzip");
		expect(new TextDecoder().decode((await transport.send(request({ url: `${base}/br` }))).body)).toBe("hello brotli");
	});

	it("does not decode bodiless HEAD responses", async () => {
		const res = await transport.send(request({ method: "HEAD", url: `${base}/head-gzip` }));
		expect(res.body.byteLength).toBe(0);
	});

	it("truncates bodies past the cap but counts every byte", async () => {
		const res = await transport.send(request({ url: `${base}/big`, maxBodyBytes: 1000 }));
		expect(res.body.byteLength).toBe(1000);
		expect(res.bodyBytes).toBe(100_000);
		expect(res.truncated).toBe(true);
	});

	it("turns POST into GET on 303 and keeps the method on 307", async () => {
		const body = new TextEncoder().encode("x");
		const seeOther = await transport.send(request({ method: "POST", url: `${base}/see-other`, body, headers: [["Content-Type", "text/plain"]] }));
		expect(json(seeOther.body)).toMatchObject({ method: "GET", body: "" });
		expect(seeOther.redirects).toEqual([{ status: 303, url: `${base}/see-other` }]);

		const temp = await transport.send(request({ method: "POST", url: `${base}/temp`, body }));
		expect(json(temp.body)).toMatchObject({ method: "POST", body: "x" });
	});

	it("drops credentials on cross-origin redirects unless forwarding is enabled", async () => {
		const headers: [string, string][] = [["Authorization", "Bearer t"], ["Cookie", "s=1"]];
		const dropped = await transport.send(request({ url: `${base}/cross`, headers }));
		expect(dropped.url).toBe(`${otherBase}/echo`);
		expect(json(dropped.body).headers.authorization).toBeUndefined();
		expect(json(dropped.body).headers.cookie).toBeUndefined();

		const kept = await transport.send(request({ url: `${base}/cross`, headers, forwardAuthorizationHeader: true }));
		expect(json(kept.body).headers.authorization).toBe("Bearer t");
	});

	it("returns the redirect response itself when following is disabled", async () => {
		const res = await transport.send(request({ url: `${base}/see-other`, followRedirects: false }));
		expect(res.status).toBe(303);
	});

	it("fails with typed errors", async () => {
		await expect(transport.send(request({ url: `${base}/loop`, maxRedirects: 3 }))).rejects.toMatchObject({ code: "too-many-redirects" });
		await expect(transport.send(request({ url: `${base}/slow`, timeoutMs: 50 }))).rejects.toMatchObject({ code: "timeout" });
		await expect(transport.send(request({ url: "not a url" }))).rejects.toMatchObject({ code: "invalid-url" });
		await expect(transport.send(request({ url: "ftp://x" }))).rejects.toMatchObject({ code: "invalid-url" });

		const refused = await transport.send(request({ url: "http://127.0.0.1:1/" })).catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(TransportError);
		expect((refused as TransportError).systemError?.code).toBe("ECONNREFUSED");
	});

	it("cancels in-flight requests", async () => {
		const controller = new AbortController();
		const pending = transport.send(request({ url: `${base}/slow`, signal: controller.signal }));
		setTimeout(() => controller.abort(), 20);
		await expect(pending).rejects.toMatchObject({ code: "aborted" });
	});
});
