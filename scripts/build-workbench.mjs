import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
await fs.mkdir(path.join(root, "assets/vendor"), { recursive: true });
const browser = await build({
  absWorkingDir: root,
  entryPoints: ["src/workbench-engines.js"],
  outfile: "assets/vendor/workbench-engines.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome140",
  minify: true,
  legalComments: "eof",
  metafile: true,
});
const inputs = new Set(Object.keys(browser.metafile.inputs));
// Keep the same pinned physics implementation in the app and self-contained HTML.
const matter=await fs.readFile(path.join(root,'node_modules/matter-js/build/matter.min.js'),'utf8');
const matterLicense=(await fs.readFile(path.join(root,'node_modules/matter-js/LICENSE'),'utf8')).replace(/\*\//g,'* /');
const matterPackage=JSON.parse(await fs.readFile(path.join(root,'node_modules/matter-js/package.json'),'utf8'));
if(matterPackage.version!=='0.20.0')throw Error('Unexpected scene physics version');
await fs.writeFile(path.join(root,'src/scene-vendor.js'),`/** Generated from matter-js 0.20.0 (MIT); use npm run build:workbench. */\nexport function installScenePhysics(root={}) {\n/* ${matterLicense}\n*/\nconst module={exports:{}};const exports=module.exports;\n${matter}\nroot.VividlyPhysics=module.exports;return module.exports;\n}\n`);
inputs.add('node_modules/matter-js/build/matter.min.js');
const cssParser=await build({absWorkingDir:root,entryPoints:['node_modules/css-tree/lib/index.js'],outfile:'assets/vendor/css-tree.js',bundle:true,format:'esm',platform:'browser',target:'chrome140',minify:true,legalComments:'eof',metafile:true});
for(const input of Object.keys(cssParser.metafile.inputs))inputs.add(input);
try {
  await fs.access(path.join(root, 'src/rich-text-engine.js'));
  const rich = await build({absWorkingDir:root,entryPoints:['src/rich-text-engine.js'],outfile:'assets/vendor/rich-text-engine.js',bundle:true,format:'esm',platform:'browser',target:'chrome140',minify:true,legalComments:'eof',metafile:true});
  for(const input of Object.keys(rich.metafile.inputs))inputs.add(input);
}catch(error){if(error.code!=='ENOENT')throw error;}
try {
  await fs.access(path.join(root, "desktop/mcp-adapter.mjs"));
  const adapter = await build({
    absWorkingDir: root,
    entryPoints: ["desktop/mcp-adapter.mjs"],
    outfile: "desktop/mcp-adapter.bundle.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node24",
    minify: true,
    legalComments: "eof",
    metafile: true,
  });
  for (const input of Object.keys(adapter.metafile.inputs)) inputs.add(input);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const bundled = new Set();
for (const input of inputs) {
  const parts = input.replaceAll("\\", "/").split("/");
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) continue;
  bundled.add(
    parts[at + 1].startsWith("@")
      ? parts.slice(at + 1, at + 3).join("/")
      : parts[at + 1],
  );
}
const notices = [],
  versions = [];
for (const name of [...bundled].sort()) {
  const folder = path.join(root, "node_modules", name),
    pkg = JSON.parse(
      await fs.readFile(path.join(folder, "package.json"), "utf8"),
    );
  let license = "";
  for (const entry of await fs.readdir(folder))
    if (/^(?:license|copying)(?:\..*)?$/i.test(entry)) {
      try {
        license += (await fs.readFile(path.join(folder, entry), "utf8")) + "\n";
      } catch {}
    }
  notices.push(`${name} ${pkg.version}\n${license || String(pkg.license)}\n`);
  versions.push({ name, version: pkg.version, license: pkg.license });
}
await fs.writeFile(
  path.join(root, "assets/vendor/THIRD-PARTY-NOTICES.txt"),
  notices.join("\n----------------\n\n"),
);
await fs.writeFile(
  path.join(root, "assets/vendor/dependencies.json"),
  JSON.stringify(versions, null, 2) + "\n",
);
console.log("Built local workbench engines and available MCP adapter");
// Refresh the preferred sources embedded by independent MPL HTML exports.
await import('./build-export-source.mjs');
