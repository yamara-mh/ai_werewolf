// AIプレイヤー（AIPlayer）投票ユーザープロンプト

/**
 * @param {number} day            現在の日数
 * @param {string} candidatesText 投票候補プレイヤー名を読点区切りにした文字列
 * @param {string} recentPostsText 直近の発言ログ（整形済み文字列）
 */
function buildAiPlayerVoteUserPrompt(day, candidatesText, recentPostsText) {
  return `現在: ${day}日目 投票フェーズ
投票可能なプレイヤー: ${candidatesText}

最近の発言:
${recentPostsText || '（発言なし）'}

誰に投票しますか？候補者の名前を一人だけ答えてください。`;
}
