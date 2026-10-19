import type {WindowRole} from './contracts'
// BrowserWindow.additionalArguments is assigned by Main. Query strings never
// select a capability. Ambiguous/unknown arguments fail closed; Router remains
// authoritative even if a process was started with hostile command-line input.
export function preloadRole(args:readonly string[]):WindowRole|null {
  const roles=args.filter(arg=>arg.startsWith('--workday-window-role='))
  return roles.length===1?(roles[0]==='--workday-window-role=main'?'main':roles[0]==='--workday-window-role=mini'?'mini':null):null
}
