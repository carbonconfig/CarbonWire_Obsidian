import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { importBrunoFolder, parseBru } from "../src/core/import/bruno";
import { importCurl, tokenize } from "../src/core/import/curl";
import { importText } from "../src/core/import/detect";
import { ImportError, type ImportedFolder, type ImportedRequest, type ImportResult } from "../src/core/import/model";
import { writeImport } from "../src/core/import/writer";
import { CollectionStore } from "../src/core/storage/store";
import { MemoryFiles } from "./memory-files";

const first = (r: ImportResult) => r.collections[0]!;
const request = (items: unknown[], i = 0) => (items[i] as ImportedRequest).request;
const folder = (items: unknown[], i = 0) => items[i] as ImportedFolder;

describe("Postman", () => {
	const collection = {
		info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
		auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
		variable: [{ key: "baseUrl", value: "https://api.shop.test" }],
		item: [
			{
				name: "Users",
				item: [
					{
						name: "Get user",
						event: [{ listen: "test", script: { exec: ["pm.test('ok', () => {});"] } }],
						request: {
							method: "GET",
							url: {
								raw: "{{baseUrl}}/users/:id?expand=true&debug=1",
								host: ["{{baseUrl}}"],
								path: ["users", ":id"],
								query: [{ key: "expand", value: "true" }, { key: "debug", value: "1", disabled: true }],
								variable: [{ key: "id", value: "42" }],
							},
						},
						response: [{ name: "OK", code: 200, status: "OK", header: [{ key: "Content-Type", value: "application/json" }], body: '{"id":42}', _postman_previewlanguage: "json" }],
					},
				],
			},
			{
				name: "Login",
				request: {
					method: "POST",
					auth: { type: "noauth" },
					header: [{ key: "X-Trace", value: "1", disabled: true }],
					url: "{{baseUrl}}/login",
					body: { mode: "urlencoded", urlencoded: [{ key: "user", value: "a" }] },
				},
			},
			{
				name: "Create",
				request: { method: "POST", auth: { type: "apikey", apikey: { key: "X-Key", value: "k", in: "header" } }, url: "{{baseUrl}}/items", body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } } },
			},
		],
	};

	it("converts folders, inherited and explicit auth, params, bodies, scripts and examples", () => {
		const result = importText(JSON.stringify(collection), "shop.json");
		expect(result.format).toBe("Postman collection v2.1");
		const c = first(result);
		expect(c.defaults).toEqual({ auth: { type: "bearer", token: "{{token}}" }, variables: [{ name: "baseUrl", value: "https://api.shop.test" }] });

		const users = folder(c.items);
		expect(users.defaults).toEqual({ auth: "inherit" });
		const get = request(users.items);
		expect(get.http).toEqual({
			method: "GET",
			url: "{{baseUrl}}/users/:id?expand=true",
			params: [
				{ name: "id", value: "42", type: "path" },
				{ name: "expand", value: "true", type: "query" },
				{ name: "debug", value: "1", type: "query", disabled: true },
			],
			auth: "inherit",
		});
		expect(get.runtime?.scripts).toEqual([{ type: "tests", code: "pm.test('ok', () => {});" }]);
		expect(get.examples?.[0]).toMatchObject({ name: "OK", response: { status: 200, statusText: "OK", body: { type: "json", data: '{"id":42}' } } });

		const login = request(c.items, 1);
		expect(login.http?.auth).toBeUndefined();
		expect(login.http?.headers).toEqual([{ name: "X-Trace", value: "1", disabled: true }]);
		expect(login.http?.body).toEqual({ type: "form-urlencoded", data: [{ name: "user", value: "a" }] });

		const create = request(c.items, 2);
		expect(create.http?.auth).toEqual({ type: "apikey", key: "X-Key", value: "k", placement: "header" });
		expect(create.http?.body).toEqual({ type: "json", data: '{"a":1}' });
		expect(result.warnings).toEqual(["Pre-request and test scripts are kept but not run yet."]);
	});

	it("imports environments with secrets", () => {
		const env = { name: "Prod", _postman_variable_scope: "environment", values: [{ key: "host", value: "x", enabled: true }, { key: "token", value: "s3", type: "secret", enabled: false }] };
		expect(importText(JSON.stringify(env)).environments).toEqual([{ name: "Prod", variables: [{ name: "host", value: "x", disabled: false, secret: false }, { name: "token", value: "s3", disabled: true, secret: true }] }]);
	});
});

