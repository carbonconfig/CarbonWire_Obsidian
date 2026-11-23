/*
 * JSON bodies may have // and /* *\/ comments, as Ctrl+/ writes them. They're removed before sending,
 * with any comma left before a closing } or ], so commenting out the last property still sends valid JSON.
 */
export function stripJsonComments(text: string): string {
	if (!text.includes("/")) return text;
	let out = "";
	let last = 0;
	let inString = false;
	let removed = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === "\\") i++;
			else if (c === '"' || c === "\n") inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c !== "/" || (text[i + 1] !== "/" && text[i + 1] !== "*")) continue;
		removed = true;
		if (text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			out += text.slice(last, i);
			last = end < 0 ? text.length : end + 2;
			i = last - 1;
			continue;
		}
		let end = text.indexOf("\n", i);
		if (end < 0) end = text.length;
		const lineStart = text.lastIndexOf("\n", i - 1) + 1;
		// A line that's only a comment goes entirely, newline included.
		if (lineStart >= last && /^[ \t]*$/.test(text.slice(lineStart, i))) {
			out += text.slice(last, lineStart);
			last = Math.min(end + 1, text.length);
		} else {
			out += text.slice(last, i);
			last = end;
		}
		i = last - 1;
	}
	return removed ? withoutTrailingCommas(out + text.slice(last)) : text;
}

function withoutTrailingCommas(text: string): string {
	let out = "";
	let last = 0;
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === "\\") i++;
			else if (c === '"' || c === "\n") inString = false;
			continue;
		}
		if (c === '"') inString = true;
		else if (c === ",") {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j]!)) j++;
			if (text[j] === "}" || text[j] === "]") {
				out += text.slice(last, i);
				last = i + 1;
			}
		}
	}
	return out + text.slice(last);
}
