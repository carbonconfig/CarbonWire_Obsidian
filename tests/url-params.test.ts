import { describe, expect, it } from "vitest";
import { paramsFromUrl, urlFromParams } from "../src/core/url-params";

describe("url ⇄ params", () => {
	it("parses path and query params, keeping path values and disabled rows", () => {
		const current = [
			{ name: "id", value: "42", type: "path" as const },
			{ name: "off", value: "1", type: "query" as const, disabled: true },
		];
		expect(paramsFromUrl("{{base}}/users/:id/posts/:postId?q=a b&flag#top", current)).toEqual([
			{ name: "id", value: "42", type: "path" },
			{ name: "postId", value: "", type: "path" },
			{ name: "q", value: "a b", type: "query" },
			{ name: "flag", value: "", type: "query" },
			{ name: "off", value: "1", type: "query", disabled: true },
		]);
	});

	it("rewrites the query from enabled params and keeps the hash", () => {
		const params = [
			{ name: "id", value: "42", type: "path" as const },
			{ name: "q", value: "x", type: "query" as const },
			{ name: "off", value: "1", type: "query" as const, disabled: true },
		];
		expect(urlFromParams("https://h/users/:id?old=1#frag", params)).toBe("https://h/users/:id?q=x#frag");
		expect(urlFromParams("https://h/?old=1", [])).toBe("https://h/");
	});
});
