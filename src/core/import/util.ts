import type { HttpRequestBody, HttpRequestHeader, HttpRequestParam, Variable } from "../model";
import { paramsFromUrl, urlFromParams } from "../url-params";
import type { ImportedVariable } from "./model";

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function objects(value: unknown): Json[] {
	return asArray(value).filter(isObject);
}

/** Strings, numbers and booleans as text; anything else as an empty string. */
export function str(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

export function header(name: string, value: string, disabled?: boolean): HttpRequestHeader {
	return disabled ? { name, value, disabled: true } : { name, value };
}

export function variable(v: ImportedVariable): Variable {
	return v.disabled ? { name: v.name, value: v.value, disabled: true } : { name: v.name, value: v.value };
}

export function findHeaderValue(headers: readonly HttpRequestHeader[], name: string): string | undefined {
	const lower = name.toLowerCase();
	return headers.find((h) => h.name.toLowerCase() === lower && !h.disabled)?.value;
}

/** Raw body type for a content type, defaulting to text. */
export function rawType(contentType: string | undefined): "json" | "xml" | "text" {
	const ct = (contentType ?? "").toLowerCase();
	if (/[/+]json\b/.test(ct)) return "json";
	if (/[/+]xml\b/.test(ct)) return "xml";
	return "text";
}

/** A text body, guessing JSON when no content type says otherwise. */
export function textBody(text: string, contentType: string | undefined): HttpRequestBody {
	const type = contentType ? rawType(contentType) : /^\s*[[{]/.test(text) ? "json" : "text";
	return { type, data: text };
}

/**
 * Path params come from `:name` segments in the URL; query params replace the URL's query
 * string so the editor and the request builder agree on a single source of truth.
 */
export function urlWithParams(url: string, query: readonly HttpRequestParam[], pathValues: Record<string, string> = {}): { url: string; params: HttpRequestParam[] } {
	const pathParams = paramsFromUrl(url, []).filter((p) => p.type === "path").map((p) => ({ ...p, value: pathValues[p.name] ?? "" }));
	const params = [...pathParams, ...query];
	return { url: query.length > 0 ? urlFromParams(url, params) : url, params: params.length > 0 ? params : [] };
}

/** Query params already embedded in a URL, for formats that only store the full URL. */
export function queryFromUrl(url: string): HttpRequestParam[] {
	return paramsFromUrl(url, []).filter((p) => p.type === "query");
}

/** Flattens nested objects to dotted keys, as Insomnia and Postman templates address them. */
export function flatten(data: unknown, prefix = ""): ImportedVariable[] {
	if (!isObject(data)) return [];
	const out: ImportedVariable[] = [];
	for (const [key, value] of Object.entries(data)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (isObject(value)) out.push(...flatten(value, name));
		else out.push({ name, value: Array.isArray(value) ? JSON.stringify(value) : str(value) });
	}
	return out;
}

export function nameFromUrl(method: string, url: string): string {
	// Drop the origin, whether literal or a leading {{baseUrl}}-style variable.
	const path = url.replace(/^([a-z]+:\/\/[^/]+|\{\{[^}]+\}\})/i, "").split(/[?#]/)[0] || "/";
	return `${method.toUpperCase()} ${path}`;
}

/** Removes undefined values and empty arrays so imported YAML stays minimal. */
export function compact<T>(value: T): T {
	if (Array.isArray(value)) return value.map(compact) as T;
	if (!isObject(value)) return value;
	const out: Json = {};
	for (const [k, v] of Object.entries(value)) {
		if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
		out[k] = compact(v);
	}
	return out as T;
}
