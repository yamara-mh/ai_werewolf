// プロンプト共通ヘルパー関数

function _escapeForPrompt(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * 1件の投稿をシンプルな JSON 1行に変換します。
 * システム投稿の playerName は "GM" として出力します。
 */
function _formatPostSimple(post) {
  const name = post.playerName === '★システム' ? 'GM' : post.playerName;
  const obj = { name, talk: post.content || '' };
  if (post.coRole) obj.coRole = post.coRole;
  return JSON.stringify(obj);
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
