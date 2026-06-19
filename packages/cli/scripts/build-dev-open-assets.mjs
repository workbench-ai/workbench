import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(packageRoot, "dist", "dev-open");
const fontOutdir = path.join(outdir, "fonts");
const workspaceSourceAliases = new Map([
  ["@workbench-ai/workbench-contract", path.resolve(packageRoot, "..", "contract", "src", "index.ts")],
]);

await fs.rm(outdir, { force: true, recursive: true });
await fs.mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(packageRoot, "src", "dev-open-client.tsx")],
  outfile: path.join(outdir, "client.js"),
  bundle: true,
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
  format: "esm",
  legalComments: "none",
  minify: true,
  platform: "browser",
  plugins: [workspaceSourceAliasPlugin()],
  target: ["es2022"],
  jsx: "automatic",
  logLevel: "silent",
});

const cssInputPath = path.resolve(packageRoot, "..", "workbench-ui", "src", "styles.css");
const css = await fs.readFile(cssInputPath, "utf8");
const result = await postcss([tailwindcss({ base: path.dirname(cssInputPath) })]).process(css, {
  from: cssInputPath,
  to: path.join(outdir, "client.css"),
});
await fs.writeFile(path.join(outdir, "client.css"), await copyStylesheetAssets({
  css: result.css,
  fromDir: path.dirname(cssInputPath),
  toDir: fontOutdir,
}));

async function copyStylesheetAssets({ css, fromDir, toDir }) {
  const refs = new Map();
  for (const match of css.matchAll(/url\((["']?)(?!data:|https?:|\/)([^"')]+)\1\)/gu)) {
    const rawUrl = match[2];
    const sourcePath = path.resolve(fromDir, rawUrl);
    const fileName = path.basename(rawUrl);
    if (!new Set([".woff", ".woff2"]).has(path.extname(fileName))) {
      throw new Error(`Unsupported Workbench dev stylesheet asset: ${rawUrl}`);
    }
    refs.set(rawUrl, {
      sourcePath,
      publicUrl: `./fonts/${fileName}`,
    });
  }
  if (refs.size === 0) {
    return css;
  }
  await fs.mkdir(toDir, { recursive: true });
  for (const asset of refs.values()) {
    await fs.copyFile(asset.sourcePath, path.join(toDir, path.basename(asset.publicUrl)));
  }
  let rewritten = css;
  for (const [rawUrl, asset] of refs) {
    rewritten = rewritten.replaceAll(rawUrl, asset.publicUrl);
  }
  return rewritten;
}

function workspaceSourceAliasPlugin() {
  return {
    name: "workbench-workspace-source-alias",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@workbench-ai\/workbench-contract$/ }, (args) => ({
        path: workspaceSourceAliases.get(args.path),
      }));
    },
  };
}
