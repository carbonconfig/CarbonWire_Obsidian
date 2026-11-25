/**
 * A glob as `files.exclude` writes them (`*`, `?`, `**`, `{a,b}`, `[abc]`) as a RegExp over
 * "/"-separated paths relative to the folder being searched.
 */
export function globToRegExp(glob: string): RegExp {
	const clean = glob.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
	let out = "";
	let braces = 0;
	for (let i = 0; i < clean.length; i++) {
		const c = clean[i]!;
		if (c === "*" && clean[i + 1] === "*") {
			const start = i === 0 || clean[i - 1] === "/";
			const end = i + 2 === clean.length || clean[i + 2] === "/";
			i++;
			if (start && end) {
				// "**/" matches any number of folders, none included; a trailing "/**" anything below.
				if (clean[i + 1] === "/") {
					out += "(?:.*/)?";
					i++;
				} else if (out.endsWith("/")) {
					out = `${out.slice(0, -1)}(?:/.*)?`;
				} else {
					out += ".*";
				}
			} else {
				out += "[^/]*";
			}
		} else if (c === "*") {
			out += "[^/]*";
		} else if (c === "?") {
			out += "[^/]";
		} else if (c === "{") {
			braces++;
			out += "(?:";
		} else if (c === "}" && braces > 0) {
			braces--;
			out += ")";
		} else if (c === "," && braces > 0) {
			out += "|";
		} else if (c === "[") {
			const close = clean.indexOf("]", i + 2);
			if (close < 0) {
				out += "\\[";
				continue;
			}
			let set = clean.slice(i + 1, close);
			if (set.startsWith("!")) set = `^${set.slice(1)}`;
			out += `[${set}]`;
			i = close;
		} else {
			out += c.replace(/[.+^$()|\\]/g, "\\$&");
		}
	}
	while (braces-- > 0) out += ")";
	return new RegExp(`^${out}$`);
}

/**
 * Folders and files never searched for collections: those matching the patterns, and hidden ones
 * (named with a leading dot) unless they lead to a folder in `kept`, such as the collections folder.
 */
export class Exclusions {
	private readonly patterns: RegExp[];
	private readonly kept: string[];

	constructor(globs: readonly string[], kept: readonly string[] = []) {
		this.patterns = globs.filter((g) => g.trim() !== "").map(globToRegExp);
		this.kept = kept.map((k) => k.split("/").filter((p) => p && p !== ".").join("/")).filter(Boolean);
	}

	/** Whether the path, relative to the searched folder, or a folder above it is skipped. */
	excludes(path: string): boolean {
		let prefix = "";
		for (const part of path.split("/")) {
			if (!part) continue;
			prefix = prefix ? `${prefix}/${part}` : part;
			if (this.skips(prefix, part)) return true;
		}
		return false;
	}

	/** Whether this path itself is skipped, its folders having been checked already, as in a directory walk. */
	skips(path: string, name: string): boolean {
		if (name.startsWith(".") && !this.kept.some((k) => k === path || k.startsWith(`${path}/`))) return true;
		return this.patterns.some((p) => p.test(path));
	}
}
