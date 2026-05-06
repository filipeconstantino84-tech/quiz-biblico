const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════
// DATA PERSISTENCE (JSON file, no DB needed)
// ═══════════════════════════════════════════════════════
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  return { questions: getDefaultQuestions(), settings: getDefaultSettings(), ranking: [] };
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

let appData = loadData();

// ═══════════════════════════════════════════════════════
// GAMES STATE
// ═══════════════════════════════════════════════════════
const games = new Map(); // pin -> gameState

function generatePIN() {
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (games.has(pin));
  return pin;
}

function createGame(hostWs, hostName, hostAvatar, options) {
  const pin = generatePIN();
  const hostPlayerId = 'host';
  const game = {
    pin, hostWs, hostName, hostAvatar, options,
    players: new Map(),
    state: 'waiting',
    currentQ: 0, questions: [], timer: null,
    timeLeft: 0, startTime: 0, questionStartTime: 0,
    hostPlayerId,
  };
  const hostPlayer = {
    ws: hostWs, id: hostPlayerId, name: hostName, avatar: hostAvatar || '🐑',
    score: 0, streak: 0, lives: 3, answered: false, isHost: true
  };
  game.players.set(hostPlayerId, hostPlayer);
  games.set(pin, game);
  return game;
}

function getGame(pin) { return games.get(pin); }

function removePlayer(ws) {
  for (const [pin, game] of games) {
    for (const [id, player] of game.players) {
      // [ALTERAÇÃO 1] Ignorar o registo do anfitrião-jogador ao procurar por ws de jogador
      if (player.isHost) continue;
      if (player.ws === ws) {
        game.players.delete(id);
        broadcastToGame(game, { type: 'player_left', id, name: player.name, count: game.players.size });
        sendToHost(game, { type: 'player_left', id, name: player.name, count: game.players.size, players: getPlayerList(game) });
        if (game.players.size === 0 && game.state === 'waiting') {
          clearInterval(game.timer);
          games.delete(pin);
        }
        return;
      }
    }
    if (game.hostWs === ws) {
      broadcastToGame(game, { type: 'host_left' });
      clearInterval(game.timer);
      games.delete(pin);
      return;
    }
  }
}

function getPlayerList(game) {
  return [...game.players.values()].map(p => ({
    id: p.id, name: p.name, avatar: p.avatar || '🐑',
    score: p.score, lives: p.lives, streak: p.streak, isHost: !!p.isHost
  }));
}

// [ALTERAÇÃO 1] Conta apenas jogadores reais (excluindo o anfitrião) para exibição no lobby
function getRealPlayerCount(game) {
  return [...game.players.values()].filter(p => !p.isHost).length;
}

function sendToWs(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (e) {}
  }
}

function sendToHost(game, data) { sendToWs(game.hostWs, data); }

function broadcastToGame(game, data, excludeWs = null) {
  for (const player of game.players.values()) {
    if (player.ws !== excludeWs) sendToWs(player.ws, data);
  }
}

function broadcastAll(game, data) {
  sendToHost(game, data);
  broadcastToGame(game, data);
}

// ═══════════════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════════════
function prepareQuestions(game) {
  const { options } = game;
  let pool = [...appData.questions];

  if (options.category && options.category !== 'all')
    pool = pool.filter(q => q.cat === options.category);

  if (options.difficulty && options.difficulty !== 'all') {
    const filtered = pool.filter(q => q.diff === options.difficulty);
    if (filtered.length >= 5) pool = filtered;
  }

  pool = pool.sort(() => Math.random() - 0.5);
  game.questions = pool.slice(0, Math.min(options.qty || 10, pool.length));
}

function startCountdown(game) {
  game.state = 'countdown';
  prepareQuestions(game);
  broadcastAll(game, { type: 'game_starting', countdown: 3, total: game.questions.length });
  let count = 3;
  const t = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(t);
      startQuestion(game);
    } else {
      broadcastAll(game, { type: 'countdown', value: count });
    }
  }, 1000);
}

