import type { Script } from "@opencollection/types/common/scripts";
import type { Auth, HttpRequest, HttpRequestBody, HttpRequestHeader, HttpRequestParam, MultipartFormEntry, RequestDefaults } from "../model";
import { ImportError, Warnings, type ImportedCollection, type ImportedEnvironment, type ImportedItem, type ImportResult } from "./model";
import { compact, header, isObject, objects, rawType, str, urlWithParams, type Json } from "./util";

const isCollection = (c: unknown): c is Json => isObject(c) && Array.isArray(c.requests) && Array.isArray(c.folders);
const isEnvironment = (e: unknown): e is Json => isObject(e) && Array.isArray(e.variables) && !("requests" in e);

export function isHoppscotchCollection(data: unknown): boolean {
	return Array.isArray(data) ? data.length > 0 && data.every(isCollection) : isCollection(data);
}

export function isHoppscotchEnvironment(data: unknown): boolean {
	return Array.isArray(data) ? data.length > 0 && data.every(isEnvironment) : isEnvironment(data) && typeof (data).name === "string";
}

/** Hoppscotch writes variables as `<<name>>`; this runs on the raw text before parsing. */
export function convertHoppscotchVariables(text: string): string {
	return text.replace(/<<([\w.-]+)>>/g, "{{$1}}");
}

export function importHoppscotchCollection(data: unknown): ImportResult {
	if (!isHoppscotchCollection(data)) throw new ImportError("Not a Hoppscotch collection.");
	const warnings = new Warnings();
	const collections = (Array.isArray(data) ? data : [data]).filter(isCollection).map((c): ImportedCollection => ({
		name: str(c.name) || "Hoppscotch collection",
		defaults: defaults(c, warnings, false),
		docs: str(c.description) || undefined,
		items: convertItems(c, warnings),
		environments: [],
	}));
	return { format: "Hoppscotch collection", collections, environments: [], warnings: warnings.list() };
}

export function importHoppscotchEnvironment(data: unknown): ImportResult {
	if (!isHoppscotchEnvironment(data)) throw new ImportError("Not a Hoppscotch environment.");
	const warnings = new Warnings();
	const environments = (Array.isArray(data) ? data : [data]).filter(isEnvironment).map((e): ImportedEnvironment => ({
		name: str(e.name) || "Environment",
		variables: objects(e.variables).map((v) => {
			const value = str(v.currentValue) || str(v.initialValue) || str(v.value);
			if (v.secret === true && !value) warnings.add("Hoppscotch doesn't export secret values; fill them in after importing.");
			return { name: str(v.key), value, secret: v.secret === true };
		}),
	}));
	return { format: "Hoppscotch environment", collections: [], environments, warnings: warnings.list() };
}

function convertItems(c: Json, warnings: Warnings): ImportedItem[] {
	const folders = objects(c.folders).filter(isCollection).map((f): ImportedItem => ({
		kind: "folder",
		name: str(f.name) || "Folder",
		defaults: defaults(f, warnings, true),
		docs: str(f.description) || undefined,
		items: convertItems(f, warnings),
	}));
	const requests = objects(c.requests).map((r): ImportedItem => ({ kind: "request", name: str(r.name) || "Untitled request", request: convertRequest(r, warnings) }));
	return [...folders, ...requests];
}

function defaults(c: Json, warnings: Warnings, canInherit: boolean): RequestDefaults {
	return compact({
		auth: convertAuth(c.auth, warnings, canInherit),
		headers: convertKeyValues(c.headers).map((h) => header(h.name, h.value, h.disabled)),
		variables: objects(c.variables).map((v) => ({ name: str(v.key), value: str(v.initialValue) || str(v.currentValue) || str(v.value) })),
		scripts: convertScripts(c, warnings),
	});
}

function convertKeyValues(raw: unknown): { name: string; value: string; disabled?: boolean }[] {
	return objects(raw).map((kv) => compact({ name: str(kv.key), value: str(kv.value), disabled: kv.active === false ? true : undefined }));
}

function convertRequest(r: Json, warnings: Warnings): HttpRequest {
	const headers = convertKeyValues(r.headers).map((h) => header(h.name, h.value, h.disabled));
	const query = convertKeyValues(r.params).map((p): HttpRequestParam => ({ ...p, type: "query" }));
	const built = urlWithParams(str(r.endpoint), query);
	const scripts = convertScripts(r, warnings);
	const variables = convertKeyValues(r.requestVariables);
	return compact({
		http: {
			method: str(r.method).toUpperCase() || "GET",
			url: built.url,
			params: built.params,
			headers,
			body: convertBody(r.body, headers, warnings),
			auth: convertAuth(r.auth, warnings, true),
		},
		runtime: scripts || variables.length > 0 ? compact({ scripts, variables }) : undefined,
	});
}

