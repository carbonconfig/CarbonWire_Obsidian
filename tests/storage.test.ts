import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CollectionStore } from "../src/core/storage/store";
import { buildCollections, extractMeta, filterCollections } from "../src/core/storage/tree";
import { MemoryFiles } from "./memory-files";

describe("buildCollections", () => {
	it("builds sorted trees from paths, separating environments and folder configs", () => {
		const [api, nested, ...rest] = buildCollections([
			"notes/readme.md",
			"apis/Shop/opencollection.yml",
			"apis/Shop/environments/prod.yml",
			"apis/Shop/environments/dev.yml",
			"apis/Shop/users/folder.yml",
			"apis/Shop/users/get user 10.yml",
			"apis/Shop/users/get user 2.yml",
			"apis/Shop/users/admin/delete.yaml",
			"apis/Shop/health.yml",
			"apis/Shop/Inner/opencollection.yml",
			"apis/Shop/Inner/ping.yml",
			"elsewhere/stray.yml",
		]);
		expect(rest).toEqual([]);
		expect(api!.name).toBe("Inner");
		expect(api!.children).toEqual([{ kind: "request", path: "apis/Shop/Inner/ping.yml", name: "ping" }]);

		expect(nested!.name).toBe("Shop");
		expect(nested!.environments).toEqual(["apis/Shop/environments/dev.yml", "apis/Shop/environments/prod.yml"]);
		const [users, health] = nested!.children;
		expect(health).toEqual({ kind: "request", path: "apis/Shop/health.yml", name: "health" });
		expect(users).toMatchObject({ kind: "folder", name: "users", hasConfig: true });
		if (users?.kind !== "folder") throw new Error("expected folder");
		expect(users.children.map((c) => c.name)).toEqual(["admin", "get user 2", "get user 10"]);
	});

	it("supports a collection at the vault root", () => {
		const [root] = buildCollections(["opencollection.yml", "a.yml"], "My Vault");
		expect(root).toMatchObject({ root: "", name: "My Vault", children: [{ path: "a.yml" }] });
	});
});

describe("request metadata", () => {
	it("extracts method and seq cheaply", () => {
		expect(extractMeta("info:\n  name: x\n  seq: 3\nhttp:\n  method: post\n  url: u\n")).toEqual({ method: "POST", seq: 3 });
		expect(extractMeta("info:\n  name: Users\n  type: folder\n")).toEqual({});
		expect(extractMeta("name: Dev\ncolor: '#A7C7E7'\nvariables: []\n")).toEqual({ color: "#A7C7E7" });
	});

	it("orders by seq, then folders first, then name, and shows methods", () => {
		const meta = new Map([
			["c/b.yml", { method: "POST", seq: 1 }],
			["c/f/folder.yml", { seq: 2 }],
			["c/a.yml", { method: "GET", seq: 3 }],
		]);
		const [c] = buildCollections(["c/opencollection.yml", "c/a.yml", "c/b.yml", "c/z.yml", "c/f/folder.yml", "c/f/x.yml", "c/g/y.yml"], "V", meta);
		expect(c!.children.map((n) => n.name)).toEqual(["b", "f", "a", "g", "z"]);
		expect(c!.children[0]).toMatchObject({ kind: "request", method: "POST" });
	});

	it("filters requests by name or method, keeping their folders", () => {
		const meta = new Map([["c/f/list.yml", { method: "GET" }], ["c/f/create.yml", { method: "POST" }], ["c/other.yml", { method: "GET" }]]);
		const collections = buildCollections(["c/opencollection.yml", "c/f/list.yml", "c/f/create.yml", "c/other.yml"], "V", meta);
		const [c] = filterCollections(collections, "post");
		expect(c!.children).toEqual([expect.objectContaining({ name: "f", children: [expect.objectContaining({ name: "create" })] })]);
		expect(filterCollections(collections, "get oth")[0]!.children.map((n) => n.name)).toEqual(["other"]);
		expect(filterCollections(collections, "nothing")).toEqual([]);
		expect(filterCollections(collections, "")).toHaveLength(1);
	});
});

