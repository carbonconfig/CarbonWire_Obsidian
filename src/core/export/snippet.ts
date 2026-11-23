import { findHeader } from "../headers";
import type { ResolvedRequest } from "../request-builder";
import { toCurl, type CurlOptions } from "./curl";

/* The resolved request as code: cURL, raw HTTP, JavaScript fetch, Python requests and Go net/http. */

export const SNIPPET_LANGUAGES = [
	{ id: "curl", label: "cURL", highlight: "shell" },
	{ id: "http", label: "HTTP", highlight: "http" },
	{ id: "fetch", label: "JavaScript (fetch)", highlight: "javascript" },
	{ id: "python", label: "Python (requests)", highlight: "python" },
	{ id: "go", label: "Go (net/http)", highlight: "go" },
] as const;

export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number]["id"];

export function snippet(language: SnippetLanguage, request: ResolvedRequest, options: CurlOptions): string {
	switch (language) {
		case "curl":
			return toCurl(request, options);
		case "http":
			return http(request, options);
		case "fetch":
			return fetchCode(request, options);
		case "python":
			return python(request, options);
		case "go":
			return go(request, options);
	}
}

/** Auth applied while sending that the code doesn't do, said in a comment. */
function authNote(request: ResolvedRequest): string | undefined {
	switch (request.pendingAuth?.type) {
		case undefined:
			return undefined;
		case "digest":
			return "Digest auth is answered when sending; this code doesn't do it.";
		case "oauth2":
			return "An OAuth 2.0 token is added when sending; this code doesn't fetch one.";
		case "ntlm":
			return "NTLM auth is negotiated when sending; this code doesn't do it.";
		default:
			return "The request is signed when sending; this code doesn't sign it.";
	}
}

