import type { Script } from "@opencollection/types/common/scripts";
import type { Auth, HttpRequest, HttpRequestBody, HttpRequestHeader, HttpRequestParam, RequestDefaults } from "../model";
import { ImportError, Warnings, type ImportedCollection, type ImportedEnvironment, type ImportedItem, type ImportResult } from "./model";
import { compact, findHeaderValue, flatten, header, isObject, objects, rawType, str, urlWithParams, variable, type Json } from "./util";

export function isInsomniaV4(data: unknown): data is Json {
	return isObject(data) && data._type === "export" && Array.isArray(data.resources);
}

export function isInsomniaV5(data: unknown): data is Json {
	return isObject(data) && typeof data.type === "string" && /^(collection|spec|environment)\.insomnia\.rest\/5\.0$/.test(data.type);
}

/** Insomnia's Nunjucks syntax: `{{ _.name }}` becomes `{{name}}`; template tags stay as text. */
function convertTemplates(value: string, warnings: Warnings): string {
	if (/\{%.*?%\}/s.test(value)) warnings.add("Insomnia template tags such as {% response %} are kept as text and won't be evaluated.");
	return value.replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{$1}}").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, "{{$1}}");
}

/** Applies template conversion to every string in an imported structure. */
function templates<T>(value: T, warnings: Warnings): T {
	if (typeof value === "string") return convertTemplates(value, warnings) as T;
	if (Array.isArray(value)) return value.map((v: unknown) => templates(v, warnings)) as T;
	if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, templates(v, warnings)])) as T;
	return value;
}

export function importInsomniaV4(data: unknown): ImportResult {
	if (!isInsomniaV4(data)) throw new ImportError("Not an Insomnia v4 export.");
	const warnings = new Warnings();
	const resources = objects(data.resources);
	const byParent = new Map<string, Json[]>();
	for (const r of resources) {
		const parent = str(r.parentId);
		byParent.set(parent, [...(byParent.get(parent) ?? []), r]);
	}
	const children = (id: string) => (byParent.get(id) ?? []).slice().sort((a, b) => Number(a.metaSortKey ?? 0) - Number(b.metaSortKey ?? 0));

	const convertChildren = (id: string): ImportedItem[] =>
		children(id).flatMap((r): ImportedItem[] => {
			if (r._type === "request_group") {
				return [{ kind: "folder", name: str(r.name) || "Folder", defaults: folderDefaults(r, warnings), docs: str(r.description) || undefined, items: convertChildren(str(r._id)) }];
			}
			if (r._type === "request") return [{ kind: "request", name: str(r.name) || "Untitled request", request: convertRequest(r, warnings) }];
			if (r._type === "grpc_request" || r._type === "websocket_request" || r._type === "socketio_request") warnings.add("gRPC, WebSocket and Socket.IO requests are not supported yet and were skipped.");
			return [];
		});

	const workspaces = resources.filter((r) => r._type === "workspace");
	if (workspaces.length === 0) throw new ImportError("The Insomnia export contains no workspace.");
	const collections = workspaces.map((ws): ImportedCollection => {
		const id = str(ws._id);
		const base = resources.find((r) => r._type === "environment" && r.parentId === id);
		const subs = base ? resources.filter((r) => r._type === "environment" && r.parentId === base._id) : [];
		if (resources.some((r) => r._type === "api_spec" && r.parentId === id && str(r.contents))) warnings.add("API specs are not imported.");
		return {
			name: str(ws.name) || "Insomnia collection",
			defaults: compact({ variables: base ? flatten(templates(base.data, warnings)).map(variable) : [] }),
			docs: str(ws.description) || undefined,
			items: convertChildren(id),
			environments: subs.map((e) => ({ name: str(e.name) || "Environment", variables: flatten(templates(e.data, warnings)) })),
		};
	});
	return { format: "Insomnia v4 (JSON)", collections, environments: [], warnings: warnings.list() };
}

