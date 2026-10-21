// A custom electronDist skips electron-builder's default distribution cleanup.
// Remove only the stock demo and version marker from our generated Windows tree.
const assert = require('node:assert/strict')
const { existsSync, realpathSync, unlinkSync } = require('node:fs')
const { isAbsolute, join, relative, resolve, sep } = require('node:path')

module.exports = async function afterPack({ appOutDir, electronPlatformName, packager }) {
  // The historical D08 fixture uses its own projectDir and absolute output.
  // Leave that explicitly marked test artifact to its existing build script.
  if (electronPlatformName !== 'win32' || packager.appInfo?.metadata?.d08TestArtifact) return
  const output = realpathSync(appOutDir)
  const release = realpathSync(resolve(packager.projectDir, 'release'))
  const inside = relative(release, output)
  assert.ok(inside && inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside), 'Expected generated output inside project release directory')
  assert.ok(existsSync(join(output, 'resources', 'app.asar')), 'Production app.asar must exist before cleanup')
  for (const file of ['resources/default_app.asar', 'version']) {
    const target = join(output, file)
    if (existsSync(target)) unlinkSync(target)
  }
}
