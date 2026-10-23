// 遗物候选归一化：兼容旧服务端直接返回遗物 ID 列表的格式。
import { RELIC_BY_ID } from '../shared/data.js';

export class RelicOffers {
  static normalize(raw, sim) {
    return (raw || [])
      .map((item) => {
        if (typeof item === 'string' && RELIC_BY_ID[item]) {
          const fromLevel = sim.getRelicLevel(item) || 0;
          return {
            kind: 'relic',
            id: item,
            fromLevel,
            toLevel: Math.min(3, fromLevel + 1),
          };
        }
        if (item && item.kind) return item;
        if (item && item.id && RELIC_BY_ID[item.id]) {
          const fromLevel = item.fromLevel ?? (sim.getRelicLevel(item.id) || 0);
          return {
            kind: 'relic',
            id: item.id,
            fromLevel,
            toLevel: Math.min(3, item.toLevel || fromLevel + 1),
          };
        }
        return null;
      })
      .filter(Boolean);
  }
}
