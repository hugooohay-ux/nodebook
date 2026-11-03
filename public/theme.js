// Theme: 'auto' follows the system, or forced 'light' / 'dark'. Loaded in <head> to avoid a flash.
const Theme = (() => {
  const KEY = 'nodebook:theme';
  const ORDER = ['auto', 'light', 'dark'];
  const LABEL = { auto: 'Theme: auto (follows system)', light: 'Theme: light', dark: 'Theme: dark' };
  const ICON = { auto: '◐', light: '☀', dark: '☾' };
  const listeners = [];

  let mode = 'auto';
  try { mode = localStorage.getItem(KEY) || 'auto'; } catch { /* storage blocked */ }

  function apply() {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = mode;
    document.querySelectorAll('.theme-toggle').forEach((b) => {
      b.textContent = ICON[mode];
      b.title = LABEL[mode] + ' — click to change';
    });
  }

  function cycle() {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ }
    apply();
    listeners.forEach((fn) => fn());
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', cycle));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => listeners.forEach((fn) => fn()));

  return { onChange: (fn) => listeners.push(fn) };
})();
