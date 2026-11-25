import { describe, expect, it } from "vitest";
import { environmentSecretId } from "../src/core/secrets";
import { buildScope, describeScope, interpolate, isDynamicVariable, MASK, resolveEnvironment, templateSegments, unresolvedNames, withValue } from "../src/core/variables";

describe("buildScope", () => {
	it("applies precedence collection < environment < folders < request < runtime", () => {
		const scope = buildScope({
			collection: [{ name: "a", value: "collection" }, { name: "c", value: "c" }, { name: "o", value: "collection" }],
			environment: [{ name: "a", value: "env" }, { name: "e", value: "e" }, { name: "o", value: "env" }],
			folders: [[{ name: "a", value: "outer" }], [{ name: "a", value: "inner" }, { name: "f", value: "f" }]],
			request: [{ name: "r", value: "r" }],
		});
		expect(scope.get("a")).toBe("inner");
		expect(scope.get("o")).toBe("env");
		expect([scope.get("c"), scope.get("e"), scope.get("f"), scope.get("r")]).toEqual(["c", "e", "f", "r"]);

		const withRuntime = buildScope({ request: [{ name: "a", value: "req" }], runtime: new Map([["a", "rt"]]) });
		expect(withRuntime.get("a")).toBe("rt");
	});

	it("skips disabled variables and reads typed values and selected variants", () => {
		const scope = buildScope({
			collection: [
				{ name: "off", value: "x", disabled: true },
				{ name: "typed", value: { type: "number", data: "42" } },
				{ name: "variant", value: [{ title: "a", value: "A" }, { title: "b", value: "B", selected: true }] },
			],
		});
		expect(scope.has("off")).toBe(false);
		expect(scope.get("typed")).toBe("42");
		expect(scope.get("variant")).toBe("B");
	});
});

describe("resolveEnvironment", () => {
	it("fills secret values from the lookup and drops disabled or missing ones", () => {
		const env = {
			name: "dev",
			variables: [
				{ name: "host", value: "h" },
				{ secret: true as const, name: "token" },
				{ secret: true as const, name: "missing" },
				{ name: "off", value: "x", disabled: true },
			],
		};
		expect(resolveEnvironment(env, (n) => (n === "token" ? "s3cret" : null))).toEqual([{ name: "host", value: "h" }, { name: "token", value: "s3cret" }]);
		expect(resolveEnvironment(undefined)).toEqual([]);
	});
});

describe("interpolate", () => {
	const scope = new Map([
		["host", "api.example.com"],
		["base", "https://{{host}}"],
		["loop", "{{loop}}"],
	]);

	it("resolves nested references and leaves unknown placeholders", () => {
		expect(interpolate("{{ base }}/users/{{id}}", scope)).toBe("https://api.example.com/users/{{id}}");
		expect(unresolvedNames("{{base}}/{{id}}/{{other}}", scope)).toEqual(["id", "other"]);
	});

	it("stops on self-referencing variables", () => {
		expect(interpolate("{{loop}}", scope)).toBe("{{loop}}");
	});

	it("generates dynamic values", () => {
		expect(interpolate("{{$guid}}", scope)).toMatch(/^[0-9a-f-]{36}$/);
		expect(Number(interpolate("{{$timestamp}}", scope))).toBeGreaterThan(1_700_000_000);
	});
});


describe("withValue", () => {
	it("keeps typed values and edits the selected variant", () => {
		expect(withValue({ name: "a", value: "x" }, "y")).toEqual({ name: "a", value: "y" });
		expect(withValue({ name: "n", value: { type: "number", data: "1" } }, "2")).toEqual({ name: "n", value: { type: "number", data: "2" } });
		expect(withValue({ name: "v", value: [{ title: "a", value: "A" }, { title: "b", value: "B", selected: true }] }, "C").value).toEqual([
			{ title: "a", value: "A" },
			{ title: "b", value: "C", selected: true },
		]);
	});
});

describe("environmentSecretId", () => {
	it("produces storage-safe IDs from the environment and variable names", () => {
		expect(environmentSecretId("API/Environments/Dev env.yml", "API_KEY")).toBe("carbonwire--global-dev-env-api-key");
		expect(environmentSecretId("Prod.yml", "")).toBe("carbonwire--global-prod-x");
	});
});

describe("templateSegments", () => {
	it("splits literal text and variable references", () => {
		expect(templateSegments("{{ base }}/users/{{id}}?x")).toEqual([
			{ text: "{{ base }}", variable: "base" },
			{ text: "/users/" },
			{ text: "{{id}}", variable: "id" },
			{ text: "?x" },
		]);
		expect(templateSegments("plain")).toEqual([{ text: "plain" }]);
		expect(isDynamicVariable("$guid")).toBe(true);
		expect(isDynamicVariable("guid")).toBe(false);
	});
});

describe("describeScope", () => {
	it("tells where each value comes from, the innermost scope winning", () => {
		const info = describeScope([
			{ source: "globals", variables: [{ name: "host", value: "global.example" }, { name: "g", value: "1" }] },
			{ source: "environment", label: "Staging", file: (name) => `env/${name}.yml`, variables: [{ name: "host", value: "staging.example" }] },
			{ source: "folder", label: "Users", file: "api/Users/folder.yml", variables: [{ name: "base", value: "https://{{host}}/v1" }, { name: "off", value: "x", disabled: true }] },
		]);
		expect(info).toEqual([
			{ name: "host", value: "staging.example", source: "environment", label: "Staging", file: "env/host.yml" },
			{ name: "g", value: "1", source: "globals" },
			{ name: "base", value: "https://staging.example/v1", source: "folder", label: "Users", file: "api/Users/folder.yml" },
		]);
	});

	it("masks secret values, also where other values use them", () => {
		const info = describeScope([
			{ source: "environment", secrets: new Set(["token"]), variables: [{ name: "token", value: "s3cr3t" }] },
			{ source: "collection", variables: [{ name: "auth", value: "Bearer {{token}}" }, { name: "long", value: "x".repeat(600) }] },
		]);
		expect(info.find((v) => v.name === "token")).toMatchObject({ value: MASK, secret: true });
		expect(info.find((v) => v.name === "auth")?.value).toBe(`Bearer ${MASK}`);
		expect(info.find((v) => v.name === "long")?.value).toHaveLength(501);
	});
});
