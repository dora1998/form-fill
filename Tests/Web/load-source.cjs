const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
// Exercise source modules without browser/DOM globals; bundled entrypoints have separate smoke tests.
module.exports = source => {
  const filename = path.resolve(__dirname, '../../SafariExtension/Source', source);
  const compiled = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded._compile(compiled.outputFiles[0].text, filename);
  return loaded.exports;
};
