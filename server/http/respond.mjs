// HTTP 响应原语：安全头、JSON 响应、失败响应、请求体解析。

// 请求体上限：docs/TECH_DESIGN.md §6.5「JSON body 上限 256KB」。
export const MAX_BODY_BYTES = 256 * 1024;

// 单条路径上限：Linux NAME_MAX=255、PATH_MAX=4096，取 1024 作为保守上限。
export const MAX_PATH_LENGTH = 1024;

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'",
};

// 机器可读错误码：客户端按 code 分支，按 error 展示文案。
const STATUS_CODES = {
  400: 'BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
};

// 携带 HTTP 状态码的错误，让引导层区分客户端错误与服务端错误。
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(res, status, data) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

export function fail(res, status, message, code = STATUS_CODES[status] || 'ERROR') {
  json(res, status, { error: message, code });
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let settled = false;
    const rejectOnce = (status, message) => {
      if (settled) return;
      settled = true;
      reject(new HttpError(status, message));
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectOnce(413, '请求体过大');
        req.resume(); // 丢弃剩余数据，让上层写回 413 而不是直接重置连接
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSON 解析失败'));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
