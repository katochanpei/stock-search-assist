// 入力（日本語）とトグルから、狙い別の Adobe Stock 検索バリアントを組み立てる統合モジュール。
// 内蔵AI翻訳 → 失敗時は辞書フォールバック、の二段構えでベースキーワードを得る。

import { buildSearchUrl } from './urlBuilder.js';
import { DICTIONARY, PEOPLE_KEYS } from './dictionary.js';
import {
  detectContentType,
  detectOrientation,
  detectCopySpace,
  detectCandid,
  hasPeople,
  extractKeywordsByDictionary,
  cleanTranslation,
  applyNationality,
  MOOD_BOOSTERS,
} from './rules.js';
import { translateJaToEn } from './translator.js';

const CONTENT_TYPE_LABEL = {
  photo: '写真',
  illustration: 'イラスト',
  vector: 'ベクター',
  video: '動画',
  template: 'テンプレート',
  '3d': '3D',
};

const ORIENTATION_LABEL = {
  horizontal: '横長',
  vertical: '縦',
  square: '正方形',
};

const unique = (arr) => arr.filter((value, index) => arr.indexOf(value) === index);
const toKeywordString = (arr) => unique(arr.filter(Boolean)).join(' ');

function makeVariant(id, label, description, keywords, urlOptions) {
  return { id, label, description, keywords, url: buildSearchUrl(keywords, urlOptions) };
}

/**
 * @param {string} input 日本語の自然文
 * @param {object} [options] { contentType, orientation, copySpace, candid, subject }
 * @param {(percent:number)=>void} [onProgress] 翻訳モデルDLの進捗(0-100)
 * @returns {Promise<{engine:string, peoplePresent:boolean, effective:object, baseKeywords:string[], variants:object[]}>}
 */
export async function buildVariants(input, options = {}, onProgress) {
  const text = (input ?? '').trim();
  if (!text) {
    throw new Error('検索したい内容を入力してください');
  }

  // トグル優先、無ければテキストから推定。種別の既定は「写真」。
  const contentType = options.contentType || detectContentType(text) || 'photo';
  const orientation = options.orientation || detectOrientation(text) || '';
  const wantCopySpace = options.copySpace ?? detectCopySpace(text);
  const wantCandid = options.candid ?? detectCandid(text);
  const subject = options.subject || 'jp';

  const peoplePresent = hasPeople(text, PEOPLE_KEYS);

  // ベース英語キーワード: 内蔵AI翻訳 → 失敗時は辞書スキャン
  const translated = await translateJaToEn(text, onProgress);
  const rawKeywords = translated
    ? cleanTranslation(translated)
    : extractKeywordsByDictionary(text, DICTIONARY);
  const engine = translated ? 'ai' : rawKeywords.length > 0 ? 'dict' : 'none';

  const baseKeywords = applyNationality(rawKeywords, subject, peoplePresent);
  const hasBase = baseKeywords.length > 0;

  const variants = [];

  if (hasBase) {
    // ① 直球
    variants.push(
      makeVariant('direct', '直球', '入力に忠実な訳。まず全体の母数を見る用。', toKeywordString(baseKeywords), {
        contentType,
        orientation,
      }),
    );

    // ② 雰囲気重視
    const mood = wantCandid ? [...MOOD_BOOSTERS, 'real people'] : MOOD_BOOSTERS;
    variants.push(
      makeVariant(
        'mood',
        '雰囲気重視',
        '自然光・自然な表情を足して、ありがちな硬さを回避。',
        toKeywordString([...baseKeywords, ...mood]),
        { contentType, orientation },
      ),
    );

    // ③ 実用（種別×向き）
    const practicalOrientation = orientation || 'horizontal';
    variants.push(
      makeVariant(
        'practical',
        `実用（${CONTENT_TYPE_LABEL[contentType] ?? '写真'}・${ORIENTATION_LABEL[practicalOrientation]}）`,
        'Web・資料にすぐ使えるよう、種別と向きで絞り込み済み。',
        toKeywordString(baseKeywords),
        { contentType, orientation: practicalOrientation, order: 'relevance' },
      ),
    );

    // ④ デザイン向け（余白）
    variants.push(
      makeVariant(
        'copyspace',
        'デザイン向け（余白あり）',
        '「copy space」で、文字を載せる余白がある構図を優先。',
        toKeywordString([...baseKeywords, 'copy space']),
        { contentType, orientation: orientation || 'horizontal' },
      ),
    );
  }

  // ⑤ 日本語キーワード版（国内素材の発掘に強い）
  variants.push(
    makeVariant(
      'jp',
      '日本語キーワード版',
      '英語版で薄い時に、日本人コントリビューターの素材を拾える。',
      text,
      { contentType },
    ),
  );

  return {
    engine,
    peoplePresent,
    effective: { contentType, orientation, wantCopySpace, wantCandid, subject },
    baseKeywords,
    variants,
  };
}
