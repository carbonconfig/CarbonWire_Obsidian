import type { HttpRequest, HttpRequestBody, HttpRequestHeader } from "../model";
import { ImportError, Warnings, type ImportedEnvironment, type ImportedItem, type ImportResult } from "./model";
import { compact, findHeaderValue, header, isObject, nameFromUrl, queryFromUrl, rawType, str } from "./util";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);
const UNSUPPORTED_METHODS = new Set(["GRAPHQL", "WEBSOCKET", "GRPC"]);

/** True when the text has at least one line like "GET https://…" outside comments. */
export function looksLikeHttpFile(text: string): boolean {
	return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/m.test(text);
}

/** JetBrains HTTP Client / VS Code REST Client `.http` files. */
export function importHttpFile(text: string, fileName: string): ImportResult {
	const warnings = new Warnings();
	const variables: { name: string; value: string }[] = [];
	const items: ImportedItem[] = [];

	const blocks: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const separator = /^###\s*(.*)$/.exec(line);
		if (separator) blocks.push({ title: separator[1]!.trim(), lines: [] });
		else blocks[blocks.length - 1]!.lines.push(line);
	}

	for (const block of blocks) {
		let name = block.title;
		let i = 0;
		const lines = block.lines;
		// Comments, directives and file variables come before the request line.
		for (; i < lines.length; i++) {
			const line = lines[i]!.trim();
			if (!line) continue;
			const variable = /^@([\w.-]+)\s*=\s*(.*)$/.exec(line);
			if (variable) {
				variables.push({ name: variable[1]!, value: variable[2]!.trim() });
				continue;
			}
			const comment = /^(#|\/\/)\s*(.*)$/.exec(line);
			if (comment) {
				const directive = /^@name\s+(.+)$/.exec(comment[2]!);
				if (directive) name = directive[1]!.trim();
				continue;
			}
			break;
		}
		if (i >= lines.length) continue;

		const requestLine = /^(?:([A-Z]+)\s+)?(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/.exec(lines[i]!.trim());
		if (!requestLine) continue;
		const method = requestLine[1] ?? "GET";
		if (UNSUPPORTED_METHODS.has(method)) {
			warnings.add(`${method} requests are not supported yet and were skipped.`);
			continue;
		}
		if (!METHODS.has(method)) continue;
		let url = requestLine[2]!;
		if (!requestLine[1] && !/^(https?:\/\/|\{\{|\/)/i.test(url)) continue;
		// Long query strings may continue on indented lines starting with ? or &.
		for (i++; i < lines.length && /^\s+[?&]/.test(lines[i]!); i++) url += lines[i]!.trim();

		const headers: HttpRequestHeader[] = [];
		for (; i < lines.length && lines[i]!.trim() !== ""; i++) {
			const line = lines[i]!.trim();
			if (/^(#|\/\/)/.test(line)) continue;
			const colon = line.indexOf(":");
			if (colon > 0) headers.push(header(line.slice(0, colon).trim(), line.slice(colon + 1).trim()));
		}

		const bodyLines: string[] = [];
		for (i++; i < lines.length; i++) {
			const line = lines[i]!;
			if (/^>\s/.test(line) || /^<>\s/.test(line)) {
				if (/^>\s/.test(line)) warnings.add("Response handler scripts (> {% … %}) are not imported.");
				break;
			}
			bodyLines.push(line);
		}
		const bodyText = bodyLines.join("\n").replace(/\s+$/, "");
		const request: HttpRequest = compact({
			http: { method, url, params: queryFromUrl(url), headers, body: convertBody(bodyText, headers, warnings) },
		});
		const requestName = name || nameFromUrl(method, url);
		items.push({ kind: "request", name: requestName, request });
	}

	if (items.length === 0) throw new ImportError("No requests were found in this .http file.");
	const collectionName = fileName.replace(/^.*\//, "").replace(/\.(http|rest)$/i, "") || "HTTP requests";
	return {
		format: ".http file",
		collections: [{ name: collectionName, defaults: { variables }, items, environments: [] }],
		environments: [],
		warnings: warnings.list(),
	};
}

function convertBody(text: string, headers: HttpRequestHeader[], warnings: Warnings): HttpRequestBody | undefined {
	if (!text.trim()) return undefined;
	const contentType = findHeaderValue(headers, "content-type");
	const fileRef = /^<\s+(\S+)\s*$/.exec(text.trim());
	if (fileRef) {
		warnings.add("Bodies read from files (< ./file) point to paths relative to the original .http file; check them before sending.");
		return { type: "file", data: [{ filePath: fileRef[1]!, contentType: contentType ?? "application/octet-stream", selected: true }] };
	}
	if (contentType?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
		return { type: "form-urlencoded", data: [...new URLSearchParams(text.replace(/\n/g, ""))].map(([name, value]) => ({ name, value })) };
	}
	return { type: contentType ? rawType(contentType) : /^\s*[[{]/.test(text) ? "json" : "text", data: text };
}

/** `http-client.env.json` (and the private variant, whose values are treated as secrets). */
export function importHttpClientEnv(data: unknown, isPrivate: boolean): ImportResult {
	if (!isObject(data)) throw new ImportError("Not an http-client environment file.");
	const environments = Object.entries(data)
		.filter(([name, vars]) => name !== "$shared" && isObject(vars))
		.map(([name, vars]): ImportedEnvironment => ({
			name,
			variables: Object.entries(vars as Record<string, unknown>).map(([k, v]) => ({ name: k, value: typeof v === "object" ? JSON.stringify(v) : str(v), secret: isPrivate })),
		}));
	return { format: isPrivate ? "HTTP Client private environments" : "HTTP Client environments", collections: [], environments, warnings: [] };
}
