import { describe, expect, it } from "vitest";
import { encodeBody } from "../src/core/body";
import { buildRequest } from "../src/core/request-builder";
import type { DefaultsChain, HttpRequest } from "../src/core/model";

const scope = new Map([
	["base", "https://api.example.com"],
	["id", "42"],
	["user", "ädmin"],
	["token", "t0k"],
]);

describe("buildRequest", () => {
	it("builds URL from path and query params, replacing the URL's query string", () => {
		const req: HttpRequest = {
			http: {
				method: "get",
				url: "{{base}}/users/:id?stale=1#frag",
				params: [
					{ name: "id", value: "{{id}}", type: "path", disabled: true },
					{ name: "q", value: "a b&c", type: "query" },
					{ name: "off", value: "x", type: "query", disabled: true },
					{ name: "pre", value: "already%20encoded", type: "query" },
				],
			},
		};
		const built = buildRequest(req, [], scope);
		expect(built.method).toBe("GET");
		expect(built.url).toBe("https://api.example.com/users/42?q=a%20b%26c&pre=already%20encoded#frag");
	});

	it("keeps the URL query as written when there are no query params", () => {
		const built = buildRequest({ http: { url: "{{base}}/s?x=1&y={{id}}" } }, [], scope);
		expect(built.url).toBe("https://api.example.com/s?x=1&y=42");
	});

	it("applies inherited auth and folder headers", () => {
		const chain: DefaultsChain = [
			{ auth: { type: "basic", username: "{{user}}", password: "p" }, headers: [{ name: "X-Collection", value: "1" }] },
			{ auth: "inherit", headers: [{ name: "X-Folder", value: "{{id}}" }] },
		];
		const built = buildRequest({ http: { url: "{{base}}", auth: "inherit" } }, chain, scope);
		expect(built.headers).toEqual([
			["X-Collection", "1"],
			["X-Folder", "42"],
			["Authorization", `Basic ${Buffer.from("ädmin:p").toString("base64")}`],
		]);
	});

	it("places API keys in the query when configured", () => {
		const built = buildRequest(
			{ http: { url: "{{base}}/x", auth: { type: "apikey", key: "api_key", value: "{{token}}", placement: "query" } } },
			[],
			scope,
		);
		expect(built.url).toBe("https://api.example.com/x?api_key=t0k");
	});

	it("defers digest auth to the sender and warns on unsupported types", () => {
		expect(buildRequest({ http: { url: "x", auth: { type: "digest", username: "u" } } }, [], scope).pendingAuth?.type).toBe("digest");
		expect(buildRequest({ http: { url: "x", auth: { type: "ntlm" } } }, [], scope).warnings).toHaveLength(1);
	});

	it("sets a default content type for raw bodies unless one is given", () => {
		const json = buildRequest({ http: { url: "x", body: { type: "json", data: '{"id":{{id}}}' } } }, [], scope);
		expect(json.body).toEqual({ kind: "text", text: '{"id":42}', contentType: "application/json" });
		expect(json.headers).toContainEqual(["Content-Type", "application/json"]);

		const custom = buildRequest(
			{ http: { url: "x", headers: [{ name: "content-type", value: "application/vnd.api+json" }], body: { type: "json", data: "{}" } } },
			[],
			scope,
		);
		expect(custom.headers).toEqual([["content-type", "application/vnd.api+json"]]);
	});

	it("uses the selected body variant and encodes form bodies", () => {
		const built = buildRequest(
			{
				http: {
					url: "x",
					body: [
						{ title: "json", body: { type: "json", data: "{}" } },
						{ title: "form", selected: true, body: { type: "form-urlencoded", data: [{ name: "a", value: "1 2" }, { name: "id", value: "{{id}}" }] } },
					],
				},
			},
			[],
			scope,
		);
		expect(built.body).toEqual({ kind: "text", text: "a=1+2&id=42", contentType: "application/x-www-form-urlencoded" });
	});
});

describe("encodeBody", () => {
	it("encodes multipart bodies with text and file parts", async () => {
		const body = await encodeBody(
			{ kind: "multipart", parts: [{ name: "field", value: "v" }, { name: "upload", filePath: "files/a.txt", contentType: "text/plain" }] },
			async (path) => new TextEncoder().encode(`contents of ${path}`),
		);
		const boundary = body!.contentType!.split("boundary=")[1]!;
		const text = new TextDecoder().decode(body!.bytes);
		expect(text).toBe(
			`--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nv\r\n` +
				`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncontents of files/a.txt\r\n` +
				`--${boundary}--\r\n`,
		);
	});
});
