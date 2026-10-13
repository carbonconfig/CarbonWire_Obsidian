import { builtinModules } from "node:module";
import { rename } from "node:fs/promises";
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const mode = process.argv[2];
const prod = mode === "production" || mode === "analyze";

// Svelte component CSS is emitted as main.css; Obsidian loads styles.css.
const renameCss = {
	name: "rename-css",
	setup(build) {
		build.onEnd(async (result) => {
			if (result.errors.length === 0) await rename("main.css", "styles.css").catch(() => {});
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	// Modules Obsidian provides at runtime. Other CodeMirror packages, such as lang-json, are bundled.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	platform: "browser",
	target: "es2023",
	conditions: ["svelte", "browser"],
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
	metafile: true,
	plugins: [
		sveltePlugin({ compilerOptions: { css: "external", dev: !prod } }),
		renameCss,
	],
});

if (prod) {
	const result = await context.rebuild();
	if (mode === "analyze") console.log(await esbuild.analyzeMetafile(result.metafile, { verbose: false }));
	await context.dispose();
} else {
	await context.watch();
}