describe("CollectionStore", () => {
	const files = () =>
		new MemoryFiles({
			"api/opencollection.yml": "opencollection: 1.0.0\ninfo:\n  name: API\nrequest:\n  auth:\n    type: bearer\n    token: t\n",
			"api/users/folder.yml": "info:\n  name: users\nrequest:\n  auth: inherit\n  variables:\n    - name: v\n      value: folder\n",
			"api/users/admin/get.yml": "info:\n  name: get\nhttp:\n  method: GET\n  url: https://x\n  auth: inherit\n",
			"api/environments/dev.yml": "variables:\n  - name: host\n    value: dev\n",
		});

	it("loads the defaults chain, marking folders without folder.yml as undefined", async () => {
		const store = new CollectionStore(files());
		const ctx = await store.loadContext("api", "api/users/admin/get.yml");
		expect(ctx.chain).toEqual([
			{ auth: { type: "bearer", token: "t" } },
			{ auth: "inherit", variables: [{ name: "v", value: "folder" }] },
			undefined,
		]);
		expect(await store.loadEnvironment("api/environments/dev.yml")).toEqual({ name: "dev", variables: [{ name: "host", value: "dev" }] });
	});

	it("returns copies so edits don't leak into the cache until saved", async () => {
		const mem = files();
		const store = new CollectionStore(mem);
		const req = await store.loadRequest("api/users/admin/get.yml");
		req.http!.url = "https://changed";
		expect((await store.loadRequest("api/users/admin/get.yml")).http?.url).toBe("https://x");

		await store.saveRequest("api/users/admin/get.yml", req);
		expect((await store.loadRequest("api/users/admin/get.yml")).http?.url).toBe("https://changed");
		expect(parse(mem.files.get("api/users/admin/get.yml")!)).toMatchObject({ http: { url: "https://changed" } });
	});

	it("rereads a file after invalidation", async () => {
		const mem = files();
		const store = new CollectionStore(mem);
		await store.loadRequest("api/users/admin/get.yml");
		mem.files.set("api/users/admin/get.yml", "http:\n  url: https://external-edit\n");
		store.invalidate("api/users/admin/get.yml");
		expect((await store.loadRequest("api/users/admin/get.yml")).http?.url).toBe("https://external-edit");
	});

	it("creates collections, requests with unique names, and environments", async () => {
		const mem = new MemoryFiles();
		const store = new CollectionStore(mem);
		const root = await store.createCollection("apis", "Pet: Store");
		expect(root).toBe("apis/Pet- Store");
		expect(parse(mem.files.get("apis/Pet- Store/opencollection.yml")!)).toEqual({ opencollection: "1.0.0", info: { name: "Pet: Store" } });

		expect(await store.createRequest(root, "List pets")).toBe("apis/Pet- Store/List pets.yml");
		expect(await store.createRequest(root, "List pets")).toBe("apis/Pet- Store/List pets 2.yml");
		expect(parse(mem.files.get("apis/Pet- Store/List pets.yml")!)).toMatchObject({ http: { method: "GET", auth: "inherit" } });

		expect(await store.createEnvironmentIn("apis/Environments", "dev")).toBe("apis/Environments/dev.yml");
		const copy = await store.createEnvironmentIn("apis/Environments", "dev", { name: "dev", variables: [{ name: "a", value: "1" }] });
		expect(copy).toBe("apis/Environments/dev 2.yml");
		expect(parse(mem.files.get(copy)!)).toEqual({ name: "dev 2", variables: [{ name: "a", value: "1" }] });
	});
});

describe("CollectionStore folders", () => {
	it("creates folders and missing folder configs that inherit auth", async () => {
		const mem = new MemoryFiles({ "api/opencollection.yml": "info:\n  name: API\n", "api/existing/folder.yml": "info:\n  name: kept\n" });
		const store = new CollectionStore(mem);
		expect(await store.createFolder("api", "Users")).toBe("api/Users");
		expect(parse(mem.files.get("api/Users/folder.yml")!)).toEqual({ info: { name: "Users", type: "folder" }, request: { auth: "inherit" } });

		await store.ensureFolderConfig("api/plain");
		expect(parse(mem.files.get("api/plain/folder.yml")!)).toMatchObject({ request: { auth: "inherit" } });
		await store.ensureFolderConfig("api/existing");
		expect(parse(mem.files.get("api/existing/folder.yml")!)).toEqual({ info: { name: "kept" } });
	});
});
