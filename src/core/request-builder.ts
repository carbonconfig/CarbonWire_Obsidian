import { hasHeader, setHeader } from "./headers";
import { mergeHeaders, resolveAuth, resolveSettings, type EffectiveSettings } from "./inheritance";
import type { Auth, DefaultsChain, Header, HttpRequest, HttpRequestBody, HttpRequestDetails, HttpRequestParam } from "./model";
import { interpolate, interpolateDeep, type Scope } from "./variables";

export type ResolvedBody =
	| { kind: "text"; text: string; contentType: string }
	| { kind: "multipart"; parts: MultipartPart[] }
	| { kind: "file"; filePath: string; contentType: string };

export type MultipartPart =
	| { name: string; value: string; contentType?: string }
	| { name: string; filePath: string; contentType?: string };

export interface ResolvedRequest {
	method: string;
	url: string;
	headers: Header[];
	body?: ResolvedBody;
	settings: EffectiveSettings;
	/** Auth types that need a network round trip (digest, OAuth 2.0) are applied by the sender. */
	pendingAuth?: Exclude<Auth, "inherit">;
	warnings: string[];
}

const RAW_CONTENT_TYPES = {
	json: "application/json",
	text: "text/plain",
	xml: "application/xml",
	sparql: "application/sparql-query",
} as const;

export function buildRequest(request: HttpRequest, chain: DefaultsChain, scope: Scope): ResolvedRequest {
	const http = request.http ?? {};
	const sub = (s: string | undefined) => interpolate(s ?? "", scope);
	const settings = resolveSettings(chain, request.settings);
	const warnings: string[] = [];

	const headers = mergeHeaders(chain, http.headers).map(([n, v]): Header => [sub(n), sub(v)]);
	let url = buildUrl(sub(http.url), http.params ?? [], scope, settings.encodeUrl);
	const body = resolveBody(http.body, scope);

	if (body?.kind === "text" || body?.kind === "file") {
		if (!hasHeader(headers, "content-type")) headers.push(["Content-Type", body.contentType]);
	}

	let pendingAuth: ResolvedRequest["pendingAuth"];
	const auth = resolveAuth(http.auth, chain);
	switch (auth?.type) {
		case undefined:
			break;
		case "basic":
			setHeader(headers, "Authorization", `Basic ${base64Utf8(`${sub(auth.username)}:${sub(auth.password)}`)}`);
			break;
		case "bearer":
			setHeader(headers, "Authorization", `Bearer ${sub(auth.token)}`);
			break;
		case "apikey": {
			const key = sub(auth.key);
			const value = sub(auth.value);
			if (!key) break;
			if (auth.placement === "query") url = appendQuery(url, [[key, value]], settings.encodeUrl);
			else setHeader(headers, key, value);
			break;
		}
		case "digest":
		case "oauth2":
			pendingAuth = interpolateDeep(auth, scope);
			break;
		default:
			warnings.push(`Auth type "${auth?.type}" is not supported yet; the request is sent without it.`);
	}

	return {
		method: (http.method ?? "GET").toUpperCase(),
		url,
		headers,
		body,
		settings,
		pendingAuth,
		warnings,
	};
}

/**
 * When the params list has query entries, it replaces the URL's query string. Otherwise the URL
 * is used as written.
 */
function buildUrl(rawUrl: string, params: readonly HttpRequestParam[], scope: Scope, encode: boolean): string {
	let url = rawUrl;
	for (const p of params) {
		// Path params can't be disabled: the URL needs a value for every :name segment.
		if (p.type !== "path") continue;
		const value = interpolate(p.value, scope);
		url = url.replace(new RegExp(`/:${escapeRegExp(p.name)}(?=[/?#]|$)`, "g"), `/${encode ? encodeComponent(value) : value}`);
	}
	const query = params.filter((p) => p.type === "query");
	if (query.length === 0) return url;

	const hashAt = url.indexOf("#");
	const hash = hashAt >= 0 ? url.slice(hashAt) : "";
	const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
	const queryAt = withoutHash.indexOf("?");
	const base = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
	const pairs = query
		.filter((p) => !p.disabled)
		.map((p): [string, string] => [interpolate(p.name, scope), interpolate(p.value, scope)]);
	return appendQuery(base, pairs, encode) + hash;
}

export function appendQuery(url: string, pairs: readonly (readonly [string, string])[], encode: boolean): string {
	if (pairs.length === 0) return url;
	const enc = encode ? encodeComponent : (s: string) => s;
	const qs = pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
	return url + (url.includes("?") ? "&" : "?") + qs;
}

/** Decoding first avoids double-encoding values the user already percent-encoded. */
function encodeComponent(value: string): string {
	let decoded = value;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		// Malformed sequences are encoded as literal text.
	}
	return encodeURIComponent(decoded);
}

function resolveBody(body: HttpRequestDetails["body"], scope: Scope): ResolvedBody | undefined {
	const selected: HttpRequestBody | undefined = Array.isArray(body)
		? (body.find((v) => v.selected) ?? body[0])?.body
		: body;
	if (!selected) return undefined;
	const sub = (s: string) => interpolate(s, scope);

	switch (selected.type) {
		case "json":
		case "text":
		case "xml":
		case "sparql":
			return { kind: "text", text: sub(selected.data), contentType: RAW_CONTENT_TYPES[selected.type] };
		case "form-urlencoded": {
			const form = new URLSearchParams();
			for (const e of selected.data) if (!e.disabled) form.append(sub(e.name), sub(e.value));
			return { kind: "text", text: form.toString(), contentType: "application/x-www-form-urlencoded" };
		}
		case "multipart-form": {
			const parts: MultipartPart[] = [];
			for (const e of selected.data) {
				if (e.disabled) continue;
				const values = Array.isArray(e.value) ? e.value : [e.value];
				for (const v of values) {
					parts.push(e.type === "file"
						? { name: sub(e.name), filePath: sub(v), contentType: e.contentType }
						: { name: sub(e.name), value: sub(v), contentType: e.contentType });
				}
			}
			return { kind: "multipart", parts };
		}
		case "file": {
			const variant = selected.data.find((v) => v.selected) ?? selected.data[0];
			if (!variant) return undefined;
			return { kind: "file", filePath: sub(variant.filePath), contentType: variant.contentType || "application/octet-stream" };
		}
	}
}

function base64Utf8(text: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
