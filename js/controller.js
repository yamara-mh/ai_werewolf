// ゲームページ（game.html）コントローラー

document.addEventListener('DOMContentLoaded', async () => {
  // --- 状態ロード ---
  let gs = GameState.load();
  if (!gs || gs.phase === GAME_PHASES.END) {
    window.location.href = 'index.html';
    return;
  }

  const bbs = new BBS('bbs-container');
  const aiPlayer = new AIPlayer(gs);
  const logicAi = new LogicAI(gs);
  const humanPlayer = gs.getHumanPlayer();

  // --- UI要素 ---
  const phaseLabel = document.getElementById('phase-label');
  const dayLabel = document.getElementById('day-label');
  const roleLabel = document.getElementById('role-label');
  const endModal = document.getElementById('end-modal');
  const endMessage = document.getElementById('end-message');
  const restartBtn = document.getElementById('restart-btn');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const whisperToggleBtn = document.getElementById('whisper-mode-btn');
  const coRoleSelect = document.getElementById('co-role-select');
  const logicAiBtn = document.getElementById('logic-ai-btn');
  const bookmarkFilterBtn = document.getElementById('bookmark-filter-btn');
  const chatTopActions = document.getElementById('chat-top-actions');
  const logicAiModal = document.getElementById('logic-ai-modal');
  const logicAiContent = document.getElementById('logic-ai-content');
  const logicAiClose = document.getElementById('logic-ai-close');
  const voteModal = document.getElementById('vote-modal');
  const voteModalPlayerList = document.getElementById('vote-modal-player-list');
  const voteModalBackBtn = document.getElementById('vote-modal-back-btn');
  const nightModal = document.getElementById('night-modal');
  const nightModalPlayerList = document.getElementById('night-modal-player-list');
  const nightModalBackBtn = document.getElementById('night-modal-back-btn');
  const bbsContainer = document.getElementById('bbs-container');

  // ロジックAI 発動閾値管理
  let lastLogicAiThreshold = 0;

  // 人間が昼フェーズで1回目の発言を済ませたかフラグ
  let dayFirstPosted = false;
  let activePlayerFilterId = null;
  let selectedVoteTargetId = null;
  let whisperModeEnabled = false;

  const roleById = Object.values(ROLES).reduce((map, role) => {
    map[role.id] = role;
    return map;
  }, {});
  const knownAllyIds = new Set();

  // ロジックAIボタン表示制御
  if (logicAiBtn) {
    if (!gs.settings.showLogicAi) {
      logicAiBtn.style.display = 'none';
    }
  }

  // ロジックAIモーダル
  if (logicAiBtn) {
    logicAiBtn.addEventListener('click', () => {
      if (logicAiContent) {
        logicAiContent.textContent = gs.logicAiOutput || '（まだ分析が実行されていません）';
      }
      if (logicAiModal) logicAiModal.classList.remove('hidden');
    });
  }

  if (logicAiClose) {
    logicAiClose.addEventListener('click', () => {
      if (logicAiModal) logicAiModal.classList.add('hidden');
    });
  }

  if (logicAiModal) {
    logicAiModal.addEventListener('click', (e) => {
      if (e.target === logicAiModal) logicAiModal.classList.add('hidden');
    });
  }

  // 投票モーダルの「戻る」ボタン
  if (voteModalBackBtn) {
    voteModalBackBtn.addEventListener('click', () => {
      if (voteModal) voteModal.classList.add('hidden');
    });
  }
  if (voteModal) {
    voteModal.addEventListener('click', (e) => {
      if (e.target === voteModal) voteModal.classList.add('hidden');
    });
  }

  // 夜アクションモーダルの「戻る」ボタン
  if (nightModalBackBtn) {
    nightModalBackBtn.addEventListener('click', () => {
      if (nightModal) nightModal.classList.add('hidden');
    });
  }
  if (nightModal) {
    nightModal.addEventListener('click', (e) => {
      if (e.target === nightModal) nightModal.classList.add('hidden');
    });
  }

  // co-role-select を設定に含まれる役職のみ表示
  function setupCoRoleSelect() {
    if (!coRoleSelect) return;
    const optionalRoles = new Set(gs.settings.optionalRoles || []);
    const alwaysVisible = new Set(['', 'villager', 'werewolf']);
    Array.from(coRoleSelect.options).forEach((option) => {
      if (alwaysVisible.has(option.value)) return;
      option.style.display = optionalRoles.has(option.value) ? '' : 'none';
    });
  }
  setupCoRoleSelect();

  function isHumanActualWolf() {
    return isActualWolf(humanPlayer?.role);
  }

  function computeKnownAllyIds() {
    knownAllyIds.clear();
    if (humanPlayer?.role?.id === ROLES.SHARED.id) {
      gs.players
        .filter((p) => p.id !== humanPlayer.id && p.role?.id === ROLES.SHARED.id)
        .forEach((p) => knownAllyIds.add(p.id));
      return;
    }
    if (isHumanActualWolf()) {
      gs.players
        .filter((p) => p.id !== humanPlayer.id && isActualWolf(p.role))
        .forEach((p) => knownAllyIds.add(p.id));
    }
  }

  function updateBbsViewerContext() {
    bbs.setKnownAllies({
      allyIds: Array.from(knownAllyIds),
      canViewWhisper: isHumanActualWolf(),
    });
  }

  function updateWhisperButton() {
    if (!whisperToggleBtn) return;
    const visible = isHumanActualWolf() && humanPlayer.isAlive && gs.phase !== GAME_PHASES.END;
    whisperToggleBtn.style.display = visible ? '' : 'none';
    if (!visible) whisperModeEnabled = false;
    whisperToggleBtn.classList.toggle('btn--whisper-active', whisperModeEnabled);
    whisperToggleBtn.textContent = whisperModeEnabled ? '...' : '🤫';
  }

  computeKnownAllyIds();
  updateBbsViewerContext();
  updateWhisperButton();

  if (bookmarkFilterBtn) {
    bookmarkFilterBtn.addEventListener('click', () => {
      const enabled = bbs.toggleBookmarkFilter();
      bookmarkFilterBtn.classList.toggle('btn--bookmark-active', enabled);
      updateBbsContainerStyle();
    });
  }

  if (whisperToggleBtn) {
    whisperToggleBtn.addEventListener('click', () => {
      if (!isHumanActualWolf()) return;
      whisperModeEnabled = !whisperModeEnabled;
      updateWhisperButton();
    });
  }

  if (coRoleSelect) {
    coRoleSelect.addEventListener('change', async () => {
      const coRoleId = coRoleSelect.value;
      if (!coRoleId) return;
      const roleObj = roleById[coRoleId];
      const roleName = roleObj?.name || '不明な役職';
      const ok = window.confirm(`${roleName}でCOしますか？`);
      if (!ok) {
        coRoleSelect.value = '';
        return;
      }
      if (humanPlayer) {
        humanPlayer.coRole = coRoleId;
      }
      const post = gs.addPost({
        playerName: humanPlayer.name,
        playerId: humanPlayer.id,
        content: `${roleName}CO`,
        coRole: humanPlayer.coRole,
      });
      bbs.renderPost(post);
      renderPlayers();
      gs.save();
      coRoleSelect.value = '';
      await triggerLogicAiIfNeeded();
    });
  }

  // --- 永続チャットフォームのイベント設定 ---
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = chatInput ? chatInput.value.trim() : '';
      if (!text) return;

      const post = gs.addPost({
        playerName: humanPlayer.name,
        playerId: humanPlayer.id,
        content: text,
        type: whisperModeEnabled ? 'whisper' : 'speech',
        coRole: humanPlayer.coRole,
      });
      bbs.renderPost(post);
      if (chatInput) chatInput.value = '';
      renderPlayers();
      gs.save();

      // ロジックAI発動チェック
      await triggerLogicAiIfNeeded();

      // 昼フェーズで最初の発言なら次のフェーズ処理（AI後半→投票）を開始
      // その他のフェーズでは発言は掲示板に追加されるのみで進行には影響しない
      if (gs.phase === GAME_PHASES.DAY && !dayFirstPosted) {
        dayFirstPosted = true;
        await afterHumanSpeech();
      }
    });
  }

  if (chatInput && chatForm) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });
  }

  // --- 初期描画 ---
  renderPlayers();
  bbs.renderAll(gs.bbsLog);
  updateHeader();

  // CO セレクトは常に初期状態（なし）で表示
  if (coRoleSelect) coRoleSelect.value = '';

  // ゲームが初めて始まる場合（朝フェーズへ）
  if (gs.phase === GAME_PHASES.SETUP) {
    await startGame();
  } else {
    renderPhaseUI();
  }

  // --- ゲーム開始 ---
  async function startGame() {
    // 0日目: 初日占い結果を占い師に通達
    await runDay0SeerReveal();

    gs.nextPhase(); // SETUP -> MORNING
    bbs.renderPhaseHeader(gs.day, gs.phase);
    gs.addSystemPost(`ゲームが始まりました！${gs.players.length}人のプレイヤーが村に集まっています。`);
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
    runStartSecretAnnouncements();
    updateHeader();
    gs.save();
    await runMorning();
  }

  function runStartSecretAnnouncements() {
    if (!humanPlayer?.isAlive) return;
    if (humanPlayer.role?.id === ROLES.SHARED.id) {
      const partner = gs.players.find((p) => p.id !== humanPlayer.id && p.role?.id === ROLES.SHARED.id);
      if (partner) {
        gs.addSystemPost(`【GM秘密通達】あなたは共有者です。相方は ${partner.name} です。`);
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      }
      return;
    }
    if (isHumanActualWolf()) {
      const allies = gs.players
        .filter((p) => p.id !== humanPlayer.id && isActualWolf(p.role))
        .map((p) => p.name);
      if (allies.length > 0) {
        gs.addSystemPost(`【GM秘密通達】あなたの人狼仲間は ${allies.join('、')} です。`);
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      }
    }
  }

  // --- 0日目: 初日占い結果通達 ---
  async function runDay0SeerReveal() {
    const seer = gs.players.find((p) => p.role?.id === ROLES.SEER.id);
    if (!seer) return;

    // 占い師以外で「人間」に見える（=isSeerWerewolfでない）プレイヤーをランダムに選ぶ
    const targets = gs.players.filter((p) => p.id !== seer.id && !isSeerWerewolf(p.role));
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];

    // 人間プレイヤーが占い師の場合のみ結果を表示
    if (humanPlayer.role?.id === ROLES.SEER.id) {
      gs.addSystemPost(`【0日目・初日占い結果】${target.name} は人間です。（GMより占い師への秘密通達）`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      gs.save();
    }
  }

  // --- フェーズUI切替 ---
  function renderPhaseUI() {
    updateHeader();
    updateWhisperButton();
    renderPlayers();
    renderChatTopActions();

    switch (gs.phase) {
      case GAME_PHASES.VOTE:
        showVotePanel();
        break;
      case GAME_PHASES.NIGHT:
        showNightPanel();
        break;
      case GAME_PHASES.END:
        showEndModal();
        break;
      default:
        break;
    }
  }

  function updateHeader() {
    if (phaseLabel) phaseLabel.textContent = phaseText(gs.phase);
    if (dayLabel) dayLabel.textContent = gs.day > 0 ? `${gs.day}日目` : '';
    if (roleLabel && humanPlayer?.role) {
      roleLabel.textContent = `${humanPlayer.role.icon} ${humanPlayer.role.name}`;
    }
    updateWhisperButton();
  }

  function phaseText(phase) {
    const labels = {
      [GAME_PHASES.MORNING]: '🌅 朝',
      [GAME_PHASES.DAY]: '☀️ 昼（議論）',
      [GAME_PHASES.VOTE]: '🗳️ 投票',
      [GAME_PHASES.EXECUTION]: '⚖️ 処刑',
      [GAME_PHASES.NIGHT]: '🌙 夜',
      [GAME_PHASES.END]: '🏁 ゲーム終了',
    };
    return labels[phase] || '';
  }

  // --- 朝フェーズ ---
  async function runMorning() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    await sleep(500);

    if (gs.day === 1) {
      gs.addSystemPost('今日は初日です。自己紹介をしながら誰が人狼かを探りましょう。');
    }
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);

    await sleep(800);
    gs.nextPhase(); // MORNING -> DAY
    gs.save();
    await runDay();
  }

  // --- 昼フェーズ ---
  async function runDay() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();
    dayFirstPosted = false;

    // AIが順番に発言（前半）
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);
    const firstHalf = aiPlayers.slice(0, Math.ceil(aiPlayers.length / 2));

    await runAISpeeches(firstHalf);

    gs.save();
  }

  async function afterHumanSpeech() {
    // 残りのAIが発言
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);
    const secondHalf = aiPlayers.slice(Math.ceil(aiPlayers.length / 2));
    await runAISpeeches(secondHalf);

    // 投票フェーズへ
    await sleep(500);
    gs.nextPhase(); // DAY -> VOTE
    gs.save();
    await runVote();
  }

  // --- AIの発言ループ ---
  async function runAISpeeches(players) {
    for (const player of players) {
      await sleep(800 + Math.random() * 700);
      bbs.showTypingIndicator(player.name);
      await sleep(1000 + Math.random() * 1000);
      const speech = await aiPlayer.generateSpeech(player);
      bbs.removeTypingIndicator();

      const post = gs.addPost({
        playerName: player.name,
        playerId: player.id,
        content: speech,
        coRole: player.coRole,
      });
      bbs.renderPost(post);
      gs.save();

      await triggerLogicAiIfNeeded();
    }
  }

  // --- ロジックAI 発動チェック ---
  async function triggerLogicAiIfNeeded() {
    const totalChars = gs.bbsLog
      .filter((p) => p.type !== 'system')
      .reduce((sum, p) => sum + (p.content ? p.content.length : 0), 0);
    const threshold = Math.floor(totalChars / 500);
    if (threshold > lastLogicAiThreshold) {
      lastLogicAiThreshold = threshold;
      const analysis = await logicAi.analyze();
      gs.logicAiOutput = analysis;
      gs.save();
    }
  }

  // --- 投票フェーズ ---
  async function runVote() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();
    selectedVoteTargetId = null;
    renderChatTopActions();

    // AIが投票
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);
    for (const player of aiPlayers) {
      const target = await aiPlayer.decideVote(player);
      if (target) {
        gs.castVote(player.id, target.id);
        const post = gs.addPost({
          playerName: player.name,
          playerId: player.id,
          content: `${target.name} に投票します。`,
          type: 'vote',
          coRole: player.coRole,
        });
        bbs.renderPost(post);
        await sleep(400);
      }
    }

    // 人間の投票UI
    showVotePanel();
    gs.save();
  }

  function showVotePanel() {
    renderPlayers();
    renderChatTopActions();
  }

  // --- 処刑フェーズ ---
  async function runExecution() {
    gs.nextPhase(); // VOTE -> EXECUTION
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();

    await sleep(600);
    const tallyResult = gs.tallyVotes();
    const executed = tallyResult?.executed || null;
    const counts = tallyResult?.counts || {};

    if (executed) {
      const voteText = Object.entries(counts)
        .map(([id, c]) => {
          const p = gs.getPlayer(id);
          return `${p?.name || id}: ${c}票`;
        })
        .join('、');

      gs.addSystemPost(`投票結果：${voteText}`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      await sleep(800);
      gs.addSystemPost(`${executed.name} が処刑されました。役職は「${executed.role?.name}」でした。`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      renderPlayers();
    } else {
      gs.addSystemPost('投票が成立しませんでした。本日の処刑は見送られます。');
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
    }

    gs.save();
    await sleep(1000);

    // 勝利チェック
    if (gs._checkWinCondition()) {
      gs.phase = GAME_PHASES.END;
      gs.save();
      showEndModal();
      return;
    }

    gs.nextPhase(); // EXECUTION -> NIGHT (or END)
    gs.save();

    if (gs.phase === GAME_PHASES.END) {
      showEndModal();
    } else {
      await runNight();
    }
  }

  // --- 夜フェーズ ---
  async function runNight() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();
    gs.addSystemPost('夜が訪れました。人狼が村人を狙っています…');
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);

    // AIのナイトアクション処理（バックグラウンド）
    const aiActionPromises = gs.getAlivePlayers()
      .filter((p) => !p.isHuman && p.role?.id !== ROLES.VILLAGER.id && p.role?.id !== ROLES.MADMAN.id)
      .map(async (player) => {
        const target = await aiPlayer.decideNightAction(player);
        if (target) gs.setNightAction(player.id, target.id);
      });

    // 人間のナイトアクション
    if (humanPlayer.isAlive) {
      const humanRole = humanPlayer.role;
      if (
        isWerewolfRole(humanRole) ||
        humanRole?.id === ROLES.SEER.id ||
        humanRole?.id === ROLES.HUNTER.id
      ) {
        await showNightPanelAsync();
      } else {
        await sleep(2000); // 何もアクションない役職は待つ
      }
    }

    // AIアクション完了を待つ
    await Promise.all(aiActionPromises);
    // 夜アクションボタンを消す
    renderChatTopActions();
    gs.save();

    // 夜アクション解決
    await sleep(800);
    const results = gs.resolveNightActions();

    if (results.attacked) {
      gs.addSystemPost(`朝になりました。${results.attacked.name} が昨夜、人狼に襲撃されました…`);
    } else if (results.saved) {
      gs.addSystemPost('朝になりました。昨夜は騎士の活躍により、犠牲者はいませんでした。');
    } else {
      gs.addSystemPost('朝になりました。昨夜は誰も犠牲になりませんでした。');
    }

    // 占い師結果（人間が占い師の場合のみ表示）
    if (results.seerResult && humanPlayer.role?.id === ROLES.SEER.id) {
      const { target, isWerewolf } = results.seerResult;
      gs.addSystemPost(
        `【占い結果】${target.name} は${isWerewolf ? '🐺 人狼' : '✅ 人狼ではない'}です。`
      );
    }

    renderPlayers();
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
    gs.save();

    // 勝利チェック
    if (gs._checkWinCondition()) {
      gs.phase = GAME_PHASES.END;
      gs.save();
      showEndModal();
      return;
    }

    // 翌日の朝へ
    gs.nextPhase(); // NIGHT -> MORNING
    gs.save();
    await runMorning();
  }

  // 夜アクションパネルをPromiseで返す（モーダル経由）
  function showNightPanelAsync() {
    return new Promise((resolve) => {
      nightActionResolve = resolve;
      renderChatTopActions();
    });
  }

  function showNightPanel() {
    renderChatTopActions();
  }

  // --- ゲーム終了モーダル ---
  function showEndModal() {
    updateHeader();
    if (!endModal) return;

    const winnerTeam = gs.winner;
    const humanWon =
      (winnerTeam === TEAMS.VILLAGE && humanPlayer.role?.team === TEAMS.VILLAGE) ||
      (winnerTeam === TEAMS.WEREWOLF && humanPlayer.role?.team === TEAMS.WEREWOLF);

    const winLabel = winnerTeam === TEAMS.VILLAGE ? '🎉 村人陣営の勝利！' : '🐺 人狼陣営の勝利！';
    const personalResult = humanWon ? 'あなたも勝利しました！' : 'あなたは敗北しました…';

    if (endMessage) {
      endMessage.innerHTML = `
        <p class="end-result">${winLabel}</p>
        <p>${personalResult}</p>
        <div class="player-roles">
          ${gs.players.map((p) => {
            const isAlly = knownAllyIds.has(p.id);
            const nameHtml = buildPlayerNameHtml(p.name, { coRole: p.coRole, isAlly });
            return `<div class="${p.isHuman ? 'font-bold' : ''}">${nameHtml}：${p.role?.icon} ${p.role?.name}</div>`;
          }).join('')}
        </div>`;
    }

    endModal.classList.remove('hidden');
    selectedVoteTargetId = null;
    if (chatTopActions) chatTopActions.innerHTML = '';
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      GameState.clear();
      window.location.href = 'index.html';
    });
  }

  // --- ユーティリティ ---
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function updateBbsContainerStyle() {
    if (!bbsContainer) return;
    if (activePlayerFilterId) {
      bbsContainer.style.backgroundColor = 'var(--filter-player-bg)';
    } else if (bbs.isBookmarkFilterEnabled) {
      bbsContainer.style.backgroundColor = 'var(--filter-bookmark-bg)';
    } else {
      bbsContainer.style.backgroundColor = '';
    }
  }

  function renderPlayers() {
    renderPlayerList(gs.players, {
      onPlayerClick: handlePlayerCardClick,
      activePlayerId: activePlayerFilterId,
      voteTargetId: selectedVoteTargetId,
      italicPlayerIds: knownAllyIds,
    });
  }

  function handlePlayerCardClick(player) {
    activePlayerFilterId = bbs.togglePlayerFilter(player.id);
    renderPlayers();
    updateBbsContainerStyle();
  }

  // --- chat-form__top のアクションボタン管理 ---
  function renderChatTopActions() {
    if (!chatTopActions) return;
    chatTopActions.innerHTML = '';

    if (gs.phase === GAME_PHASES.VOTE) {
      const voteBtn = document.createElement('button');
      voteBtn.type = 'button';
      voteBtn.className = 'btn btn--vote btn--sm';
      voteBtn.textContent = '🗳️ 投票先を選ぶ';
      voteBtn.addEventListener('click', () => showVoteModal());
      chatTopActions.appendChild(voteBtn);
    }

    if (gs.phase === GAME_PHASES.NIGHT && humanPlayer.isAlive) {
      const humanRole = humanPlayer.role;
      let btnLabel = '';
      if (isWerewolfRole(humanRole)) btnLabel = '🐺 襲撃先を選ぶ';
      else if (humanRole?.id === ROLES.SEER.id) btnLabel = '🔮 占い先を選ぶ';
      else if (humanRole?.id === ROLES.HUNTER.id) btnLabel = '🛡️ 防衛先を選ぶ';

      if (btnLabel) {
        const nightBtn = document.createElement('button');
        nightBtn.type = 'button';
        nightBtn.id = 'night-action-btn';
        nightBtn.className = 'btn btn--night btn--sm';
        nightBtn.textContent = btnLabel;
        nightBtn.addEventListener('click', () => showNightModal());
        chatTopActions.appendChild(nightBtn);
      }
    }
  }

  function buildModalPlayerButtonContent(player) {
    const isAlly = knownAllyIds.has(player.id);
    const nameHtml = buildPlayerNameHtml(player.name, { coRole: player.coRole, isAlly });
    const portraitSrc = `personality/portrait/${escapeHtml(player.name)}.png`;
    return `
      <img src="${portraitSrc}" onerror="this.src='personality/portrait/default.png'" class="player-portrait player-portrait--post" alt="" />
      <span class="modal-player-btn__name">${nameHtml}</span>`;
  }

  // --- 投票モーダル表示 ---
  function showVoteModal() {
    if (!voteModal || !voteModalPlayerList) return;
    voteModalPlayerList.innerHTML = '';
    const alivePlayers = gs.getAlivePlayers().filter(
      (p) => p.isAlive && p.id !== humanPlayer.id
    );
    alivePlayers.forEach((player) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--vote modal-player-btn';
      btn.innerHTML = buildModalPlayerButtonContent(player);
      btn.addEventListener('click', async () => {
        const ok = window.confirm(`${player.name} に投票しますか？`);
        if (!ok) return;
        voteModal.classList.add('hidden');
        await submitVote(player);
      });
      voteModalPlayerList.appendChild(btn);
    });
    voteModal.classList.remove('hidden');
  }

  // --- 夜アクションモーダル表示 ---
  let nightActionResolve = null;
  function showNightModal() {
    if (!nightModal || !nightModalPlayerList) return;
    nightModalPlayerList.innerHTML = '';
    const alivePlayers = gs.getAlivePlayers().filter((p) => p.id !== humanPlayer.id);
    alivePlayers.forEach((player) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--night modal-player-btn';
      btn.innerHTML = buildModalPlayerButtonContent(player);
      btn.addEventListener('click', () => {
        nightModal.classList.add('hidden');
        gs.setNightAction(humanPlayer.id, player.id);
        renderChatTopActions();
        if (nightActionResolve) {
          nightActionResolve();
          nightActionResolve = null;
        }
      });
      nightModalPlayerList.appendChild(btn);
    });
    nightModal.classList.remove('hidden');
  }

  async function submitVote(target) {
    if (gs.phase !== GAME_PHASES.VOTE) return;
    gs.castVote(humanPlayer.id, target.id);
    const post = gs.addPost({
      playerName: humanPlayer.name,
      playerId: humanPlayer.id,
      content: `${target.name} に投票します。`,
      type: 'vote',
      coRole: humanPlayer.coRole,
    });
    bbs.renderPost(post);
    selectedVoteTargetId = null;
    renderChatTopActions();
    gs.save();
    await runExecution();
  }
});