function startQuestion(game) {
  if (game.currentQ >= game.questions.length) { endGame(game); return; }
  const q = game.questions[game.currentQ];
  game.state = 'question';
  game.questionStartTime = Date.now();

  // Reset answers for this round (including host-player)
  for (const player of game.players.values()) player.answered = false;

  const timeLimit = game.options.difficulty === 'dificil' ? 20 : game.options.difficulty === 'medio' ? 25 : 30;
  game.timeLeft = timeLimit;

  // [ALTERAÇÃO 1] Enviar ao anfitrião a pergunta com resposta correta (para exibição no painel)
  // E também como jogador (pode responder). O campo 'correct' serve só para o painel do host.
  sendToHost(game, {
    type: 'question',
    index: game.currentQ,
    total: game.questions.length,
    q: q.q, icon: q.icon, cat: q.cat,
    answers: q.a,
    correct: q.correct, // [ALTERAÇÃO 1] anfitrião recebe a resposta correta para o painel
    timeLimit,
    players: getPlayerList(game),
  });

  // Send question to players (without correct)
  broadcastToGame(game, {
    type: 'question',
    index: game.currentQ,
    total: game.questions.length,
    q: q.q, icon: q.icon, cat: q.cat,
    answers: q.a,
    timeLimit,
  });

  clearInterval(game.timer);
  game.timer = setInterval(() => {
    game.timeLeft--;
    broadcastAll(game, { type: 'tick', timeLeft: game.timeLeft });
    if (game.timeLeft <= 0) {
      clearInterval(game.timer);
      revealAnswer(game);
    }
  }, 1000);
}

function processAnswer(game, playerId, answerIdx) {
  const player = game.players.get(playerId);
  if (!player || player.answered || game.state !== 'question') return;
  player.answered = true;

  const q = game.questions[game.currentQ];
  const correct = answerIdx === q.correct;
  const elapsed = (Date.now() - game.questionStartTime) / 1000;
  const timeLimit = game.options.difficulty === 'dificil' ? 20 : game.options.difficulty === 'medio' ? 25 : 30;

  let pts = 0;
  if (correct) {
    const speed = Math.round(((timeLimit - elapsed) / timeLimit) * 50);
    player.streak = (player.streak || 0) + 1;
    const mult = Math.min(player.streak, 4);
    pts = (100 + speed) * mult;
    player.score += pts;
  } else {
    player.streak = 0;
    player.lives = Math.max(0, (player.lives || 3) - 1);
  }

  // [ALTERAÇÃO 1] Enviar resultado ao jogador (seja host ou player normal)
  sendToWs(player.ws, { type: 'answer_result', correct, pts, streak: player.streak, lives: player.lives, score: player.score, isHostPlayer: !!player.isHost });
  // Notificar o host do painel (se não for o próprio host a responder)
  if (!player.isHost) {
    sendToHost(game, { type: 'player_answered', id: playerId, name: player.name, correct, players: getPlayerList(game) });
  } else {
    // Anfitrião respondeu — atualizar painel de respostas para ele mesmo
    sendToHost(game, { type: 'player_answered', id: playerId, name: player.name, correct, players: getPlayerList(game) });
  }

  // Check if all answered
  const allAnswered = [...game.players.values()].every(p => p.answered || p.lives <= 0);
  if (allAnswered) {
    clearInterval(game.timer);
    revealAnswer(game);
  }
}

function revealAnswer(game) {
  game.state = 'result';
  const q = game.questions[game.currentQ];
  clearInterval(game.timer);

  const leaderboard = getPlayerList(game).sort((a, b) => b.score - a.score);
  broadcastAll(game, {
    type: 'reveal',
    correct: q.correct,
    explanation: q.explanation || null,
    leaderboard,
  });

  // Remove dead players
  for (const [id, player] of game.players) {
    if (player.lives <= 0) {
      sendToWs(player.ws, { type: 'eliminated' });
    }
  }
}