function convertBody(raw: unknown, headers: HttpRequestHeader[], warnings: Warnings): HttpRequestBody | undefined {
	if (!isObject(raw) || !raw.contentType) return undefined;
	const contentType = str(raw.contentType);
	if (!headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push(header("Content-Type", contentType));
	if (contentType === "multipart/form-data") {
		return {
			type: "multipart-form",
			data: objects(raw.body).map((e): MultipartFormEntry => {
				const isFile = e.isFile === true;
				if (isFile) warnings.add("Hoppscotch doesn't export multipart files; re-attach them after importing.");
				return compact({ name: str(e.key), type: isFile ? "file" : "text", value: isFile ? "" : str(e.value), disabled: e.active === false ? true : undefined });
			}),
		};
	}
	if (contentType === "application/x-www-form-urlencoded") return { type: "form-urlencoded", data: parseRawKeyValues(str(raw.body)) };
	if (contentType === "application/octet-stream") {
		warnings.add("Hoppscotch doesn't export binary bodies; re-attach them after importing.");
		return undefined;
	}
	return { type: rawType(contentType), data: str(raw.body) };
}

/** Hoppscotch stores url-encoded bodies as "key: value" lines, with "#" marking disabled rows. */
function parseRawKeyValues(text: string): { name: string; value: string; disabled?: boolean }[] {
	if (!text.includes(":") && text.includes("=")) {
		return [...new URLSearchParams(text)].map(([name, value]) => ({ name, value }));
	}
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.includes(":"))
		.map((line) => {
			const disabled = line.startsWith("#");
			const body = disabled ? line.slice(1).trim() : line;
			const i = body.indexOf(":");
			return compact({ name: body.slice(0, i).trim(), value: body.slice(i + 1).trim(), disabled: disabled ? true : undefined });
		});
}

function convertAuth(raw: unknown, warnings: Warnings, canInherit: boolean): Auth | undefined {
	if (!isObject(raw)) return canInherit ? "inherit" : undefined;
	if (raw.authActive === false) return undefined;
	const s = (key: string) => str(raw[key]);
	const toQuery = /query/i.test(s("addTo"));
	switch (raw.authType) {
		case "none":
			return undefined;
		case "inherit":
			return canInherit ? "inherit" : undefined;
		case "basic":
			return { type: "basic", username: s("username"), password: s("password") };
		case "bearer":
			return { type: "bearer", token: s("token") };
		case "api-key":
			return { type: "apikey", key: s("key"), value: s("value"), placement: toQuery ? "query" : "header" };
		case "digest":
			return { type: "digest", username: s("username"), password: s("password") };
		case "aws-signature":
			warnings.add("AWS Signature auth is kept but not applied yet.");
			return compact({ type: "awsv4", accessKeyId: s("accessKey"), secretAccessKey: s("secretKey"), region: s("region"), service: s("serviceName"), sessionToken: s("serviceToken") || undefined });
		case "oauth-2": {
			const info = isObject(raw.grantTypeInfo) ? raw.grantTypeInfo : raw;
			const g = (key: string) => str(info[key]);
			const credentials = compact({ clientId: g("clientID"), clientSecret: g("clientSecret") || undefined, placement: g("clientAuthentication") === "IN_BODY" ? ("body" as const) : ("basic_auth_header" as const) });
			const tokenConfig = { placement: toQuery ? { query: "access_token" } : { header: "Bearer" } };
			const scope = g("scopes") || g("scope") || undefined;
			switch (g("grantType")) {
				case "CLIENT_CREDENTIALS":
					return compact({ type: "oauth2", flow: "client_credentials", accessTokenUrl: g("authEndpoint") || g("tokenEndpoint"), credentials, scope, tokenConfig });
				case "PASSWORD":
					return compact({ type: "oauth2", flow: "resource_owner_password_credentials", accessTokenUrl: g("authEndpoint") || g("tokenEndpoint"), credentials, resourceOwner: { username: g("username"), password: g("password") }, scope, tokenConfig });
				case "IMPLICIT":
					warnings.add("OAuth 2.0 implicit auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "implicit", authorizationUrl: g("authEndpoint"), credentials: { clientId: g("clientID") }, scope, tokenConfig });
				default:
					warnings.add("OAuth 2.0 authorization code auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "authorization_code", authorizationUrl: g("authEndpoint") || g("authURL"), accessTokenUrl: g("tokenEndpoint") || g("accessTokenURL"), credentials, scope, tokenConfig });
			}
		}
		default:
			warnings.add(`"${s("authType")}" auth is not supported and was dropped.`);
			return undefined;
	}
}

function convertScripts(r: Json, warnings: Warnings): Script[] | undefined {
	const out: Script[] = [];
	if (str(r.preRequestScript).trim()) out.push({ type: "before-request", code: str(r.preRequestScript) });
	if (str(r.testScript).trim()) out.push({ type: "tests", code: str(r.testScript) });
	if (out.length > 0) warnings.add("Pre-request and test scripts are kept but not run yet.");
	return out.length > 0 ? out : undefined;
}