/** The headers to write, less Content-Type for multipart bodies, whose boundary the library writes. */
function headers(request: ResolvedRequest): (readonly [string, string])[] {
	const multipart = request.body?.kind === "multipart";
	return request.headers.filter(([n]) => !(multipart && n.toLowerCase() === "content-type"));
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A double-quoted literal with C-style escapes, valid in JavaScript, Python and Go. */
function quoted(text: string): string {
	let out = '"';
	for (const c of text) {
		const code = c.codePointAt(0)!;
		if (c === '"') out += '\\"';
		else if (c === "\\") out += "\\\\";
		else if (c === "\n") out += "\\n";
		else if (c === "\r") out += "\\r";
		else if (c === "\t") out += "\\t";
		else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
		// Line and paragraph separators end a JavaScript string literal.
		else if (code === 0x2028 || code === 0x2029) out += `\\u${code.toString(16)}`;
		else out += c;
	}
	return `${out}"`;
}

function http(request: ResolvedRequest, options: CurlOptions): string {
	let url: URL | undefined;
	try {
		url = new URL(request.url);
	} catch {
		url = undefined;
	}
	const target = url ? url.pathname + url.search : request.url;
	let out = `${request.method} ${target} HTTP/1.1\n`;
	if (!findHeader(request.headers, "host") && url) out += `Host: ${url.host}\n`;
	const boundary = "CarbonWireBoundary";
	for (const [name, value] of headers(request)) out += `${name}: ${value}\n`;
	const body = request.body;
	if (body?.kind === "multipart") out += `Content-Type: multipart/form-data; boundary=${boundary}\n`;
	if (body?.kind === "text") out += `\n${body.text}`;
	// "< path" is how .http files say "the file's contents".
	else if (body?.kind === "file") out += `\n< ${options.filePath(body.filePath)}`;
	else if (body?.kind === "multipart") {
		out += "\n";
		for (const part of body.parts) {
			out += `--${boundary}\n`;
			if ("filePath" in part) {
				out += `Content-Disposition: form-data; name="${part.name}"; filename="${fileName(part.filePath)}"\n`;
				if (part.contentType) out += `Content-Type: ${part.contentType}\n`;
				out += `\n< ${options.filePath(part.filePath)}\n`;
			} else {
				out += `Content-Disposition: form-data; name="${part.name}"\n`;
				if (part.contentType) out += `Content-Type: ${part.contentType}\n`;
				out += `\n${part.value}\n`;
			}
		}
		out += `--${boundary}--\n`;
	}
	const note = authNote(request);
	if (note) out = `# ${note}\n${out}`;
	return `${out.trimEnd()}\n`;
}

function fetchCode(request: ResolvedRequest, options: CurlOptions): string {
	const prelude: string[] = [];
	const fields = [`  method: ${quoted(request.method)},`];
	const list = headers(request);
	if (list.length > 0) {
		fields.push("  headers: {");
		for (const [name, value] of list) fields.push(`    ${quoted(name)}: ${quoted(value)},`);
		fields.push("  },");
	}
	let readsFiles = false;
	const body = request.body;
	if (body?.kind === "text") fields.push(`  body: ${quoted(body.text)},`);
	else if (body?.kind === "file") {
		readsFiles = true;
		fields.push(`  body: await readFile(${quoted(options.filePath(body.filePath))}),`);
	} else if (body?.kind === "multipart") {
		prelude.push("const form = new FormData();");
		for (const part of body.parts) {
			const type = part.contentType ? `, { type: ${quoted(part.contentType)} }` : "";
			if ("filePath" in part) {
				readsFiles = true;
				prelude.push(`form.append(${quoted(part.name)}, new Blob([await readFile(${quoted(options.filePath(part.filePath))})]${type}), ${quoted(fileName(part.filePath))});`);
			} else if (part.contentType) {
				prelude.push(`form.append(${quoted(part.name)}, new Blob([${quoted(part.value)}]${type}));`);
			} else {
				prelude.push(`form.append(${quoted(part.name)}, ${quoted(part.value)});`);
			}
		}
		fields.push("  body: form,");
	}
	if (!request.settings.followRedirects) fields.push('  redirect: "manual",');
	if (request.settings.timeout > 0) fields.push(`  signal: AbortSignal.timeout(${request.settings.timeout}),`);
	let out = "";
	const note = authNote(request);
	if (note) out += `// ${note}\n`;
	if (options.insecure) out += "// Certificates aren't checked for this request; Node does that with NODE_TLS_REJECT_UNAUTHORIZED=0.\n";
	if (readsFiles) out += 'import { readFile } from "node:fs/promises";\n\n';
	for (const line of prelude) out += `${line}\n`;
	if (out.endsWith(";\n")) out += "\n";
	out += `const response = await fetch(${quoted(request.url)}, {\n${fields.join("\n")}\n});\n\nconsole.log(response.status);\nconsole.log(await response.text());\n`;
	return out;
}

function python(request: ResolvedRequest, options: CurlOptions): string {
	let out = "";
	const note = authNote(request);
	if (note) out += `# ${note}\n`;
	out += "import requests\n\n";
	out += `url = ${quoted(request.url)}\n`;
	const args = [quoted(request.method), "url"];
	const list = headers(request);
	if (list.length > 0) {
		out += "headers = {\n";
		for (const [name, value] of list) out += `    ${quoted(name)}: ${quoted(value)},\n`;
		out += "}\n";
		args.push("headers=headers");
	}
	const body = request.body;
	if (body?.kind === "text") {
		out += `data = ${quoted(body.text)}\n`;
		args.push("data=data.encode()");
	} else if (body?.kind === "file") {
		out += `data = open(${quoted(options.filePath(body.filePath))}, "rb")\n`;
		args.push("data=data");
	} else if (body?.kind === "multipart") {
		out += "files = [\n";
		for (const part of body.parts) {
			const type = part.contentType ? `, ${quoted(part.contentType)}` : "";
			if ("filePath" in part) out += `    (${quoted(part.name)}, (${quoted(fileName(part.filePath))}, open(${quoted(options.filePath(part.filePath))}, "rb")${type})),\n`;
			else out += `    (${quoted(part.name)}, (None, ${quoted(part.value)}${type})),\n`;
		}
		out += "]\n";
		args.push("files=files");
	}
	if (!request.settings.followRedirects) args.push("allow_redirects=False");
	if (request.settings.timeout > 0) args.push(`timeout=${request.settings.timeout / 1000}`);
	if (options.insecure) args.push("verify=False");
	out += `\nresponse = requests.request(${args.join(", ")})\n\nprint(response.status_code)\nprint(response.text)\n`;
	return out;
}

function go(request: ResolvedRequest, options: CurlOptions): string {
	const imports = new Set(["fmt", "io", "net/http"]);
	const body: string[] = [];
	let bodyVar = "nil";
	let multipartType = false;
	const b = request.body;
	if (b?.kind === "text") {
		imports.add("strings");
		body.push(`\tbody := strings.NewReader(${quoted(b.text)})`);
		bodyVar = "body";
	} else if (b?.kind === "file") {
		imports.add("os");
		body.push(`\tbody, err := os.Open(${quoted(options.filePath(b.filePath))})\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer body.Close()`);
		bodyVar = "body";
	} else if (b?.kind === "multipart") {
		imports.add("bytes");
		imports.add("mime/multipart");
		body.push("\tbody := &bytes.Buffer{}\n\tform := multipart.NewWriter(body)");
		for (const part of b.parts) {
			if ("filePath" in part) {
				imports.add("os");
				body.push(
					`\tif file, err := os.Open(${quoted(options.filePath(part.filePath))}); err != nil {\n\t\tpanic(err)\n\t} else {\n\t\tpart, _ := form.CreateFormFile(${quoted(part.name)}, ${quoted(fileName(part.filePath))})\n\t\tio.Copy(part, file)\n\t\tfile.Close()\n\t}`,
				);
			} else {
				body.push(`\tform.WriteField(${quoted(part.name)}, ${quoted(part.value)})`);
			}
		}
		body.push("\tform.Close()");
		bodyVar = "body";
		multipartType = true;
	}
	const client: string[] = [];
	if (request.settings.timeout > 0) {
		imports.add("time");
		client.push(`\t\tTimeout: ${request.settings.timeout} * time.Millisecond,`);
	}
	if (!request.settings.followRedirects) client.push("\t\tCheckRedirect: func(*http.Request, []*http.Request) error {\n\t\t\treturn http.ErrUseLastResponse\n\t\t},");
	if (options.insecure) {
		imports.add("crypto/tls");
		client.push("\t\tTransport: &http.Transport{\n\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},\n\t\t},");
	}
	let out = "";
	const note = authNote(request);
	if (note) out += `// ${note}\n`;
	out += "package main\n\nimport (\n";
	for (const i of [...imports].sort()) out += `\t"${i}"\n`;
	out += ")\n\nfunc main() {\n";
	for (const line of body) out += `${line}\n`;
	out += `\treq, err := http.NewRequest(${quoted(request.method)}, ${quoted(request.url)}, ${bodyVar})\n\tif err != nil {\n\t\tpanic(err)\n\t}\n`;
	for (const [name, value] of headers(request)) out += `\treq.Header.Add(${quoted(name)}, ${quoted(value)})\n`;
	if (multipartType) out += '\treq.Header.Set("Content-Type", form.FormDataContentType())\n';
	if (client.length === 0) out += "\n\tres, err := http.DefaultClient.Do(req)\n";
	else out += `\n\tclient := &http.Client{\n${client.join("\n")}\n\t}\n\tres, err := client.Do(req)\n`;
	out += "\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer res.Body.Close()\n\tdata, _ := io.ReadAll(res.Body)\n\tfmt.Println(res.Status)\n\tfmt.Println(string(data))\n}\n";
	return out;
}
