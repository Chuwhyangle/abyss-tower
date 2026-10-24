// 主海克斯：镜像工程。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-012 填充。
const hooks = Object.freeze({
  // 建塔完成：HEX-012 在对称格生成镜像塔。
  onTowerBuilt(tower) {},
  // 升级完成：HEX-012 同步镜像等级。
  onTowerUpgraded(tower) {},
  // 塔移除：HEX-012 同步移除镜像塔。
  onTowerRemoved(tower, reason) {},
  // 塔属性重算末尾调用：HEX-012 对镜像塔乘 0.60。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
  },
});

export default Object.freeze({
  id: 'mirror_engineering',
  name: '镜像工程',
  glyph: '🪞',
  color: '#38bdf8',
  tags: Object.freeze(['空间', '复制']),
  pitch: '对称位置生成 60% 属性镜像塔',
  desc: '建塔时对称位置生成 60% 属性镜像塔，但造价 +35%。',
  downside: '造价 +35%',
  scoreMul: 1.10,
  hooks,
  implemented: false,
});
