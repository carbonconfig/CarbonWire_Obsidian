import type { Auth, HttpRequest, HttpRequestBody, HttpRequestHeader, HttpRequestParam } from "../model";
import { ImportError, Warnings, type ImportedCollection, type ImportedEnvironment, type ImportedItem, type ImportResult } from "./model";
import { compact, header, isObject, objects, rawType, str, urlWithParams, type Json } from "./util";

/** HTTPie for Web & Desktop export format, https://github.com/httpie/schema (v1.0.0). */
export function isHttpie(data: unknown): data is Json {
	return isObject(data) && isObject(data.meta) && data.meta.format === "httpie" && isObject(data.entry);
}

export function importHttpie(data: unknown): ImportResult {
	if (!isHttpie(data)) throw new ImportError("Not an HTTPie export.");
	const warnings = new Warnings();
	const entry = data.entry as Json;
	const contentType = str((data.meta as Json).contentType);

	switch (contentType) {
		case "workspace": {
			const environments = objects(entry.environments).map(convertEnvironment);
			const collections = objects(entry.collections).map((c) => convertCollection(c, environments, warnings));
			const drafts = objects(entry.drafts);
			if (drafts.length > 0) {
				collections.push({ name: `${str(entry.name) || "HTTPie"} drafts`, defaults: {}, items: drafts.map((r) => requestItem(r, warnings)), environments });
			}
			return { format: "HTTPie space", collections, environments: [], warnings: warnings.list() };
		}
		case "collection":
			return { format: "HTTPie collection", collections: [convertCollection(entry, [], warnings)], environments: [], warnings: warnings.list() };
		case "request":
			return {
				format: "HTTPie request",
				collections: [{ name: str(entry.name) || "HTTPie request", defaults: {}, items: [requestItem(entry, warnings)], environments: [] }],
				environments: [],
				warnings: warnings.list(),
			};
		case "environment":
			return { format: "HTTPie environment", collections: [], environments: [convertEnvironment(entry)], warnings: warnings.list() };
		default:
			throw new ImportError(`Unsupported HTTPie export type "${contentType}".`);
	}
}

function convertCollection(c: Json, environments: ImportedEnvironment[], warnings: Warnings): ImportedCollection {
	return {
		name: str(c.name) || "HTTPie collection",
		defaults: compact({ auth: convertAuth(c.auth, warnings) }),
		items: objects(c.requests).map((r) => requestItem(r, warnings)),
		environments,
	};
}

function convertEnvironment(e: Json): ImportedEnvironment {
	return {
		name: str(e.name) || "Environment",
		variables: objects(e.variables).map((v) => ({ name: str(v.name), value: str(v.value), secret: v.isSecret === true })),
	};
}

function requestItem(r: Json, warnings: Warnings): ImportedItem {
	return { kind: "request", name: str(r.name) || str(r.url) || "Untitled request", request: convertRequest(r, warnings) };
}

function list(raw: unknown): { name: string; value: string; disabled?: boolean }[] {
	return objects(raw).map((i) => compact({ name: str(i.name), value: str(i.value), disabled: i.enabled === false ? true : undefined }));
}

function convertRequest(r: Json, warnings: Warnings): HttpRequest {
	const headers = list(r.headers).map((h) => header(h.name, h.value, h.disabled));
	const query = list(r.queryParams).map((p): HttpRequestParam => ({ ...p, type: "query" }));
	const pathValues = Object.fromEntries(list(r.pathParams).map((p) => [p.name, p.value]));
	const built = urlWithParams(str(r.url), query, pathValues);
	return compact({
		http: {
			method: str(r.method).toUpperCase() || "GET",
			url: built.url,
			params: built.params,
			headers,
			body: convertBody(r.body, headers, warnings),
			auth: convertAuth(r.auth, warnings, true),
		},
	});
}

function convertBody(raw: unknown, headers: HttpRequestHeader[], warnings: Warnings): HttpRequestBody | undefined {
	if (!isObject(raw)) return undefined;
	switch (raw.type) {
		case "text": {
			const text = isObject(raw.text) ? raw.text : {};
			const format = str(text.format);
			if (format && !headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push(header("Content-Type", format));
			return { type: rawType(format), data: str(text.value) };
		}
		case "form": {
			const form = isObject(raw.form) ? raw.form : {};
			const fields = objects(form.fields);
			if (form.isMultipart !== true) {
				return { type: "form-urlencoded", data: fields.map((f) => compact({ name: str(f.name), value: str(f.value), disabled: f.enabled === false ? true : undefined })) };
			}
			return {
				type: "multipart-form",
				data: fields.map((f) => {
					const isFile = f.type === "file";
					if (isFile) warnings.add("HTTPie doesn't export multipart files; re-attach them after importing.");
					return compact({ name: str(f.name), type: isFile ? ("file" as const) : ("text" as const), value: isFile ? (isObject(f.file) ? str(f.file.name) : "") : str(f.value), disabled: f.enabled === false ? true : undefined });
				}),
			};
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
			if (!headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push(header("Content-Type", "application/json"));
			return { type: "json", data: JSON.stringify({ query: str(gql.query), variables }, null, 2) };
		}
		case "file":
			warnings.add("HTTPie doesn't export binary bodies; re-attach them after importing.");
			return undefined;
		default:
			return undefined;
	}
}

/** HTTPie keeps every credential in `credentials.username/password`, whatever the auth type. */
function convertAuth(raw: unknown, warnings: Warnings, canInherit = false): Auth | undefined {
	if (!isObject(raw)) return canInherit ? "inherit" : undefined;
	const creds = isObject(raw.credentials) ? raw.credentials : {};
	const username = str(creds.username);
	const password = str(creds.password);
	switch (raw.type) {
		case "inherited":
			return canInherit ? "inherit" : undefined;
		case "basic":
			return { type: "basic", username, password };
		case "bearer":
			return { type: "bearer", token: password || username };
		case "apiKey":
			return { type: "apikey", key: username, value: password, placement: raw.target === "params" ? "query" : "header" };
		case "none":
			return undefined;
		default:
			warnings.add(`"${str(raw.type)}" auth is not supported and was dropped.`);
			return undefined;
	}
}
