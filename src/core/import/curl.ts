import type { Auth, HttpRequest, HttpRequestBody, HttpRequestHeader, MultipartFormEntry } from "../model";
import { ImportError, Warnings, type ImportResult } from "./model";
import { compact, findHeaderValue, header, nameFromUrl, queryFromUrl, rawType } from "./util";

/** Options that take a value; everything else is treated as a flag. */
const VALUE_OPTIONS = new Map<string, string>([
	["-X", "request"], ["--request", "request"],
	["-H", "header"], ["--header", "header"],
	["-d", "data"], ["--data", "data"], ["--data-ascii", "data"], ["--data-binary", "data"], ["--data-raw", "data-raw"],
	["--data-urlencode", "data-urlencode"], ["--json", "json"],
	["-F", "form"], ["--form", "form"], ["--form-string", "form-string"],
	["-u", "user"], ["--user", "user"], ["-A", "user-agent"], ["--user-agent", "user-agent"],
	["-b", "cookie"], ["--cookie", "cookie"], ["-e", "referer"], ["--referer", "referer"],
	["--url", "url"], ["--oauth2-bearer", "bearer"],
	["-o", "ignored"], ["--output", "ignored"], ["-w", "ignored"], ["--write-out", "ignored"], ["-m", "ignored"], ["--max-time", "ignored"],
	["--connect-timeout", "ignored"], ["-x", "proxy"], ["--proxy", "proxy"], ["-E", "cert"], ["--cert", "cert"], ["--cacert", "cert"], ["--key", "cert"],
	["-T", "upload"], ["--upload-file", "upload"], ["-c", "ignored"], ["--cookie-jar", "ignored"], ["--retry", "ignored"],
]);

const SHORT_WITH_VALUE = new Set(["X", "H", "d", "F", "u", "A", "b", "e", "o", "w", "m", "x", "E", "T", "c"]);

export function isCurl(text: string): boolean {
	return /^\s*curl(\.exe)?\s/i.test(text);
}

/** Splits a shell command line, handling quotes, $'…' strings and line continuations. */
export function tokenize(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inToken = false;
	const s = command.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, " ");
	for (let i = 0; i < s.length; i++) {
		const c = s[i]!;
		if (/\s/.test(c)) {
			if (inToken) tokens.push(current);
			current = "";
			inToken = false;
		} else if (c === "'") {
			inToken = true;
			const end = s.indexOf("'", i + 1);
			current += s.slice(i + 1, end < 0 ? s.length : end);
			i = end < 0 ? s.length : end;
		} else if (c === "$" && s[i + 1] === "'") {
			inToken = true;
			let j = i + 2;
			for (; j < s.length && s[j] !== "'"; j++) {
				if (s[j] === "\\" && j + 1 < s.length) {
					const n = s[++j]!;
					const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
					if (n === "x") {
						current += String.fromCharCode(parseInt(s.slice(j + 1, j + 3), 16));
						j += 2;
					} else {
						current += escapes[n] ?? n;
					}
				} else {
					current += s[j];
				}
			}
			i = j;
		} else if (c === '"') {
			inToken = true;
			let j = i + 1;
			for (; j < s.length && s[j] !== '"'; j++) {
				if (s[j] === "\\" && '"\\$`'.includes(s[j + 1] ?? "")) j++;
				current += s[j];
			}
			i = j;
		} else if (c === "\\" && i + 1 < s.length) {
			inToken = true;
			current += s[++i];
		} else {
			inToken = true;
			current += c;
		}
	}
	if (inToken) tokens.push(current);
	return tokens;
}