describe("Insomnia", () => {
	it("imports v4 exports with nested environments, folder settings and Nunjucks variables", () => {
		const data = {
			_type: "export",
			__export_format: 4,
			resources: [
				{ _id: "wrk_1", _type: "workspace", name: "Flights" },
				{ _id: "env_base", _type: "environment", parentId: "wrk_1", name: "Base", data: { baseUrl: "https://air.test", api: { version: 2 } } },
				{ _id: "env_dev", _type: "environment", parentId: "env_base", name: "Dev", data: { baseUrl: "http://localhost" } },
				{ _id: "fld_1", _type: "request_group", parentId: "wrk_1", name: "Bookings", environment: { limit: 10 }, authentication: { type: "basic", username: "u", password: "p" }, metaSortKey: 2 },
				{ _id: "req_2", _type: "request", parentId: "wrk_1", name: "Health", method: "GET", url: "{{ _.baseUrl }}/health", authentication: {}, metaSortKey: 1 },
				{
					_id: "req_1", _type: "request", parentId: "fld_1", name: "List", method: "GET", url: "{{ _.baseUrl }}/v{{ _.api.version }}/bookings",
					parameters: [{ name: "limit", value: "{{ _.limit }}" }],
					headers: [{ name: "X-Request", value: "{% uuid 'v4' %}" }],
					authentication: { type: "bearer", token: "t", prefix: "Token" },
				},
				{ _id: "req_3", _type: "request", parentId: "fld_1", name: "Create", method: "POST", url: "{{ _.baseUrl }}/bookings", body: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "a", value: "1", disabled: true }] }, authentication: { type: "none" } },
			],
		};
		const result = importText(JSON.stringify(data));
		const c = first(result);
		expect(c.defaults.variables).toEqual([{ name: "baseUrl", value: "https://air.test" }, { name: "api.version", value: "2" }]);
		expect(c.environments).toEqual([{ name: "Dev", variables: [{ name: "baseUrl", value: "http://localhost" }] }]);
		expect(c.items.map((i) => i.name)).toEqual(["Health", "Bookings"]);
		expect(request(c.items).http).toEqual({ method: "GET", url: "{{baseUrl}}/health", auth: "inherit" });

		const bookings = folder(c.items, 1);
		expect(bookings.defaults).toEqual({ auth: { type: "basic", username: "u", password: "p" }, variables: [{ name: "limit", value: "10" }] });
		const list = request(bookings.items);
		expect(list.http?.url).toBe("{{baseUrl}}/v{{api.version}}/bookings?limit={{limit}}");
		expect(list.http?.auth).toEqual({ type: "apikey", key: "Authorization", value: "Token t", placement: "header" });
		expect(request(bookings.items, 1).http?.body).toEqual({ type: "form-urlencoded", data: [{ name: "a", value: "1", disabled: true }] });
		expect(request(bookings.items, 1).http?.auth).toBeUndefined();
		expect(result.warnings[0]).toMatch(/template tags/);
	});

	it("imports v5 YAML collections", () => {
		const yaml = `type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: Airline
collection:
  - name: Flights
    authentication:
      type: bearer
      token: "{{ _.token }}"
    children:
      - url: "{{ _.base }}/flights/:id"
        name: Get flight
        method: GET
        pathParameters:
          - name: id
            value: "7"
        scripts:
          preRequest: "insomnia.environment.set('a', 1)"
environments:
  name: Base Environment
  data:
    base: https://air.test
  subEnvironments:
    - name: Staging
      data:
        base: https://staging.air.test
`;
		const result = importText(yaml, "airline.yaml");
		expect(result.format).toBe("Insomnia v5 (YAML)");
		const c = first(result);
		expect(c.environments).toEqual([{ name: "Staging", variables: [{ name: "base", value: "https://staging.air.test" }] }]);
		const flights = folder(c.items);
		expect(flights.defaults.auth).toEqual({ type: "bearer", token: "{{token}}" });
		expect(request(flights.items).http).toMatchObject({ url: "{{base}}/flights/:id", params: [{ name: "id", value: "7", type: "path" }], auth: "inherit" });
		expect(request(flights.items).runtime?.scripts?.[0]?.type).toBe("before-request");
	});
});

