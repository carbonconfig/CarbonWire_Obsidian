import { describe, expect, it } from "vitest";
import { zip } from "../src/core/export/zip";
import { importText } from "../src/core/import/detect";
import { ImportError, type ImportedFolder, type ImportedRequest } from "../src/core/import/model";
import { importPostmanExport, isAccountExport, selectFromExport } from "../src/core/import/postman-export";
import { unzip } from "../src/core/import/unzip";

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

const shop = { info: { name: "Shop", schema: SCHEMA }, item: [{ name: "List", request: { method: "GET", url: "https://shop.test/items" } }] };
const users = { info: { name: "Users", schema: SCHEMA }, item: [{ name: "Me", request: { method: "GET", url: "https://users.test/me" } }] };
const dev = { name: "Dev", _postman_variable_scope: "environment", values: [{ key: "host", value: "dev.test", enabled: true }] };
const globals = { name: "My Workspace Globals", _postman_variable_scope: "globals", values: [{ key: "tenant", value: "acme", enabled: true }] };

describe("unzip", () => {
	it("reads back what the zip writer wrote, stored and deflated", () => {
		const big = "x".repeat(10_000);
		const files = unzip(zip([{ name: "a/small.json", data: encode("{}") }, { name: "a/big.json", data: encode(big) }, { name: "a/skip.txt", data: encode("no") }]), (name) => name.endsWith(".json"));
		expect(files.map((f) => f.name)).toEqual(["a/small.json", "a/big.json"]);
		expect(new TextDecoder().decode(files[1]!.data)).toBe(big);
	});

	it("refuses what isn't a zip", () => {
		expect(() => unzip(encode("not a zip at all, just some text that is long enough"))).toThrow(ImportError);
	});
});

describe("Postman data export", () => {
	it("imports every collection and environment, with globals as CarbonWire's globals", () => {
		const files = [
			{ path: "export/archive.json", text: JSON.stringify({ collection: { a: true, b: true }, environment: { c: true } }) },
			{ path: "export/collection/a.json", text: JSON.stringify(shop) },
			{ path: "export/collection/b.json", text: JSON.stringify(users) },
			{ path: "export/environment/c.json", text: JSON.stringify(dev) },
			{ path: "export/globals.json", text: JSON.stringify(globals) },
			{ path: "export/broken.json", text: "{" },
		];
		const result = importPostmanExport(files);
		expect(result.format).toBe("Postman data export");
		expect(result.collections.map((c) => c.name)).toEqual(["Shop", "Users"]);
		expect(result.environments.map((e) => e.name)).toEqual(["Dev", "globals"]);
		expect(result.warnings).toEqual(["export/broken.json isn't valid JSON, so it was skipped."]);
	});

	it("says so when nothing in it is from Postman", () => {
		expect(() => importPostmanExport([{ path: "x/archive.json", text: "{}" }, { path: "x/other.json", text: "[1]" }])).toThrow("No Postman collections or environments");
	});

	it("reads an older dump file, converting v1 collections", () => {
		const v1 = {
			id: "c1",
			name: "Legacy",
			order: ["r3"],
			folders_order: ["f1"],
			folders: [
				{ id: "f1", name: "Accounts", order: ["r1"], folders_order: ["f2"] },
				{ id: "f2", name: "Admin", order: ["r2"] },
			],
			requests: [
				{ id: "r1", name: "Create", method: "POST", url: "https://legacy.test/accounts", headers: "Content-Type: application/json\n// X-Debug: 1\n", dataMode: "raw", rawModeData: '{"name":"a"}' },
				{ id: "r2", name: "Purge", method: "DELETE", url: "https://legacy.test/admin", headerData: [{ key: "X-Admin", value: "yes", enabled: true }] },
				{ id: "r3", name: "Login", method: "POST", url: "https://legacy.test/login", dataMode: "urlencoded", data: [{ key: "user", value: "u", enabled: true }] },
				{ id: "r4", name: "Orphan", method: "GET", url: "https://legacy.test/orphan" },
			],
		};
		const result = importText(JSON.stringify({ version: 1, collections: [v1, shop], environments: [dev], globals: [{ key: "tenant", value: "acme", enabled: true }] }));
		expect(result.format).toBe("Postman data dump");
		expect(result.collections.map((c) => c.name)).toEqual(["Legacy", "Shop"]);
		expect(result.environments.map((e) => e.name)).toEqual(["Dev", "globals"]);

		const items = result.collections[0]!.items;
		expect(items.map((i) => i.name)).toEqual(["Accounts", "Login", "Orphan"]);
		const accounts = items[0] as ImportedFolder;
		expect(accounts.items.map((i) => i.name)).toEqual(["Admin", "Create"]);
		const create = (accounts.items[1] as ImportedRequest).request.http!;
		expect(create.method).toBe("POST");
		expect(create.headers).toEqual([{ name: "Content-Type", value: "application/json" }, { name: "X-Debug", value: "1", disabled: true }]);
		expect(create.body).toMatchObject({ type: "json", data: '{"name":"a"}' });
		const purge = ((accounts.items[0] as ImportedFolder).items[0] as ImportedRequest).request.http!;
		expect(purge.headers).toEqual([{ name: "X-Admin", value: "yes" }]);
		const login = (items[1] as ImportedRequest).request.http!;
		expect(login.body).toMatchObject({ type: "form-urlencoded", data: [{ name: "user", value: "u" }] });
	});
});

describe("choosing from a Postman data export", () => {
	const file = (path: string, data: unknown) => ({ path, text: JSON.stringify(data) });
	const noisy = { ...users, item: [{ name: "Me", request: { method: "GET", url: "https://users.test/me" } }], event: [{ listen: "test", script: { exec: ["pm.test('x', () => {})"] } }] };

	it("keeps only what was chosen, and the notes about it", () => {
		const result = importPostmanExport([file("collection/shop.json", shop), file("collection/users.json", noisy), file("environment/dev.json", dev), file("environment/globals.json", globals)]);
		expect(isAccountExport(result)).toBe(true);
		const usersAt = result.collections.findIndex((c) => c.name === "Users");
		const shopAt = result.collections.findIndex((c) => c.name === "Shop");
		const usersNotes = result.warnings.filter((w) => w.startsWith("Users: "));
		expect(usersNotes.length).toBeGreaterThan(0);
		const picked = selectFromExport(result, new Set([shopAt]), new Set([0]));
		expect(picked.collections.map((c) => c.name)).toEqual(["Shop"]);
		expect(picked.environments.map((e) => e.name)).toEqual([result.environments[0]!.name]);
		expect(picked.warnings.some((w) => w.startsWith("Users: "))).toBe(false);
		expect(selectFromExport(result, new Set([usersAt]), new Set()).warnings).toEqual(usersNotes);
	});

	it("doesn't ask about a single collection", () => {
		expect(isAccountExport(importPostmanExport([file("collection/shop.json", shop)]))).toBe(false);
	});
});
