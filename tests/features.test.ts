import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CookieJar, parseSetCookie } from "../src/core/cookies";
import { DYNAMIC_NAMES, dynamicValue, jsDate } from "../src/core/dynamic";
import { curlScript, har, postmanCollection, postmanV3, type Collected } from "../src/core/export/collection";
import { snippet } from "../src/core/export/snippet";
import { zip } from "../src/core/export/zip";
import { resolveSettings } from "../src/core/inheritance";
import { queryJson } from "../src/core/jsonpath";
import type { HttpRequest } from "../src/core/model";
import { buildRequest } from "../src/core/request-builder";
import type { Sidecar } from "../src/core/storage/sidecar";
import { CollectionStore } from "../src/core/storage/store";
import { importText } from "../src/core/import/detect";
import { writeImport } from "../src/core/import/writer";
import { buildScope, interpolate } from "../src/core/variables";
import { MemoryFiles } from "./memory-files";

const json = (text: string | undefined) => JSON.parse(text ?? "null") as Sidecar;
const readYaml = (text: string | undefined) => parse(text ?? "") as { http: { auth?: unknown }; settings?: unknown; request?: unknown };

describe("dynamic variables", () => {
	it("gives every name a value of Postman's shape", () => {
		expect(DYNAMIC_NAMES.length).toBeGreaterThan(110);
		for (const name of DYNAMIC_NAMES) expect(dynamicValue(name), name).toBeTruthy();
		expect(dynamicValue("$randomNope")).toBeUndefined();
		expect(dynamicValue("$randomIP")!.split(".").every((p) => Number(p) < 256)).toBe(true);
		expect(dynamicValue("$randomIPV6")!.split(":")).toHaveLength(8);
		expect(dynamicValue("$randomMACAddress")).toHaveLength(17);
		expect(dynamicValue("$randomHexColor")).toMatch(/^#[0-9a-f]{6}$/);
		expect(dynamicValue("$randomPassword")).toHaveLength(15);
		expect(dynamicValue("$randomEmail")).toContain("@");
		expect(dynamicValue("$randomLoremSentence")!.endsWith(".")).toBe(true);
		expect(dynamicValue("$randomAnimalsImage")).toBe("http://placeimg.com/640/480/animals");
		expect(jsDate(1_793_625_900)).toBe("Mon Nov 02 2026 13:25:00 GMT+0000 (Coordinated Universal Time)");
	});

	it("resolves in templates", () => {
		expect(interpolate("{{$randomBoolean}}", new Map())).toMatch(/^(true|false)$/);
	});
});

describe("globals", () => {
	it("are the outermost scope", () => {
		const scope = buildScope({ globals: [{ name: "a", value: "g" }, { name: "b", value: "g" }], collection: [{ name: "b", value: "c" }] });
		expect(scope.get("a")).toBe("g");
		expect(scope.get("b")).toBe("c");
	});
});

describe("request settings", () => {
	it("resolve Postman's extras from the innermost level", () => {
		const s = resolveSettings([{ settings: { http: { strictSSL: false, protocolVersion: "http2" } as never } }], { disableCookies: true, followOriginalHttpMethod: true, tlsCipherSelection: ["TLS_AES_128_GCM_SHA256"] });
		expect(s.verifyTls).toBe(false);
		expect(s.useCookies).toBe(false);
		expect(s.httpVersion).toBe("http2");
		expect(s.keepMethod).toBe(true);
		expect(s.ciphers).toEqual(["TLS_AES_128_GCM_SHA256"]);
		expect(resolveSettings([], undefined).httpVersion).toBe("http1");
	});
});

describe("sidecar", () => {
	const jwt = { type: "jwt", algorithm: "HS256", secret: "s", payload: "{}" };

	function setup() {
		const mem = new MemoryFiles({
			"c/opencollection.yml": "opencollection: 1.0.0\ninfo:\n  name: C\n",
			"c/users/folder.yml": "info:\n  name: users\n",
			"c/users/get.yml": "info:\n  name: get\nhttp:\n  method: GET\n  url: http://x\n",
		});
		return { mem, store: new CollectionStore(mem, (p) => (p.startsWith("c/") ? "c" : undefined)) };
	}

	it("keeps auth and settings OpenCollection lacks out of the YAML", async () => {
		const { mem, store } = setup();
		const request = await store.loadRequest("c/users/get.yml");
		request.http!.auth = jwt as never;
		request.settings = { timeout: 5, strictSSL: false } as never;
		await store.saveRequest("c/users/get.yml", request);

		const yaml = readYaml(mem.files.get("c/users/get.yml"));
		expect(yaml.http.auth).toBeUndefined();
		expect(yaml.settings).toEqual({ timeout: 5 });
		const sidecar = json(mem.files.get("c/.carbonwire/collection.json"));
		expect(sidecar.version).toBe(1);
		expect(sidecar.items!["users/get.yml"]!.auth).toEqual({
			type: "jwt",
			jwt: [
				{ key: "algorithm", value: "HS256", type: "string" },
				{ key: "secret", value: "s", type: "string" },
				{ key: "payload", value: "{}", type: "string" },
			],
		});
		expect(sidecar.items!["users/get.yml"]!.settings).toEqual({ strictSSL: false });

		const fresh = new CollectionStore(mem, (p) => (p.startsWith("c/") ? "c" : undefined));
		const back = await fresh.loadRequest("c/users/get.yml");
		expect(back.http!.auth).toEqual(jwt);
		expect(back.settings).toEqual({ timeout: 5, strictSSL: false });
	});

	it("puts folder and collection extras back for sending", async () => {
		const { mem, store } = setup();
		const folder = await store.loadDocument<{ request?: object }>("c/users/folder.yml");
		await store.saveDocument("c/users/folder.yml", { ...folder, request: { auth: jwt } });
		expect(readYaml(mem.files.get("c/users/folder.yml")).request).toEqual({});
		const context = await store.loadContext("c", "c/users/get.yml");
		expect(context.chain[1]?.auth).toEqual(jwt);
	});

	it("follows renames and duplicates", async () => {
		const { mem, store } = setup();
		const request = await store.loadRequest("c/users/get.yml");
		await store.saveRequest("c/users/get.yml", { ...request, http: { ...request.http, auth: jwt as never } });
		await store.followSidecar({ root: "c", path: "c/users" }, { root: "c", path: "c/people" });
		let sidecar = json(mem.files.get("c/.carbonwire/collection.json"));
		expect(Object.keys(sidecar.items!)).toEqual(["people/get.yml"]);
		await store.followSidecar({ root: "c", path: "c/people/get.yml" }, { root: "c", path: "c/people/get copy.yml" }, true);
		sidecar = json(mem.files.get("c/.carbonwire/collection.json"));
		expect(Object.keys(sidecar.items!).sort()).toEqual(["people/get copy.yml", "people/get.yml"]);
		await store.forgetSidecar({ root: "c", path: "c/people" });
		sidecar = json(mem.files.get("c/.carbonwire/collection.json"));
		expect(sidecar.items).toBeUndefined();
	});

	it("writes no sidecar for collections that don't need one", async () => {
		const { mem, store } = setup();
		await store.saveRequest("c/users/get.yml", await store.loadRequest("c/users/get.yml"));
		expect(mem.files.has("c/.carbonwire/collection.json")).toBe(false);
	});
});

describe("JSONPath", () => {
	const store = {
		store: {
			book: [
				{ category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
				{ category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
				{ category: "fiction", author: "Herman Melville", title: "Moby Dick", isbn: "0-553-21311-3", price: 8.99 },
				{ category: "fiction", author: "J. R. R. Tolkien", title: "The Lord of the Rings", isbn: "0-395-19395-8", price: 22.99 },
			],
			bicycle: { color: "red", price: 399 },
		},
	};

	it("selects as RFC 9535's examples do", () => {
		expect(queryJson(store, "$.store.book[*].author")).toEqual(["Nigel Rees", "Evelyn Waugh", "Herman Melville", "J. R. R. Tolkien"]);
		expect(queryJson(store, "$..author")).toHaveLength(4);
		expect(queryJson(store, "$..book[2].title")).toEqual(["Moby Dick"]);
		expect(queryJson(store, "$..book[-1].title")).toEqual(["The Lord of the Rings"]);
		expect(queryJson(store, "$..book[0,1].title")).toEqual(["Sayings of the Century", "Sword of Honour"]);
		expect(queryJson(store, "$..book[:2].title")).toEqual(["Sayings of the Century", "Sword of Honour"]);
		expect(queryJson(store, "$..book[?@.isbn].title")).toEqual(["Moby Dick", "The Lord of the Rings"]);
		expect(queryJson(store, "$..book[?@.price<10].title")).toEqual(["Sayings of the Century", "Moby Dick"]);
		expect(queryJson(store, "$..book[?@.price<10 && @.category=='fiction'].title")).toEqual(["Moby Dick"]);
		expect(queryJson(store, "$..book[?!(@.price<10)].title")).toEqual(["Sword of Honour", "The Lord of the Rings"]);
		expect(queryJson(store, "$.store['bicycle'].color")).toEqual(["red"]);
		expect(queryJson([0, 1, 2, 3, 4, 5], "$[5:0:-2]")).toEqual([5, 3, 1]);
		expect(() => queryJson(store, "store")).toThrow(/starts with \$/);
	});
});

describe("cookies", () => {
	it("stores and sends cookies as RFC 6265 says", () => {
		const jar = new CookieJar();
		const url = new URL("https://api.example.com/v1/login");
		jar.store(url, ["sid=abc; Path=/; HttpOnly", "pref=dark; Domain=example.com; Path=/", "tmp=1; Max-Age=0", "other=1; Domain=evil.com", "deep=1"]);
		expect(jar.header(new URL("https://api.example.com/v1/users"))).toBe("deep=1; sid=abc; pref=dark");
		expect(jar.header(new URL("https://www.example.com/"))).toBe("pref=dark");
		expect(jar.header(new URL("https://example.org/"))).toBeUndefined();
		jar.store(url, ["sid=; Max-Age=0; Path=/"]);
		expect(jar.header(new URL("https://api.example.com/"))).toBe("pref=dark");
		expect(parseSetCookie("s=1; Secure", new URL("http://x.test/"))?.secure).toBe(true);
		jar.store(new URL("http://x.test/"), ["s=1; Secure"]);
		expect(jar.header(new URL("https://x.test/"))).toBeUndefined();
	});
});

describe("snippets", () => {
	const request: HttpRequest = {
		http: {
			method: "POST",
			url: "https://api.example.com/users?x=1",
			headers: [{ name: "X-Key", value: 'a"b' }],
			body: { type: "json", data: '{"name":"Ada"}' },
		},
	};
	const resolved = buildRequest(request, [], new Map());
	const options = { filePath: (p: string) => p };

	it("writes each language", () => {
		expect(snippet("http", resolved, options)).toBe('POST /users?x=1 HTTP/1.1\nHost: api.example.com\nX-Key: a"b\nContent-Type: application/json\n\n{"name":"Ada"}\n');
		expect(snippet("fetch", resolved, options)).toContain('const response = await fetch("https://api.example.com/users?x=1", {\n  method: "POST",\n  headers: {\n    "X-Key": "a\\"b",');
		expect(snippet("python", resolved, options)).toContain('response = requests.request("POST", url, headers=headers, data=data.encode())');
		expect(snippet("go", resolved, options)).toContain('req, err := http.NewRequest("POST", "https://api.example.com/users?x=1", body)');
		expect(snippet("curl", resolved, options)).toContain("curl --request POST");
	});
});

describe("export", () => {
	const collected: Collected = {
		name: "Shop",
		root: "c",
		defaults: { auth: { type: "bearer", token: "{{token}}" } },
		sidecar: { version: 1, collection: { postmanId: "col-1" }, items: { "users/get.yml": { postmanId: "req-1" } } },
		items: [
			{
				kind: "folder",
				name: "users",
				dir: "c/users",
				defaults: { auth: "inherit" },
				items: [
					{
						kind: "request",
						name: "get",
						path: "c/users/get.yml",
						request: {
							http: { method: "GET", url: "{{base}}/users/:id?q=1", params: [{ name: "id", value: "7", type: "path" }, { name: "q", value: "1", type: "query" }], auth: "inherit" },
							examples: [{ name: "OK", response: { status: 200, statusText: "OK", body: { type: "json", data: "{}" } } }],
						},
					},
				],
			},
		],
	};

	it("writes Postman v2.1", () => {
		const json = postmanCollection(collected) as { info: Record<string, unknown>; auth: unknown; item: { item: Record<string, unknown>[] }[] };
		expect(json.info._postman_id).toBe("col-1");
		expect(json.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
		const get = json.item[0]!.item[0]!;
		expect(get.id).toBe("req-1");
		expect((get.request as { url: unknown }).url).toEqual({
			raw: "{{base}}/users/:id?q=1",
			host: ["{{base}}"],
			path: ["users", ":id"],
			query: [{ key: "q", value: "1" }],
			variable: [{ key: "id", value: "7" }],
		});
		expect((get.request as { auth?: unknown }).auth).toBeUndefined();
		expect((get.response as unknown[]).length).toBe(1);
	});

	it("writes Postman v3, a cURL script and HAR", () => {
		const files = postmanV3(collected);
		expect(files.map((f) => f.path)).toEqual([
			"collections/Shop/.resources/definition.yaml",
			"collections/Shop/users/.resources/definition.yaml",
			"collections/Shop/users/.resources/get.resources/examples/1 OK.example.yaml",
			"collections/Shop/users/get.request.yaml",
		]);
		expect(curlScript(collected)).toContain("# users / get\ncurl '{{base}}/users/7?q=1'");
		const log = (har(collected, "1.0.0") as { log: { entries: { response: { status: number } }[] } }).log;
		expect(log.entries[0]!.response.status).toBe(200);
	});

	it("zips files readably", () => {
		const data = new TextEncoder().encode("hello hello hello hello");
		const archive = zip([{ name: "a/b.txt", data }]);
		const view = new DataView(archive.buffer);
		expect(view.getUint32(0, true)).toBe(0x04034b50);
		const nameLength = view.getUint16(26, true);
		const size = view.getUint32(18, true);
		const body = archive.subarray(30 + nameLength, 30 + nameLength + size);
		expect(new TextDecoder().decode(view.getUint16(8, true) === 8 ? inflateRawSync(body) : body)).toBe("hello hello hello hello");
	});
});

describe("importing auth OpenCollection can't hold", () => {
	it("writes Postman's Hawk auth to the sidecar and OAuth 1.0 to the file", async () => {
		const mem = new MemoryFiles();
		const store = new CollectionStore(mem, (p) => (p.startsWith("API/Shop/") || p === "API/Shop" ? "API/Shop" : undefined));
		const postman = {
			info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
			item: [
				{ name: "Hawk", request: { method: "GET", url: "https://x/h", auth: { type: "hawk", hawk: [{ key: "authId", value: "id" }, { key: "includePayloadHash", value: true, type: "boolean" }] } } },
				{ name: "OAuth1", request: { method: "GET", url: "https://x/o", auth: { type: "oauth1", oauth1: [{ key: "consumerKey", value: "ck" }, { key: "addParamsToHeader", value: false }] } } },
			],
		};
		const result = importText(JSON.stringify(postman));
		expect(result.warnings).toEqual([]);
		await writeImport(store, result, { kind: "new", dir: "API" }, { environmentsDir: "API/Environments", setSecret: () => undefined });
		expect(readYaml(mem.files.get("API/Shop/Hawk.yml")).http.auth).toBeUndefined();
		expect(json(mem.files.get("API/Shop/.carbonwire/collection.json")).items!["Hawk.yml"]!.auth).toEqual({
			type: "hawk",
			hawk: [
				{ key: "authId", value: "id", type: "string" },
				{ key: "includePayloadHash", value: true, type: "boolean" },
			],
		});
		expect(readYaml(mem.files.get("API/Shop/OAuth1.yml")).http.auth).toMatchObject({ type: "oauth1", consumerKey: "ck", placement: "query" });
	});
});
