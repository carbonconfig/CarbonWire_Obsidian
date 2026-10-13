import type { Script } from "@opencollection/types/common/scripts";
import type { Auth, HttpRequest, HttpRequestBody, HttpRequestHeader, HttpRequestParam, RequestDefaults } from "../model";
import { basename, dirname, stem } from "../storage/paths";
import { ImportError, Warnings, type ImportedCollection, type ImportedEnvironment, type ImportedFolder, type ImportedItem, type ImportResult } from "./model";
import { compact, header, urlWithParams } from "./util";

interface Entry {
	name: string;
	value: string;
	disabled: boolean;
}

/** One parsed `.bru` file: dictionary blocks as entries, text blocks as text, list blocks as items. */
interface BruFile {
	dict: Map<string, Entry[]>;
	text: Map<string, string>;
	list: Map<string, string[]>;
}

const TEXT_BLOCK = /^(body(:[\w-]+)*|script:[\w-]+|tests|docs)$/;
const METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "connect", "trace"];

export function parseBru(source: string): BruFile {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const file: BruFile = { dict: new Map(), text: new Map(), list: new Map() };
	for (let i = 0; i < lines.length; i++) {
		const open = /^([a-z][\w:-]*)\s*([{[])\s*$/.exec(lines[i]!);
		if (!open) continue;
		const [, name, bracket] = open as unknown as [string, string, string];
		const close = bracket === "{" ? "}" : "]";
		const body: string[] = [];
		for (i++; i < lines.length && lines[i] !== close; i++) body.push(lines[i]!);

		if (bracket === "[") {
			file.list.set(name, body.join("\n").split(",").map((s) => s.trim()).filter(Boolean));
		} else if (TEXT_BLOCK.test(name) && !name.startsWith("body:form-urlencoded") && !name.startsWith("body:multipart-form") && !name.startsWith("body:file")) {
			file.text.set(name, body.map((l) => l.replace(/^ {2}/, "")).join("\n").replace(/\n+$/, ""));
		} else {
			file.dict.set(name, parseDictionary(body));
		}
	}
	return file;
}

function parseDictionary(lines: string[]): Entry[] {
	const entries: Entry[] = [];
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i]!.trim();
		if (!line) continue;
		const disabled = line.startsWith("~");
		if (disabled) line = line.slice(1);
		let name: string;
		let rest: string;
		const quoted = /^"((?:[^"\\]|\\.)*)"\s*:\s?(.*)$/.exec(line);
		if (quoted) {
			name = quoted[1]!.replace(/\\(.)/g, "$1");
			rest = quoted[2]!;
		} else {
			const colon = line.indexOf(":");
			if (colon < 0) continue;
			name = line.slice(0, colon).trim();
			rest = line.slice(colon + 1).trim();
		}
		// Multi-line values are wrapped in ''' on their own lines.
		if (rest === "'''") {
			const value: string[] = [];
			for (i++; i < lines.length && lines[i]!.trim() !== "'''"; i++) value.push(lines[i]!.replace(/^ {4}/, ""));
			rest = value.join("\n");
		}
		entries.push({ name, value: rest, disabled });
	}
	return entries;
}

const get = (file: BruFile, block: string, key: string) => file.dict.get(block)?.find((e) => e.name === key)?.value ?? "";

