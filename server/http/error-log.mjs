// 错误日志：固定容量环形缓冲 + 可选追加文件（单文件硬上限、单份滚动）。
// 日志是排障辅助，任何写入失败都必须被吞掉，不能影响请求主路径。
import fs from 'node:fs';

export const DEFAULT_CAPACITY = 200;
export const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
export const DIAGNOSTICS_LIMIT = 50;

const REDACTED = '[已脱敏]';
const MAX_MESSAGE_CHARS = 500;
const MAX_PATH_CHARS = 300;
const MAX_CODE_CHARS = 40;

// 敏感键：密码、token、恢复码、会话凭据等。只匹配「键 + 赋值」形态，
// 避免把普通文案里的 token 一词也误伤。
const SENSITIVE_ASSIGN =
  /["']?(?:pass(?:word|wd)?|pwd|token|access[_-]?token|refresh[_-]?token|recovery[\s_-]*code|secret|authorization|cookie|session|credential)["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const AUTH_SCHEME = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// 恢复码：8 组 4 位大写字母/数字。
const RECOVERY_CODE = /\b[A-Z2-9]{4}(?:-[A-Z2-9]{4}){7}\b/g;
const SCRYPT_HASH = /scrypt\$[^\s"']+/gi;

function safeText(value, limit = MAX_MESSAGE_CHARS) {
  try {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : String(value);
    return text.slice(0, limit);
  } catch {
    return '[错误信息不可读]';
  }
}

// 对任意文本做脱敏；永不抛出。
export function redactErrorText(value) {
  const text = safeText(value);
  try {
    // 先处理 Bearer/Basic（值里含空格），再处理键值对。
    return text
      .replace(AUTH_SCHEME, REDACTED)
      .replace(SENSITIVE_ASSIGN, REDACTED)
      .replace(RECOVERY_CODE, REDACTED)
      .replace(SCRYPT_HASH, REDACTED);
  } catch {
    return REDACTED;
  }
}

function normalizeEntry(input, now) {
  const raw = input && typeof input === 'object' ? input : {};
  const method = safeText(raw.method, 16).toUpperCase().replace(/[^A-Z]/g, '');
  const path = redactErrorText(safeText(raw.path, MAX_PATH_CHARS));
  const status =
    Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599 ? raw.status : 0;
  const code = safeText(raw.code, MAX_CODE_CHARS).replace(/[^A-Za-z0-9_]/g, '');
  const message = redactErrorText(raw.message);
  const time = Number.isFinite(raw.time) ? Math.trunc(raw.time) : now;
  return { time, method, path, status, code, message };
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class ErrorLog {
  #capacity;
  #entries;
  #index = 0;
  #count = 0;
  #filePath;
  #maxFileBytes;
  #fileBytes = 0;
  #now;

  constructor({
    capacity = DEFAULT_CAPACITY,
    filePath = null,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    now = Date.now,
  } = {}) {
    this.#capacity = positiveInt(capacity, DEFAULT_CAPACITY);
    this.#entries = new Array(this.#capacity).fill(null);
    this.#maxFileBytes = positiveInt(maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.#filePath = filePath ? String(filePath) : null;
    this.#now = typeof now === 'function' ? now : Date.now;
    if (this.#filePath) this.#initFile();
  }

  get capacity() {
    return this.#capacity;
  }

  get size() {
    return this.#count;
  }

  // 记录一条错误摘要；返回入库条目（或 null）。绝不抛出。
  record(input = {}) {
    try {
      let now;
      try {
        now = this.#now();
      } catch {
        now = Date.now();
      }
      const entry = normalizeEntry(input, now);
      this.#entries[this.#index] = entry;
      this.#index = (this.#index + 1) % this.#capacity;
      if (this.#count < this.#capacity) this.#count += 1;
      this.#append(entry);
      return { ...entry };
    } catch {
      return null;
    }
  }

  // 最近的 limit 条，新→旧。返回副本，调用方无法改动缓冲。
  recent(limit = DIAGNOSTICS_LIMIT) {
    try {
      const wanted = Number.isInteger(limit) ? limit : DIAGNOSTICS_LIMIT;
      const take = Math.max(0, Math.min(wanted, this.#count));
      const result = [];
      for (let offset = 1; offset <= take; offset += 1) {
        const slot = (this.#index - offset + this.#capacity * 2) % this.#capacity;
        const entry = this.#entries[slot];
        if (entry) result.push({ ...entry });
      }
      return result;
    } catch {
      return [];
    }
  }

  clear() {
    try {
      this.#entries.fill(null);
      this.#index = 0;
      this.#count = 0;
    } catch {
      /* 清理失败不影响后续记录 */
    }
  }

  #initFile() {
    try {
      const stat = fs.statSync(this.#filePath);
      this.#fileBytes = stat.size;
      if (this.#fileBytes > this.#maxFileBytes) this.#rotate();
    } catch {
      this.#fileBytes = 0;
    }
  }

  #append(entry) {
    if (!this.#filePath) return;
    try {
      const line = `${JSON.stringify(entry)}\n`;
      const bytes = Buffer.byteLength(line);
      // 单条就超过文件上限：直接丢弃，保证硬上限不被单条绕过。
      if (bytes > this.#maxFileBytes) return;
      if (this.#fileBytes + bytes > this.#maxFileBytes) this.#rotate();
      fs.appendFileSync(this.#filePath, line, { mode: 0o600 });
      this.#fileBytes += bytes;
    } catch {
      // 磁盘只读/目录不存在等：只丢日志，不影响请求。
    }
  }

  #rotate() {
    try {
      fs.renameSync(this.#filePath, `${this.#filePath}.1`);
    } catch {
      try {
        fs.writeFileSync(this.#filePath, '', { mode: 0o600 });
      } catch {
        /* 无法滚动时保持静默 */
      }
    }
    this.#fileBytes = 0;
  }
}

function envInt(name, fallback) {
  return positiveInt(process.env[name], fallback);
}

// 进程内单例：默认只占固定内存；设置 ERROR_LOG_FILE 后追加写文件。
export const errorLog = new ErrorLog({
  capacity: envInt('ERROR_LOG_CAPACITY', DEFAULT_CAPACITY),
  maxFileBytes: envInt('ERROR_LOG_MAX_BYTES', DEFAULT_MAX_FILE_BYTES),
  filePath: process.env.ERROR_LOG_FILE || null,
});

// 供统一错误处理路径调用：任何字段读取异常都不能冒泡。
export function recordRequestError({ req, pathname, status, code, message, error } = {}) {
  try {
    let detail = message;
    if (detail === undefined) {
      try {
        detail = error?.message;
      } catch {
        detail = '[错误信息不可读]';
      }
    }
    return errorLog.record({
      method: req?.method || '',
      path: pathname || '',
      status,
      code,
      message: detail,
    });
  } catch {
    return null;
  }
}

// 未捕获异常/未处理拒绝：先落盘记录，再保持 Node 的失败退出语义。
export function installProcessErrorHandlers(log = errorLog) {
  let exiting = false;
  const fatal = (kind, error) => {
    if (exiting) return;
    exiting = true;
    try {
      log.record({
        method: 'PROCESS',
        path: kind,
        status: 500,
        code: kind === 'uncaughtException' ? 'UNCAUGHT_EXCEPTION' : 'UNHANDLED_REJECTION',
        message: error?.message ?? error,
      });
    } catch {
      /* 记录失败也要退出 */
    }
    try {
      console.error(`[${kind}]`, error);
    } catch {
      /* ignore */
    }
    process.exit(1);
  };
  process.on('uncaughtException', (error) => fatal('uncaughtException', error));
  process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
}
