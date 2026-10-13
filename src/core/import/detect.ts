import { parse as parseYaml } from "yaml";
import { importBruFile } from "./bruno";
import { importCurl, isCurl } from "./curl";
import { convertHoppscotchVariables, importHoppscotchCollection, importHoppscotchEnvironment, isHoppscotchCollection, isHoppscotchEnvironment } from "./hoppscotch";
import { importHttpClientEnv, importHttpFile, looksLikeHttpFile } from "./http-file";
import { importHttpie, isHttpie } from "./httpie";
import { importHar, isHar } from "./har";
import { importInsomniaV4, importInsomniaV5, isInsomniaV4, isInsomniaV5 } from "./insomnia";
import { ImportError, type ImportResult } from "./model";
import { importOpenCollectionEnvironment, isOpenCollectionEnvironment } from "./opencollection";
import { importPostmanCollection, importPostmanEnvironment, isPostmanCollection, isPostmanEnvironment } from "./postman";
import { isObject } from "./util";

/** Detects the format of a pasted or chosen file and converts it. */
export function importText(text: string, fileName = ""): ImportResult {
	const name = fileName.toLowerCase();
	const trimmed = text.trim();
	if (!trimmed) throw new ImportError("There is nothing to import.");

	if (isCurl(trimmed)) return importCurl(trimmed);
	if (name.endsWith(".bru")) return importBruFile(text, fileName);
	if (name.endsWith(".http") || name.endsWith(".rest")) return importHttpFile(text, fileName);
	if (name.endsWith("http-client.env.json")) return importHttpClientEnv(parseJson(text), false);
	if (name.endsWith("http-client.private.env.json")) return importHttpClientEnv(parseJson(text), true);

	const data = parseStructured(trimmed);
	if (data !== undefined) {
		if (isHar(data)) return importHar(data);
		if (isPostmanCollection(data)) return importPostmanCollection(data);
		if (isPostmanEnvironment(data)) return importPostmanEnvironment(data);
		if (isInsomniaV4(data)) return importInsomniaV4(data);
		if (isInsomniaV5(data)) return importInsomniaV5(data);
		if (isHttpie(data)) return importHttpie(data);
		// Checked before Hoppscotch, whose environments share the {name, variables} shape.
		if (isOpenCollectionEnvironment(data)) return importOpenCollectionEnvironment(data, fileName);
		if (isHoppscotchCollection(data)) return importHoppscotchCollection(parseStructured(convertHoppscotchVariables(trimmed)));
		if (isHoppscotchEnvironment(data)) return importHoppscotchEnvironment(parseStructured(convertHoppscotchVariables(trimmed)));
		if (isObject(data) && "opencollection" in data) {
			throw new ImportError("This is an OpenCollection file. Copy the collection folder into your vault instead, or use “Import folder”.");
		}
	}
	if (looksLikeHttpFile(trimmed)) return importHttpFile(text, fileName);
	throw new ImportError("Unrecognised format. Supported: Postman, Insomnia, Bruno, Hoppscotch, HTTPie, HAR, cURL and .http files.");
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new ImportError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** JSON first; YAML only for text that isn't JSON (Insomnia v5 exports are YAML). */
function parseStructured(text: string): unknown {
	if (/^[[{]/.test(text)) {
		try {
			return JSON.parse(text);
		} catch {
			return undefined;
		}
	}
	try {
		const data: unknown = parseYaml(text);
		return typeof data === "object" ? data : undefined;
	} catch {
		return undefined;
	}
}