/** Imports a Bruno `.bru` collection folder, given as paths relative to the folder root. */
export function importBrunoFolder(files: readonly { path: string; text: string }[]): ImportResult {
	const warnings = new Warnings();
	const config = files.find((f) => basename(f.path) === "bruno.json");
	if (!config) throw new ImportError("This folder has no bruno.json, so it isn't a Bruno collection.");
	const root = dirname(config.path);
	const rel = (p: string) => (root ? p.slice(root.length + 1) : p);
	let name = basename(root) || "Bruno collection";
	try {
		name = (JSON.parse(config.text) as { name?: string }).name || name;
	} catch {
		warnings.add("bruno.json could not be parsed; the folder name was used instead.");
	}

	const collectionFile = files.find((f) => rel(f.path) === "collection.bru");
	const collection: ImportedCollection = {
		name,
		defaults: collectionFile ? folderDefaults(parseBru(collectionFile.text), warnings, false) : {},
		docs: collectionFile ? parseBru(collectionFile.text).text.get("docs") || undefined : undefined,
		items: [],
		environments: [],
	};

	const folders = new Map<string, ImportedFolder>();
	const seqOf = new Map<ImportedItem, number>();
	const folderFor = (dir: string): { items: ImportedItem[] } => {
		if (dir === "") return collection;
		let folder = folders.get(dir);
		if (!folder) {
			folder = { kind: "folder", name: basename(dir), defaults: { auth: "inherit" }, items: [] };
			folders.set(dir, folder);
			folderFor(dirname(dir)).items.push(folder);
		}
		return folder;
	};

	const bruFiles = files.filter((f) => f.path.endsWith(".bru") && (!root || f.path.startsWith(`${root}/`)));
	for (const f of bruFiles) {
		const path = rel(f.path);
		const dir = dirname(path);
		if (path === "collection.bru") continue;
		const parsed = parseBru(f.text);
		if (dirname(dir) === "" && basename(dir) === "environments") {
			collection.environments.push(convertEnvironment(stem(path).replace(/\.bru$/, ""), parsed));
			continue;
		}
		if (basename(path) === "folder.bru") {
			const folder = folderFor(dir) as ImportedFolder;
			folder.name = get(parsed, "meta", "name") || folder.name;
			folder.defaults = folderDefaults(parsed, warnings, true);
			folder.docs = parsed.text.get("docs") || undefined;
			const seq = Number(get(parsed, "meta", "seq"));
			if (Number.isFinite(seq)) seqOf.set(folder, seq);
			continue;
		}
		const item = convertRequest(parsed, basename(path).replace(/\.bru$/, ""), warnings);
		if (!item) continue;
		const seq = Number(get(parsed, "meta", "seq"));
		if (Number.isFinite(seq)) seqOf.set(item, seq);
		folderFor(dir).items.push(item);
	}

	const sortTree = (items: ImportedItem[]) => {
		items.sort((a, b) => (seqOf.get(a) ?? Infinity) - (seqOf.get(b) ?? Infinity));
		for (const i of items) if (i.kind === "folder") sortTree(i.items);
	};
	sortTree(collection.items);
	return { format: "Bruno collection (.bru)", collections: [collection], environments: [], warnings: warnings.list() };
}

/** A single `.bru` file: a request, or an environment (a `vars` block and no method). */
export function importBruFile(text: string, fileName: string): ImportResult {
	const warnings = new Warnings();
	const parsed = parseBru(text);
	const name = basename(fileName).replace(/\.bru$/, "") || "Request";
	if (!METHODS.some((m) => parsed.dict.has(m)) && (parsed.dict.has("vars") || parsed.list.has("vars:secret"))) {
		const env = convertEnvironment(name, parsed);
		const secrets = env.variables.some((v) => v.secret) ? ["Bruno doesn't store secret values in environment files; fill them in after importing."] : [];
		return { format: "Bruno environment (.bru)", collections: [], environments: [env], warnings: secrets };
	}
	const item = convertRequest(parsed, name, warnings);
	if (!item) throw new ImportError("This .bru file doesn't contain an HTTP request.");
	return {
		format: "Bruno request (.bru)",
		collections: [{ name: item.name, defaults: {}, items: [item], environments: [] }],
		environments: [],
		warnings: warnings.list(),
	};
}

function convertEnvironment(name: string, file: BruFile): ImportedEnvironment {
	const vars = (file.dict.get("vars") ?? []).map((e) => compact({ name: e.name, value: e.value, disabled: e.disabled ? true : undefined }));
	const secrets = (file.list.get("vars:secret") ?? []).map((n) => ({ name: n.replace(/^~/, ""), value: "", secret: true, disabled: n.startsWith("~") ? true : undefined }));
	return { name, variables: [...vars, ...compact(secrets)] };
}

function entries(file: BruFile, block: string): Entry[] {
	return file.dict.get(block) ?? [];
}

function headersOf(file: BruFile): HttpRequestHeader[] {
	return entries(file, "headers").map((e) => header(e.name, e.value, e.disabled));
}

