import type { HttpRequest, HttpRequestBody, HttpRequestExample, HttpRequestHeader } from "../model";
import { ImportError, Warnings, type ImportedItem, type ImportResult } from "./model";
import { compact, header, isObject, nameFromUrl, objects, queryFromUrl, rawType, str, type Json } from "./util";

/** Headers the transport sets itself, or that only make sense for the original connection. */
const SKIPPED_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"]);
const EXAMPLE_LIMIT = 1_000_000;

export function isHar(data: unknown): data is Json {
	return isObject(data) && isObject(data.log) && Array.isArray(data.log.entries);
}

export function importHar(data: unknown): ImportResult {
	if (!isHar(data)) throw new ImportError("Not a HAR file.");
	const warnings = new Warnings();
	const entries = objects((data.log as Json).entries);
	const items = entries.flatMap((entry): ImportedItem[] => {
		if (!isObject(entry.request)) return [];
		const req = entry.request;
		const method = str(req.method).toUpperCase() || "GET";
		const url = str(req.url);
		const headers = objects(req.headers)
			.filter((h) => !str(h.name).startsWith(":") && !SKIPPED_HEADERS.has(str(h.name).toLowerCase()))
			.map((h) => header(str(h.name), str(h.value)));
		const request: HttpRequest = compact({
			http: { method, url, params: queryFromUrl(url), headers, body: convertBody(req.postData, warnings) },
			examples: isObject(entry.response) ? [convertExample(entry.response, warnings)] : undefined,
		});
		return [{ kind: "request", name: nameFromUrl(method, url), request }];
	});
	let host = "HAR import";
	try {
		host = new URL(str(isObject(entries[0]?.request) ? entries[0].request.url : "")).host || host;
	} catch {
		// Keep the default name for unparseable URLs.
	}
	return { format: "HAR", collections: [{ name: host, defaults: {}, items, environments: [] }], environments: [], warnings: warnings.list() };
}

function convertBody(raw: unknown, warnings: Warnings): HttpRequestBody | undefined {
	if (!isObject(raw)) return undefined;
	const mime = str(raw.mimeType).split(";")[0]!.trim().toLowerCase();
	const params = objects(raw.params);
	if (mime === "application/x-www-form-urlencoded" && params.length > 0) {
		return { type: "form-urlencoded", data: params.map((p) => ({ name: str(p.name), value: str(p.value) })) };
	}
	if (mime === "multipart/form-data" && params.length > 0) {
		if (params.some((p) => p.fileName)) warnings.add("HAR files don't contain uploaded files; re-attach them after importing.");
		return {
			type: "multipart-form",
			data: params.map((p) => compact(p.fileName ? { name: str(p.name), type: "file" as const, value: "", contentType: str(p.contentType) || undefined } : { name: str(p.name), type: "text" as const, value: str(p.value) })),
		};
	}
	const text = str(raw.text);
	return text ? { type: rawType(mime), data: text } : undefined;
}

function convertExample(res: Json, warnings: Warnings): HttpRequestExample {
	const content = isObject(res.content) ? res.content : {};
	const mime = str(content.mimeType).toLowerCase();
	let data = str(content.text);
	if (content.encoding === "base64") {
		data = "";
		warnings.add("Base64-encoded (binary) response bodies were left out of the saved examples.");
	} else if (data.length > EXAMPLE_LIMIT) {
		data = "";
		warnings.add("Response bodies over 1 MB were left out of the saved examples.");
	}
	const type = mime.includes("json") ? "json" : mime.includes("xml") ? "xml" : mime.includes("html") ? "html" : "text";
	const headers: HttpRequestHeader[] = objects(res.headers).map((h) => ({ name: str(h.name), value: str(h.value) }));
	return compact({
		name: `${str(res.status)} ${str(res.statusText)}`.trim() || "Response",
		response: compact({
			status: typeof res.status === "number" ? res.status : undefined,
			statusText: str(res.statusText) || undefined,
			headers,
			body: data ? { type, data } : undefined,
		}),
	});
}
