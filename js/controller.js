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
  const humanPlayer = gs.getHumanPlayer();

  // --- UI要素 ---
  const phaseLabel = document.getElementById('phase-label');
  const dayLabel = document.getElementById('day-label');
  const roleLabel = document.getElementById('role-label');
  const actionArea = document.getElementById('action-area');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSubmit = document.getElementById('chat-submit');
  const endModal = document.getElementById('end-modal');
  const endMessage = document.getElementById('end-message');
  const restartBtn = document.getElementById('restart-btn');

  // --- 初期描画 ---
  renderPlayerList(gs.players);
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
    gs.nextPhase(); // SETUP -> MORNING
    bbs.renderPhaseHeader(gs.day, gs.phase);
    gs.addSystemPost(`ゲームが始まりました！${gs.players.length}人のプレイヤーが村に集まっています。`);
    bbs.renderPost(gs.bbsLog[gs.bbsLog.length - 1]);
    updateHeader();
    gs.save();
    await runMorning();
  }

  // --- フェーズUI切替 ---
  function renderPhaseUI() {
    updateHeader();
    renderPlayerList(gs.players);

    if (!actionArea) return;
    actionArea.innerHTML = '';

    switch (gs.phase) {
      case GAME_PHASES.DAY:
        showChatPanel();
        break;
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
      roleLabel.textContent = `あなたの役職: ${humanPlayer.role.icon} ${humanPlayer.role.name}`;
    }
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

    // AIが順番に発言（人間の前後にランダムに配置）
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);
    const firstHalf = aiPlayers.slice(0, Math.ceil(aiPlayers.length / 2));
    const secondHalf = aiPlayers.slice(Math.ceil(aiPlayers.length / 2));

    await runAISpeeches(firstHalf);
    showChatPanel(true); // 人間が発言できる
    gs.save();
    // 人間の発言後に続きのAI発言はchatFormのsubmitで処理
  }

  // --- チャットパネル表示 ---
  function showChatPanel(isFirstTime = false) {
    if (!actionArea) return;
    if (document.getElementById('chat-form')) return; // 既に表示中

    actionArea.innerHTML = `
      <form id="chat-form" class="chat-form">
        <textarea id="chat-input" class="chat-input" placeholder="発言を入力してください..." rows="3" maxlength="300"></textarea>
        <div class="chat-actions">
          <button type="submit" id="chat-submit" class="btn btn--primary">発言する</button>
          <button type="button" id="skip-btn" class="btn btn--secondary" aria-label="発言をスキップ">スキップ</button>
        </div>
      </form>`;

    const form = document.getElementById('chat-form');
    const skipBtn = document.getElementById('skip-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text) return;
      disableChatForm();

      const post = gs.addPost({
        playerName: humanPlayer.name,
        playerId: humanPlayer.id,
        content: text,
      });
      bbs.renderPost(post);
      input.value = '';
      gs.save();
      await afterHumanSpeech();
    });

    skipBtn.addEventListener('click', async () => {
      disableChatForm();
      await afterHumanSpeech();
    });
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
      });
      bbs.renderPost(post);
      gs.save();
    }
  }

  // --- 投票フェーズ ---
  async function runVote() {
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();

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
    if (!actionArea) return;
    const alivePlayers = gs.getAlivePlayers();
    actionArea.innerHTML = '<p class="action-label">🗳️ 処刑する人を選んでください：</p>';

    alivePlayers
      .filter((p) => p.id !== humanPlayer.id)
      .forEach((player) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn--vote';
        btn.dataset.targetId = player.id;
        btn.textContent = player.name;
        btn.addEventListener('click', async () => {
          gs.castVote(humanPlayer.id, player.id);
          const post = gs.addPost({
            playerName: humanPlayer.name,
            playerId: humanPlayer.id,
            content: `${player.name} に投票します。`,
            type: 'vote',
          });
          bbs.renderPost(post);
          actionArea.innerHTML = '';
          gs.save();
          await runExecution();
        });
        actionArea.appendChild(btn);
      });

    // スキップボタン（棄権）
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn--secondary';
    skipBtn.textContent = '棄権する';
    skipBtn.addEventListener('click', async () => {
      actionArea.innerHTML = '';
      gs.save();
      await runExecution();
    });
    actionArea.appendChild(skipBtn);
  }

  // --- 処刑フェーズ ---
  async function runExecution() {
    gs.nextPhase(); // VOTE -> EXECUTION
    bbs.renderPhaseHeader(gs.day, gs.phase);
    updateHeader();

    await sleep(600);
    const { executed, counts } = gs.tallyVotes();

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
      renderPlayerList(gs.players);
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

    renderPlayerList(gs.players);
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

  // 夜アクションパネルをPromiseで返す
  function showNightPanelAsync() {
    return new Promise((resolve) => {
      if (!actionArea) { resolve(); return; }
      const humanRole = humanPlayer.role;
      const alivePlayers = gs.getAlivePlayers();

      let label = '';
      if (isWerewolfRole(humanRole)) label = '🐺 今夜、誰を襲撃しますか？';
      else if (humanRole?.id === ROLES.SEER.id) label = '🔮 今夜、誰を占いますか？';
      else if (humanRole?.id === ROLES.HUNTER.id) label = '🛡️ 今夜、誰を護衛しますか？';

      actionArea.innerHTML = `<p class="action-label">${label}</p>`;

      alivePlayers
        .filter((p) => p.id !== humanPlayer.id)
        .forEach((player) => {
          const btn = document.createElement('button');
          btn.className = 'btn btn--night';
          btn.dataset.targetId = player.id;
          btn.textContent = player.name;
          btn.addEventListener('click', () => {
            gs.setNightAction(humanPlayer.id, player.id);
            actionArea.innerHTML = '<p class="action-label">行動を登録しました。AIの行動を待っています…</p>';
            resolve();
          });
          actionArea.appendChild(btn);
        });
    });
  }

  function showNightPanel() {
    // game.html の renderPhaseUI から直接呼ばれる場合（ページリロード後など）
    if (!actionArea) return;
    actionArea.innerHTML = '<p class="action-label">夜フェーズが進行中です…</p>';
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
          ${gs.players.map((p) =>
            `<div class="${p.isHuman ? 'font-bold' : ''}">${p.name}：${p.role?.icon} ${p.role?.name}</div>`
          ).join('')}
        </div>`;
    }

    endModal.classList.remove('hidden');
    if (actionArea) actionArea.innerHTML = '';
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      GameState.clear();
      window.location.href = 'index.html';
    });
  }

  // --- ユーティリティ ---
  function disableChatForm() {
    const form = document.getElementById('chat-form');
    if (form) {
      form.querySelectorAll('button, textarea').forEach((el) => (el.disabled = true));
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
