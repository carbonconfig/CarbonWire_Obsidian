import * as http from "node:http";
import type * as http2 from "node:http2";
import * as https from "node:https";
import * as net from "node:net";
import type { Readable, Transform } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import { findHeader } from "../headers";
import type { Header } from "../model";
import { proxyAuthorization, tunnel, type ProxyTarget } from "./proxy";
import {
	TransportError,
	type CertificateInfo,
	type Redirect,
	type TlsDetails,
	type Transport,
	type TransportRequest,
	type TransportResponse,
} from "./types";

const PROGRESS_INTERVAL_MS = 100;

interface Hop {
	method: string;
	url: string;
	headers: readonly Header[];
	body?: Uint8Array;
}

/** A client certificate for a host, from the settings. */
export interface ClientCertificate {
	/** Identifies the certificate, so connections using different ones aren't shared. */
	id: string;
	cert?: string | Buffer;
	key?: string | Buffer;
	pfx?: Buffer;
	passphrase?: string;
}

export interface NodeTransportOptions {
	/** The proxy for a URL, or undefined to connect directly. Read for each hop. */
	proxy?: (url: URL) => ProxyTarget | undefined;
	clientCertificate?: (url: URL) => ClientCertificate | undefined;
	/** Extra certificate authorities to trust besides the system's; `id` changes when they do. */
	ca?: () => { id: string; certs: string[] } | undefined;
}

type Done = Omit<TransportResponse, "redirects">;

export class NodeTransport implements Transport {
	private readonly agents = new Map<string, http.Agent>();
	private readonly pinned = new WeakMap<object, http.Agent>();
	private readonly sessions = new Map<string, http2.ClientHttp2Session>();
	/** Origins found to speak HTTP/2 over ALPN, or not, for "auto". */
	private readonly alpn = new Map<string, boolean>();
	private h2?: typeof import("node:http2");

	/** `userAgent` is sent unless the request sets its own User-Agent header. */
	constructor(
		private readonly userAgent = "CarbonWire",
		private readonly options: NodeTransportOptions = {},
	) {}

	async send(request: TransportRequest): Promise<TransportResponse> {
		if (request.signal?.aborted) throw new TransportError("aborted", "Request cancelled");
		const redirects: Redirect[] = [];
		let hop: Hop = { method: request.method, url: request.url, headers: request.headers, body: request.body };

		for (;;) {
			const response = await this.hop(request, hop);
			const location = findHeader(response.headers, "location");
			if (!request.followRedirects || !isRedirect(response.status) || location === undefined) {
				return { ...response, redirects };
			}
			if (redirects.length >= request.maxRedirects) {
				throw new TransportError("too-many-redirects", `Exceeded ${request.maxRedirects} redirects`);
			}
			redirects.push({ status: response.status, url: hop.url });
			hop = nextHop(hop, response.status, new URL(location, hop.url).toString(), request.forwardAuthorizationHeader, request.keepMethod === true);
		}
	}

	release(connection: object): void {
		this.pinned.get(connection)?.destroy();
		this.pinned.delete(connection);
	}

	dispose(): void {
		for (const agent of this.agents.values()) agent.destroy();
		this.agents.clear();
		for (const session of this.sessions.values()) session.close();
		this.sessions.clear();
	}

