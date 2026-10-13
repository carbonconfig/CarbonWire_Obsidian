export type { OpenCollection } from "@opencollection/types";
export type { Folder } from "@opencollection/types/collection/item";
export type {
	HttpRequest,
	HttpRequestBody,
	HttpRequestBodyVariant,
	HttpRequestDetails,
	HttpRequestHeader,
	HttpRequestParam,
	HttpRequestSettings,
	HttpRequestExample,
	MultipartFormEntry,
} from "@opencollection/types/requests/http";
export type { Auth } from "@opencollection/types/common/auth";
export type { Variable, SecretVariable } from "@opencollection/types/common/variables";
export type { RequestDefaults } from "@opencollection/types/common/request-defaults";
export type { Environment } from "@opencollection/types/config/environments";

import type { RequestDefaults } from "@opencollection/types/common/request-defaults";

/** Collection root defaults followed by each enclosing folder's defaults, outermost first. */
export type DefaultsChain = readonly (RequestDefaults | undefined)[];

export type Header = readonly [name: string, value: string];