describe("Hoppscotch", () => {
	it("converts <<variables>>, folders and auth", () => {
		const data = {
			v: 12,
			name: "Pets",
			folders: [{ v: 12, name: "Admin", folders: [], requests: [], auth: { authType: "inherit", authActive: true }, headers: [] }],
			requests: [
				{
					v: "17", name: "List", method: "GET", endpoint: "<<host>>/pets",
					params: [{ key: "limit", value: "5", active: true }, { key: "off", value: "1", active: false }],
					headers: [], body: { contentType: null, body: null },
					auth: { authType: "api-key", authActive: true, key: "key", value: "<<apiKey>>", addTo: "QUERY_PARAMS" },
					preRequestScript: "", testScript: "",
				},
				{
					v: "17", name: "Token", method: "POST", endpoint: "<<host>>/x", params: [], headers: [],
					body: { contentType: "application/x-www-form-urlencoded", body: "a: 1\n#b: 2" },
					auth: { authType: "oauth-2", authActive: true, grantTypeInfo: { grantType: "CLIENT_CREDENTIALS", authEndpoint: "https://auth.test/token", clientID: "id", clientSecret: "s", scopes: "read", clientAuthentication: "IN_BODY" }, addTo: "HEADERS" },
				},
			],
			auth: { authType: "bearer", authActive: true, token: "<<token>>" },
			headers: [{ key: "X-App", value: "pets", active: true }],
			variables: [{ key: "host", initialValue: "https://pets.test", currentValue: "", secret: false }],
		};
		const c = first(importText(JSON.stringify(data)));
		expect(c.defaults).toEqual({
			auth: { type: "bearer", token: "{{token}}" },
			headers: [{ name: "X-App", value: "pets" }],
			variables: [{ name: "host", value: "https://pets.test" }],
		});
		expect(folder(c.items).defaults).toEqual({ auth: "inherit" });
		expect(request(c.items, 1).http).toMatchObject({ url: "{{host}}/pets?limit=5", auth: { type: "apikey", value: "{{apiKey}}", placement: "query" } });
		const token = request(c.items, 2).http!;
		expect(token.body).toEqual({ type: "form-urlencoded", data: [{ name: "a", value: "1" }, { name: "b", value: "2", disabled: true }] });
		expect(token.auth).toEqual({ type: "oauth2", flow: "client_credentials", accessTokenUrl: "https://auth.test/token", credentials: { clientId: "id", clientSecret: "s", placement: "body" }, scope: "read", tokenConfig: { placement: { header: "Bearer" } } });
	});

	it("imports environments", () => {
		const envs = [{ name: "Local", variables: [{ key: "host", initialValue: "http://localhost", secret: false }, { key: "key", secret: true }] }];
		const result = importText(JSON.stringify(envs));
		expect(result.environments).toEqual([{ name: "Local", variables: [{ name: "host", value: "http://localhost", secret: false }, { name: "key", value: "", secret: true }] }]);
		expect(result.warnings).toHaveLength(1);
	});
});

