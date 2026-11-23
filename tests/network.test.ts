import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as http2 from "node:http2";
import * as https from "node:https";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OAuth2Tokens } from "../src/core/auth/oauth2";
import { CookieJar } from "../src/core/cookies";
import { buildRequest } from "../src/core/request-builder";
import { sendRequest } from "../src/core/sender";
import { NodeTransport } from "../src/core/transport/node";
import { bypasses, parseProxyUrl } from "../src/core/transport/proxy";
import type { TransportRequest } from "../src/core/transport/types";

const certs = join(import.meta.dirname, "certs");
const read = (name: string) => readFileSync(join(certs, name));
const text = (body: Uint8Array) => new TextDecoder().decode(body);
interface Echo {
	method: string;
	url: string;
	headers: Record<string, string | undefined>;
	body: string;
}
const echoed = (body: Uint8Array) => JSON.parse(text(body)) as Echo;

const request = (url: string, extra: Partial<TransportRequest> = {}): TransportRequest => ({
	method: "GET",
	url,
	headers: [],
	timeoutMs: 5000,
	followRedirects: true,
	maxRedirects: 5,
	forwardAuthorizationHeader: false,
	rejectUnauthorized: false,
	maxBodyBytes: 1_000_000,
	...extra,
});

const servers: { close(): void }[] = [];
const listen = async (server: net.Server): Promise<number> => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	servers.push(server);
	return (server.address() as AddressInfo).port;
};

let plain: number;
let secure: number;
let proxied: string[] = [];

beforeAll(async () => {
	plain = await listen(
		http.createServer((req, res) => {
			if (req.url === "/login") {
				res.writeHead(302, { "Set-Cookie": "sid=abc; Path=/", Location: "/me" }).end();
			} else if (req.url === "/post-redirect") {
				res.writeHead(302, { Location: "/echo" }).end();
			} else if (req.url === "/ntlm") {
				// The answer must come on the connection the negotiate message came on.
				const socket = req.socket as net.Socket & { ntlm?: boolean };
				const auth = req.headers.authorization ?? "";
				const type = auth.startsWith("NTLM ") ? Buffer.from(auth.slice(5), "base64").readUInt32LE(8) : 0;
				if (type === 1) {
					socket.ntlm = true;
					const challenge = Buffer.concat([Buffer.from("NTLMSSP\0", "latin1"), Buffer.from([2, 0, 0, 0]), Buffer.alloc(8), Buffer.from([0x05, 0x82, 0x88, 0xa2]), Buffer.alloc(8, 7), Buffer.alloc(8), Buffer.from([0, 0, 0, 0, 48, 0, 0, 0])]);
					res.writeHead(401, { "WWW-Authenticate": `NTLM ${challenge.toString("base64")}` }).end();
				} else if (type === 3 && socket.ntlm) {
					res.end("ntlm ok");
				} else {
					res.writeHead(401, { "WWW-Authenticate": "NTLM" }).end();
				}
			} else {
				let body = "";
				req.on("data", (c: Buffer) => (body += c.toString()));
				req.on("end", () => res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body })));
			}
		}),
	);
	secure = await listen(
		https.createServer({ key: read("localhost.key"), cert: read("localhost.crt"), requestCert: true, rejectUnauthorized: false, ca: [read("client.crt")] }, (req, res) => {
			const cert = (req.socket as import("node:tls").TLSSocket).getPeerCertificate();
			res.end(cert?.subject?.CN ?? "anonymous");
		}),
	);
});

afterAll(() => {
	for (const s of servers) s.close();
});

describe("cookies and redirects", () => {
	it("stores cookies from each hop and sends them on the next", async () => {
		const jar = new CookieJar();
		const transport = new NodeTransport();
		const response = await transport.send(request(`http://127.0.0.1:${plain}/login`, { cookies: { header: (u) => jar.header(u), store: (u, c) => void jar.store(u, c) } }));
		expect(echoed((response.body)).headers.cookie).toBe("sid=abc");
		expect(response.sent?.headers.find(([n]) => n === "Cookie")?.[1]).toBe("sid=abc");
		transport.dispose();
	});

	it("keeps the method on a redirect when asked, and leaves out default headers", async () => {
		const transport = new NodeTransport();
		const body = new TextEncoder().encode("x=1");
		const switched = echoed(((await transport.send(request(`http://127.0.0.1:${plain}/post-redirect`, { method: "POST", body }))).body));
		expect(switched.method).toBe("GET");
		const kept = echoed(((await transport.send(request(`http://127.0.0.1:${plain}/post-redirect`, { method: "POST", body, keepMethod: true, omitHeaders: ["user-agent"] }))).body));
		expect(kept).toMatchObject({ method: "POST", body: "x=1" });
		expect(kept.headers["user-agent"]).toBeUndefined();
		transport.dispose();
	});
});

