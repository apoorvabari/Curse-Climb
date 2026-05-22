// ── State ─────────────────────────────────────────────────────────────────────
let stompClient = null;
let currentGameState = null;
let boardCells = [];
let previousPositions = {};
let connectionsDrawn = false;
let expectedTaskAnswer = 0;
let selectedCount = 1;
const PLAYER_COLORS = ["#ff4757", "#2ed573", "#1e90ff", "#ffa502", "#ff6b9d"];

let gameId = null;
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('gameId')) {
    gameId = urlParams.get('gameId');
} else {
    gameId = Math.random().toString(36).substring(2, 10);
    window.history.replaceState(null, '', `?gameId=${gameId}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Die face rotations ─────────────────────────────────────────────────────────
const FACE_ROTATIONS = {
    1: { rx: 0, ry: 0 },
    2: { rx: 0, ry: 90 },
    3: { rx: -90, ry: 0 },
    4: { rx: 90, ry: 0 },
    5: { rx: 0, ry: -90 },
    6: { rx: 0, ry: 180 }
};

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect(callback) {
    if (stompClient && stompClient.connected) { callback(); return; }
    const socket = new SockJS('/ws');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;
    stompClient.connect({}, () => {
        stompClient.subscribe(`/topic/gameState/${gameId}`, msg => handleGameState(JSON.parse(msg.body)));
        callback();
    });
}

// ── Board init ────────────────────────────────────────────────────────────────
function initBoard() {
    boardCells = [];
    document.querySelectorAll('.cell').forEach(cell => {
        boardCells[parseInt(cell.dataset.num)] = cell;
    });
}

// ── Main state handler ────────────────────────────────────────────────────────
async function handleGameState(state) {
    const isNewTurn = currentGameState && currentGameState.currentTurnIndex !== state.currentTurnIndex;
    const diceRollChanged = currentGameState && currentGameState.lastDiceRoll !== state.lastDiceRoll && state.lastDiceRoll > 0;

    currentGameState = state;
    document.getElementById('statusMessage').innerText = state.message || '';
    updatePlayerList();

    if (state.gameStarted) {
        showGameUI();

        if (diceRollChanged) {
            await animateRollPromise(state.lastDiceRoll);
            await sleep(600); // Smooth delay after dice lands
        } else {
            updateDieForState(state);
        }

        if (isNewTurn) {
            const board = document.getElementById('board');
            board.classList.add('turn-change-pulse');
            setTimeout(() => board.classList.remove('turn-change-pulse'), 800);
        }

        // Wait for player token animations to complete first
        await updateTokens();

        if (!connectionsDrawn && Object.keys(state.snakes || {}).length > 0) drawConnections(state);

        if (state.winnerName) {
            document.getElementById('rollBtn').classList.add('hidden');
            document.getElementById('taskModal').classList.add('hidden');
            showVictory(state.winnerName);
        } else {
            document.getElementById('victoryModal').classList.add('hidden');
            if (victoryAnimationId) {
                cancelAnimationFrame(victoryAnimationId);
                victoryAnimationId = null;
            }
            const cur = state.players[state.currentTurnIndex];
            const isMyTurn = !!cur && state.pendingTaskPlayerId == null;
            document.getElementById('rollBtn').classList.toggle('hidden', !isMyTurn);
            if (state.pendingTaskPlayerId) showTaskModal(state.pendingTaskType);
            else {
                document.getElementById('taskModal').classList.add('hidden');
                if (activeMiniGameTimer) { clearTimeout(activeMiniGameTimer); activeMiniGameTimer = null; }
                if (activeMiniGameInterval) { clearInterval(activeMiniGameInterval); activeMiniGameInterval = null; }
            }
        }
        document.getElementById('quitBtn').classList.remove('hidden');
    } else {
        showLobby(state);
        document.getElementById('quitBtn').classList.add('hidden');
        document.getElementById('victoryModal').classList.add('hidden');
        document.getElementById('taskModal').classList.add('hidden');
        if (victoryAnimationId) {
            cancelAnimationFrame(victoryAnimationId);
            victoryAnimationId = null;
        }
        if (activeMiniGameTimer) { clearTimeout(activeMiniGameTimer); activeMiniGameTimer = null; }
        if (activeMiniGameInterval) { clearInterval(activeMiniGameInterval); activeMiniGameInterval = null; }
    }
}

function showGameUI() {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('gameUI').classList.remove('hidden');
    document.getElementById('diceArea').classList.remove('hidden');
}

function showLobby(state) {
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('gameUI').classList.add('hidden');
    document.getElementById('diceArea').classList.add('hidden');
    // Show resume button if there are players (game was in progress before quit)
    const hasPlayers = state && state.players && state.players.length > 0;
    document.getElementById('resumeSection').classList.toggle('hidden', !hasPlayers);
    // Clear all tokens
    document.querySelectorAll('.player-token').forEach(t => t.remove());
    previousPositions = {};
    connectionsDrawn = false;
    const svg = document.getElementById('svgOverlay');
    if (svg) svg.innerHTML = '';
    document.querySelectorAll('.cell.snake-cell,.cell.ladder-cell,.cell.snake-tail-cell,.cell.ladder-top-cell')
        .forEach(c => c.classList.remove('snake-cell', 'ladder-cell', 'snake-tail-cell', 'ladder-top-cell'));
}

// ── Lobby: player count selector ──────────────────────────────────────────────
function setCount(n) {
    selectedCount = n;
    document.querySelectorAll('.count-btn').forEach(b => b.classList.toggle('active', +b.dataset.count === n));
    const container = document.getElementById('nameInputs');
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
        const color = PLAYER_COLORS[i];
        const row = document.createElement('div');
        row.className = 'name-row';
        row.innerHTML = `
          <span class="name-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>
          <input type="text" id="name${i}" placeholder="Enter Player ${i + 1}'s Name *" maxlength="20" required>`;

        const input = row.querySelector('input');
        input.addEventListener('input', () => {
            input.classList.remove('invalid');
        });
        container.appendChild(row);
    }
}

function startNewGame() {
    const names = [];
    let hasError = false;

    for (let i = 0; i < selectedCount; i++) {
        const input = document.getElementById('name' + i);
        if (!input) continue;

        // Reset invalid class for fresh triggers
        input.classList.remove('invalid');
        void input.offsetWidth; // trigger reflow

        const val = input.value.trim();
        if (!val) {
            input.classList.add('invalid');
            if (!hasError) {
                input.focus(); // Focus first empty field
            }
            hasError = true;
        } else {
            names.push(val);
        }
    }

    if (hasError) return; // Prevent starting the game!

    connect(() => {
        stompClient.send(`/app/create/${gameId}`, {}, JSON.stringify({ names }));
    });
}

function resumeGame() {
    if (currentGameState && currentGameState.gameStarted) {
        // Re-enter game directly using the already-fetched state
        handleGameState(currentGameState);
    }
}

// ── Player list ───────────────────────────────────────────────────────────────
function updatePlayerList() {
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    (currentGameState?.players || []).forEach((p, i) => {
        const isCur = currentGameState.gameStarted && currentGameState.currentTurnIndex === i;
        const li = document.createElement('li');
        if (isCur) { li.style.border = `2px solid ${p.color}`; li.style.background = 'rgba(0,30,0,0.5)'; }
        li.innerHTML = `
          <div class="player-indicator ${p.shape}" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
          <span>${p.name}</span>
          <span style="margin-left:auto;color:rgba(200,240,200,0.45);font-size:0.78rem">sq.${p.position}</span>`;
        list.appendChild(li);
    });
}

// ── 3D Die ────────────────────────────────────────────────────────────────────
function updateDieForState(state) {
    if (!state.lastDiceRoll || state.lastDiceRoll < 1) return;
    const r = FACE_ROTATIONS[state.lastDiceRoll];
    const cube = document.getElementById('dieCube');
    cube.style.setProperty('--rx', r.rx + 'deg');
    cube.style.setProperty('--ry', r.ry + 'deg');
    cube.style.transform = `rotateX(${r.rx}deg) rotateY(${r.ry}deg)`;
    document.getElementById('diceLabel').innerText = `Rolled: ${state.lastDiceRoll}`;
}

function animateRollPromise(finalValue) {
    return new Promise(resolve => {
        const cube = document.getElementById('dieCube');
        const r = FACE_ROTATIONS[finalValue];
        cube.style.setProperty('--rx', (r.rx + (Math.random() > 0.5 ? 360 : -360)) + 'deg');
        cube.style.setProperty('--ry', (r.ry + (Math.random() > 0.5 ? 360 : -360)) + 'deg');
        cube.classList.add('rolling');
        document.getElementById('diceLabel').innerText = 'Rolling...';
        setTimeout(() => {
            cube.classList.remove('rolling');
            cube.style.transform = `rotateX(${r.rx}deg) rotateY(${r.ry}deg)`;
            document.getElementById('diceLabel').innerText = `Rolled: ${finalValue}`;
            resolve();
        }, 950);
    });
}

async function updateTokens(isResize = false) {
    if (!currentGameState) return;
    const state = currentGameState;
    const board = document.getElementById('board');
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const SZ = 26;

    const cellCounts = {};
    state.players.forEach(p => { if (p.position > 0) cellCounts[p.position] = (cellCounts[p.position] || 0) + 1; });
    const cellIdx = {};

    const promises = state.players.map(async (player) => {
        let tok = document.getElementById('token-' + player.id);
        if (!tok) {
            tok = document.createElement('div');
            tok.id = 'token-' + player.id;
            tok.style.width = tok.style.height = SZ + 'px';
            tok.style.backgroundColor = player.color;
            board.appendChild(tok);
        }
        tok.className = 'player-token ' + player.shape;
        tok.style.opacity = '1';

        const oldPos = previousPositions[player.id] || 0;
        const newPos = player.position;
        if (cellIdx[newPos] === undefined) cellIdx[newPos] = 0;
        const oi = cellIdx[newPos]++;
        const total = cellCounts[newPos] || 1;

        const getOff = (i, t) => {
            if (t <= 1) return { x: 0, y: 0 };
            const a = (Math.PI * 2 * i) / t;
            return { x: Math.cos(a) * 10, y: Math.sin(a) * 10 };
        };

        const moveTo = (pos, applyOff) => {
            const cell = boardCells[pos];
            if (!cell) return;
            const rect = cell.getBoundingClientRect();
            let top = rect.top - boardRect.top + (rect.height - SZ) / 2;
            let left = rect.left - boardRect.left + (rect.width - SZ) / 2;
            if (applyOff) { const o = getOff(oi, total); top += o.y; left += o.x; }
            tok.style.top = top + 'px';
            tok.style.left = left + 'px';
        };

        if (isResize || oldPos === 0) {
            moveTo(newPos, true);
        } else if (newPos > oldPos && newPos - oldPos <= 6) {
            for (let i = oldPos + 1; i <= newPos; i++) {
                tok.classList.add('hopping');
                moveTo(i, false);
                await sleep(300);
                tok.classList.remove('hopping');
            }
            moveTo(newPos, true);
        } else {
            moveTo(newPos, true);
        }
        previousPositions[player.id] = newPos;
    });

    await Promise.all(promises);
}

// ── Task Modal ────────────────────────────────────────────────────────────────
function showTaskModal(type) {
    const modal = document.getElementById('taskModal');
    const content = modal.querySelector('.modal-content');
    const i18n = document.getElementById('i18n-strings').dataset;

    modal.classList.remove('hidden');

    if (currentGameState && currentGameState.pendingTaskGameName) {
        document.getElementById('standardMathArea').classList.add('hidden');
        document.getElementById('miniGameContainer').classList.remove('hidden');

        if (type === 'SNAKE') {
            content.className = 'modal-content glass-panel horror';
        } else {
            content.className = 'modal-content glass-panel ladder';
        }
        startMiniGame(currentGameState.pendingTaskGameName);
    } else {
        document.getElementById('standardMathArea').classList.remove('hidden');
        document.getElementById('miniGameContainer').classList.add('hidden');

        const n1 = Math.floor(Math.random() * 20) + 1;
        const n2 = Math.floor(Math.random() * 20) + 1;
        document.getElementById('taskAnswer').value = '';
        if (type === 'SNAKE') {
            content.className = 'modal-content glass-panel horror';
            document.getElementById('taskTitle').innerText = i18n.horrorTitle || '🐍 Horror Task!';
            document.getElementById('taskDesc').innerText = i18n.horrorDesc || 'Solve to stay!';
            expectedTaskAnswer = n1 - n2;
            document.getElementById('mathQuestion').innerText = `${n1} − ${n2} = ?`;
        } else {
            content.className = 'modal-content glass-panel ladder';
            document.getElementById('taskTitle').innerText = i18n.ladderTitle || '🪜 Ladder Task!';
            document.getElementById('taskDesc').innerText = i18n.ladderDesc || 'Solve to climb!';
            expectedTaskAnswer = n1 + n2;
            document.getElementById('mathQuestion').innerText = `${n1} + ${n2} = ?`;
        }
    }
}

// ── SVG Connections ───────────────────────────────────────────────────────────
function drawConnections(state) {
    if (connectionsDrawn) return;
    const svg = document.getElementById('svgOverlay');
    const board = document.getElementById('board');
    if (!svg || !board) return;
    svg.innerHTML = '';
    const br = board.getBoundingClientRect();

    const ctr = num => {
        const cell = boardCells[num];
        if (!cell) return null;
        const r = cell.getBoundingClientRect();
        return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2 };
    };
    const mk = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);

    // Mark cells
    for (const [h, tail] of Object.entries(state.snakes)) {
        boardCells[+h]?.classList.add('snake-cell');
        boardCells[tail]?.classList.add('snake-tail-cell');
    }
    for (const [b, top] of Object.entries(state.ladders)) {
        boardCells[+b]?.classList.add('ladder-cell');
        boardCells[top]?.classList.add('ladder-top-cell');
    }

    // SNAKES
    for (const [hStr, tail] of Object.entries(state.snakes)) {
        const p1 = ctr(+hStr), p2 = ctr(tail);
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
        const px = -dy / len, py = dx / len, amp = Math.min(26, len / 6);
        let d = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
        const mids = [];
        for (let i = 0; i < 7; i++) {
            const t2 = (i + .5) / 7, t3 = (i + 1) / 7, s = i % 2 ? -1 : 1;
            const mx = p1.x + dx * t2 + px * amp * s, my = p1.y + dy * t2 + py * amp * s;
            const ex = p1.x + dx * t3, ey = p1.y + dy * t3;
            mids.push({ x: mx, y: my });
            d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        }
        const addPath = (sw, sc, op, da, an) => {
            const el = mk('path'); el.setAttribute('d', d);
            el.setAttribute('stroke', sc); el.setAttribute('stroke-width', sw);
            el.setAttribute('fill', 'none'); el.setAttribute('stroke-linecap', 'round');
            if (op) el.setAttribute('opacity', op);
            if (da) el.setAttribute('stroke-dasharray', da);
            if (an) el.style.animation = an;
            svg.appendChild(el); return el;
        };
        addPath(28, '#8b0000', '0.1', null, 'snakeGlowPulse 2.5s ease-in-out infinite');
        addPath(14, '#c62828', '0.2', null, 'snakeGlowPulse 2s ease-in-out infinite 0.4s');
        addPath(8, '#b71c1c', null, null, null);
        addPath(5, '#e53935', null, '10 6', 'snakeFlow 1.4s linear infinite');
        addPath(3, '#1a0000', null, '2 9', 'snakeFlow 1.4s linear infinite reverse');

        // Blood drips
        mids.forEach((m, i) => {
            if (i % 2) return;
            const el = mk('ellipse');
            el.setAttribute('cx', m.x); el.setAttribute('cy', m.y + 2);
            el.setAttribute('rx', '2'); el.setAttribute('ry', '4');
            el.setAttribute('fill', '#c62828'); el.setAttribute('opacity', '0.65');
            el.style.transformOrigin = `${m.x}px ${m.y}px`;
            el.style.animation = `bloodDrip ${2 + i * .3}s ease-in infinite ${i * .5}s`;
            svg.appendChild(el);
        });

        // Head (using SVG Group rotation for perfect alignment along snake direction)
        const fwd = { x: -dx, y: -dy };
        const angleDeg = Math.atan2(fwd.y, fwd.x) * 180 / Math.PI;

        const headGroup = mk('g');
        headGroup.setAttribute('transform', `rotate(${angleDeg.toFixed(1)}, ${p1.x.toFixed(1)}, ${p1.y.toFixed(1)})`);

        // Head — dark oval (jaw open) designed facing right (0 degrees)
        const hOv = mk('ellipse');
        hOv.setAttribute('cx', p1.x); hOv.setAttribute('cy', p1.y);
        hOv.setAttribute('rx', '12'); hOv.setAttribute('ry', '9');
        hOv.setAttribute('fill', '#7f0000'); hOv.setAttribute('stroke', '#ff1744'); hOv.setAttribute('stroke-width', '2');
        headGroup.appendChild(hOv);

        // Head — inner mouth (open jaw slash)
        const mp = mk('path');
        mp.setAttribute('d', `M ${(p1.x + 5).toFixed(1)} ${(p1.y - 5).toFixed(1)} L ${(p1.x + 5).toFixed(1)} ${(p1.y + 5).toFixed(1)}`);
        mp.setAttribute('stroke', '#ff1744'); mp.setAttribute('stroke-width', '2.5'); mp.setAttribute('stroke-linecap', 'round'); mp.setAttribute('fill', 'none');
        headGroup.appendChild(mp);

        // FANGS
        [-1, 1].forEach(side => {
            const f = mk('path');
            const fx = p1.x + 5;
            const fy = p1.y + 3 * side;
            f.setAttribute('d', `M ${fx.toFixed(1)} ${fy.toFixed(1)} L ${(fx + 4).toFixed(1)} ${(fy + side).toFixed(1)}`);
            f.setAttribute('stroke', '#fff'); f.setAttribute('stroke-width', '1.5'); f.setAttribute('stroke-linecap', 'round'); f.setAttribute('fill', 'none');
            headGroup.appendChild(f);
        });

        // EYES — glowing red slit pupils
        [-1, 1].forEach((side, i) => {
            const ex = p1.x + 2;
            const ey = p1.y - 4.5 * side;
            // Outer glow
            const eg = mk('circle');
            eg.setAttribute('cx', ex); eg.setAttribute('cy', ey); eg.setAttribute('r', '4'); eg.setAttribute('fill', '#ff1744'); eg.setAttribute('opacity', '0.5');
            eg.style.animation = `snakeGlowPulse 1.2s ease-in-out infinite ${i * 0.3}s`;
            headGroup.appendChild(eg);
            // Pupil (slit)
            const ep = mk('ellipse');
            ep.setAttribute('cx', ex); ep.setAttribute('cy', ey); ep.setAttribute('rx', '1.2'); ep.setAttribute('ry', '3'); ep.setAttribute('fill', '#ff6f00');
            headGroup.appendChild(ep);
        });

        // TONGUE — forked, flickering
        const tng = mk('path');
        tng.setAttribute('d', `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${(p1.x + 15).toFixed(1)} ${p1.y.toFixed(1)} L ${(p1.x + 20).toFixed(1)} ${(p1.y - 3).toFixed(1)} M ${(p1.x + 15).toFixed(1)} ${p1.y.toFixed(1)} L ${(p1.x + 20).toFixed(1)} ${(p1.y + 3).toFixed(1)}`);
        tng.setAttribute('stroke', '#ff1744'); tng.setAttribute('stroke-width', '2'); tng.setAttribute('fill', 'none'); tng.setAttribute('stroke-linecap', 'round');
        tng.style.transformOrigin = `${p1.x}px ${p1.y}px`;
        tng.style.animation = 'tongueFl 0.6s ease-in-out infinite';
        headGroup.appendChild(tng);

        svg.appendChild(headGroup);
        // Tail
        const td = { x: (p1.x - p2.x) / len, y: (p1.y - p2.y) / len };
        const tt = mk('polygon');
        tt.setAttribute('points', `${(p2.x + td.x * 8).toFixed(1)},${(p2.y + td.y * 8).toFixed(1)} ${(p2.x - td.y * 4).toFixed(1)},${(p2.y + td.x * 4).toFixed(1)} ${(p2.x + td.y * 4).toFixed(1)},${(p2.y - td.x * 4).toFixed(1)}`);
        tt.setAttribute('fill', '#4a0000'); tt.setAttribute('stroke', '#b71c1c'); tt.setAttribute('stroke-width', '1');
        svg.appendChild(tt);
    }

    // LADDERS
    for (const [bStr, top] of Object.entries(state.ladders)) {
        const p1 = ctr(+bStr), p2 = ctr(top);
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy), rg = 11;
        const px = -dy / len * rg, py = dx / len * rg;
        // Glow
        const gl = mk('line');
        gl.setAttribute('x1', p1.x); gl.setAttribute('y1', p1.y); gl.setAttribute('x2', p2.x); gl.setAttribute('y2', p2.y);
        gl.setAttribute('stroke', '#ffd54f'); gl.setAttribute('stroke-width', '18'); gl.setAttribute('opacity', '0.07');
        svg.appendChild(gl);
        // Rails
        [[p1.x - px, p1.y - py, p2.x - px, p2.y - py, 0], [p1.x + px, p1.y + py, p2.x + px, p2.y + py, 0.3]].forEach(([x1, y1, x2, y2, delay]) => {
            const r = mk('line');
            r.setAttribute('x1', x1); r.setAttribute('y1', y1); r.setAttribute('x2', x2); r.setAttribute('y2', y2);
            r.setAttribute('stroke', '#ffd54f'); r.setAttribute('stroke-width', '3.5'); r.setAttribute('stroke-linecap', 'round');
            r.style.animation = `ladderShimmer 2s ease-in-out infinite ${delay}s`;
            svg.appendChild(r);
        });
        // Rungs
        const nr = Math.max(3, Math.floor(len / 28));
        for (let i = 1; i < nr; i++) {
            const t = i / nr, rx = p1.x + dx * t, ry = p1.y + dy * t;
            const rg2 = mk('line');
            rg2.setAttribute('x1', rx - px); rg2.setAttribute('y1', ry - py); rg2.setAttribute('x2', rx + px); rg2.setAttribute('y2', ry + py);
            rg2.setAttribute('stroke', '#ffe082'); rg2.setAttribute('stroke-width', '2'); rg2.setAttribute('stroke-linecap', 'round');
            rg2.style.animation = `ladderShimmer 2s ease-in-out infinite ${(i * .15).toFixed(2)}s`;
            svg.appendChild(rg2);
        }
        // Endpoints
        [p1, p2].forEach((p, i) => {
            const c = mk('circle');
            c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', '7');
            c.setAttribute('fill', i === 0 ? '#f9a825' : '#ffd54f'); c.setAttribute('stroke', '#fffde7'); c.setAttribute('stroke-width', '2');
            c.style.animation = `ladderShimmer 1.5s ease-in-out infinite ${i * .5}s`;
            svg.appendChild(c);
        });
    }
    connectionsDrawn = true;
}

// ── Event Listeners ───────────────────────────────────────────────────────────
document.getElementById('rollBtn').addEventListener('click', () => {
    const cur = currentGameState?.players[currentGameState.currentTurnIndex];
    if (!cur) return;
    document.getElementById('rollBtn').classList.add('hidden');
    const cube = document.getElementById('dieCube');

    // Start a generic roll animation for responsiveness
    cube.classList.add('rolling');
    document.getElementById('diceLabel').innerText = 'Rolling...';

    // Server will eventually send the final result
    stompClient.send(`/app/roll/${gameId}`, {}, cur.id);
});

document.getElementById('submitTaskBtn').addEventListener('click', () => {
    const ans = parseInt(document.getElementById('taskAnswer').value);
    const cur = currentGameState?.players[currentGameState.currentTurnIndex];
    if (!cur) return;
    const pending = currentGameState.pendingTaskPlayerId;
    stompClient.send(`/app/task/${gameId}`, {}, JSON.stringify({ playerId: pending, success: ans === expectedTaskAnswer }));
});

document.getElementById('quitBtn').addEventListener('click', () => {
    document.getElementById('quitModal').classList.remove('hidden');
});
document.getElementById('cancelQuitBtn').addEventListener('click', () => {
    document.getElementById('quitModal').classList.add('hidden');
});
document.getElementById('confirmQuitBtn').addEventListener('click', () => {
    document.getElementById('quitModal').classList.add('hidden');
    stompClient.send(`/app/quit/${gameId}`, {}, '');
});

// ── Victory Celebrations & Fireworks Canvas ──────────────────────────────────
let victoryAnimationId = null;

function showVictory(winnerName) {
    const modal = document.getElementById('victoryModal');
    if (!modal) return;
    document.getElementById('victoryPlayerName').innerText = winnerName;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    startFireworks();
}

document.getElementById('victoryLobbyBtn').addEventListener('click', () => {
    document.getElementById('victoryModal').classList.add('hidden');
    if (victoryAnimationId) {
        cancelAnimationFrame(victoryAnimationId);
        victoryAnimationId = null;
    }
    stompClient.send(`/app/quit/${gameId}`, {}, '');
});

function startFireworks() {
    const canvas = document.getElementById('victoryCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const firecrackers = [];
    const particles = [];

    class Firecracker {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = canvas.height;
            this.tx = this.x + (Math.random() - 0.5) * 150;
            this.ty = Math.random() * (canvas.height * 0.45) + canvas.height * 0.08;
            this.speed = Math.random() * 4 + 5;
            this.angle = Math.atan2(this.ty - this.y, this.tx - this.x);
            this.vx = Math.cos(this.angle) * this.speed;
            this.vy = Math.sin(this.angle) * this.speed;
            this.hue = Math.random() * 360;
            this.done = false;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (Math.random() < 0.4) {
                particles.push(new Particle(this.x, this.y, this.hue, true));
            }
            if (this.vy >= 0 || this.y <= this.ty) {
                this.done = true;
                this.explode();
            }
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${this.hue}, 100%, 70%)`;
            ctx.fill();
        }
        explode() {
            const count = Math.floor(Math.random() * 50) + 70;
            for (let i = 0; i < count; i++) {
                particles.push(new Particle(this.x, this.y, this.hue, false));
            }
        }
    }

    class Particle {
        constructor(x, y, hue, isTrail) {
            this.x = x;
            this.y = y;
            this.isTrail = isTrail;
            if (isTrail) {
                this.vx = (Math.random() - 0.5) * 2;
                this.vy = (Math.random() - 0.5) * 2 + 1;
                this.alpha = 1;
                this.decay = Math.random() * 0.03 + 0.02;
                this.size = Math.random() * 2 + 1;
            } else {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 6 + 3;
                this.vx = Math.cos(angle) * speed;
                this.vy = Math.sin(angle) * speed;
                this.alpha = 1;
                this.decay = Math.random() * 0.012 + 0.008;
                this.size = Math.random() * 3.5 + 1.5;
            }
            this.hue = hue + (Math.random() - 0.5) * 45;
            this.gravity = 0.07;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (!this.isTrail) {
                this.vy += this.gravity;
                this.vx *= 0.97;
                this.vy *= 0.97;
            }
            this.alpha -= this.decay;
        }
        draw() {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${this.hue}, 100%, 65%, ${this.alpha})`;
            ctx.shadowBlur = this.size * 3;
            ctx.shadowColor = `hsl(${this.hue}, 100%, 65%)`;
            ctx.fill();
            ctx.restore();
        }
    }

    const loop = () => {
        const modal = document.getElementById('victoryModal');
        if (modal && !modal.classList.contains('hidden')) {
            victoryAnimationId = requestAnimationFrame(loop);
        }
        ctx.fillStyle = 'rgba(0, 8, 0, 0.2)'; // rich forest trail
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (Math.random() < 0.055 && firecrackers.length < 6) {
            firecrackers.push(new Firecracker());
        }

        for (let i = firecrackers.length - 1; i >= 0; i--) {
            const fc = firecrackers[i];
            fc.update();
            if (fc.done) {
                firecrackers.splice(i, 1);
            } else {
                fc.draw();
            }
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update();
            if (p.alpha <= 0) {
                particles.splice(i, 1);
            } else {
                p.draw();
            }
        }
    };

    loop();
}

let activeMiniGameTimer = null;
let activeMiniGameInterval = null;
let activeMazeKeydownHandler = null;

function startMiniGame(gameName) {
    const container = document.getElementById('miniGameContainer');
    container.innerHTML = '';

    // Clear any running timers or intervals from previous games
    if (activeMiniGameTimer) { clearTimeout(activeMiniGameTimer); activeMiniGameTimer = null; }
    if (activeMiniGameInterval) { clearInterval(activeMiniGameInterval); activeMiniGameInterval = null; }
    if (activeMazeKeydownHandler) { window.removeEventListener('keydown', activeMazeKeydownHandler); activeMazeKeydownHandler = null; }

    let submitAnswer = (success, word = null) => {
        if (activeMiniGameTimer) { clearTimeout(activeMiniGameTimer); activeMiniGameTimer = null; }
        if (activeMiniGameInterval) { clearInterval(activeMiniGameInterval); activeMiniGameInterval = null; }

        const pending = currentGameState.pendingTaskPlayerId;
        stompClient.send(`/app/task/${gameId}`, {}, JSON.stringify({ playerId: pending, success: success, word: word }));
    };

    if (gameName === 'MEMORY_MATCH') {
        document.getElementById('taskTitle').innerText = '🔮 MEMORY MATCH';
        document.getElementById('taskDesc').innerText = 'Match the mystical runes to reveal the path!';

        const symbols = ['💀', '🕯️', '🔑', '🔮', '📜', '🕸️'];
        let cards = [...symbols, ...symbols];
        // Shuffle cards
        cards.sort(() => Math.random() - 0.5);

        container.innerHTML = `
            <div class="game-instructions">Time remaining: <span id="matchTimer">30</span>s</div>
            <div class="memory-grid">
                ${cards.map((sym, i) => `<div class="memory-card" data-index="${i}" data-symbol="${sym}">?</div>`).join('')}
            </div>
        `;

        let flipped = [];
        let matchedCount = 0;
        let timeLeft = 30;

        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('matchTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(false);
            }
        }, 1000);

        container.querySelectorAll('.memory-card').forEach(card => {
            card.addEventListener('click', () => {
                if (card.classList.contains('flipped') || card.classList.contains('matched') || flipped.length >= 2) return;

                card.innerText = card.dataset.symbol;
                card.classList.add('flipped');
                flipped.push(card);

                if (flipped.length === 2) {
                    const [c1, c2] = flipped;
                    if (c1.dataset.symbol === c2.dataset.symbol) {
                        c1.classList.add('matched');
                        c2.classList.add('matched');
                        flipped = [];
                        matchedCount += 2;
                        if (matchedCount === cards.length) {
                            setTimeout(() => submitAnswer(true), 500);
                        }
                    } else {
                        setTimeout(() => {
                            c1.innerText = '?';
                            c1.classList.remove('flipped');
                            c2.innerText = '?';
                            c2.classList.remove('flipped');
                            flipped = [];
                        }, 800);
                    }
                }
            });
        });

    } else if (gameName === 'QUICK_MATH') {
        document.getElementById('taskTitle').innerText = '📚 QUICK MATH CHALLENGE';
        document.getElementById('taskDesc').innerText = 'Solve the floating chalk equation!';

        const n1 = Math.floor(Math.random() * 25) + 5;
        const n2 = Math.floor(Math.random() * 20) + 5;
        const op = Math.random() > 0.5 ? '+' : '−';
        const correctAns = op === '+' ? n1 + n2 : n1 - n2;

        const options = new Set([correctAns]);
        while (options.size < 4) {
            options.add(correctAns + Math.floor(Math.random() * 20) - 10);
        }
        const optArray = Array.from(options).sort(() => Math.random() - 0.5);

        container.innerHTML = `
            <div class="game-instructions">Time remaining: <span id="mathTimer">10</span>s</div>
            <div class="chalkboard">
                <div class="chalk-equation">${n1} ${op} ${n2} = ?</div>
                <div class="chalk-options">
                    ${optArray.map(opt => `<button class="chalk-btn" data-value="${opt}">${opt}</button>`).join('')}
                </div>
            </div>
        `;

        let timeLeft = 10;
        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('mathTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(false);
            }
        }, 1000);

        container.querySelectorAll('.chalk-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = parseInt(btn.dataset.value);
                submitAnswer(val === correctAns);
            });
        });

    } else if (gameName === 'PATTERN_SEQUENCE') {
        document.getElementById('taskTitle').innerText = '🏮 PATTERN SEQUENCE';
        document.getElementById('taskDesc').innerText = 'Identify the missing artifact to solve the alignment!';

        // Predefined sequences
        const sequences = [
            { seq: ['🕯️', '💀', '🕯️', '🕯️', '💀'], ans: '🕯️', options: ['🕯️', '💀', '🔑'] },
            { seq: ['🔑', '💀', '🔑', '💀', '🔑'], ans: '💀', options: ['🕯️', '💀', '🔑'] },
            { seq: ['🕯️', '🔑', '🔮', '🕯️', '🔑'], ans: '🔮', options: ['🕯️', '🔑', '🔮'] }
        ];

        const selected = sequences[Math.floor(Math.random() * sequences.length)];

        container.innerHTML = `
            <div class="game-instructions">Time remaining: <span id="patternTimer">12</span>s</div>
            <div class="pattern-altar">
                <div class="pattern-sequence-row">
                    ${selected.seq.map(sym => `<div class="pattern-symbol">${sym}</div>`).join('')}
                    <div class="pattern-symbol mystery">?</div>
                </div>
                <div class="chalk-options">
                    ${selected.options.map(opt => `<button class="chalk-btn" data-value="${opt}">${opt}</button>`).join('')}
                </div>
            </div>
        `;

        let timeLeft = 12;
        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('patternTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(false);
            }
        }, 1000);

        container.querySelectorAll('.chalk-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.value;
                submitAnswer(val === selected.ans);
            });
        });

    } else if (gameName === 'COLOR_CLICK') {
        document.getElementById('taskTitle').innerText = '🔴 ORB CHROMATIC SEQUENCE';
        document.getElementById('taskDesc').innerText = 'Watch the glowing sequence and click the orbs in correct order!';

        const colors = ['red', 'blue', 'green', 'purple'];
        const sequence = [];
        for (let i = 0; i < 4; i++) sequence.push(colors[Math.floor(Math.random() * 4)]);

        container.innerHTML = `
            <div class="game-instructions">Time remaining: <span id="colorTimer">15</span>s</div>
            <div class="color-diamond-grid">
                <div class="color-orb orb-red" data-color="red"></div>
                <div class="color-orb orb-blue" data-color="blue"></div>
                <div class="color-orb orb-green" data-color="green"></div>
                <div class="color-orb orb-purple" data-color="purple"></div>
            </div>
            <div id="playbackIndicator" style="margin-top: 10px; color: #ffd700;">Memorize the pattern!</div>
        `;

        // Play sequence
        let step = 0;
        const playNext = () => {
            if (step >= sequence.length) {
                const indicator = document.getElementById('playbackIndicator');
                if (indicator) indicator.innerText = 'Your turn! Repeat the sequence.';
                enablePlayerClicks();
                return;
            }
            const color = sequence[step];
            const orb = container.querySelector(`.orb-${color}`);
            if (orb) {
                orb.classList.add('active');
                activeMiniGameTimer = setTimeout(() => {
                    orb.classList.remove('active');
                    step++;
                    activeMiniGameTimer = setTimeout(playNext, 300);
                }, 600);
            }
        };

        // Delay starting sequence play by 800ms
        activeMiniGameTimer = setTimeout(playNext, 800);

        let userStep = 0;
        let playIntervalStarted = false;
        let timeLeft = 15;
        const enablePlayerClicks = () => {
            if (playIntervalStarted) return;
            playIntervalStarted = true;
            activeMiniGameInterval = setInterval(() => {
                timeLeft--;
                const timerEl = document.getElementById('colorTimer');
                if (timerEl) timerEl.innerText = timeLeft;
                if (timeLeft <= 0) {
                    submitAnswer(false);
                }
            }, 1000);

            container.querySelectorAll('.color-orb').forEach(orb => {
                orb.addEventListener('click', () => {
                    const color = orb.dataset.color;
                    orb.classList.add('active');
                    setTimeout(() => orb.classList.remove('active'), 200);

                    if (color === sequence[userStep]) {
                        userStep++;
                        if (userStep === sequence.length) {
                            setTimeout(() => submitAnswer(true), 400);
                        }
                    } else {
                        setTimeout(() => submitAnswer(false), 400);
                    }
                });
            });
        };

    } else if (gameName === 'WORD_SCRAMBLE') {
        document.getElementById('taskTitle').innerText = '📜 WEATHERED WORD SCRAMBLE';
        document.getElementById('taskDesc').innerText = 'Unscramble the bones of this spooky word!';

        const words = ['GHOST', 'DOOM', 'GRAVE', 'WITCH', 'CURSE', 'DEATH', 'CRYPT'];
        const acceptedAnagrams = {
            'DOOM': ['DOOM', 'MOOD'],
            'DEATH': ['DEATH', 'HATED'],
            'CURSE': ['CURSE', 'CURES'],
            'GRAVE': ['GRAVE'],
            'GHOST': ['GHOST'],
            'WITCH': ['WITCH'],
            'CRYPT': ['CRYPT']
        };
        const word = words[Math.floor(Math.random() * words.length)];
        let letters = word.split('');
        while (letters.join('') === word) {
            letters.sort(() => Math.random() - 0.5);
        }

        container.innerHTML = `
            <div class="game-instructions">Time remaining: <span id="scrambleTimer">20</span>s</div>
            <div class="scramble-target" id="scrambleTarget"></div>
            <div class="scramble-letters">
                ${letters.map((letter, i) => `<div class="scramble-letter" data-index="${i}" data-letter="${letter}">${letter}</div>`).join('')}
            </div>
            <div style="display: flex; gap: 12px; justify-content: center; margin-top: 15px;">
                <button id="clearScrambleBtn" class="btn warning">Clear</button>
                <button id="submitScrambleBtn" class="btn primary">Submit</button>
            </div>
        `;

        let timeLeft = 20;
        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('scrambleTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(false, word);
            }
        }, 1000);

        const target = document.getElementById('scrambleTarget');
        let currentGuess = '';

        container.querySelectorAll('.scramble-letters .scramble-letter').forEach(box => {
            box.addEventListener('click', () => {
                if (box.style.visibility === 'hidden') return;
                box.style.visibility = 'hidden';
                currentGuess += box.dataset.letter;

                const letterObj = document.createElement('div');
                letterObj.className = 'scramble-letter';
                letterObj.innerText = box.dataset.letter;
                target.appendChild(letterObj);
            });
        });

        document.getElementById('clearScrambleBtn').addEventListener('click', () => {
            currentGuess = '';
            target.innerHTML = '';
            container.querySelectorAll('.scramble-letters .scramble-letter').forEach(box => {
                box.style.visibility = 'visible';
            });
        });

        document.getElementById('submitScrambleBtn').addEventListener('click', () => {
            const allowed = acceptedAnagrams[word] || [word];
            if (allowed.includes(currentGuess)) {
                submitAnswer(true, currentGuess);
            } else {
                submitAnswer(false, word);
            }
        });

    } else if (gameName === 'DONT_BLINK') {
        document.getElementById('taskTitle').innerText = '👁️ DON\'T BLINK';
        document.getElementById('taskDesc').innerText = 'Keep your cursor inside the protective talisman!';

        container.innerHTML = `
            <div class="game-instructions">Hold cursor inside talisman! Time remaining: <span id="dontBlinkTimer">25</span>s</div>
            <div class="game-progress-bar-container">
                <div class="game-progress-fill" id="talismanProgress"></div>
            </div>
            <div class="talisman-arena" id="talismanArena">
                <div class="ghost-overlay" id="ghostOverlay" style="background-image: url('https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=400&q=80');"></div>
                <div class="protective-talisman" id="talisman"></div>
            </div>
            <div id="talismanStatus" style="color: #39ff14;">Stay inside!</div>
        `;

        const talisman = document.getElementById('talisman');
        const arena = document.getElementById('talismanArena');
        const progress = document.getElementById('talismanProgress');
        const ghost = document.getElementById('ghostOverlay');
        const status = document.getElementById('talismanStatus');

        let isInside = false;
        let survivalScore = 0; // Out of 100
        let tensionMeter = 0;
        let timeLeft = 25;
        let tickCount = 0;

        talisman.addEventListener('mouseenter', () => { isInside = true; if (status) { status.innerText = '🛡️ Protected...'; status.style.color = '#39ff14'; } });
        talisman.addEventListener('mouseleave', () => { isInside = false; if (status) { status.innerText = '⚠️ RUNIC CONNECTION LOST!'; status.style.color = '#ff3344'; } });

        // Drifting talisman logic
        let angle = 0;
        activeMiniGameInterval = setInterval(() => {
            // Circle/drift calculations
            angle += 0.08;
            const radius = 60;
            const centerX = (arena.clientWidth - 60) / 2;
            const centerY = (arena.clientHeight - 60) / 2;
            const tx = centerX + Math.cos(angle * 1.5) * radius * 1.2;
            const ty = centerY + Math.sin(angle) * radius;

            talisman.style.left = tx + 'px';
            talisman.style.top = ty + 'px';

            tickCount++;
            if (tickCount % 10 === 0) {
                timeLeft--;
                const timerEl = document.getElementById('dontBlinkTimer');
                if (timerEl) timerEl.innerText = timeLeft;
                if (timeLeft <= 0) {
                    submitAnswer(false);
                }
            }

            if (isInside) {
                survivalScore += 2;
                if (progress) progress.style.width = survivalScore + '%';
                if (survivalScore >= 100) {
                    submitAnswer(true);
                }
            } else {
                tensionMeter += 3;
                if (ghost) {
                    ghost.style.opacity = (tensionMeter / 100) * 0.9;
                    ghost.classList.toggle('ghost-glitch', tensionMeter > 30);
                }

                if (tensionMeter >= 100) {
                    submitAnswer(false);
                }
            }
        }, 100);

    } else if (gameName === 'DARK_MAZE') {
        document.getElementById('taskTitle').innerText = '🕸️ ESCAPE THE DARK MAZE';
        document.getElementById('taskDesc').innerText = 'Navigate the dark labyrinth to the exit crystal!';

        // 6x6 Simple Maze
        // 0: path, 1: wall
        const maze = [
            [0, 1, 0, 0, 0, 0],
            [0, 1, 0, 1, 1, 0],
            [0, 0, 0, 1, 0, 0],
            [0, 1, 1, 1, 0, 1],
            [0, 1, 0, 0, 0, 1],
            [0, 0, 0, 1, 0, 0] // Exit at 5,5
        ];

        let px = 0, py = 0; // Player pos
        let timeLeft = 25;

        container.innerHTML = `
            <div class="game-instructions">Find the 🏆! Time remaining: <span id="mazeTimer">25</span>s</div>
            <div class="maze-grid" id="mazeGrid"></div>
            <div class="candle-shield-sides">
                <button class="shield-btn" id="mazeUp">▲ Up</button>
            </div>
            <div class="candle-shield-sides" style="margin-top: 5px;">
                <button class="shield-btn" id="mazeLeft">◀ Left</button>
                <button class="shield-btn" id="mazeRight">Right ▶</button>
            </div>
            <div class="candle-shield-sides" style="margin-top: 5px;">
                <button class="shield-btn" id="mazeDown">▼ Down</button>
            </div>
        `;

        const renderMaze = () => {
            const grid = document.getElementById('mazeGrid');
            if (!grid) return;
            grid.innerHTML = '';
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    const cell = document.createElement('div');
                    cell.className = 'maze-cell';

                    // Fog calculation: only show immediate surroundings
                    const dist = Math.abs(r - py) + Math.abs(c - px);
                    if (dist > 1) {
                        cell.classList.add('hidden-fog');
                    } else {
                        if (maze[r][c] === 1) cell.classList.add('wall');
                        if (r === py && c === px) cell.classList.add('player');
                        else if (r === 5 && c === 5) {
                            cell.classList.add('exit');
                            cell.innerText = '🏆';
                        }
                    }
                    grid.appendChild(cell);
                }
            }
        };

        renderMaze();

        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('mazeTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(false);
            }
        }, 1000);

        const movePlayer = (dx, dy) => {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < 6 && ny >= 0 && ny < 6 && maze[ny][nx] === 0) {
                px = nx;
                py = ny;
                renderMaze();
                if (px === 5 && py === 5) {
                    setTimeout(() => submitAnswer(true), 300);
                }
            }
        };

        document.getElementById('mazeUp').addEventListener('click', () => movePlayer(0, -1));
        document.getElementById('mazeDown').addEventListener('click', () => movePlayer(0, 1));
        document.getElementById('mazeLeft').addEventListener('click', () => movePlayer(-1, 0));
        document.getElementById('mazeRight').addEventListener('click', () => movePlayer(1, 0));

        // Keyboard arrow listener
        const keyHandler = (e) => {
            if (e.key === 'ArrowUp') movePlayer(0, -1);
            if (e.key === 'ArrowDown') movePlayer(0, 1);
            if (e.key === 'ArrowLeft') movePlayer(-1, 0);
            if (e.key === 'ArrowRight') movePlayer(1, 0);
        };
        activeMazeKeydownHandler = keyHandler;
        window.addEventListener('keydown', keyHandler);

        // Remove listener when game stops
        const superSubmitAnswer = submitAnswer;
        submitAnswer = (success) => {
            if (activeMazeKeydownHandler) {
                window.removeEventListener('keydown', activeMazeKeydownHandler);
                activeMazeKeydownHandler = null;
            }
            superSubmitAnswer(success);
        };

    } else if (gameName === 'MONSTER_CHASE') {
        document.getElementById('taskTitle').innerText = '🚨 MONSTER CHASE REACT!';
        document.getElementById('taskDesc').innerText = 'React at the exact split-second the monster enters the Danger Zone!';

        container.innerHTML = `
            <div class="game-instructions">Time to impact: <span id="monsterTimer">2.5s</span></div>
            <div class="chase-lane">
                <div class="chase-tile" id="tile5">5</div>
                <div class="chase-tile" id="tile4">4</div>
                <div class="chase-tile" id="tile3">3</div>
                <div class="chase-tile" id="tile2">2</div>
                <div class="chase-tile danger-zone" id="tile1">Zone</div>
            </div>
            <button class="btn btn-chase-run" id="chaseRunBtn">RUN!</button>
        `;

        let currentTile = 5;
        let reactionWindowActive = false;

        const updateMonsterPosition = () => {
            // Remove previous monster
            container.querySelectorAll('.chase-tile').forEach(t => {
                t.innerText = t.id.replace('tile', '');
                t.classList.remove('monster-here');
            });

            if (currentTile >= 1) {
                const tile = document.getElementById(`tile${currentTile}`);
                if (tile) {
                    tile.innerText = '👹';
                    tile.classList.add('monster-here');

                    const timerEl = document.getElementById('monsterTimer');
                    if (timerEl) {
                        if (currentTile === 1) {
                            timerEl.innerText = '0.28s (DANGER!)';
                            timerEl.style.color = '#ff3344';
                        } else {
                            timerEl.innerText = (currentTile * 0.55).toFixed(2) + 's';
                        }
                    }

                    if (currentTile === 1) {
                        reactionWindowActive = true;
                        // React within 280ms
                        activeMiniGameTimer = setTimeout(() => {
                            reactionWindowActive = false;
                            if (timerEl) timerEl.innerText = '0.00s (CAUGHT!)';
                            submitAnswer(false); // Too slow!
                        }, 280);
                    } else {
                        currentTile--;
                        activeMiniGameTimer = setTimeout(updateMonsterPosition, 550);
                    }
                }
            }
        };

        activeMiniGameTimer = setTimeout(updateMonsterPosition, 800);

        document.getElementById('chaseRunBtn').addEventListener('click', () => {
            if (reactionWindowActive) {
                submitAnswer(true);
            } else {
                submitAnswer(false); // Too early or already caught!
            }
        });

    } else if (gameName === 'CANDLE_SURVIVAL') {
        document.getElementById('taskTitle').innerText = '🕯️ FLICKERING CANDLE';
        document.getElementById('taskDesc').innerText = 'Stoke the flame and shield it from the icy wind!';

        container.innerHTML = `
            <div class="game-instructions">Survive wind gusts! Time remaining: <span id="candleTimer">15</span>s</div>
            <div class="game-progress-bar-container">
                <div class="game-progress-fill" id="candleFlameBar" style="width: 100%;"></div>
            </div>
            <div class="candle-survival-area">
                <div class="candle-graphic-container">
                    <div class="candle-wind-arrow hidden" id="windArrow">🌬️</div>
                    <div class="candle-flame" id="candleFlame"></div>
                    <div class="candle-stick"></div>
                </div>
                <button class="btn warning" id="stokeBtn" style="margin-top: 10px;">Stoke Flame</button>
                <div class="candle-shield-sides">
                    <button class="shield-btn" id="shieldLeft">Shield Left</button>
                    <button class="shield-btn" id="shieldRight">Shield Right</button>
                </div>
            </div>
        `;

        const stoke = document.getElementById('stokeBtn');
        const flame = document.getElementById('candleFlame');
        const bar = document.getElementById('candleFlameBar');
        const arrow = document.getElementById('windArrow');
        const shieldL = document.getElementById('shieldLeft');
        const shieldR = document.getElementById('shieldRight');

        let flameIntensity = 100;
        let shieldSide = null; // 'LEFT', 'RIGHT'
        let windSide = null; // 'LEFT', 'RIGHT'
        let gameTime = 0;

        shieldL.addEventListener('mousedown', () => { shieldSide = 'LEFT'; shieldL.classList.add('shielding'); });
        shieldL.addEventListener('mouseup', () => { shieldSide = null; shieldL.classList.remove('shielding'); });
        shieldR.addEventListener('mousedown', () => { shieldSide = 'RIGHT'; shieldR.classList.add('shielding'); });
        shieldR.addEventListener('mouseup', () => { shieldSide = null; shieldR.classList.remove('shielding'); });

        stoke.addEventListener('click', () => {
            flameIntensity = Math.min(100, flameIntensity + 15);
            if (bar) bar.style.width = flameIntensity + '%';
        });

        // Loop ticks every 100ms
        activeMiniGameInterval = setInterval(() => {
            gameTime += 100;

            // Flame decay
            let decay = 1.5;
            if (windSide && shieldSide !== windSide) {
                decay = 5.0; // High decay if wind is blowing and side is not shielded
            }

            const secondsLeft = Math.max(0, Math.ceil((15000 - gameTime) / 1000));
            const timerEl = document.getElementById('candleTimer');
            if (timerEl) timerEl.innerText = secondsLeft;

            flameIntensity = Math.max(0, flameIntensity - decay);
            if (bar) bar.style.width = flameIntensity + '%';
            if (flame) {
                flame.style.transform = `scale(${flameIntensity / 100})`;
                flame.style.opacity = flameIntensity / 100;
            }

            if (flameIntensity <= 0) {
                submitAnswer(false);
            }

            if (gameTime >= 15000) { // Survive 15 seconds
                submitAnswer(true);
            }

            // Wind generation logic
            if (gameTime % 1500 === 0 && gameTime < 14000) {
                windSide = Math.random() > 0.5 ? 'LEFT' : 'RIGHT';
                if (arrow) {
                    arrow.className = `candle-wind-arrow wind-${windSide.toLowerCase()}`;
                    arrow.classList.remove('hidden');
                }

                // Keep wind active for 1.0 second
                setTimeout(() => {
                    windSide = null;
                    if (arrow) arrow.classList.add('hidden');
                }, 1000);
            }
        }, 100);

    } else if (gameName === 'SURVIVAL_TIMER') {
        document.getElementById('taskTitle').innerText = '🧟 SURVIVAL TIMEOUT';
        document.getElementById('taskDesc').innerText = 'Stay perfectly calm! Ignore all trap popups and sigils!';

        let timeLeft = 20;

        container.innerHTML = `
            <div class="game-instructions">Ignore all prompts! Time remaining: <span id="survivalTimer">20</span>s</div>
            <div class="stay-calm-area" id="calmArea">
                <button class="btn-calm-safe" id="calmBtn">STAY SAFE</button>
            </div>
        `;

        // Spawn fake emergency popups
        const calmArea = document.getElementById('calmArea');
        const spawnPopup = () => {
            if (timeLeft <= 1) return;

            const popup = document.createElement('div');
            popup.className = 'fake-hallucination-modal';
            popup.style.left = (Math.random() * 50 + 10) + 'px';
            popup.style.top = (Math.random() * 80 + 30) + 'px';

            const prompts = [
                { t: '⚠️ SYSTEM FAILURE!', b: 'EMERGENCY REPAIR' },
                { t: '🚨 REDIRECT TRAFFIC!', b: 'CONTINUE GAME' },
                { t: '💀 CHASE DANGER!', b: 'TAP TO SURVIVE' }
            ];
            const p = prompts[Math.floor(Math.random() * prompts.length)];
            popup.innerHTML = `
                <h4>${p.t}</h4>
                <button>${p.b}</button>
            `;

            popup.addEventListener('click', () => {
                submitAnswer(false); // CLICKED THE TRAP!
            });

            if (calmArea) calmArea.appendChild(popup);

            activeMiniGameTimer = setTimeout(spawnPopup, Math.random() * 1500 + 1500);
        };

        // Delay starting spawns cleanly
        activeMiniGameTimer = setTimeout(spawnPopup, 1000);

        activeMiniGameInterval = setInterval(() => {
            timeLeft--;
            const timerEl = document.getElementById('survivalTimer');
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                submitAnswer(true); // Successfully ignored all traps!
            }
        }, 1000);
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────
initBoard();
setCount(1); // Default lobby: 1 player

window.addEventListener('resize', () => {
    if (currentGameState?.gameStarted) {
        updateTokens(true);
        connectionsDrawn = false;
        const svg = document.getElementById('svgOverlay');
        if (svg) svg.innerHTML = '';
        drawConnections(currentGameState);
    }
});

// Fetch current state and connect
function fetchState() {
    fetch('/api/state/' + gameId)
        .then(res => res.json())
        .then(state => {
            // On fresh page load, ALWAYS show the lobby first.
            // If a game is already running, reveal the "Resume" button so the
            // user can consciously choose to resume or start a new game.
            if (state.gameStarted) {
                currentGameState = state;
                updatePlayerList();
                showLobby(state);   // shows lobby + resume button
                connect(() => { }); // connect but don't auto-enter game
            } else {
                handleGameState(state);
                connect(() => { });
            }
        })
        .catch(err => {
            console.error("Failed to fetch state:", err);
            connect(() => { });
        });
}

fetchState();
