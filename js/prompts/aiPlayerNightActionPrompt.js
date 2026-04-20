// AIプレイヤー（AIPlayer）夜アクションユーザープロンプト
// 依存: js/config.js (ROLES, isWerewolfRole)

/**
 * @param {object} role           役職オブジェクト
 * @param {string} candidatesText 対象候補プレイヤー名を読点区切りにした文字列
 */
function buildAiPlayerNightActionUserPrompt(role, candidatesText) {
  let actionDesc = '夜のアクション対象を選んでください。';
  if (isWerewolfRole(role))      actionDesc = '今夜襲撃する村人を選んでください。';
  else if (role?.id === ROLES.SEER.id)   actionDesc = '今夜占うプレイヤーを選んでください。';
  else if (role?.id === ROLES.HUNTER.id) actionDesc = '今夜護衛するプレイヤーを選んでください。';

  return `夜フェーズです。${actionDesc}
対象プレイヤー: ${candidatesText}

対象の名前を一人だけ答えてください。`;
}
