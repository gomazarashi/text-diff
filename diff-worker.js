// diff-worker.js
(() => {
  'use strict';

  const diffOptions = {
    timeout: 25000,
    maxEditLength: 100000,
  };
  const loadErrorMessage = '差分ライブラリを読み込めませんでした。vendor/diff.min.js を確認してください。';
  const diffErrorMessage = '差分計算中に問題が発生しました。';

  let loadError = null;

  try {
    importScripts('vendor/diff.min.js');
  } catch (error) {
    loadError = loadErrorMessage;
  }

  function normalizeParts(parts) {
    return parts.map((part) => ({
      value: part.value,
      added: part.added === true,
      removed: part.removed === true,
    }));
  }

  self.addEventListener('message', (event) => {
    const { requestId, before, after, mode } = event.data || {};

    if (loadError || typeof self.Diff === 'undefined') {
      self.postMessage({ type: 'error', requestId, message: loadError || loadErrorMessage });
      return;
    }

    try {
      const parts = mode === 'word'
        ? self.Diff.diffWordsWithSpace(before, after, diffOptions)
        : self.Diff.diffLines(before, after, diffOptions);

      if (typeof parts === 'undefined') {
        self.postMessage({ type: 'aborted', requestId });
        return;
      }

      self.postMessage({
        type: 'result',
        requestId,
        mode: mode === 'word' ? 'word' : 'line',
        parts: normalizeParts(parts),
      });
    } catch (error) {
      self.postMessage({ type: 'error', requestId, message: diffErrorMessage });
    }
  });
})();
