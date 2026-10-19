// Package inspection only; never starts an EXE or accesses user configuration.
import assert from 'node:assert/strict'
import {readFileSync,statSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {posix} from 'node:path'
import {listPackage,extractFile} from '@electron/asar'

const archive='release/d14-static/win-unpacked/resources/app.asar'
const paths=new Map(listPackage(archive).map(path=>{const native=path.replace(/^[\\/]+/,'');return [native.replaceAll('\\','/'),native]}))
const extract=path=>{assert.ok(paths.has(path),`Missing embedded ${path}`);return extractFile(archive,paths.get(path))}
const mini=extract('out/renderer/mini.html').toString(),main=extract('out/main/index.cjs').toString(),preload=extract('out/preload/index.cjs').toString()
assert.ok(main.includes('renderer/mini.html'));assert.ok(main.includes('--workday-window-role=mini'))
assert.ok(main.includes('--workday-window-role=main'));assert.ok(preload.includes('--workday-window-role='))
assert.ok(preload.includes('process.isMainFrame'));assert.ok(!mini.includes("'unsafe-inline'"))
const embedded=[]
for(const html of ['index','mini'])for(const match of extract(`out/renderer/${html}.html`).toString().matchAll(/(?:src|href)="([^"]+)"/g)){
 const path=posix.normalize(posix.join('out/renderer',match[1]));extract(path);embedded.push(path)
}
const icon=[...paths.keys()].find(path=>/main\/chunks\/moyu-tray-.+\.png$/.test(path));assert.ok(icon);assert.deepEqual(extract(icon),readFileSync('src/main/tray/moyu-tray.png'))
const exe='release/d14-static/Workday-Escape-2.0.0-win-x64.exe'
const result={scope:'static package only; EXE NOT RUN',miniHtml:true,mainMiniRolePreload:true,cspPreserved:true,embeddedAssets:[...new Set(embedded)],icon,exeBytes:statSync(exe).size,sha256:createHash('sha256').update(readFileSync(exe)).digest('hex')}
writeFileSync('test-results/d14-package-inspection.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
