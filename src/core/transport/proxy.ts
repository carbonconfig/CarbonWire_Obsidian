import * as net from "node:net";
import * as tls from "node:tls";

/* Proxies: HTTP and HTTPS proxies (CONNECT, or absolute URLs for plain HTTP), and SOCKS5. */

export interface ProxyTarget {
	/** http:, https:, socks5: or socks5h:. */
	url: URL;
	username?: string;
	password?: string;
}

export class ProxyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProxyError";
	}
}

/** A proxy URL such as http://proxy:3128 or socks5://user@proxy:1080; undefined when empty. */
export function parseProxyUrl(raw: string | undefined, password?: string): ProxyTarget | undefined {
	const text = raw?.trim();
	if (!text) return undefined;
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
	} catch {
		throw new ProxyError(`The proxy ${text} isn't a valid URL.`);
	}
	if (!["http:", "https:", "socks5:", "socks5h:", "socks:"].includes(url.protocol)) throw new ProxyError(`Proxies of type ${url.protocol.slice(0, -1)} aren't supported; use http, https or socks5.`);
	const username = url.username ? decodeURIComponent(url.username) : undefined;
	const pass = password ?? (url.password ? decodeURIComponent(url.password) : undefined);
	url.username = "";
	url.password = "";
	return { url, username, password: pass };
}

/** Whether a NO_PROXY-style list (comma or space separated hosts, .suffix, *.suffix, host:port, *) skips the proxy for `url`. */
export function bypasses(list: string | undefined, url: URL): boolean {
	if (!list) return false;
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	for (const raw of list.split(/[\s,]+/)) {
		const entry = raw.trim().toLowerCase();
		if (!entry) continue;
		if (entry === "*") return true;
		const at = entry.lastIndexOf(":");
		const [name, entryPort] = at > 0 && !entry.includes("]") && /^\d+$/.test(entry.slice(at + 1)) ? [entry.slice(0, at), entry.slice(at + 1)] : [entry, undefined];
		if (entryPort && entryPort !== port) continue;
		const bare = name.replace(/^\*?\./, "");
		if (host === bare || host.endsWith(`.${bare}`)) return true;
	}
	return false;
}

/** The proxy from HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and NO_PROXY, as curl reads them. */
export function proxyFromEnvironment(url: URL, env: NodeJS.ProcessEnv = process.env): ProxyTarget | undefined {
	const read = (name: string) => env[name.toLowerCase()] ?? env[name.toUpperCase()];
	if (bypasses(read("no_proxy"), url)) return undefined;
	const raw = (url.protocol === "https:" ? read("https_proxy") : read("http_proxy")) ?? read("all_proxy");
	try {
		return parseProxyUrl(raw);
	} catch {
		return undefined;
	}
}

export function proxyAuthorization(proxy: ProxyTarget): string | undefined {
	if (proxy.username === undefined) return undefined;
	return `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}`;
}

function connectToProxy(proxy: ProxyTarget, rejectUnauthorized: boolean): Promise<net.Socket> {
	const host = proxy.url.hostname.replace(/^\[|\]$/g, "");
	const isHttps = proxy.url.protocol === "https:";
	const port = Number(proxy.url.port) || (isHttps ? 443 : proxy.url.protocol.startsWith("socks") ? 1080 : 80);
	return new Promise((resolve, reject) => {
		const socket = isHttps ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized }) : net.connect({ host, port });
		const fail = (e: Error) => reject(new ProxyError(`Couldn't reach the proxy ${proxy.url.host}: ${e.message}`));
		socket.once("error", fail);
		socket.once(isHttps ? "secureConnect" : "connect", () => {
			socket.off("error", fail);
			resolve(socket);
		});
	});
}

function readUntil(socket: net.Socket, done: (data: Buffer) => number | undefined): Promise<{ head: Buffer; rest: Buffer }> {
	return new Promise((resolve, reject) => {
		let data = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			data = Buffer.concat([data, chunk]);
			const end = done(data);
			if (end === undefined) {
				if (data.length > 65_536) finish(new ProxyError("The proxy's answer was too long."));
				return;
			}
			finish(undefined, { head: data.subarray(0, end), rest: data.subarray(end) });
		};
		const onClose = () => finish(new ProxyError("The proxy closed the connection."));
		const finish = (error?: Error, result?: { head: Buffer; rest: Buffer }) => {
			socket.off("data", onData);
			socket.off("error", finish);
			socket.off("close", onClose);
			if (error) reject(error);
			else resolve(result!);
		};
		socket.on("data", onData);
		socket.once("error", finish);
		socket.once("close", onClose);
	});
}

