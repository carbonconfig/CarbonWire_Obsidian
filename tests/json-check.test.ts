import { describe, expect, it } from "vitest";
import { checkJson } from "../src/core/json-check";

/** The problem's message and the text it marks. */
function problem(text: string): [string, string] | undefined {
	const p = checkJson(text);
	return p && [p.message, text.slice(p.from, p.to)];
}

describe("checkJson", () => {
	it("accepts valid JSON, empty bodies and comments", () => {
		for (const ok of [
			"",
			"  \n",
			"// nothing yet",
			'{"a": [1, -2.5e3, true, false, null, "x\\n\\u00e9"], "b": {}}',
			"[]",
			"42",
			'"text"',
			'{\n  "a": 1, // why\n  /* "b": 2, */\n  "c": 3\n}',
		]) {
			expect(checkJson(ok), ok).toBeUndefined();
		}
	});

	it("accepts unquoted {{variables}} as values and property names", () => {
		expect(checkJson('{"id": {{id}}, "ids": [{{a}}, {{ b }}], {{key}}: "v", "url": "{{base}}/x"}')).toBeUndefined();
		expect(checkJson("{{body}}")).toBeUndefined();
	});

	it("allows a trailing comma only when comments are removed, which drops it", () => {
		expect(problem('{"a": 1,}')).toEqual(["Remove this comma: nothing follows it.", ","]);
		expect(problem("[1, 2, ]")).toEqual(["Remove this comma: nothing follows it.", ","]);
		expect(checkJson('{\n  "a": 1,\n  // "b": 2\n}')).toBeUndefined();
	});

	it("marks a missing comma or colon", () => {
		expect(problem('{"a": 1\n "b": 2}')).toEqual(["A comma is missing before this.", '"']);
		expect(problem('{"a" 1}')).toEqual(["Expected : after the property name.", "1"]);
		expect(problem("[1 2]")).toEqual(["A comma is missing before this.", "2"]);
	});

	it("explains quotes, words and numbers JSON doesn't allow", () => {
		expect(problem("{a: 1}")).toEqual(["Property names need double quotes.", "a"]);
		expect(problem("{'a': 1}")?.[0]).toBe("Property names need double quotes, not single quotes.");
		expect(problem('{"a": \'x\'}')?.[0]).toBe("Strings need double quotes, not single quotes.");
		expect(problem('{"a": undefined}')).toEqual(["undefined isn't a JSON value. Put text in double quotes, or write {{undefined}} for a variable.", "undefined"]);
		expect(problem('{"a": 01}')).toEqual(["Numbers can't start with 0.", "01"]);
		expect(problem('{"a": 1.2.3}')).toEqual(["This isn't a number.", "1.2.3"]);
		expect(problem('{"a": }')).toEqual(["A value is missing before this.", "}"]);
	});

	it("marks strings, escapes and comments that aren't closed", () => {
		expect(problem('{"a": "x\n}')).toEqual(['This string isn\'t closed: a " is missing.', '"x']);
		expect(problem('{"a": "\\q"}')).toEqual(["\\q isn't an escape JSON knows. Write \\\\ for a backslash.", "\\q"]);
		expect(problem('{"a": "\\u12"}')?.[0]).toBe("\\u needs four hex digits, such as \\u00e9.");
		expect(problem('{"a": "\tx"}')?.[0]).toBe("Tabs inside strings must be written as \\t.");
		expect(problem('{"a": 1 /* open')).toEqual(["This comment isn't closed: */ is missing.", "/*"]);
	});

	it("marks brackets that aren't closed or don't match", () => {
		expect(problem('{\n  "a": [1, 2\n')).toEqual(["This [ isn't closed.", "["]);
		expect(problem('{"a": 1')).toEqual(["This { isn't closed.", "{"]);
		expect(problem('{\n"a": [1}')).toEqual(["Expected ] to close the [ on line 2.", "}"]);
		expect(problem('{"a": 1}}')).toEqual(["There's more after the end of the JSON. Wrap several values in [ ] or { }.", "}"]);
	});

	it("agrees with JSON.parse on plain JSON, valid or broken", () => {
		// A small seeded generator, so failures repeat.
		let seed = 7;
		const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
		const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
		const value = (depth: number): unknown => {
			const r = random();
			if (depth > 3 || r < 0.4) return pick([0, -1.5, 1e21, "s", "a\"b", "\u00e9\n", true, false, null, ""]);
			if (r < 0.7) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
			return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, i) => [`k${i}`, value(depth + 1)]));
		};
		const edits = ["", " ", ",", ":", "{", "}", "[", "]", '"', "\\", "0", "-", ".", "e", "x", "\t", "\n", "'", "nul"];
		let checked = 0;
		for (let n = 0; n < 3000; n++) {
			let text = JSON.stringify(value(0), null, random() < 0.5 ? 2 : undefined);
			for (let e = Math.floor(random() * 3); e > 0; e--) {
				const at = Math.floor(random() * (text.length + 1));
				const cut = random() < 0.5 ? 1 : 0;
				text = text.slice(0, at) + pick(edits) + text.slice(at + cut);
			}
			// Comments and variables are what CarbonWire allows beyond JSON; so is an empty body.
			if (text.includes("/") || text.includes("{{") || !text.trim()) continue;
			let valid = true;
			try {
				JSON.parse(text);
			} catch {
				valid = false;
			}
			expect(checkJson(text) === undefined, text).toBe(valid);
			checked++;
		}
		expect(checked).toBeGreaterThan(2500);
	});

	it("checks a large body quickly", () => {
		const big = JSON.stringify({ items: Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ["a", "b"], ok: i % 2 === 0 })) });
		const started = performance.now();
		expect(checkJson(big)).toBeUndefined();
		expect(performance.now() - started).toBeLessThan(500);
	});
});
