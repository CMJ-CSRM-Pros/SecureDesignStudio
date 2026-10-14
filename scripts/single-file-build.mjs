const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function singleFileBuildPlugin() {
  return {
    name: "sds:single-file",
    enforce: "post",
    config(config) {
      config.base = "./";
      config.build ??= {};
      config.build.assetsInlineLimit = () => true;
      config.build.cssCodeSplit = false;
      config.build.assetsDir = "";
      config.build.rollupOptions ??= {};
      config.build.rollupOptions.output ??= {};
      const outputs = Array.isArray(config.build.rollupOptions.output)
        ? config.build.rollupOptions.output : [config.build.rollupOptions.output];
      for (const output of outputs) output.codeSplitting = false;
    },
    generateBundle(_options, bundle) {
      const htmlFiles = Object.values(bundle).filter(file => /\.html?$/.test(file.fileName));
      if (!htmlFiles.length) this.error("Standalone build did not emit HTML.");
      const inlined = new Set();
      for (const html of htmlFiles) {
        let source = String(html.source);
        for (const file of Object.values(bundle)) {
          const name = escapeRegExp(file.fileName);
          if (file.type === "chunk") {
            const tag = new RegExp(`<script([^>]*?)\\s+src=["'](?:\\./)?${name}["']([^>]*)>\\s*</script>`, "g");
            let matched = false;
            const code = file.code.replace(/"?__VITE_PRELOAD__"?/g, "void 0")
              .replace(/<(\/script>|!--)/gi, "\\x3C$1");
            source = source.replace(tag, (_, before, after) => {
              matched = true;
              return `<script${before}${after}>${code.trim()}</script>`;
            });
            if (matched) inlined.add(file.fileName);
          } else if (/\.css$/.test(file.fileName)) {
            const tag = new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\./)?${name}["'][^>]*>`, "g");
            let matched = false;
            const css = String(file.source).replace(/@charset "UTF-8";/g, "")
              .replace(/<\/style/gi, "\\3C /style");
            source = source.replace(tag, () => {
              matched = true;
              return `<style>${css.trim()}</style>`;
            });
            if (matched) inlined.add(file.fileName);
          }
        }
        html.source = source;
      }
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk" || /\.css$/.test(file.fileName)) {
          if (!inlined.has(file.fileName)) this.error(`Standalone resource was not inlined: ${file.fileName}`);
          delete bundle[file.fileName];
        }
      }
    },
  };
}
