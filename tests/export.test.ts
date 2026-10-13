import { describe, expect, it } from "vitest";
import { toCurl } from "../src/core/export/curl";
import type { HttpRequest } from "../src/core/model";
import { buildRequest } from "../src/core/request-builder";

const scope = new Map([
	["base", "https://api.example.com"],
	["token", "it's secret"],
]);
const files = { filePath: (p: string) => `/vault/API/${p}` };

describe("toCurl", () => {
	it("writes method, resolved URL, headers and a JSON body, quoting for the shell", () => {
		const req: HttpRequest = {
			http: {
				method: "post",
				url: "{{base}}/users",
				headers: [{ name: "X-Note", value: "it's" }],
				body: { type: "json", data: '{"name":"Ann"}' },
				auth: { type: "bearer", token: "{{token}}" },
			},
		};
		expect(toCurl(buildRequest(req, [], scope), files)).toBe(
			[
				"curl --request POST 'https://api.example.com/users'",
				`--header 'X-Note: it'\\''s'`,
				"--header 'Content-Type: application/json'",
				`--header 'Authorization: Bearer it'\\''s secret'`,
				`--data-raw '{"name":"Ann"}'`,
				"--location",
				"--max-redirs 5",
			].join(" \\\n  "),
		);
	});

	it("uses --form for multipart without a Content-Type header, and file paths curl can read", () => {
		const req: HttpRequest = {
			http: {
				method: "POST",
				url: "https://x.test/upload",
				headers: [{ name: "Content-Type", value: "multipart/form-data" }],
				body: {
					type: "multipart-form",
					data: [
						{ name: "note", type: "text", value: "@literal" },
						{ name: "file", type: "file", value: "files/a.png", contentType: "image/png" },
					],
				},
			},
			settings: { followRedirects: false, timeout: 2500 },
		};
		const curl = toCurl(buildRequest(req, [], scope), { ...files, insecure: true });
		expect(curl).not.toContain("Content-Type");
		expect(curl).toContain("--form-string 'note=@literal'");
		expect(curl).toContain("--form 'file=@/vault/API/files/a.png;type=image/png'");
		expect(curl).toContain("--max-time 2.5");
		expect(curl).toContain("--insecure");
		expect(curl).not.toContain("--location");
	});

	it("omits --request for a plain GET and uses --digest for digest auth", () => {
		const req: HttpRequest = { http: { method: "GET", url: "https://x.test/", auth: { type: "digest", username: "u", password: "p" } } };
		const curl = toCurl(buildRequest(req, [], scope), files);
		expect(curl.startsWith("curl 'https://x.test/'")).toBe(true);
		expect(curl).toContain("--digest \\\n  --user 'u:p'");
	});
});
