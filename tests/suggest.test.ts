import { describe, expect, it } from "vitest";
import { suggestHeaderNames, suggestHeaderValues, suggestVariables, variableQuery } from "../src/core/suggest";
import type { VariableInfo } from "../src/core/variables";

const vars: VariableInfo[] = [
	{ name: "baseUrl", value: "https://api.test", source: "environment" },
	{ name: "token", value: "••••••", source: "environment", secret: true },
	{ name: "userBase", value: "", source: "collection" },
];

describe("variableQuery", () => {
	it("finds the {{ being typed before the caret", () => {
		expect(variableQuery("{{", 2)).toEqual({ from: 0, to: 2, query: "" });
		expect(variableQuery("https://{{ba", 12)).toEqual({ from: 8, to: 12, query: "ba" });
		expect(variableQuery("a {{ ba", 7)).toEqual({ from: 2, to: 7, query: "ba" });
	});

	it("covers the rest of a reference that's already there, so it's replaced whole", () => {
		expect(variableQuery("{{ba}}/x", 4)).toEqual({ from: 0, to: 6, query: "ba" });
		expect(variableQuery("{{baseUrl}}", 4)).toEqual({ from: 0, to: 11, query: "ba" });
	});

	it("ignores a caret outside a reference", () => {
		expect(variableQuery("{{a}} x", 7)).toBeUndefined();
		expect(variableQuery("{ a", 3)).toBeUndefined();
		expect(variableQuery("{{a b", 5)).toBeUndefined();
		expect(variableQuery("x", 1)).toBeUndefined();
	});
});

describe("suggestVariables", () => {
	it("lists prefix matches first, with their values", () => {
		expect(suggestVariables("", vars, []).map((s) => s.label)).toEqual(["baseUrl", "token", "userBase"]);
		expect(suggestVariables("base", vars, [])).toEqual([
			{ label: "baseUrl", detail: "https://api.test", insert: "{{baseUrl}}" },
			{ label: "userBase", detail: "empty", insert: "{{userBase}}" },
		]);
		expect(suggestVariables("tok", vars, [])[0]?.detail).toBe("••••••");
	});

	it("lists dynamic values only once a $ is typed", () => {
		const dynamic = ["$guid", "$randomEmail", "$timestamp"];
		expect(suggestVariables("", vars, dynamic).some((s) => s.label.startsWith("$"))).toBe(false);
		expect(suggestVariables("$r", vars, dynamic).map((s) => s.label)).toEqual(["$randomEmail"]);
	});
});

describe("header suggestions", () => {
	it("suggests header names once something is typed, but not the one already complete", () => {
		expect(suggestHeaderNames("")).toEqual([]);
		expect(suggestHeaderNames("cont").map((s) => s.label)).toEqual(["Content-Type", "Cache-Control"]);
		expect(suggestHeaderNames("content-type")).toEqual([]);
		expect(suggestHeaderNames("request").map((s) => s.label)).toEqual(["X-Request-ID", "X-Requested-With"]);
	});

	it("suggests a header's usual values, all of them before typing", () => {
		expect(suggestHeaderValues("content-type", "").length).toBeGreaterThan(3);
		expect(suggestHeaderValues("Content-Type", "json").map((s) => s.label)).toEqual(["application/json"]);
		expect(suggestHeaderValues("X-Unknown", "")).toEqual([]);
	});
});
