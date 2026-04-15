// --- ロジックAI ---

class LogicAI {
  constructor(gameState) {
    this.gameState = gameState;
  }

  async analyze() {
    const gs = this.gameState;
    const { aiApiKey, logicAiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey) return this._fallbackAnalysis();

    const model = logicAiModel || 'gemini-flash-latest';
    const systemPrompt = 'あなたは人狼ゲームを観察するロジックAIです。村人の視点でチャットを分析し、確定情報・役職予想・人狼ライン候補・推奨行動を簡潔に整理してください。日本語で出力してください。';
    const userPrompt = this._buildAnalysisPrompt();

    try {
      return await callAI(systemPrompt, userPrompt, aiApiKey, model, { reasoningEffort });
    } catch (e) {
      console.warn('ロジックAI分析エラー:', e);
      return this._fallbackAnalysis();
    }
  }

  _buildAnalysisPrompt() {
    const gs = this.gameState;
    const alivePlayers = gs.getAlivePlayers().map((p) => p.name).join('、');
    const deadPlayers = gs.players
      .filter((p) => !p.isAlive)
      .map((p) => p.name)
      .join('、');

    const recentPosts = gs.bbsLog
      .filter((p) => p.type !== 'system')
      .slice(-30)
      .map((p) => {
        const coLabel = p.coRole ? `[${ROLE_BY_ID?.[p.coRole]?.name || p.coRole}CO]` : '';
        return `${p.playerName}${coLabel}: ${p.content}`;
      })
      .join('\n');

    return `現在: ${gs.day}日目
生存プレイヤー: ${alivePlayers}
${deadPlayers ? `死亡・処刑: ${deadPlayers}` : ''}

以下の形式で分析してください：
【確定情報】役職COした人物・死亡者など
【役職予想】各プレイヤーの役職予想と根拠
【人狼ライン候補】人狼の可能性が高いプレイヤーと理由
【推奨行動】村人陣営として取るべき行動

チャットログ（最近の発言）:
${recentPosts || '（発言なし）'}`;
  }

  _fallbackAnalysis() {
    return '（APIキーが設定されていないため、分析できません）';
  }
}
