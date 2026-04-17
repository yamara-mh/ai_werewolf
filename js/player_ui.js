// プレイヤーリスト・投票・夜アクション パネルのレンダリング

// プレイヤーリストのレンダリング
function renderPlayerList(players, options = {}) {
  const {
    containerId = 'player-list',
    onPlayerClick = null,
    activePlayerId = null,
    voteTargetId = null,
    italicPlayerIds = new Set(),
  } = options;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  players.forEach((player) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `player-card ${player.isAlive ? '' : 'player-card--dead'} ${activePlayerId === player.id ? 'player-card--active' : ''} ${voteTargetId === player.id ? 'player-card--vote-target' : ''}`;
    el.dataset.playerId = player.id;

    const humanClass = player.isHuman ? 'player-card--human' : '';
    let deadLabel = '';
    if (!player.isAlive) {
      const text = player.deathReason === 'attack' ? '襲撃' : '処刑';
      deadLabel = `<span class="player-dead-label">${text}</span>`;
    }
    const portraitSrc = `personality/portrait/${escapeHtml(player.name)}.png`;
    const isAlly = italicPlayerIds.has(player.id);
    const nameHtml = buildPlayerNameHtml(player.name, { coRole: player.coRole, isAlly });

    if (humanClass) el.classList.add(humanClass);

    el.innerHTML = `
      <span class="player-card__name">
        <span class="player-portrait-wrapper">
          <img src="${portraitSrc}" onerror="this.src='personality/portrait/default.png'" class="player-portrait player-portrait--card" alt="" />
          ${deadLabel}
        </span>
        ${nameHtml}
      </span>`;
    if (typeof onPlayerClick === 'function') {
      el.addEventListener('click', () => onPlayerClick(player));
    }
    container.appendChild(el);
  });
}

// 投票UI のレンダリング
function renderVotePanel(alivePlayers, excludeId, containerId = 'vote-panel') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<p class="vote-panel__label">処刑する人を選んでください：</p>';

  alivePlayers
    .filter((p) => p.id !== excludeId)
    .forEach((player) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--vote';
      btn.dataset.targetId = player.id;
      btn.textContent = player.name;
      container.appendChild(btn);
    });
}

// 夜アクションUIのレンダリング
function renderNightPanel(role, alivePlayers, excludeId, containerId = 'night-panel') {
  const container = document.getElementById(containerId);
  if (!container) return;

  let label = '';
  if (isWerewolfRole(role)) label = '🐺 今夜、誰を襲撃しますか？';
  else if (role?.id === ROLES.SEER.id) label = '🔮 今夜、誰を占いますか？';
  else if (role?.id === ROLES.HUNTER.id) label = '🛡️ 今夜、誰を護衛しますか？';
  else {
    container.innerHTML = '<p class="night-panel__label">あなたの夜のアクションはありません。AIが行動するのを待っています…</p>';
    return;
  }

  container.innerHTML = `<p class="night-panel__label">${label}</p>`;

  alivePlayers
    .filter((p) => p.id !== excludeId)
    .forEach((player) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--night';
      btn.dataset.targetId = player.id;
      btn.textContent = player.name;
      container.appendChild(btn);
    });
}
