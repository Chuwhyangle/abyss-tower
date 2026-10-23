// 静态资源：MIME、路径解析、SPA 回退与目录穿越防护。
import fs from 'node:fs';
import path from 'node:path';

import { SECURITY_HEADERS, MAX_PATH_LENGTH, fail } from './respond.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class StaticFiles {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  serve(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return fail(res, 400, '非法路径');
    }
    // 空字节会触发 fs 的同步异常，超长路径必然落空：两者都按「资源不存在」处理。
    if (decoded.includes('\0') || decoded.length > MAX_PATH_LENGTH) {
      return fail(res, 404, '资源不存在');
    }
    if (!decoded.startsWith('/')) return fail(res, 400, '非法路径');
    if (decoded === '/') decoded = '/index.html';

    // 先拼成「根目录 + 相对路径」再回读相对位置，确保规范化后仍位于 rootDir 内。
    const file = path.resolve(this.rootDir, `.${decoded}`);
    const relative = path.relative(this.rootDir, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return fail(res, 404, '资源不存在');
    }

    fs.stat(file, (error, stat) => {
      if (!error && stat.isFile()) return this.serveFile(res, file);
      // 带扩展名的资源缺失时返回 404，避免把 JS/CSS 当成 HTML 返回。
      if (path.extname(decoded)) return fail(res, 404, '资源不存在');
      return this.serveFile(res, path.join(this.rootDir, 'index.html'));
    });
  }

  serveFile(res, file) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
