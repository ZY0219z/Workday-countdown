// Review-only fixed presentation. No Vue, IPC, clock, timer, network or storage.
const cat = () => '<canvas data-moyu width="226" height="217" aria-label="原始蓝色摸鱼猫抱灰鱼" role="img"></canvas>'
const badge = (state, label) => `<span class="badge ${state}">${label}</span>`
const button = () => '<button class="preview-button" type="button" aria-label="打开主窗（仅静态示意）">打开主窗 ↗</button>'
function mainWindow(narrow = false) {
  return `<section class="main-window${narrow ? ' narrow' : ''}" aria-label="${narrow ? '480×560' : '720×780'} DIP主窗口静态示意">
    <div class="titlebar">${cat()}<span>Workday Escape</span><span class="native-symbols" aria-hidden="true">─ □ ×</span></div>
    <div class="main-body">
      <div class="overview">${badge('working', '工作中')}<time>10月14日 · 周三</time><button class="preview-button" type="button" aria-label="设置（仅静态示意）">设置</button></div>
      <section class="surface hero"><div><h3>距离下班还有</h3><div class="digits" role="timer" aria-live="off">03:00:00</div><p class="target">今天 18:00 下班 · 09:00–18:00</p></div>${cat()}</section>
      <section class="surface progress"><div class="progress-head"><span>今日工作进度</span><strong>62.5%</strong></div><div class="track" aria-hidden="true"></div><p class="muted">已工作 5 小时 / 计划 8 小时 · 午休不计入</p></section>
      <div class="metrics"><section class="surface metric"><h3>下个休息日</h3><p class="metric-value"><span class="accent">3</span> <small>天</small></p><p class="muted">10月17日 · 周六</p><p class="muted">每周工作规则</p></section>
      <section class="surface metric"><h3>下个计划发薪日</h3><p class="metric-value"><span class="accent">6</span> <small>天</small></p><p class="muted">10月20日 · 周二</p><p class="muted">计划日期，不代表已到账</p></section></div>
      <section class="surface employment"><div class="employment-line"><span>在职自然日 <strong>453 天</strong></span><span>累计计划工作日 <strong>320 天</strong></span></div><p class="muted">均不含今天 · 计划日按当前规则推算，非实际出勤</p></section>
      <p class="notice"><span aria-hidden="true">ⓘ</span><span>上班摸鱼，摸着摸着就下班了。</span></p>
    </div>
  </section>`
}
function mini(small = false) {
  return `<section class="mini${small ? ' small-mini' : ''}" aria-label="${small ? '240×112' : '280×132'} DIP迷你内容静态示意"><div class="mini-top">${badge('working', '工作中')}${button()}</div><div class="mini-timer"><div class="digits" role="timer" aria-live="off">${small ? '100:00:00' : '03:00:00'}</div>${cat()}</div><div class="track" aria-hidden="true"></div><p class="target">${small ? '仅排版压力测试 · 非实际班次' : '今天 18:00 下班 · 净进度 62.5%'}</p></section>`
}
function themes() {
  return `<div class="theme-sheet">${['light','dark'].map(mode => `<section class="review-column"><h2>珊瑚 · ${mode === 'light' ? '亮色' : '深色'} / 主窗 720×780 DIP</h2><div class="theme coral ${mode}">${mainWindow()}</div><div class="mini-row"><div class="mini-sample"><p>海蓝对照 · 280×132 DIP</p><div class="theme ${mode}">${mini()}</div></div><div class="mini-sample"><p>珊瑚 · 280×132 DIP</p><div class="theme coral ${mode}">${mini()}</div></div></div><p>配色为待确认草案，组件结构相同；跟随系统映射到同一亮/深方案。</p></section>`).join('')}</div>`
}
const cases = [
  {state:'working',label:'工作中',title:'距离下班还有',time:'03:00:00',target:'今天 18:00 下班',note:'净进度 62.5%，排除午休。'},
  {state:'break',label:'午休中',title:'距离下班还有',time:'05:30:00',target:'今天 18:00 下班 · 午休至 13:00',note:'净进度冻结在 37.5%；目标仍为最终下班。'},
  {state:'rest',label:'休息日',title:'今天休息',empty:'好好休息一下',target:'没有活动班次',note:'无工作进度，不显示假 0%。'},
  {state:'incomplete',label:'数据不完整',title:'需要检查设置',empty:'—',target:'尚无可用倒计时',note:'无有效数据，不显示假 00:00:00。'},
  {state:'estimate',label:'估算 · 年度缺失',title:'距离下班还有',time:'03:00:00',target:'依据周规则估算 · 缺少2027年度数据',note:'估算标记紧邻受影响值；自然日不贴估算。'},
  {state:'overtime',label:'加班中',title:'距离下班还有',time:'00:40:00',target:'10月15日 00:20 结束 · 原10月14日班次',note:'跨夜必须带结束日期，不清除历史加班。'},
  {state:'before',label:'上班前',title:'距离上班还有',time:'00:30:00',target:'今天 09:00 上班',note:'有效待开始班次进度为0%；与无班次区别。'},
  {state:'finished',label:'已下班',title:'班次已结束',empty:'已经下班啦！',target:'今天 18:00 下班',note:'净进度100%，停止动画；不继承旧加班。'}
]
function states() {
  return `<div class="states-sheet"><section class="review-column"><h2>语义补充 · 状态靠文字区分，颜色辅助</h2><div class="state-grid">${cases.map((s,i)=>`<article class="theme coral ${i%2 ? 'dark' : 'light'} state-demo"><div class="state-title">${badge(s.state,s.label)}${cat()}</div><h3>${s.title}</h3>${s.time ? `<p class="digits" role="timer" aria-live="off">${s.time}</p>` : `<p class="empty-text">${s.empty}</p>`}<p class="target">${s.target}</p><p class="${s.state==='estimate'?'warning':'muted'}">${s.note}</p></article>`).join('')}</div><p>09:00–18:00，12:00–13:00午休，仅固定状态示例。无进度与估算分别表达。</p></section><section class="sizes-column"><h2>关键尺寸 · 主窗 480×560 DIP</h2><div class="theme coral light">${mainWindow(true)}</div><p>辅助卡改为单列；内容纵向滚动，不压小大数字。原生窗口行为未实现。</p><div class="mini-sample"><p>迷你最小内容目标 240×112 DIP · 长数字排版测试</p><div class="theme coral dark">${mini(true)}</div></div><p>100小时仅为极长输入排版压力示例，不表示常规班次可长达100小时。没有创建第二个窗口。</p></section></div>`
}
const frozenFrame = document.createElement('canvas')
frozenFrame.width = 226
frozenFrame.height = 217
function render() {
  document.getElementById('preview').innerHTML = location.hash === '#states' ? states() : themes()
  for (const canvas of document.querySelectorAll('canvas[data-moyu]')) {
    canvas.getContext('2d').drawImage(frozenFrame, 0, 0, canvas.width, canvas.height)
  }
  document.documentElement.dataset.previewReady = 'true'
}
const original = new Image()
original.onload = () => {
  // Draw the decoder's first loaded frame once, then keep the original static.
  // No regenerated illustration, running GIF element or animation loop.
  frozenFrame.getContext('2d').drawImage(original, 0, 0, 226, 217)
  render()
  window.addEventListener('hashchange', render)
}
original.onerror = () => { document.documentElement.dataset.previewReady = 'failed' }
original.src = 'moyu_original.gif'
