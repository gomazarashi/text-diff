// main.js
(() => {
  'use strict';

  const oldText = document.getElementById('oldText');
  const newText = document.getElementById('newText');
  const compareButton = document.getElementById('compareButton');
  const clearButton = document.getElementById('clearButton');
  const result = document.getElementById('result');
  const status = document.getElementById('status');
  const addedCount = document.getElementById('addedCount');
  const removedCount = document.getElementById('removedCount');

  const emptyMessage = '比較対象のテキストを入力してください。';
  const diffAbortedMessage = '差分計算が長時間かかったため中止しました。入力を小さく分けるか、差分範囲を絞って再度お試しください。';
  const workerUnavailableMessage = 'このブラウザでは Web Worker を利用できないため、長文比較を実行できません。対応ブラウザで再度お試しください。';
  const workerErrorMessage = '差分計算中に問題が発生しました。時間をおいて再度お試しください。';
  // Worker側の終了通知が戻らない場合でも、画面を復帰させるための最終的な待機上限。
  const workerHardTimeoutMs = 30000;

  // 連続実行時に古いWorkerの結果を画面へ反映しないため、現在の要求だけを追跡する。
  let activeWorker = null;
  let activeWorkerTimeoutId = null;
  let latestRequestId = 0;

  function getMode() {
    const selected = document.querySelector('input[name="diffMode"]:checked');
    return selected ? selected.value : 'line';
  }

  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function splitLines(value) {
    if (value.length === 0) {
      return [];
    }

    // 末尾改行を含む行を1単位として扱い、空の最終要素だけを除外する。
    return value.match(/.*(?:\n|$)/g).filter((line) => line.length > 0);
  }

  function stripTrailingNewline(value) {
    return value.endsWith('\n') ? value.slice(0, -1) : value;
  }

  function countLineItems(parts) {
    return parts.reduce(
      (acc, part) => {
        const lines = splitLines(part.value).length;
        if (part.added) {
          acc.added += lines;
        } else if (part.removed) {
          acc.removed += lines;
        }
        return acc;
      },
      { added: 0, removed: 0 },
    );
  }

  function countWordItems(parts) {
    return parts.reduce(
      (acc, part) => {
        const tokenCount = part.value.trim().length === 0 ? 0 : part.value.trim().split(/\s+/).length;
        if (part.added) {
          acc.added += tokenCount;
        } else if (part.removed) {
          acc.removed += tokenCount;
        }
        return acc;
      },
      { added: 0, removed: 0 },
    );
  }

  function renderLineDiff(parts) {
    let oldLine = 1;
    let newLine = 1;
    const rows = [];

    parts.forEach((part) => {
      const type = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-unchanged';
      const prefix = part.added ? '+' : part.removed ? '-' : ' ';
      const lines = splitLines(part.value);

      lines.forEach((rawLine) => {
        const content = stripTrailingNewline(rawLine);
        const oldNumber = part.added ? '' : oldLine;
        const newNumber = part.removed ? '' : newLine;

        // 追加行には旧行番号、削除行には新行番号を出さず、左右の対応を崩さずに表示する。
        rows.push(`
          <tr class="${type}">
            <td class="line-number" aria-label="旧テキスト行番号">${oldNumber}</td>
            <td class="line-number" aria-label="新テキスト行番号">${newNumber}</td>
            <td class="line-prefix" aria-hidden="true">${prefix}</td>
            <td class="line-content">${content.length > 0 ? escapeHtml(content) : '&nbsp;'}</td>
          </tr>
        `);

        if (!part.added) {
          oldLine += 1;
        }
        if (!part.removed) {
          newLine += 1;
        }
      });
    });

    result.innerHTML = `<table class="diff-table"><tbody>${rows.join('')}</tbody></table>`;
  }

  function renderWordDiff(parts) {
    const html = parts.map((part) => {
      const content = escapeHtml(part.value);
      if (part.added) {
        return `<span class="inline-added">${content}</span>`;
      }
      if (part.removed) {
        return `<span class="inline-removed">${content}</span>`;
      }
      return content;
    }).join('');

    result.innerHTML = `<pre class="inline-diff">${html}</pre>`;
  }

  function showEmpty(message) {
    result.innerHTML = `<p class="empty-result">${escapeHtml(message)}</p>`;
    status.textContent = 'まだ比較していません。';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
  }

  function showAborted() {
    result.innerHTML = `<p class="empty-result">${escapeHtml(diffAbortedMessage)}</p>`;
    status.textContent = '差分計算を中止しました。';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
  }

  function showWorkerUnavailable() {
    result.innerHTML = `<p class="empty-result">${escapeHtml(workerUnavailableMessage)}</p>`;
    status.textContent = '差分計算を開始できませんでした。';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
  }

  function showWorkerError(message = workerErrorMessage) {
    result.innerHTML = `<p class="empty-result">${escapeHtml(message)}</p>`;
    status.textContent = '差分計算に失敗しました。';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
  }

  function showComparing() {
    result.innerHTML = '<p class="empty-result">差分計算中です...</p>';
    status.textContent = '差分計算中です。';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
  }

  function stopActiveWorker() {
    // 新しい比較やクリア操作が来たら、進行中のWorkerとタイマーをまとめて破棄する。
    if (activeWorkerTimeoutId) {
      window.clearTimeout(activeWorkerTimeoutId);
      activeWorkerTimeoutId = null;
    }

    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  }

  function finishCompare(worker) {
    // すでに別のWorkerへ切り替わっている場合は、古い完了通知として無視する。
    if (activeWorker === worker) {
      if (activeWorkerTimeoutId) {
        window.clearTimeout(activeWorkerTimeoutId);
        activeWorkerTimeoutId = null;
      }

      activeWorker = null;
      compareButton.disabled = false;
    }
  }

  function renderDiff(mode, parts) {
    const counts = mode === 'word' ? countWordItems(parts) : countLineItems(parts);

    if (mode === 'word') {
      renderWordDiff(parts);
      status.textContent = counts.added === 0 && counts.removed === 0
        ? '差分はありません。'
        : `単語単位の差分を表示しています。`;
    } else {
      renderLineDiff(parts);
      status.textContent = counts.added === 0 && counts.removed === 0
        ? '差分はありません。'
        : `行単位の差分を表示しています。`;
    }

    addedCount.textContent = String(counts.added);
    removedCount.textContent = String(counts.removed);
  }

  function compare() {
    if (typeof window.Worker === 'undefined') {
      showWorkerUnavailable();
      return;
    }

    const before = oldText.value;
    const after = newText.value;

    if (before.length === 0 && after.length === 0) {
      showEmpty(emptyMessage);
      return;
    }

    const mode = getMode();
    const requestId = latestRequestId + 1;
    latestRequestId = requestId;
    stopActiveWorker();

    // 差分計算は重くなり得るため、メインスレッドではなくWorkerで実行する。
    let worker;
    try {
      worker = new Worker('diff-worker.js');
    } catch (error) {
      showWorkerUnavailable();
      return;
    }

    activeWorker = worker;
    compareButton.disabled = true;
    showComparing();

    // Worker内のタイムアウトが効かない異常系でも、UIが計算中のまま残らないようにする。
    activeWorkerTimeoutId = window.setTimeout(() => {
      if (activeWorker !== worker || requestId !== latestRequestId) {
        return;
      }

      showAborted();
      finishCompare(worker);
      worker.terminate();
    }, workerHardTimeoutMs);

    worker.addEventListener('message', (event) => {
      const data = event.data;
      // 連続実行時に、先に始めた比較の遅い応答で最新結果を上書きしない。
      if (!data || data.requestId !== latestRequestId) {
        return;
      }

      if (data.type === 'result') {
        renderDiff(data.mode, data.parts);
      } else if (data.type === 'aborted') {
        showAborted();
      } else {
        showWorkerError(data.message);
      }

      finishCompare(worker);
      worker.terminate();
    });

    worker.addEventListener('error', () => {
      if (requestId !== latestRequestId) {
        return;
      }

      showWorkerError();
      finishCompare(worker);
      worker.terminate();
    });

    try {
      worker.postMessage({ requestId, before, after, mode });
    } catch (error) {
      showWorkerError();
      finishCompare(worker);
      worker.terminate();
    }
  }

  function clearAll() {
    // クリアは進行中の比較を無効化し、後から返るWorker応答も破棄対象にする。
    latestRequestId += 1;
    stopActiveWorker();
    compareButton.disabled = false;
    oldText.value = '';
    newText.value = '';
    showEmpty(emptyMessage);
    oldText.focus();
  }

  compareButton.addEventListener('click', compare);
  clearButton.addEventListener('click', clearAll);

  document.addEventListener('keydown', (event) => {
    const isModifier = event.ctrlKey || event.metaKey;
    if (isModifier && event.key === 'Enter') {
      event.preventDefault();
      compare();
    }
  });

  showEmpty(emptyMessage);
})();
