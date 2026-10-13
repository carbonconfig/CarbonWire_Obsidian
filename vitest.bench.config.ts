import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/bench/**/*.bench.ts"],
		environment: "node",
		fileParallelism: false,
		silent: false,
	},
});
