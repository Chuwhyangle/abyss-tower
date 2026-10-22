// 确定性随机数：同一 seed 在服务端与浏览器得到完全一致的结果。
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) {
    this._next = mulberry32(hashString(String(seed))());
  }

  float() {
    return this._next();
  }

  int(n) {
    return Math.floor(this._next() * n);
  }

  range(min, max) {
    return min + this._next() * (max - min);
  }

  pick(arr) {
    if (!arr.length) return undefined;
    return arr[Math.floor(this._next() * arr.length)];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // items: [{ weight }] 或 [item, weight]；返回选中项
  weighted(items, weightOf = (x) => x.weight) {
    let total = 0;
    for (const it of items) total += weightOf(it);
    if (total <= 0) return this.pick(items);
    let roll = this._next() * total;
    for (const it of items) {
      roll -= weightOf(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }
}
