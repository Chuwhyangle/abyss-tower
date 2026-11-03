// 预期内的领域/请求错误：路由层据此选择状态码，其余异常继续上抛。
// 独立成模块以避免 run-service 与 tower-service 之间的 import 环。
export class RunError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'RunError';
    this.status = status;
    this.code = code;
  }
}
