// 请求上下文：把 req/res/url 与响应辅助方法封装给路由处理器使用。
import { json, fail, readJson } from './respond.mjs';

export class RouteContext {
  constructor(req, res, url) {
    this.req = req;
    this.res = res;
    this.url = url;
    this.pathname = url.pathname;
    this.method = req.method;
  }

  json(status, data) {
    json(this.res, status, data);
    return true;
  }

  fail(status, message, code = null) {
    fail(this.res, status, message, code);
    return true;
  }

  readJson() {
    return readJson(this.req);
  }
}

// 通过鉴权后：携带账号身份与当前档案，档案可在同一请求内更新。
export class GameContext extends RouteContext {
  constructor(base, { identity, profile }) {
    super(base.req, base.res, base.url);
    this.identity = identity;
    this._profile = profile;
  }

  get token() {
    return this.identity.account.id;
  }

  get profile() {
    return this._profile;
  }

  setProfile(profile) {
    this._profile = profile;
    return profile;
  }
}
