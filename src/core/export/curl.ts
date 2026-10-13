import { findHeader } from "../headers";
import type { ResolvedRequest } from "../request-builder";

export interface CurlOptions {
	/** The path curl should read a body file from. */
	filePath(path: string): string;
	/** Skip TLS verification, matching the plugin setting. */
	insecure?: boolean;
}

/** A POSIX shell cURL command equivalent to sending the resolved request. */
export function toCurl(request: ResolvedRequest, options: CurlOptions): string {
	const args: string[] = [];
	const { method, body, settings } = request;
	const verb = method === "HEAD" ? "--head " : method !== "GET" || body ? `--request ${method} ` : "";
	const first = `curl ${verb}${quote(request.url)}`;

	// curl writes the multipart boundary itself, so a Content-Type header would break the body.
	const headers = body?.kind === "multipart" ? request.headers.filter(([n]) => n.toLowerCase() !== "content-type") : request.headers;
	for (const [name, value] of headers) args.push(`--header ${quote(`${name}: ${value}`)}`);

	switch (body?.kind) {
		case "text":
			args.push(`--data-raw ${quote(body.text)}`);
			break;
		case "file":
			args.push(`--data-binary ${quote(`@${options.filePath(body.filePath)}`)}`);
			break;
		case "multipart":
			for (const part of body.parts) {
				const type = part.contentType ? `;type=${part.contentType}` : "";
				if ("filePath" in part) args.push(`--form ${quote(`${part.name}=@${options.filePath(part.filePath)}${type}`)}`);
				// --form-string keeps a leading @ or < in a value literal.
				else args.push(`--form-string ${quote(`${part.name}=${part.value}`)}`);
			}
			break;
	}

	const auth = request.pendingAuth;
	if (auth?.type === "digest") args.push("--digest", `--user ${quote(`${auth.username ?? ""}:${auth.password ?? ""}`)}`);
	if (settings.followRedirects) args.push("--location", `--max-redirs ${settings.maxRedirects}`);
	if (settings.timeout > 0) args.push(`--max-time ${settings.timeout / 1000}`);
	if (options.insecure) args.push("--insecure");
	if (findHeader(request.headers, "accept-encoding")) args.push("--compressed");
	return [first, ...args].join(" \\\n  ");
}

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