export function importInsomniaV5(data: unknown): ImportResult {
	if (!isInsomniaV5(data)) throw new ImportError("Not an Insomnia v5 file.");
	const warnings = new Warnings();
	const envs = isObject(data.environments) ? data.environments : undefined;
	const subEnvironments = (envs ? objects(envs.subEnvironments) : []).map((e): ImportedEnvironment => ({
		name: str(e.name) || "Environment",
		variables: flatten(templates(e.data, warnings)),
	}));

	if (data.type === "environment.insomnia.rest/5.0") {
		return { format: "Insomnia v5 environments", collections: [], environments: subEnvironments, warnings: warnings.list() };
	}
	if (data.type === "spec.insomnia.rest/5.0") warnings.add("API specs are not imported; only the requests in the file are.");

	const convertChildren = (items: unknown): ImportedItem[] =>
		objects(items).flatMap((item): ImportedItem[] => {
			const meta = isObject(item.meta) ? item.meta : {};
			if (Array.isArray(item.children)) {
				return [{ kind: "folder", name: str(item.name) || "Folder", defaults: folderDefaults(item, warnings), docs: str(meta.description) || undefined, items: convertChildren(item.children) }];
			}
			if (typeof item.method === "string") return [{ kind: "request", name: str(item.name) || "Untitled request", request: convertRequest(item, warnings) }];
			warnings.add("gRPC, WebSocket and Socket.IO requests are not supported yet and were skipped.");
			return [];
		});

	const meta = isObject(data.meta) ? data.meta : {};
	const collection: ImportedCollection = {
		name: str(data.name) || "Insomnia collection",
		defaults: compact({ variables: envs ? flatten(templates(envs.data, warnings)).map(variable) : [] }),
		docs: str(meta.description) || undefined,
		items: convertChildren(data.collection),
		environments: subEnvironments,
	};
	return { format: "Insomnia v5 (YAML)", collections: [collection], environments: [], warnings: warnings.list() };
}

function folderDefaults(group: Json, warnings: Warnings): RequestDefaults {
	return templates(
		compact({
			// Folders without their own auth inherit in Insomnia.
			auth: convertAuth(group.authentication, warnings, true),
			headers: convertHeaders(group.headers),
			variables: flatten(group.environment).map(variable),
			scripts: convertScripts(group, warnings),
		}),
		warnings,
	);
}

function convertRequest(r: Json, warnings: Warnings): HttpRequest {
	const headers = convertHeaders(r.headers);
	const query = objects(r.parameters).map((p): HttpRequestParam => compact({ name: str(p.name), value: str(p.value), type: "query" as const, disabled: p.disabled === true ? true : undefined }));
	const pathValues = Object.fromEntries(objects(r.pathParameters).map((p) => [str(p.name), str(p.value)]));
	const built = urlWithParams(str(r.url), query, pathValues);
	const settings = isObject(r.settings) ? r.settings : {};
	const encodeUrl = typeof settings.encodeUrl === "boolean" ? settings.encodeUrl : typeof r.settingEncodeUrl === "boolean" ? r.settingEncodeUrl : undefined;
	const scripts = convertScripts(r, warnings);
	return templates(
		compact({
			http: {
				method: str(r.method).toUpperCase() || "GET",
				url: built.url,
				params: built.params,
				headers,
				body: convertBody(r.body, headers, warnings),
				auth: convertAuth(r.authentication, warnings, true),
			},
			runtime: scripts ? { scripts } : undefined,
			settings: encodeUrl === undefined ? undefined : { encodeUrl },
			docs: str(r.description) || (isObject(r.meta) ? str(r.meta.description) : "") || undefined,
		}),
		warnings,
	);
}

function convertHeaders(raw: unknown): HttpRequestHeader[] {
	return objects(raw).map((h) => header(str(h.name), str(h.value), h.disabled === true));
}

function convertBody(raw: unknown, headers: HttpRequestHeader[], warnings: Warnings): HttpRequestBody | undefined {
	if (!isObject(raw)) return undefined;
	const mime = str(raw.mimeType).toLowerCase();
	const text = str(raw.text);
	if (mime === "application/x-www-form-urlencoded") {
		return { type: "form-urlencoded", data: objects(raw.params).map((p) => compact({ name: str(p.name), value: str(p.value), disabled: p.disabled === true ? true : undefined })) };
	}
	if (mime === "multipart/form-data") {
		return {
			type: "multipart-form",
			data: objects(raw.params).map((p) => {
				const isFile = p.type === "file";
				if (isFile) warnings.add("Multipart file paths point to files on the machine the collection came from; check them before sending.");
				return compact({ name: str(p.name), type: isFile ? ("file" as const) : ("text" as const), value: isFile ? str(p.fileName) : str(p.value), disabled: p.disabled === true ? true : undefined });
			}),
		};
	}
	if (mime === "application/graphql") {
		warnings.add("GraphQL bodies were converted to JSON POST bodies.");
		const ct = headers.find((h) => h.name.toLowerCase() === "content-type");
		if (ct) ct.value = "application/json";
		else headers.push(header("Content-Type", "application/json"));
		return { type: "json", data: text };
	}
	if (mime === "application/octet-stream" || (raw.fileName && !text)) {
		const filePath = str(raw.fileName);
		if (!filePath) return undefined;
		warnings.add("Binary body file paths point to files on the machine the collection came from; check them before sending.");
		return { type: "file", data: [{ filePath, contentType: mime || "application/octet-stream", selected: true }] };
	}
	if (!text) return undefined;
	return { type: rawType(mime || findHeaderValue(headers, "content-type")), data: text };
}