export function importCurl(command: string): ImportResult {
	const tokens = tokenize(command.trim());
	if (!/^curl(\.exe)?$/i.test(tokens[0] ?? "")) throw new ImportError("This doesn't look like a curl command.");
	const warnings = new Warnings();
	const headers: HttpRequestHeader[] = [];
	const data: string[] = [];
	const form: MultipartFormEntry[] = [];
	let method: string | undefined;
	let url: string | undefined;
	let auth: Auth | undefined;
	let get = false;
	let head = false;
	let rawData = false;

	const apply = (option: string, value: string) => {
		switch (option) {
			case "request":
				method = value.toUpperCase();
				break;
			case "header": {
				const i = value.indexOf(":");
				if (i > 0) headers.push(header(value.slice(0, i).trim(), value.slice(i + 1).trim()));
				break;
			}
			case "data-raw":
				rawData = true;
				data.push(value);
				break;
			case "data":
				if (value.startsWith("@")) warnings.add("Request bodies read from files (-d @file) were kept as the literal @path.");
				data.push(value);
				break;
			case "data-urlencode": {
				if (value.startsWith("@") || /^[^=]*@/.test(value)) warnings.add("--data-urlencode values read from files were kept as text.");
				const eq = value.indexOf("=");
				data.push(eq < 0 ? encodeURIComponent(value) : `${value.slice(0, eq)}${eq > 0 ? "=" : ""}${encodeURIComponent(value.slice(eq + 1))}`);
				break;
			}
			case "json":
				data.push(value);
				if (!findHeaderValue(headers, "content-type")) headers.push(header("Content-Type", "application/json"));
				if (!findHeaderValue(headers, "accept")) headers.push(header("Accept", "application/json"));
				break;
			case "form":
			case "form-string": {
				const eq = value.indexOf("=");
				const name = value.slice(0, eq);
				const v = value.slice(eq + 1);
				const type = /;type=([^;]+)/.exec(v)?.[1];
				if (option === "form" && (v.startsWith("@") || v.startsWith("<"))) {
					warnings.add("Multipart file paths point to files on the machine the command came from; check them before sending.");
					form.push(compact({ name, type: "file" as const, value: v.slice(1).split(";")[0]!, contentType: type }));
				} else {
					form.push(compact({ name, type: "text" as const, value: option === "form" ? v.split(";type=")[0]! : v, contentType: option === "form" ? type : undefined }));
				}
				break;
			}
			case "user": {
				const i = value.indexOf(":");
				auth = { type: "basic", username: i < 0 ? value : value.slice(0, i), password: i < 0 ? "" : value.slice(i + 1) };
				break;
			}
			case "bearer":
				auth = { type: "bearer", token: value };
				break;
			case "user-agent":
				headers.push(header("User-Agent", value));
				break;
			case "referer":
				headers.push(header("Referer", value));
				break;
			case "cookie":
				if (value.includes("=")) headers.push(header("Cookie", value));
				else warnings.add("Cookie files (-b file) are not imported.");
				break;
			case "url":
				url ??= value;
				break;
			case "proxy":
				warnings.add("Proxy settings are not imported.");
				break;
			case "cert":
				warnings.add("Client certificate options are not imported.");
				break;
			case "upload":
				warnings.add("Uploaded files (-T) are not imported.");
				break;
		}
	};

	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.startsWith("--")) {
			const eq = token.indexOf("=");
			const name = eq > 0 ? token.slice(0, eq) : token;
			const option = VALUE_OPTIONS.get(name);
			if (option) apply(option, eq > 0 ? token.slice(eq + 1) : (tokens[++i] ?? ""));
			else if (name === "--get") get = true;
			else if (name === "--head") head = true;
			else if (name === "--insecure") warnings.add("--insecure was ignored; turn off certificate verification in CarbonWire's settings if needed.");
		} else if (token.startsWith("-") && token.length > 1) {
			// Short options may be clustered (-sSL) or carry their value inline (-XPOST).
			for (let j = 1; j < token.length; j++) {
				const flag = token[j]!;
				if (SHORT_WITH_VALUE.has(flag)) {
					const inline = token.slice(j + 1);
					apply(VALUE_OPTIONS.get(`-${flag}`)!, inline || (tokens[++i] ?? ""));
					break;
				}
				if (flag === "G") get = true;
				else if (flag === "I") head = true;
				else if (flag === "k") warnings.add("--insecure was ignored; turn off certificate verification in CarbonWire's settings if needed.");
			}
		} else {
			url ??= token;
		}
	}
	if (!url) throw new ImportError("The curl command has no URL.");
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("{{")) url = `http://${url}`;

	let body: HttpRequestBody | undefined;
	if (get && data.length > 0) {
		url += (url.includes("?") ? "&" : "?") + data.join("&");
	} else if (form.length > 0) {
		body = { type: "multipart-form", data: form };
	} else if (data.length > 0) {
		body = dataBody(data.join("&"), headers, rawData);
	}
	const finalMethod = method ?? (head ? "HEAD" : body && !get ? "POST" : "GET");
	const request: HttpRequest = compact({
		http: { method: finalMethod, url, params: queryFromUrl(url), headers, body, auth },
	});
	const name = nameFromUrl(finalMethod, url);
	return { format: "cURL", collections: [{ name, defaults: {}, items: [{ kind: "request", name, request }], environments: [] }], environments: [], warnings: warnings.list() };
}

/** Parses a curl command into a request and a name for it, for pasting into a request. */
export function requestFromCurl(command: string): { name: string; request: HttpRequest; warnings: string[] } {
	const result = importCurl(command);
	const item = result.collections[0]?.items[0];
	if (item?.kind !== "request") throw new ImportError("The curl command has no URL.");
	return { name: item.name, request: item.request, warnings: result.warnings };
}

/** curl sends -d data as form-urlencoded unless a Content-Type header says otherwise. */
function dataBody(text: string, headers: HttpRequestHeader[], raw: boolean): HttpRequestBody {
	const contentType = findHeaderValue(headers, "content-type");
	const looksJson = /^\s*[[{]/.test(text);
	if (!contentType && !looksJson && !raw && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text)) {
		return { type: "form-urlencoded", data: [...new URLSearchParams(text)].map(([name, value]) => ({ name, value })) };
	}
	if (!contentType) headers.push(header("Content-Type", looksJson ? "application/json" : "application/x-www-form-urlencoded"));
	return { type: contentType ? rawType(contentType) : looksJson ? "json" : "text", data: text };
}
