// ゲーム状態管理

class GameState {
  constructor() {
    this.phase = GAME_PHASES.SETUP;
    this.day = 0;
    this.players = [];       // { id, name, role, isAlive, isHuman, personality }
    this.bbsLog = [];        // { id, postNumber, playerName, content, phase, day, timestamp, type }
    this.votes = {};         // { voterId: targetId }
    this.nightActions = {};  // { actorId: targetId }
    this.winner = null;
    this.settings = {
      playerName: 'あなた',
      totalPlayers: 9,
      werewolfCount: 2,
      optionalRoles: [ROLES.SEER.id, ROLES.MEDIUM.id, ROLES.HUNTER.id, ROLES.MADMAN.id],
      preferredRole: '',
      aiApiKey: '',
      aiModel: 'gemini-3.0-flash',
      logicAiModel: 'gemini-3.0-flash',
      roomLevel: 'intermediate',
      showLogicAi: true,
    };
    this.logicAiOutput = '';
  }

  // ゲームの初期化
  initialize(settings) {
    this.settings = { ...this.settings, ...settings };
    this.phase = GAME_PHASES.SETUP;
    this.day = 0;
    this.players = [];
    this.bbsLog = [];
    this.votes = {};
    this.nightActions = {};
    this.winner = null;
    this._setupPlayers();
    this._assignRoles();
  }

  _setupPlayers() {
    const total = this.settings.totalPlayers;
    const shuffled = [...AI_PERSONALITIES].sort(() => Math.random() - 0.5);

    // 人間プレイヤー
    this.players.push({
      id: 'human',
      name: this.settings.playerName,
      role: null,
      isAlive: true,
      isHuman: true,
      personality: null,
      coRole: null,
      deathReason: null,
    });

    // AIプレイヤー
    for (let i = 1; i < total; i++) {
      const p = shuffled[(i - 1) % shuffled.length];
      this.players.push({
        id: `ai_${i}`,
        name: p.name,
        role: null,
        isAlive: true,
        isHuman: false,
        personality: p.style,
        coRole: null,
        deathReason: null,
      });
    }
  }

  _assignRoles() {
    const total = this.settings.totalPlayers;
    const werewolfCount = this.settings.werewolfCount;
    const optionalRoles = this.settings.optionalRoles || [];
    const preferredRole = this.settings.preferredRole || '';
    const preset = buildRoleDeck(total, werewolfCount, optionalRoles);
    const shuffled = [...preset].sort(() => Math.random() - 0.5);

    // 希望役職が設定されていれば人間プレイヤー（index 0）に割り当て
    if (preferredRole) {
      const idx = shuffled.findIndex((r) => r.id === preferredRole);
      if (idx >= 0) {
        [shuffled[0], shuffled[idx]] = [shuffled[idx], shuffled[0]];
      }
    }

    this.players.forEach((player, index) => {
      player.role = shuffled[index] || ROLES.VILLAGER;
    });
  }

  // BBS投稿を追加
  addPost({ playerName, content, type = 'speech', playerId = null, coRole = null }) {
    const post = {
      id: this.bbsLog.length + 1,
      postNumber: this.bbsLog.length + 1,
      playerName,
      playerId,
      content,
      phase: this.phase,
      day: this.day,
      type, // 'speech' | 'system' | 'vote' | 'result' | 'whisper'
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      coRole,
    };
    this.bbsLog.push(post);
    return post;
  }

  // システムアナウンスを追加
  addSystemPost(content) {
    return this.addPost({ playerName: '★システム', content, type: 'system' });
  }

  // フェーズ遷移
  nextPhase() {
    const prevPhase = this.phase;
    switch (this.phase) {
      case GAME_PHASES.SETUP:
        this.phase = GAME_PHASES.MORNING;
        this.day = 1;
        break;
      case GAME_PHASES.MORNING:
        this.phase = GAME_PHASES.DAY;
        break;
      case GAME_PHASES.DAY:
        this.phase = GAME_PHASES.VOTE;
        break;
      case GAME_PHASES.VOTE:
        this.phase = GAME_PHASES.EXECUTION;
        break;
      case GAME_PHASES.EXECUTION:
        if (this._checkWinCondition()) {
          this.phase = GAME_PHASES.END;
        } else {
          this.phase = GAME_PHASES.NIGHT;
        }
        break;
      case GAME_PHASES.NIGHT:
        this.day += 1;
        this.phase = GAME_PHASES.MORNING;
        break;
      default:
        break;
    }
    if (this.phase === GAME_PHASES.VOTE && prevPhase !== GAME_PHASES.VOTE) {
      this.votes = {};
    }
    if (this.phase === GAME_PHASES.NIGHT && prevPhase !== GAME_PHASES.NIGHT) {
      this.nightActions = {};
    }
    if (this.phase === GAME_PHASES.MORNING) {
      this.nightActions = {};
      this.votes = {};
    }
    return this.phase;
  }

