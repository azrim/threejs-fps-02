// The DOM HUD and menus: health and armour, ammo, money, the round clock and score, the
// killfeed, the dynamic crosshair, the buy grid, plant/defuse progress, the round banner,
// the minimap and the end-of-match board. It renders state main.js pushes; it never simulates.
const REASONS = {
  elimination: 'enemy team eliminated',
  bomb: 'the bomb went off',
  defuse: 'bomb defused',
  time: 'round time expired',
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const panelTitle = $('overlay-title');
  const panelCopy = $('overlay-copy');
  const panelAction = $('play');
  const panelKeys = $('overlay-keys');
  const health = $('health');
  const armor = $('armor');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const money = $('money');
  const timer = $('timer');
  const scoreJackals = $('score-jackals');
  const scoreVipers = $('score-vipers');
  const weaponName = $('weapon-name');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerText = $('banner-text');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const buyMenu = $('buy-menu');
  const scoreboard = $('scoreboard');
  const grenadeCount = $('grenades');
  const bombHint = $('bomb-hint');
  const minimap = $('minimap');
  const mapContext = minimap.getContext('2d');
  let hitTimer = 0;
  let crosshairGap = 6;
  let buyOpen = false;
  const last = {};

  function changed(key, value) {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  }

  function setHealth(value) {
    if (!changed('health', value)) return;
    health.textContent = String(Math.max(0, value));
    health.classList.toggle('low', value <= 30);
  }

  function setArmor(value) {
    if (!changed('armor', value)) return;
    armor.textContent = value > 0 ? String(value) : '';
  }

  function setAmmo(mag, reserve, weapon) {
    if (!changed('ammo', `${mag}/${reserve}/${weapon}`)) return;
    ammoMag.textContent = String(mag);
    ammoReserve.textContent = `/ ${reserve}`;
    weaponName.textContent = weapon;
    ammoMag.classList.toggle('empty', mag === 0);
  }

  function setMoney(value) {
    if (!changed('money', value)) return;
    money.textContent = `$${value}`;
  }

  function setGrenades(count) {
    if (!changed('nades', count)) return;
    grenadeCount.textContent = count > 0 ? `✷ ${count}` : '';
  }

  function setClock(seconds, phase) {
    const shown = Math.max(0, Math.ceil(seconds));
    if (!changed('clock', `${shown}:${phase}`)) return;
    timer.textContent = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', phase === 'live' && shown <= 15);
  }

  function setScore(jackals, vipers, round, maxRounds) {
    if (!changed('score', `${jackals}:${vipers}:${round}`)) return;
    scoreJackals.textContent = String(jackals);
    scoreVipers.textContent = String(vipers);
    $('round-number').textContent = `Round ${round} / ${maxRounds}`;
  }

  function setKillfeed(items) {
    const key = items.map((item) => `${item.attacker}>${item.victim}:${item.roundTime.toFixed(1)}`).join('|');
    if (!changed('feed', key)) return;
    killfeed.replaceChildren(...items.map((item) => {
      const line = document.createElement('li');
      const attacker = document.createElement('span');
      attacker.textContent = item.attacker;
      const verb = document.createElement('em');
      verb.textContent = item.headshot ? ' ✕ ' : ' · ';
      const victim = document.createElement('span');
      victim.textContent = item.victim;
      line.append(attacker, verb, victim);
      return line;
    }));
  }

  function crosshairSpread(spread) {
    const gap = 5 + Math.round(spread * 900);
    if (gap === crosshairGap) return;
    crosshairGap = gap;
    crosshair.style.setProperty('--gap', `${gap}px`);
  }

  function hitMarker(killed) {
    hitmarker.classList.add('on');
    hitmarker.classList.toggle('killed', killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on'), killed ? 180 : 90);
  }

  function bannerFor(winner, reason, jackals, vipers) {
    const side = winner === 'jackals' ? 'Jackals' : 'Vipers';
    bannerText.textContent = `${side} take the round — ${REASONS[reason] ?? ''} (${jackals}–${vipers})`;
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  function showProgress(label, fraction) {
    progress.hidden = false;
    progressLabel.textContent = label;
    progressFill.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
  }

  function hideProgress() {
    progress.hidden = true;
  }

  function bombHintFor(text) {
    if (!changed('hint', text ?? '')) return;
    bombHint.textContent = text ?? '';
    bombHint.hidden = !text;
  }

  function openBuy(money, weapon, armorHeld, grenadesHeld) {
    buyOpen = true;
    buyMenu.hidden = false;
    for (const [id, price] of [['smg', 1200], ['rifle', 2700]]) {
      const row = $(`buy-${id}`);
      row.classList.toggle('affordable', money >= price);
      row.querySelector('.owned').textContent = weapon === id ? 'held' : `$${price}`;
    }
    const armorRow = $('buy-armor');
    armorRow.classList.toggle('affordable', money >= 650 && !armorHeld);
    armorRow.querySelector('.owned').textContent = armorHeld ? 'held' : '$650';
    const grenadeRow = $('buy-grenade');
    grenadeRow.classList.toggle('affordable', money >= 300 && !grenadesHeld);
    grenadeRow.querySelector('.owned').textContent = grenadesHeld ? 'held' : '$300';
  }

  function closeBuy() {
    buyOpen = false;
    buyMenu.hidden = true;
  }

  function isBuyOpen() {
    return buyOpen;
  }

  function showOverlay(mode) {
    const copy = {
      menu: {
        title: 'CINDERPOINT',
        copy: 'A round-based tactical shooter: take a site, plant the bomb, hold the line. You are a Jackal. Click to play.',
        action: 'Enter the match',
      },
      pause: {
        title: 'CINDERPOINT',
        copy: 'Paused. The match waits.',
        action: 'Resume',
      },
      end: {
        title: 'Full time',
        copy: 'The board below has the whole match.',
        action: 'Play again',
      },
    }[mode];
    panelTitle.textContent = copy.title;
    panelCopy.textContent = copy.copy;
    panelAction.textContent = copy.action;
    panelKeys.hidden = mode !== 'menu';
    overlay.hidden = false;
    panelAction.focus();
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function showScoreboard(state) {
    scoreboard.hidden = false;
    const jackalRows = [];
    const viperRows = [];
    for (const character of state.characters) {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = character.name + (character.isPlayer ? ' (you)' : '');
      const kills = document.createElement('td');
      kills.textContent = String(character.kills);
      const deaths = document.createElement('td');
      deaths.textContent = String(character.deaths);
      row.append(name, kills, deaths);
      (character.team === 'jackals' ? jackalRows : viperRows).push(row);
    }
    $('board-jackals').replaceChildren(...jackalRows);
    $('board-vipers').replaceChildren(...viperRows);
    $('board-score').textContent = `Jackals ${state.score.jackals} — ${state.score.vipers} Vipers`;
  }

  function hideScoreboard() {
    scoreboard.hidden = true;
  }

  /** The minimap: walls, both sites, teammates, the bomb, the player. Cheap canvas. */
  function drawMinimap(walls, player, bomb, characters) {
    const width = minimap.width;
    const height = minimap.height;
    mapContext.fillStyle = 'rgba(16, 18, 22, 0.82)';
    mapContext.fillRect(0, 0, width, height);
    const toX = (x) => ((x + 40) / 80) * width;
    const toY = (z) => ((z + 32) / 64) * height;
    mapContext.fillStyle = '#4a505a';
    for (const wall of walls) {
      mapContext.fillRect(toX(wall.x - wall.w / 2), toY(wall.z - wall.d / 2), (wall.w / 80) * width, (wall.d / 64) * height);
    }
    mapContext.fillStyle = 'rgba(201, 162, 58, 0.55)';
    mapContext.fillRect(toX(19), toY(-27), (10 / 80) * width, (6.5 / 64) * height);
    mapContext.fillStyle = 'rgba(58, 154, 201, 0.55)';
    mapContext.fillRect(toX(-29), toY(-27), (10 / 80) * width, (6.5 / 64) * height);
    if (bomb && bomb.state === 'planted') {
      mapContext.fillStyle = '#ff5050';
      mapContext.beginPath();
      mapContext.arc(toX(bomb.pos.x), toY(bomb.pos.z), 3, 0, Math.PI * 2);
      mapContext.fill();
    }
    for (const character of characters) {
      if (!character.alive || character.isPlayer) continue;
      if (character.team === player.team) {
        mapContext.fillStyle = '#c96f2a';
        mapContext.fillRect(toX(character.pos.x) - 1.5, toY(character.pos.z) - 1.5, 3, 3);
      }
    }
    if (player.alive) {
      mapContext.fillStyle = '#ffffff';
      mapContext.beginPath();
      mapContext.arc(toX(player.pos.x), toY(player.pos.z), 2.6, 0, Math.PI * 2);
      mapContext.fill();
    }
  }

  return {
    setHealth, setArmor, setAmmo, setMoney, setGrenades, setClock, setScore, setKillfeed,
    crosshairSpread, hitMarker, bannerFor, hideBanner,
    showProgress, hideProgress, bombHintFor,
    openBuy, closeBuy, isBuyOpen,
    showOverlay, hideOverlay, showScoreboard, hideScoreboard,
    drawMinimap,
  };
}