describe("HTTPie", () => {
	it("imports a space with collections, drafts and environments", () => {
		const data = {
			meta: { format: "httpie", version: "1.0.0", contentType: "workspace" },
			entry: {
				name: "Space",
				collections: [{
					name: "API",
					auth: { type: "basic", credentials: { username: "u", password: "p" } },
					requests: [{
						name: "Search", method: "post", url: "{{base}}/search",
						headers: [{ name: "Accept", value: "application/json", enabled: true }],
						queryParams: [{ name: "q", value: "x", enabled: true }],
						pathParams: [],
						auth: { type: "inherited" },
						body: { type: "text", text: { format: "application/json", value: '{"q":1}' } },
					}],
				}],
				environments: [{ name: "Dev", isDefault: true, isLocalOnly: false, variables: [{ name: "base", value: "http://x", isSecret: false }, { name: "key", value: "k", isSecret: true }] }],
				drafts: [{ name: "Draft", method: "GET", url: "http://d", headers: [], queryParams: [], pathParams: [], auth: { type: "none" }, body: { type: "none" } }],
			},
		};
		const result = importText(JSON.stringify(data));
		expect(result.collections.map((c) => c.name)).toEqual(["API", "Space drafts"]);
		const api = first(result);
		expect(api.defaults.auth).toEqual({ type: "basic", username: "u", password: "p" });
		expect(request(api.items).http).toEqual({
			method: "POST",
			url: "{{base}}/search?q=x",
			params: [{ name: "q", value: "x", type: "query" }],
			headers: [{ name: "Accept", value: "application/json" }, { name: "Content-Type", value: "application/json" }],
			body: { type: "json", data: '{"q":1}' },
			auth: "inherit",
		});
		expect(api.environments[0]!.variables[1]).toEqual({ name: "key", value: "k", secret: true });
	});
});

describe("Bruno (.bru)", () => {
	it("parses dictionary, text and list blocks", () => {
		const bru = parseBru(`meta {
  name: Get user
  seq: 2
}

get {
  url: {{base}}/users/:id
  body: json
  auth: inherit
}

headers {
  "X-Odd: Name": 1
  ~X-Off: 2
}

body:json {
  {
    "a": 1
  }
}

vars:secret [
  token,
  key
]
`);
		expect(bru.dict.get("headers")).toEqual([{ name: "X-Odd: Name", value: "1", disabled: false }, { name: "X-Off", value: "2", disabled: true }]);
		expect(bru.text.get("body:json")).toBe('{\n  "a": 1\n}');
		expect(bru.list.get("vars:secret")).toEqual(["token", "key"]);
	});

	it("imports a collection folder with folder settings, ordering and environments", () => {
		const result = importBrunoFolder([
			{ path: "shop/bruno.json", text: '{"name":"Shop","version":"1","type":"collection"}' },
			{ path: "shop/collection.bru", text: "auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{token}}\n}\n" },
			{ path: "shop/users/folder.bru", text: "meta {\n  name: Users\n  seq: 1\n}\n\nauth {\n  mode: inherit\n}\n\nvars:pre-request {\n  limit: 5\n}\n" },
			{ path: "shop/users/b.bru", text: "meta {\n  name: Second\n  seq: 2\n}\n\npost {\n  url: {{base}}/users\n  body: formUrlEncoded\n  auth: none\n}\n\nbody:form-urlencoded {\n  name: x\n}\n" },
			{ path: "shop/users/a.bru", text: "meta {\n  name: First\n  seq: 1\n}\n\nget {\n  url: {{base}}/users?page=1\n  auth: inherit\n}\n\nparams:query {\n  page: 1\n  ~debug: true\n}\n\nscript:pre-request {\n  bru.setVar('a', 1)\n}\n" },
			{ path: "shop/environments/dev.bru", text: "vars {\n  base: http://localhost\n}\nvars:secret [\n  token\n]\n" },
		]);
		const c = first(result);
		expect(c.name).toBe("Shop");
		expect(c.defaults.auth).toEqual({ type: "bearer", token: "{{token}}" });
		expect(c.environments).toEqual([{ name: "dev", variables: [{ name: "base", value: "http://localhost" }, { name: "token", value: "", secret: true }] }]);
		const users = folder(c.items);
		expect(users).toMatchObject({ name: "Users", defaults: { auth: "inherit", variables: [{ name: "limit", value: "5" }] } });
		expect(users.items.map((i) => i.name)).toEqual(["First", "Second"]);
		expect(request(users.items).http).toEqual({
			method: "GET",
			url: "{{base}}/users?page=1",
			params: [{ name: "page", value: "1", type: "query" }, { name: "debug", value: "true", type: "query", disabled: true }],
			auth: "inherit",
		});
		expect(request(users.items, 1).http).toMatchObject({ method: "POST", body: { type: "form-urlencoded", data: [{ name: "name", value: "x" }] } });
		expect(request(users.items, 1).http?.auth).toBeUndefined();
	});

	it("requires bruno.json", () => {
		expect(() => importBrunoFolder([{ path: "x/a.bru", text: "" }])).toThrow(ImportError);
	});
});

