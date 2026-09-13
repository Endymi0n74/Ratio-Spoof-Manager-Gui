export class SpeedChart {
  constructor(container, options = {}) {
    this.container = container;
    this.maxPoints = options.maxPoints || 60;
    this.data = [];
    this.height = options.height || 60;
    this.color = options.color || '#22c55e';
    this._cssWidth = 0;
    this.render();
  }

  render() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speed-chart';
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
    this.resize();
  }

  resize() {
    this._cssWidth = this.container.getBoundingClientRect().width || 300;
    this.canvas.style.width = this._cssWidth + 'px';
    this.canvas.style.height = this.height + 'px';
    this.draw();
  }

  push(value) {
    this.data.push(value);
    if (this.data.length > this.maxPoints) this.data.shift();
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this._cssWidth;
    const h = this.height;
    const dpr = window.devicePixelRatio || 1;

    // La taille physique reste constante : réassigner canvas.width réinitialise aussi le transform
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    if (this.data.length < 2) return;

    const max = Math.max(...this.data, 1);
    const step = w / (this.maxPoints - 1);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.color + '40');
    grad.addColorStop(1, this.color + '00');

    ctx.beginPath();
    ctx.moveTo(0, h);
    this.data.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 4);
      ctx.lineTo(x, y);
    });
    ctx.lineTo((this.data.length - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}