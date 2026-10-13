import type { Auth, HttpRequest, HttpRequestBody, HttpRequestExample, HttpRequestHeader, HttpRequestParam } from "../model";
import type { Script } from "@opencollection/types/common/scripts";
import { ImportError, Warnings, type ImportedCollection, type ImportedEnvironment, type ImportedItem, type ImportResult } from "./model";
import { compact, findHeaderValue, header, isObject, objects, rawType, str, textBody, urlWithParams, variable, type Json } from "./util";

export function isPostmanCollection(data: unknown): data is Json {
	return isObject(data) && isObject(data.info) && Array.isArray(data.item);
}

export function isPostmanEnvironment(data: unknown): data is Json {
	return isObject(data) && Array.isArray(data.values) && (typeof data._postman_variable_scope === "string" || typeof data.name === "string");
}

export function importPostmanCollection(data: unknown): ImportResult {
	if (!isPostmanCollection(data)) throw new ImportError("Not a Postman collection.");
	const warnings = new Warnings();
	const info = data.info as Json;
	const schema = str(info.schema);
	const collection: ImportedCollection = {
		name: str(info.name) || "Postman collection",
		defaults: compact({
			auth: data.auth ? convertAuth(data.auth, warnings) : undefined,
			variables: objects(data.variable).map((v) => variable({ name: str(v.key), value: str(v.value), disabled: v.disabled === true })),
			scripts: convertEvents(data.event, warnings),
		}),
		docs: description(info.description),
		items: convertItems(data.item, warnings),
		environments: [],
	};
	return { format: schema.includes("v2.0") ? "Postman collection v2.0" : "Postman collection v2.1", collections: [collection], environments: [], warnings: warnings.list() };
}

export function importPostmanEnvironment(data: unknown): ImportResult {
	if (!isPostmanEnvironment(data)) throw new ImportError("Not a Postman environment.");
	const env: ImportedEnvironment = {
		name: str(data.name) || (data._postman_variable_scope === "globals" ? "Globals" : "Environment"),
		variables: objects(data.values).map((v) => ({
			name: str(v.key),
			value: str(v.value),
			disabled: v.enabled === false,
			secret: v.type === "secret",
		})),
	};
	return { format: "Postman environment", collections: [], environments: [env], warnings: [] };
}

function convertItems(items: unknown, warnings: Warnings): ImportedItem[] {
	return objects(items).map((item): ImportedItem => {
		if (Array.isArray(item.item)) {
			return {
				kind: "folder",
				name: str(item.name) || "Folder",
				// Postman folders inherit unless they set their own auth.
				defaults: compact({ auth: item.auth ? convertAuth(item.auth, warnings) : "inherit", scripts: convertEvents(item.event, warnings) }),
				docs: description(item.description),
				items: convertItems(item.item, warnings),
			};
		}
		return { kind: "request", name: str(item.name) || "Untitled request", request: convertRequest(item, warnings) };
	});
}

function convertRequest(item: Json, warnings: Warnings): HttpRequest {
	const req = isObject(item.request) ? item.request : { url: str(item.request), method: "GET" };
	const headers = convertHeaders(req.header);
	const { url, query, pathValues } = convertUrl(req.url);
	const built = urlWithParams(url, query, pathValues);
	const scripts = convertEvents(item.event, warnings);
	return compact({
		http: {
			method: str(req.method).toUpperCase() || "GET",
			url: built.url,
			params: built.params,
			headers,
			body: convertBody(req.body, headers, warnings),
			// A request without auth inherits from its folder or the collection in Postman.
			auth: req.auth ? convertAuth(req.auth, warnings) : "inherit",
		},
		runtime: scripts ? { scripts } : undefined,
		examples: objects(item.response).map((r) => convertExample(r)),
		docs: description(req.description),
	});
}

