/** Back-compat shim: session discovery now lives in ./sources (one module per agent). */
export { codexHome, piHome, hermesHome, discoverSessionRoots, walkFiles, listFiles, describeRoot, sourceFor, SOURCES, userHomes } from "./sources";
export type { SessionRoot, DiscoverOptions } from "./sources";
