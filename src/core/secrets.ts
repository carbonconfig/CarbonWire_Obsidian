import { stem } from "./storage/paths";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** A SecretStorage ID (lowercase letters, digits and dashes) for a variable in an environment. */
export function environmentSecretId(environmentPath: string, name: string): string {
	return `carbonwire--global-${slug(stem(environmentPath))}-${slug(name)}`;
}
