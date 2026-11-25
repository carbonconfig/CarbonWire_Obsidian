import { ImportError, type ImportResult } from "./model";
import { importPostmanCollection, importPostmanEnvironment, isPostmanCollection, isPostmanEnvironment } from "./postman";
import { isObject, objects, str, type Json } from "./util";

/* A whole Postman account: the data export zip (or its folder), or an older single-file dump. */

export interface ExportFile {
	path: string;
	text: string;
}

export const EXPORT_FORMAT = "Postman data export";
export const DUMP_FORMAT = "Postman data dump";

/** Whether the import is a whole Postman account, where only some of it may be wanted. */
export function isAccountExport(result: ImportResult): boolean {
	return (result.format === EXPORT_FORMAT || result.format === DUMP_FORMAT) && result.collections.length + result.environments.length > 1;
}

/** Keeps only the chosen collections and environments, by index, and the notes about what's kept. */
export function selectFromExport(result: ImportResult, collections: ReadonlySet<number>, environments: ReadonlySet<number>): ImportResult {
	const kept = result.collections.filter((_, i) => collections.has(i));
	const keptNames = new Set(kept.map((c) => c.name));
	// Notes about a collection start with its name; see merge().
	const dropped = result.collections.filter((c, i) => !collections.has(i) && !keptNames.has(c.name)).map((c) => `${c.name}: `);
	return {
		...result,
		collections: kept,
		environments: result.environments.filter((_, i) => environments.has(i)),
		warnings: result.warnings.filter((w) => !dropped.some((prefix) => w.startsWith(prefix))),
	};
}

/** An older dump: every collection, environment and the globals in one JSON file. */
export function isPostmanDump(data: unknown): data is Json {
	return isObject(data) && Array.isArray(data.collections) && (Array.isArray(data.environments) || "version" in data);
}

/** Postman's v1 collection format, which older dumps use; Hoppscotch's requests have an endpoint instead of a URL. */
export function isPostmanV1Collection(data: unknown): data is Json {
	return isObject(data) && typeof data.id === "string" && typeof data.name === "string" && Array.isArray(data.requests) && objects(data.requests).every((r) => typeof r.url === "string");
}

export function importPostmanV1Collection(data: unknown): ImportResult {
	if (!isPostmanV1Collection(data)) throw new ImportError("Not a Postman v1 collection.");
	return { ...importPostmanCollection(fromV1(data)), format: "Postman collection v1" };
}

export function importPostmanDump(data: unknown): ImportResult {
	if (!isPostmanDump(data)) throw new ImportError("Not a Postman data dump.");
	const parts = [...(data.collections as unknown[]), ...objects(data.environments)].flatMap((item) => fromData(item) ?? []);
	const globals = objects(data.globals);
	if (globals.length > 0) parts.push(importPostmanEnvironment({ name: "globals", _postman_variable_scope: "globals", values: globals }));
	return merge(parts, DUMP_FORMAT, []);
}

/** Every collection, environment and globals file in a data export; other files are skipped. */
export function importPostmanExport(files: readonly ExportFile[]): ImportResult {
	const parts: ImportResult[] = [];
	const warnings: string[] = [];
	for (const file of files) {
		const name = file.path.split("/").pop()!.toLowerCase();
		if (!name.endsWith(".json") || name === "archive.json") continue;
		let data: unknown;
		try {
			data = JSON.parse(file.text);
		} catch {
			warnings.push(`${file.path} isn't valid JSON, so it was skipped.`);
			continue;
		}
		const part = fromData(data);
		if (part) parts.push(part);
	}
	if (parts.length === 0) throw new ImportError("No Postman collections or environments were found.");
	return merge(parts, EXPORT_FORMAT, warnings);
}

function fromData(data: unknown): ImportResult | undefined {
	if (isPostmanCollection(data)) return importPostmanCollection(data);
	if (isPostmanV1Collection(data)) return importPostmanV1Collection(data);
	if (isPostmanEnvironment(data)) return importPostmanEnvironment(data);
	if (isPostmanDump(data)) return importPostmanDump(data);
	return undefined;
}

function merge(parts: readonly ImportResult[], format: string, warnings: string[]): ImportResult {
	const result: ImportResult = { format, collections: [], environments: [], warnings };
	for (const part of parts) {
		result.collections.push(...part.collections);
		result.environments.push(...part.environments);
		const from = part.collections[0]?.name;
		result.warnings.push(...part.warnings.map((w) => (from ? `${from}: ${w}` : w)));
	}
	return result;
}

/** A v1 collection in v2.1's shape: folders and requests are listed by ID. */
function fromV1(c: Json): Json {
	const requests = new Map(objects(c.requests).map((r) => [str(r.id), r]));
	const folders = new Map(objects(c.folders).map((f) => [str(f.id), f]));
	const used = new Set<string>();
	const request = (id: string): Json[] => {
		const r = requests.get(id);
		if (!r || used.has(id)) return [];
		used.add(id);
		return [v1Request(r)];
	};
	const folder = (id: string): Json[] => {
		const f = folders.get(id);
		if (!f || used.has(id)) return [];
		used.add(id);
		return [{ name: str(f.name), description: f.description, auth: f.auth, item: [...ids(f.folders_order).flatMap(folder), ...ids(f.order).flatMap(request)] }];
	};
	// Without folders_order, the top folders are those no other folder lists.
	const nested = new Set([...folders.values()].flatMap((f) => ids(f.folders_order)));
	const top = Array.isArray(c.folders_order) ? ids(c.folders_order) : [...folders.keys()].filter((id) => !nested.has(id));
	const item = [...top.flatMap(folder), ...ids(c.order).flatMap(request)];
	// Requests nothing lists, which some dumps have, go at the end.
	for (const id of requests.keys()) item.push(...request(id));
	return { info: { name: str(c.name), description: c.description }, item, auth: c.auth, variable: c.variables };
}

function ids(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function v1Request(r: Json): Json {
	const headerData = objects(r.headerData);
	const header = headerData.length > 0
		? headerData.map((h) => ({ key: str(h.key), value: str(h.value), disabled: h.enabled === false }))
		: str(r.headers).split("\n").flatMap((line) => {
				const at = line.indexOf(":");
				if (at <= 0) return [];
				const disabled = line.trimStart().startsWith("//");
				return [{ key: line.slice(0, at).replace(/^\s*\/\/\s*/, "").trim(), value: line.slice(at + 1).trim(), disabled }];
			});
	const fields = (type: boolean) => objects(r.data).map((d) => ({ key: str(d.key), value: str(d.value), disabled: d.enabled === false, ...(type ? { type: d.type === "file" ? "file" : "text" } : {}) }));
	const mode = str(r.dataMode);
	const body =
		mode === "raw" && str(r.rawModeData) ? { mode: "raw", raw: str(r.rawModeData) }
		: mode === "params" ? { mode: "formdata", formdata: fields(true) }
		: mode === "urlencoded" ? { mode: "urlencoded", urlencoded: fields(false) }
		: undefined;
	const auth = isObject(r.auth) && typeof r.auth.type === "string" ? r.auth : undefined;
	return { name: str(r.name) || str(r.url) || "Request", request: { method: str(r.method) || "GET", header, url: str(r.url), body, auth, description: r.description } };
}
