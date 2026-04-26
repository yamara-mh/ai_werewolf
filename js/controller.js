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
  const batchConversationAI = new BatchConversationAI(gs);
  const precisionConversationAI = new PrecisionConversationAI(gs);
  const playerPropertyAI = new PlayerPropertyAI(gs);
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
  const chatSubmitBtn = document.getElementById('chat-submit');
  const whisperToggleBtn = document.getElementById('whisper-mode-btn');
  const coRoleSelect = document.getElementById('co-role-select');
  // COドロップダウンを隠す
  if (coRoleSelect) coRoleSelect.style.display = 'none';
  const logicAiBtn = document.getElementById('logic-ai-btn');
  const bookmarkFilterBtn = document.getElementById('bookmark-filter-btn');
  const chatTopActions = document.getElementById('chat-top-actions');
  const watchBar = document.getElementById('watch-bar');
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

  let activePlayerFilterId = null;
  let selectedVoteTargetId = null;
  let wolfChatModeEnabled = false;
  // 通常チャットと狼チャットそれぞれの入力テキストを保持
  let normalChatDraft = '';
  let wolfChatDraft = '';
  // 最後に閲覧した時点での wolf_chat 投稿数（未読通知ドット用）
  let wolfChatSeenPostCount = 0;

  // アドベンチャーモード：会話バッファ管理
  let conversationBuffer = [];
  let bufferGenerating = false;
  let storyGenerating = false;
  let uiLocked = false;
  const BUFFER_TARGET = 10;
  const BUFFER_REFILL_AT = 5;
  const BUFFER_REFILL_COUNT = 5;

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
        logicAiContent.textContent = gs.previousDaysSynopsis || '（まだ分析が実行されていません）';
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

  // wolf_chat 投稿の総数を返す
  function getWolfChatPostCount() {
    return gs.bbsLog.filter((p) => p.type === 'wolf_chat' || p.type === 'whisper').length;
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

  function updateRoleLabel() {
    // whisper-mode-btn は廃止。常に非表示にする
    if (whisperToggleBtn) whisperToggleBtn.style.display = 'none';

    if (!roleLabel) return;
    const icon = humanPlayer?.role?.icon || '';
    const isWolf = isHumanActualWolf();
    const visible = isWolf && humanPlayer.isAlive && gs.phase !== GAME_PHASES.END;

    // アイコンを再設定（通知ドットは後で付与するので先にリセット）
    roleLabel.textContent = icon;

    if (visible) {
      roleLabel.style.cursor = 'pointer';
      roleLabel.classList.toggle('chat-role-label--wolf-chat', wolfChatModeEnabled);

      // 未読通知ドット
      const hasUnread = !wolfChatModeEnabled && getWolfChatPostCount() > wolfChatSeenPostCount;
      if (hasUnread) {
        const dot = document.createElement('span');
        dot.className = 'wolf-chat-notification-dot';
        roleLabel.appendChild(dot);
      }
    } else {
      roleLabel.style.cursor = '';
      roleLabel.classList.remove('chat-role-label--wolf-chat');
      wolfChatModeEnabled = false;
    }
  }

  function canHumanPostNow() {
    if (uiLocked) return false;
    if (!humanPlayer?.isAlive) return false;
    // 夜でも人狼専用チャットなら投稿可能
    if (gs.phase === GAME_PHASES.NIGHT) return wolfChatModeEnabled && isHumanActualWolf();
    if (gs.phase === GAME_PHASES.END) return false;
    if (gs.phase === GAME_PHASES.VOTE || gs.phase === GAME_PHASES.EXECUTION) return false;
    return true;
  }

  function updateChatAvailability() {
    const canPost = canHumanPostNow();
    const chatBar = document.querySelector('.chat-bar');
    if (chatInput) {
      chatInput.disabled = !canPost;
      if (!canPost) {
        chatInput.placeholder = humanPlayer?.isAlive
          ? '夜の間は投稿できません'
          : '死亡中は投稿できません';
      } else {
        chatInput.placeholder = wolfChatModeEnabled
          ? '🐺 人狼専用チャット（Ctrl + Enterで投稿）'
          : '発言を入力（Ctrl + Enterで投稿）';
      }
      chatInput.classList.toggle('chat-input--wolf-chat', wolfChatModeEnabled && isHumanActualWolf());
    }
    if (chatSubmitBtn) chatSubmitBtn.disabled = !canPost;
    if (chatBar) chatBar.classList.toggle('chat-bar--wolf-chat', wolfChatModeEnabled && isHumanActualWolf());
  }

  function getPlayerDisplayText(player) {
    if (!player) return '';
    return buildPlayerNameText(player.name, {
      coRole: player.coRole,
      fallbackRoleId: ROLES.VILLAGER.id,
    });
  }

  computeKnownAllyIds();
  updateBbsViewerContext();
  updateRoleLabel();
  updateChatAvailability();

  if (bookmarkFilterBtn) {
    bookmarkFilterBtn.addEventListener('click', () => {
      const enabled = bbs.toggleBookmarkFilter();
      bookmarkFilterBtn.classList.toggle('btn--bookmark-active', enabled);
      updateBbsContainerStyle();
      renderChatTopActions();
    });
  }

  // role-label クリックで狼チャットモードをトグル（人狼・大狼のみ）
  if (roleLabel) {
    roleLabel.addEventListener('click', () => {
      if (!isHumanActualWolf()) return;
      if (!humanPlayer.isAlive || gs.phase === GAME_PHASES.END) return;
      // 現在のドラフトを保存してから切り替え
      if (chatInput) {
        if (wolfChatModeEnabled) {
          wolfChatDraft = chatInput.value;
        } else {
          normalChatDraft = chatInput.value;
        }
      }
      wolfChatModeEnabled = !wolfChatModeEnabled;
      // 狼チャットモードに入ったら既読にする
      if (wolfChatModeEnabled) {
        wolfChatSeenPostCount = getWolfChatPostCount();
      }
      // 切り替え後のドラフトを復元
      if (chatInput) {
        chatInput.value = wolfChatModeEnabled ? wolfChatDraft : normalChatDraft;
      }
      updateRoleLabel();
      updateChatAvailability();
    });
  }

  // --- 永続チャットフォームのイベント設定 ---
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!canHumanPostNow()) return;
      const text = chatInput ? chatInput.value.trim() : '';
      if (!text) return;

      // プロパティ付与プロンプトで解析
      setLoadingState(true);
      let properties = null;
      try {
        properties = await playerPropertyAI.analyzePost(humanPlayer, text);

        // プロパティの適用
        const validRoleIds = new Set(Object.values(ROLES).map((r) => r.id));
        if (properties.coRole && !humanPlayer.coRole && validRoleIds.has(properties.coRole)) {
          humanPlayer.coRole = properties.coRole;
        }

        // 占い結果（白だし・黒だし）適用
        if (properties.villager && properties.villager.length > 0) {
          applyVerdicts(properties.villager, 'white');
        }
        if (properties.werewolf && properties.werewolf.length > 0) {
          applyVerdicts(properties.werewolf, 'black');
        }

        // 投票先変更適用
        if (properties.vote) {
          const voteTarget = gs.getAlivePlayers().find(
            (p) => p.name === properties.vote && p.id !== humanPlayer.id
          );
          if (voteTarget) {
            gs.castVote(humanPlayer.id, voteTarget.id);
            checkVoteWarning();
          }
        }

        const post = gs.addPost({
          playerName: humanPlayer.name,
          playerId: humanPlayer.id,
          content: text,
          type: wolfChatModeEnabled ? 'wolf_chat' : 'speech',
          coRole: humanPlayer.coRole,
        });
        bbs.renderPost(post);
        // 役職CO 時は自動ブックマーク
        if (shouldAutoBookmark({ coRole: properties.coRole, verdictWhite: properties.villager, verdictBlack: properties.werewolf })) {
          bbs.autoBookmarkPost(post.id);
        }
        // 人狼チャット投稿時は既読カウントを更新
        if (wolfChatModeEnabled) {
          wolfChatSeenPostCount = getWolfChatPostCount();
        }
        if (chatInput) chatInput.value = '';
        // ドラフトもリセット
        if (wolfChatModeEnabled) wolfChatDraft = '';
        else normalChatDraft = '';
        renderPlayers();
        gs.save();

        // 昼フェーズ：バッファをクリアして再生成
        if (gs.phase === GAME_PHASES.DAY) {
          conversationBuffer = [];
          if (!wolfChatModeEnabled && !gs.settings.tokenSavingMode) {
            // 人間プレイヤーが投稿したのでストーリーを無効化して再生成
            precisionConversationAI.invalidateStory();
            // ストーリーテラーの再生成と会話バッファ生成を並行実行
            // 注: これらは独立した処理。generateConversationBuffer は内部で
            // _determineSpeaker を呼び、必要に応じて _refreshStory を実行する
            // ため、ここで明示的に refreshStory を呼んでおくことで待ち時間を短縮
            storyGenerating = true;
            renderChatTopActions();
            try {
              await Promise.all([
                precisionConversationAI.refreshStory(conversationBuffer),
                generateConversationBuffer(1)
              ]);
              // 初回生成完了後、バッファが少なければ続けて生成
              tryGenerateNextConversation();
            } finally {
              storyGenerating = false;
              renderChatTopActions();
            }
          } else {
            // トークン節約モードの場合は通常通り
            const refillCount = gs.settings.tokenSavingMode ? BUFFER_TARGET : 1;
            await generateConversationBuffer(refillCount);
            // 初回生成完了後、バッファが少なければ続けて生成
            tryGenerateNextConversation();
          }
        }
      } finally {
        setLoadingState(false);
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
  // ゲームロード時にプレイヤーの占い結果をBBSに反映する
  const initialVerdicts = {};
  gs.players.forEach((p) => {
    if (p.seerVerdict) initialVerdicts[p.id] = p.seerVerdict;
  });
  bbs.setSeerVerdicts(initialVerdicts);
  bbs.renderAll(gs.bbsLog);
  updateHeader();

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
        gs.addSystemPost(`【GM秘密通達】あなたは共有者です。相方は ${getPlayerDisplayText(partner)} です。`);
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      }
      return;
    }
    if (isHumanActualWolf()) {
      const allies = gs.players
        .filter((p) => p.id !== humanPlayer.id && isActualWolf(p.role))
        .map((p) => getPlayerDisplayText(p));
      if (allies.length > 0) {
        gs.addSystemPost(`【GM秘密通達】あなたの人狼仲間は ${allies.join('、')} です。`);
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      }
    }
  }

  // --- 0日目: 初日占い結果通達 ---
  async function runDay0SeerReveal() {
    const initialSeerReveal = gs.prepareInitialSeerReveal();
    if (!initialSeerReveal) return;
    const { target, verdict } = initialSeerReveal;

    // 人間プレイヤーが占い師の場合のみ結果を表示し、BBSの占い結果アイコンを更新
    if (humanPlayer.role?.id === ROLES.SEER.id) {
      gs.addSystemPost(`【0日目・初日占い結果】${getPlayerDisplayText(target)} は${verdict === 'black' ? '人狼' : '人間'}です。（GMより占い師への秘密通達）`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      bbs.updatePlayerVerdict(target.id, verdict);
    }
    gs.save();
  }

  // --- フェーズUI切替 ---
  function renderPhaseUI() {
    updateHeader();
    updateRoleLabel();
    updateChatAvailability();
    renderPlayers();
    renderChatTopActions();

    switch (gs.phase) {
      case GAME_PHASES.DAY:
        if (!bufferGenerating && conversationBuffer.length === 0) {
          const refillCount = gs.settings.tokenSavingMode ? BUFFER_TARGET : 1;
          generateConversationBuffer(refillCount).then(() => {
            // 初回生成完了後、バッファが少なければ続けて生成
            tryGenerateNextConversation();
          });
        }
        break;
      case GAME_PHASES.VOTE:
        setTimeout(() => runVote(), 0);
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
    updateRoleLabel();
    updateChatAvailability();
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
    conversationBuffer = [];

    // 標準モードのストーリーキューをリセットして再生成
    if (!gs.settings.tokenSavingMode) {
      precisionConversationAI.resetQueue();
      // 会議開始時にストーリーテラーを再生成
      storyGenerating = true;
      renderChatTopActions();
      try {
        await precisionConversationAI.refreshStory(conversationBuffer);
      } finally {
        storyGenerating = false;
        renderChatTopActions();
      }
    }

    // 会話バッファ生成を開始（非ブロッキング）
    const initialCount = gs.settings.tokenSavingMode ? BUFFER_TARGET : 1;
    generateConversationBuffer(initialCount).then(() => {
      // 初回生成完了後、バッファが少なければ続けて生成
      tryGenerateNextConversation();
    });
    renderChatTopActions();

    gs.save();
  }


  // --- 投票フェーズ ---
  async function runVote() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();
    selectedVoteTargetId = null;
    renderChatTopActions();

    gs.addSystemPost('投票が締め切られました。集計を行います…');
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);

    gs.save();
    await sleep(500);
    await runExecution();
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
          return `${p ? p.name : id}: ${c}票`;
        })
        .join('、');

      gs.addSystemPost(`投票結果：${voteText}`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      await sleep(800);
      gs.addSystemPost(`${executed.name} が処刑されました。`);
      bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      renderPlayers();

      // 霊媒師（人間）への秘密通達
      if (humanPlayer.isAlive && humanPlayer.role?.id === ROLES.MEDIUM.id) {
        gs.addSystemPost(`【霊媒結果】${executed.name} は ${executed.role?.icon} ${executed.role?.name} でした。（GMより霊媒師への秘密通達）`);
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
      }
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

    // 今日のチャットを「前日までのあらすじ」としてまとめる（バックグラウンドで実行）
    batchConversationAI.generateSynopsis().then((synopsis) => {
      if (synopsis) {
        gs.previousDaysSynopsis = synopsis;
        gs.save();
      }
    }).catch((e) => console.warn('あらすじ更新エラー:', e));

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
        `【占い結果】${getPlayerDisplayText(target)} は${isWerewolf ? '🐺 人狼' : '✅ 人狼ではない'}です。`
      );
      const verdict = isWerewolf ? 'black' : 'white';
      target.seerVerdict = verdict;
      bbs.updatePlayerVerdict(target.id, verdict);
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
    if (watchBar) watchBar.innerHTML = '';
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

  // 占い結果（白だし・黒だし）をプレイヤーに適用し、BBSに反映する
  function applyVerdicts(names, verdict) {
    if (!Array.isArray(names) || names.length === 0) return;
    names.forEach((name) => {
      const target = gs.players.find((p) => p.name === name);
      if (target) {
        target.seerVerdict = verdict;
        bbs.updatePlayerVerdict(target.id, verdict);
      }
    });
  }

  // 役職CO・白だし・黒だしがある場合に自動ブックマーク対象かどうかを判定する
  function shouldAutoBookmark(postData) {
    return !!(
      postData.coRole ||
      (postData.verdictWhite && postData.verdictWhite.length > 0) ||
      (postData.verdictBlack && postData.verdictBlack.length > 0)
    );
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
    if (watchBar) watchBar.innerHTML = '';

    // 様子を見るボタン：昼フェーズのみ表示（watch-bar に配置）
    if (gs.phase === GAME_PHASES.DAY && watchBar) {
      if (bbs.isBookmarkFilterEnabled) {
        const bookmarkNotice = document.createElement('div');
        bookmarkNotice.className = 'watch-bar__notice';
        bookmarkNotice.textContent = 'ブックマークフィルターが有効になっています';
        watchBar.appendChild(bookmarkNotice);
      }
      if (bbs.playerFilterId) {
        const playerFilterNotice = document.createElement('div');
        playerFilterNotice.className = 'watch-bar__notice';
        playerFilterNotice.textContent = 'プレイヤーフィルターが有効になっています';
        watchBar.appendChild(playerFilterNotice);
      }
      const watchBtn = document.createElement('button');
      watchBtn.type = 'button';
      watchBtn.id = 'watch-btn';
      watchBtn.className = 'btn btn--watch btn--watch-bar';
      if (uiLocked) {
        watchBtn.textContent = '📖 AI生成中…';
        watchBtn.disabled = true;
      } else if (storyGenerating) {
        watchBtn.textContent = '📖 AI生成中';
        watchBtn.disabled = true;
      } else if (bufferGenerating && conversationBuffer.length === 0) {
        watchBtn.textContent = '📖 読み込み中…';
        watchBtn.disabled = true;
      } else if (conversationBuffer.length === 0) {
        watchBtn.textContent = '📖 様子を見る';
        watchBtn.disabled = true;
      } else {
        watchBtn.textContent = '📖 様子を見る';
        watchBtn.disabled = false;
      }
      watchBtn.addEventListener('click', () => revealNextPost());
      watchBar.appendChild(watchBtn);
    }

    // 投票ボタン：廃止（プロパティ付与プロンプトで対応）
    // 昼・投票フェーズでも投票ボタンは表示しない

    if (gs.phase === GAME_PHASES.NIGHT && humanPlayer.isAlive) {
      const humanRole = humanPlayer.role;
      let btnLabel = '';
      if (isWerewolfRole(humanRole)) btnLabel = '襲撃';
      else if (humanRole?.id === ROLES.SEER.id) btnLabel = '占う';
      else if (humanRole?.id === ROLES.HUNTER.id) btnLabel = '守る';

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
    const nameHtml = buildPlayerNameHtml(player.name, {
      coRole: player.coRole,
      isAlly,
      fallbackRoleId: ROLES.VILLAGER.id,
    });
    return `
      <img class="player-portrait player-portrait--post" alt="" />
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
      const portraitImg = btn.querySelector('.player-portrait');
      if (portraitImg) loadPortraitSrc(portraitImg, `personality/portrait/${player.name}/default.png`);
      btn.addEventListener('click', async () => {
        const ok = window.confirm(`${getPlayerDisplayText(player)} に投票しますか？`);
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
    const humanRole = humanPlayer.role;
    alivePlayers.forEach((player) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--night modal-player-btn';
      btn.innerHTML = buildModalPlayerButtonContent(player);
      const portraitImg = btn.querySelector('.player-portrait');
      if (portraitImg) loadPortraitSrc(portraitImg, `personality/portrait/${player.name}/default.png`);
      btn.addEventListener('click', () => {
        let confirmMsg = '';
        if (isWerewolfRole(humanRole)) {
          confirmMsg = `${getPlayerDisplayText(player)} を襲撃しますか？`;
        } else if (humanRole?.id === ROLES.SEER.id) {
          confirmMsg = `${getPlayerDisplayText(player)} を占いますか？`;
        } else if (humanRole?.id === ROLES.HUNTER.id) {
          confirmMsg = `${getPlayerDisplayText(player)} を護衛しますか？`;
        } else {
          confirmMsg = `${getPlayerDisplayText(player)} を選択しますか？`;
        }
        const ok = window.confirm(confirmMsg);
        if (!ok) return;
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
    const allowed = gs.phase === GAME_PHASES.DAY || gs.phase === GAME_PHASES.VOTE;
    if (!allowed || !humanPlayer.isAlive) return;

    selectedVoteTargetId = target.id;
    gs.castVote(humanPlayer.id, target.id);

    const post = gs.addPost({
      playerName: humanPlayer.name,
      playerId: humanPlayer.id,
      content: `${getPlayerDisplayText(target)} に投票します。`,
      type: 'vote',
      coRole: humanPlayer.coRole,
    });
    bbs.renderPost(post);
    renderChatTopActions();
    gs.save();

    checkVoteWarning();
    checkAndTriggerVote();
  }

  // --- 投票警告チェック ---
  function checkVoteWarning() {
    if (gs.phase !== GAME_PHASES.DAY) return;
    const alive = gs.getAlivePlayers();
    const voterCount = Object.keys(gs.votes).filter((id) => alive.some((p) => p.id === id)).length;

    // 全員が投票したら会議終了（あと一人で全員投票の状態で警告）
    if (voterCount === alive.length - 1 && alive.length > 1) {
      const recentSystem = gs.bbsLog.slice(-5).find(
        (p) => p.type === 'system' && p.content?.includes('あと一人が投票先を設定')
      );
      if (!recentSystem) {
        gs.addSystemPost('【GMより】あと一人が投票先を設定すると、投票フェーズに移行します。');
        bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
        gs.save();
      }
    }
  }

  // --- 投票閾値チェック・DAY→VOTE 自動遷移 ---
  function checkAndTriggerVote() {
    if (gs.phase !== GAME_PHASES.DAY) return false;
    const alive = gs.getAlivePlayers();
    const voterCount = Object.keys(gs.votes).filter((id) => alive.some((p) => p.id === id)).length;

    // 全員が投票したら会議終了
    if (voterCount === alive.length) {
      conversationBuffer = [];
      gs.nextPhase(); // DAY -> VOTE
      gs.save();
      runVote();
      return true;
    }
    return false;
  }

  // --- バッファ生成 ---
  async function generateConversationBuffer(count) {
    if (bufferGenerating) return;
    bufferGenerating = true;
    renderChatTopActions();
    try {
      if (!gs.settings.tokenSavingMode) {
        // 標準モード: 1発言ずつ順番に生成。
        // conversationBuffer には bbsLog 未反映の投稿が蓄積されているため、
        // それらを含む unreflectedPosts を各 generateNext() に渡す。
        // これにより、次の発言者プロンプトにバッファ内の全未反映投稿が反映される。
        const genCount = Math.max(1, count);
        const unreflectedPosts = [...conversationBuffer]; // バッファ内の既存未反映投稿を引き継ぐ
        for (let i = 0; i < genCount; i++) {
          const posts = await precisionConversationAI.generateNext(unreflectedPosts.length > 0 ? unreflectedPosts : null);
          if (posts && posts.length > 0) {
            conversationBuffer.push(...posts);
            unreflectedPosts.push(...posts); // 今生成した投稿も次イテレーションで未反映として渡す
          }
        }
      } else {
        const result = await batchConversationAI.generateAdventure(count);
        conversationBuffer.push(...result.posts);
      }
    } finally {
      bufferGenerating = false;
      renderChatTopActions();
    }
  }

  /**
   * バッファが少なく、投票が締め切られていない場合に会話を1つ生成する。
   * 生成完了後、まだバッファが少なければ自動的に次の生成を開始する。
   * これにより、precisionConversationPromptを1つずつ順次実行する。
   */
  function tryGenerateNextConversation() {
    if (bufferGenerating) return;
    if (gs.phase !== GAME_PHASES.DAY) return;
    
    // 投票が締め切られる条件（全員が投票）に達したら生成を停止
    const alive = gs.getAlivePlayers();
    const voterCount = Object.keys(gs.votes).filter((id) => alive.some((p) => p.id === id)).length;
    if (voterCount === alive.length) return;
    
    // バッファが少ない場合のみ生成
    if (conversationBuffer.length <= BUFFER_REFILL_AT) {
      generateConversationBuffer(1)
        .then(() => {
          // 生成完了後、まだバッファが少なければ続けて生成
          tryGenerateNextConversation();
        })
        .catch((error) => {
          console.error('会話生成エラー:', error);
          // エラー発生時は生成チェーンを停止
        });
    }
  }

  // --- バッファから次の投稿を表示 ---
  async function revealNextPost() {
    if (uiLocked || gs.phase !== GAME_PHASES.DAY) return;

    // 有効な投稿を探す（死亡・人間プレイヤーはスキップ）
    let postData = null;
    while (conversationBuffer.length > 0) {
      const candidate = conversationBuffer.shift();
      const player = gs.getAlivePlayers().find((p) => p.name === candidate.name && !p.isHuman);
      if (player) {
        postData = { ...candidate, player };
        break;
      }
    }

    renderChatTopActions();

    if (!postData) {
      // バッファが空なら次の会話を生成開始
      tryGenerateNextConversation();
      return;
    }

    const { player } = postData;

    // CO 適用（有効な役職IDの場合のみ）
    const validRoleIds = new Set(Object.values(ROLES).map((r) => r.id));
    if (postData.coRole && !player.coRole) {
      if (validRoleIds.has(postData.coRole)) {
        player.coRole = postData.coRole;
      } else {
        console.warn(`revealNextPost: 無効な coRole "${postData.coRole}" (${player.name})`);
      }
    }

    // 占い結果（白だし・黒だし）適用
    applyVerdicts(postData.verdictWhite, 'white');
    applyVerdicts(postData.verdictBlack, 'black');

    // 投票先変更適用
    if (postData.vote) {
      const voteTarget = gs.getAlivePlayers().find(
        (p) => p.name === postData.vote && p.id !== player.id
      );
      if (voteTarget) {
        gs.castVote(player.id, voteTarget.id);
        checkVoteWarning();
      }
    }

    const post = gs.addPost({
      playerName: player.name,
      playerId: player.id,
      content: postData.talk,
      coRole: player.coRole,
      type: 'speech',
      status: postData.status || null,
    });
    bbs.renderPost(post);
    // 役職CO・白だし・黒だし時は自動ブックマーク
    if (shouldAutoBookmark(postData)) {
      bbs.autoBookmarkPost(post.id);
    }
    // wolf_chat 投稿時は通知ドットを更新
    if (post.type === 'wolf_chat' || post.type === 'whisper') {
      updateRoleLabel();
    }
    renderPlayers();
    gs.save();

    // バッファが少ない場合、次の会話を生成開始
    tryGenerateNextConversation();

    checkAndTriggerVote();
  }

  // --- ローディング状態管理 ---
  function setLoadingState(loading) {
    uiLocked = loading;
    updateChatAvailability();
    renderChatTopActions();
  }
});