function convertUrl(raw: unknown): { url: string; query: HttpRequestParam[]; pathValues: Record<string, string> } {
	if (!isObject(raw)) return { url: str(raw), query: [], pathValues: {} };
	let url = str(raw.raw);
	if (!url) {
		const host = Array.isArray(raw.host) ? raw.host.map(str).join(".") : str(raw.host);
		const path = Array.isArray(raw.path) ? raw.path.map(str).join("/") : str(raw.path);
		url = `${raw.protocol ? `${str(raw.protocol)}://` : ""}${host}${raw.port ? `:${str(raw.port)}` : ""}${path ? `/${path}` : ""}`;
	}
	const query = objects(raw.query).map((q): HttpRequestParam => {
		const param: HttpRequestParam = { name: str(q.key), value: str(q.value), type: "query" };
		if (q.disabled === true) param.disabled = true;
		return param;
	});
	const pathValues = Object.fromEntries(objects(raw.variable).map((v) => [str(v.key), str(v.value)]));
	return { url, query, pathValues };
}

function convertHeaders(raw: unknown): HttpRequestHeader[] {
	if (typeof raw === "string") {
		return raw.split(/\r?\n/).filter((l) => l.includes(":")).map((l) => header(l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()));
	}
	return objects(raw).map((h) => header(str(h.key), str(h.value), h.disabled === true));
}

function convertBody(raw: unknown, headers: HttpRequestHeader[], warnings: Warnings): HttpRequestBody | undefined {
	if (!isObject(raw) || raw.disabled === true) return undefined;
	switch (raw.mode) {
		case "raw": {
			const language = isObject(raw.options) && isObject(raw.options.raw) ? str(raw.options.raw.language) : "";
			const text = str(raw.raw);
			if (language === "json" || language === "xml") return { type: language, data: text };
			const contentType = findHeaderValue(headers, "content-type");
			return contentType ? { type: rawType(contentType), data: text } : textBody(text, language ? "text/plain" : undefined);
		}
		case "urlencoded":
			return {
				type: "form-urlencoded",
				data: objects(raw.urlencoded).map((e) => compact({ name: str(e.key), value: str(e.value), disabled: e.disabled === true ? true : undefined })),
			};
		case "formdata":
			return {
				type: "multipart-form",
				data: objects(raw.formdata).map((e) => {
					const isFile = e.type === "file";
					if (isFile) warnings.add("Multipart file paths point to files on the machine the collection came from; check them before sending.");
					return compact({
						name: str(e.key),
						type: isFile ? ("file" as const) : ("text" as const),
						value: isFile ? (Array.isArray(e.src) ? e.src.map(str) : str(e.src)) : str(e.value),
						contentType: str(e.contentType) || undefined,
						disabled: e.disabled === true ? true : undefined,
					});
				}),
			};
		case "file": {
			const src = isObject(raw.file) ? str(raw.file.src) : "";
			if (!src) return undefined;
			warnings.add("Binary body file paths point to files on the machine the collection came from; check them before sending.");
			return { type: "file", data: [{ filePath: src, contentType: findHeaderValue(headers, "content-type") ?? "application/octet-stream", selected: true }] };
		}
		case "graphql": {
			const gql = isObject(raw.graphql) ? raw.graphql : {};
			warnings.add("GraphQL bodies were converted to JSON POST bodies.");
			let variables: unknown = str(gql.variables);
			try {
				variables = variables ? JSON.parse(variables as string) : undefined;
			} catch {
				// Keep invalid variables as text.
			}
			if (!findHeaderValue(headers, "content-type")) headers.push(header("Content-Type", "application/json"));
			return { type: "json", data: JSON.stringify({ query: str(gql.query), variables }, null, 2) };
		}
		default:
			return undefined;
	}
}

/** Postman 2.1 stores auth fields as [{key, value}] lists; 2.0 uses plain objects. */
function authParams(auth: Json, type: string): Record<string, string> {
	const raw = auth[type];
	if (Array.isArray(raw)) return Object.fromEntries(objects(raw).map((p) => [str(p.key), str(p.value)]));
	if (isObject(raw)) return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, str(v)]));
	return {};
}

