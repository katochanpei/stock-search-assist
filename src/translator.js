// Chrome 内蔵 Translator API（ja→en）のラッパー。
// オリジントライアル不要・Chrome 138+（デスクトップ）で利用可。
//
// 「Translator は在るが応答しない」環境（Electron 等）でも UI が固まらないよう、
// 可用性チェックと翻訳の双方にタイムアウトを設ける。無理なら null を返し、
// 呼び出し側（queryBuilder）の辞書フォールバックに委ねる。

const SOURCE = 'ja';
const TARGET = 'en';
const PROBE_TIMEOUT_MS = 2500;
const TRANSLATE_TIMEOUT_MS = 10000;
// モデルが未DL（downloadable）の場合、7秒では確実にDLが終わらず
// 「辞書モードに永久固定」される既知バグがあった。DL時は長めに待つ。
const CREATE_TIMEOUT_READY_MS = 10000;
const CREATE_TIMEOUT_DOWNLOAD_MS = 180000;

let probePromise;
let translatorPromise = null;

export function isSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

// promise が ms 以内に解決しなければ timeoutValue を返す（reject も timeoutValue に倒す）
function withTimeout(promise, ms, timeoutValue) {
  return Promise.race([
    Promise.resolve(promise).catch(() => timeoutValue),
    new Promise((resolve) => setTimeout(() => resolve(timeoutValue), ms)),
  ]);
}

/**
 * 利用可否（キャッシュ付き）。応答なしはタイムアウトで 'unavailable' に倒す。
 * @returns {Promise<'available'|'downloadable'|'unavailable'|'unsupported'>}
 */
export function probe() {
  if (!probePromise) {
    probePromise = (async () => {
      if (!isSupported()) return 'unsupported';
      const status = await withTimeout(
        self.Translator.availability({ sourceLanguage: SOURCE, targetLanguage: TARGET }),
        PROBE_TIMEOUT_MS,
        'unavailable',
      );
      return status === 'available' || status === 'downloadable' ? status : 'unavailable';
    })();
  }
  return probePromise;
}

function getTranslator(onProgress) {
  if (!translatorPromise) {
    translatorPromise = self.Translator.create({
      sourceLanguage: SOURCE,
      targetLanguage: TARGET,
      monitor(monitorObj) {
        monitorObj.addEventListener('downloadprogress', (event) => {
          if (typeof onProgress === 'function') {
            onProgress(Math.round((event.loaded ?? 0) * 100));
          }
        });
      },
    }).catch((error) => {
      translatorPromise = null; // 失敗時は次回再試行できるようにリセット
      throw error;
    });
  }
  return translatorPromise;
}

/**
 * 日本語→英語に翻訳。内蔵AIが無い/応答しない/失敗した場合は null（辞書フォールバック）。
 * ※モデルDLを伴う場合があるためユーザー操作（ボタン押下）から呼ぶこと。
 * @param {string} text
 * @param {(percent:number)=>void} [onProgress]
 * @returns {Promise<string|null>}
 */
export async function translateJaToEn(text, onProgress) {
  const trimmed = (text ?? '').trim();
  if (!trimmed || !isSupported()) return null;

  const status = await probe();
  if (status !== 'available' && status !== 'downloadable') return null;

  const createTimeout = status === 'downloadable' ? CREATE_TIMEOUT_DOWNLOAD_MS : CREATE_TIMEOUT_READY_MS;
  const translator = await withTimeout(getTranslator(onProgress), createTimeout, null);
  if (!translator) {
    // DL済みなのに応答しない環境（Electron等）だけ以後は辞書に固定する。
    // DL中のタイムアウトは「まだ終わってない」だけなので固定しない（次回再試行）。
    if (status === 'available') {
      probePromise = Promise.resolve('unavailable');
    }
    return null;
  }

  const output = await withTimeout(translator.translate(trimmed), TRANSLATE_TIMEOUT_MS, null);
  if (output === null) {
    probePromise = Promise.resolve('unavailable');
    return null;
  }
  return output.trim() || null;
}

/**
 * キーワード配列を英語フレーズ配列に翻訳する。
 * 文まるごとの直訳（"photographed ... sense ..." のような劣化）を避けるため、
 * 蒸留済みキーワードを「、」区切りで渡し、訳文を区切りで戻す。
 * @param {string[]} jaKeywords
 * @param {(percent:number)=>void} [onProgress]
 * @returns {Promise<string[]|null>} 失敗時 null（呼び出し側フォールバック）
 */
export async function translateKeywords(jaKeywords, onProgress) {
  if (!Array.isArray(jaKeywords) || jaKeywords.length === 0) return null;
  const output = await translateJaToEn(jaKeywords.join('、'), onProgress);
  if (!output) return null;
  const phrases = output
    .split(/[,、;・\n]+/)
    .map((phrase) => phrase.trim().toLowerCase().replace(/[.!?"'`]+$/g, ''))
    .filter(Boolean);
  return phrases.length > 0 ? phrases : null;
}
