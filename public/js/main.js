// 页面入口：安装启动错误收集，创建编排控制器并启动。
import { BootErrorReporter } from './app/boot-errors.js';
import { GameController } from './app/controller.js';

new BootErrorReporter().install();
new GameController().boot();
