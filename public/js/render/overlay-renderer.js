// 屏幕空间叠加层：基地受击/低血红色暗角贴图与 FPS 面板。
export class OverlayRenderer {
  // 屏幕空间红色暗角：基地受击闪烁 + 低血常驻警示，烘焙一次按透明度复用。
  buildHurtOverlay(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(width / 2));
    canvas.height = Math.max(2, Math.round(height / 2));
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) * 0.2,
      canvas.width / 2,
      canvas.height / 2,
      Math.max(canvas.width, canvas.height) * 0.62
    );
    grad.addColorStop(0, 'rgba(255, 40, 40, 0)');
    grad.addColorStop(0.65, 'rgba(255, 40, 40, 0.25)');
    grad.addColorStop(1, 'rgba(255, 32, 32, 0.85)');
    g.fillStyle = grad;
    g.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  drawHurt(g, texture, width, height, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(texture, 0, 0, width, height);
    g.restore();
  }

  drawFps(g, fps, enemyCount) {
    g.save();
    g.fillStyle = 'rgba(5, 10, 13, 0.62)';
    g.fillRect(10, 10, 132, 24);
    g.fillStyle = '#9fe8cf';
    g.font = '600 12px "DejaVu Sans Mono", ui-monospace, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${Math.round(fps)} FPS · 敌 ${enemyCount}`, 18, 22);
    g.restore();
  }
}
