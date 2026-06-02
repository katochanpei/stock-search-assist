// 入力（日本語）とトグルから、狙い別の Adobe Stock 検索バリアントを組み立てる統合モジュール。
// 内蔵AI翻訳 → 失敗時は辞書フォールバック、の二段構えでベースキーワードを得る。
//
// 日本人狙いは英語キーワード "Japanese"（pan-Asian を招き逆効果）ではなく、
// 「自国のアーティスト」フィルタ（local_artists=only）で実現する。

import { buildSearchUrl } from './urlBuilder.js';
import { DICTIONARY } from './dictionary.js';
import {
  detectContentType,
  detectOrientation,
  detectCopySpace,
  detectCandid,
  extractKeywordsByDictionary,
  cleanTranslation,
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
 * @param {object} [options] { contentType, orientation, copySpace, candid, subject, excludeAI }
 * @param {(percent:number)=>void} [onProgress] 翻訳モデルDLの進捗(0-100)
 * @returns {Promise<{engine:string, effective:object, baseKeywords:string[], variants:object[]}>}
 */
export async function buildVariants(input, options = {}, onProgress) {
  const text = (input ?? '').trim();
  if (!text) {
    throw new Error('検索したい内容を入力してください');
  }

  const contentType = options.contentType || detectContentType(text) || 'photo';
  const orientation = options.orientation || detectOrientation(text) || '';
  const wantCopySpace = options.copySpace ?? detectCopySpace(text);
  const wantCandid = options.candid ?? detectCandid(text);
  const subject = options.subject || 'jp';
  const excludeAI = options.excludeAI ?? true;

  // 日本人狙い = 「自国のアーティスト」フィルタで実現（英語 "Japanese" は使わない）
  const localArtists = subject === 'jp';
  const baseFilters = { contentType, localArtists, excludeAI };

  // ベース英語キーワード: 内蔵AI翻訳 → 失敗時は辞書スキャン
  const translated = await translateJaToEn(text, onProgress);
  const baseKeywords = translated
    ? cleanTranslation(translated)
    : extractKeywordsByDictionary(text, DICTIONARY);
  const engine = translated ? 'ai' : baseKeywords.length > 0 ? 'dict' : 'none';

  const hasBase = baseKeywords.length > 0;
  const variants = [];

  // 国内案件は「日本語キーワード ＋ 自国アーティスト/AI除外」が一番効く → 最優先
  variants.push(
    makeVariant('jp', '日本語そのまま（おすすめ）', 'いつも通りの日本語キーワードに、自国アーティスト・AI除外フィルタを付与。国内案件はこれが最強。', text, {
      ...baseFilters,
    }),
  );
  variants.push(
    makeVariant('jp-wide', '日本語 ＋ 横長', '上に横長フィルタを追加（Web・バナー向け）。', text, {
      ...baseFilters,
      orientation: orientation || 'horizontal',
    }),
  );

  if (hasBase) {
    variants.push(
      makeVariant('direct', '英語で広げる', '英訳キーワード。日本語で母数が薄い時の広げ用。', toKeywordString(baseKeywords), {
        ...baseFilters,
        orientation,
      }),
    );

    const mood = wantCandid ? [...MOOD_BOOSTERS, 'real people'] : MOOD_BOOSTERS;
    variants.push(
      makeVariant('mood', '雰囲気重視', '自然光・自然な表情を足して、ありがちな硬さを回避。', toKeywordString([...baseKeywords, ...mood]), {
        ...baseFilters,
        orientation,
      }),
    );

    const practicalOrientation = orientation || 'horizontal';
    variants.push(
      makeVariant(
        'practical',
        `実用（${CONTENT_TYPE_LABEL[contentType] ?? '写真'}・${ORIENTATION_LABEL[practicalOrientation]}）`,
        'Web・資料にすぐ使えるよう、種別と向きで絞り込み済み。',
        toKeywordString(baseKeywords),
        { ...baseFilters, orientation: practicalOrientation, order: 'relevance' },
      ),
    );

    variants.push(
      makeVariant('copyspace', 'デザイン向け（余白あり）', '「copy space」で、文字を載せる余白がある構図を優先。', toKeywordString([...baseKeywords, 'copy space']), {
        ...baseFilters,
        orientation: orientation || 'horizontal',
      }),
    );
  }

  return {
    engine,
    effective: { contentType, orientation, wantCopySpace, wantCandid, subject, localArtists, excludeAI },
    baseKeywords,
    variants,
  };
}