describe("HAR", () => {
	it("imports entries with bodies and responses as examples", () => {
		const har = {
			log: {
				entries: [{
					request: {
						method: "POST", url: "https://api.test/items?draft=1",
						headers: [{ name: ":authority", value: "api.test" }, { name: "Host", value: "api.test" }, { name: "Content-Type", value: "application/json" }],
						postData: { mimeType: "application/json", text: '{"a":1}' },
					},
					response: { status: 201, statusText: "Created", headers: [{ name: "Content-Type", value: "application/json" }], content: { mimeType: "application/json", text: '{"id":1}' } },
				}],
			},
		};
		const c = first(importText(JSON.stringify(har)));
		expect(c.name).toBe("api.test");
		expect(c.items[0]!.name).toBe("POST /items");
		const req = request(c.items);
		expect(req.http).toEqual({
			method: "POST",
			url: "https://api.test/items?draft=1",
			params: [{ name: "draft", value: "1", type: "query" }],
			headers: [{ name: "Content-Type", value: "application/json" }],
			body: { type: "json", data: '{"a":1}' },
		});
		expect(req.examples?.[0]).toMatchObject({ response: { status: 201, body: { type: "json", data: '{"id":1}' } } });
	});
});

describe("cURL", () => {
	it("tokenizes quotes, $'…' strings and continuations", () => {
		expect(tokenize(`curl -H 'A: b c' "x\\"y" $'line\\nnext' \\\n  --url=u`)).toEqual(["curl", "-H", "A: b c", 'x"y', "line\nnext", "--url=u"]);
	});

	it("imports JSON posts with headers and basic auth", () => {
		const result = importCurl(`curl -X POST 'https://api.test/users?x=1' -H 'Content-Type: application/json' -u alice:pw --data-raw '{"name":"a"}' --compressed -sSL`);
		const req = request(first(result).items);
		expect(req.http).toEqual({
			method: "POST",
			url: "https://api.test/users?x=1",
			params: [{ name: "x", value: "1", type: "query" }],
			headers: [{ name: "Content-Type", value: "application/json" }],
			body: { type: "json", data: '{"name":"a"}' },
			auth: { type: "basic", username: "alice", password: "pw" },
		});
	});

	it("defaults -d to a POST form body, honours -G and clustered flags, and parses -F", () => {
		expect(request(first(importCurl("curl https://x.test -d a=1 -d b=2")).items).http).toMatchObject({ method: "POST", body: { type: "form-urlencoded", data: [{ name: "a", value: "1" }, { name: "b", value: "2" }] } });
		expect(request(first(importCurl("curl -G https://x.test/s -d q=1")).items).http).toMatchObject({ method: "GET", url: "https://x.test/s?q=1" });
		expect(request(first(importCurl("curl -XPUT -HX-A:1 x.test")).items).http).toMatchObject({ method: "PUT", url: "http://x.test", headers: [{ name: "X-A", value: "1" }] });
		const form = importCurl("curl https://x.test -F name=a -F 'file=@/tmp/a.png;type=image/png'");
		expect(request(first(form).items).http?.body).toEqual({
			type: "multipart-form",
			data: [{ name: "name", type: "text", value: "a" }, { name: "file", type: "file", value: "/tmp/a.png", contentType: "image/png" }],
		});
		expect(form.warnings).toHaveLength(1);
	});
});