describe("proxies", () => {
	it("reads proxy URLs and bypass lists", () => {
		expect(parseProxyUrl("proxy:3128")?.url.href).toBe("http://proxy:3128/");
		expect(parseProxyUrl("socks5://u:p%40ss@h:1080")).toMatchObject({ username: "u", password: "p@ss" });
		expect(() => parseProxyUrl("ftp://h")).toThrow("aren't supported");
		const url = new URL("https://api.internal.example.com/x");
		expect(bypasses("localhost, .example.com", url)).toBe(true);
		expect(bypasses("*.example.com:8443", url)).toBe(false);
		expect(bypasses("*", url)).toBe(true);
	});

	it("tunnels through an HTTP proxy with authentication, and sends plain HTTP as absolute URLs", async () => {
		proxied = [];
		const proxyPort = await listen(
			http
				.createServer((req, res) => {
					proxied.push(`${req.method} ${req.url} ${req.headers["proxy-authorization"] ?? ""}`);
					const target = new URL(req.url!);
					const upstream = http.request({ host: target.hostname, port: target.port, path: target.pathname, method: req.method, headers: req.headers }, (r) => {
						res.writeHead(r.statusCode!, r.headers);
						r.pipe(res);
					});
					req.pipe(upstream);
				})
				.on("connect", (req, client: net.Socket) => {
					proxied.push(`CONNECT ${req.url} ${req.headers["proxy-authorization"] ?? ""}`);
					if (req.headers["proxy-authorization"] !== `Basic ${Buffer.from("u:p").toString("base64")}`) {
						client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
						return;
					}
					const [host, port] = req.url!.split(":");
					const upstream = net.connect(Number(port), host, () => {
						client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
						upstream.pipe(client);
						client.pipe(upstream);
					});
				}),
		);
		const proxy = parseProxyUrl(`http://u:p@127.0.0.1:${proxyPort}`);
		const transport = new NodeTransport("CarbonWire", { proxy: () => proxy });
		const viaTunnel = await transport.send(request(`https://localhost:${secure}/`));
		expect(text(viaTunnel.body)).toBe("anonymous");
		expect(viaTunnel.proxy).toBe(`127.0.0.1:${proxyPort}`);
		const absolute = await transport.send(request(`http://127.0.0.1:${plain}/hello`));
		expect(echoed((absolute.body)).url).toBe("/hello");
		expect(proxied).toEqual([`CONNECT localhost:${secure} Basic dTpw`, `GET http://127.0.0.1:${plain}/hello Basic dTpw`]);

		const refused = new NodeTransport("CarbonWire", { proxy: () => parseProxyUrl(`http://127.0.0.1:${proxyPort}`) });
		await expect(refused.send(request(`https://localhost:${secure}/`))).rejects.toThrow("The proxy needs a user name and password.");
		transport.dispose();
		refused.dispose();
	});

	it("tunnels through a SOCKS5 proxy with a user name and password", async () => {
		let sawAuth = "";
		const socksPort = await listen(
			net.createServer((client) => {
				client.once("data", (hello) => {
					client.write(Buffer.from([5, hello.includes(2) ? 2 : 0]));
					client.once("data", (auth) => {
						const user = auth.subarray(2, 2 + auth[1]!).toString();
						const pass = auth.subarray(3 + auth[1]!).toString();
						sawAuth = `${user}:${pass}`;
						client.write(Buffer.from([1, 0]));
						client.once("data", (connect) => {
							const length = connect[4]!;
							const host = connect.subarray(5, 5 + length).toString();
							const port = connect.readUInt16BE(5 + length);
							const upstream = net.connect(port, host === "localhost" ? "127.0.0.1" : host, () => {
								client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
								upstream.pipe(client);
								client.pipe(upstream);
							});
						});
					});
				});
			}),
		);
		const transport = new NodeTransport("CarbonWire", { proxy: () => parseProxyUrl(`socks5://me:pw@127.0.0.1:${socksPort}`) });
		expect(text((await transport.send(request(`https://localhost:${secure}/`))).body)).toBe("anonymous");
		expect(sawAuth).toBe("me:pw");
		transport.dispose();
	});
});

