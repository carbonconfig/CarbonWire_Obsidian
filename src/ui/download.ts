/*
 * Saves data outside the vault: the download goes through Obsidian's (Electron's) download
 * handling, which asks where to save it.
 */
export function saveDownload(name: string, data: string | Uint8Array, type = "application/octet-stream"): void {
	const blob = new Blob([typeof data === "string" ? data : (data as Uint8Array<ArrayBuffer>)], { type });
	const url = URL.createObjectURL(blob);
	const a = createEl("a", { href: url, attr: { download: name } });
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A file extension for a saved response body, from its content type. */
export function extensionFor(contentType: string): string {
	const type = contentType.split(";")[0]!.trim().toLowerCase();
	const known: Record<string, string> = {
		"application/json": ".json",
		"application/xml": ".xml",
		"text/xml": ".xml",
		"text/html": ".html",
		"text/plain": ".txt",
		"text/csv": ".csv",
		"application/pdf": ".pdf",
		"application/zip": ".zip",
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
	};
	if (known[type]) return known[type];
	if (type.endsWith("+json")) return ".json";
	if (type.endsWith("+xml")) return ".xml";
	return "";
}
