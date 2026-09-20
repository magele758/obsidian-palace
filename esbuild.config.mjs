import path from "path";
import { fileURLToPath } from "url";
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";
const root = path.dirname(fileURLToPath(import.meta.url));

const nodeExternals = builtins.filter((name) => name !== "crypto");

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    alias: {
      "node:crypto": path.resolve(root, "src/agent/loop/crypto-shim.ts"),
    },
    plugins: [
      {
        name: "stub-unused-node",
        setup(build) {
          build.onResolve({ filter: /^node:(sqlite|fs|path|vm|async_hooks|os|fs\/promises)$/ }, (args) => ({
            path: args.path,
            namespace: "node-stub",
          }));
          build.onResolve({ filter: /(full-host|normal-host|max-host|file-compensation|event-log-sqlite|isolate)(\.js)?$/ }, () => ({
            path: "unused-preset",
            namespace: "node-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
            contents: "export default {};",
            loader: "js",
          }));
        },
      },
    ],
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...nodeExternals,
    ],
    banner: {
      js: 'typeof process>"u"&&(globalThis.process={env:{}});',
    },
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    minify: prod,
  })
  .catch(() => process.exit(1));
