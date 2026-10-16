// Static local inspection only. Never launches the EXE or touches user profiles.
import assert from 'node:assert/strict'
import {readFileSync,statSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {listPackage,extractFile} from '@electron/asar'

const archive='release/d13-static/win-unpacked/resources/app.asar'
const paths=listPackage(archive).map(path=>path.replace(/^[\\/]+/,''))
const icon=paths.find(path=>/main[\\/]chunks[\\/]moyu-tray-[^\\/]+\.png$/.test(path))
assert.ok(icon,'Tray icon must be inside app.asar, not an external resources path')
const bytes=extractFile(archive,icon)
assert.deepEqual(bytes,readFileSync('src/main/tray/moyu-tray.png'))
assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),32)
const main=extractFile(archive,paths.find(path=>/main[\\/]index\.cjs$/.test(path))).toString()
assert.ok(main.includes('chunks/moyu-tray-'),'Main must use the emitted relative asset')
assert.ok(main.includes('!electron.app.isPackaged'),'Packaged app must not enable test overrides')
const exe='release/d13-static/Workday-Escape-2.0.0-win-x64.exe'
const result={icon,iconBytes:bytes.length,assetMatches:true,embeddedRelativePath:true,packagedGuard:true,
  exeBytes:statSync(exe).size,sha256:createHash('sha256').update(readFileSync(exe)).digest('hex'),scope:'static package only; EXE NOT RUN'}
writeFileSync('test-results/d13-package-inspection.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
