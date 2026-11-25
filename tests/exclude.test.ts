import { describe, expect, it } from "vitest";
import { Exclusions, globToRegExp } from "../src/core/storage/exclude";

const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

describe("globToRegExp", () => {
	it("matches files.exclude patterns", () => {
		expect(matches("**/node_modules", "node_modules")).toBe(true);
		expect(matches("**/node_modules", "a/b/node_modules")).toBe(true);
		expect(matches("**/node_modules", "a/node_modules_x")).toBe(false);
		expect(matches("tests/fixtures", "tests/fixtures")).toBe(true);
		expect(matches("tests/fixtures", "a/tests/fixtures")).toBe(false);
		expect(matches("**/tests/fixtures", "pkg/tests/fixtures")).toBe(true);
		expect(matches("build/**", "build")).toBe(true);
		expect(matches("build/**", "build/a/b.yml")).toBe(true);
		expect(matches("a/**/b", "a/b")).toBe(true);
		expect(matches("a/**/b", "a/x/y/b")).toBe(true);
		expect(matches("**/*.secret.yml", "api/x.secret.yml")).toBe(true);
		expect(matches("*.yml", "api/x.yml")).toBe(false);
		expect(matches("**/{dist,out}", "x/out")).toBe(true);
		expect(matches("**/{dist,out}", "x/outer")).toBe(false);
		expect(matches("file?.yml", "file1.yml")).toBe(true);
		expect(matches("[ab].yml", "b.yml")).toBe(true);
		expect(matches("[!ab].yml", "b.yml")).toBe(false);
		expect(matches("./api/", "api")).toBe(true);
		expect(matches("a.b", "aXb")).toBe(false);
		expect(matches("**", "any/thing")).toBe(true);
	});
});

describe("Exclusions", () => {
	it("skips hidden folders unless they lead to a kept folder", () => {
		const ex = new Exclusions([], [".api/collections", "api-collections/environments"]);
		expect(ex.excludes(".vscode-test/workspace/api/x.yml")).toBe(true);
		expect(ex.excludes(".api/collections/Users/get.yml")).toBe(false);
		expect(ex.excludes(".api/other/get.yml")).toBe(false);
		expect(ex.excludes(".api/collections/.carbonwire/x.yml")).toBe(true);
		expect(ex.excludes("api-collections/Users/.hidden.yml")).toBe(true);
		expect(ex.excludes("api-collections/Users/get.yml")).toBe(false);
	});

	it("skips folders matching a pattern, and everything in them", () => {
		const ex = new Exclusions(["**/tests/fixtures", ""]);
		expect(ex.excludes("tests/fixtures")).toBe(true);
		expect(ex.excludes("desktop/tests/fixtures/crosscheck/a.yml")).toBe(true);
		expect(ex.excludes("tests/other.yml")).toBe(false);
		expect(ex.skips("tests", "tests")).toBe(false);
	});
});