describe(".http files", () => {
	it("imports variables, named requests, headers, bodies and skips handlers", () => {
		const text = `@base = https://api.test

### List users
GET {{base}}/users
    ?page=1
    &size=10
Accept: application/json

###
# @name create
POST {{base}}/users HTTP/1.1
Content-Type: application/json

{"name": "a"}

> {% client.global.set("id", response.body.id); %}

###
DELETE {{base}}/users/1
`;
		const result = importText(text, "users.http");
		const c = first(result);
		expect(c.name).toBe("users");
		expect(c.defaults.variables).toEqual([{ name: "base", value: "https://api.test" }]);
		expect(c.items.map((i) => i.name)).toEqual(["List users", "create", "DELETE /users/1"]);
		expect(request(c.items).http).toMatchObject({ url: "{{base}}/users?page=1&size=10", headers: [{ name: "Accept", value: "application/json" }] });
		expect(request(c.items, 1).http?.body).toEqual({ type: "json", data: '{"name": "a"}' });
		expect(result.warnings).toHaveLength(1);
	});
});

describe("environment files", () => {
	it("imports OpenCollection environments rather than mistaking them for Hoppscotch", () => {
		const result = importText("name: Dev Env\nvariables:\n  - name: host\n    value: http://x\n  - secret: true\n    name: token\n", "Dev Env.yml");
		expect(result.format).toBe("OpenCollection environment");
		expect(result.environments).toEqual([{ name: "Dev Env", variables: [{ name: "host", value: "http://x" }, { name: "token", value: "", secret: true }] }]);
	});

	it("imports a single Bruno .bru environment", () => {
		const result = importText("vars {\n  host: http://x\n}\nvars:secret [\n  token\n]\n", "Staging.bru");
		expect(result.environments).toEqual([{ name: "Staging", variables: [{ name: "host", value: "http://x" }, { name: "token", value: "", secret: true }] }]);
	});
});

describe("detection", () => {
	it("rejects unknown formats with a helpful error", () => {
		expect(() => importText('{"hello":1}')).toThrow(/Unrecognised format/);
		expect(() => importText("   ")).toThrow(ImportError);
	});
});

const ENV = { environmentsDir: "API/Environments" };

