// Chrome 内蔵 Prompt API（LanguageModel / Gemini Nano）のラッパー。
// 入力文 →「検索に強いキーワード」への蒸留に使う（翻訳ではなく要約・抽出）。
//
// ポリシー:
// - status が 'available'（モデルDL済み）のときだけ自動で使う。
// - 'downloadable' のときは勝手に巨大DLを始めず、UI の明示ボタン（ensureReady）に委ねる。
// - 失敗・タイムアウトは null を返し、呼び出し側のフォールバック
//  （Translator＋Segmenter → 辞書）に委ねる。UI を固めない。

const PROBE_TIMEOUT_MS = 2500;
const PROMPT_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = [
  'あなたはストックフォト検索アシスタントです。',
  'ユーザーが入力する日本語の説明文から、Adobe Stock の検索に最適なキーワードを抽出します。',
  '必ず次の JSON だけを出力してください: {"ja": ["…"], "en": ["…"]}',
  'ja: 日本語の検索キーワード2〜5個。名詞中心。助詞や「〜のような」等は含めない。',
  'en: 英語の検索キーワード2〜5個。直訳ではなく、ストックフォト検索で実際に使われる一般的な語を選ぶ。',
  '固有の和菓子・日本文化などは英語圏で通じる表現に言い換える（例: 琥珀糖 → "kohakuto japanese crystal candy"）。',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['ja', 'en'],
  additionalProperties: false,
  properties: {
    ja: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    en: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
  },
};

let probePromise;
let sessionPromise = null;

export function isSupported() {
  return typeof self !== 'undefined' && 'LanguageModel' in self;
}

function withTimeout(promise, ms, timeoutValue) {
  return Promise.race([
    Promise.resolve(promise).catch(() => timeoutValue),
    new Promise((resolve) => setTimeout(() => resolve(timeoutValue), ms)),
  ]);
}

/**
 * 利用可否（キャッシュ付き）。
 * @returns {Promise<'available'|'downloadable'|'unavailable'|'unsupported'>}
 */
export function probe() {
  if (!probePromise) {
    probePromise = (async () => {
      if (!isSupported()) return 'unsupported';
      const status = await withTimeout(self.LanguageModel.availability(), PROBE_TIMEOUT_MS, 'unavailable');
      return status === 'available' || status === 'downloadable' ? status : 'unavailable';
    })();
  }
  return probePromise;
}

/**
 * セッションを用意する（必要ならモデルDLを開始し、進捗を onProgress に流す）。
 * DL中はタイムアウトさせない（進捗が来ている限り待つのはUI側の責務）。
 * @param {(percent:number)=>void} [onProgress]
 */
export function ensureReady(onProgress) {
  if (!sessionPromise) {
    sessionPromise = self.LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor(monitorObj) {
        monitorObj.addEventListener('downloadprogress', (event) => {
          if (typeof onProgress === 'function') {
            onProgress(Math.round((event.loaded ?? 0) * 100));
          }
        });
      },
    }).then((session) => {
      probePromise = Promise.resolve('available');
      return session;
    }).catch((error) => {
      sessionPromise = null; // 失敗時は次回再試行できるようにリセット
      throw error;
    });
  }
  return sessionPromise;
}

/** モデル出力からJSONを取り出す（コードフェンス・前後の文章に耐える） */
function parseKeywordJson(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const clean = (arr) =>
      Array.isArray(arr)
        ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 5)
        : [];
    const ja = clean(obj.ja);
    const en = clean(obj.en).map((s) => s.toLowerCase());
    if (ja.length === 0 && en.length === 0) return null;
    return { ja, en };
  } catch {
    return null;
  }
}

/**
 * 入力文を検索キーワードに蒸留する。
 * モデル未DL（downloadable）の場合は null（自動DLしない）。
 * @param {string} text
 * @returns {Promise<{ja:string[], en:string[]}|null>}
 */
export async function distill(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed || !isSupported()) return null;

  const status = await probe();
  if (status !== 'available') return null;

  const session = await withTimeout(ensureReady(), PROMPT_TIMEOUT_MS, null);
  if (!session) return null;

  let raw = null;
  try {
    // 構造化出力（対応環境）。未対応なら例外 → プレーンで再試行
    raw = await withTimeout(
      session.prompt(trimmed, { responseConstraint: RESPONSE_SCHEMA }),
      PROMPT_TIMEOUT_MS,
      null,
    );
  } catch {
    raw = null;
  }
  if (raw === null) {
    raw = await withTimeout(session.prompt(trimmed), PROMPT_TIMEOUT_MS, null);
  }

  return parseKeywordJson(raw);
}