async function httpConnect(socket: net.Socket, proxy: ProxyTarget, host: string, port: number): Promise<void> {
	const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
	const auth = proxyAuthorization(proxy);
	socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ""}\r\n`);
	const { head, rest } = await readUntil(socket, (d) => {
		const end = d.indexOf("\r\n\r\n");
		return end < 0 ? undefined : end + 4;
	});
	const status = /^HTTP\/1\.[01] (\d{3})(.*)/.exec(head.toString("latin1"));
	if (status?.[1] !== "200") {
		const code = status?.[1] ?? "no answer";
		const hint = code === "407" ? " The proxy needs a user name and password." : "";
		throw new ProxyError(`The proxy refused to connect to ${target}: ${code}${status?.[2] ?? ""}.${hint}`);
	}
	if (rest.length > 0) socket.unshift(rest);
}

const SOCKS_ERRORS: Record<number, string> = {
	1: "general failure",
	2: "not allowed by the proxy's rules",
	3: "network unreachable",
	4: "host unreachable",
	5: "connection refused",
	6: "TTL expired",
	7: "command not supported",
	8: "address type not supported",
};

async function socks5(socket: net.Socket, proxy: ProxyTarget, host: string, port: number): Promise<void> {
	const withAuth = proxy.username !== undefined;
	socket.write(Buffer.from(withAuth ? [5, 2, 0, 2] : [5, 1, 0]));
	let { head, rest } = await readUntil(socket, (d) => (d.length >= 2 ? 2 : undefined));
	if (head[0] !== 5) throw new ProxyError("The SOCKS proxy answered with something other than SOCKS5.");
	if (head[1] === 2) {
		if (!withAuth) throw new ProxyError("The SOCKS proxy needs a user name and password.");
		const user = Buffer.from(proxy.username ?? "");
		const pass = Buffer.from(proxy.password ?? "");
		socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
		({ head, rest } = await readUntil(socket, (d) => (d.length >= 2 ? 2 : undefined)));
		if (head[1] !== 0) throw new ProxyError("The SOCKS proxy refused the user name and password.");
	} else if (head[1] !== 0) {
		throw new ProxyError("The SOCKS proxy accepts none of the sign-in methods CarbonWire offers.");
	}
	if (rest.length > 0) socket.unshift(rest);
	let address: Buffer;
	if (net.isIPv4(host)) address = Buffer.from([1, ...host.split(".").map(Number)]);
	else if (net.isIPv6(host)) {
		const full = new URL(`http://[${host}]`).hostname.slice(1, -1);
		const groups = full.includes("::") ? expandIpv6(full) : full.split(":");
		address = Buffer.concat([Buffer.from([4]), ...groups.map((g) => Buffer.from([parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]))]);
	} else {
		const name = Buffer.from(host);
		address = Buffer.concat([Buffer.from([3, name.length]), name]);
	}
	socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, Buffer.from([port >> 8, port & 0xff])]));
	({ head, rest } = await readUntil(socket, (d) => {
		if (d.length < 5) return undefined;
		const length = d[3] === 1 ? 4 : d[3] === 4 ? 16 : d[3] === 3 ? 1 + d[4]! : 0;
		return d.length >= 4 + length + 2 ? 4 + length + 2 : undefined;
	}));
	if (head[1] !== 0) throw new ProxyError(`The SOCKS proxy couldn't connect to ${host}:${port}: ${SOCKS_ERRORS[head[1]!] ?? `error ${head[1]}`}.`);
	if (rest.length > 0) socket.unshift(rest);
}

function expandIpv6(text: string): string[] {
	const [left, right] = text.split("::");
	const l = left ? left.split(":") : [];
	const r = right ? right.split(":") : [];
	return [...l, ...Array<string>(8 - l.length - r.length).fill("0"), ...r];
}

/** A socket to host:port through the proxy, with the tunnel open. */
export async function tunnel(proxy: ProxyTarget, host: string, port: number, rejectUnauthorized: boolean): Promise<net.Socket> {
	const socket = await connectToProxy(proxy, rejectUnauthorized);
	try {
		if (proxy.url.protocol.startsWith("socks")) await socks5(socket, proxy, host, port);
		else await httpConnect(socket, proxy, host, port);
		return socket;
	} catch (e) {
		socket.destroy();
		throw e;
	}
}
