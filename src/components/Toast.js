export class Toast {
  static container = null;

  static getContainer() {
    if (!Toast.container) {
      Toast.container = document.getElementById('toast-container');
      if (!Toast.container) {
        Toast.container = document.createElement('div');
        Toast.container.id = 'toast-container';
        Toast.container.className = 'toast-container';
        document.body.appendChild(Toast.container);
      }
    }
    return Toast.container;
  }

  static show(message, type = 'info', duration = 4000) {
    const container = Toast.getContainer();
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconSvg = type === 'success'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M19.3027 5.9053C19.6542 5.55397 20.2247 5.55388 20.5761 5.9053C20.9273 6.25675 20.9273 6.82734 20.5761 7.17874L9.65911 18.0948C9.30773 18.4461 8.73814 18.446 8.38665 18.0948L3.42376 13.1328C3.0726 12.7814 3.07263 12.2118 3.42376 11.8604C3.77524 11.509 4.34575 11.5089 4.6972 11.8604L9.02239 16.1856L19.3027 5.9053Z" fill="currentColor"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="currentColor"/></svg>`;

    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.animation = 'toastIn 0.25s ease forwards';
    });

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.25s ease-in forwards';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  static success(message) { Toast.show(message, 'success'); }
  static error(message) { Toast.show(message, 'error'); }
  static info(message) { Toast.show(message, 'info'); }
}
