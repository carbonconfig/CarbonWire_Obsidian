import { stripJsonComments } from "./json-comments";

/** A mistake in a JSON body: the text it covers, as offsets, and what's wrong. */
export interface JsonProblem {
	from: number;
	to: number;
	message: string;
}

type Frame = { kind: "object" | "array"; at: number; state: "start" | "key" | "colon" | "value" | "after" | "comma" };

const PLACEHOLDER = /\{\{[^{}]*\}\}/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[A-Za-z_$][\w$]*/y;
const ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

/**
 * The first mistake in a JSON body, as it will be sent: `//` and block comments are allowed, and
 * removed before sending, as is a comma they leave before } or ]; so are unquoted {{variables}}.
 */
export function checkJson(text: string): JsonProblem | undefined {
	return new Checker(text).run();
}

class Checker {
	private i = 0;
	private readonly stack: Frame[] = [];
	/* Sending drops trailing commas only when it removed comments. */
	private readonly trailingCommasDropped: boolean;

	constructor(private readonly text: string) {
		this.trailingCommasDropped = stripJsonComments(text) !== text;
	}

	run(): JsonProblem | undefined {
		try {
			this.space();
			if (this.i >= this.text.length) return undefined;
			this.value();
			while (this.stack.length > 0) this.step();
			this.space();
			if (this.i < this.text.length) this.fail(this.i, this.tokenEnd(this.i), "There's more after the end of the JSON. Wrap several values in [ ] or { }.");
			return undefined;
		} catch (e) {
			if (e instanceof Problem) return e.problem;
			throw e;
		}
	}

	/** Moves through one token inside the innermost object or array. */
	private step(): void {
		const frame = this.stack[this.stack.length - 1]!;
		this.space();
		const at = this.i;
		const c = this.text[at];
		if (c === undefined) this.fail(frame.at, frame.at + 1, `This ${frame.kind === "object" ? "{" : "["} isn't closed.`);
		const close = frame.kind === "object" ? "}" : "]";

		if (frame.state === "after") {
			if (c === ",") {
				this.i++;
				frame.state = "comma";
			} else if (c === close) {
				this.i++;
				this.stack.pop();
			} else if (c === "}" || c === "]") {
				this.fail(at, at + 1, `Expected ${close} to close the ${frame.kind === "object" ? "{" : "["} on line ${this.line(frame.at)}.`);
			} else if (this.startsValue(at)) {
				this.fail(at, this.tokenEnd(at), "A comma is missing before this.");
			} else {
				this.unexpected(at, `Expected a comma or ${close}.`);
			}
			return;
		}

		if ((frame.state === "start" || frame.state === "comma") && c === close) {
			if (frame.state === "comma" && !this.trailingCommasDropped) {
				const comma = this.text.lastIndexOf(",", at);
				this.fail(comma, comma + 1, "Remove this comma: nothing follows it.");
			}
			this.i++;
			this.stack.pop();
			return;
		}

		if (frame.kind === "array") {
			this.value();
			frame.state = "after";
			return;
		}

		if (frame.state === "start" || frame.state === "comma") {
			this.key(at);
			frame.state = "colon";
		} else if (frame.state === "colon") {
			if (c !== ":") this.fail(at, this.tokenEnd(at), "Expected : after the property name.");
			this.i++;
			frame.state = "value";
		} else {
			this.value();
			frame.state = "after";
		}
	}

	private key(at: number): void {
		const c = this.text[at];
		if (c === '"') return this.string();
		if (this.placeholder()) return;
		if (c === "'") this.fail(at, this.tokenEnd(at), "Property names need double quotes, not single quotes.");
		if (this.match(WORD, at)) this.fail(at, this.tokenEnd(at), "Property names need double quotes.");
		this.unexpected(at, "Expected a property name in double quotes.");
	}