function nextQuestion(game) {
  // [ALTERAÇÃO 1] Remover jogadores eliminados (exceto o anfitrião — o anfitrião não é eliminado)
  for (const [id, player] of game.players) {
    if (player.lives <= 0 && !player.isHost) game.players.delete(id);
  }
  // Verificar se ainda há jogadores para jogar (host conta)
  const activePlayers = [...game.players.values()].filter(p => p.lives > 0 || p.isHost);
  if (activePlayers.length === 0) { endGame(game); return; }
  game.currentQ++;
  startQuestion(game);
}

function endGame(game) {
  game.state = 'ended';
  clearInterval(game.timer);
  const leaderboard = getPlayerList(game).sort((a, b) => b.score - a.score);

  // Save ranking (with avatar)
  for (const p of leaderboard) {
    appData.ranking.push({ name: p.name, avatar: p.avatar || '🐑', score: p.score, date: new Date().toLocaleDateString('pt-BR') });
  }
  appData.ranking.sort((a, b) => b.score - a.score);
  appData.ranking = appData.ranking.slice(0, 50);
  saveData(appData);

  broadcastAll(game, { type: 'game_over', leaderboard });

  // Cleanup after delay
  setTimeout(() => games.delete(game.pin), 60000);
}

// ═══════════════════════════════════════════════════════
// WEBSOCKET HANDLER
// ═══════════════════════════════════════════════════════
let clientIdCounter = 0;

wss.on('connection', (ws) => {
  ws.clientId = ++clientIdCounter;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {

      // ─── HOST: Create game ───
      case 'create_game': {
        const game = createGame(ws, msg.name, msg.avatar || '🐑', msg.options || {});
        ws.gamePin = game.pin;
        ws.role = 'host';
        sendToWs(ws, { type: 'game_created', pin: game.pin });
        break;
      }

      // ─── PLAYER: Join game ───
      case 'join_game': {
        const game = getGame(msg.pin);
        if (!game) { sendToWs(ws, { type: 'error', msg: 'Jogo não encontrado!' }); return; }
        if (game.state !== 'waiting') { sendToWs(ws, { type: 'error', msg: 'O jogo já começou!' }); return; }
        const id = 'p' + ws.clientId;
        const player = {
          ws, id, name: msg.name, avatar: msg.avatar || '🐑',
          score: 0, streak: 0, lives: 3, answered: false
        };
        game.players.set(id, player);
        ws.gamePin = game.pin;
        ws.playerId = id;
        ws.role = 'player';
        sendToWs(ws, { type: 'joined', id, pin: game.pin, hostName: game.hostName });
        const realCount = getRealPlayerCount(game);
        sendToHost(game, { type: 'player_joined', id, name: msg.name, avatar: msg.avatar || '🐑', count: realCount, players: getPlayerList(game) });
        broadcastToGame(game, { type: 'player_joined', id, name: msg.name, avatar: msg.avatar || '🐑', count: realCount }, ws);
        break;
      }

      // ─── HOST: Start game ───
      case 'start_game': {
        const game = getGame(ws.gamePin);
        if (!game || game.hostWs !== ws) return;
        // [ALTERAÇÃO 1] O jogo pode iniciar só com o anfitrião (ele próprio é jogador)
        const realPlayers = getRealPlayerCount(game);
        if (realPlayers === 0 && game.players.size <= 1) {
          // Permite iniciar com apenas o anfitrião-jogador
        }
        startCountdown(game);
        break;
      }

      // ─── HOST: Next question ───
      case 'next_question': {
        const game = getGame(ws.gamePin);
        if (!game || game.hostWs !== ws || game.state !== 'result') return;
        nextQuestion(game);
        break;
      }

      // ─── PLAYER: Answer ───
      case 'answer': {
        const game = getGame(ws.gamePin);
        if (!game) return;
        // [ALTERAÇÃO 1] Anfitrião também pode responder usando o seu ID de jogador
        const pid = ws.role === 'host' ? game.hostPlayerId : ws.playerId;
        processAnswer(game, pid, msg.answer);
        break;
      }

      // ─── HOST: Kick player ───
      case 'kick_player': {
        const game = getGame(ws.gamePin);
        if (!game || game.hostWs !== ws) return;
        const player = game.players.get(msg.id);
        if (player) {
          sendToWs(player.ws, { type: 'kicked' });
          game.players.delete(msg.id);
          sendToHost(game, { type: 'player_left', id: msg.id, name: player.name, count: game.players.size, players: getPlayerList(game) });
        }
        break;
      }

      // ─── ADMIN: Auth ───
      case 'admin_auth': {
        const pass = appData.settings.adminPassword || 'admin123';
        if (msg.password === pass) {
          ws.isAdmin = true;
          sendToWs(ws, { type: 'admin_ok', data: appData });
        } else {
          sendToWs(ws, { type: 'admin_error', msg: 'Senha incorreta!' });
        }
        break;
      }

      // ─── ADMIN: Save questions ───
      case 'admin_save_questions': {
        if (!ws.isAdmin) return;
        appData.questions = msg.questions;
        saveData(appData);
        sendToWs(ws, { type: 'admin_saved', msg: 'Perguntas salvas com sucesso!' });
        break;
      }

      // ─── ADMIN: Save settings ───
      case 'admin_save_settings': {
        if (!ws.isAdmin) return;
        appData.settings = { ...appData.settings, ...msg.settings };
        saveData(appData);
        sendToWs(ws, { type: 'admin_saved', msg: 'Configurações salvas!' });
        break;
      }

      // ─── ADMIN: Clear ranking ───
      case 'admin_clear_ranking': {
        if (!ws.isAdmin) return;
        appData.ranking = [];
        saveData(appData);
        sendToWs(ws, { type: 'admin_saved', msg: 'Ranking limpo!' });
        break;
      }

      // ─── ADMIN: Get live stats ───
      case 'admin_get_stats': {
        if (!ws.isAdmin) return;
        sendToWs(ws, {
          type: 'admin_stats',
          activeGames: games.size,
          activePlayers: [...games.values()].reduce((s, g) => s + g.players.size, 0),
          totalQuestions: appData.questions.length,
          totalRanking: appData.ranking.length,
        });
        break;
      }
    }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

// ═══════════════════════════════════════════════════════
// REST API (for admin panel)
// ═══════════════════════════════════════════════════════
app.get('/api/ranking', (req, res) => {
  res.json(appData.ranking.slice(0, 20));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, games: games.size, questions: appData.questions.length });
});

