// 入力（日本語）とトグルから、狙い別の Adobe Stock 検索バリアントを組み立てる統合モジュール。
//
// 核心は「翻訳」ではなく「検索キーワードへの蒸留」。
// Adobe Stock は文章検索に弱い（直訳の長文クエリは0件直行）ため、
// 日本語・英語とも必ずキーワード列に落としてから URL を作る。
//
// 蒸留エンジンの優先順:
//  1. nano   … Prompt API（Gemini Nano・モデルDL済みのときだけ）: 日英キーワードを一括抽出
//  2. translator … Intl.Segmenter で日本語キーワード抽出 → Translator API でフレーズ翻訳
//  3. dict   … 内蔵辞書スキャン（最後の砦）
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
  MOOD_BOOSTERS,
} from './rules.js';
import { distillJaKeywords } from './segmenter.js';
import { probe as nanoProbe, distill as nanoDistill } from './nano.js';
import { translateKeywords } from './translator.js';

// 実測（2026-08）: 琥珀糖系の入力で ja 5語＝0件 / 3語＝50件 / 2語＝52件。
// キーワードは多いほど絞られて0件に直行するため、主力カードは3語に留める。
const JA_MAIN_KEYWORDS = 3;
const JA_BROAD_KEYWORDS = 2;
const MAX_EN_KEYWORDS = 4;

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
 * 入力文を日英の検索キーワードに蒸留する。
 * @returns {Promise<{jaKeywords:string[], enKeywords:string[], engine:string}>}
 */
async function distillKeywords(text, onProgress) {
  const jaFromRules = distillJaKeywords(text);

  // 1. Prompt API（モデルDL済みのときだけ自動使用）
  if ((await nanoProbe()) === 'available') {
    const distilled = await nanoDistill(text);
    if (distilled && (distilled.ja.length > 0 || distilled.en.length > 0)) {
      return {
        jaKeywords: distilled.ja.length > 0 ? distilled.ja : jaFromRules,
        enKeywords: distilled.en.slice(0, MAX_EN_KEYWORDS),
        engine: 'nano',
      };
    }
  }

  // 2. Segmenter蒸留 → Translator でフレーズ翻訳
  const translationSource = jaFromRules.length > 0 ? jaFromRules : [text];
  const phrases = await translateKeywords(translationSource, onProgress);
  if (phrases && phrases.length > 0) {
    return { jaKeywords: jaFromRules, enKeywords: phrases.slice(0, MAX_EN_KEYWORDS), engine: 'translator' };
  }

  // 3. 辞書スキャン
  const fromDict = extractKeywordsByDictionary(text, DICTIONARY).slice(0, MAX_EN_KEYWORDS);
  return { jaKeywords: jaFromRules, enKeywords: fromDict, engine: fromDict.length > 0 ? 'dict' : 'none' };
}

/**
 * @param {string} input 日本語の自然文
 * @param {object} [options] { contentType, orientation, copySpace, candid, subject, excludeAI }
 * @param {(percent:number)=>void} [onProgress] 翻訳モデルDLの進捗(0-100)
 * @returns {Promise<{engine:string, effective:object, jaKeywords:string[], baseKeywords:string[], variants:object[]}>}
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

  const { jaKeywords, enKeywords, engine } = await distillKeywords(text, onProgress);

  // 蒸留に失敗したら原文で検索（従来挙動）
  const jaQueryMain = jaKeywords.length > 0 ? jaKeywords.slice(0, JA_MAIN_KEYWORDS).join(' ') : text;
  const jaQueryFull = jaKeywords.join(' ');
  // 辞書モードで1語だけ（例: "background"）の英語カードは誤誘導なので出さない
  const hasEn = engine === 'dict' ? enKeywords.length >= 2 : enKeywords.length > 0;
  const variants = [];

  // 国内案件は「日本語キーワード ＋ 自国アーティスト/AI除外」が一番効く → 最優先
  variants.push(
    makeVariant(
      'jp',
      '日本語キーワード（おすすめ）',
      '入力文から核のキーワード3語を抽出。国内案件はこれが最強。',
      jaQueryMain,
      { ...baseFilters },
    ),
  );
  variants.push(
    makeVariant('jp-wide', '日本語 ＋ 横長', '上に横長フィルタを追加（Web・バナー向け）。', jaQueryMain, {
      ...baseFilters,
      orientation: orientation || 'horizontal',
    }),
  );

  // 0件保険: キーワードを2語に絞り、自国アーティストも外して母数を最大化
  if (jaKeywords.length > JA_BROAD_KEYWORDS || localArtists) {
    variants.push(
      makeVariant(
        'jp-broad',
        '日本語 広め（ヒットが少ない時）',
        'キーワードを核の2語に絞り、アーティスト限定も外して母数を確保。',
        jaKeywords.slice(0, JA_BROAD_KEYWORDS).join(' ') || jaQueryMain,
        { contentType, excludeAI },
      ),
    );
  }

  // 逆方向の保険: ヒットが多すぎる時用に全キーワードで絞るカード
  if (jaKeywords.length > JA_MAIN_KEYWORDS) {
    variants.push(
      makeVariant(
        'jp-full',
        '日本語 絞り込み（全キーワード）',
        `抽出した${jaKeywords.length}語すべてで検索。ヒットが多すぎる時の絞り込み用。`,
        jaQueryFull,
        { ...baseFilters },
      ),
    );
  }

  if (hasEn) {
    variants.push(
      makeVariant('direct', '英語で広げる', '検索に強い英語キーワードに変換。日本語で母数が薄い時の広げ用。', toKeywordString(enKeywords), {
        ...baseFilters,
        orientation,
      }),
    );

    const mood = wantCandid ? [...MOOD_BOOSTERS, 'real people'] : MOOD_BOOSTERS;
    variants.push(
      makeVariant('mood', '雰囲気重視', '自然光・自然な表情を足して、ありがちな硬さを回避。', toKeywordString([...enKeywords, ...mood]), {
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
        toKeywordString(enKeywords),
        { ...baseFilters, orientation: practicalOrientation, order: 'relevance' },
      ),
    );

    if (wantCopySpace) {
      variants.push(
        makeVariant('copyspace', 'デザイン向け（余白あり）', '「copy space」で、文字を載せる余白がある構図を優先。', toKeywordString([...enKeywords, 'copy space']), {
          ...baseFilters,
          orientation: orientation || 'horizontal',
        }),
      );
    }
  }

  return {
    engine,
    effective: { contentType, orientation, wantCopySpace, wantCandid, subject, localArtists, excludeAI },
    jaKeywords,
    baseKeywords: enKeywords,
    variants,
  };
}