export function convertAuth(raw: unknown, warnings: Warnings): Auth | undefined {
	if (!isObject(raw)) return undefined;
	const type = str(raw.type);
	const p = authParams(raw, type);
	switch (type) {
		case "noauth":
			return undefined;
		case "inherit":
			return "inherit";
		case "basic":
			return { type: "basic", username: p.username ?? "", password: p.password ?? "" };
		case "bearer":
			return { type: "bearer", token: p.token ?? "" };
		case "apikey":
			return { type: "apikey", key: p.key ?? "", value: p.value ?? "", placement: p.in === "query" ? "query" : "header" };
		case "digest":
			return { type: "digest", username: p.username ?? "", password: p.password ?? "" };
		case "ntlm":
			warnings.add("NTLM auth is kept but not applied yet.");
			return { type: "ntlm", username: p.username ?? "", password: p.password ?? "", domain: p.domain ?? "" };
		case "awsv4":
			warnings.add("AWS Signature auth is kept but not applied yet.");
			return compact({ type: "awsv4", accessKeyId: p.accessKey, secretAccessKey: p.secretKey, sessionToken: p.sessionToken, region: p.region, service: p.service });
		case "oauth2":
			return convertOAuth2(p, warnings);
		default:
			warnings.add(`"${type}" auth is not supported and was dropped.`);
			return undefined;
	}
}

function convertOAuth2(p: Record<string, string>, warnings: Warnings): Auth {
	const credentials = compact({ clientId: p.clientId, clientSecret: p.clientSecret, placement: p.client_authentication === "body" ? ("body" as const) : ("basic_auth_header" as const) });
	const tokenConfig = { placement: p.addTokenTo === "queryParams" ? { query: "access_token" } : { header: p.headerPrefix ?? "Bearer" } };
	switch (p.grant_type) {
		case "password_credentials":
			return compact({ type: "oauth2", flow: "resource_owner_password_credentials", accessTokenUrl: p.accessTokenUrl, credentials, resourceOwner: { username: p.username ?? "", password: p.password ?? "" }, scope: p.scope, tokenConfig });
		case "authorization_code":
		case "authorization_code_with_pkce":
			warnings.add("OAuth 2.0 authorization code auth is kept but not applied yet.");
			return compact({ type: "oauth2", flow: "authorization_code", authorizationUrl: p.authUrl, accessTokenUrl: p.accessTokenUrl, callbackUrl: p.redirect_uri, credentials, scope: p.scope, state: p.state, tokenConfig });
		case "implicit":
			warnings.add("OAuth 2.0 implicit auth is kept but not applied yet.");
			return compact({ type: "oauth2", flow: "implicit", authorizationUrl: p.authUrl, callbackUrl: p.redirect_uri, credentials: { clientId: p.clientId }, scope: p.scope, tokenConfig });
		default:
			return compact({ type: "oauth2", flow: "client_credentials", accessTokenUrl: p.accessTokenUrl, credentials, scope: p.scope, tokenConfig });
	}
}

function convertEvents(events: unknown, warnings: Warnings): Script[] | undefined {
	const scripts: Script[] = [];
	for (const e of objects(events)) {
		const script = isObject(e.script) ? e.script : {};
		const code = Array.isArray(script.exec) ? script.exec.map(str).join("\n") : str(script.exec);
		if (!code.trim()) continue;
		if (e.listen === "prerequest") scripts.push({ type: "before-request", code });
		else if (e.listen === "test") scripts.push({ type: "tests", code });
	}
	if (scripts.length > 0) warnings.add("Pre-request and test scripts are kept but not run yet.");
	return scripts.length > 0 ? scripts : undefined;
}

function convertExample(r: Json): HttpRequestExample {
	const original = isObject(r.originalRequest) ? r.originalRequest : {};
	const headers = objects(r.header).map((h) => ({ name: str(h.key), value: str(h.value) }));
	const lang = str(r._postman_previewlanguage);
	const bodyType = lang === "json" || lang === "xml" || lang === "html" ? lang : "text";
	return compact({
		name: str(r.name) || "Example",
		request: compact({
			method: str(original.method) || undefined,
			url: isObject(original.url) ? str(original.url.raw) : str(original.url) || undefined,
			headers: convertHeaders(original.header),
		}),
		response: compact({
			status: typeof r.code === "number" ? r.code : undefined,
			statusText: str(r.status) || undefined,
			headers,
			body: r.body !== undefined && r.body !== null ? { type: bodyType, data: str(r.body) } : undefined,
		}),
	});
}

function description(raw: unknown): string | undefined {
	const text = isObject(raw) ? str(raw.content) : str(raw);
	return text || undefined;
}

