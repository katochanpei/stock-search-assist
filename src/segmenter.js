// 日本語の説明文から検索用キーワード（名詞・形容語中心）を抽出する。
// Chrome 内蔵の Intl.Segmenter を使うため外部依存ゼロ。
//
// Adobe Stock は「文章」ではなく「キーワード列」で検索するのが前提。
// 「琥珀糖のような透明感のある和菓子を撮影したもの」→「琥珀糖 透明感 和菓子」
// のように、助詞・形式名詞・指示語・撮影指示語を落として実のある語だけ残す。
//
// Intl.Segmenter は品詞情報を持たないため、ストップワードと文字種の
// ヒューリスティック（1〜2文字のひらがな＝助詞・語尾とみなす）で絞る。
// すべて純粋関数。

const JA_STOPWORDS = new Set([
  // 形式名詞・指示語・接続語
  'よう', 'もの', 'こと', 'ため', 'とき', 'ところ', 'それ', 'これ', 'あれ',
  'ここ', 'そこ', 'どこ', 'ほう', 'まま', 'ほか', 'など', 'たち', 'さん',
  'そして', 'また', 'または', 'かつ', 'および', 'ような', 'ように',
  // 依頼・撮影まわりの指示語（キーワードとしてはノイズ）
  '撮影', '撮っ', '撮り', '写し', '写っ', '使う', '使い', '使え', '使える',
  '欲しい', 'ほしい', '探し', '探す', 'イメージ', 'かんじ', '感じ',
  '画像', '素材', 'カット', 'シーン',
  // 種別語はフィルタ側（detectContentType）で拾うのでキーワードからは除外
  '写真', 'フォト', 'イラスト', 'ベクター', 'ベクトル', '動画', 'ムービー',
  '映像', 'テンプレート', 'テンプレ',
  // 一般的すぎる語
  'する', 'した', 'して', 'いる', 'ある', 'なる', 'できる', 'いい', 'よい',
]);

/** 1〜2文字のひらがなのみ＝助詞・語尾とみなして落とす */
const HIRAGANA_SHORT = /^[ぁ-んー]{1,2}$/;
const NUMBERS_ONLY = /^[0-9０-９]+$/;
const ASCII_SINGLE = /^[a-zA-Z]$/;
/** 漢字のみ（複合語の結合判定に使う） */
const KANJI_ONLY = /^[一-鿿㐀-䶿々]+$/;

/**
 * Intl.Segmenter は「琥珀糖→琥珀+糖」「透明感→透明+感」のように
 * 複合語を過分割することがある。原文中で隣接している漢字のみの
 * セグメント同士を結合して復元する。
 */
function mergeAdjacentKanji(segments) {
  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    const isContiguous = prev && prev.index + prev.segment.length === seg.index;
    if (isContiguous && KANJI_ONLY.test(prev.segment) && KANJI_ONLY.test(seg.segment)) {
      merged[merged.length - 1] = { segment: prev.segment + seg.segment, index: prev.index };
    } else {
      merged.push({ segment: seg.segment, index: seg.index });
    }
  }
  return merged;
}

/**
 * 日本語テキストから検索キーワードを抽出する。
 * Intl.Segmenter 非対応環境では空配列（呼び出し側が原文フォールバック）。
 * @param {string} text
 * @param {number} [max=7] 最大キーワード数
 * @returns {string[]}
 */
export function distillJaKeywords(text, max = 7) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return [];

  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  const wordLike = [...segmenter.segment(trimmed)]
    .filter((seg) => seg.isWordLike)
    .map((seg) => ({ segment: seg.segment.trim(), index: seg.index }))
    .filter((seg) => seg.segment);

  const keywords = [];
  for (const { segment: word } of mergeAdjacentKanji(wordLike)) {
    if (keywords.length >= max) break;
    if (JA_STOPWORDS.has(word)) continue;
    if (HIRAGANA_SHORT.test(word)) continue;
    if (NUMBERS_ONLY.test(word)) continue;
    if (ASCII_SINGLE.test(word)) continue;
    if (!keywords.includes(word)) keywords.push(word);
  }

  return keywords;
}