	private async hop(request: TransportRequest, hop: Hop): Promise<Done> {
		let url: URL;
		try {
			url = new URL(hop.url);
		} catch {
			throw new TransportError("invalid-url", `Invalid URL: ${hop.url}`);
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new TransportError("invalid-url", `Unsupported protocol: ${url.protocol}`);
		const cookie = request.cookies?.header(url);
		const headers = cookie ? withCookies(hop.headers, cookie) : hop.headers;
		const proxy = this.options.proxy?.(url);
		const version = request.httpVersion ?? "http1";
		let useH2 = url.protocol === "https:" && version === "http2";
		if (url.protocol === "https:" && version === "auto" && !request.connection) useH2 = await this.speaksH2(url, request, proxy);
		const response = useH2 ? await this.exchangeH2(request, { ...hop, headers }, url, proxy) : await this.exchange(request, { ...hop, headers }, url, proxy);
		const setCookies = response.headers.filter(([n]) => n.toLowerCase() === "set-cookie").map(([, v]) => v);
		if (setCookies.length > 0) request.cookies?.store(url, setCookies);
		return response;
	}

	private tlsOptions(request: TransportRequest, url: URL): tls.ConnectionOptions & { id: string } {
		const versions = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"] as const;
		const disabled = new Set(request.disabledTlsVersions ?? []);
		const enabled = versions.filter((v) => !disabled.has(v));
		const options: tls.ConnectionOptions = { rejectUnauthorized: request.rejectUnauthorized };
		if (disabled.size > 0 && enabled.length > 0) {
			options.minVersion = enabled[0];
			options.maxVersion = enabled[enabled.length - 1];
		}
		if (request.ciphers && request.ciphers.length > 0) options.ciphers = request.ciphers.join(":");
		const cert = this.options.clientCertificate?.(url);
		if (cert) Object.assign(options, { cert: cert.cert, key: cert.key, pfx: cert.pfx, passphrase: cert.passphrase });
		const ca = this.options.ca?.();
		if (ca && ca.certs.length > 0) options.ca = [...tls.rootCertificates, ...ca.certs];
		const id = JSON.stringify([request.rejectUnauthorized, options.minVersion, options.maxVersion, options.ciphers, cert?.id, ca?.id]);
		return { ...options, id };
	}

	private agent(isHttps: boolean, request: TransportRequest, url: URL, proxy: ProxyTarget | undefined): http.Agent {
		const tlsOptions = isHttps ? this.tlsOptions(request, url) : undefined;
		if (request.connection) {
			let agent = this.pinned.get(request.connection);
			if (!agent) {
				agent = makeAgent(isHttps, tlsOptions, proxy, 1);
				this.pinned.set(request.connection, agent);
			}
			return agent;
		}
		const key = JSON.stringify([isHttps, tlsOptions?.id, proxy?.url.href, proxy?.username]);
		let agent = this.agents.get(key);
		if (!agent) {
			agent = makeAgent(isHttps, tlsOptions, proxy, Infinity);
			this.agents.set(key, agent);
		}
		return agent;
	}

	private exchange(options: TransportRequest, hop: Hop, url: URL, proxy: ProxyTarget | undefined): Promise<Done> {
		return new Promise((resolve, reject) => {
			const isHttps = url.protocol === "https:";
			const t0 = performance.now();
			let tLookup: number | undefined;
			let tConnect: number | undefined;
			let tSecure: number | undefined;
			let tResponse = 0;
			let settled = false;
			// Set before destroying the request so the caller sees why, not a generic socket error.
			let abortReason: TransportError | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timer) clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
			};
			const fail = (err: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(abortReason ?? toTransportError(err));
			};

			const outgoing = outgoingHeaders(hop.headers, hop.body, this.userAgent, options.omitHeaders);
			const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
			// Plain HTTP through an HTTP proxy asks the proxy for the absolute URL; the rest tunnel.
			const absolute = proxy !== undefined && !isHttps && !proxy.url.protocol.startsWith("socks");
			const args: http.RequestOptions = absolute
				? {
						protocol: proxy.url.protocol,
						hostname: proxy.url.hostname.replace(/^\[|\]$/g, ""),
						port: proxy.url.port || (proxy.url.protocol === "https:" ? 443 : 80),
						path: url.href,
						method: hop.method,
						headers: { ...outgoing, Host: url.host, ...(proxyAuthorization(proxy) ? { "Proxy-Authorization": proxyAuthorization(proxy) } : {}) },
						agent: this.agent(proxy.url.protocol === "https:", options, proxy.url, undefined),
					}
				: {
						protocol: url.protocol,
						hostname,
						port: url.port || undefined,
						path: url.pathname + url.search,
						method: hop.method,
						headers: outgoing,
						agent: this.agent(isHttps, options, url, proxy),
					};
			const req = (isHttps ? https : http).request(args);

			const onAbort = () => {
				abortReason = new TransportError("aborted", "Request cancelled");
				req.destroy(abortReason);
			};
			options.signal?.addEventListener("abort", onAbort, { once: true });
			if (options.timeoutMs > 0) {
				timer = setTimeout(() => {
					abortReason = new TransportError("timeout", `Timed out after ${options.timeoutMs} ms`);
					req.destroy(abortReason);
				}, options.timeoutMs);
			}

			const progress = options.onProgress;
			progress?.({ phase: "connecting" });
			req.on("socket", (socket: net.Socket) => {
				if (req.reusedSocket) {
					progress?.({ phase: "sending" });
					return;
				}
				socket.once("lookup", () => (tLookup = performance.now()));
				socket.once("connect", () => {
					tConnect = performance.now();
					progress?.({ phase: isHttps ? "securing" : "sending" });
				});
				if (isHttps) {
					socket.once("secureConnect", () => {
						tSecure = performance.now();
						progress?.({ phase: "sending" });
					});
				}
			});
			req.on("finish", () => progress?.({ phase: "waiting" }));
			req.on("error", fail);

			req.on("response", (res) => {
				tResponse = performance.now();
				const tlsDetails = isHttps && res.socket instanceof tls.TLSSocket ? describeTls(res.socket) : undefined;
				const remote = res.socket?.remoteAddress;
				const remotePort = res.socket?.remotePort;
				readBody(res, hop.method, res.statusCode ?? 0, res.headers["content-encoding"], options, fail, (body, bodyBytes, truncated) => {
					if (settled) return;
					settled = true;
					cleanup();
					const tEnd = performance.now();
					const reused = req.reusedSocket;
					const connectStart = tLookup ?? t0;
					const sent = tSecure ?? tConnect ?? t0;
					resolve({
						url: hop.url,
						status: res.statusCode ?? 0,
						statusText: res.statusMessage ?? "",
						httpVersion: res.httpVersion,
						headers: pairs(res.rawHeaders),
						body,
						bodyBytes,
						truncated,
						timings: {
							dns: reused || tLookup === undefined ? 0 : tLookup - t0,
							connect: reused || tConnect === undefined ? 0 : tConnect - connectStart,
							tls: reused || tSecure === undefined || tConnect === undefined ? 0 : tSecure - tConnect,
							wait: tResponse - (reused ? t0 : sent),
							download: tEnd - tResponse,
							total: tEnd - t0,
							reusedConnection: reused,
						},
						remoteAddress: proxy ? undefined : remote,
						remotePort: proxy ? undefined : remotePort,
						tls: tlsDetails,
						sent: { method: hop.method, url: hop.url, headers: sentHeaders(outgoing) },
						proxy: proxy ? proxy.url.host : undefined,
					});
				});
			});

			req.end(hop.body);
		});
	}

	/** Whether the origin picks HTTP/2 over ALPN; asked once per origin, then remembered. */
	private async speaksH2(url: URL, request: TransportRequest, proxy: ProxyTarget | undefined): Promise<boolean> {
		const known = this.alpn.get(url.origin);
		if (known !== undefined) return known;
		const options = this.tlsOptions(request, url);
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const port = Number(url.port) || 443;
		const raw = proxy ? await tunnel(proxy, host, port, request.rejectUnauthorized).catch((e: unknown) => Promise.reject(toTransportError(e))) : undefined;
		const result = await new Promise<boolean>((resolve) => {
			const socket = tls.connect({ ...options, host, port, socket: raw, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ["h2", "http/1.1"] });
			socket.once("secureConnect", () => {
				resolve(socket.alpnProtocol === "h2");
				socket.destroy();
			});
			socket.once("error", () => resolve(false));
		});
		this.alpn.set(url.origin, result);
		return result;
	}

	private async session(request: TransportRequest, url: URL, proxy: ProxyTarget | undefined): Promise<{ session: http2.ClientHttp2Session; fresh: boolean }> {
		this.h2 ??= await import("node:http2");
		const options = this.tlsOptions(request, url);
		const key = JSON.stringify([url.origin, options.id, proxy?.url.href, proxy?.username]);
		const existing = this.sessions.get(key);
		if (existing && !existing.closed && !existing.destroyed) return { session: existing, fresh: false };
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const port = Number(url.port) || 443;
		const raw = proxy ? await tunnel(proxy, host, port, request.rejectUnauthorized) : undefined;
		const session = this.h2.connect(url.origin, {
			...options,
			createConnection: () => tls.connect({ ...options, host, port, socket: raw, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ["h2"] }),
		});
		session.on("error", () => this.sessions.delete(key));
		session.on("close", () => this.sessions.delete(key));
		// An idle session shouldn't keep the process alive.
		session.unref();
		this.sessions.set(key, session);
		return { session, fresh: true };
	}

	private async exchangeH2(options: TransportRequest, hop: Hop, url: URL, proxy: ProxyTarget | undefined): Promise<Done> {
		const t0 = performance.now();
		options.onProgress?.({ phase: "connecting" });
		let opened: { session: http2.ClientHttp2Session; fresh: boolean };
		try {
			opened = await this.session(options, url, proxy);
		} catch (e) {
			throw toTransportError(e);
		}
		const { session, fresh } = opened;
		return new Promise((resolve, reject) => {
			let tSecure: number | undefined;
			let settled = false;
			let abortReason: TransportError | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const outgoing = outgoingHeaders(hop.headers, hop.body, this.userAgent, options.omitHeaders);
			const h2Headers: http2.OutgoingHttpHeaders = { ":method": hop.method, ":path": url.pathname + url.search, ":authority": url.host, ":scheme": "https" };
			// HTTP/2 forbids connection-specific headers.
			for (const [name, value] of Object.entries(outgoing)) {
				const lower = name.toLowerCase();
				if (["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "host"].includes(lower)) continue;
				h2Headers[lower] = value;
			}
			const cleanup = () => {
				if (timer) clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
			};
			const fail = (err: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(abortReason ?? toTransportError(err));
			};
			if (fresh && session.connecting) session.once("connect", () => (tSecure = performance.now()));
			const stream = session.request(h2Headers, { endStream: !hop.body });
			const onAbort = () => {
				abortReason = new TransportError("aborted", "Request cancelled");
				stream.close();
				fail(abortReason);
			};
			options.signal?.addEventListener("abort", onAbort, { once: true });
			if (options.timeoutMs > 0) {
				timer = setTimeout(() => {
					abortReason = new TransportError("timeout", `Timed out after ${options.timeoutMs} ms`);
					stream.close();
					fail(abortReason);
				}, options.timeoutMs);
			}
			stream.on("error", fail);
			if (hop.body) stream.end(hop.body);
			options.onProgress?.({ phase: "waiting" });
			stream.on("response", (responseHeaders) => {
				const tResponse = performance.now();
				const status = Number(responseHeaders[":status"] ?? 0);
				const headers: Header[] = [];
				for (const [name, value] of Object.entries(responseHeaders)) {
					if (name.startsWith(":") || value === undefined) continue;
					for (const v of Array.isArray(value) ? value : [value]) headers.push([name, String(v)]);
				}
				const socket = session.socket as tls.TLSSocket | undefined;
				const tlsDetails = socket ? describeTls(socket) : undefined;
				readBody(stream, hop.method, status, findHeader(headers, "content-encoding"), options, fail, (body, bodyBytes, truncated) => {
					if (settled) return;
					settled = true;
					cleanup();
					const tEnd = performance.now();
					resolve({
						url: hop.url,
						status,
						statusText: http.STATUS_CODES[status] ?? "",
						httpVersion: "2",
						headers,
						body,
						bodyBytes,
						truncated,
						timings: {
							dns: 0,
							connect: 0,
							tls: fresh && tSecure !== undefined ? tSecure - t0 : 0,
							wait: tResponse - (fresh && tSecure !== undefined ? tSecure : t0),
							download: tEnd - tResponse,
							total: tEnd - t0,
							reusedConnection: !fresh,
						},
						remoteAddress: proxy ? undefined : socket?.remoteAddress,
						remotePort: proxy ? undefined : socket?.remotePort,
						tls: tlsDetails,
						sent: { method: hop.method, url: hop.url, headers: sentHeaders(outgoing) },
						proxy: proxy ? proxy.url.host : undefined,
					});
				});
			});
		});
	}
}

/** A keep-alive agent; through a proxy, its connections are tunnels opened by `tunnel`. */
function makeAgent(isHttps: boolean, tlsOptions: (tls.ConnectionOptions & { id: string }) | undefined, proxy: ProxyTarget | undefined, maxSockets: number): http.Agent {
	const base = { keepAlive: true, scheduling: "lifo" as const, maxSockets };
	if (!proxy) return isHttps ? new https.Agent({ ...base, ...stripId(tlsOptions) }) : new http.Agent(base);
	const options = stripId(tlsOptions);
	const open = (target: { host?: string | null; hostname?: string | null; port?: number | string | null; servername?: string }, callback: (err: Error | null, socket?: net.Socket) => void) => {
		const host = (target.hostname ?? target.host ?? "").replace(/^\[|\]$/g, "");
		const port = Number(target.port) || (isHttps ? 443 : 80);
		tunnel(proxy, host, port, options?.rejectUnauthorized !== false).then(
			(socket) => {
				if (!isHttps) return callback(null, socket);
				const secure = tls.connect({ ...options, socket, servername: target.servername ?? (net.isIP(host) ? undefined : host) });
				secure.once("secureConnect", () => callback(null, secure));
				secure.once("error", (e: Error) => callback(e));
			},
			(e: Error) => callback(e),
		);
		return undefined;
	};
	const agent = isHttps ? new https.Agent({ ...base, ...options }) : new http.Agent(base);
	(agent as unknown as { createConnection: typeof open }).createConnection = open;
	return agent;
}

function stripId<T extends { id: string }>(value: T | undefined): Omit<T, "id"> | undefined {
	if (!value) return undefined;
	const rest: Partial<T> = { ...value };
	delete rest.id;
	return rest as Omit<T, "id">;
}

function readBody(
	res: Readable,
	method: string,
	status: number,
	encoding: string | string[] | undefined,
	options: TransportRequest,
	fail: (err: unknown) => void,
	done: (body: Uint8Array, bodyBytes: number, truncated: boolean) => void,
): void {
	const decoder = hasBody(method, status) ? decompressor(Array.isArray(encoding) ? encoding[0] : encoding) : undefined;
	const stream: Readable = decoder ? res.pipe(decoder) : res;
	const chunks: Buffer[] = [];
	let kept = 0;
	let total = 0;
	let truncated = false;
	res.on("error", fail);
	decoder?.on("error", fail);
	const progress = options.onProgress;
	if (progress) {
		const length = Number((res as unknown as { headers?: Record<string, unknown> }).headers?.["content-length"]);
		const expected = Number.isFinite(length) && length > 0 ? length : undefined;
		let received = 0;
		let reported = 0;
		progress({ phase: "downloading", received, total: expected });
		res.on("data", (chunk: Buffer) => {
			received += chunk.length;
			const now = performance.now();
			if (now - reported < PROGRESS_INTERVAL_MS) return;
			reported = now;
			progress({ phase: "downloading", received, total: expected });
		});
	}
	stream.on("data", (chunk: Buffer) => {
		total += chunk.length;
		const room = options.maxBodyBytes - kept;
		if (room <= 0) {
			truncated = true;
		} else if (chunk.length > room) {
			chunks.push(chunk.subarray(0, room));
			kept += room;
			truncated = true;
		} else {
			chunks.push(chunk);
			kept += chunk.length;
		}
	});
	stream.on("end", () => done(Buffer.concat(chunks, kept), total, truncated));
}

function describeTls(socket: tls.TLSSocket): TlsDetails | undefined {
	try {
		const certificates: CertificateInfo[] = [];
		let cert = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate | undefined;
		const seen = new Set<string>();
		while (cert && Object.keys(cert).length > 0 && !seen.has(cert.fingerprint256)) {
			seen.add(cert.fingerprint256);
			certificates.push({
				subject: name(cert.subject),
				issuer: name(cert.issuer),
				validFrom: cert.valid_from,
				validTo: cert.valid_to,
				fingerprint256: cert.fingerprint256,
				subjectAltName: cert.subjectaltname,
			});
			cert = cert.issuerCertificate;
		}
		const authorizationError = socket.authorizationError;
		return {
			protocol: socket.getProtocol() ?? undefined,
			cipher: socket.getCipher()?.standardName ?? socket.getCipher()?.name,
			certificates,
			authorized: socket.authorized,
			authorizationError: authorizationError ? String(authorizationError) : undefined,
		};
	} catch {
		return undefined;
	}
}

function name(fields: tls.Certificate | undefined): string {
	if (!fields) return "";
	const parts: string[] = [];
	for (const key of ["CN", "O", "OU", "L", "ST", "C"] as const) {
		const value = fields[key];
		if (value) parts.push(`${key}=${Array.isArray(value) ? value.join(", ") : value}`);
	}
	return parts.join(", ");
}

function withCookies(headers: readonly Header[], jar: string): Header[] {
	const out = [...headers];
	const i = out.findIndex(([n]) => n.toLowerCase() === "cookie");
	if (i >= 0) out[i] = [out[i]![0], `${out[i]![1]}; ${jar}`];
	else out.push(["Cookie", jar]);
	return out;
}

function outgoingHeaders(headers: readonly Header[], body: Uint8Array | undefined, userAgent: string, omit: readonly string[] = []): http.OutgoingHttpHeaders {
	const out: http.OutgoingHttpHeaders = {};
	const names = new Map<string, string>();
	for (const [name, value] of headers) {
		const lower = name.toLowerCase();
		if (lower === "content-length") continue;
		const key = names.get(lower);
		if (key === undefined) {
			names.set(lower, name);
			out[name] = value;
		} else {
			const prev = out[key];
			out[key] = Array.isArray(prev) ? [...prev, value] : [String(prev), value];
		}
	}
	if (!names.has("user-agent") && !omit.includes("user-agent")) out["User-Agent"] = userAgent;
	if (!names.has("accept") && !omit.includes("accept")) out["Accept"] = "*/*";
	if (!names.has("accept-encoding") && !omit.includes("accept-encoding")) out["Accept-Encoding"] = "gzip, deflate, br";
	if (body) out["Content-Length"] = body.byteLength;
	return out;
}

function sentHeaders(out: http.OutgoingHttpHeaders): Header[] {
	const list: Header[] = [];
	for (const [name, value] of Object.entries(out)) {
		if (value === undefined) continue;
		for (const v of Array.isArray(value) ? value : [value]) list.push([name, String(v)]);
	}
	return list;
}

function nextHop(hop: Hop, status: number, url: string, forwardAuth: boolean, keepMethod: boolean): Hop {
	let { method, body, headers } = hop;
	const switches = (status === 303 && method !== "HEAD") || ((status === 301 || status === 302) && method === "POST");
	if (switches && !keepMethod) {
		method = "GET";
		body = undefined;
		headers = headers.filter(([n]) => n.toLowerCase() !== "content-type");
	}
	if (!forwardAuth && new URL(url).origin !== new URL(hop.url).origin) {
		headers = headers.filter(([n]) => {
			const lower = n.toLowerCase();
			return lower !== "authorization" && lower !== "cookie";
		});
	}
	return { method, url, headers, body };
}

function decompressor(encoding: string | undefined): Transform | undefined {
	const flush = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
	switch (encoding?.trim().toLowerCase()) {
		case "gzip":
		case "x-gzip":
			return zlib.createGunzip(flush);
		case "deflate":
			return zlib.createInflate(flush);
		case "br":
			return zlib.createBrotliDecompress();
		case "zstd":
			return "createZstdDecompress" in zlib ? zlib.createZstdDecompress() : undefined;
		default:
			return undefined;
	}
}

function hasBody(method: string, status: number): boolean {
	return method !== "HEAD" && status !== 204 && status !== 304 && !(status >= 100 && status < 200);
}

function isRedirect(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function pairs(raw: readonly string[]): Header[] {
	const out: Header[] = [];
	for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i]!, raw[i + 1]!]);
	return out;
}

function toTransportError(err: unknown): TransportError {
	if (err instanceof TransportError) return err;
	const e = err as NodeJS.ErrnoException;
	return new TransportError("network", e?.message ?? String(err), { code: e?.code, message: e?.message ?? String(err) });
}
