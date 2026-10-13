import { test } from "vitest";
import { importText } from "../../src/core/import/detect";
import type { HttpRequest } from "../../src/core/model";
import { buildRequest } from "../../src/core/request-builder";
import { sortCollections } from "../../src/core/storage/order";
import { buildCollections, extractMeta, filterCollections } from "../../src/core/storage/tree";
import { prettyJson } from "../../src/ui/json-format";
import { flattenJson } from "../../src/ui/json-tree";
import { measure, report } from "./measure";

const REQUESTS = 5000;
const paths = ["API/opencollection.yml"];
for (let i = 0; i < REQUESTS; i++) paths.push(`API/Folder ${i % 250}/Get user ${i}.yml`);
const tree = buildCollections(paths);
const files = Array.from({ length: REQUESTS }, (_, i) => `info:\n  name: Get user ${i}\n  seq: ${i}\nhttp:\n  method: get\n  url: "{{base}}/users/${i}"\n`);

const json = JSON.stringify(Array.from({ length: 25_000 }, (_, i) => ({ id: i, name: `User ${i}`, email: `user${i}@example.com`, roles: ["reader", "writer"], active: i % 2 === 0 })));
const parsed = JSON.parse(json) as unknown[];

const postman = JSON.stringify({
	info: { name: "Big API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
	item: Array.from({ length: 50 }, (_, f) => ({
		name: `Folder ${f}`,
		item: Array.from({ length: 20 }, (_, r) => ({
			name: `Request ${f}-${r}`,
			request: { method: "POST", url: { raw: "{{base}}/items/:id?page=1", variable: [{ key: "id", value: "1" }] }, header: [{ key: "Accept", value: "application/json" }], body: { mode: "raw", raw: '{"a":1}' } },
		})),
	})),
});

const request: HttpRequest = {
	http: {
		method: "POST",
		url: "{{base}}/users/:id",
		params: [{ name: "id", value: "{{userId}}", type: "path" }, { name: "page", value: "2", type: "query" }],
		headers: [{ name: "Accept", value: "application/json" }],
		body: { type: "json", data: '{"name":"{{name}}"}' },
		auth: { type: "bearer", token: "{{token}}" },
	},
};
const scope = new Map([["base", "https://api.example.com"], ["userId", "42"], ["name", "Ann"], ["token", "t0k"]]);

test("benchmarks", async () => {
	report(`Sidebar, ${REQUESTS.toLocaleString("en")} requests in 250 folders`, [
		await measure("Build the tree from vault paths", () => buildCollections(paths)),
		await measure("Sort by name", () => sortCollections(tree, "name-asc", () => undefined)),
		await measure("Filter as you type", () => filterCollections(tree, "user 49")),
		await measure("Read method and order from every file", () => {
			for (const text of files) extractMeta(text);
		}),
	]);
	report("Requests and responses", [
		await measure("Resolve a request (variables, params, auth)", () => buildRequest(request, [], scope)),
		await measure(`Pretty-print a ${(json.length / 1e6).toFixed(1)} MB JSON response`, () => prettyJson(json)),
		await measure("List JSON tree rows for 25,000 objects", () => flattenJson(parsed, new Set(["$"]))),
	]);
	report("Import", [await measure("Postman collection with 1,000 requests", () => importText(postman, "big.json"))]);
}, 60_000);
