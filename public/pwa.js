// Installable app + offline: register the service worker (not on the local dev server, where files change
// all the time and a cache would only get in the way)
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
