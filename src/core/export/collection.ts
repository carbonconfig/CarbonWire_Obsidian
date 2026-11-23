import type { Auth, Environment, HttpRequest, HttpRequestBody, HttpRequestHeader, HttpRequestParam, RequestDefaults, Variable } from "../model";
import { buildRequest } from "../request-builder";
import { isSidecarAuth, toPostmanAuth, type Sidecar } from "../storage/sidecar";
import { urlFromParams } from "../url-params";
import { variableValue } from "../variables";
import { toCurl } from "./curl";

/* Exports a collection as Postman v2.1 JSON, Postman v3 YAML, a cURL script or HAR. */

export interface CollectedFolder {
	kind: "folder";
	name: string;
	/** The folder's path, for its sidecar entry. */
	dir: string;
	defaults: RequestDefaults;
	docs?: string;
	items: CollectedItem[];
}

export interface CollectedRequest {
	kind: "request";
	name: string;
	path: string;
	request: HttpRequest;
}

export type CollectedItem = CollectedFolder | CollectedRequest;

/** A collection read for export, with sidecar extras already merged into its documents. */
export interface Collected {
	name: string;
	root: string;
	defaults: RequestDefaults;
	docs?: string;
	sidecar?: Sidecar;
	items: CollectedItem[];
}

export const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type Json = Record<string, unknown>;

export function docsText(docs: unknown): string | undefined {
	if (typeof docs === "string") return docs || undefined;
	if (docs && typeof docs === "object" && typeof (docs as { content?: unknown }).content === "string") return (docs as { content: string }).content;
	return undefined;
}

const kv = (key: string, value: unknown) => ({ key, value, type: typeof value === "boolean" ? "boolean" : "string" });

function relative(root: string, path: string): string {
	return root === "" ? path : path.slice(root.length + 1);
}

function postmanId(c: Collected, path: string): string | undefined {
	return c.sidecar?.items?.[relative(c.root, path)]?.postmanId;
}

