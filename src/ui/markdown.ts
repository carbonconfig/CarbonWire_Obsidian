/*
 * A small Markdown renderer for collection and folder docs: headings, paragraphs, lists, quotes,
 * fenced code, inline code, emphasis and links. Everything is escaped first, so docs can't inject
 * markup or scripts; links open only http(s) and mailto addresses.
 */

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string): string {
	const codes: string[] = [];
	let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => {
		codes.push(code);
		return `\uE000${codes.length - 1}\uE001`;
	});
	out = out
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => (/^(https?:|mailto:)/i.test(href) ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : match))
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/__([^_]+)__/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
		.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
	return out.replace(/\uE000(\d+)\uE001/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(source: string): string {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const fence = /^\s*(```|~~~)/.exec(line);
		if (fence) {
			const body: string[] = [];
			for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) body.push(lines[i]!);
			i++;
			out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
			continue;
		}
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			out.push(`<h${heading[1]!.length}>${inline(heading[2]!.replace(/\s+#+\s*$/, ""))}</h${heading[1]!.length}>`);
			i++;
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			out.push("<hr>");
			i++;
			continue;
		}
		const list = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
		if (list) {
			const ordered = /\d/.test(list[1]!);
			const items: string[] = [];
			while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
				items.push(`<li>${inline(lines[i]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ""))}</li>`);
				i++;
			}
			out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
			continue;
		}
		if (/^\s*>/.test(line)) {
			const quoted: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ""));
			out.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
			continue;
		}
		if (line.trim() === "") {
			i++;
			continue;
		}
		const paragraph: string[] = [];
		while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,6}\s|\s*(```|~~~)|\s*([-*+]|\d+[.)])\s+|\s*>)/.test(lines[i]!)) paragraph.push(lines[i++]!);
		out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
	}
	return out.join("\n");
}
