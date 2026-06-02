// 直近の検索クエリを localStorage に保存する小モジュール。
// データ構造: キー 'ssa_history' に JSON 文字列配列（新しい順）。最大8件。日付は持たない。
// 例: ["明るいオフィスで打ち合わせ", "桜 風景 春"]

const STORAGE_KEY = 'ssa_history';
const MAX_ITEMS = 8;

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function persist(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 容量超過・プライベートモード等は黙って無視 */
  }
}

/** @returns {string[]} 新しい順の検索履歴 */
export function getHistory() {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY) ?? '[]');
}

/**
 * 履歴に追加（重複は先頭へ繰り上げ、最大件数で切る）。新しい配列を返す。
 * @param {string} query
 * @returns {string[]}
 */
export function addHistory(query) {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return getHistory();
  const current = getHistory().filter((item) => item !== trimmed);
  const next = [trimmed, ...current].slice(0, MAX_ITEMS);
  persist(next);
  return next;
}

/** 履歴を全消去。 */
export function clearHistory() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ストレージ無効環境では無視 */
  }
}
