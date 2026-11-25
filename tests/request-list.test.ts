import { describe, expect, it } from "vitest";
import { buildCollections, listRequests } from "../src/core/storage/tree";

describe("listRequests", () => {
	it("lists every request with its collection and folders, in tree order", () => {
		const collections = buildCollections(
			["api/Shop/opencollection.yml", "api/Shop/list.yml", "api/Shop/Orders/folder.yml", "api/Shop/Orders/create.yml", "api/Users/opencollection.yml", "api/Users/me.yml"],
			"Workspace",
			new Map(),
		);
		expect(listRequests(collections).map((r) => [r.name, r.collection, r.folders.join("/")])).toEqual([
			["create", "Shop", "Orders"],
			["list", "Shop", ""],
			["me", "Users", ""],
		]);
	});
});
