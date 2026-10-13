import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default tseslint.config(
	{ ignores: ["node_modules/", "main.js", "styles.css", "**/*.mjs", "vitest.config.ts", "vitest.bench.config.ts"] },
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		rules: { "obsidianmd/ui/sentence-case": ["warn", { brands: ["CarbonWire"] }] },
	},
	{
		files: ["tests/**/*.ts"],
		rules: { "obsidianmd/prefer-window-timers": "off" },
	},
);