describe("writeImport", () => {
	const postman = {
		info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
		auth: { type: "bearer", bearer: [{ key: "token", value: "t" }] },
		item: [
			{ name: "Users", item: [{ name: "Get", request: { method: "GET", url: "https://x/u" } }, { name: "Get", request: { method: "GET", url: "https://x/u2" } }] },
			{ name: "Health", request: { method: "GET", url: "https://x/h" } },
		],
	};

	it("writes a new collection with folders, ordered requests and environments", async () => {
		const mem = new MemoryFiles();
		const store = new CollectionStore(mem);
		const secrets: string[] = [];
		const result = importText(JSON.stringify(postman));
		result.collections[0]!.environments.push({ name: "Prod", variables: [{ name: "host", value: "h" }, { name: "key", value: "k", secret: true }] });

		const summary = await writeImport(store, result, { kind: "new", dir: "API" }, { environmentsDir: "API/Environments", setSecret: (path, name, value) => secrets.push(`${path}|${name}|${value}`) });
		expect(summary).toEqual({ roots: ["API/Shop"], requests: 3, folders: 1, environments: ["Prod"] });
		expect(parse(mem.files.get("API/Shop/opencollection.yml")!)).toEqual({ opencollection: "1.0.0", info: { name: "Shop" }, request: { auth: { type: "bearer", token: "t" } } });
		expect(parse(mem.files.get("API/Shop/Users/folder.yml")!)).toEqual({ info: { name: "Users", type: "folder", seq: 1 }, request: { auth: "inherit" } });
		expect(parse(mem.files.get("API/Shop/Users/Get.yml")!)).toMatchObject({ info: { name: "Get", seq: 1 }, http: { url: "https://x/u", auth: "inherit" } });
		expect(parse(mem.files.get("API/Shop/Users/Get 2.yml")!)).toMatchObject({ info: { seq: 2 }, http: { url: "https://x/u2" } });
		expect(parse(mem.files.get("API/Shop/Health.yml")!)).toMatchObject({ info: { seq: 2 } });
		expect(parse(mem.files.get("API/Environments/Prod.yml")!)).toEqual({ name: "Prod", variables: [{ name: "host", value: "h" }, { secret: true, name: "key" }] });
		expect(secrets).toEqual(["API/Environments/Prod.yml|key|k"]);
	});

	it("adds into an existing collection: single requests directly, collections as a folder", async () => {
		const mem = new MemoryFiles({ "api/opencollection.yml": "info:\n  name: API\n" });
		const store = new CollectionStore(mem);
		await writeImport(store, importCurl("curl https://x.test/ping"), { kind: "existing", root: "api" }, ENV);
		expect(mem.files.has("api/GET -ping.yml")).toBe(true);

		await writeImport(store, importText(JSON.stringify(postman)), { kind: "existing", root: "api" }, ENV);
		expect(parse(mem.files.get("api/Shop/folder.yml")!)).toMatchObject({ request: { auth: { type: "bearer", token: "t" } } });
		expect(mem.files.has("api/Shop/Users/Get.yml")).toBe(true);
	});

	it("keeps environment-only files and collections apart", async () => {
		const store = new CollectionStore(new MemoryFiles());
		const env = importText(JSON.stringify({ name: "E", values: [], _postman_variable_scope: "environment" }));
		await expect(writeImport(store, env, { kind: "new", dir: "" }, ENV)).rejects.toThrow(/import it as environments/);
		await expect(writeImport(store, importCurl("curl x.test"), { kind: "environments" }, ENV)).rejects.toThrow(/import it as a collection/);
	});

	const devEnv = (vars: Record<string, string>) => importText(JSON.stringify({ name: "Dev", _postman_variable_scope: "environment", values: Object.entries(vars).map(([key, value]) => ({ key, value, enabled: true })) }));
	const existingDev = () => new MemoryFiles({ "API/Environments/Dev.yml": "name: Dev\nvariables:\n  - name: host\n    value: old\n  - name: keep\n    value: k\n" });
	const vars = (mem: MemoryFiles, path: string) => (parse(mem.files.get(path)!) as { variables: unknown[] }).variables;
	const target = { kind: "environments" as const };

	it("renames conflicting environments when asked, or numbers them by default", async () => {
		const mem = existingDev();
		const store = new CollectionStore(mem);
		const renamed = await writeImport(store, devEnv({ host: "new" }), target, { ...ENV, resolutions: new Map([["Dev", { action: "rename", name: "Dev copy" }]]) });
		expect(renamed.environments).toEqual(["Dev copy"]);
		expect(vars(mem, "API/Environments/Dev copy.yml")).toEqual([{ name: "host", value: "new" }]);
		expect((await writeImport(store, devEnv({}), target, ENV)).environments).toEqual(["Dev 2"]);
	});

	it("merges into an existing environment with either side winning", async () => {
		const imported = existingDev();
		await writeImport(new CollectionStore(imported), devEnv({ host: "new", extra: "e" }), target, { ...ENV, resolutions: new Map([["Dev", { action: "merge", prefer: "imported" }]]) });
		expect(vars(imported, "API/Environments/Dev.yml")).toEqual([{ name: "host", value: "new" }, { name: "keep", value: "k" }, { name: "extra", value: "e" }]);

		const kept = existingDev();
		await writeImport(new CollectionStore(kept), devEnv({ host: "new", extra: "e" }), target, { ...ENV, resolutions: new Map([["Dev", { action: "merge", prefer: "existing" }]]) });
		expect(vars(kept, "API/Environments/Dev.yml")).toEqual([{ name: "host", value: "old" }, { name: "keep", value: "k" }, { name: "extra", value: "e" }]);
	});
});
