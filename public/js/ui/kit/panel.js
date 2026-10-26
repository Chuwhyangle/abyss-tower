// UI kit · 面板骨架：统一大厅面板的注册、打开/关闭、Esc 关闭、焦点归还、
// 加载态（aria-busy）与加载失败回调，业务渲染仍留在各面板自己的 render 里。
export class Panel {
  constructor({
    id,
    trigger = null,
    document: doc = globalThis.document,
    closeSelector = '[data-panel-close]',
    style = '',
    styleId = null,
    html = null,
    interceptClicks = false,
    refreshOnLocale = false,
    focusSelector = null,
    load = null,
    render = null,
    loading = null,
    failed = null,
    onMount = null,
    onOpen = null,
    onClose = null,
  } = {}) {
    this.doc = doc;
    this.id = id;
    this.panel = doc?.getElementById?.(id) || null;
    this.trigger = trigger || null;
    this.closeSelector = closeSelector;
    this.style = style;
    this.styleId = styleId || `${id}-kit-style`;
    this.html = html;
    this.interceptClicks = interceptClicks;
    this.refreshOnLocale = refreshOnLocale;
    this.focusSelector = focusSelector;
    this.load = load;
    this.render = render;
    this.loading = loading;
    this.failed = failed;
    this.onMount = onMount;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.mounted = false;
    this.previousFocus = null;
    this.pendingLoad = null;
  }

  get isOpen() {
    return !!this.panel && this.panel.hidden === false;
  }

  mount() {
    if (!this.panel || this.mounted) return this;
    this.mounted = true;
    this.ensureStyle();
    if (this.html != null) this.panel.innerHTML = this.html;
    if (this.panel.tabIndex == null) this.panel.tabIndex = -1;
    for (const node of this.panel.querySelectorAll(this.closeSelector)) {
      node.addEventListener('click', () => this.close());
    }
    if (this.trigger) {
      if (this.interceptClicks) {
        // 旧版大厅按钮自带 onclick 弹窗；在 document 捕获阶段截断，保证增强面板优先。
        this.doc.addEventListener(
          'click',
          (event) => {
            if (!event.target?.closest?.(`#${this.trigger.id}`)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this.toggle();
          },
          true
        );
      } else {
        this.trigger.addEventListener('click', () => this.toggle());
      }
    }
    if (this.refreshOnLocale) {
      this.doc.addEventListener('i18n:change', () => {
        if (this.isOpen) this.reload();
      });
    }
    this.onMount?.(this.panel, this);
    return this;
  }

  open() {
    if (!this.panel || this.isOpen) return this;
    this.previousFocus = this.doc?.activeElement || null;
    this.panel.hidden = false;
    this.trigger?.setAttribute?.('aria-expanded', 'true');
    this.bindEscape();
    this.focus();
    this.onOpen?.(this.panel, this);
    if (this.load) this.reload();
    return this;
  }

  close() {
    if (!this.panel || !this.isOpen) return this;
    this.panel.hidden = true;
    this.trigger?.setAttribute?.('aria-expanded', 'false');
    this.unbindEscape();
    this.onClose?.(this.panel, this);
    this.previousFocus?.focus?.();
    return this;
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  setOpen(open) {
    return open ? this.open() : this.close();
  }

  reload() {
    if (!this.panel || !this.load) return Promise.resolve(undefined);
    if (this.pendingLoad) return this.pendingLoad;
    this.panel.setAttribute?.('aria-busy', 'true');
    this.loading?.(this.panel, this);
    this.pendingLoad = Promise.resolve()
      .then(() => this.load(this.panel, this))
      .then((data) => {
        if (data !== undefined) this.render?.(this.panel, data, this);
        return data;
      })
      .catch((error) => {
        this.failed?.(this.panel, error, this);
        return undefined;
      })
      .finally(() => {
        this.pendingLoad = null;
        this.panel.removeAttribute?.('aria-busy');
      });
    return this.pendingLoad;
  }

  focus() {
    const target = this.focusSelector ? this.panel.querySelector(this.focusSelector) : null;
    (target || this.panel).focus?.();
  }

  bindEscape() {
    if (this._onKeydown) return;
    this._onKeydown = (event) => {
      if (event.key === 'Escape') this.close();
    };
    this.doc?.addEventListener?.('keydown', this._onKeydown);
  }

  unbindEscape() {
    if (!this._onKeydown) return;
    this.doc?.removeEventListener?.('keydown', this._onKeydown);
    this._onKeydown = null;
  }

  ensureStyle() {
    if (!this.style) return;
    if (this.doc.getElementById(this.styleId)) return;
    const node = this.doc.createElement('style');
    node.id = this.styleId;
    node.textContent = this.style;
    this.doc.head.appendChild(node);
  }
}

export function createPanel(options) {
  return new Panel(options).mount();
}