	/** Reads a value; an object or array is pushed, to be read by step(). */
	private value(): void {
		this.space();
		const at = this.i;
		const c = this.text[at];
		if (c === undefined) {
			const frame = this.stack[this.stack.length - 1];
			if (frame) this.fail(frame.at, frame.at + 1, `This ${frame.kind === "object" ? "{" : "["} isn't closed.`);
			this.fail(Math.max(0, at - 1), at, "A value is missing here.");
		}
		if (c === "{" || c === "[") {
			if (this.placeholder()) return;
			this.i++;
			this.stack.push({ kind: c === "{" ? "object" : "array", at, state: "start" });
			return;
		}
		if (c === '"') return this.string();
		if (c === "'") this.fail(at, this.tokenEnd(at), "Strings need double quotes, not single quotes.");
		if (c === "-" || (c >= "0" && c <= "9")) return this.number(at);
		const word = this.match(WORD, at);
		if (word !== undefined) {
			if (word === "true" || word === "false" || word === "null") {
				this.i += word.length;
				return;
			}
			this.fail(at, at + word.length, `${word} isn't a JSON value. Put text in double quotes, or write {{${word}}} for a variable.`);
		}
		if (c === "," || c === "}" || c === "]") this.fail(at, at + 1, "A value is missing before this.");
		this.unexpected(at, "Expected a value.");
	}

	private string(): void {
		const start = this.i;
		for (let i = start + 1; i < this.text.length; i++) {
			const c = this.text[i]!;
			if (c === '"') {
				this.i = i + 1;
				return;
			}
			if (c === "\n" || c === "\r") break;
			if (c === "\\") {
				const next = this.text[i + 1];
				if (next === "u") {
					if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(i + 2, i + 6))) this.fail(i, Math.min(i + 6, this.text.length), "\\u needs four hex digits, such as \\u00e9.");
					i += 5;
				} else if (next !== undefined && ESCAPES.has(next)) {
					i++;
				} else {
					this.fail(i, i + 2, `\\${next ?? ""} isn't an escape JSON knows. Write \\\\ for a backslash.`);
				}
			} else if (c < " ") {
				this.fail(i, i + 1, c === "\t" ? "Tabs inside strings must be written as \\t." : "Control characters inside strings must be escaped.");
			}
		}
		const end = this.text.indexOf("\n", start);
		this.fail(start, end < 0 ? this.text.length : end, "This string isn't closed: a \" is missing.");
	}

	private number(at: number): void {
		const found = this.match(NUMBER, at) ?? "";
		const end = at + found.length;
		const rest = this.tokenEnd(at);
		if (found === "" || found === "-") this.fail(at, rest, "This isn't a number.");
		if (rest > end) {
			if (found === "0" || found === "-0") this.fail(at, rest, "Numbers can't start with 0.");
			this.fail(at, rest, "This isn't a number.");
		}
		this.i = end;
	}

	/** An unquoted {{variable}}, which takes the place of a value or a property name. */
	private placeholder(): boolean {
		const found = this.match(PLACEHOLDER, this.i);
		if (found === undefined) return false;
		this.i += found.length;
		return true;
	}

	/** Skips whitespace and comments. */
	private space(): void {
		const { text } = this;
		while (this.i < text.length) {
			const c = text[this.i]!;
			if (c === " " || c === "\t" || c === "\n" || c === "\r") {
				this.i++;
			} else if (c === "/" && text[this.i + 1] === "/") {
				const end = text.indexOf("\n", this.i);
				this.i = end < 0 ? text.length : end + 1;
			} else if (c === "/" && text[this.i + 1] === "*") {
				const end = text.indexOf("*/", this.i + 2);
				if (end < 0) this.fail(this.i, this.i + 2, "This comment isn't closed: */ is missing.");
				this.i = end + 2;
			} else {
				return;
			}
		}
	}

	private startsValue(at: number): boolean {
		return /["'{[\-0-9A-Za-z_$]/.test(this.text[at] ?? "");
	}

	private unexpected(at: number, message: string): never {
		this.fail(at, this.tokenEnd(at), `${message} Found ${this.text.slice(at, Math.min(this.tokenEnd(at), at + 20))} instead.`);
	}

	/** The end of the word, number or symbol starting at `at`, for marking it. */
	private tokenEnd(at: number): number {
		const run = /[\w$.+-]+/y;
		run.lastIndex = at;
		const m = run.exec(this.text);
		return m ? at + m[0].length : Math.min(at + 1, this.text.length);
	}

	private match(pattern: RegExp, at: number): string | undefined {
		pattern.lastIndex = at;
		return pattern.exec(this.text)?.[0];
	}

	private line(at: number): number {
		let line = 1;
		for (let i = this.text.indexOf("\n"); i >= 0 && i < at; i = this.text.indexOf("\n", i + 1)) line++;
		return line;
	}

	private fail(from: number, to: number, message: string): never {
		throw new Problem({ from, to: Math.max(to, from + 1), message });
	}
}

/** Thrown to stop at the first mistake. */
class Problem extends Error {
	constructor(readonly problem: JsonProblem) {
		super(problem.message);
	}
}
