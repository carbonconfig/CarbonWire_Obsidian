import { ImportError, type ImportResult } from "./model";
import { isObject, objects, str, type Json } from "./util";

/** An OpenCollection (Bruno YAML / CarbonWire) environment file: variables carry `name`, not `key`. */
export function isOpenCollectionEnvironment(data: unknown): data is Json {
	if (!isObject(data) || !Array.isArray(data.variables) || "requests" in data || "values" in data) return false;
	const vars = objects(data.variables);
	return vars.length === 0 ? typeof data.name === "string" : vars.every((v) => typeof v.name === "string" && !("key" in v));
}

export function importOpenCollectionEnvironment(data: unknown, fileName = ""): ImportResult {
	if (!isOpenCollectionEnvironment(data)) throw new ImportError("Not an OpenCollection environment.");
	const fallback = fileName.replace(/^.*\//, "").replace(/\.ya?ml$/i, "") || "Environment";
	return {
		format: "OpenCollection environment",
		collections: [],
		environments: [{
			name: str(data.name) || fallback,
			variables: objects(data.variables).map((v) => ({
				name: str(v.name),
				value: typeof v.value === "string" ? v.value : isObject(v.value) ? str(v.value.data) : "",
				...(v.disabled === true ? { disabled: true } : {}),
				...(v.secret === true ? { secret: true } : {}),
			})),
		}],
		warnings: objects(data.variables).some((v) => v.secret === true) ? ["Secret values aren't stored in environment files; fill them in after importing."] : [],
	};
}
