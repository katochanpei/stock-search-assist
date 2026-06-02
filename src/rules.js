// 入力文の解析ルール群。すべて純粋関数（引数を変更しない）。
// - 種別 / 向き / 余白 / 自然さ をテキストから推定
// - 人物の有無を判定
// - 辞書ベースのキーワード抽出（フォールバック）
// - 内蔵AI翻訳文のキーワード整形
// - 国籍ワードの付与（日本人デフォルト）

const CONTENT_TYPE_HINTS = [
  [/写真|フォト/i, 'photo'],
  [/イラスト/i, 'illustration'],
  [/ベクター|ベクトル/i, 'vector'],
  [/動画|ムービー|映像/i, 'video'],
  [/テンプレート|テンプレ/i, 'template'],
  [/3d|立体/i, '3d'],
];

export function detectContentType(text) {
  for (const [pattern, value] of CONTENT_TYPE_HINTS) {
    if (pattern.test(text)) return value;
  }
  return '';
}

const ORIENTATION_HINTS = [
  [/横長|横向き|横位置|ランドスケープ/i, 'horizontal'],
  [/縦長|縦向き|縦位置|ポートレート/i, 'vertical'],
  [/正方形|スクエア|真四角/i, 'square'],
];

export function detectOrientation(text) {
  for (const [pattern, value] of ORIENTATION_HINTS) {
    if (pattern.test(text)) return value;
  }
  return '';
}

export function detectCopySpace(text) {
  return /余白|コピースペース|テキストスペース|文字\s*を?\s*入れ|copy\s*space/i.test(text);
}

export function detectCandid(text) {
  return /自然な|さりげない|ありのまま|リアルな|何気ない|candid/i.test(text);
}

export function hasPeople(text, peopleKeys) {
  return peopleKeys.some((key) => text.includes(key));
}

/**
 * 辞書で部分一致スキャンしてキーワードを抽出（長いキー優先・出現順を保持）。
 * 日本語は分かち書きが無いため、辞書キーの部分一致で名詞・形容詞を拾う方式。
 * @returns {string[]} 英語キーワード配列（重複なし）
 */
export function extractKeywordsByDictionary(text, dictionary) {
  const keys = Object.keys(dictionary).sort((a, b) => b.length - a.length);
  const hits = [];
  const seenEn = new Set();
  let scan = text;

  for (const key of keys) {
    if (scan.includes(key)) {
      const en = dictionary[key];
      if (!seenEn.has(en)) {
        hits.push({ index: text.indexOf(key), en });
        seenEn.add(en);
      }
      // 既に拾った箇所はスペースに置換し、短いキーの二重ヒットを減らす
      scan = scan.split(key).join(' ');
    }
  }

  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.en);
}

const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'with', 'for',
  'is', 'are', 'was', 'were', 'be', 'being', 'been', 'by', 'as', 'that', 'this',
  'these', 'those', 'it', 'its', 'their', 'they', 'them', 'some', 'several',
  'multiple', 'having', 'who', 'while', 'into', 'over', 'about', 'there',
]);

/**
 * 内蔵AIの翻訳文（英語の文）を検索キーワード配列に整形する。
 * 記号除去・小文字化・ストップワード除去・重複除去。
 */
export function cleanTranslation(englishText) {
  return englishText
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}<>/\\|]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !EN_STOPWORDS.has(word))
    .filter((word, index, arr) => arr.indexOf(word) === index);
}

const NATIONALITY_TERM = Object.freeze({
  jp: 'japanese',
  asian: 'asian',
  western: 'western',
  none: '',
});

/**
 * 人物が写る検索なら、被写体の国籍ワードを先頭に付ける（日本人デフォルト）。
 * 新しい配列を返す（引数は変更しない）。
 */
export function applyNationality(keywords, subject, peoplePresent) {
  const term = NATIONALITY_TERM[subject] ?? '';
  if (!term || !peoplePresent) {
    return [...keywords];
  }
  if (keywords.some((keyword) => keyword.toLowerCase() === term)) {
    return [...keywords];
  }
  return [term, ...keywords];
}

/** 「雰囲気重視」バリアントで足す自然光・自然さ系の語。 */
export const MOOD_BOOSTERS = Object.freeze(['natural light', 'candid', 'authentic']);
