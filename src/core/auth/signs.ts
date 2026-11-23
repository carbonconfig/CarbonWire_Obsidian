/** Auth types the sender signs the request with, after the body is encoded. */
export const SIGNED_AUTH_TYPES = ["oauth1", "awsv4", "hawk", "edgegrid", "wsse", "jwt", "asap"] as const;

export function signs(type: string | undefined): boolean {
	return (SIGNED_AUTH_TYPES as readonly string[]).includes(type ?? "");
}
