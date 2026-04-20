// AIプレイヤー（AIPlayer）システムプロンプト
// 依存: js/config.js (ROLES, isWerewolfRole)

/**
 * @param {string}  name            AIプレイヤーの名前
 * @param {string}  personality     性格（character）
 * @param {object}  role            役職オブジェクト { name, description }
 * @param {boolean} isWolf          人狼陣営かどうか
 * @param {string}  teammates       仲間の人狼名（人狼陣営のみ、なければ空文字）
 * @param {string}  roomLevelPrompt 部屋レベルの補足指示（なければ空文字）
 */
function buildAiPlayerSystemPrompt(name, personality, role, isWolf, teammates, roomLevelPrompt) {
  const lines = [
    'あなたは人狼ゲームのAIプレイヤーです。',
    `名前: ${name}`,
    `性格: ${personality}`,
    `役職: ${role?.name || '不明'}（${role?.description || ''}）`,
    `チーム: ${isWolf ? '人狼陣営' : '村人陣営'}`,
  ];
  if (isWolf && teammates) lines.push(`仲間の人狼: ${teammates}`);
  if (roomLevelPrompt) lines.push(roomLevelPrompt);
  lines.push('ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く発言してください。');
  return lines.join('\n');
}
