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
  const lineContextSize = 3;

  // 連続実行時に古いWorkerの結果を画面へ反映しないため、現在の要求だけを追跡する。
  let activeWorker = null;
  let activeWorkerTimeoutId = null;
  let latestRequestId = 0;

  function getMode() {
    const selected = document.querySelector('input[name="diffMode"]:checked');
    return selected ? selected.value : 'line';
  }

  function getViewMode() {
    const selected = document.querySelector('input[name="viewMode"]:checked');
    return selected ? selected.value : 'unified';
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

  function toLineRows(parts) {
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

        rows.push({ type, oldNumber, newNumber, prefix, content });

        if (!part.added) {
          oldLine += 1;
        }
        if (!part.removed) {
          newLine += 1;
        }
      });
    });

    return rows;
  }

  function renderLineRow(row) {
    return `
      <tr class="${row.type}">
        <td class="line-number" aria-label="旧テキスト行番号">${row.oldNumber}</td>
        <td class="line-number" aria-label="新テキスト行番号">${row.newNumber}</td>
        <td class="line-prefix" aria-hidden="true">${row.prefix}</td>
        <td class="line-content">${row.content.length > 0 ? escapeHtml(row.content) : '&nbsp;'}</td>
      </tr>
    `;
  }

  function renderCollapsedRow(id, rows) {
    return `
      <tr class="diff-collapsed">
        <td colspan="4">
          <button type="button" class="expand-lines" data-collapse-id="${id}">
            ... ${rows.length}行 変更なしを展開
          </button>
        </td>
      </tr>
    `;
  }

  function renderLineDiff(parts) {
    const lineRows = toLineRows(parts);
    const changedIndexes = [];

    lineRows.forEach((row, index) => {
      if (row.type !== 'diff-unchanged') {
        changedIndexes.push(index);
      }
    });

    if (changedIndexes.length === 0) {
      result.innerHTML = '<p class="empty-result">差分はありません。</p>';
      return;
    }

    const visible = new Uint8Array(lineRows.length);
    changedIndexes.forEach((index) => {
      const start = Math.max(0, index - lineContextSize);
      const end = Math.min(lineRows.length - 1, index + lineContextSize);
      for (let i = start; i <= end; i += 1) {
        visible[i] = 1;
      }
    });

    const collapsedBlocks = new Map();
    const renderedRows = [];
    let collapsedId = 0;
    let index = 0;

    while (index < lineRows.length) {
      if (visible[index]) {
        renderedRows.push(renderLineRow(lineRows[index]));
        index += 1;
        continue;
      }

      const start = index;
      while (index < lineRows.length && !visible[index]) {
        index += 1;
      }

      const blockRows = lineRows.slice(start, index);
      const id = String(collapsedId);
      collapsedId += 1;
      collapsedBlocks.set(id, blockRows);
      renderedRows.push(renderCollapsedRow(id, blockRows));
    }

    result.innerHTML = `<table class="diff-table"><tbody>${renderedRows.join('')}</tbody></table>`;
    result.querySelectorAll('.expand-lines').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.collapseId;
        const blockRows = collapsedBlocks.get(id);
        const row = button.closest('tr');
        if (!blockRows || !row) {
          return;
        }

        row.insertAdjacentHTML('beforebegin', blockRows.map(renderLineRow).join(''));
        row.remove();
        collapsedBlocks.delete(id);
      });
    });
  }

  function toSplitRows(lineRows) {
    const rows = [];
    let index = 0;

    while (index < lineRows.length) {
      const row = lineRows[index];

      if (row.type === 'diff-unchanged') {
        rows.push({
          type: 'split-unchanged',
          oldNumber: row.oldNumber,
          newNumber: row.newNumber,
          oldContent: row.content,
          newContent: row.content,
        });
        index += 1;
        continue;
      }

      if (row.type === 'diff-removed') {
        const removedRows = [];
        const addedRows = [];

        while (index < lineRows.length && lineRows[index].type === 'diff-removed') {
          removedRows.push(lineRows[index]);
          index += 1;
        }

        while (index < lineRows.length && lineRows[index].type === 'diff-added') {
          addedRows.push(lineRows[index]);
          index += 1;
        }

        const length = Math.max(removedRows.length, addedRows.length);
        for (let i = 0; i < length; i += 1) {
          const removed = removedRows[i];
          const added = addedRows[i];
          rows.push({
            type: 'split-changed',
            oldNumber: removed ? removed.oldNumber : '',
            newNumber: added ? added.newNumber : '',
            oldContent: removed ? removed.content : '',
            newContent: added ? added.content : '',
            oldChanged: removed !== undefined,
            newChanged: added !== undefined,
          });
        }
        continue;
      }

      rows.push({
        type: 'split-changed',
        oldNumber: '',
        newNumber: row.newNumber,
        oldContent: '',
        newContent: row.content,
        oldChanged: false,
        newChanged: true,
      });
      index += 1;
    }

    return rows;
  }

  function renderSplitCell(content, changed, side) {
    const sideClass = side === 'old' ? 'split-old-content' : 'split-new-content';
    const changedClass = changed ? ` ${sideClass}-changed` : '';
    const className = `split-content ${sideClass}${changedClass}`;
    return `<td class="${className}">${content.length > 0 ? escapeHtml(content) : '&nbsp;'}</td>`;
  }

  function renderSplitRow(row) {
    return `
      <tr class="${row.type}">
        <td class="split-line-number" aria-label="旧テキスト行番号">${row.oldNumber}</td>
        ${renderSplitCell(row.oldContent, row.oldChanged, 'old')}
        <td class="split-line-number" aria-label="新テキスト行番号">${row.newNumber}</td>
        ${renderSplitCell(row.newContent, row.newChanged, 'new')}
      </tr>
    `;
  }

  function renderSplitLineDiff(parts) {
    const lineRows = toLineRows(parts);
    const splitRows = toSplitRows(lineRows);
    const changedIndexes = [];

    splitRows.forEach((row, index) => {
      if (row.type !== 'split-unchanged') {
        changedIndexes.push(index);
      }
    });

    if (changedIndexes.length === 0) {
      result.innerHTML = '<p class="empty-result">差分はありません。</p>';
      return;
    }

    const visible = new Uint8Array(splitRows.length);
    changedIndexes.forEach((index) => {
      const start = Math.max(0, index - lineContextSize);
      const end = Math.min(splitRows.length - 1, index + lineContextSize);
      for (let i = start; i <= end; i += 1) {
        visible[i] = 1;
      }
    });

    const collapsedBlocks = new Map();
    const renderedRows = [];
    let collapsedId = 0;
    let index = 0;

    while (index < splitRows.length) {
      if (visible[index]) {
        renderedRows.push(renderSplitRow(splitRows[index]));
        index += 1;
        continue;
      }

      const start = index;
      while (index < splitRows.length && !visible[index]) {
        index += 1;
      }

      const blockRows = splitRows.slice(start, index);
      const id = String(collapsedId);
      collapsedId += 1;
      collapsedBlocks.set(id, blockRows);
      renderedRows.push(renderCollapsedRow(id, blockRows));
    }

    result.innerHTML = `<table class="diff-table split-diff-table"><tbody>${renderedRows.join('')}</tbody></table>`;
    result.querySelectorAll('.expand-lines').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.collapseId;
        const blockRows = collapsedBlocks.get(id);
        const row = button.closest('tr');
        if (!blockRows || !row) {
          return;
        }

        row.insertAdjacentHTML('beforebegin', blockRows.map(renderSplitRow).join(''));
        row.remove();
        collapsedBlocks.delete(id);
      });
    });
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
      if (getViewMode() === 'split') {
        renderSplitLineDiff(parts);
      } else {
        renderLineDiff(parts);
      }

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
