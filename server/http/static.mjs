// 静态资源：MIME、路径解析、SPA 回退与目录穿越防护。
import fs from 'node:fs';
import path from 'node:path';

import { SECURITY_HEADERS, fail } from './respond.mjs';

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
    this.rootDir = rootDir;
  }

  serve(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return fail(res, 400, '非法路径');
    }
    if (decoded === '/') decoded = '/index.html';

    const file = path.normalize(path.join(this.rootDir, decoded));
    if (!file.startsWith(this.rootDir + path.sep)) return fail(res, 403, '禁止访问');

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
    fs.createReadStream(file).pipe(res);
  }
}