// ═══════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐑 Quiz Bíblico rodando na porta ${PORT}`);
  console.log(`📖 ${appData.questions.length} perguntas carregadas`);
  console.log(`🔐 Senha admin: ${appData.settings.adminPassword || 'admin123'}`);
});

// ═══════════════════════════════════════════════════════
// DEFAULT DATA
// ═══════════════════════════════════════════════════════
function getDefaultSettings() {
  return { adminPassword: 'admin123', gameName: 'Quiz Bíblico', maxPlayers: 30 };
}

function getDefaultQuestions() {
  return [
    { id:1, q:"Quantos livros tem a Bíblia?", a:["66","68","86","76"], correct:0, cat:"ot", icon:"📜", diff:"facil", explanation:"A Bíblia tem 66 livros: 39 no AT e 27 no NT." },
    { id:2, q:"Quem construiu a Arca para salvar sua família do dilúvio?", a:["Moisés","Abraão","Noé","Elias"], correct:2, cat:"ot", icon:"🚢", diff:"facil", explanation:"Noé construiu a arca por ordem de Deus (Gênesis 6)." },
    { id:3, q:"Quem foi o primeiro homem criado por Deus?", a:["Abel","Caim","Noé","Adão"], correct:3, cat:"personagens", icon:"🧑", diff:"facil", explanation:"Adão foi o primeiro homem, criado do pó da terra (Gênesis 2:7)." },
    { id:4, q:"Em qual monte Moisés recebeu os Dez Mandamentos?", a:["Monte Sião","Monte Sinai","Monte Carmelo","Monte Oliveiras"], correct:1, cat:"ot", icon:"⛰️", diff:"facil", explanation:"Deus falou com Moisés no Monte Sinai (Êxodo 19-20)." },
    { id:5, q:"Com que Davi matou o gigante Golias?", a:["Espada","Lança","Funda e pedra","Arco e flecha"], correct:2, cat:"personagens", icon:"🪨", diff:"facil", explanation:"Davi usou uma funda e uma pedra para derrubar Golias (1 Samuel 17:50)." },
    { id:6, q:"Qual era o nome da mãe de Jesus?", a:["Marta","Miriam","Maria","Raquel"], correct:2, cat:"nt", diff:"facil", explanation:"Maria, escolhida por Deus para ser a mãe de Jesus (Lucas 1:30-31)." },
    { id:7, q:"Quem batizou Jesus no rio Jordão?", a:["Pedro","Paulo","João Batista","André"], correct:2, cat:"nt", icon:"💧", diff:"facil", explanation:"João Batista batizou Jesus no rio Jordão (Mateus 3:13-17)." },
    { id:8, q:"Qual apóstolo negou Jesus três vezes?", a:["João","Judas","Tomé","Pedro"], correct:3, cat:"nt", icon:"🐓", diff:"facil", explanation:"Pedro negou conhecer Jesus três vezes antes do galo cantar (Lucas 22:61)." },
    { id:9, q:"Em que cidade Jesus nasceu?", a:["Nazaré","Jerusalém","Belém","Jericó"], correct:2, cat:"nt", icon:"⭐", diff:"facil", explanation:"Jesus nasceu em Belém de Judá, conforme a profecia (Miquéias 5:2)." },
    { id:10, q:"Quem interpretou os sonhos do faraó?", a:["Moisés","Davi","José","Samuel"], correct:2, cat:"personagens", icon:"💭", diff:"facil", explanation:"José interpretou os sonhos do faraó sobre 7 vacas gordas e 7 magras (Gênesis 41)." },
    { id:11, q:"Qual foi o primeiro milagre de Jesus?", a:["Curar um cego","Ressuscitar Lázaro","Transformar água em vinho","Andar sobre as águas"], correct:2, cat:"milagres", icon:"🍷", diff:"facil", explanation:"Em Caná da Galileia, Jesus transformou água em vinho (João 2:1-11)." },
    { id:12, q:"Quantos pães Jesus usou para alimentar 5000 pessoas?", a:["2","3","5","7"], correct:2, cat:"milagres", icon:"🍞", diff:"facil", explanation:"Jesus usou 5 pães e 2 peixes para alimentar mais de 5000 pessoas (João 6:9-11)." },
    { id:13, q:"Quem foi o rei mais sábio de Israel?", a:["Davi","Saul","Salomão","Roboão"], correct:2, cat:"personagens", icon:"👑", diff:"facil", explanation:"Salomão pediu sabedoria a Deus e foi o rei mais sábio de Israel (1 Reis 3:12)." },
    { id:14, q:"Qual discípulo andou sobre as águas com Jesus?", a:["João","Tiago","Paulo","Pedro"], correct:3, cat:"milagres", icon:"🌊", diff:"medio", explanation:"Pedro caminhou sobre as águas até começar a duvidar (Mateus 14:29-30)." },
    { id:15, q:"Qual apóstolo era médico?", a:["Lucas","João","Marcos","Tiago"], correct:0, cat:"nt", icon:"⚕️", diff:"medio", explanation:"Lucas era médico e escreveu o Evangelho de Lucas e os Atos dos Apóstolos." },
    { id:16, q:"Qual foi o nome do anjo que anunciou o nascimento de Jesus a Maria?", a:["Miguel","Rafael","Gabriel","Uriel"], correct:2, cat:"nt", icon:"👼", diff:"facil", explanation:"O anjo Gabriel foi enviado por Deus a Maria (Lucas 1:26-27)." },
    { id:17, q:"Qual é a profissão de Mateus antes de seguir Jesus?", a:["Pescador","Cobrador de impostos","Carpinteiro","Médico"], correct:1, cat:"nt", icon:"💰", diff:"medio", explanation:"Mateus (Levi) era publicano, cobrador de impostos (Mateus 9:9)." },
    { id:18, q:"Quantas tribos tinha Israel?", a:["10","12","14","16"], correct:1, cat:"ot", icon:"🇮🇱", diff:"medio", explanation:"Israel tinha 12 tribos, descendentes dos 12 filhos de Jacó." },
    { id:19, q:"Qual profeta foi engolido por um grande peixe?", a:["Jonas","Amós","Oséias","Joel"], correct:0, cat:"personagens", icon:"🐋", diff:"facil", explanation:"Jonas ficou 3 dias no ventre de um grande peixe (Jonas 1:17)." },
    { id:20, q:"Qual dos discípulos traiu Jesus por 30 moedas de prata?", a:["Tomé","Bartolomeu","Judas Iscariotes","Simão"], correct:2, cat:"nt", icon:"🪙", diff:"facil", explanation:"Judas Iscariotes entregou Jesus por 30 moedas de prata (Mateus 26:15)." },
    { id:21, q:"Quantos dias Jesus ficou no deserto sendo tentado?", a:["20","30","40","50"], correct:2, cat:"nt", icon:"🏜️", diff:"facil", explanation:"Jesus passou 40 dias e 40 noites no deserto, sendo tentado pelo diabo (Mateus 4:2)." },
    { id:22, q:"Quantos salmos tem o livro dos Salmos?", a:["100","120","150","200"], correct:2, cat:"ot", icon:"🎵", diff:"medio", explanation:"O livro dos Salmos possui 150 salmos, muitos atribuídos ao rei Davi." },
    { id:23, q:"Qual animal falou com Balaão?", a:["Leão","Jumento","Serpente","Corvo"], correct:1, cat:"ot", icon:"🐴", diff:"medio", explanation:"O jumento de Balaão falou por milagre de Deus (Números 22:28)." },
    { id:24, q:"Onde Jesus foi crucificado?", a:["Getsêmani","Gólgota","Betânia","Jericó"], correct:1, cat:"nt", diff:"medio", explanation:"Jesus foi crucificado no Gólgota, que significa 'Lugar da Caveira' (João 19:17)." },
    { id:25, q:"Qual é o versículo mais curto da Bíblia?", a:["João 3:16","João 11:35","Salmos 23:1","Filipenses 4:4"], correct:1, cat:"ot", icon:"📝", diff:"dificil", explanation:"'Jesus chorou' (João 11:35) é o versículo mais curto da Bíblia em português." },
    { id:26, q:"Quem construiu o templo de Jerusalém?", a:["Davi","Salomão","Josafá","Ezequias"], correct:1, cat:"personagens", icon:"🏛️", diff:"medio", explanation:"Salomão construiu o primeiro Templo de Jerusalém (1 Reis 6)." },
    { id:27, q:"Quantos anos Noé tinha quando entrou na arca?", a:["300","500","600","700"], correct:2, cat:"ot", icon:"👴", diff:"dificil", explanation:"Noé tinha 600 anos quando as águas do dilúvio vieram sobre a terra (Gênesis 7:6)." },
    { id:28, q:"Qual era o nome hebraico de Daniel em Babilônia?", a:["Beltessazar","Sadraque","Mesaque","Abede-Nego"], correct:0, cat:"personagens", icon:"🦁", diff:"dificil", explanation:"Daniel recebeu o nome babilônico de Beltessazar (Daniel 1:7)." },
    { id:29, q:"Em qual monte Elias desafiou os profetas de Baal?", a:["Sinai","Sião","Carmelo","Nebo"], correct:2, cat:"ot", icon:"🔥", diff:"dificil", explanation:"O desafio aconteceu no Monte Carmelo, onde fogo do céu consumiu o sacrifício (1 Reis 18)." },
    { id:30, q:"Qual era o nome da esposa de Abraão?", a:["Rebeca","Sara","Raquel","Lia"], correct:1, cat:"personagens", icon:"👩", diff:"facil", explanation:"Sara foi a esposa de Abraão e mãe de Isaque (Gênesis 17:15)." },
  ];
}
