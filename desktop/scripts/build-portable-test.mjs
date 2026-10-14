import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { testEntry, testArtifactMarker } from './portable-test-artifact.mjs'

const desktop = process.cwd(), project = resolve('test-results/d08-portable-project'), output = resolve('release/d08-gui')
mkdirSync(project, { recursive: true })
cpSync('out', join(project, 'out'), { recursive: true })
const metadata = JSON.parse(readFileSync('package.json', 'utf8'))
metadata.main = 'out/main/d08-test-entry.cjs'; metadata.d08TestArtifact = testArtifactMarker
writeFileSync(join(project, 'package.json'), JSON.stringify(metadata, null, 2) + '\n')
writeFileSync(join(project, metadata.main), testEntry)
const result = spawnSync(process.execPath, [resolve('node_modules/electron-builder/cli.js'), '--projectDir', project,
  '--config', resolve('electron-builder.yml'), `--config.directories.output=${output}`,
  `--config.electronDist=${resolve('node_modules/electron/dist')}`,
  '--config.portable.artifactName=Workday-Escape-D08-TEST-win-x64.exe', '--win', 'portable', '--x64', '--publish', 'never'],
  { cwd: desktop, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status === 0) {
  const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  writeFileSync(join(output, 'd08-test-artifact.json'), JSON.stringify({ marker: testArtifactMarker,
    exeSha256: sha(join(output, 'Workday-Escape-D08-TEST-win-x64.exe')),
    asarSha256: sha(join(output, 'win-unpacked/resources/app.asar')) }, null, 2) + '\n')
}
process.exitCode = result.status ?? 1
