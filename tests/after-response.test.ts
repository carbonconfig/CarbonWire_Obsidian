import { describe, expect, it } from "vitest";
import { lookup, nameFromPath, readResponse, runActions, runChecks, type ReadResponse } from "../src/core/after-response";

const body = { id: 7, name: "Ada", tags: ["a", "b"], empty: [], none: null, nested: { ok: true, n: "12" } };
const res: ReadResponse = readResponse({
	status: 201,
	statusText: "Created",
	headers: [["Content-Type", "application/json"], ["Set-Cookie", "a=1"], ["set-cookie", "b=2"]],
	body: new TextEncoder().encode(JSON.stringify(body)),
	timings: { total: 42 },
});
const check = (expression: string, operator: string, value?: string) => runChecks(res, [{ expression, operator, value }])[0]!;

describe("lookup", () => {
	it("reads JSONPath and Bruno's res expressions", () => {
		expect(lookup(res, "$.id")).toEqual({ found: true, value: 7 });
		expect(lookup(res, "$.tags[1]")).toEqual({ found: true, value: "b" });
		expect(lookup(res, "res.body.nested.ok")).toEqual({ found: true, value: true });
		expect(lookup(res, "res.body")).toEqual({ found: true, value: body });
		expect(lookup(res, "res.status")).toEqual({ found: true, value: 201 });
		expect(lookup(res, "res.responseTime")).toEqual({ found: true, value: 42 });
		expect(lookup(res, "res.headers.content-type")).toEqual({ found: true, value: "application/json" });
		expect(lookup(res, "res.headers['Set-Cookie']")).toEqual({ found: true, value: "a=1, b=2" });
		expect(lookup(res, "$.missing")).toEqual({ found: false });
	});

	it("explains what it can't read", () => {
		const bad = lookup(res, "body.id");
		expect(bad.found).toBe(false);
		expect(bad.found ? "" : bad.error).toContain("JSONPath");
		const text = readResponse({ status: 200, statusText: "OK", headers: [], body: new TextEncoder().encode("plain"), timings: { total: 1 } });
		expect(lookup(text, "$.id")).toEqual({ found: false, error: "The response isn't JSON." });
		expect(lookup(text, "res.body")).toEqual({ found: true, value: "plain" });
	});
});

describe("runChecks", () => {
	it("compares values the way Bruno does", () => {
		expect(check("res.status", "eq", "201").passed).toBe(true);
		expect(check("res.status", "eq", '"201"').passed).toBe(false);
		expect(check("$.name", "eq", "Ada").passed).toBe(true);
		expect(check("$.name", "eq", '"Ada"').passed).toBe(true);
		expect(check("$.tags", "eq", '["a","b"]').passed).toBe(true);
		expect(check("res.status", "neq", "200").passed).toBe(true);
		expect(check("res.status", "gte", "200").passed).toBe(true);
		expect(check("res.status", "lt", "300").passed).toBe(true);
		expect(check("$.nested.n", "gt", "11").passed).toBe(true);
		expect(check("res.status", "between", "200, 299").passed).toBe(true);
		expect(check("res.status", "in", "200, 201").passed).toBe(true);
		expect(check("res.status", "notIn", "[200, 204]").passed).toBe(true);
	});

	it("checks text, lists and types", () => {
		expect(check("$.tags", "contains", "a").passed).toBe(true);
		expect(check("$.name", "contains", "d").passed).toBe(true);
		expect(check("$.name", "notContains", "z").passed).toBe(true);
		expect(check("$.name", "startsWith", "A").passed).toBe(true);
		expect(check("$.name", "endsWith", "da").passed).toBe(true);
		expect(check("$.name", "matches", "/^ad/i").passed).toBe(true);
		expect(check("$.name", "matches", "^A").passed).toBe(true);
		expect(check("$.tags", "length", "2").passed).toBe(true);
		expect(check("$.empty", "isEmpty").passed).toBe(true);
		expect(check("$.tags", "isNotEmpty").passed).toBe(true);
		expect(check("$.none", "isNull").passed).toBe(true);
		expect(check("$.missing", "isUndefined").passed).toBe(true);
		expect(check("$.missing", "isDefined").passed).toBe(false);
		expect(check("$.id", "isNumber").passed).toBe(true);
		expect(check("$.tags", "isArray").passed).toBe(true);
		expect(check("$.nested", "isJson").passed).toBe(true);
	});

	it("says what was found, and why a check couldn't run", () => {
		expect(check("$.name", "eq", "Bob")).toEqual({ expression: "$.name", operator: "eq", value: "Bob", passed: false, actual: "Ada" });
		expect(check("$.name", "gt", "1")).toMatchObject({ passed: false, error: "The value isn't a number." });
		expect(check("$.id", "nope", "1")).toMatchObject({ passed: false, error: "nope isn't an operator CarbonWire knows." });
		const broken = check("$[", "eq", "1");
		expect(broken.passed).toBe(false);
		expect(broken.error).toBeTruthy();
	});

	it("skips disabled checks and fills variables in expected values", () => {
		const results = runChecks(res, [{ expression: "res.status", operator: "eq", value: "{{code}}" }, { expression: "res.status", operator: "eq", value: "1", disabled: true }], (t) => t.replace("{{code}}", "201"));
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ value: "201", passed: true });
	});
});

describe("runActions", () => {
	it("takes variables from the response, as text", () => {
		const results = runActions(res, [
			{ type: "set-variable", phase: "after-response", selector: { expression: "$.id", method: "jsonq" }, variable: { name: "userId", scope: "environment" } },
			{ type: "set-variable", selector: { expression: "res.body.nested", method: "jsonq" }, variable: { name: "nested", scope: "runtime" } },
			{ type: "set-variable", selector: { expression: "$.missing", method: "jsonq" }, variable: { name: "gone", scope: "runtime" } },
			{ type: "set-variable", phase: "before-request", selector: { expression: "$.id", method: "jsonq" }, variable: { name: "early", scope: "runtime" } },
			{ type: "set-variable", disabled: true, selector: { expression: "$.id", method: "jsonq" }, variable: { name: "off", scope: "runtime" } },
		]);
		expect(results).toEqual([
			{ name: "userId", scope: "environment", expression: "$.id", value: "7" },
			{ name: "nested", scope: "runtime", expression: "res.body.nested", value: '{"ok":true,"n":"12"}' },
			{ name: "gone", scope: "runtime", expression: "$.missing", error: "Nothing in the response at $.missing." },
		]);
	});
});

describe("nameFromPath", () => {
	it("names a variable after the path's last part", () => {
		expect(nameFromPath("$.data.token")).toBe("token");
		expect(nameFromPath("$.items[0]")).toBe("items");
		expect(nameFromPath("$['access token']")).toBe("access_token");
		expect(nameFromPath("$")).toBe("value");
	});
});
