import { describe, expect, it } from "vitest";
import { checkJson } from "../src/core/json-check";
import { stripJsonComments } from "../src/core/json-comments";
import { formatJsonBody } from "../src/core/json-pretty";

describe("formatJsonBody", () => {
	it("lays out plain JSON as JSON.stringify does", () => {
		const value = { a: [1, -2.5, true, null, "x\"y"], b: {}, c: [], d: { e: { f: "é" } } };
		expect(formatJsonBody(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2));
		expect(formatJsonBody('  [ 1 ,2 ]  ')).toBe("[\n  1,\n  2\n]");
		expect(formatJsonBody('"text"')).toBe('"text"');
	});

	it("keeps strings, numbers and unquoted variables as written", () => {
		expect(formatJsonBody('{"u":"\\u00e9\\/","n":1.0e+2,"id":{{id}},{{key}}:"{{v}}"}')).toBe('{\n  "u": "\\u00e9\\/",\n  "n": 1.0e+2,\n  "id": {{id}},\n  {{key}}: "{{v}}"\n}');
	});

	it("keeps comments on their own line, or after the value they follow", () => {
		const body = '{"a": 1, // why\n// "b": 2,\n"c": [3, /* three */ 4], /* end */\n  /* own */ "d": 5\n}';
		expect(formatJsonBody(body)).toBe('{\n  "a": 1, // why\n  // "b": 2,\n  "c": [\n    3, /* three */\n    4\n  ], /* end */\n  /* own */\n  "d": 5\n}');
	});

	it("keeps a commented-out last property, and the comma before it", () => {
		expect(formatJsonBody('{\n"a": 1,\n    // "b": 2\n}')).toBe('{\n  "a": 1,\n  // "b": 2\n}');
		expect(formatJsonBody("// a note\n{\"a\":1}\n// done")).toBe('// a note\n{\n  "a": 1\n}\n// done');
		expect(formatJsonBody("{ // only a note\n}")).toBe("{ // only a note\n}");
	});

	it("formats generated bodies to the same value, the same text twice, and still valid", () => {
		let seed = 11;
		const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
		const value = (depth: number): unknown => {
			const r = random();
			if (depth > 3 || r < 0.4) return pick([0, -1.5, "s", "a\"b", true, null]);
			if (r < 0.7) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
			return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, i) => [`k${i}`, value(depth + 1)]));
		};
		for (let n = 0; n < 500; n++) {
			const json = JSON.stringify(value(0), null, random() < 0.5 ? 2 : undefined);
			// Sprinkles comments after commas and at line ends.
			const commented = json.replace(/,/g, (m) => (random() < 0.3 ? `${m} // note\n` : random() < 0.2 ? `${m}\n/* gone */` : m));
			const formatted = formatJsonBody(commented);
			expect(checkJson(formatted), formatted).toBeUndefined();
			expect(JSON.parse(stripJsonComments(formatted))).toEqual(JSON.parse(json));
			expect(formatJsonBody(formatted)).toBe(formatted);
		}
	});
});
