// build:web が生成する埋め込みアセットのモジュール。生成前でも typecheck が通るように宣言しておく。
declare module "./web-assets.generated" {
  export const webAssets: Record<string, string>;
}
