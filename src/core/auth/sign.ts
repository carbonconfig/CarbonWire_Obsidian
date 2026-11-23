import { constants, createHash, createHmac, createPrivateKey, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { findHeader, setHeader } from "../headers";
import type { Header } from "../model";

/*
 * Auth that signs each outgoing request: OAuth 1.0, AWS Signature v4, Hawk, Akamai EdgeGrid,
 * WSSE, JWT Bearer and ASAP.
 */

export interface Signable {
	method: string;
	url: string;
	headers: Header[];
	body: Uint8Array;
}

/** The moment and the randomness a signature uses, fixed in tests. */
export interface SignContext {
	/** Seconds since 1970. */
	now: number;
	nonce: string;
}

export function signContext(): SignContext {
	return { now: Math.floor(Date.now() / 1000), nonce: randomUUID().replace(/-/g, "") };
}

export class SignError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignError";
	}
}

type Auth = Record<string, unknown>;

function field(auth: Auth, key: string): string {
	const v = auth[key];
	if (typeof v === "string") return v;
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") return (v as { value: string }).value;
	return "";
}

const flag = (auth: Auth, key: string) => auth[key] === true || field(auth, key) === "true";
const or = (value: string, fallback: () => string) => (value === "" ? fallback() : value);

/** RFC 3986's unreserved characters stay; everything else is percent-encoded, upper case. */
export function encode(text: string, keepSlash = false): string {
	let out = "";
	for (const byte of new TextEncoder().encode(text)) {
		const c = String.fromCharCode(byte);
		if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) out += c;
		else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return out;
}

const hex = (bytes: Buffer) => bytes.toString("hex");
const hmac = (alg: string, key: string | Buffer, data: string | Uint8Array) => createHmac(alg, key).update(data).digest();
const digest = (alg: string, data: string | Uint8Array) => createHash(alg).update(data).digest();
const base64Url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function utc(seconds: number): { y: string; mo: string; d: string; h: string; mi: string; s: string } {
	const iso = new Date(seconds * 1000).toISOString();
	return { y: iso.slice(0, 4), mo: iso.slice(5, 7), d: iso.slice(8, 10), h: iso.slice(11, 13), mi: iso.slice(14, 16), s: iso.slice(17, 19) };
}

