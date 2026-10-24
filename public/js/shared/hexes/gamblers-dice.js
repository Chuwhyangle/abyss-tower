// 主海克斯：赌徒之骰。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-011 填充。
const hooks = Object.freeze({
  // 波次开始：HEX-011 抽取本波运势与代价。
  onWaveStart(wave, ctx) {},
  // 波次结束：HEX-011 清理临时 mod。
  onWaveEnd(wave, ctx) {},
});

export default Object.freeze({
  id: 'gamblers_dice',
  name: '赌徒之骰',
  glyph: '🎲',
  color: '#f472b6',
  tags: Object.freeze(['随机', '变数']),
  pitch: '每波随机运势 + 代价，遗物完全随机、刷新 +1',
  desc: '每波随机运势与代价，遗物完全随机、刷新 +1。',
  downside: '每波承受一组随机代价',
  scoreMul: 1.10,
  hooks,
  implemented: false,
});