function folderDefaults(file: BruFile, warnings: Warnings, canInherit: boolean): RequestDefaults {
	const mode = get(file, "auth", "mode") || (canInherit ? "inherit" : "none");
	return compact({
		auth: convertAuth(mode, file, warnings),
		headers: headersOf(file),
		variables: entries(file, "vars:pre-request").map((e) => compact({ name: e.name, value: e.value, disabled: e.disabled ? true : undefined })),
		scripts: convertScripts(file, warnings),
	});
}

function convertRequest(file: BruFile, fallbackName: string, warnings: Warnings): ImportedItem | undefined {
	const methodBlock = METHODS.find((m) => file.dict.has(m));
	const type = get(file, "meta", "type") || "http";
	const isGraphql = type === "graphql";
	if (!methodBlock) {
		if (file.dict.has("grpc") || file.dict.has("ws")) warnings.add("gRPC and WebSocket requests are not supported yet and were skipped.");
		return undefined;
	}
	const headers = headersOf(file);
	const query = [...entries(file, "params:query"), ...entries(file, "query")].map((e): HttpRequestParam => compact({ name: e.name, value: e.value, type: "query" as const, disabled: e.disabled ? true : undefined }));
	const pathValues = Object.fromEntries(entries(file, "params:path").map((e) => [e.name, e.value]));
	const built = urlWithParams(get(file, methodBlock, "url"), query, pathValues);
	const bodyMode = get(file, methodBlock, "body") || "none";
	const scripts = convertScripts(file, warnings);
	const variables = entries(file, "vars:pre-request").map((e) => compact({ name: e.name, value: e.value, disabled: e.disabled ? true : undefined }));
	if (file.dict.has("assert")) warnings.add("Assertions are not supported yet and were skipped.");
	if (isGraphql) warnings.add("GraphQL bodies were converted to JSON POST bodies.");

	const request: HttpRequest = compact({
		info: { name: get(file, "meta", "name") || fallbackName, type: "http" as const },
		http: {
			method: methodBlock.toUpperCase(),
			url: built.url,
			params: built.params,
			headers,
			body: isGraphql ? graphqlBody(file, headers) : convertBody(bodyMode, file, warnings),
			auth: convertAuth(get(file, methodBlock, "auth") || "none", file, warnings),
		},
		runtime: scripts || variables.length > 0 ? compact({ scripts, variables }) : undefined,
		settings: get(file, "settings", "encodeUrl") ? { encodeUrl: get(file, "settings", "encodeUrl") === "true" } : undefined,
		docs: file.text.get("docs") || undefined,
	});
	return { kind: "request", name: request.info!.name!, request };
}

function graphqlBody(file: BruFile, headers: HttpRequestHeader[]): HttpRequestBody {
	if (!headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push(header("Content-Type", "application/json"));
	let variables: unknown;
	try {
		variables = JSON.parse(file.text.get("body:graphql:vars") || "null") ?? undefined;
	} catch {
		variables = file.text.get("body:graphql:vars");
	}
	return { type: "json", data: JSON.stringify({ query: file.text.get("body:graphql") ?? "", variables }, null, 2) };
}

function convertBody(mode: string, file: BruFile, warnings: Warnings): HttpRequestBody | undefined {
	switch (mode) {
		case "json":
		case "text":
		case "xml":
		case "sparql":
			return { type: mode, data: file.text.get(`body:${mode}`) ?? "" };
		case "formUrlEncoded":
			return { type: "form-urlencoded", data: entries(file, "body:form-urlencoded").map((e) => compact({ name: e.name, value: e.value, disabled: e.disabled ? true : undefined })) };
		case "multipartForm":
			return {
				type: "multipart-form",
				data: entries(file, "body:multipart-form").map((e) => {
					const contentType = /@contentType\(([^)]*)\)/.exec(e.value)?.[1];
					const fileRef = /^@file\(([^)]*)\)/.exec(e.value);
					const base = { name: e.name, contentType, disabled: e.disabled ? true : undefined };
					return compact(fileRef ? { ...base, type: "file" as const, value: fileRef[1]!.split("|") } : { ...base, type: "text" as const, value: e.value.replace(/\s*@contentType\([^)]*\)$/, "") });
				}),
			};
		case "file": {
			const variants = entries(file, "body:file").map((e) => ({
				filePath: /@file\(([^)]*)\)/.exec(e.value)?.[1] ?? "",
				contentType: /@contentType\(([^)]*)\)/.exec(e.value)?.[1] ?? "application/octet-stream",
				selected: !e.disabled,
			}));
			return variants.length > 0 ? { type: "file", data: variants } : undefined;
		}
		case "none":
			return undefined;
		default:
			warnings.add(`"${mode}" bodies are not supported and were dropped.`);
			return undefined;
	}
}

