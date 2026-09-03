// @ts-nocheck
// build:web が生成する web-assets.generated.ts の薄いラッパー。生成前でも typecheck を通すため nocheck。
export { webAssets } from "./web-assets.generated";
export type WebAssets = Record<string, string>;
