// プロンプト共通ヘルパー関数

function _escapeForPrompt(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * 1件の投稿を「名前: 発言内容」形式の1行に変換します。
 * システム投稿の playerName は "GM" として出力します。
 */
function _formatPostSimple(post) {
  const name = post.playerName === '★システム' ? 'GM' : post.playerName;
  return `${name}: ${post.content || ''}`;
}

/**
 * 人狼チャット投稿を「名前[狼チャット]: 発言内容」形式の1行に変換します。
 */
function _formatWolfPostSimple(post) {
  const name = post.playerName === '★システム' ? 'GM' : post.playerName;
  return `${name}[狼チャット]: ${post.content || ''}`;
}

// 後方互換のため旧フォーマット関数も残す
function _formatSystemPostEntry(post) {
  return [
    '"system" : {',
    `    "message" : "${_escapeForPrompt(post.content)}",`,
    `    "date" : "${post.timestamp}"`,
    '}',
  ].join('\n');
}

function _formatChatPostEntry(post) {
  return [
    '"post" : {',
    `    "name" : "${_escapeForPrompt(post.playerName)}",`,
    `    "talk" : "${_escapeForPrompt(post.content)}",`,
    `    "date" : "${post.timestamp}"`,
    '}',
  ].join('\n');
}

function _formatPost(post) {
  return post.type === 'system' ? _formatSystemPostEntry(post) : _formatChatPostEntry(post);
}
