// HTTP 引导：监听、来源校验、静态资源与 API 路由装配。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from './http/respond.mjs';
import { installProcessErrorHandlers, recordRequestError } from './http/error-log.mjs';
import { RouteContext } from './http/context.mjs';
import { StaticFiles } from './http/static.mjs';
import { createApiRouter } from './routes/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const apiRouter = createApiRouter();
const staticFiles = new StaticFiles(PUBLIC_DIR);

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (url.pathname.startsWith('/api/') && mutating) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = null;
        }
        if (!originHost || originHost !== req.headers.host) {
          return fail(res, 403, '来源校验失败');
        }
      }
      if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') {
        return fail(res, 403, '来源校验失败');
      }
    }
    if (url.pathname.startsWith('/api/')) {
      await apiRouter.dispatch(new RouteContext(req, res, url));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, '不支持的请求方法');
    }
    staticFiles.serve(req, res, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    recordRequestError({
      req,
      pathname: url?.pathname || req.url,
      status,
      code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message: error?.message || error,
    });
    console.error('[request]', req.method, url?.pathname || req.url, error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // 5xx 只回固定文案：堆栈与文件系统路径只进服务端日志。
    fail(res, status, status >= 500 ? '服务器内部错误' : error.message || '请求有误');
  }
});

installProcessErrorHandlers();

server.listen(PORT, HOST, () => {
  console.log(`[渊塔守卫] http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n[渊塔守卫] 收到 ${signal}，正在关闭...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
