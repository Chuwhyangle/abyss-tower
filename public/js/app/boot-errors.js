// 启动期错误收集：未捕获异常与 Promise 拒绝写入隐藏的错误面板，供冒烟测试读取。
export class BootErrorReporter {
  constructor(win = window, doc = document) {
    this.win = win;
    this.doc = doc;
    this.box = null;
  }

  install() {
    const box = this.doc.createElement('div');
    box.id = 'boot-errors';
    box.style.display = 'none';
    this.doc.body.appendChild(box);
    this.box = box;
    this.win.__bootErrors = [];

    this.win.addEventListener('error', (event) =>
      this.record(event.message || 'script error')
    );
    this.win.addEventListener('unhandledrejection', (event) =>
      this.record(event.reason || 'promise rejection')
    );
  }

  record(message) {
    this.win.__bootErrors.push(String(message));
    this.box.textContent = this.win.__bootErrors.join('\n');
  }
}