function parseUrl(raw: string): URL {
	try {
		return new URL(raw);
	} catch (e) {
		throw new SignError(`The URL can't be signed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function appendQuery(url: string, pairs: readonly (readonly [string, string])[]): string {
	const joined = pairs.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
	const hashAt = url.indexOf("#");
	const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
	const hash = hashAt >= 0 ? url.slice(hashAt) : "";
	return `${base}${base.includes("?") ? "&" : "?"}${joined}${hash}`;
}

function isForm(headers: readonly Header[]): boolean {
	return (findHeader(headers, "content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
}

/** Signs the request with `auth`, whose `type` is one of SIGNED_AUTH_TYPES. */
export function signRequest(auth: Auth, r: Signable, ctx: SignContext = signContext()): void {
	switch (auth.type) {
		case "oauth1":
			return oauth1(auth, r, ctx);
		case "awsv4":
			return awsv4(auth, r, ctx);
		case "hawk":
			return hawk(auth, r, ctx);
		case "edgegrid":
		case "akamai":
			return edgegrid(auth, r, ctx);
		case "wsse":
			return wsse(auth, r, ctx);
		case "jwt":
			return jwt(auth, r);
		case "asap":
			return asap(auth, r, ctx);
		default:
			throw new SignError(`"${String(auth.type)}" auth can't sign requests.`);
	}
}

// OAuth 1.0 (RFC 5849)

function oauth1(a: Auth, r: Signable, ctx: SignContext): void {
	const method = or(field(a, "signatureMethod"), () => "HMAC-SHA1");
	const oauth: [string, string][] = [
		["oauth_consumer_key", field(a, "consumerKey")],
		["oauth_signature_method", method],
		["oauth_timestamp", or(field(a, "timestamp"), () => String(ctx.now))],
		["oauth_nonce", or(field(a, "nonce"), () => ctx.nonce)],
	];
	const token = field(a, "accessToken");
	if (token) oauth.push(["oauth_token", token]);
	const version = a.version === undefined ? "1.0" : field(a, "version");
	if (version) oauth.push(["oauth_version", version]);
	if (field(a, "callbackUrl")) oauth.push(["oauth_callback", field(a, "callbackUrl")]);
	if (field(a, "verifier")) oauth.push(["oauth_verifier", field(a, "verifier")]);
	const form = isForm(r.headers);
	if (flag(a, "includeBodyHash") && !form && method !== "PLAINTEXT") {
		const alg = method.endsWith("SHA1") ? "sha1" : method.endsWith("SHA512") ? "sha512" : "sha256";
		oauth.push(["oauth_body_hash", digest(alg, r.body).toString("base64")]);
	}
	const url = parseUrl(r.url);
	const defaultPort = url.port === "" || (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
	const base = `${url.protocol}//${url.hostname.toLowerCase()}${defaultPort ? "" : `:${url.port}`}${url.pathname}`;
	const params: [string, string][] = [...new URLSearchParams(url.search)];
	if (form) params.push(...new URLSearchParams(new TextDecoder().decode(r.body)));
	params.push(...oauth);
	const normalized = params
		.map(([k, v]) => [encode(k), encode(v)] as const)
		.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
		.map(([k, v]) => `${k}=${v}`)
		.join("&");
	const baseString = `${r.method.toUpperCase()}&${encode(base)}&${encode(normalized)}`;
	const key = `${encode(field(a, "consumerSecret"))}&${encode(field(a, "accessTokenSecret"))}`;
	let signature: string;
	switch (method) {
		case "HMAC-SHA1":
		case "HMAC-SHA256":
		case "HMAC-SHA512":
			signature = hmac(method.slice(5).toLowerCase().replace("-", ""), key, baseString).toString("base64");
			break;
		case "PLAINTEXT":
			signature = key;
			break;
		case "RSA-SHA1":
		case "RSA-SHA256":
		case "RSA-SHA512":
			signature = rsaSign(field(a, "privateKey"), method.slice(4).toLowerCase().replace("-", ""), baseString).toString("base64");
			break;
		default:
			throw new SignError(`Unknown OAuth 1.0 signature method "${method}".`);
	}
	oauth.push(["oauth_signature", signature]);
	const placement = field(a, "placement");
	if (placement === "query" || placement === "body") {
		r.url = appendQuery(r.url, oauth);
		return;
	}
	const realm = field(a, "realm");
	const parts = [...(realm ? [`realm="${encode(realm)}"`] : []), ...oauth.map(([k, v]) => `${encode(k)}="${encode(v)}"`)];
	setHeader(r.headers, "Authorization", `OAuth ${parts.join(", ")}`);
}

// Keys

function privateKey(pem: string): KeyObject {
	if (!pem.trim().includes("-----BEGIN ")) throw new SignError("The private key isn't PEM (-----BEGIN ...).");
	return createPrivateKey(pem.trim());
}

function rsaSign(pem: string, hash: string, data: string, pss = false): Buffer {
	try {
		const key = privateKey(pem);
		return cryptoSign(hash, Buffer.from(data), pss ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } : key);
	} catch (e) {
		if (e instanceof SignError) throw e;
		throw new SignError(`Signing with the RSA key failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function ecSign(pem: string, hash: string, data: string): Buffer {
	try {
		return cryptoSign(hash, Buffer.from(data), { key: privateKey(pem), dsaEncoding: "ieee-p1363" });
	} catch (e) {
		if (e instanceof SignError) throw e;
		throw new SignError(`Signing with the EC key failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

// AWS Signature v4

function awsv4(a: Auth, r: Signable, ctx: SignContext): void {
	const service = or(field(a, "service"), () => "execute-api");
	const region = or(field(a, "region"), () => "us-east-1");
	const url = parseUrl(r.url);
	const t = utc(ctx.now);
	const date = `${t.y}${t.mo}${t.d}`;
	const amzDate = `${date}T${t.h}${t.mi}${t.s}Z`;
	const payload = hex(digest("sha256", r.body));
	setHeader(r.headers, "X-Amz-Date", amzDate);
	if (service === "s3") setHeader(r.headers, "X-Amz-Content-Sha256", payload);
	const token = field(a, "sessionToken");
	if (token) setHeader(r.headers, "X-Amz-Security-Token", token);
	const signed = new Map<string, string>([["host", url.host]]);
	for (const [name, value] of r.headers) {
		const lower = name.toLowerCase();
		if ((lower.startsWith("x-amz-") || lower === "content-type") && !signed.has(lower)) signed.set(lower, value.trim().split(/\s+/).join(" "));
	}
	const names = [...signed.keys()].sort();
	const path = url.pathname || "/";
	// Every service but S3 encodes the (already encoded) path once more.
	const canonicalPath = service === "s3" ? path : encode(path, true);
	const query = [...new URLSearchParams(url.search)]
		.map(([k, v]) => [encode(k), encode(v)] as const)
		.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
		.map(([k, v]) => `${k}=${v}`)
		.join("&");
	const canonicalHeaders = names.map((n) => `${n}:${signed.get(n)!.trim()}\n`).join("");
	const signedNames = names.join(";");
	const canonical = `${r.method.toUpperCase()}\n${canonicalPath}\n${query}\n${canonicalHeaders}\n${signedNames}\n${payload}`;
	const scope = `${date}/${region}/${service}/aws4_request`;
	const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hex(digest("sha256", canonical))}`;
	let key = hmac("sha256", `AWS4${field(a, "secretAccessKey")}`, date);
	for (const part of [region, service, "aws4_request"]) key = hmac("sha256", key, part);
	const signature = hex(hmac("sha256", key, toSign));
	setHeader(r.headers, "Authorization", `AWS4-HMAC-SHA256 Credential=${field(a, "accessKeyId")}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`);
}

// Hawk

function hawk(a: Auth, r: Signable, ctx: SignContext): void {
	const url = parseUrl(r.url);
	const alg = field(a, "algorithm").toLowerCase() === "sha1" ? "sha1" : "sha256";
	const ts = or(field(a, "timestamp"), () => String(ctx.now));
	const nonce = or(field(a, "nonce"), () => ctx.nonce.slice(0, 6));
	const ext = field(a, "extraData");
	const app = field(a, "app");
	const dlg = field(a, "delegation");
	const resource = url.pathname + url.search;
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	let hash = "";
	if (flag(a, "includePayloadHash")) {
		const type = (findHeader(r.headers, "content-type") ?? "").split(";")[0]!.trim().toLowerCase();
		const head = new TextEncoder().encode(`hawk.1.payload\n${type}\n`);
		hash = createHash(alg).update(head).update(r.body).update("\n").digest("base64");
	}
	let normalized = `hawk.1.header\n${ts}\n${nonce}\n${r.method.toUpperCase()}\n${resource}\n${url.hostname.toLowerCase()}\n${port}\n${hash}\n${ext.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}\n`;
	if (app) normalized += `${app}\n${dlg}\n`;
	const mac = hmac(alg, field(a, "authKey"), normalized).toString("base64");
	const parts = [`id="${field(a, "authId")}"`, `ts="${ts}"`, `nonce="${nonce}"`];
	if (hash) parts.push(`hash="${hash}"`);
	if (ext) parts.push(`ext="${ext.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
	parts.push(`mac="${mac}"`);
	if (app) {
		parts.push(`app="${app}"`);
		if (dlg) parts.push(`dlg="${dlg}"`);
	}
	setHeader(r.headers, "Authorization", `Hawk ${parts.join(", ")}`);
}

// Akamai EdgeGrid

/** Bodies are hashed up to this many bytes, as Akamai's libraries do. */
const EDGEGRID_MAX_BODY = 131_072;

function edgegrid(a: Auth, r: Signable, ctx: SignContext): void {
	const url = parseUrl(r.url);
	const t = utc(ctx.now);
	const timestamp = or(field(a, "timestamp"), () => `${t.y}${t.mo}${t.d}T${t.h}:${t.mi}:${t.s}+0000`);
	const nonce = or(field(a, "nonce"), () => randomUUID());
	const prefix = `EG1-HMAC-SHA256 client_token=${field(a, "clientToken")};access_token=${field(a, "accessToken")};timestamp=${timestamp};nonce=${nonce};`;
	const canonicalHeaders = field(a, "headersToSign")
		.split(",")
		.map((n) => n.trim())
		.filter(Boolean)
		.flatMap((n) => {
			const value = findHeader(r.headers, n);
			return value === undefined ? [] : [`${n.toLowerCase()}:${value.trim().split(/\s+/).join(" ")}\t`];
		})
		.join("");
	const contentHash = r.method.toUpperCase() === "POST" && r.body.length > 0 ? digest("sha256", r.body.subarray(0, EDGEGRID_MAX_BODY)).toString("base64") : "";
	const data = [r.method.toUpperCase(), url.protocol.slice(0, -1), url.host, url.pathname + url.search, canonicalHeaders, contentHash, prefix].join("\t");
	const key = hmac("sha256", field(a, "clientSecret"), timestamp).toString("base64");
	const signature = hmac("sha256", key, data).toString("base64");
	setHeader(r.headers, "Authorization", `${prefix}signature=${signature}`);
}

// WSSE

function wsse(a: Auth, r: Signable, ctx: SignContext): void {
	const t = utc(ctx.now);
	const created = `${t.y}-${t.mo}-${t.d}T${t.h}:${t.mi}:${t.s}Z`;
	const nonce = ctx.nonce;
	const passwordDigest = digest("sha1", `${nonce}${created}${field(a, "password")}`).toString("base64");
	setHeader(r.headers, "Authorization", 'WSSE profile="UsernameToken"');
	setHeader(r.headers, "X-WSSE", `UsernameToken Username="${field(a, "username")}", PasswordDigest="${passwordDigest}", Nonce="${nonce}", Created="${created}"`);
}

// JWT and ASAP

function jsonObject(text: string, what: string): Record<string, unknown> {
	if (text.trim() === "") return {};
	try {
		const value: unknown = JSON.parse(text);
		if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	} catch {
		// Reported below.
	}
	throw new SignError(`The JWT ${what} must be a JSON object.`);
}

/** A signed JWT; `key` is the secret for HS*, a PEM private key otherwise. */
export function jwtToken(alg: string, header: Record<string, unknown>, payload: Record<string, unknown>, key: string | Buffer): string {
	const input = `${base64Url(JSON.stringify({ alg, typ: "JWT", ...header }))}.${base64Url(JSON.stringify(payload))}`;
	const pem = () => key.toString();
	const bits = alg.slice(2);
	let signature: Buffer;
	if (/^HS(256|384|512)$/.test(alg)) signature = hmac(`sha${bits}`, key, input);
	else if (/^RS(256|384|512)$/.test(alg)) signature = rsaSign(pem(), `sha${bits}`, input);
	else if (/^PS(256|384|512)$/.test(alg)) signature = rsaSign(pem(), `sha${bits}`, input, true);
	else if (/^ES(256|384|512)$/.test(alg)) signature = ecSign(pem(), `sha${bits}`, input);
	else throw new SignError(`The JWT algorithm "${alg}" isn't supported.`);
	return `${input}.${base64Url(signature)}`;
}

function jwt(a: Auth, r: Signable): void {
	const alg = or(field(a, "algorithm"), () => "HS256");
	let key: string | Buffer;
	if (alg.startsWith("HS")) {
		const secret = field(a, "secret");
		key = flag(a, "isSecretBase64Encoded") ? Buffer.from(secret.trim(), "base64") : secret;
	} else {
		key = or(field(a, "privateKey"), () => field(a, "secret"));
	}
	const token = jwtToken(alg, jsonObject(field(a, "header"), "header"), jsonObject(field(a, "payload"), "payload"), key);
	if (field(a, "addTokenTo") === "queryParam") {
		r.url = appendQuery(r.url, [[or(field(a, "queryParamKey"), () => "token"), token]]);
		return;
	}
	const prefix = a.headerPrefix === undefined ? "Bearer" : field(a, "headerPrefix");
	setHeader(r.headers, "Authorization", prefix ? `${prefix} ${token}` : token);
}

/** "1h", "30m", "45s" or a number of seconds. */
function seconds(text: string): number {
	const m = /^\s*(\d*)\s*(\w*)\s*$/.exec(text);
	const n = m?.[1] ? Number(m[1]) : 3600;
	switch (m?.[2]) {
		case "m":
		case "min":
			return n * 60;
		case "h":
			return n * 3600;
		case "d":
			return n * 86_400;
		default:
			return n;
	}
}

function asap(a: Auth, r: Signable, ctx: SignContext): void {
	const alg = or(field(a, "alg"), () => "RS256");
	const claims: Record<string, unknown> = { iss: field(a, "issuer") };
	if (field(a, "subject")) claims.sub = field(a, "subject");
	claims.aud = field(a, "audience");
	claims.iat = ctx.now;
	claims.exp = ctx.now + seconds(or(field(a, "exp"), () => "1h"));
	claims.jti = randomUUID();
	Object.assign(claims, jsonObject(field(a, "claims"), "claims"));
	const token = jwtToken(alg, { kid: field(a, "kid") }, claims, field(a, "privateKey"));
	setHeader(r.headers, "Authorization", `Bearer ${token}`);
}
