const INDENT = "  ";

/**
 * Lays out a JSON body as JSON.stringify(…, null, 2) would, keeping what JSON.parse can't read:
 * comments, on their own line or after a value as they were, and unquoted {{variables}}. Strings
 * and numbers are kept as written. Expects a body {@link checkJson} accepts.
 */
export function formatJsonBody(text: string): string {
	const out: string[] = [];
	let depth = 0;
	let newLine = false;
	let space = false;
	/* Whether a line break came since the last token, so a comment there stays on its own line. */
	let broke = true;

	const emit = (token: string) => {
		if (newLine && out.length > 0) out.push("\n", INDENT.repeat(depth));
		else if (space) out.push(" ");
		newLine = false;
		space = false;
		out.push(token);
	};

	let i = 0;
	const n = text.length;
	while (i < n) {
		const c = text[i]!;
		if (c === " " || c === "\t" || c === "\r" || c === "\n") {
			if (c === "\n") broke = true;
			i++;
			continue;
		}
		if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
			const block = text[i + 1] === "*";
			let stop = block ? text.indexOf("*/", i + 2) : text.indexOf("\n", i);
			stop = stop < 0 ? n : block ? stop + 2 : stop;
			// A comment after a value stays after it, even where a line break was due, such as after a comma.
			const due = newLine;
			if (broke) newLine = true;
			else {
				newLine = false;
				space = true;
			}
			emit(text.slice(i, stop).trimEnd());
			// A line comment ends its line, as does a block comment on its own line; otherwise the break still due follows.
			if (!block || broke || due) newLine = true;
			else space = true;
			i = stop;
			broke = false;
			continue;
		} else if (c === "{" || c === "[") {
			const placeholder = c === "{" && text[i + 1] === "{" ? text.indexOf("}}", i + 2) : -1;
			if (placeholder >= 0) {
				emit(text.slice(i, placeholder + 2));
				i = placeholder + 2;
			} else {
				const close = c === "{" ? "}" : "]";
				let j = i + 1;
				while (j < n && /\s/.test(text[j]!)) j++;
				if (text[j] === close) {
					emit(c + close);
					i = j + 1;
				} else {
					emit(c);
					depth++;
					newLine = true;
					i++;
				}
			}
		} else if (c === "}" || c === "]") {
			depth--;
			newLine = true;
			emit(c);
			i++;
		} else if (c === ",") {
			emit(",");
			newLine = true;
			i++;
		} else if (c === ":") {
			emit(":");
			space = true;
			i++;
		} else if (c === '"') {
			let j = i + 1;
			while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			emit(text.slice(i, j + 1));
			i = j + 1;
		} else {
			// A number, true, false or null.
			let j = i + 1;
			while (j < n && /[\w.+-]/.test(text[j]!)) j++;
			emit(text.slice(i, j));
			i = j;
		}
		broke = false;
	}
	return out.join("");
}
