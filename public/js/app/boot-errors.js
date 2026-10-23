// 全局错误提示：未捕获异常、Promise 拒绝与离线状态显示为顶部可关闭错误条。
// 错误条固定在页面顶部，不遮挡也不拦截游戏操作；完整错误仍写入控制台，供排查。
import { t } from '../i18n.js';

let activeReporter = null;

export function reportRetryableError(message, onRetry) {
  activeReporter?.showRetryable(message, onRetry);
}

export function clearRetryableError() {
  activeReporter?.clearRetryable();
}

export class BootErrorReporter {
  constructor(win = window, doc = document) {
    this.win = win;
    this.doc = doc;
    this.bar = null;
    this.text = null;
    this.retryButton = null;
    this.closeButton = null;
    this.mode = 'hidden';
  }

  install() {
    if (this.win.__bootErrors === undefined) this.win.__bootErrors = [];
    this.buildBar();

    this.win.addEventListener('error', (event) => {
      console.error('[boot] 未捕获异常', event.error || event.message);
      this.record(event.message || 'Script error');
    });
    this.win.addEventListener('unhandledrejection', (event) => {
      console.error('[boot] 未处理的 Promise 拒绝', event.reason);
      const reason = event.reason;
      this.record(reason?.message || reason || 'Unhandled promise rejection');
    });
    this.win.addEventListener('rtd:offline', () => this.showOffline());
    this.win.addEventListener('rtd:online', () => this.hideOffline());
    this.doc.addEventListener?.('i18n:change', () => this.syncStaticCopy());

    activeReporter = this;
  }

  buildBar() {
    if (this.bar) return;
    const bar = this.doc.createElement('div');
    bar.id = 'global-error-bar';
    bar.setAttribute('role', 'alert');
    // hidden 属性会被内联 display 覆盖，显隐统一走 style.display。
    bar.style.display = 'none';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      alignItems: 'center',
      gap: '10px',
      maxWidth: 'min(92vw, 720px)',
      padding: '8px 12px',
      border: '1px solid rgba(255, 120, 120, 0.45)',
      borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      background: 'rgba(24, 12, 12, 0.95)',
      color: '#ffd9b0',
      font: '12.5px/1.5 system-ui, sans-serif',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
    });

    const text = this.doc.createElement('span');
    Object.assign(text.style, { flex: '1', minWidth: '0' });

    const retry = this.doc.createElement('button');
    retry.type = 'button';
    retry.textContent = t('diagnostics.retry');
    Object.assign(retry.style, {
      padding: '3px 12px',
      border: '1px solid rgba(255, 211, 107, 0.5)',
      borderRadius: '999px',
      background: 'transparent',
      color: '#ffd36b',
      cursor: 'pointer',
      font: 'inherit',
    });
    retry.hidden = true;

    const close = this.doc.createElement('button');
    close.type = 'button';
    close.textContent = t('diagnostics.close');
    close.setAttribute('aria-label', t('diagnostics.closeAria'));
    Object.assign(close.style, {
      padding: '3px 8px',
      border: 'none',
      background: 'transparent',
      color: '#b9c6cc',
      cursor: 'pointer',
      font: 'inherit',
    });

    bar.append(text, retry, close);
    this.doc.body.appendChild(bar);

    this.bar = bar;
    this.text = text;
    this.retryButton = retry;
    this.closeButton = close;

    close.onclick = () => this.hide();
    retry.onclick = () => {
      const action = this.pendingRetry;
      this.pendingRetry = null;
      this.hide();
      action?.();
    };
  }

  // 语言切换后同步错误条自身的按钮文案；正在显示的消息保持当次原文。
  syncStaticCopy() {
    if (this.retryButton) this.retryButton.textContent = t('diagnostics.retry');
    if (this.closeButton) {
      this.closeButton.textContent = t('diagnostics.close');
      this.closeButton.setAttribute('aria-label', t('diagnostics.closeAria'));
    }
  }

  // 未捕获异常：记录给冒烟测试读取，并提示玩家可刷新；不展示堆栈。
  record(message) {
    this.win.__bootErrors.push(String(message));
    this.show(t('diagnostics.uncaught'), { mode: 'uncaught' });
  }

  showRetryable(message, onRetry) {
    this.pendingRetry = typeof onRetry === 'function' ? onRetry : null;
    this.show(message || t('diagnostics.fallback'), {
      mode: 'retryable',
      retry: !!this.pendingRetry,
    });
  }

  clearRetryable() {
    if (this.mode === 'retryable') this.hide();
  }

  showOffline() {
    // 离线提示优先级最高：即使已有其他错误条，也替换为离线状态。
    this.pendingRetry = null;
    this.show(t('diagnostics.offline'), {
      mode: 'offline',
      retry: false,
    });
  }

  hideOffline() {
    if (this.mode === 'offline') this.hide();
  }

  show(message, { mode = 'uncaught', retry = false } = {}) {
    if (!this.bar) return;
    this.mode = mode;
    this.text.textContent = String(message);
    if (!retry) this.pendingRetry = null;
    this.retryButton.hidden = !retry;
    this.bar.style.display = 'flex';
  }

  hide() {
    if (!this.bar) return;
    this.mode = 'hidden';
    this.pendingRetry = null;
    this.bar.style.display = 'none';
  }
}
