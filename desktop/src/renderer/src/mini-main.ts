import {createApp} from 'vue'
import type {MiniWindowApi} from '../../shared/contracts'
import MiniApp from './MiniApp.vue'
import './styles/tokens.css'
import './styles/base.css'

// The main entry's Window declaration is deliberately main-only. Authority here
// comes from Main's preload argument + registered sender, never a URL parameter.
const api=window.workdayV2 as unknown as MiniWindowApi
if(api?.role==='mini')createApp(MiniApp,{api}).mount('#app')
else document.getElementById('app')!.textContent='迷你窗口身份无效，请从主窗口重新打开。'
