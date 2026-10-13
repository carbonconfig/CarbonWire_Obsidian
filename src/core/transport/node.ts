import * as http from "node:http";
import * as https from "node:https";
import type { Socket } from "node:net";
import type { Transform } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import * as zlib from "node:zlib";
import { findHeader } from "../headers";
import type { Header } from "../model";
import {
	TransportError,
	type Redirect,
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

export class NodeTransport implements Transport {
	private readonly agents = new Map<string, http.Agent>();

	/** Sent unless the request sets its own User-Agent header. */
	constructor(private readonly userAgent = "CarbonWire") {}

	async send(request: TransportRequest): Promise<TransportResponse> {
		if (request.signal?.aborted) throw new TransportError("aborted", "Request cancelled");
		const redirects: Redirect[] = [];
		let hop: Hop = { method: request.method, url: request.url, headers: request.headers, body: request.body };

		for (;;) {
			const response = await this.exchange(request, hop);
			const location = findHeader(response.headers, "location");
			if (!request.followRedirects || !isRedirect(response.status) || location === undefined) {
				return { ...response, redirects };
			}
			if (redirects.length >= request.maxRedirects) {
				throw new TransportError("too-many-redirects", `Exceeded ${request.maxRedirects} redirects`);
			}
			redirects.push({ status: response.status, url: hop.url });
			hop = nextHop(hop, response.status, new URL(location, hop.url).toString(), request.forwardAuthorizationHeader);
		}
	}

	dispose(): void {
		for (const agent of this.agents.values()) agent.destroy();
		this.agents.clear();
	}

	private agent(isHttps: boolean, rejectUnauthorized: boolean): http.Agent {
		const key = `${isHttps ? "https" : "http"}:${rejectUnauthorized}`;
		let agent = this.agents.get(key);
		if (!agent) {
			agent = isHttps
				? new https.Agent({ keepAlive: true, scheduling: "lifo", rejectUnauthorized })
				: new http.Agent({ keepAlive: true, scheduling: "lifo" });
			this.agents.set(key, agent);
		}
		return agent;
	}

	private exchange(options: TransportRequest, hop: Hop): Promise<Omit<TransportResponse, "redirects">> {
		return new Promise((resolve, reject) => {
			let url: URL;
			try {
				url = new URL(hop.url);
			} catch {
				reject(new TransportError("invalid-url", `Invalid URL: ${hop.url}`));
				return;
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				reject(new TransportError("invalid-url", `Unsupported protocol: ${url.protocol}`));
				return;
			}
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

			const req = (isHttps ? https : http).request({
				protocol: url.protocol,
				hostname: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
				port: url.port || undefined,
				path: url.pathname + url.search,
				method: hop.method,
				headers: outgoingHeaders(hop.headers, hop.body, this.userAgent),
				agent: this.agent(isHttps, options.rejectUnauthorized),
			});

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
			req.on("socket", (socket: Socket) => {
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
				const decoder = hasBody(hop.method, res.statusCode ?? 0) ? decompressor(res.headers["content-encoding"]) : undefined;
				const stream = decoder ? res.pipe(decoder) : res;
				const chunks: Buffer[] = [];
				let kept = 0;
				let total = 0;
				let truncated = false;

				res.on("error", fail);
				decoder?.on("error", fail);
				if (progress) {
					const length = Number(res.headers["content-length"]);
					const total = Number.isFinite(length) && length > 0 ? length : undefined;
					let received = 0;
					let reported = 0;
					progress({ phase: "downloading", received, total });
					res.on("data", (chunk: Buffer) => {
						received += chunk.length;
						const now = performance.now();
						if (now - reported < PROGRESS_INTERVAL_MS) return;
						reported = now;
						progress({ phase: "downloading", received, total });
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
				stream.on("end", () => {
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
						body: Buffer.concat(chunks, kept),
						bodyBytes: total,
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
						remoteAddress: res.socket?.remoteAddress,
					});
				});
			});

			req.end(hop.body);
		});
	}
}

function outgoingHeaders(headers: readonly Header[], body: Uint8Array | undefined, userAgent: string): http.OutgoingHttpHeaders {
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
	if (!names.has("user-agent")) out["User-Agent"] = userAgent;
	if (!names.has("accept")) out["Accept"] = "*/*";
	if (!names.has("accept-encoding")) out["Accept-Encoding"] = "gzip, deflate, br";
	if (body) out["Content-Length"] = body.byteLength;
	return out;
}

function nextHop(hop: Hop, status: number, url: string, forwardAuth: boolean): Hop {
	let { method, body, headers } = hop;
	if ((status === 303 && method !== "HEAD") || ((status === 301 || status === 302) && method === "POST")) {
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
