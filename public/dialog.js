// In-app dialogs. The browser's own confirm()/prompt() are blocked in some embedded browsers
// (they return "cancel" without showing anything), so Nodebook draws its own.
const Dialog = (() => {
  function open({ title, message = '', input, okLabel = 'OK', danger = false, cancel = true }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';
      backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
          <h2 class="dialog-title"></h2>
          <p class="dialog-msg"></p>
          ${input !== undefined ? '<input class="dialog-input" type="text" spellcheck="false">' : ''}
          <div class="dialog-actions">
            ${cancel ? '<button class="dialog-cancel">Cancel</button>' : ''}
            <button class="dialog-ok ${danger ? 'danger-btn' : 'primary'}"></button>
          </div>
        </div>`;
      backdrop.querySelector('.dialog-title').textContent = title;
      backdrop.querySelector('.dialog-msg').textContent = message;
      backdrop.querySelector('.dialog-msg').hidden = !message;
      backdrop.querySelector('.dialog-ok').textContent = okLabel;
      const field = backdrop.querySelector('.dialog-input');
      if (field) field.value = input;

      const close = (value) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      };
      const accept = () => close(field ? field.value.trim() || null : true);
      const dismiss = () => close(field ? null : false);
      // Captured first so app shortcuts don't fire while the dialog is open (typing still works)
      const onKey = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          dismiss();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          accept();
        }
      };
      backdrop.querySelector('.dialog-ok').addEventListener('click', accept);
      backdrop.querySelector('.dialog-cancel')?.addEventListener('click', dismiss);
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      if (field) {
        field.focus();
        field.select();
      } else backdrop.querySelector('.dialog-ok').focus();
    });
  }

  return {
    // Resolves true/false
    confirm: (message, { title = 'Are you sure?', okLabel = 'OK', danger = false } = {}) => open({ title, message, okLabel, danger }),
    // Resolves the entered text, or null when cancelled
    prompt: (title, value = '', { message = '', okLabel = 'Save' } = {}) => open({ title, message, input: value, okLabel }),
    alert: (message, title = 'Something went wrong') => open({ title, message, cancel: false }).then(() => {}),
  };
})();
