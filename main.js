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
  const diffOptions = {
    timeout: 3000,
    maxEditLength: 20000,
  };
  const diffAbortedMessage = '差分計算が長時間かかったため中止しました。入力を小さく分けるか、差分範囲を絞って再度お試しください。';

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

  function compare() {
    if (typeof window.Diff === 'undefined') {
      showEmpty('差分ライブラリを読み込めませんでした。vendor/diff.min.js を確認してください。');
      return;
    }

    const before = oldText.value;
    const after = newText.value;

    if (before.length === 0 && after.length === 0) {
      showEmpty(emptyMessage);
      return;
    }

    const mode = getMode();
    const parts = mode === 'word'
      ? window.Diff.diffWordsWithSpace(before, after, diffOptions)
      : window.Diff.diffLines(before, after, diffOptions);

    if (typeof parts === 'undefined') {
      showAborted();
      return;
    }

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

  function clearAll() {
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
