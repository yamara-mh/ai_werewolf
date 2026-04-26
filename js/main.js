// ロビー（index.html）エントリーポイント

document.addEventListener('DOMContentLoaded', () => {
  const LOBBY_STORAGE_KEY = 'ai_werewolf_lobby_settings';
  const form = document.getElementById('setup-form');
  const playerCountSelect = document.getElementById('player-count');
  const werewolfCountSelect = document.getElementById('werewolf-count');
  const optionalRoleInputs = Array.from(document.querySelectorAll('input[name="optional-role"]'));
  const rolePreviewEl = document.getElementById('role-preview');
  const apiKeyInput = document.getElementById('api-key');
  const toggleApiKey = document.getElementById('toggle-api-key');
  const startBtn = document.querySelector('#setup-form [type="submit"]');

  function saveLobbySettings() {
    if (!form) return;
    const controls = Array.from(form.elements || []);
    const data = {};
    controls.forEach((el) => {
      if (!el.name && !el.id) return;
      const key = el.name || el.id;
      if (el.type === 'checkbox') {
        if (el.name === 'optional-role') {
          if (!data.optionalRoles) data.optionalRoles = [];
          if (el.checked) data.optionalRoles.push(el.value);
        } else {
          data[key] = el.checked;
        }
        return;
      }
      if (el.type === 'submit' || el.tagName === 'BUTTON') return;
      data[key] = el.value;
    });
    try {
      localStorage.setItem(LOBBY_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('ロビー設定の保存に失敗しました', e);
    }
  }

  function loadLobbySettings() {
    try {
      const raw = localStorage.getItem(LOBBY_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (typeof data['token-saving-mode'] !== 'boolean' && typeof data['precision-mode'] === 'boolean') {
        data['token-saving-mode'] = !data['precision-mode'];
      }

      const controls = Array.from(form?.elements || []);
      controls.forEach((el) => {
        if (!el.name && !el.id) return;
        const key = el.name || el.id;
        if (el.type === 'checkbox') {
          if (el.name === 'optional-role') {
            if (Array.isArray(data.optionalRoles)) {
              el.checked = data.optionalRoles.includes(el.value);
            }
          } else if (typeof data[key] === 'boolean') {
            el.checked = data[key];
          }
          return;
        }
        if (el.type === 'submit' || el.tagName === 'BUTTON') return;
        if (typeof data[key] === 'string') {
          el.value = data[key];
        }
      });
    } catch (e) {
      console.warn('ロビー設定の読み込みに失敗しました', e);
    }
  }

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
    const werewolfCount = parseInt(werewolfCountSelect?.value || '2', 10);
    const optionalRoleIds = optionalRoleInputs
      .filter((input) => input.checked)
      .map((input) => input.value);
    const preset = buildRoleDeck(count, werewolfCount, optionalRoleIds);
    const roleCounts = {};
    preset.forEach((role) => {
      roleCounts[role.id] = (roleCounts[role.id] || 0) + 1;
    });

    if (rolePreviewEl) {
      rolePreviewEl.innerHTML = ROLE_DISPLAY_ORDER
        .filter((roleId) => roleCounts[roleId] > 0)
        .map((roleId) => {
          const role = Object.values(ROLES).find((r) => r.id === roleId);
          const countByRole = roleCounts[roleId];
          return `<span class="role-badge">${role?.icon || ''} ${role?.name || ''} ×${countByRole}</span>`;
        })
        .join('');
    }
  }

  // 開始ボタンの有効/無効制御
  function updateStartButton() {
    if (!startBtn) return;
    const total = parseInt(playerCountSelect.value, 10);
    const wolves = parseInt(werewolfCountSelect?.value || '2', 10);
    if (wolves >= total / 2) {
      startBtn.disabled = true;
      startBtn.title = '人狼がプレイヤーの半数以上になっています';
    } else {
      startBtn.disabled = false;
      startBtn.title = '';
    }
  }

  if (playerCountSelect) {
    playerCountSelect.addEventListener('change', () => {
      updateRolePreview();
      updateStartButton();
      saveLobbySettings();
    });
  }
  if (werewolfCountSelect) {
    werewolfCountSelect.addEventListener('change', () => {
      updateRolePreview();
      updateStartButton();
      saveLobbySettings();
    });
  }
  optionalRoleInputs.forEach((input) => input.addEventListener('change', () => {
    updateRolePreview();
    saveLobbySettings();
  }));
  if (form) {
    Array.from(form.elements || []).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.name === 'optional-role' || el.id === 'player-count' || el.id === 'werewolf-count') return;
      if (el.type === 'submit' || el.tagName === 'BUTTON') return;
      const eventName = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(eventName, saveLobbySettings);
      if (eventName !== 'change') el.addEventListener('change', saveLobbySettings);
    });
  }

  loadLobbySettings();
  updateRolePreview();
  updateStartButton();

  // フォーム送信
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // PromptSheet.tsv から personality 情報を読み込む
      const loaded = await loadPersonalitiesFromTsv();
      if (!loaded) {
        window.alert('personality/PromptSheet.tsv の読み込みに失敗したため、ゲームを開始できませんでした。');
        return;
      }

      const settings = {
        playerName: document.getElementById('player-name').value.trim() || 'あなた',
        totalPlayers: parseInt(playerCountSelect.value, 10),
        werewolfCount: parseInt(werewolfCountSelect?.value || '2', 10),
        optionalRoles: optionalRoleInputs
          .filter((input) => input.checked)
          .map((input) => input.value),
        preferredRole: document.getElementById('preferred-role')?.value || '',
        aiApiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
        aiModel: document.getElementById('ai-model')?.value || 'gemini-flash-latest',
        reasoningEffort: document.getElementById('reasoning-effort')?.value || 'medium',
        roomLevel: document.getElementById('room-level')?.value || 'intermediate',
        showLogicAi: document.getElementById('show-logic-ai')?.checked ?? true,
        tokenSavingMode: document.getElementById('token-saving-mode')?.checked ?? false,
      };
      saveLobbySettings();

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
