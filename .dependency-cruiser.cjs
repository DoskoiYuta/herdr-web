/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "web-only-contract",
      comment: "src/web は src/contract 以外のサーバーコードを import しない",
      severity: "error",
      from: { path: "^src/web" },
      to: { path: "^src/(server|cli)" },
    },
    {
      name: "cli-only-contract",
      comment: "src/cli は src/contract 以外を import しない",
      severity: "error",
      from: { path: "^src/cli" },
      to: { path: "^src/(server|web)" },
    },
    {
      name: "contract-is-leaf",
      comment: "src/contract は他の src を import しない",
      severity: "error",
      from: { path: "^src/contract" },
      to: { path: "^src/(server|web|cli)" },
    },
    {
      name: "review-domain-pure",
      comment: "review/domain は contract 以外を import しない",
      severity: "error",
      from: { path: "^src/server/review/domain" },
      to: { path: "^src/", pathNot: "^src/(contract|server/review/domain)" },
    },
    {
      name: "review-ports-pure",
      severity: "error",
      from: { path: "^src/server/review/ports" },
      to: { path: "^src/", pathNot: "^src/(contract|server/review/(domain|ports))" },
    },
    {
      name: "review-usecases-no-adapters",
      comment: "usecases は adapters と他モジュールの実装を import しない",
      severity: "error",
      from: { path: "^src/server/review/usecases" },
      to: { path: "^src/", pathNot: "^src/(contract|server/review/(domain|ports|usecases))" },
    },
    {
      name: "review-adapters-no-usecases",
      severity: "error",
      from: { path: "^src/server/review/adapters" },
      to: { path: "^src/server/review/usecases" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.server.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
