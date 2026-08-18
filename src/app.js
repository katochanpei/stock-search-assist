// UI 配線。フォーム送信 → queryBuilder → 結果描画 → 履歴保存。
import { buildVariants } from './queryBuilder.js';
import { probe as probeTranslator } from './translator.js';
import { probe as probeNano, ensureReady as ensureNanoReady } from './nano.js';
import { getHistory, addHistory, clearHistory } from './history.js';

const form = document.getElementById('search-form');
const input = document.getElementById('query-input');
const generateBtn = document.getElementById('generate-btn');
const engineBadge = document.getElementById('engine-badge');
const resultsEl = document.getElementById('results');
const historyEl = document.getElementById('history');
const historyChipsEl = document.getElementById('history-chips');
const historyClearBtn = document.getElementById('history-clear');

const optContentType = document.getElementById('opt-content-type');
const optOrientation = document.getElementById('opt-orientation');
const optSubject = document.getElementById('opt-subject');
const optCopySpace = document.getElementById('opt-copyspace');
const optCandid = document.getElementById('opt-candid');
const optExcludeAI = document.getElementById('opt-exclude-ai');

const ENGINE_LABEL = {
  nano: '高精度AI（Gemini Nano）で変換',
  translator: '内蔵AI翻訳＋キーワード抽出で変換',
  dict: '辞書モードで変換',
  none: '日本語キーワードのみ（英語未抽出）',
};

// CSSの色分けは既存の data-engine='ai' / 'dict' を流用する
const ENGINE_BADGE_KIND = { nano: 'ai', translator: 'ai', dict: 'dict', none: 'dict' };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readOptions() {
  // 値が空（自動）の場合は undefined を渡し、queryBuilder 側の推定/既定に委ねる
  return {
    contentType: optContentType.value || undefined,
    orientation: optOrientation.value || undefined,
    subject: optSubject.value || 'jp',
    copySpace: optCopySpace.checked || undefined,
    candid: optCandid.checked || undefined,
    excludeAI: optExcludeAI.checked,
  };
}

function setEngineBadge(engine, customText) {
  if (!engine && !customText) {
    engineBadge.hidden = true;
    return;
  }
  engineBadge.hidden = false;
  if (customText) {
    engineBadge.removeAttribute('data-engine');
    engineBadge.textContent = customText;
    return;
  }
  engineBadge.dataset.engine = ENGINE_BADGE_KIND[engine] ?? 'dict';
  engineBadge.textContent = ENGINE_LABEL[engine] ?? '';
}

function variantCard(variant) {
  return `
    <article class="variant">
      <div class="variant__head"><h3 class="variant__label">${escapeHtml(variant.label)}</h3></div>
      <p class="variant__desc">${escapeHtml(variant.description)}</p>
      <p class="variant__keywords">${escapeHtml(variant.keywords)}</p>
      <div class="variant__actions">
        <a class="btn btn--primary" href="${escapeHtml(variant.url)}" target="_blank" rel="noopener">Adobe Stockで開く ↗</a>
        <button type="button" class="btn btn--ghost" data-copy="${escapeHtml(variant.url)}">リンクをコピー</button>
      </div>
    </article>`;
}

function renderVariants(result) {
  const blocks = [];
  if (result.engine === 'none' || result.baseKeywords.length === 0) {
    blocks.push(
      '<div class="notice">英語キーワードを自動抽出できなかったため、<strong>日本語キーワード版</strong>のみ表示しています。Chrome / Edge（内蔵AI対応）で開くと英語版も生成されます。</div>',
    );
  }
  for (const variant of result.variants) {
    blocks.push(variantCard(variant));
  }
  resultsEl.innerHTML = blocks.join('');
}

function renderHistory(list) {
  if (!list || list.length === 0) {
    historyEl.hidden = true;
    historyChipsEl.innerHTML = '';
    return;
  }
  historyEl.hidden = false;
  historyChipsEl.innerHTML = list
    .map((query) => `<button type="button" class="history-chip" data-q="${escapeHtml(query)}" title="${escapeHtml(query)}">${escapeHtml(query)}</button>`)
    .join('');
}

function flashCopied(button) {
  const original = button.textContent;
  button.textContent = 'コピーした ✓';
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  generateBtn.disabled = true;
  const originalLabel = generateBtn.textContent;
  generateBtn.textContent = '変換中…';
  setEngineBadge(null, '変換中…');

  try {
    const result = await buildVariants(text, readOptions(), (percent) => {
      setEngineBadge(null, `翻訳モデル準備中… ${percent}%`);
    });
    renderVariants(result);
    setEngineBadge(result.engine);
    renderHistory(addHistory(text));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    resultsEl.innerHTML = `<div class="notice">エラー: ${escapeHtml(message)}</div>`;
    setEngineBadge(null);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = originalLabel;
  }
}

function bindEvents() {
  form.addEventListener('submit', onSubmit);

  input.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  resultsEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    await copyText(button.getAttribute('data-copy'));
    flashCopied(button);
  });

  historyChipsEl.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-q]');
    if (!chip) return;
    input.value = chip.getAttribute('data-q');
    form.requestSubmit();
  });

  historyClearBtn.addEventListener('click', () => {
    clearHistory();
    renderHistory([]);
  });
}

const nanoPrepBtn = document.getElementById('nano-prep');

async function refreshEngineBadge() {
  const [nano, translator] = await Promise.all([probeNano(), probeTranslator()]);

  if (nano === 'available') {
    setEngineBadge(null, '高精度AI（Gemini Nano）：利用可');
    if (nanoPrepBtn) nanoPrepBtn.hidden = true;
    return;
  }
  if (nano === 'downloadable' && nanoPrepBtn) {
    nanoPrepBtn.hidden = false; // 明示ボタンでのみ巨大DLを開始する
  }
  if (translator === 'available') {
    setEngineBadge(null, '内蔵AI翻訳：利用可');
  } else if (translator === 'downloadable') {
    setEngineBadge(null, '内蔵AI翻訳：初回のみモデルDLあり');
  } else if (nano === 'downloadable') {
    setEngineBadge(null, '高精度AI：モデル準備で利用可（右のボタン）');
  } else {
    setEngineBadge(null, '辞書モードで動作（内蔵AI非対応の環境）');
  }
}

async function onNanoPrep() {
  if (!nanoPrepBtn) return;
  nanoPrepBtn.disabled = true;
  nanoPrepBtn.textContent = '高精度AIを準備中…';
  try {
    await ensureNanoReady((percent) => {
      setEngineBadge(null, `高精度AIモデルDL中… ${percent}%`);
    });
    nanoPrepBtn.hidden = true;
  } catch {
    nanoPrepBtn.textContent = '高精度AIの準備に失敗（再試行）';
    nanoPrepBtn.disabled = false;
  }
  await refreshEngineBadge();
}

async function init() {
  bindEvents();
  if (nanoPrepBtn) nanoPrepBtn.addEventListener('click', onNanoPrep);
  renderHistory(getHistory());
  await refreshEngineBadge();
}

init();
