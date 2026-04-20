// AIプレイヤー（AIPlayer）発言ユーザープロンプト

/**
 * @param {string} name             AIプレイヤーの名前
 * @param {number} day              現在の日数
 * @param {string} phaseLabel       フェーズ名（例: "昼（議論）"）
 * @param {string} alivePlayersText 生存プレイヤー名を読点区切りにした文字列
 * @param {string} recentPostsText  直近の発言ログ（整形済み文字列）
 */
function buildAiPlayerSpeechUserPrompt(name, day, phaseLabel, alivePlayersText, recentPostsText) {
  return `現在: ${day}日目 ${phaseLabel}
生存プレイヤー: ${alivePlayersText}

最近の掲示板の発言:
${recentPostsText || '（まだ発言はありません）'}

あなた（${name}）の発言を1〜3文で生成してください。発言のみを出力してください。`;
}
