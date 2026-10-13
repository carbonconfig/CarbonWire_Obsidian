import { describe, expect, it } from "vitest";
import { colorForName, ENV_COLORS, readableTextColor } from "../src/ui/env-colors";

describe("readableTextColor", () => {
	it("picks dark text on light colours and light text on dark ones", () => {
		for (const color of ENV_COLORS) expect(readableTextColor(color)).toMatch(/^#(1f1f1f|ffffff)$/);
		expect(readableTextColor("#FFDAC1")).toBe("#1f1f1f");
		expect(readableTextColor("#1a237e")).toBe("#ffffff");
		expect(readableTextColor("#fff")).toBe("#1f1f1f");
		expect(readableTextColor(undefined)).toBeUndefined();
		expect(readableTextColor("red")).toBeUndefined();
	});
});

describe("colorForName", () => {
	it("suggests a colour from common environment names", () => {
		const [blue, green, orange, , red] = ENV_COLORS;
		expect(["Local", "dev", "Development"].map(colorForName)).toEqual([green, green, green]);
		expect(["QA", "test-eu"].map(colorForName)).toEqual([blue, blue]);
		expect(["Staging", "UAT"].map(colorForName)).toEqual([orange, orange]);
		expect(["Production", "live"].map(colorForName)).toEqual([red, red]);
		expect(colorForName("Sandbox")).toBeUndefined();
		expect(colorForName("my dev")).toBeUndefined();
	});
});
