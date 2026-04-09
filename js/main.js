// ロビー（index.html）エントリーポイント

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('setup-form');
  const playerCountSelect = document.getElementById('player-count');
  const rolePreviewEl = document.getElementById('role-preview');
  const apiKeyInput = document.getElementById('api-key');
  const toggleApiKey = document.getElementById('toggle-api-key');

  // APIキーの表示/非表示切替
  if (toggleApiKey) {
    toggleApiKey.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      toggleApiKey.textContent = isPassword ? '隠す' : '表示';
    });
  }

  // 役職プレビュー更新
  function updateRolePreview() {
    const count = parseInt(playerCountSelect.value, 10);
    const preset = ROLE_PRESETS[count] || ROLE_PRESETS[5];
    const roleCounts = {};
    preset.forEach((role) => {
      roleCounts[role.name] = (roleCounts[role.name] || 0) + 1;
    });

    if (rolePreviewEl) {
      rolePreviewEl.innerHTML = Object.entries(roleCounts)
        .map(([name, count]) => {
          const role = Object.values(ROLES).find((r) => r.name === name);
          return `<span class="role-badge">${role?.icon || ''} ${name} ×${count}</span>`;
        })
        .join('');
    }
  }

  if (playerCountSelect) {
    playerCountSelect.addEventListener('change', updateRolePreview);
    updateRolePreview();
  }

  // フォーム送信
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const settings = {
        playerName: document.getElementById('player-name').value.trim() || 'あなた',
        totalPlayers: parseInt(playerCountSelect.value, 10),
        aiApiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
        aiModel: document.getElementById('ai-model')?.value || 'gpt-4o-mini',
      };

      // ゲーム状態を初期化して保存
      const gs = new GameState();
      gs.initialize(settings);
      gs.save();

      // ゲームページへ遷移
      window.location.href = 'game.html';
    });
  }

  // 以前のゲームが残っている場合に続きから遊べるオプション
  const savedState = GameState.load();
  const resumeBtn = document.getElementById('resume-btn');
  if (resumeBtn) {
    if (savedState && savedState.phase !== GAME_PHASES.END && savedState.phase !== GAME_PHASES.SETUP) {
      resumeBtn.style.display = 'inline-block';
      resumeBtn.addEventListener('click', () => {
        window.location.href = 'game.html';
      });
    } else {
      resumeBtn.style.display = 'none';
    }
  }
});
