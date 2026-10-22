import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, renderPair, createThemeController, resolveAppearance, countdownPresentation, badgePresentation, metricValue } from '../../test-results/d10-ssr/components.mjs'

const initial = { mode: 'system', accent: 'ocean', reduceMotion: false }
function fixture() {
  const attributes = new Map([['unrelated', 'preserve']])
  const target = { getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) }
  const media = matches => ({ matches, listeners: new Set(), addEventListener(_, fn) { this.listeners.add(fn) }, removeEventListener(_, fn) { this.listeners.delete(fn) }, change(value) { this.matches = value; [...this.listeners].forEach(fn => fn()) } })
  const dark = media(false), motion = media(false)
  return { attributes, target, dark, motion }
}
for (const mode of ['light', 'dark', 'system']) for (const accent of ['ocean', 'coral']) test(`UI-07 stored ${mode}/${accent} resolves to the single sea-salt style without migration`, () => {
  for (const dark of [false, true]) { const stored={ ...initial, mode, accent }, before=structuredClone(stored);assert.deepEqual(resolveAppearance(stored, dark, false), { theme:'light', accent:'ocean', reduceMotion:false });assert.deepEqual(stored,before) }
})
test('reduce motion is user OR system, neither source can disable the other', () => {
  for (const user of [false, true]) for (const system of [false, true]) assert.equal(resolveAppearance({ ...initial, reduceMotion: user }, false, system).reduceMotion, user || system)
})
test('UI-07 legacy/system colors cannot change the fixed style; motion and scoped attributes remain reactive', () => {
  const f = fixture(), result = createThemeController(f.target, f, initial); assert.equal(result.ok, true)
  f.dark.change(true); assert.equal(f.attributes.get('data-theme'), 'light')
  assert.equal(result.data.update({ ...initial, mode: 'light', accent: 'coral' }).ok, true)
  f.dark.change(false); f.dark.change(true); assert.equal(f.attributes.get('data-theme'), 'light')
  assert.equal(f.attributes.get('data-accent'), 'ocean'); assert.equal(f.attributes.get('unrelated'), 'preserve')
  f.motion.change(true); assert.equal(f.attributes.get('data-reduced-motion'), 'true')
  result.data.dispose(); assert.equal(f.dark.listeners.size + f.motion.listeners.size, 0)
})
test('controller copies validated preferences; editing input does not mutate current theme', () => {
  const f = fixture(), input = { ...initial }, result = createThemeController(f.target, f, input)
  input.accent = 'coral'; f.dark.change(true); assert.equal(f.attributes.get('data-accent'), 'ocean')
  result.data.dispose()
})
for (const invalid of [{ ...initial, mode: 'sepia' }, { ...initial, accent: 'whale' }, { ...initial, reduceMotion: 1 }, { ...initial, path: 'arbitrary' }, null]) test(`invalid theme rejected: ${JSON.stringify(invalid)}`, () => {
  const f = fixture(), result = createThemeController(f.target, f, invalid)
  assert.equal(result.ok, false); assert.equal(result.error.code, 'VALIDATION')
  assert.equal(f.attributes.size, 1); assert.equal(f.dark.listeners.size + f.motion.listeners.size, 0)
})
test('invalid update retains prior theme; dispose restores attributes and is idempotent', () => {
  const f = fixture(); f.attributes.set('data-theme', 'previous')
  const result = createThemeController(f.target, f, initial)
  const update = result.data.update({ ...initial, mode: 'bad' }); assert.equal(update.ok, false)
  assert.equal(f.attributes.get('data-theme'), 'light'); result.data.dispose(); result.data.dispose()
  assert.equal(f.attributes.get('data-theme'), 'previous'); assert.equal(f.attributes.has('data-accent'), false)
  f.dark.change(true); assert.equal(f.attributes.get('data-theme'), 'previous')
  assert.equal(result.data.update(initial).error.code, 'UNAVAILABLE')
})
for (const [state, label] of Object.entries({ beforeWork: '上班前', working: '工作中', break: '午休中', overtime: '加班中', finished: '已下班', rest: '休息日', incomplete: '数据不完整', estimate: '估算' })) test(`StatusBadge ${state} is textual, semantic and accessible`, async () => {
  const html = await render('StatusBadge', { state }); assert.ok(html.includes(label)); assert.ok(html.includes('role="status"')); assert.ok(html.includes('aria-live="polite"'))
  const value = badgePresentation(state); value.label = 'mutated'; assert.equal(badgePresentation(state).label, label)
})
test('unknown badge cannot access inherited object properties and falls back to incomplete', () => {
  for (const key of ['constructor', '__proto__', 'bad']) assert.equal(badgePresentation(key).label, '数据不完整')
})
for (const [state, text] of [['working', '03:28:17'], ['break', '05:30:00'], ['overtime', '00:45:00'], ['beforeWork', '00:30:00']]) test(`CountdownCard ${state} renders supplied text without recalculation`, async () => {
  const html = await render('CountdownCard', { state, text, target: { kind: state === 'beforeWork' ? 'workStart' : 'finalWorkEnd', date: '2026-10-15', time: '18:00' } })
  assert.ok(html.includes(text)); assert.ok(html.includes('role="timer" aria-live="off"')); assert.ok(html.includes('2026-10-15 18:00'))
  assert.ok(html.includes(state === 'beforeWork' ? '距离上班还有' : '距离下班还有'))
})
for (const text of [null, '', 'bad', '1:00:00', '08:60:00', '08:00:60']) test(`missing/invalid countdown does not fake zero: ${text}`, async () => {
  const html = await render('CountdownCard', { state: 'incomplete', text }); assert.ok(html.includes('暂无可用倒计时')); assert.ok(!html.includes('00:00:00')); assert.ok(!html.includes('role="timer"'))
})
test('valid zero and 100-hour pressure input are displayed exactly; rest and finished do not fake progress', async () => {
  for (const text of ['00:00:00', '100:00:00']) assert.ok((await render('CountdownCard', { state: 'working', text })).includes(text))
  for (const state of ['rest', 'finished']) { const html = await render('CountdownCard', { state, text: '00:00:00' }); assert.ok(!html.includes('role="timer"')); assert.ok(!html.includes('0%')) }
  assert.equal(countdownPresentation('rest', null).emptyLabel, '无活动班次 · 无工作进度')
})
test('estimate and error are separate textual notices beside countdown, never only colors', async () => {
  const html = await render('CountdownCard', { state: 'working', text: '03:28:17', estimate: '2027 年度数据不完整', warning: '请检查排班' }); assert.ok(html.includes('估算')); assert.ok(html.includes('2027 年度数据不完整')); assert.ok(html.includes('请检查排班'))
})
test('metric preserves zero; missing, whitespace and nonfinite input do not invent values', async () => {
  assert.equal(metricValue(0), '0'); assert.equal(metricValue('—'), '—')
  for (const value of [null, '', ' ', NaN, Infinity]) { assert.equal(metricValue(value), null); const html = await render('MetricCard', { title: '在职自然日', value }); assert.ok(html.includes('暂无数据')); assert.ok(!html.includes('we-metric-value')) }
  const html = await render('MetricCard', { title: '在职自然日', value: 0, unit: '天' }); assert.ok(html.includes('we-metric-value')); assert.ok(!html.includes('暂无数据'))
})
test('salary has planned-date disclaimer and does not resolve ambiguous cycles', async () => {
  const html = await render('MetricCard', { title: '发薪', value: null, kind: 'salary', emptyLabel: '暂无唯一计划日期', warning: '需用户选择周期' }); assert.ok(html.includes('计划日期，不代表已到账')); assert.ok(html.includes('暂无唯一计划日期')); assert.ok(!html.includes('we-metric-value'))
})
test('metric estimate is adjacent to value; independent natural days have no implied calendar warning', async () => {
  const estimated = await render('MetricCard', { title: '计划工作日', value: 123, estimated: true, source: '按当前工作周回算历史' }); assert.ok(estimated.includes('估算')); assert.ok(estimated.includes('按当前工作周回算历史'))
  const natural = await render('MetricCard', { title: '自然日', value: 123 }); assert.ok(!natural.includes('估算'))
})
test('untrusted display strings are escaped by Vue; accessible headings have unique IDs per app', async () => {
  const html = await render('StatusBadge', { state: 'working', note: '<script>alert(1)</script>' }); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'))
  const pair = await renderPair(), ids = [...pair.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]); assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2)
})
