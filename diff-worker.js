// diff-worker.js
(() => {
  'use strict';

  // diffライブラリ側の中止条件。時間と探索量の両方で極端な入力を止める。
  const diffOptions = {
    timeout: 25000,
    maxEditLength: 100000,
  };
  const loadErrorMessage = '差分ライブラリを読み込めませんでした。vendor/diff.min.js を確認してください。';
  const diffErrorMessage = '差分計算中に問題が発生しました。';

  let loadError = null;

  // GitHub Pagesでもそのまま動くよう、Worker内で同梱ライブラリを読み込む。
  try {
    importScripts('vendor/diff.min.js');
  } catch (error) {
    loadError = loadErrorMessage;
  }

  function normalizeParts(parts) {
    // Worker境界をまたいでも扱いやすいよう、表示に必要な値だけに整える。
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
      // modeに応じて行単位または単語単位で比較し、中止条件は共通化する。
      const parts = mode === 'word'
        ? self.Diff.diffWordsWithSpace(before, after, diffOptions)
        : self.Diff.diffLines(before, after, diffOptions);

      // diffライブラリはtimeout/maxEditLength到達時にundefinedを返す。
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