function convertAuth(raw: unknown, warnings: Warnings, canInherit: boolean): Auth | undefined {
	if (!isObject(raw) || !raw.type) return canInherit ? "inherit" : undefined;
	if (raw.disabled === true) return undefined;
	const s = (key: string) => str(raw[key]);
	switch (raw.type) {
		case "none":
			return undefined;
		case "basic":
			return { type: "basic", username: s("username"), password: s("password") };
		case "bearer": {
			const prefix = s("prefix");
			if (prefix && prefix.toLowerCase() !== "bearer") return { type: "apikey", key: "Authorization", value: `${prefix} ${s("token")}`, placement: "header" };
			return { type: "bearer", token: s("token") };
		}
		case "apikey":
			if (raw.addTo === "cookie") warnings.add("API keys sent as cookies were converted to a Cookie header value.");
			return raw.addTo === "cookie"
				? { type: "apikey", key: "Cookie", value: `${s("key")}=${s("value")}`, placement: "header" }
				: { type: "apikey", key: s("key"), value: s("value"), placement: raw.addTo === "queryParams" ? "query" : "header" };
		case "digest":
			return { type: "digest", username: s("username"), password: s("password") };
		case "ntlm":
			warnings.add("NTLM auth is kept but not applied yet.");
			return { type: "ntlm", username: s("username"), password: s("password") };
		case "iam":
			warnings.add("AWS Signature auth is kept but not applied yet.");
			return compact({ type: "awsv4", accessKeyId: s("accessKeyId"), secretAccessKey: s("secretAccessKey"), sessionToken: s("sessionToken") || undefined, region: s("region"), service: s("service") });
		case "oauth2": {
			const credentials = compact({ clientId: s("clientId"), clientSecret: s("clientSecret") || undefined, placement: raw.credentialsInBody === true ? ("body" as const) : ("basic_auth_header" as const) });
			const tokenConfig = { placement: { header: raw.tokenPrefix === undefined ? "Bearer" : s("tokenPrefix") } };
			const scope = s("scope") || undefined;
			switch (raw.grantType) {
				case "password":
					return compact({ type: "oauth2", flow: "resource_owner_password_credentials", accessTokenUrl: s("accessTokenUrl"), credentials, resourceOwner: { username: s("username"), password: s("password") }, scope, tokenConfig });
				case "client_credentials":
					return compact({ type: "oauth2", flow: "client_credentials", accessTokenUrl: s("accessTokenUrl"), credentials, scope, tokenConfig });
				case "implicit":
					warnings.add("OAuth 2.0 implicit auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "implicit", authorizationUrl: s("authorizationUrl"), callbackUrl: s("redirectUrl") || undefined, credentials: { clientId: s("clientId") }, scope, tokenConfig });
				default:
					warnings.add("OAuth 2.0 authorization code auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "authorization_code", authorizationUrl: s("authorizationUrl"), accessTokenUrl: s("accessTokenUrl"), callbackUrl: s("redirectUrl") || undefined, credentials, scope, state: s("state") || undefined, pkce: raw.usePkce === true ? { method: s("pkceMethod") === "plain" ? "plain" : "S256" } : undefined, tokenConfig });
			}
		}
		default:
			warnings.add(`"${str(raw.type)}" auth is not supported and was dropped.`);
			return undefined;
	}
}

function convertScripts(r: Json, warnings: Warnings): Script[] | undefined {
	const scripts = isObject(r.scripts) ? r.scripts : {};
	const before = str(scripts.preRequest) || str(r.preRequestScript);
	const after = str(scripts.afterResponse) || str(r.afterResponseScript);
	const out: Script[] = [];
	if (before.trim()) out.push({ type: "before-request", code: before });
	if (after.trim()) out.push({ type: "after-response", code: after });
	if (out.length > 0) warnings.add("Pre-request and after-response scripts are kept but not run yet.");
	return out.length > 0 ? out : undefined;
}
