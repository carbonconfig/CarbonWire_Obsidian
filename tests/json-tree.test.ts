import { describe, expect, it } from "vitest";
import { childPath, flattenJson } from "../src/ui/json-tree";

describe("JSON tree", () => {
	const data = { users: [{ name: "Ann", "first-name": "A" }], ok: true, none: null };

	it("builds JSONPath for keys and indexes", () => {
		expect(childPath("$", "users")).toBe("$.users");
		expect(childPath("$.users", 0)).toBe("$.users[0]");
		expect(childPath("$.users[0]", "first-name")).toBe('$.users[0]["first-name"]');
	});

	it("shows only rows under expanded paths, with sizes and previews", () => {
		const collapsed = flattenJson(data, new Set(["$"]));
		expect(collapsed.map((r) => [r.path, r.depth, r.size ?? r.preview])).toEqual([
			["$", 0, 3],
			["$.users", 1, 1],
			["$.ok", 1, "true"],
			["$.none", 1, "null"],
		]);
		const open = flattenJson(data, new Set(["$", "$.users", "$.users[0]"]));
		expect(open.map((r) => r.key)).toEqual([undefined, "users", 0, "name", "first-name", "ok", "none"]);
		expect(open.find((r) => r.key === "name")?.preview).toBe('"Ann"');
	});

	it("truncates long string previews", () => {
		const [row] = flattenJson("x".repeat(5000), new Set());
		expect(row!.preview!.length).toBeLessThan(1100);
	});
});
