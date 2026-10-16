import { onMounted, onScopeDispose, readonly, ref } from 'vue'
import type { WindowVisibilityApi } from '../../../shared/contracts'

// Native visibility (including minimized) AND document visibility. Unknown or
// failed delivery stays static; this never controls the business clock.
export function useWindowVisibility(api: WindowVisibilityApi) {
  const visible=ref(false)
  let nativeVisible=false,disposed=false
  const update=()=>{visible.value=!disposed&&nativeVisible&&document.visibilityState==='visible'}
  onMounted(async()=>{
    document.addEventListener('visibilitychange',update)
    try{const subscribed=await api.subscribeVisibility(result=>{if(disposed)return;nativeVisible=result.ok&&result.data.visible;update()});if(!subscribed.ok){nativeVisible=false;update()}}
    catch{nativeVisible=false;update()}
  })
  onScopeDispose(()=>{disposed=true;visible.value=false;document.removeEventListener('visibilitychange',update);void api.unsubscribeVisibility?.().catch(()=>{})})
  return readonly(visible)
}
