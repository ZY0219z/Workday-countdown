import type { AppConfig, Result } from '../../../shared/contracts'
import { editableValidators } from '../../../shared/config-schema'
import { success, validateStructure } from '../../../shared/validation'

export type Appearance = AppConfig['appearance']
export interface ResolvedAppearance { theme: 'light' | 'dark'; accent: Appearance['accent']; reduceMotion: boolean }
export interface MediaPort {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}
export interface ThemeTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}
export function resolveAppearance(input: Appearance, systemDark: boolean, systemReducedMotion: boolean): ResolvedAppearance {
  return { theme: input.mode === 'system' ? (systemDark ? 'dark' : 'light') : input.mode,
    accent: input.accent, reduceMotion: input.reduceMotion || systemReducedMotion }
}
const attributes = ['data-theme', 'data-accent', 'data-reduced-motion'] as const

// One scoped host. Required initial preferences are not saved defaults.
export function createThemeController(target: ThemeTarget, media: { dark: MediaPort; motion: MediaPort }, initial: Appearance) {
  const checked = validateStructure(initial, editableValidators.appearance)
  if (!checked.ok) return checked
  let preferences = checked.data, disposed = false
  const previous = attributes.map(name => target.getAttribute(name))
  function apply(): ResolvedAppearance {
    const resolved = resolveAppearance(preferences, media.dark.matches, media.motion.matches)
    target.setAttribute('data-theme', resolved.theme)
    target.setAttribute('data-accent', resolved.accent)
    target.setAttribute('data-reduced-motion', String(resolved.reduceMotion))
    return resolved
  }
  const changed = () => { if (!disposed) apply() }
  media.dark.addEventListener('change', changed)
  media.motion.addEventListener('change', changed)
  apply()
  return success({
    update(input: Appearance): Result<ResolvedAppearance> {
      if (disposed) return { ok: false, error: { code: 'UNAVAILABLE', message: '主题会话已释放。' } }
      const parsed = validateStructure(input, editableValidators.appearance)
      if (!parsed.ok) return parsed
      preferences = parsed.data
      return success(apply())
    },
    dispose() {
      if (disposed) return
      disposed = true
      media.dark.removeEventListener('change', changed)
      media.motion.removeEventListener('change', changed)
      attributes.forEach((name, i) => { const value = previous[i]; if (value === null) target.removeAttribute(name); else target.setAttribute(name, value) })
    }
  })
}
