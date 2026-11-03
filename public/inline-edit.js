// Edit a piece of text where it is: Enter or clicking away saves, Esc cancels.
function inlineEdit(el, { value, onSave }) {
  if (el.isContentEditable) return;
  el.textContent = value;
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    el.contentEditable = 'true';
  }
  el.spellcheck = false;
  el.classList.add('editing');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  getSelection().removeAllRanges();
  getSelection().addRange(range);

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    getSelection().removeAllRanges();
    const next = el.textContent.replace(/\s+/g, ' ').trim();
    if (!save || !next || next === value) {
      el.textContent = value;
      return;
    }
    el.textContent = next;
    await onSave(next);
  };
  const onKey = (e) => {
    e.stopPropagation(); // keep app shortcuts (and card "Enter to open") out of the way
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}