  // 投票を登録
  castVote(voterId, targetId) {
    this.votes[voterId] = targetId;
  }

  // 投票集計・処刑対象の決定
  tallyVotes() {
    const counts = {};
    const aliveIdSet = new Set(this.players.filter((p) => p.isAlive).map((p) => p.id));
    Object.entries(this.votes).forEach(([voterId, targetId]) => {
      // 防御的に、生存者以外の票は無効扱いにする（UI外の不整合データ対策）
      if (!aliveIdSet.has(voterId)) return;
      if (!aliveIdSet.has(targetId)) return;
      counts[targetId] = (counts[targetId] || 0) + 1;
    });
    if (Object.keys(counts).length === 0) return { executed: null, counts: {} };
    const maxVotes = Math.max(...Object.values(counts));
    const candidates = Object.keys(counts).filter((id) => counts[id] === maxVotes);
    // 同票の場合はランダム
    const executedId = candidates[Math.floor(Math.random() * candidates.length)];
    const executed = this.players.find((p) => p.id === executedId);
    if (executed) {
      executed.isAlive = false;
      executed.deathReason = 'execution';
    }
    return { executed, counts };
  }

  // 夜のアクションを登録
  setNightAction(actorId, targetId) {
    this.nightActions[actorId] = targetId;
  }

  // 夜のアクション処理
  resolveNightActions() {
    const results = { attacked: null, saved: false, seerResult: null };

    // 騎士の護衛先
    const hunter = this.players.find(
      (p) => p.role?.id === ROLES.HUNTER.id && p.isAlive
    );
    const guardedId = hunter ? this.nightActions[hunter.id] : null;

    // 人狼の襲撃先
    const wolves = this.players.filter(
      (p) => isWerewolfRole(p.role) && p.isAlive
    );
    const attackTargets = wolves
      .map((w) => this.nightActions[w.id])
      .filter(Boolean);

    if (attackTargets.length > 0) {
      const attackCounts = {};
      attackTargets.forEach((targetId) => {
        attackCounts[targetId] = (attackCounts[targetId] || 0) + 1;
      });
      const maxAttack = Math.max(...Object.values(attackCounts));
      const candidates = Object.keys(attackCounts).filter((id) => attackCounts[id] === maxAttack);
      const targetId = candidates[Math.floor(Math.random() * candidates.length)];
      const target = this.players.find((p) => p.id === targetId);
      if (target) {
        if (targetId === guardedId) {
          results.saved = true;
        } else {
          target.isAlive = false;
          target.deathReason = 'attack';
          results.attacked = target;
        }
      }
    }

    // 占い師の結果
    const seer = this.players.find(
      (p) => p.role?.id === ROLES.SEER.id && p.isAlive
    );
    if (seer && this.nightActions[seer.id]) {
      const target = this.players.find((p) => p.id === this.nightActions[seer.id]);
      if (target) {
        results.seerResult = {
          target,
          isWerewolf: isSeerWerewolf(target.role),
        };
      }
    }

    return results;
  }

  // 勝利条件チェック
  _checkWinCondition() {
    const aliveWolves = this.players.filter(
      (p) => p.isAlive && p.role?.team === TEAMS.WEREWOLF
    );
    const aliveVillagers = this.players.filter(
      (p) => p.isAlive && p.role?.team === TEAMS.VILLAGE
    );

    if (aliveWolves.length === 0) {
      this.winner = TEAMS.VILLAGE;
      return true;
    }
    if (aliveWolves.length >= aliveVillagers.length) {
      this.winner = TEAMS.WEREWOLF;
      return true;
    }
    return false;
  }

  // 生存プレイヤー一覧
  getAlivePlayers() {
    return this.players.filter((p) => p.isAlive);
  }

  // プレイヤー取得
  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  // 人間プレイヤー取得
  getHumanPlayer() {
    return this.players.find((p) => p.isHuman);
  }

  // ゲーム状態をローカルストレージに保存
  save() {
    try {
      localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(this));
    } catch (e) {
      console.warn('ゲーム状態の保存に失敗しました', e);
    }
  }

  // ローカルストレージから復元
  static load() {
    try {
      const data = localStorage.getItem(GAME_STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      const state = new GameState();
      Object.assign(state, parsed);
      return state;
    } catch (e) {
      console.warn('ゲーム状態の読み込みに失敗しました', e);
      return null;
    }
  }

  // ローカルストレージをクリア
  static clear() {
    localStorage.removeItem(GAME_STORAGE_KEY);
  }
}
