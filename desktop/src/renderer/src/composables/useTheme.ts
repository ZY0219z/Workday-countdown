import { onMounted, onScopeDispose, readonly, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { createThemeController } from '../ui/appearance'
import type { Appearance, MediaPort } from '../ui/appearance'

export function useTheme(host: Ref<HTMLElement | null>, preferences: MaybeRefOrGetter<Appearance>, matchMedia: (query: string) => MediaPort = query => window.matchMedia(query)) {
  const reduceMotion=ref(true) // Static until the scoped theme has resolved.
  let release: (() => void) | undefined
  onMounted(() => {
    const media = { dark: matchMedia('(prefers-color-scheme: dark)'), motion: matchMedia('(prefers-reduced-motion: reduce)') }
    let controller: Extract<ReturnType<typeof createThemeController>, { ok: true }>['data'] | undefined
    const stopHost = watch(host, target => {
      controller?.dispose(); controller = undefined
      if (target) {
        const created = createThemeController(target, media, toValue(preferences),value=>{reduceMotion.value=value.reduceMotion})
        if (created.ok) controller = created.data
      }
    }, { immediate: true, flush: 'post' })
    const stopPreferences = watch(() => toValue(preferences), value => { controller?.update(value) }, { deep: true })
    release = () => { stopHost(); stopPreferences(); controller?.dispose() }
  })
  onScopeDispose(() => release?.())
  return readonly(reduceMotion)
}
