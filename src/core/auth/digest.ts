import { createHash, randomBytes } from "node:crypto";

export interface DigestChallenge {
	realm: string;
	nonce: string;
	qop?: string;
	opaque?: string;
	algorithm?: string;
}

export interface DigestCredentials {
	username: string;
	password: string;
	method: string;
	uri: string;
	cnonce?: string;
	nc?: number;
}

export function parseDigestChallenge(header: string | undefined): DigestChallenge | undefined {
	if (!header || !/^\s*digest\s/i.test(header)) return undefined;
	const params: Record<string, string> = {};
	for (const m of header.replace(/^\s*digest\s+/i, "").matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi)) {
		params[m[1]!.toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]!;
	}
	if (params.realm === undefined || params.nonce === undefined) return undefined;
	return { realm: params.realm, nonce: params.nonce, qop: params.qop, opaque: params.opaque, algorithm: params.algorithm };
}

/** RFC 7616 (and RFC 2617) digest response for qop "auth" or no qop. */
export function digestAuthorization(challenge: DigestChallenge, creds: DigestCredentials): string {
	const algorithm = (challenge.algorithm ?? "MD5").toUpperCase();
	const sess = algorithm.endsWith("-SESS");
	const hashName = algorithm.startsWith("SHA-256") ? "sha256" : "md5";
	const h = (s: string) => createHash(hashName).update(s).digest("hex");

	const qop = challenge.qop?.split(",").map((q) => q.trim()).includes("auth") ? "auth" : undefined;
	const cnonce = creds.cnonce ?? randomBytes(8).toString("hex");
	const nc = (creds.nc ?? 1).toString(16).padStart(8, "0");

	let ha1 = h(`${creds.username}:${challenge.realm}:${creds.password}`);
	if (sess) ha1 = h(`${ha1}:${challenge.nonce}:${cnonce}`);
	const ha2 = h(`${creds.method}:${creds.uri}`);
	const response = qop ? h(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : h(`${ha1}:${challenge.nonce}:${ha2}`);

	const parts = [
		`username="${creds.username}"`,
		`realm="${challenge.realm}"`,
		`nonce="${challenge.nonce}"`,
		`uri="${creds.uri}"`,
		`algorithm=${challenge.algorithm ?? "MD5"}`,
		`response="${response}"`,
	];
	if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
	if (challenge.opaque !== undefined) parts.push(`opaque="${challenge.opaque}"`);
	return `Digest ${parts.join(", ")}`;
}