function convertAuth(mode: string, file: BruFile, warnings: Warnings): Auth | undefined {
	const a = (key: string) => get(file, `auth:${mode}`, key);
	switch (mode) {
		case "inherit":
			return "inherit";
		case "none":
			return undefined;
		case "basic":
			return { type: "basic", username: a("username"), password: a("password") };
		case "bearer":
			return { type: "bearer", token: a("token") };
		case "digest":
			return { type: "digest", username: a("username"), password: a("password") };
		case "apikey":
			return { type: "apikey", key: a("key"), value: a("value"), placement: a("placement") === "queryparams" ? "query" : "header" };
		case "ntlm":
			warnings.add("NTLM auth is kept but not applied yet.");
			return { type: "ntlm", username: a("username"), password: a("password"), domain: a("domain") };
		case "awsv4":
			warnings.add("AWS Signature auth is kept but not applied yet.");
			return compact({ type: "awsv4", accessKeyId: a("accessKeyId"), secretAccessKey: a("secretAccessKey"), sessionToken: a("sessionToken") || undefined, service: a("service"), region: a("region"), profileName: a("profileName") || undefined });
		case "wsse":
			warnings.add("WSSE auth is kept but not applied yet.");
			return { type: "wsse", username: a("username"), password: a("password") };
		case "oauth2": {
			const credentials = compact({ clientId: a("client_id"), clientSecret: a("client_secret") || undefined, placement: a("credentials_placement") === "body" ? ("body" as const) : ("basic_auth_header" as const) });
			const tokenConfig = { placement: a("token_placement") === "url" ? { query: a("token_query_key") || "access_token" } : { header: a("token_header_prefix") || "Bearer" } };
			const scope = a("scope") || undefined;
			switch (a("grant_type")) {
				case "password":
					return compact({ type: "oauth2", flow: "resource_owner_password_credentials", accessTokenUrl: a("access_token_url"), refreshTokenUrl: a("refresh_token_url") || undefined, credentials, resourceOwner: { username: a("username"), password: a("password") }, scope, tokenConfig });
				case "client_credentials":
					return compact({ type: "oauth2", flow: "client_credentials", accessTokenUrl: a("access_token_url"), refreshTokenUrl: a("refresh_token_url") || undefined, credentials, scope, tokenConfig });
				case "implicit":
					warnings.add("OAuth 2.0 implicit auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "implicit", authorizationUrl: a("authorization_url"), callbackUrl: a("callback_url") || undefined, credentials: { clientId: a("client_id") }, scope, tokenConfig });
				default:
					warnings.add("OAuth 2.0 authorization code auth is kept but not applied yet.");
					return compact({ type: "oauth2", flow: "authorization_code", authorizationUrl: a("authorization_url"), accessTokenUrl: a("access_token_url"), callbackUrl: a("callback_url") || undefined, credentials, scope, state: a("state") || undefined, pkce: a("pkce") === "true" ? { method: "S256" } : undefined, tokenConfig });
			}
		}
		default:
			warnings.add(`"${mode}" auth is not supported and was dropped.`);
			return undefined;
	}
}

function convertScripts(file: BruFile, warnings: Warnings): Script[] | undefined {
	const out: Script[] = [];
	const add = (block: string, type: Script["type"]) => {
		const code = file.text.get(block);
		if (code?.trim()) out.push({ type, code });
	};
	add("script:pre-request", "before-request");
	add("script:post-response", "after-response");
	add("tests", "tests");
	if (out.length > 0) warnings.add("Scripts and tests are kept but not run yet.");
	return out.length > 0 ? out : undefined;
}