/** OpenCollection auth as Postman's `{type, <type>: [{key, value}]}`; undefined when it inherits. */
export function postmanAuth(auth: Auth | undefined): Json | undefined {
	const list = (type: string, entries: Json[]) => ({ type, [type]: entries });
	const some = (out: Json[], key: string, value: unknown) => {
		if (typeof value === "string" && value !== "") out.push(kv(key, value));
	};
	if (auth === undefined) return { type: "noauth" };
	if (auth === "inherit") return undefined;
	if (isSidecarAuth(auth)) return toPostmanAuth(auth);
	switch (auth.type) {
		case "basic":
		case "digest":
			return list(auth.type, [kv("username", auth.username ?? ""), kv("password", auth.password ?? "")]);
		case "bearer":
			return list("bearer", [kv("token", auth.token ?? "")]);
		case "apikey":
			return list("apikey", [kv("key", auth.key ?? ""), kv("value", auth.value ?? ""), kv("in", auth.placement === "query" ? "query" : "header")]);
		case "oauth2": {
			const e: Json[] = [];
			const grant =
				auth.flow === "resource_owner_password_credentials"
					? "password_credentials"
					: auth.flow === "authorization_code"
						? auth.pkce && !auth.pkce.disabled
							? "authorization_code_with_pkce"
							: "authorization_code"
						: auth.flow;
			e.push(kv("grant_type", grant));
			if ("accessTokenUrl" in auth) some(e, "accessTokenUrl", auth.accessTokenUrl);
			some(e, "clientId", auth.credentials?.clientId);
			if (auth.credentials && "clientSecret" in auth.credentials) {
				some(e, "clientSecret", auth.credentials.clientSecret);
				if (auth.credentials.placement === "body") e.push(kv("client_authentication", "body"));
			}
			if (auth.flow === "resource_owner_password_credentials") {
				some(e, "username", auth.resourceOwner?.username);
				some(e, "password", auth.resourceOwner?.password);
			}
			some(e, "scope", auth.scope);
			if (auth.flow === "authorization_code" || auth.flow === "implicit") {
				some(e, "authUrl", auth.authorizationUrl);
				some(e, "redirect_uri", auth.callbackUrl);
				some(e, "state", auth.state);
			}
			if (auth.flow === "authorization_code" && auth.pkce?.method) some(e, "challengeAlgorithm", auth.pkce.method);
			const placement = auth.tokenConfig?.placement;
			if (placement && "query" in placement) e.push(kv("addTokenTo", "queryParams"));
			else if (placement && "header" in placement) e.push(kv("headerPrefix", placement.header));
			return list("oauth2", e);
		}
		case "ntlm": {
			const e: Json[] = [];
			some(e, "username", auth.username);
			some(e, "password", auth.password);
			some(e, "domain", auth.domain);
			return list("ntlm", e);
		}
		case "awsv4": {
			const e: Json[] = [];
			some(e, "accessKey", auth.accessKeyId);
			some(e, "secretKey", auth.secretAccessKey);
			some(e, "sessionToken", auth.sessionToken);
			some(e, "region", auth.region);
			some(e, "service", auth.service);
			return list("awsv4", e);
		}
		case "oauth1": {
			const e: Json[] = [];
			const fields: [keyof typeof auth, string][] = [
				["consumerKey", "consumerKey"],
				["consumerSecret", "consumerSecret"],
				["accessToken", "token"],
				["accessTokenSecret", "tokenSecret"],
				["signatureMethod", "signatureMethod"],
				["callbackUrl", "callback"],
				["verifier", "verifier"],
				["timestamp", "timestamp"],
				["nonce", "nonce"],
				["version", "version"],
				["realm", "realm"],
			];
			for (const [from, to] of fields) some(e, to, auth[from]);
			if (auth.privateKey?.value) some(e, "privateKey", auth.privateKey.value);
			if (auth.placement) e.push(kv("addParamsToHeader", auth.placement === "header"));
			if (auth.includeBodyHash) e.push(kv("includeBodyHash", true));
			return list("oauth1", e);
		}
		default:
			// WSSE has no Postman equivalent; the request is exported without auth.
			return { type: "noauth" };
	}
}

function events(scripts: unknown): Json[] {
	if (!Array.isArray(scripts)) return [];
	return scripts.flatMap((s: { type?: string; code?: string }) => {
		const listen = s.type === "before-request" ? "prerequest" : s.type === "after-response" || s.type === "tests" ? "test" : undefined;
		return listen ? [{ listen, script: { type: "text/javascript", exec: (s.code ?? "").split("\n") } }] : [];
	});
}

function variables(vars: readonly Variable[] | undefined): Json[] {
	return (vars ?? []).map((v) => ({ key: v.name, value: variableValue(v) ?? "", ...(v.disabled ? { disabled: true } : {}) }));
}

function headers(list: readonly HttpRequestHeader[] | undefined): Json[] {
	return (list ?? []).map((h) => ({ key: h.name, value: h.value, ...(h.disabled ? { disabled: true } : {}) }));
}

