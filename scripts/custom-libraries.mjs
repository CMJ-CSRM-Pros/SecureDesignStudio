import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const MAX_FILE = 1_048_576;
const MAX_SET = 4_194_304;

export async function readLibraryCandidates(selection, root) {
  if (!selection) return [];
  let paths;
  try {
    paths = JSON.parse(selection);
    if (selection.length > 4096 || !Array.isArray(paths) || paths.length > 16
        || paths.some(path => typeof path !== "string" || !path.trim())) throw new Error();
  } catch {
    return [{ source: "Deployment configuration", error: "SDS_LIBRARY_PATHS must be a JSON array of at most 16 local package directories." }];
  }
  const candidates = await Promise.all(paths.map(async (path, index) => {
    const source = `Configured library ${index + 1}`;
    if (/^[\\/]{2}|^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
      return { source, error: "Library directories must be local filesystem paths, not URLs or network shares." };
    }
    const controller = new AbortController();
    let timer;
    try {
      const read = async () => {
        const folder = await realpath(resolve(root, path));
        if (/^[\\/]{2}/.test(folder)) return { source, error: "Network library directories are unsupported." };
        const file = await realpath(resolve(folder, "library.json"));
        if (dirname(file) !== folder) return { source, error: "Library manifest must remain inside its selected directory." };
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_FILE) return { source, error: "Library manifest must be a JSON file no larger than 1 MiB." };
        const content = await readFile(file, { encoding: "utf8", signal: controller.signal });
        if (Buffer.byteLength(content) > MAX_FILE) return { source, error: "Library manifest exceeds the 1 MiB limit." };
        return { source, value: JSON.parse(content) };
      };
      return await Promise.race([
        read(),
        new Promise(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve({ source, error: "Local library read timed out." }); }, 2000);
        }),
      ]);
    } catch {
      return { source, error: "Selected library is missing, unreadable or invalid JSON." };
    } finally { clearTimeout(timer); }
  }));
  return Buffer.byteLength(JSON.stringify(candidates)) > MAX_SET
    ? [{ source: "Deployment configuration", error: "Selected libraries exceed the 4 MiB total limit." }]
    : candidates;
}

export function libraryBuildBridge(candidates, embedded) {
  const json = JSON.stringify(candidates);
  const fileName = `assets/custom-libraries.${createHash("sha256").update(json).digest("hex").slice(0, 16)}.json`;
  const delivery = embedded || candidates.length === 0
    ? { mode: "embedded", candidates } : { mode: "same-origin", manifest: `./${fileName}` };
  return {
    delivery,
    plugin: {
      name: "secure-design-studio-custom-libraries",
      generateBundle() {
        if (delivery.mode === "same-origin") this.emitFile({ type: "asset", fileName, source: json });
      },
    },
  };
}
