// Adobe Stock の検索URLを組み立てるモジュール。
//
// 公式 Search API ではなく「一般ユーザーが使う stock.adobe.com の検索URL」を生成する。
// → APIキー・認証・契約形態に一切依存せず、クリックすればチーム版ログインのまま結果が開く。
//
// すべて純粋関数。引数のオブジェクトは変更せず、毎回新しい文字列を返す。

const STOCK_BASE = 'https://stock.adobe.com/jp/search';

// トグルの content_type 値 → Adobe Stock のフィルタキー
const CONTENT_TYPE_FILTER = Object.freeze({
  photo: 'content_type:photo',
  illustration: 'content_type:illustration',
  vector: 'content_type:vector',
  video: 'content_type:video',
  template: 'content_type:template',
  '3d': 'content_type:3d',
});

const ORIENTATION_VALUES = new Set(['horizontal', 'vertical', 'square']);
const ORDER_VALUES = new Set(['relevance', 'featured', 'nb_downloads', 'creation']);

/**
 * Adobe Stock の検索URLを組み立てて返す。
 * @param {string} keywords スペース区切りの検索キーワード（必須・非空）
 * @param {object} [options]
 * @param {string} [options.contentType] photo|illustration|vector|video|template|3d
 * @param {string} [options.orientation] horizontal|vertical|square
 * @param {string} [options.order] relevance|featured|nb_downloads|creation
 * @param {boolean} [options.safeSearch=true]
 * @returns {string} 検索URL
 */
export function buildSearchUrl(keywords, options = {}) {
  const trimmed = (keywords ?? '').trim();
  if (!trimmed) {
    throw new Error('buildSearchUrl: keywords が空です');
  }

  const { contentType, orientation, order, localArtists, excludeAI, safeSearch = true } = options;
  const params = new URLSearchParams();
  params.set('k', trimmed);

  const contentTypeFilter = contentType ? CONTENT_TYPE_FILTER[contentType] : undefined;
  if (contentTypeFilter) {
    // URLSearchParams が [ ] : を %5B %5D %3A にエンコードする（Adobe Stock が解釈する形）
    params.set(`filters[${contentTypeFilter}]`, '1');
  }

  if (orientation && ORIENTATION_VALUES.has(orientation)) {
    params.set('filters[orientation]', orientation);
  }

  if (localArtists) {
    // 自国（アカウントの国＝日本）のアーティストに限定 → 日本人モデル中心になる
    params.set('filters[local_artists]', 'only');
  }

  if (excludeAI) {
    params.set('filters[gentech]', 'exclude'); // AI生成画像を除外
  }

  if (order && ORDER_VALUES.has(order)) {
    params.set('order', order);
  }

  if (safeSearch) {
    params.set('safe_search', '1');
  }

  return `${STOCK_BASE}?${params.toString()}`;
}

export const SUPPORTED_CONTENT_TYPES = Object.freeze(Object.keys(CONTENT_TYPE_FILTER));
