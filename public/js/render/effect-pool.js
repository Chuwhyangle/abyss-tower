// 固定容量的粒子槽复用池：只在构造时分配对象，每帧 reset 后重新 acquire。
//
// 与命中层的 ImpactVfxPool 语义一致但相互独立：死亡/漏怪等本体特效共用这一个池。
import { clampCount } from './effect-data.js';

// 固定容量的粒子槽复用池：只在构造时分配对象，每帧 reset 后重新 acquire。
export class ParticlePool {
  constructor(capacity = 0) {
    this.capacity = clampCount(capacity, Number.MAX_SAFE_INTEGER);
    this.slots = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.slots[i] = { x: 0, y: 0, size: 0 };
    this.limit = this.capacity;
    this.cursor = 0;
  }

  reset(limit = this.capacity) {
    this.limit = clampCount(limit, this.capacity);
    this.cursor = 0;
    return this;
  }

  acquire() {
    if (this.cursor >= this.limit) return null;
    return this.slots[this.cursor++];
  }

  get active() {
    return this.cursor;
  }
}