/** A URL as Postman's object: the raw text with enabled query rows, and its parts. */
export function postmanUrl(rawUrl: string, params: readonly HttpRequestParam[]): Json {
	const raw = params.some((p) => p.type === "query") ? urlFromParams(rawUrl, [...params]) : rawUrl;
	const out: Json = { raw };
	const withoutQuery = raw.split(/[?#]/)[0] ?? "";
	const sep = withoutQuery.indexOf("://");
	const protocol = sep > 0 && !withoutQuery.slice(0, sep).includes("{") ? withoutQuery.slice(0, sep) : undefined;
	const rest = protocol ? withoutQuery.slice(sep + 3) : withoutQuery;
	if (protocol) out.protocol = protocol;
	const slash = rest.indexOf("/");
	const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
	const path = slash >= 0 ? rest.slice(slash + 1) : "";
	const colon = hostPort.lastIndexOf(":");
	const port = colon >= 0 && /^\d+$/.test(hostPort.slice(colon + 1)) ? hostPort.slice(colon + 1) : undefined;
	const host = port ? hostPort.slice(0, colon) : hostPort;
	out.host = host.startsWith("{{") ? [host] : host.split(".");
	if (port) out.port = port;
	if (path) out.path = path.split("/");
	const query = params.filter((p) => p.type === "query").map((p) => ({ key: p.name, value: p.value, ...(p.disabled ? { disabled: true } : {}) }));
	if (query.length > 0) out.query = query;
	const vars = params.filter((p) => p.type === "path").map((p) => ({ key: p.name, value: p.value }));
	if (vars.length > 0) out.variable = vars;
	return out;
}

function selectedBody(body: NonNullable<HttpRequest["http"]>["body"]): HttpRequestBody | undefined {
	return Array.isArray(body) ? (body.find((v) => v.selected) ?? body[0])?.body : body;
}

function postmanBody(body: HttpRequestBody | undefined, language: string | undefined): Json | undefined {
	if (!body) return undefined;
	const raw = (data: string, lang: string) => ({ mode: "raw", raw: data, options: { raw: { language: language ?? lang } } });
	switch (body.type) {
		case "json":
			return raw(body.data, "json");
		case "xml":
			return raw(body.data, "xml");
		case "text":
		case "sparql":
			return raw(body.data, "text");
		case "form-urlencoded":
			return { mode: "urlencoded", urlencoded: body.data.map((e) => ({ key: e.name, value: e.value, ...(e.disabled ? { disabled: true } : {}) })) };
		case "multipart-form":
			return {
				mode: "formdata",
				formdata: body.data.map((e) => {
					const values = Array.isArray(e.value) ? e.value : [e.value];
					return {
						key: e.name,
						...(e.type === "file" ? { type: "file", src: values.length === 1 ? values[0] : values } : { type: "text", value: values[0] ?? "" }),
						...(e.contentType ? { contentType: e.contentType } : {}),
						...(e.disabled ? { disabled: true } : {}),
					};
				}),
			};
		case "file": {
			const chosen = body.data.find((f) => f.selected) ?? body.data[0];
			return chosen ? { mode: "file", file: { src: chosen.filePath } } : undefined;
		}
	}
}

/** OpenCollection settings and the sidecar's Postman settings as protocolProfileBehavior. */
function behavior(settings: Record<string, unknown> | undefined): Json | undefined {
	if (!settings) return undefined;
	const out: Json = {};
	for (const key of ["strictSSL", "disableCookies", "protocolVersion", "followOriginalHttpMethod", "tlsDisabledProtocols", "tlsCipherSelection"]) {
		if (settings[key] !== undefined) out[key] = settings[key];
	}
	const value = (key: string) => (settings[key] === "inherit" ? undefined : settings[key]);
	if (value("followRedirects") !== undefined) out.followRedirects = value("followRedirects");
	if (value("maxRedirects") !== undefined) out.maxRedirects = value("maxRedirects");
	if (value("forwardAuthorizationHeader") !== undefined) out.followAuthorizationHeader = value("forwardAuthorizationHeader");
	if (typeof value("encodeUrl") === "boolean") out.disableUrlEncoding = !value("encodeUrl");
	const omit = settings.omitHeaders;
	if (Array.isArray(omit) && omit.length > 0) out.disabledSystemHeaders = Object.fromEntries(omit.map((n) => [n, true]));
	return Object.keys(out).length > 0 ? out : undefined;
}

function example(e: NonNullable<HttpRequest["examples"]>[number]): Json {
	const response = e.response;
	return {
		name: e.name ?? "Example",
		originalRequest: {
			method: e.request?.method ?? "GET",
			header: (e.request?.headers ?? []).map((h) => ({ key: h.name, value: h.value })),
			url: e.request?.url ?? "",
		},
		status: response?.statusText ?? "",
		code: response?.status ?? 0,
		_postman_previewlanguage: response?.body?.type ?? "text",
		header: (response?.headers ?? []).map((h) => ({ key: h.name, value: h.value })),
		body: response?.body?.data ?? null,
	};
}

function level(out: Json, defaults: RequestDefaults, top: boolean): void {
	// A collection without auth sends none; Postman's default there is the same.
	const auth = defaults.auth === undefined && top ? undefined : postmanAuth(defaults.auth);
	if (auth) out.auth = auth;
	const list = events(defaults.scripts);
	if (list.length > 0) out.event = list;
	const vars = variables(defaults.variables);
	if (vars.length > 0) out.variable = vars;
}

function requestJson(request: HttpRequest, bodyLanguage: string | undefined): Json {
	const http = request.http ?? {};
	const out: Json = { method: http.method ?? "GET", header: headers(http.headers) };
	const body = postmanBody(selectedBody(http.body), bodyLanguage);
	if (body) out.body = body;
	out.url = postmanUrl(http.url ?? "", http.params ?? []);
	const auth = postmanAuth(http.auth);
	if (auth) out.auth = auth;
	const docs = docsText(request.docs);
	if (docs) out.description = docs;
	return out;
}

function items(c: Collected, list: readonly CollectedItem[]): Json[] {
	return list.map((item) => {
		const out: Json = {};
		if (item.kind === "folder") {
			const id = postmanId(c, item.dir);
			if (id) out.id = id;
			out.name = item.name;
			if (item.docs) out.description = item.docs;
			out.item = items(c, item.items);
			// Headers on folders have no Postman equivalent.
			level(out, item.defaults, false);
			return out;
		}
		const id = postmanId(c, item.path);
		if (id) out.id = id;
		out.name = item.name;
		out.request = requestJson(item.request, c.sidecar?.items?.[relative(c.root, item.path)]?.bodyLanguage);
		const list = events(item.request.runtime?.scripts);
		if (list.length > 0) out.event = list;
		const b = behavior(item.request.settings as Record<string, unknown> | undefined);
		if (b) out.protocolProfileBehavior = b;
		out.response = (item.request.examples ?? []).map(example);
		return out;
	});
}

/** The collection as Postman v2.1 JSON. */
export function postmanCollection(c: Collected): Json {
	const info: Json = {};
	if (c.sidecar?.collection?.postmanId) info._postman_id = c.sidecar.collection.postmanId;
	info.name = c.name;
	if (c.docs) info.description = c.docs;
	info.schema = POSTMAN_SCHEMA;
	const out: Json = { info, item: items(c, c.items) };
	level(out, c.defaults, true);
	return out;
}

/** An environment as Postman's JSON; secret values stay empty, typed secret. */
export function postmanEnvironment(env: Environment, name: string): Json {
	const values = (env.variables ?? []).map((v) => {
		const secret = "secret" in v && v.secret === true;
		return { key: v.name, value: secret ? "" : (variableValue(v as Variable) ?? ""), type: secret ? "secret" : "default", enabled: !v.disabled };
	});
	return { name, values, _postman_variable_scope: "environment" };
}

/** Requests in tree order, with where they sit and the defaults above them. */
export function requestsOf(c: Collected): { place: string; request: HttpRequest; chain: RequestDefaults[] }[] {
	const out: { place: string; request: HttpRequest; chain: RequestDefaults[] }[] = [];
	const walk = (list: readonly CollectedItem[], place: string, chain: RequestDefaults[]) => {
		for (const item of list) {
			if (item.kind === "folder") walk(item.items, `${place}${item.name} / `, [...chain, item.defaults]);
			else out.push({ place: `${place}${item.name}`, request: item.request, chain });
		}
	};
	walk(c.items, "", [c.defaults]);
	return out;
}

export function curlScript(c: Collected): string {
	let out = `#!/bin/sh\n# ${c.name}: exported from CarbonWire\n`;
	for (const { place, request, chain } of requestsOf(c)) {
		const resolved = buildRequest(request, chain, new Map());
		out += `\n# ${place}\n${toCurl(resolved, { filePath: (p) => p })}\n`;
	}
	return out;
}

export function har(c: Collected, version: string): Json {
	const entries = requestsOf(c).map(({ request, chain }) => {
		const resolved = buildRequest(request, chain, new Map());
		const queryAt = resolved.url.indexOf("?");
		const queryString = queryAt >= 0 ? [...new URLSearchParams(resolved.url.slice(queryAt + 1))].map(([name, value]) => ({ name, value })) : [];
		const entryRequest: Json = {
			method: resolved.method,
			url: resolved.url,
			httpVersion: "HTTP/1.1",
			cookies: [],
			headers: resolved.headers.map(([name, value]) => ({ name, value })),
			queryString,
			headersSize: -1,
			bodySize: -1,
		};
		const body = resolved.body;
		if (body?.kind === "text") entryRequest.postData = { mimeType: body.contentType, text: body.text };
		else if (body?.kind === "multipart") entryRequest.postData = { mimeType: "multipart/form-data", params: body.parts.map((p) => ("filePath" in p ? { name: p.name, fileName: p.filePath } : { name: p.name, value: p.value })) };
		else if (body?.kind === "file") entryRequest.postData = { mimeType: body.contentType, text: "", comment: `Body read from ${body.filePath}` };
		const e = request.examples?.[0]?.response;
		const mime = { json: "application/json", xml: "application/xml", html: "text/html" } as Record<string, string>;
		const response = e
			? {
					status: e.status ?? 0,
					statusText: e.statusText ?? "",
					httpVersion: "HTTP/1.1",
					cookies: [],
					headers: e.headers ?? [],
					content: { size: -1, mimeType: mime[e.body?.type ?? ""] ?? "text/plain", text: e.body?.data ?? "" },
					redirectURL: "",
					headersSize: -1,
					bodySize: -1,
				}
			: { status: 0, statusText: "", httpVersion: "HTTP/1.1", cookies: [], headers: [], content: { size: 0, mimeType: "text/plain" }, redirectURL: "", headersSize: -1, bodySize: -1 };
		return { startedDateTime: "1970-01-01T00:00:00.000Z", time: 0, request: entryRequest, response, cache: {}, timings: { send: 0, wait: 0, receive: 0 } };
	});
	return { log: { version: "1.2", creator: { name: "CarbonWire", version }, entries } };
}

/** A name usable as a file name on every system. */
export function safeName(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "-").trim() || "Untitled";
}

function v3Auth(a: Json): Json {
	const type = typeof a.type === "string" ? a.type : "noauth";
	return a[type] !== undefined ? { type, credentials: a[type] } : { type };
}

function v3Scripts(list: unknown): Json[] | undefined {
	if (!Array.isArray(list)) return undefined;
	const out = (list as { listen?: string; script?: { exec?: string[] } }[]).flatMap((e) => {
		const type = e.listen === "prerequest" ? "beforeRequest" : e.listen === "test" ? "afterResponse" : undefined;
		return type ? [{ type, code: (e.script?.exec ?? []).join("\n"), language: "text/javascript" }] : [];
	});
	return out.length > 0 ? out : undefined;
}

function v3Definition(o: Json, name: string, order: number | undefined): Json {
	const d: Json = { $kind: "collection", name };
	const description = o.description ?? (o.info as Json | undefined)?.description;
	if (description !== undefined) d.description = description;
	if (o.variable) d.variables = o.variable;
	if (o.auth) d.auth = v3Auth(o.auth as Json);
	const scripts = v3Scripts(o.event);
	if (scripts) d.scripts = scripts;
	if (order !== undefined) d.order = order * 1000;
	return d;
}

function v3Body(b: Json): Json | undefined {
	switch (b.mode) {
		case "raw":
			return { type: ((b.options as Json | undefined)?.raw as Json | undefined)?.language ?? "text", content: b.raw ?? "" };
		case "urlencoded":
			return { type: "urlencoded", content: b.urlencoded ?? [] };
		case "formdata":
			return { type: "formdata", content: b.formdata ?? [] };
		case "file":
			return { type: "file", content: (b.file as Json | undefined)?.src ?? "" };
		default:
			return undefined;
	}
}

/** A file to write for an export, relative to the folder the user picked, as a value to write as YAML. */
export interface ExportFile {
	path: string;
	value: unknown;
}

function v3Items(dir: string, list: readonly Json[], out: ExportFile[]): void {
	const used: string[] = [];
	list.forEach((o, i) => {
		const name = typeof o.name === "string" ? o.name : "Untitled";
		let stem = safeName(name);
		for (let n = 2; used.some((u) => u.toLowerCase() === stem.toLowerCase()); n++) stem = `${safeName(name)} ${n}`;
		used.push(stem);
		if (Array.isArray(o.item)) {
			out.push({ path: `${dir}/${stem}/.resources/definition.yaml`, value: v3Definition(o, name, i + 1) });
			v3Items(`${dir}/${stem}`, o.item as Json[], out);
			return;
		}
		const r = (o.request ?? {}) as Json;
		const url = (r.url ?? {}) as Json;
		const request: Json = { $kind: "http-request" };
		if (stem !== name) request.name = name;
		request.method = r.method ?? "GET";
		request.url = url.raw ?? "";
		request.order = (i + 1) * 1000;
		if (Array.isArray(r.header) && r.header.length > 0) request.headers = r.header;
		if (url.query) request.queryParams = url.query;
		if (url.variable) request.pathVariables = url.variable;
		const body = r.body ? v3Body(r.body as Json) : undefined;
		if (body) request.body = body;
		if (r.auth) request.auth = v3Auth(r.auth as Json);
		if (r.description !== undefined) request.description = r.description;
		if (o.protocolProfileBehavior) request.settings = o.protocolProfileBehavior;
		const scripts = v3Scripts(o.event);
		if (scripts) request.scripts = scripts;
		const examples = Array.isArray(o.response) ? (o.response as Json[]) : [];
		if (examples.length > 0) {
			request.examples = `./.resources/${stem}.resources/examples/`;
			examples.forEach((e, j) => {
				const ename = typeof e.name === "string" ? e.name : "Example";
				const original = (e.originalRequest ?? {}) as Json;
				out.push({
					path: `${dir}/.resources/${stem}.resources/examples/${j + 1} ${safeName(ename)}.example.yaml`,
					value: {
						$kind: "http-example",
						name: ename,
						request: { url: original.url ?? "", method: original.method ?? "GET" },
						response: { statusCode: e.code ?? 0, statusText: e.status ?? "", headers: e.header ?? [], body: { type: e._postman_previewlanguage ?? "text", content: e.body ?? "" } },
						order: (j + 1) * 1000,
					},
				});
			});
		}
		out.push({ path: `${dir}/${stem}.request.yaml`, value: request });
	});
}

/** The collection in Postman's v3 layout, under `collections/<name>/`. */
export function postmanV3(c: Collected): ExportFile[] {
	const json = postmanCollection(c);
	const dir = `collections/${safeName(c.name)}`;
	const out: ExportFile[] = [{ path: `${dir}/.resources/definition.yaml`, value: v3Definition(json, c.name, undefined) }];
	v3Items(dir, (json.item as Json[]) ?? [], out);
	return out;
}

/** An environment in Postman's v3 layout. */
export function postmanV3Environment(env: Environment, name: string): ExportFile {
	return { path: `environments/${safeName(name)}.environment.yaml`, value: { name, values: postmanEnvironment(env, name).values } };
}
