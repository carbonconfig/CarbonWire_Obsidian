export function joinPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

export function dirname(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

export function stem(path: string): string {
	return basename(path).replace(/\.ya?ml$/i, "");
}

/** Where `path` ends up when `from` is moved to `to`; undefined when the move doesn't include it. */
export function movedPath(path: string, from: string, to: string): string | undefined {
	if (path === from) return to;
	return path.startsWith(`${from}/`) ? to + path.slice(from.length) : undefined;
}

/** Characters that are invalid in file names on at least one desktop OS. */
export function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Untitled";
}
