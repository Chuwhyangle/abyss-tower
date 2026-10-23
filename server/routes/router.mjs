// 轻量路由器：方法 + 路径模式匹配，处理器返回 true 表示已响应。
// 未匹配的请求继续向下传递，以保留原有「落空 → 404」的语义。

function compilePattern(pattern) {
  if (pattern instanceof RegExp) return pattern;
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const name = segment.slice(1);
      return `(?<${name}>[A-Za-z0-9_-]+)`;
    })
    .join('/');
  return new RegExp(`^${source}$`);
}

export class RouteTable {
  #routes = [];

  add(method, pattern, handler) {
    this.#routes.push({
      method: method || null,
      regex: compilePattern(pattern),
      handler,
    });
    return this;
  }

  async dispatch(ctx) {
    for (const route of this.#routes) {
      if (route.method && route.method !== ctx.method) continue;
      const match = route.regex.exec(ctx.pathname);
      if (!match) continue;
      if (await route.handler(ctx, match.groups || {})) return true;
    }
    return false;
  }
}

export class ApiRouter {
  #public = new RouteTable();
  #protected = new RouteTable();
  #gate;

  constructor(gate) {
    this.#gate = gate;
  }

  addPublic(controller) {
    controller.register(this.#public);
    return this;
  }

  addProtected(controller) {
    controller.register(this.#protected);
    return this;
  }

  async dispatch(ctx) {
    if (await this.#public.dispatch(ctx)) return true;
    const gameCtx = await this.#gate(ctx);
    if (!gameCtx) return true; // 门禁已响应（401）
    if (await this.#protected.dispatch(gameCtx)) return true;
    gameCtx.fail(404, '接口不存在');
    return true;
  }
}