describe("TLS", () => {
	it("offers a client certificate as PEM, encrypted PEM or PFX, and reports the connection", async () => {
		const pem = new NodeTransport("CarbonWire", { clientCertificate: () => ({ id: "pem", cert: read("client.crt"), key: read("client.key") }) });
		const response = await pem.send(request(`https://localhost:${secure}/`));
		expect(text(response.body)).toBe("CarbonWire test client");
		expect(response.tls).toMatchObject({ protocol: "TLSv1.3", authorized: false });
		expect(response.tls?.certificates[0]?.subject).toBe("CN=localhost");
		const encrypted = new NodeTransport("CarbonWire", { clientCertificate: () => ({ id: "enc", cert: read("client.crt"), key: read("client-encrypted.key"), passphrase: "secret" }) });
		expect(text((await encrypted.send(request(`https://localhost:${secure}/`))).body)).toBe("CarbonWire test client");
		const pfx = new NodeTransport("CarbonWire", { clientCertificate: () => ({ id: "pfx", pfx: read("client.p12"), passphrase: "secret" }) });
		expect(text((await pfx.send(request(`https://localhost:${secure}/`))).body)).toBe("CarbonWire test client");
		for (const t of [pem, encrypted, pfx]) t.dispose();
	});

	it("trusts a custom CA, and limits TLS versions", async () => {
		const transport = new NodeTransport("CarbonWire", { ca: () => ({ id: "test", certs: [read("localhost.crt").toString()] }) });
		const verified = await transport.send(request(`https://localhost:${secure}/`, { rejectUnauthorized: true }));
		expect(verified.tls?.authorized).toBe(true);
		const tls12 = await transport.send(request(`https://localhost:${secure}/`, { disabledTlsVersions: ["TLSv1.3"] }));
		expect(tls12.tls?.protocol).toBe("TLSv1.2");
		transport.dispose();
	});

	it("speaks HTTP/2 when asked, or when ALPN offers it", async () => {
		const port = await listen(
			http2.createSecureServer({ key: read("localhost.key"), cert: read("localhost.crt"), allowHTTP1: true }, (req, res) => {
				res.setHeader("set-cookie", "h2=1");
				res.end(`HTTP/${req.httpVersion} ${req.url}`);
			}),
		);
		const jar = new CookieJar();
		const transport = new NodeTransport();
		const cookies = { header: (u: URL) => jar.header(u), store: (u: URL, c: readonly string[]) => void jar.store(u, c) };
		const h2 = await transport.send(request(`https://localhost:${port}/a?b=1`, { httpVersion: "http2", cookies }));
		expect(text(h2.body)).toBe("HTTP/2.0 /a?b=1");
		expect(h2.httpVersion).toBe("2");
		expect(jar.header(new URL(`https://localhost:${port}/`))).toBe("h2=1");
		const again = await transport.send(request(`https://localhost:${port}/c`, { httpVersion: "http2" }));
		expect(again.timings.reusedConnection).toBe(true);
		expect(text((await transport.send(request(`https://localhost:${port}/d`, { httpVersion: "auto" }))).body)).toBe("HTTP/2.0 /d");
		expect(text((await transport.send(request(`https://localhost:${port}/e`))).body)).toBe("HTTP/1.1 /e");
		transport.dispose();
	});
});

describe("NTLM", () => {
	it("answers the challenge on the same connection", async () => {
		const transport = new NodeTransport();
		const resolved = buildRequest({ http: { method: "GET", url: `http://127.0.0.1:${plain}/ntlm`, auth: { type: "ntlm", username: "DOMAIN\\user", password: "pw" } } }, [], new Map());
		const result = await sendRequest(resolved, { transport, oauth2: {} as OAuth2Tokens, readFile: async () => new Uint8Array(), rejectUnauthorized: true, maxBodyBytes: 1000 });
		expect(result.response.status).toBe(200);
		expect(text(result.response.body)).toBe("ntlm ok");
		transport.dispose();
	});
});
