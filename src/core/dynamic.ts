/*
 * Postman's dynamic variables ({{$randomEmail}} and the rest), with values of the same shape as
 * Postman's. The word lists are short; only the shape matters.
 */

const FIRST = ["Ava", "Liam", "Maya", "Noah", "Iris", "Omar", "Lena", "Ezra", "Nora", "Felix", "Zara", "Hugo", "Priya", "Mateo", "Elena", "Kai", "Sofia", "Arjun", "Chloe", "Tomas"];
const LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Silva", "Novak", "Hughes", "Patel", "Rossi", "Schmidt", "Kowalski", "Nguyen", "Haddad", "Fischer", "Mendes", "Larsen", "Brennan", "Kim"];
const PREFIX = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr."];
const SUFFIX = ["Jr.", "Sr.", "I", "II", "III", "IV", "V", "MD", "DDS", "PhD", "DVM"];
const JOB_AREA = ["Solutions", "Program", "Brand", "Security", "Research", "Marketing", "Directives", "Implementation", "Integration", "Functionality", "Response", "Paradigm", "Tactics", "Identity", "Markets", "Group", "Division", "Applications", "Optimization", "Operations", "Infrastructure", "Intranet", "Communications", "Web", "Branding", "Quality", "Assurance", "Mobility", "Accounts", "Data", "Creative", "Configuration", "Interactions", "Factors", "Usability", "Metrics"];
const JOB_DESCRIPTOR = ["Lead", "Senior", "Direct", "Corporate", "Dynamic", "Future", "Product", "National", "Regional", "District", "Central", "Global", "Customer", "Investor", "Internal", "International", "Forward", "Legacy", "Chief", "Principal"];
const JOB_TYPE = ["Supervisor", "Associate", "Executive", "Liaison", "Officer", "Manager", "Engineer", "Specialist", "Director", "Coordinator", "Administrator", "Architect", "Analyst", "Designer", "Planner", "Orchestrator", "Technician", "Developer", "Producer", "Consultant", "Assistant", "Facilitator", "Agent", "Representative", "Strategist"];
const CITY = ["Port Ellis", "North Kailee", "Lake Marisol", "East Bramford", "New Corrin", "West Dalby", "South Tamsin", "Fort Ardley", "Ravenmoor", "Kesterton", "Millbrook", "Ashcombe"];
const STREET = ["Maple", "Harbor", "Willow", "Station", "Orchard", "Bridge", "Chapel", "Meadow", "Quarry", "Elm", "Granite", "Lantern"];
const STREET_SUFFIX = ["Street", "Avenue", "Road", "Lane", "Way", "Court", "Drive", "Place", "Terrace", "Row"];
const COUNTRY = ["Portugal", "Kenya", "Canada", "Japan", "Norway", "Chile", "India", "Ghana", "Poland", "New Zealand", "Morocco", "Vietnam", "Ireland", "Peru", "Estonia", "Brazil"];
const COLOR = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "violet", "magenta", "cyan", "lime", "maroon", "olive", "navy", "purple", "silver", "salmon", "orchid", "plum", "tan"];
const ABBREVIATION = ["SQL", "PCI", "JSON", "XML", "HTTP", "SMTP", "SAS", "RAM", "ADP", "AGP", "EXE", "FTP", "GB", "HDD", "SSL", "TCP", "SCSI", "USB", "CSS", "SMS", "THX", "AI", "IB", "RSS", "SDD"];
const LOCALE = ["en", "de", "fr", "es", "it", "pt", "nl", "sv", "pl", "cs", "ja", "ko", "zh", "ru", "tr", "sr"];
const USER_AGENT = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"];
const ACCOUNT_NAME = ["Checking Account", "Savings Account", "Money Market Account", "Investment Account", "Home Loan Account", "Credit Card Account", "Auto Loan Account", "Personal Loan Account"];
const TRANSACTION = ["deposit", "withdrawal", "payment", "invoice"];
const COMPANY_SUFFIX = ["Inc", "and Sons", "LLC", "Group"];
const BS_ADJECTIVE = ["clicks-and-mortar", "value-added", "vertical", "proactive", "robust", "revolutionary", "scalable", "leading-edge", "innovative", "intuitive", "strategic", "e-business", "mission-critical", "sticky", "one-to-one", "24/7", "end-to-end", "global", "B2B", "granular", "frictionless", "virtual", "viral", "dynamic", "best-of-breed", "killer"];
const BS_BUZZ = ["synergize", "strategize", "empower", "leverage", "embrace", "enable", "orchestrate", "transition", "streamline", "exploit", "evolve", "transform", "incentivize", "deliver", "harness", "integrate", "monetize", "scale", "unleash", "visualize", "aggregate", "engage"];
const BS_NOUN = ["synergies", "paradigms", "markets", "partnerships", "infrastructures", "platforms", "initiatives", "channels", "eyeballs", "communities", "solutions", "e-tailers", "action-items", "portals", "niches", "technologies", "content", "supply-chains", "convergence", "relationships", "architectures", "interfaces", "e-markets", "schemas", "metrics", "deliverables", "users", "experiences", "web services", "methodologies"];
const CATCH_ADJECTIVE = ["Adaptive", "Advanced", "Automated", "Balanced", "Centralized", "Cloned", "Configurable", "Cross-platform", "Customizable", "Decentralized", "Diverse", "Enhanced", "Ergonomic", "Exclusive", "Expanded", "Extended", "Fully-configurable", "Future-proofed", "Grass-roots", "Horizontal", "Integrated", "Intuitive", "Inverse", "Managed", "Multi-layered", "Networked", "Open-source", "Optimized", "Organic", "Persistent", "Polarised", "Profound", "Programmable", "Progressive", "Re-engineered", "Reactive", "Realigned", "Reduced", "Robust", "Secured", "Seamless", "Streamlined", "Synchronised", "Total", "Universal", "Upgradable", "User-centric", "Versatile", "Virtual", "Visionary"];
const CATCH_DESCRIPTOR = ["24 hour", "24/7", "3rd generation", "4th generation", "actuating", "analyzing", "asymmetric", "asynchronous", "bandwidth-monitored", "bi-directional", "bifurcated", "client-driven", "client-server", "coherent", "contextually-based", "dedicated", "demand-driven", "didactic", "directional", "discrete", "disintermediate", "dynamic", "eco-centric", "exuding", "fault-tolerant", "fresh-thinking", "full-range", "global", "heuristic", "high-level", "holistic", "homogeneous", "hybrid", "impactful", "incremental", "interactive", "local", "logistical", "maximized", "methodical", "mission-critical", "mobile", "modular", "motivating", "multi-tasking", "national", "needs-based", "neutral", "next generation", "non-volatile", "object-oriented", "optimal", "optimizing", "radical", "real-time", "reciprocal", "regional", "responsive", "scalable", "secondary", "solution-oriented", "stable", "static", "systematic", "systemic", "tangible", "tertiary", "transitional", "uniform", "upward-trending", "user-facing", "value-added", "web-enabled", "well-modulated", "zero administration", "zero defect", "zero tolerance"];
const CATCH_NOUN = ["ability", "access", "adapter", "algorithm", "alliance", "analyzer", "application", "approach", "architecture", "archive", "array", "attitude", "benchmark", "capability", "challenge", "circuit", "collaboration", "complexity", "concept", "conglomeration", "contingency", "core", "customer loyalty", "database", "data-warehouse", "definition", "emulation", "encoding", "encryption", "extranet", "firmware", "flexibility", "focus group", "forecast", "frame", "framework", "function", "functionalities", "groupware", "hardware", "help-desk", "hierarchy", "hub", "implementation", "info-mediaries", "infrastructure", "initiative", "installation", "instruction set", "interface", "internet solution", "intranet", "knowledge user", "knowledge base", "local area network", "leverage", "matrices", "matrix", "methodology", "middleware", "migration", "model", "moderator", "monitoring", "moratorium", "neural-net", "open architecture", "orchestration", "paradigm", "parallelism", "policy", "portal", "pricing structure", "process improvement", "product", "productivity", "project", "projection", "protocol", "secured line", "service-desk", "software", "solution", "standardization", "strategy", "structure", "success", "superstructure", "support", "synergy", "system engine", "task-force", "throughput", "time-frame", "toolset", "utilisation", "website", "workforce"];
const DB_COLUMN = ["id", "title", "name", "email", "phone", "token", "group", "category", "password", "comment", "avatar", "status", "createdAt", "updatedAt"];
const DB_TYPE = ["int", "varchar", "text", "date", "datetime", "tinyint", "time", "timestamp", "smallint", "mediumint", "bigint", "decimal", "float", "double", "real", "bit", "boolean", "serial", "blob", "binary", "enum", "set", "geometry", "point"];
const DB_COLLATION = ["utf8_unicode_ci", "utf8_general_ci", "utf8_bin", "ascii_bin", "ascii_general_ci", "cp1250_bin", "cp1250_general_ci"];
const DB_ENGINE = ["InnoDB", "MyISAM", "MEMORY", "CSV", "BLACKHOLE", "ARCHIVE"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOMAIN_SUFFIX = ["com", "net", "org", "info", "biz", "name", "io", "dev"];
const FREE_EMAIL = ["gmail.com", "yahoo.com", "hotmail.com"];
const FILE_TYPE = ["application", "audio", "font", "image", "message", "model", "multipart", "text", "video"];
const DIRECTORY = ["/usr/bin", "/usr/local/lib", "/var/log", "/etc", "/home/user/dir", "/opt/share", "/srv", "/tmp", "/Library", "/Users/shared"];
const PRODUCT = ["Chair", "Car", "Computer", "Keyboard", "Mouse", "Bike", "Ball", "Gloves", "Pants", "Shirt", "Table", "Shoes", "Hat", "Towels", "Soap", "Tuna", "Chicken", "Fish", "Cheese", "Bacon", "Pizza", "Salad", "Sausages", "Chips"];
const PRODUCT_ADJECTIVE = ["Small", "Ergonomic", "Rustic", "Intelligent", "Gorgeous", "Incredible", "Fantastic", "Practical", "Sleek", "Awesome", "Generic", "Handcrafted", "Handmade", "Licensed", "Refined", "Unbranded", "Tasty"];
const PRODUCT_MATERIAL = ["Steel", "Wooden", "Concrete", "Plastic", "Cotton", "Granite", "Rubber", "Metal", "Soft", "Fresh", "Frozen"];
const DEPARTMENT = ["Books", "Movies", "Music", "Games", "Electronics", "Computers", "Home", "Garden", "Tools", "Grocery", "Health", "Beauty", "Toys", "Kids", "Baby", "Clothing", "Shoes", "Jewelery", "Sports", "Outdoors", "Automotive", "Industrial"];
const NOUN = ["driver", "protocol", "bandwidth", "panel", "microchip", "program", "port", "card", "array", "interface", "system", "sensor", "firewall", "hard drive", "pixel", "alarm", "feed", "monitor", "application", "transmitter", "bus", "circuit", "capacitor", "matrix"];
const VERB = ["back up", "bypass", "hack", "override", "compress", "copy", "navigate", "index", "connect", "generate", "quantify", "calculate", "synthesize", "input", "transmit", "program", "reboot", "parse"];
const INGVERB = ["backing up", "bypassing", "hacking", "overriding", "compressing", "copying", "navigating", "indexing", "connecting", "generating", "quantifying", "calculating", "synthesizing", "transmitting", "programming", "parsing"];
const ADJECTIVE = ["auxiliary", "primary", "back-end", "digital", "open-source", "virtual", "cross-platform", "redundant", "online", "haptic", "multi-byte", "bluetooth", "wireless", "1080p", "neural", "optical", "solid state", "mobile"];
const LOREM = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipisci", "velit", "sed", "quia", "non", "numquam", "eius", "modi", "tempora", "incidunt", "ut", "labore", "et", "dolore", "magnam", "aliquam", "quaerat", "voluptatem", "enim", "ad", "minima", "veniam", "quis", "nostrum", "exercitationem", "ullam", "corporis", "suscipit", "laboriosam", "nisi", "aliquid", "ex", "ea", "commodi", "consequatur", "autem", "vel", "eum", "iure", "reprehenderit", "qui", "in", "voluptate", "esse", "quam", "nihil", "molestiae", "illum", "fugiat", "quo", "voluptas", "nulla", "pariatur", "aperiam", "eos", "accusamus"];
const IMAGE_CATEGORY: Record<string, string> = {
	$randomAbstractImage: "abstract",
	$randomAnimalsImage: "animals",
	$randomBusinessImage: "business",
	$randomCatsImage: "cats",
	$randomCityImage: "city",
	$randomFoodImage: "food",
	$randomNightlifeImage: "nightlife",
	$randomFashionImage: "fashion",
	$randomPeopleImage: "people",
	$randomNatureImage: "nature",
	$randomSportsImage: "sports",
	$randomTransportImage: "transport",
	$randomImageUrl: "",
};
const CURRENCY: readonly (readonly [code: string, name: string, symbol: string])[] = [
	["USD", "US Dollar", "$"],
	["EUR", "Euro", "€"],
	["GBP", "Pound Sterling", "£"],
	["JPY", "Yen", "¥"],
	["INR", "Indian Rupee", "₹"],
	["CHF", "Swiss Franc", "CHF"],
	["NOK", "Norwegian Krone", "kr"],
	["BRL", "Brazilian Real", "R$"],
	["KRW", "Won", "₩"],
	["PLN", "Zloty", "zł"],
];
const MIME: readonly (readonly [type: string, ext: string])[] = [
	["application/json", "json"],
	["application/pdf", "pdf"],
	["application/zip", "zip"],
	["application/xml", "xml"],
	["audio/mpeg", "mp3"],
	["audio/wav", "wav"],
	["image/png", "png"],
	["image/jpeg", "jpeg"],
	["image/gif", "gif"],
	["text/html", "html"],
	["text/csv", "csv"],
	["text/plain", "txt"],
	["video/mp4", "mp4"],
	["video/webm", "webm"],
];
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const ALNUM_MIXED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const below = (n: number) => Math.floor(Math.random() * n);
const between = (low: number, high: number) => low + below(high - low + 1);
const pick = <T>(list: readonly T[]): T => list[below(list.length)]!;
const chars = (set: string, length: number) => Array.from({ length }, () => set[below(set.length)]).join("");
const digits = (length: number) => chars("0123456789", length);
const hex = (n: number, width = 0) => n.toString(16).padStart(width, "0");
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const times = (n: number, make: () => string) => Array.from({ length: n }, make);
const nowSeconds = () => Math.floor(Date.now() / 1000);

const loremWords = (n: number) => times(n, () => pick(LOREM)).join(" ");
const loremSentence = () => `${capitalize(loremWords(between(3, 10)))}.`;
const loremSentences = (n: number) => times(n, loremSentence).join(" ");
const domainWord = () => pick(FIRST).toLowerCase();
const fileStem = () => times(between(1, 3), () => pick(NOUN).replace(/ /g, "_")).join("_");

function userName(): string {
	const first = pick(FIRST);
	const last = pick(LAST);
	switch (below(3)) {
		case 0:
			return `${first}${below(100)}`;
		case 1:
			return `${first}.${last}`;
		default:
			return `${first}_${last}${below(100)}`;
	}
}

/** JavaScript's Date#toString in UTC: "Tue Mar 17 2026 13:11:50 GMT+0000 (Coordinated Universal Time)". */
export function jsDate(seconds: number): string {
	const d = new Date(seconds * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
	return `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${time} GMT+0000 (Coordinated Universal Time)`;
}

const GENERATORS: Record<string, () => string> = {
	$guid: () => crypto.randomUUID(),
	$uuid: () => crypto.randomUUID(),
	$randomUUID: () => crypto.randomUUID(),
	$timestamp: () => String(nowSeconds()),
	$isoTimestamp: () => new Date().toISOString(),
	$randomInt: () => String(below(1001)),
	$randomAlphaNumeric: () => chars(ALNUM, 1),
	$randomBoolean: () => String(below(2) === 1),
	$randomColor: () => pick(COLOR),
	$randomHexColor: () => `#${hex(below(0x1000000), 6)}`,
	$randomAbbreviation: () => pick(ABBREVIATION),
	$randomIP: () => times(4, () => String(below(256))).join("."),
	$randomIPV6: () => times(8, () => hex(below(0x10000))).join(":"),
	$randomMACAddress: () => times(6, () => hex(below(256), 2)).join(":"),
	$randomPassword: () => chars(ALNUM_MIXED, 15),
	$randomLocale: () => pick(LOCALE),
	$randomUserAgent: () => pick(USER_AGENT),
	$randomProtocol: () => pick(["http", "https"]),
	$randomSemver: () => `${below(10)}.${below(10)}.${below(10)}`,
	$randomFirstName: () => pick(FIRST),
	$randomLastName: () => pick(LAST),
	$randomFullName: () => `${pick(FIRST)} ${pick(LAST)}`,
	$randomNamePrefix: () => pick(PREFIX),
	$randomNameSuffix: () => pick(SUFFIX),
	$randomJobArea: () => pick(JOB_AREA),
	$randomJobDescriptor: () => pick(JOB_DESCRIPTOR),
	$randomJobTitle: () => `${pick(JOB_DESCRIPTOR)} ${pick(JOB_AREA)} ${pick(JOB_TYPE)}`,
	$randomJobType: () => pick(JOB_TYPE),
	$randomPhoneNumber: () => `${digits(3)}-${digits(3)}-${digits(4)}`,
	$randomPhoneNumberExt: () => `${digits(2)}-${digits(3)}-${digits(3)}-${digits(4)}`,
	$randomCity: () => pick(CITY),
	$randomStreetName: () => `${pick(STREET)} ${pick(STREET_SUFFIX)}`,
	$randomStreetAddress: () => `${between(1, 9999)} ${pick(STREET)} ${pick(STREET_SUFFIX)}`,
	$randomCountry: () => pick(COUNTRY),
	$randomCountryCode: () => chars(UPPER, 2),
	$randomLatitude: () => (below(1_800_001) / 10_000 - 90).toFixed(4),
	$randomLongitude: () => (below(3_600_001) / 10_000 - 180).toFixed(4),
	$randomAvatarImage: () => `https://cloudflare-ipfs.com/ipfs/Qmd3W5DuhgHirLHGVixi6V76LhCkZUz6pnFt5AJBiyvHye/avatar/${below(1250)}.jpg`,
	$randomImageDataUri: () =>
		`data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22480%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23${hex(below(0x1000000), 6)}%22%2F%3E%3C%2Fsvg%3E`,
	$randomBankAccount: () => digits(8),
	$randomBankAccountName: () => pick(ACCOUNT_NAME),
	$randomCreditCardMask: () => digits(4),
	$randomBankAccountBic: () => `${chars(UPPER, 4)}${chars(UPPER, 2)}${chars(UPPER + "0123456789", 2)}`,
	$randomBankAccountIban: () => `${chars(UPPER, 2)}${digits(2)}${chars(UPPER, 4)}${digits(18)}`,
	$randomTransactionType: () => pick(TRANSACTION),
	$randomCurrencyCode: () => pick(CURRENCY)[0],
	$randomCurrencyName: () => pick(CURRENCY)[1],
	$randomCurrencySymbol: () => pick(CURRENCY)[2],
	$randomBitcoin: () => pick(["1", "3"]) + chars("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", between(25, 33)),
	$randomCompanyName: () => [() => `${pick(LAST)} ${pick(COMPANY_SUFFIX)}`, () => `${pick(LAST)} - ${pick(LAST)}`, () => `${pick(LAST)}, ${pick(LAST)} and ${pick(LAST)}`][below(3)]!(),
	$randomCompanySuffix: () => pick(COMPANY_SUFFIX),
	$randomBs: () => `${pick(BS_BUZZ)} ${pick(BS_ADJECTIVE)} ${pick(BS_NOUN)}`,
	$randomBsAdjective: () => pick(BS_ADJECTIVE),
	$randomBsBuzz: () => pick(BS_BUZZ),
	$randomBsNoun: () => pick(BS_NOUN),
	$randomCatchPhrase: () => `${pick(CATCH_ADJECTIVE)} ${pick(CATCH_DESCRIPTOR)} ${pick(CATCH_NOUN)}`,
	$randomCatchPhraseAdjective: () => pick(CATCH_ADJECTIVE),
	$randomCatchPhraseDescriptor: () => pick(CATCH_DESCRIPTOR),
	$randomCatchPhraseNoun: () => pick(CATCH_NOUN),
	$randomDatabaseColumn: () => pick(DB_COLUMN),
	$randomDatabaseType: () => pick(DB_TYPE),
	$randomDatabaseCollation: () => pick(DB_COLLATION),
	$randomDatabaseEngine: () => pick(DB_ENGINE),
	// A year ahead or behind, or within the last day, as Postman's are.
	$randomDateFuture: () => jsDate(nowSeconds() + between(1, 365 * 86_400)),
	$randomDatePast: () => jsDate(nowSeconds() - between(1, 365 * 86_400)),
	$randomDateRecent: () => jsDate(nowSeconds() - between(1, 86_400)),
	$randomWeekday: () => pick(WEEKDAY_LONG),
	$randomMonth: () => pick(MONTH_LONG),
	$randomDomainName: () => `${domainWord()}.${pick(DOMAIN_SUFFIX)}`,
	$randomDomainSuffix: () => pick(DOMAIN_SUFFIX),
	$randomDomainWord: domainWord,
	$randomEmail: () => `${userName()}@${pick(FREE_EMAIL)}`,
	$randomExampleEmail: () => `${userName()}@example.${pick(["com", "net", "org"])}`,
	$randomUserName: userName,
	$randomUrl: () => `${pick(["http", "https"])}://${domainWord()}.${pick(DOMAIN_SUFFIX)}`,
	$randomFileName: () => `${fileStem()}.${pick(MIME)[1]}`,
	$randomFileType: () => pick(FILE_TYPE),
	$randomFileExt: () => pick(MIME)[1],
	$randomCommonFileName: () => `${fileStem()}.${pick(MIME)[1]}`,
	$randomCommonFileType: () => pick(FILE_TYPE),
	$randomCommonFileExt: () => pick(MIME)[1],
	$randomFilePath: () => `${pick(DIRECTORY)}/${fileStem()}.${pick(MIME)[1]}`,
	$randomDirectoryPath: () => pick(DIRECTORY),
	$randomMimeType: () => pick(MIME)[0],
	$randomPrice: () => `${between(1, 999)}.${String(below(100)).padStart(2, "0")}`,
	$randomProduct: () => pick(PRODUCT),
	$randomProductAdjective: () => pick(PRODUCT_ADJECTIVE),
	$randomProductMaterial: () => pick(PRODUCT_MATERIAL),
	$randomProductName: () => `${pick(PRODUCT_ADJECTIVE)} ${pick(PRODUCT_MATERIAL)} ${pick(PRODUCT)}`,
	$randomDepartment: () => pick(DEPARTMENT),
	$randomNoun: () => pick(NOUN),
	$randomVerb: () => pick(VERB),
	$randomIngverb: () => pick(INGVERB),
	$randomAdjective: () => pick(ADJECTIVE),
	$randomWord: () => pick([pick(NOUN), pick(VERB), pick(ADJECTIVE)]),
	$randomWords: () => times(between(2, 4), () => pick([pick(NOUN), pick(ADJECTIVE), pick(VERB)])).join(" "),
	$randomPhrase: () => `If we ${pick(VERB)} the ${pick(NOUN)}, we can get to the ${pick(ADJECTIVE)} ${pick(NOUN)} through the ${pick(ADJECTIVE)} ${pick(NOUN)}!`,
	$randomLoremWord: () => pick(LOREM),
	$randomLoremWords: () => loremWords(3),
	$randomLoremSentence: loremSentence,
	$randomLoremSentences: () => loremSentences(between(2, 6)),
	$randomLoremParagraph: () => loremSentences(3),
	$randomLoremParagraphs: () => times(3, () => loremSentences(3)).join("\n \r"),
	$randomLoremText: () => loremSentences(between(2, 6)),
	$randomLoremSlug: () => loremWords(3).replace(/ /g, "-"),
	$randomLoremLines: () => times(between(1, 5), loremSentence).join("\n"),
};

for (const [name, category] of Object.entries(IMAGE_CATEGORY)) {
	GENERATORS[name] = () => (category ? `http://placeimg.com/640/480/${category}` : "http://placeimg.com/640/480");
}

/** Every dynamic variable, for completion and highlighting. */
export const DYNAMIC_NAMES: readonly string[] = Object.keys(GENERATORS);

export function dynamicValue(name: string): string | undefined {
	return Object.hasOwn(GENERATORS, name) ? GENERATORS[name]!() : undefined;
}

export function isDynamicVariable(name: string): boolean {
	return Object.hasOwn(GENERATORS, name);
}
