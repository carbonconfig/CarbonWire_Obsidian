import { describe, expect, it } from "vitest";
import { stripJsonComments } from "../src/core/json-comments";

describe("JSON body comments", () => {
	it("leaves bodies without comments exactly as they are", () => {
		const body = '{ "url": "https://example.com", "a": [1, 2,] }';
		expect(stripJsonComments(body)).toBe(body);
	});

	it("removes commented lines whole, and the comma they leave", () => {
		const body = '{\n  "a": 1,\n  // "b": 2,\n    // "c": 3\n}';
		expect(stripJsonComments(body)).toBe('{\n  "a": 1\n}');
		expect(JSON.parse(stripJsonComments(body))).toEqual({ a: 1 });
	});

	it("removes comments after a value and block comments, but not // inside strings", () => {
		const body = '{\n  "url": "http://x.test/a//b", // the endpoint\n  /* "old": true, */ "n": {{count}}\n}';
		expect(stripJsonComments(body)).toBe('{\n  "url": "http://x.test/a//b", \n   "n": {{count}}\n}');
	});

	it("keeps escaped quotes inside strings", () => {
		expect(JSON.parse(stripJsonComments('{"q": "say \\"hi\\" // not a comment"} // done'))).toEqual({ q: 'say "hi" // not a comment' });
	});

	it("handles a comment on the last line and in arrays", () => {
		expect(JSON.parse(stripJsonComments('[\n  1,\n  2,\n  // 3\n]\n// end'))).toEqual([1, 2]);
	});
});
