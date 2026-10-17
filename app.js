const lobbyView = document.querySelector('#lobby-view');
const gameView = document.querySelector('#game-view');
const lobbyMessage = document.querySelector('#lobby-message');
const gameMessage = document.querySelector('#game-message');
const boardElement = document.querySelector('#chessboard');
const toastElement = document.querySelector('#toast');
const files = 'abcdefgh';
const firebaseConfig = {
  apiKey: 'AIzaSyBWM3rDPOYcRyJk3AICKBJsap67AezzLho',
  authDomain: 'cart-4b943.firebaseapp.com',
  databaseURL: 'https://cart-4b943-default-rtdb.firebaseio.com/',
  projectId: 'cart-4b943',
  appId: '1:617978024038:web:c0e8de246d016f6c7a5da7',
};
const publicRoomMaxAge = 10 * 60 * 1000;
const initialRating = 200;
const previousInitialRating = 1200;
const eloKFactor = 32;
const minimumRating = 100;
const maximumBotRating = 2500;
const pieceValues = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
let peer = null;
let connection = null;
let game = new Chess();
let role = null;
let roomCode = '';
let playerName = '';
let opponentName = 'Waiting for opponent';
let playerRating = initialRating;
let opponentRating = initialRating;
let ratingRecorded = false;
let accountUsername = '';
let accountMode = 'signin';
let accountBusy = false;
let accountProfileReady = false;
let firebaseAuthStateReady = false;
let publicGamesListenerAttached = false;
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let whiteSeconds = 600;
let blackSeconds = 600;
let clockTimer = null;
let toastTimer = null;
let gameFinished = false;
let publicRoom = false;
let aiThinking = false;
let aiMoveTimer = null;
let botRating = initialRating;
let pendingPromotionMoves = [];
let firebaseUser = null;
let publicRoomRef = null;
let publicGamesSnapshot = null;

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 2200);
}

function setLobbyMessage(message, isError = true) {
  lobbyMessage.textContent = message;
  lobbyMessage.style.color = isError ? '#a3483d' : '#54735e';
}

function showGame() {
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  updateAccountButton(firebaseUser);
  document.querySelector('#topbar-context').textContent = role === 'ai' ? 'Play against computer' : 'Friend match';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function accountReadyForGame() {
  if (typeof firebase !== 'undefined' && firebase.apps.length && !firebaseAuthStateReady) {
    showToast('Your account is still loading. Please try again in a moment.');
    return false;
  }
  if (firebaseUser && !firebaseUser.isAnonymous && !accountProfileReady) {
    showToast('Your account is still loading. Please try again in a moment.');
    return false;
  }
  return true;
}

function normalizeName(input, fallback) {
  return input.trim().slice(0, 18) || fallback;
}

function ratingStorageKey(name) {
  return `openboard.elo.${encodeURIComponent(name.trim().toLowerCase())}`;
}

function readPlayerRating(name) {
  try {
    const storedRating = localStorage.getItem(ratingStorageKey(name));
    if (storedRating === null) return initialRating;
    const rating = Number(storedRating);
    if (rating === previousInitialRating) {
      localStorage.setItem(ratingStorageKey(name), String(initialRating));
      return initialRating;
    }
    if (Number.isInteger(rating) && rating >= minimumRating && rating <= 5000) return rating;
    console.warn('Ignoring invalid saved Elo rating.');
  } catch (error) {
    console.error('Could not read the saved Elo rating:', error);
  }
  return initialRating;
}

function savePlayerRating(name, rating) {
  try {
    localStorage.setItem(ratingStorageKey(name), String(rating));
    if (firebaseUser && !firebaseUser.isAnonymous) {
      firebase.database().ref(`users/${firebaseUser.uid}/rating`).set(rating).catch(error => {
        console.error('Could not save the account Elo rating:', error);
        showToast('Could not sync your rating to your account');
      });
    }
    return true;
  } catch (error) {
    console.error('Could not save the Elo rating:', error);
    showToast('Could not save your rating on this device');
    return false;
  }
}

function setAccountMode(mode) {
  accountMode = mode;
  const signingIn = mode === 'signin';
  const signingUp = mode === 'signup';
  document.querySelector('#account-title').textContent = signingUp ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in to Openboard';
  document.querySelector('#account-description').textContent = signingUp
    ? 'Your username and rating will be saved with your account.'
    : mode === 'reset'
      ? 'Enter the recovery email linked to your account.'
      : 'Sign in to keep your rating with your account.';
  document.querySelector('#account-username-label').classList.toggle('hidden', mode === 'reset');
  document.querySelector('#account-username-label').textContent = 'Username';
  document.querySelector('#account-username').classList.toggle('hidden', mode === 'reset');
  document.querySelector('#account-username').required = mode !== 'reset';
  document.querySelector('#account-email-group').classList.toggle('hidden', signingIn);
  document.querySelector('#account-email').required = !signingIn;
  document.querySelector('#account-password-group').classList.toggle('hidden', mode === 'reset');
  document.querySelector('#account-password').required = mode !== 'reset';
  document.querySelector('#account-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  document.querySelector('#account-submit').textContent = signingUp ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in';
  document.querySelector('#account-switch-mode').classList.toggle('hidden', mode === 'reset');
  document.querySelector('#account-switch-mode').textContent = signingUp ? 'Already have an account? Sign in' : 'Create an account';
  document.querySelector('#account-forgot-password').classList.toggle('hidden', !signingIn);
  document.querySelector('#account-message').textContent = '';
  document.querySelector('#account-message').classList.remove('success');
}

function showAccountDialog(mode = 'signin') {
  setAccountMode(mode);
  document.querySelector('#account-dialog').classList.remove('hidden');
  document.querySelector(mode === 'reset' ? '#account-email' : '#account-username').focus();
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    setAccountMessage('Account sign-in needs Firebase setup. See firebase-setup.md.');
  }
}

function setAccountMessage(message, isSuccess = false) {
  const status = document.querySelector('#account-message');
  status.textContent = message;
  status.classList.toggle('success', isSuccess);
}

function updateAccountButton(user) {
  const button = document.querySelector('#account-button');
  const signedIn = user && !user.isAnonymous;
  button.disabled = role !== null && !gameFinished;
  button.title = button.disabled ? 'Leave or finish your game before changing accounts.' : '';
  button.textContent = signedIn ? 'Sign out' : 'Sign in';
  button.setAttribute('aria-label', signedIn ? `Sign out ${accountUsername}` : 'Sign in or create an account');
  document.querySelector('#player-name-label').textContent = signedIn ? accountUsername : playerName || 'Guest player';
}

async function handleFirebaseAuthState(user) {
  firebaseAuthStateReady = true;
  firebaseUser = user;
  accountProfileReady = false;
  updateAccountButton(user);
  if (!user) {
    accountUsername = '';
    firebase.auth().signInAnonymously().catch(error => {
      console.error('Could not start an anonymous session:', error);
      setPublicGamesStatus(`Could not connect to Firebase: ${error.message || 'Authentication failed.'}`, true);
    });
    return;
  }

  if (user.isAnonymous) {
    accountUsername = '';
    accountProfileReady = true;
    if (role === null) {
      playerRating = readPlayerRating(document.querySelector('#host-name').value || 'Player 1');
      document.querySelector('#host-name').readOnly = false;
      document.querySelector('#join-name').readOnly = false;
      setProfileRating();
      updateAccountButton(user);
    }
  } else {
    try {
      await loadAccountProfile(user);
    } catch (error) {
      console.error('Could not load the account profile:', error);
      showToast(error.message || 'Could not load your account profile');
    }
  }

  if (!publicGamesListenerAttached) {
    publicGamesListenerAttached = true;
    firebase.database().ref('publicGames').on('value', renderPublicGames, error => {
      console.error('Could not read public games:', error);
      setPublicGamesStatus(`Could not load public games: ${error.message}`, true);
    });
  }
}

async function loadAccountProfile(user) {
  const profileSnapshot = await firebase.database().ref(`users/${user.uid}`).once('value');
  const profile = profileSnapshot.val();
  if (!profile || typeof profile.username !== 'string' || !Number.isInteger(profile.rating) || profile.rating < minimumRating || profile.rating > 5000) {
    throw new Error('Your account profile could not be loaded. Please try signing in again.');
  }
  accountUsername = profile.username;
  accountProfileReady = true;
  if (role === null) {
    playerName = accountUsername;
    playerRating = profile.rating;
    document.querySelector('#host-name').value = accountUsername;
    document.querySelector('#join-name').value = accountUsername;
    document.querySelector('#host-name').readOnly = true;
    document.querySelector('#join-name').readOnly = true;
    setProfileRating();
  }
  updateAccountButton(user);
}

async function submitAccountForm(event) {
  event.preventDefault();
  if (accountBusy) return;
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    setAccountMessage('Account sign-in needs Firebase setup. See firebase-setup.md.');
    return;
  }

  const username = document.querySelector('#account-username').value.trim();
  const email = document.querySelector('#account-email').value.trim();
  const password = document.querySelector('#account-password').value;
  const submit = document.querySelector('#account-submit');
  accountBusy = true;
  submit.disabled = true;
  setAccountMessage('');
  try {
    if (accountMode === 'reset') {
      await firebase.auth().sendPasswordResetEmail(email);
      setAccountMessage('If an account uses that email, a password reset link is on its way.', true);
      return;
    }
    if (accountMode === 'signup') {
      const result = await firebase.functions().httpsCallable('createUsernameAccount')({ username, email, password });
      accountUsername = result.data.username;
      const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
      await loadAccountProfile(credential.user);
      document.querySelector('#account-dialog').classList.add('hidden');
      showToast('Your account is ready');
      return;
    }
    const result = await firebase.functions().httpsCallable('signInWithUsername')({ username, password });
    accountUsername = result.data.username;
    const credential = await firebase.auth().signInWithCustomToken(result.data.token);
    await loadAccountProfile(credential.user);
    document.querySelector('#account-dialog').classList.add('hidden');
    showToast(`Signed in as ${accountUsername}`);
  } catch (error) {
    console.error('Account request failed:', error);
    if (accountMode === 'reset' && error.code === 'auth/user-not-found') {
      setAccountMessage('If an account uses that email, a password reset link is on its way.', true);
      return;
    }
    const message = error.code === 'functions/unauthenticated'
      ? 'Username or password is incorrect.'
      : error.message || 'Could not complete the account request.';
    setAccountMessage(message.replace(/^Firebase: /, ''));
  } finally {
    accountBusy = false;
    submit.disabled = false;
  }
}

function setProfileRating() {
  document.querySelector('#player-rating').textContent = String(playerRating);
}

function matchResult() {
  if (!game.in_checkmate()) return 'draw';
  return game.turn() === 'w' ? 'b' : 'w';
}

function finishRatedGame(result, message) {
  if (ratingRecorded || !['w', 'b', 'draw'].includes(result)) return;
  ratingRecorded = true;
  gameFinished = true;
  updateAccountButton(firebaseUser);
  window.clearInterval(clockTimer);
  window.clearTimeout(aiMoveTimer);
  aiMoveTimer = null;
  aiThinking = false;

  const playerColor = role === 'guest' ? 'b' : 'w';
  const score = result === 'draw' ? 0.5 : result === playerColor ? 1 : 0;
  const expectedScore = 1 / (1 + (10 ** ((opponentRating - playerRating) / 400)));
  const previousRating = playerRating;
  let ratingChange = Math.round(eloKFactor * (score - expectedScore));
  if (score === 0 && ratingChange === 0) ratingChange = -1;
  playerRating = Math.max(minimumRating, previousRating + ratingChange);
  savePlayerRating(playerName, playerRating);
  setProfileRating();
  setPlayers();
  renderBoard();

  const change = playerRating - previousRating;
  const changeText = change > 0 ? `+${change}` : String(change);
  setGameMessage(`${message} Elo ${previousRating} → ${playerRating} (${changeText}).`);
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, value => alphabet[value % alphabet.length]).join('');
}

function setPublicGamesStatus(message, isError = false) {
  const status = document.querySelector('#public-games-status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function renderPublicGames(snapshot) {
  publicGamesSnapshot = snapshot;
  const list = document.querySelector('#public-games-list');
  const count = document.querySelector('#public-games-count');
  const now = Date.now();
  const games = [];
  snapshot.forEach(child => {
    const entry = child.val();
    if (!entry || !/^[A-HJ-NP-Z2-9]{6}$/.test(entry.roomCode || '') || typeof entry.createdAt !== 'number') return;
    if (now - entry.createdAt > publicRoomMaxAge) return;
    games.push({ id: child.key, ...entry });
  });
  games.sort((a, b) => b.createdAt - a.createdAt);
  count.textContent = `${games.length} waiting`;
  list.replaceChildren();
  if (!games.length) {
    setPublicGamesStatus('No public games are waiting right now.');
    return;
  }

  games.forEach(entry => {
    const item = document.createElement('li');
    item.className = 'public-game-row';
    const details = document.createElement('div');
    details.className = 'public-game-details';
    const host = document.createElement('strong');
    host.textContent = entry.hostName || 'Player';
    const code = document.createElement('span');
    code.textContent = `Room ${entry.roomCode} · White`;
    details.append(host, code);
    const join = document.createElement('button');
    join.className = 'button button-secondary public-join-button';
    join.type = 'button';
    if (entry.id === firebaseUser?.uid) {
      join.textContent = 'Your game';
      join.disabled = true;
    } else {
      join.textContent = 'Join game';
      join.addEventListener('click', () => {
        document.querySelector('#room-code').value = entry.roomCode;
        document.querySelector('#join-button').click();
      });
    }
    item.append(details, join);
    list.append(item);
  });
  setPublicGamesStatus('Join a waiting player, or create a public game of your own.');
}

async function removePublicRoom() {
  const roomRef = publicRoomRef;
  publicRoomRef = null;
  if (!roomRef) return;
  try {
    await roomRef.onDisconnect().cancel();
    await roomRef.remove();
  } catch (error) {
    console.error('Could not remove public room listing:', error);
    setPublicGamesStatus('Could not remove your public listing. It will expire automatically.', true);
  }
}

async function publishPublicRoom() {
  if (!publicRoom || !firebaseUser) return;
  const roomRef = firebase.database().ref(`publicGames/${firebaseUser.uid}`);
  publicRoomRef = roomRef;
  try {
    await roomRef.onDisconnect().remove();
    await roomRef.set({
      roomCode,
      hostName: playerName,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    if (!publicRoom || role !== 'host' || connection?.open) {
      await roomRef.onDisconnect().cancel();
      await roomRef.remove();
      if (publicRoomRef === roomRef) publicRoomRef = null;
    }
  } catch (error) {
    console.error('Could not publish public room:', error);
    setGameMessage(`Could not list this game publicly: ${error.message || 'Firebase error'}`);
  }
}

async function initializePublicGames() {
  const requiredConfig = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
  if (requiredConfig.some(key => !firebaseConfig[key] || firebaseConfig[key].includes('YOUR_FIREBASE'))) {
    setPublicGamesStatus('Public games need Firebase setup. See firebase-setup.md.', true);
    return;
  }
  if (typeof firebase === 'undefined') {
    setPublicGamesStatus('Firebase could not load. Check your internet connection and refresh.', true);
    return;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(handleFirebaseAuthState, error => {
      console.error('Firebase authentication state failed:', error);
      setPublicGamesStatus(`Could not connect to Firebase: ${error.message || 'Authentication failed.'}`, true);
    });
    document.querySelector('#public-room').disabled = false;
    window.setInterval(() => {
      if (publicGamesSnapshot) renderPublicGames(publicGamesSnapshot);
    }, 30000);
  } catch (error) {
    console.error('Could not initialize public games:', error);
    setPublicGamesStatus(`Could not connect to Firebase: ${error.message || 'Check Firebase setup.'}`, true);
  }
}

function setGameMessage(message) {
  gameMessage.textContent = message;
}

function sendToOpponent(payload) {
  if (connection?.open) connection.send(payload);
}

function sendSnapshot() {
  sendToOpponent({ type: 'state', fen: game.fen(), history: game.history(), white: role === 'host' ? playerName : opponentName, black: role === 'host' ? opponentName : playerName });
}

function beginClock() {
  window.clearInterval(clockTimer);
  if (role === 'ai') {
    updateClocks();
    return;
  }
  clockTimer = window.setInterval(() => {
    if (gameFinished || !connection?.open) return;
    if (game.turn() === 'w') whiteSeconds = Math.max(0, whiteSeconds - 1);
    else blackSeconds = Math.max(0, blackSeconds - 1);
    updateClocks();
    if (!whiteSeconds || !blackSeconds) {
      const winner = whiteSeconds ? 'b' : 'w';
      const message = `${winner === 'w' ? 'White' : 'Black'} wins on time.`;
      sendToOpponent({ type: 'timeout', winner, message });
      finishRatedGame(winner, message);
    }
  }, 1000);
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateClocks() {
  const whiteIsTop = role === 'guest';
  const topClock = document.querySelector('#opponent-clock');
  const bottomClock = document.querySelector('#self-clock');
  const whiteTurn = game.turn() === 'w';
  topClock.textContent = formatTime(whiteIsTop ? whiteSeconds : blackSeconds);
  bottomClock.textContent = formatTime(whiteIsTop ? blackSeconds : whiteSeconds);
  topClock.classList.toggle('active-clock', whiteIsTop ? whiteTurn : !whiteTurn);
  bottomClock.classList.toggle('active-clock', whiteIsTop ? !whiteTurn : whiteTurn);
}

function updateActionButtons() {
  document.querySelector('#draw-button').disabled = role === 'ai' || !connection?.open || gameFinished || !isPlayerTurn();
  document.querySelector('#resign-button').disabled = (role !== 'ai' && !connection?.open) || gameFinished;
}

function statusText() {
  if (game.in_checkmate()) return `Checkmate. ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (game.in_draw()) return 'Draw game.';
  if (game.in_check()) return `${game.turn() === 'w' ? 'White' : 'Black'} is in check.`;
  if (gameFinished) return 'Game over.';
  return `${game.turn() === 'w' ? 'White' : 'Black'} to move.`;
}

function evaluatePosition() {
  const board = game.board();
  const remainingPieces = board.flat().filter(piece => piece && piece.type !== 'p' && piece.type !== 'k').length;
  let score = 0;
  const bishops = { w: 0, b: 0 };
  board.forEach((row, rank) => row.forEach((piece, file) => {
    if (!piece) return;
    const direction = piece.color === 'w' ? 1 : -1;
    const centerDistance = Math.abs(3.5 - file) + Math.abs(3.5 - rank);
    let value = pieceValues[piece.type];
    if (piece.type === 'p') value += (piece.color === 'w' ? 6 - rank : rank - 1) * 8 + (3.5 - Math.abs(3.5 - file)) * 3;
    if (piece.type === 'n' || piece.type === 'b') value += (7 - centerDistance) * (piece.type === 'n' ? 7 : 4);
    if (piece.type === 'r' && (piece.color === 'w' ? rank === 1 : rank === 6)) value += 14;
    if (piece.type === 'k' && centerDistance < 3 && remainingPieces > 6) value -= (3 - centerDistance) * 8;
    if (piece.type === 'b') bishops[piece.color] += 1;
    score += direction * value;
  }));
  if (bishops.w > 1) score += 28;
  if (bishops.b > 1) score -= 28;
  return score;
}

function moveOrderScore(move) {
  const capturedValue = move.captured ? pieceValues[move.captured] : 0;
  const movingValue = pieceValues[move.piece];
  const promotionValue = move.promotion ? pieceValues[move.promotion] : 0;
  return capturedValue * 10 - movingValue + promotionValue;
}

function evaluateForTurn() {
  const evaluation = evaluatePosition();
  return game.turn() === 'w' ? evaluation : -evaluation;
}

function isSearchDraw() {
  const fen = game.fen().split(' ');
  if (Number(fen[4]) >= 100) return true;
  const pieces = game.board().flat().filter(piece => piece && piece.type !== 'k');
  if (pieces.some(piece => ['p', 'r', 'q'].includes(piece.type))) return false;
  if (pieces.length <= 1) return true;
  if (pieces.every(piece => piece.type === 'b')) {
    const bishopSquareColors = [];
    game.board().forEach((row, rank) => row.forEach((piece, file) => {
      if (piece?.type === 'b') bishopSquareColors.push((rank + file) % 2);
    }));
    return bishopSquareColors.every(color => color === bishopSquareColors[0]);
  }
  return false;
}

function quiescenceSearch(alpha, beta, context, ply) {
  context.nodes += 1;
  const timeExpired = (context.nodes & 63) === 0 && performance.now() >= context.deadline;
  if (context.nodes >= context.maxNodes || timeExpired || ply >= 6) {
    context.stopped = context.nodes >= context.maxNodes || timeExpired;
    return evaluateForTurn();
  }
  if (isSearchDraw()) return 0;

  const inCheck = game.in_check();
  let bestScore = inCheck ? -Infinity : evaluateForTurn();
  if (!inCheck) {
    if (bestScore >= beta) return bestScore;
    alpha = Math.max(alpha, bestScore);
  }
  const allMoves = game.moves({ verbose: true });
  if (!allMoves.length) return inCheck ? -30000 + ply : 0;
  const moves = allMoves.filter(move => inCheck || move.captured || move.promotion)
    .sort((first, second) => moveOrderScore(second) - moveOrderScore(first));
  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -quiescenceSearch(-beta, -alpha, context, ply + 1);
    game.undo();
    if (score > bestScore) bestScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta || context.stopped) break;
  }
  return bestScore;
}

function searchPosition(depth, alpha, beta, context, ply = 0) {
  context.nodes += 1;
  if (context.nodes >= context.maxNodes || ((context.nodes & 63) === 0 && performance.now() >= context.deadline)) {
    context.stopped = true;
    return evaluateForTurn();
  }
  if (isSearchDraw()) return 0;
  if (depth <= 0) return quiescenceSearch(alpha, beta, context, 0);

  const moves = game.moves({ verbose: true }).sort((first, second) => moveOrderScore(second) - moveOrderScore(first));
  if (!moves.length) return game.in_check() ? -30000 + ply : 0;
  let bestScore = -Infinity;
  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -searchPosition(depth - 1, -beta, -alpha, context, ply + 1);
    game.undo();
    if (score > bestScore) bestScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta || context.stopped) break;
  }
  return bestScore;
}

function chooseComputerMove(rating) {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  const progress = Math.max(0, Math.min(1, (rating - 200) / (maximumBotRating - 200)));
  const blunderChance = 0.12 * ((1 - progress) ** 1.5);
  if (Math.random() < blunderChance) return moves[Math.floor(Math.random() * moves.length)];

  const maxDepth = rating < 400 ? 3 : rating < 700 ? 4 : rating < 1000 ? 5 : rating < 1300 ? 6 : rating < 1600 ? 7 : rating < 1900 ? 8 : rating < 2200 ? 9 : 10;
  const context = {
    nodes: 0,
    maxNodes: 6000 + Math.round((progress ** 1.5) * 34000),
    deadline: performance.now() + 250 + progress * 1250,
    stopped: false,
  };
  let bestMove = moves[Math.floor(Math.random() * moves.length)];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    context.stopped = false;
    let iterationBest = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const orderedMoves = [...moves].sort((first, second) => moveOrderScore(second) - moveOrderScore(first));
    for (const move of orderedMoves) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
      const score = -searchPosition(depth - 1, -Infinity, -alpha, context, 1);
      game.undo();
      if (score > bestScore) {
        bestScore = score;
        iterationBest = move;
      }
      alpha = Math.max(alpha, score);
      if (context.stopped) break;
    }
    if (context.stopped || !iterationBest) break;
    bestMove = iterationBest;
  }
  return bestMove;
}

function scheduleAIMove() {
  aiThinking = true;
  setGameMessage(`${opponentName} is thinking…`);
  updateActionButtons();
  aiMoveTimer = window.setTimeout(() => {
    aiMoveTimer = null;
    if (role !== 'ai' || gameFinished) return;
    const move = chooseComputerMove(botRating);
    aiThinking = false;
    if (!move) {
      finishRatedGame(matchResult(), statusText());
      return;
    }
    const playedMove = game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    if (!playedMove) {
      console.error('The computer selected an illegal move.');
      gameFinished = true;
      setGameMessage('The computer could not make a legal move. Please start a new game.');
      renderBoard();
      return;
    }
    lastMove = [playedMove.from, playedMove.to];
    selectedSquare = null;
    legalMoves = [];
    renderBoard(playedMove);
    if (game.game_over()) finishRatedGame(matchResult(), statusText());
  }, 3000);
}

function renderMoves() {
  const moveList = document.querySelector('#move-list');
  const history = game.history();
  document.querySelector('#move-count').textContent = `${history.length} ${history.length === 1 ? 'ply' : 'plies'}`;
  if (!history.length) {
    moveList.innerHTML = '<p class="empty-moves">Your game will show up here.</p>';
    return;
  }
  const rows = [];
  for (let index = 0; index < history.length; index += 2) {
    rows.push(`<div class="move-row"><span class="move-number">${Math.floor(index / 2) + 1}.</span><span class="move-san">${history[index]}</span><span class="move-san">${history[index + 1] || ''}</span></div>`);
  }
  moveList.innerHTML = rows.join('');
  moveList.scrollTop = moveList.scrollHeight;
}

function animateBoardMove(move) {
  const moves = [{ from: move.from, to: move.to }];
  if (move.flags?.includes('k') || move.flags?.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    moves.push(move.flags.includes('k')
      ? { from: `h${rank}`, to: `f${rank}` }
      : { from: `a${rank}`, to: `d${rank}` });
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  moves.forEach(({ from, to, capture }) => {
    const origin = boardElement.querySelector(`[data-square="${from}"]`);
    const destination = boardElement.querySelector(`[data-square="${to}"]`);
    const movingPiece = destination?.querySelector('.piece');
    if (!origin || !destination || !movingPiece) return;

    const originBounds = origin.getBoundingClientRect();
    const destinationBounds = destination.getBoundingClientRect();
    movingPiece.style.transition = 'none';
    movingPiece.style.transform = `translate(${originBounds.left - destinationBounds.left}px, ${originBounds.top - destinationBounds.top}px)`;
    movingPiece.style.zIndex = '3';
    movingPiece.getBoundingClientRect();

    window.requestAnimationFrame(() => {
      movingPiece.style.transition = 'transform 320ms cubic-bezier(.2, .8, .2, 1)';
      movingPiece.style.transform = '';
    });
    window.setTimeout(() => {
      movingPiece.style.transition = '';
      movingPiece.style.transform = '';
      movingPiece.style.zIndex = '';
    }, 360);
  });
}

function renderBoard(animatedMove = null) {
  const whiteAtBottom = role !== 'guest';
  const ranks = whiteAtBottom ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const boardFiles = whiteAtBottom ? files : [...files].reverse().join('');
  const checkedKing = game.in_check() ? game.board().flat().findIndex(piece => piece?.type === 'k' && piece.color === game.turn()) : -1;
  const boardRows = game.board();
  const markup = [];

  ranks.forEach((rank, rowIndex) => {
    [...boardFiles].forEach((file, fileIndex) => {
      const square = `${file}${rank}`;
      const boardRow = 8 - rank;
      const boardColumn = file.charCodeAt(0) - 97;
      const piece = boardRows[boardRow][boardColumn];
      const isLight = (rank + boardColumn) % 2 === 0;
      const isLastMove = lastMove?.includes(square);
      const isSelected = selectedSquare === square;
      const isLegalTarget = legalMoves.some(move => move.to === square);
      const isCheckedKing = checkedKing >= 0 && boardRow * 8 + boardColumn === checkedKing;
      const showRank = fileIndex === 0;
      const showFile = rowIndex === 7;
      const labels = `${showRank ? `<span class="coordinate">${rank}</span>` : ''}${showFile ? `<span class="coordinate file-coordinate">${file}</span>` : ''}`;
      const pieceMarkup = piece ? `<img class="piece" src="assets/pieces/${piece.color}${piece.type}.png" alt="" draggable="false" />` : '';
      const targetMarkup = isLegalTarget ? `<span class="${piece ? 'capture-ring' : 'legal-dot'}" aria-hidden="true"></span>` : '';
      markup.push(`<button class="square ${isLight ? 'light' : 'dark'}${isLastMove ? ' last-move' : ''}${isSelected ? ' selected' : ''}${isCheckedKing ? ' in-check' : ''}" data-square="${square}" role="gridcell" aria-label="${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}" ${!isPlayerTurn() || gameFinished ? 'disabled' : ''}>${pieceMarkup}${targetMarkup}${labels}</button>`);
    });
  });
  boardElement.innerHTML = markup.join('');
  if (animatedMove) animateBoardMove(animatedMove);
  renderMoves();
  updateClocks();
  updateActionButtons();
  if (aiThinking) setGameMessage(`${opponentName} is thinking…`);
  else if (connection?.open || role === 'ai') setGameMessage(statusText());
}

function setPlayers() {
  if (role === 'ai') {
    opponentName = `Computer`;
    document.querySelector('#opponent-name').textContent = opponentName;
    document.querySelector('#self-name').textContent = playerName;
    document.querySelector('#opponent-caption').textContent = `Black · ${botRating} Elo`;
    document.querySelector('#self-caption').textContent = `White · You · ${playerRating} Elo`;
    document.querySelector('#opponent-avatar').textContent = '♟';
    document.querySelector('#self-avatar').textContent = '♙';
    document.querySelector('#player-name-label').textContent = playerName;
    setProfileRating();
    document.querySelector('#game-title').textContent = `${playerName} vs Computer`;
    return;
  }
  const guestIsWhite = role === 'guest';
  const topName = guestIsWhite ? playerName : opponentName;
  const bottomName = guestIsWhite ? opponentName : playerName;
  const topRating = guestIsWhite ? playerRating : opponentRating;
  const bottomRating = guestIsWhite ? opponentRating : playerRating;
  document.querySelector('#opponent-name').textContent = topName;
  document.querySelector('#self-name').textContent = bottomName;
  document.querySelector('#opponent-caption').textContent = `${guestIsWhite ? 'White' : 'Black'} · ${topRating} Elo`;
  document.querySelector('#self-caption').textContent = `${guestIsWhite ? 'Black' : 'White'} · You · ${bottomRating} Elo`;
  document.querySelector('#opponent-avatar').textContent = guestIsWhite ? '♙' : '♟';
  document.querySelector('#self-avatar').textContent = guestIsWhite ? '♟' : '♙';
  document.querySelector('#player-name-label').textContent = playerName;
  setProfileRating();
  document.querySelector('#game-title').textContent = `${playerName} vs ${opponentName}`;
}

function handleMove(square) {
  if (gameFinished || !isPlayerTurn()) {
    setGameMessage('It is your opponent’s turn.');
    return;
  }
  const destinationMoves = legalMoves.filter(move => move.to === square);
  if (selectedSquare && destinationMoves.length) {
    if (destinationMoves.some(move => move.promotion)) {
      showPromotionOptions(destinationMoves);
      return;
    }
    completePlayerMove(destinationMoves[0]);
    return;
  }
  const piece = game.get(square);
  const color = role === 'guest' ? 'b' : 'w';
  if (piece?.color === color) {
    selectedSquare = square;
    legalMoves = game.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalMoves = [];
  }
  renderBoard();
}

function showPromotionOptions(moves) {
  pendingPromotionMoves = moves;
  const color = moves[0].color;
  const symbols = color === 'w' ? { q: '♕', r: '♖', b: '♗', n: '♘' } : { q: '♛', r: '♜', b: '♝', n: '♞' };
  const options = document.querySelector('#promotion-options');
  options.innerHTML = ['q', 'r', 'b', 'n'].map(type => {
    const pieceNames = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
    return `<button class="promotion-choice ${color === 'w' ? 'promotion-white' : 'promotion-black'}" type="button" data-promotion="${type}" aria-label="Promote to ${pieceNames[type]}">${symbols[type]}</button>`;
  }).join('');
  document.querySelector('#promotion-dialog').classList.remove('hidden');
  options.querySelector('button')?.focus();
}

function closePromotionOptions() {
  pendingPromotionMoves = [];
  document.querySelector('#promotion-dialog').classList.add('hidden');
  selectedSquare = null;
  legalMoves = [];
  renderBoard();
}

function completePlayerMove(selectedMove) {
  const move = game.move({ from: selectedMove.from, to: selectedMove.to, promotion: selectedMove.promotion });
  if (!move) {
    console.error('The selected legal chess move could not be applied.');
    setGameMessage('That move could not be played. Please select it again.');
    selectedSquare = null;
    legalMoves = [];
    renderBoard();
    return;
  }

  lastMove = [move.from, move.to];
  if (role === 'guest') sendToOpponent({ type: 'move', san: move.san });
  else if (role === 'host') sendSnapshot();
  selectedSquare = null;
  legalMoves = [];
  renderBoard(move);
  if (game.game_over()) {
    const result = matchResult();
    const message = statusText();
    if (role !== 'ai') sendToOpponent({ type: 'finished', result, message });
    finishRatedGame(result, message);
  } else if (role === 'ai') {
    scheduleAIMove();
  }
}

function isPlayerTurn() {
  if (role === 'ai') return game.turn() === 'w' && !aiThinking;
  return connection?.open && ((role === 'host' && game.turn() === 'w') || (role === 'guest' && game.turn() === 'b'));
}

function setConnectedState(name) {
  opponentName = name || 'Friend';
  document.querySelector('#room-status').textContent = 'Opponent connected';
  document.querySelector('#room-hint').textContent = 'Your game is ready. White moves first.';
  setPlayers();
  document.querySelector('#draw-button').disabled = false;
  document.querySelector('#resign-button').disabled = false;
  if (role === 'host') {
    publicRoom = false;
    removePublicRoom();
  }
  if (role === 'host') sendSnapshot();
  beginClock();
  renderBoard();
  showToast(`${opponentName} joined the room`);
}

function handleHostMessage(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'hello') {
    if (Number.isInteger(data.rating) && data.rating >= minimumRating && data.rating <= 5000) opponentRating = data.rating;
    setConnectedState(String(data.name || 'Friend').slice(0, 18));
    return;
  }
  if (data.type === 'move') {
    const move = game.move(data.san, { sloppy: true });
    if (!move) {
      sendSnapshot();
      return;
    }
    lastMove = [move.from, move.to];
    sendSnapshot();
    renderBoard(move);
    if (game.game_over()) {
      const result = matchResult();
      const message = statusText();
      sendToOpponent({ type: 'finished', result, message });
      finishRatedGame(result, message);
    }
    return;
  }
  if (data.type === 'draw') {
    const accepted = window.confirm(`${opponentName} offers a draw. Accept?`);
    if (accepted) {
      sendToOpponent({ type: 'draw-accepted' });
      finishRatedGame('draw', 'Draw agreed.');
    } else sendToOpponent({ type: 'draw-declined' });
    return;
  }
  if (data.type === 'draw-accepted') {
    finishRatedGame('draw', 'Draw agreed.');
    return;
  }
  if (data.type === 'draw-declined') {
    showToast('Draw offer declined');
    return;
  }
  if (data.type === 'resign') {
    const result = data.winner === 'w' || data.winner === 'b' ? data.winner : role === 'host' ? 'w' : 'b';
    finishRatedGame(result, data.message || `${opponentName} resigned. You win!`);
    return;
  }
  if (data.type === 'timeout') {
    if (data.winner === 'w' || data.winner === 'b') {
      finishRatedGame(data.winner, data.message || `${data.winner === 'w' ? 'White' : 'Black'} wins on time.`);
    }
  }
}

function handleGuestMessage(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'hello') {
    if (Number.isInteger(data.rating) && data.rating >= minimumRating && data.rating <= 5000) opponentRating = data.rating;
    setPlayers();
    return;
  }
  if (data.type === 'state') {
    const previousFen = game.fen();
    game.load(data.fen);
    const history = game.history();
    let animatedMove = null;
    if (history.length) {
      const previousGame = new Chess();
      history.slice(0, -1).forEach(san => previousGame.move(san));
      const last = history.at(-1);
      animatedMove = previousGame.move(last);
      if (animatedMove) lastMove = [animatedMove.from, animatedMove.to];
    } else lastMove = null;
    if (data.white && data.black) {
      opponentName = role === 'guest' ? data.white : data.black;
      setPlayers();
    }
    if (previousFen !== game.fen()) {
      if (!clockTimer) beginClock();
      renderBoard(animatedMove);
    }
    return;
  }
  if (data.type === 'draw') {
    const accepted = window.confirm(`${opponentName} offers a draw. Accept?`);
    if (accepted) {
      sendToOpponent({ type: 'draw-accepted' });
      finishRatedGame('draw', 'Draw agreed.');
    } else sendToOpponent({ type: 'draw-declined' });
    return;
  }
  if (data.type === 'draw-accepted') {
    finishRatedGame('draw', 'Draw agreed.');
    return;
  }
  if (data.type === 'draw-declined') {
    showToast('Draw offer declined');
    return;
  }
  if (data.type === 'finished') {
    if (data.result === 'w' || data.result === 'b' || data.result === 'draw') {
      finishRatedGame(data.result, data.message || 'Game over.');
    } else {
      gameFinished = true;
      setGameMessage(data.message || 'Game over.');
      renderBoard();
    }
    return;
  }
  if (data.type === 'resign') {
    const result = data.winner === 'w' || data.winner === 'b' ? data.winner : role === 'host' ? 'b' : 'w';
    finishRatedGame(result, data.message || `${opponentName} resigned. You win!`);
    return;
  }
  if (data.type === 'timeout') {
    if (data.winner === 'w' || data.winner === 'b') {
      finishRatedGame(data.winner, data.message || `${data.winner === 'w' ? 'White' : 'Black'} wins on time.`);
    }
  }
}

function bindConnection(conn) {
  connection = conn;
  conn.on('open', () => {
    conn.send({ type: 'hello', name: playerName, rating: playerRating });
  });
  conn.on('data', data => role === 'host' ? handleHostMessage(data) : handleGuestMessage(data));
  conn.on('close', () => {
    window.clearInterval(clockTimer);
    gameFinished = true;
    updateAccountButton(firebaseUser);
    setGameMessage('Your opponent disconnected. You can leave this game and start another.');
    document.querySelector('#room-status').textContent = 'Opponent disconnected';
    renderBoard();
  });
  conn.on('error', error => setGameMessage(error.message || 'Connection interrupted.'));
}

function resetGame() {
  window.clearInterval(clockTimer);
  window.clearTimeout(aiMoveTimer);
  aiMoveTimer = null;
  document.querySelector('#promotion-dialog').classList.add('hidden');
  document.querySelector('#promotion-options').replaceChildren();
  removePublicRoom();
  peer?.destroy();
  peer = null;
  connection = null;
  game = new Chess();
  role = null;
  roomCode = '';
  ratingRecorded = false;
  selectedSquare = null;
  legalMoves = [];
  lastMove = null;
  whiteSeconds = 600;
  blackSeconds = 600;
  gameFinished = false;
  publicRoom = false;
  aiThinking = false;
  pendingPromotionMoves = [];
  botRating = initialRating;
  opponentName = 'Waiting for opponent';
  gameView.classList.remove('ai-game');
  document.querySelector('#public-room').checked = false;
  lobbyView.classList.remove('hidden');
  gameView.classList.add('hidden');
  document.querySelector('#topbar-context').textContent = 'Play a friend';
  document.querySelector('#draw-button').disabled = true;
  document.querySelector('#resign-button').disabled = true;
  updateAccountButton(firebaseUser);
  setLobbyMessage('');
}

document.querySelector('#ai-rating').addEventListener('input', event => {
  document.querySelector('#ai-rating-value').textContent = `${event.target.value} Elo`;
});

document.querySelector('#account-button').addEventListener('click', async () => {
  if (firebaseUser && !firebaseUser.isAnonymous) {
    try {
      await firebase.auth().signOut();
      showToast('Signed out');
    } catch (error) {
      console.error('Could not sign out:', error);
      showToast(`Could not sign out: ${error.message || 'Firebase error'}`);
    }
    return;
  }
  showAccountDialog();
});

document.querySelector('#account-form').addEventListener('submit', submitAccountForm);
document.querySelector('#account-switch-mode').addEventListener('click', () => {
  setAccountMode(accountMode === 'signup' ? 'signin' : 'signup');
});
document.querySelector('#account-forgot-password').addEventListener('click', () => setAccountMode('reset'));
document.querySelector('#account-cancel').addEventListener('click', () => {
  document.querySelector('#account-dialog').classList.add('hidden');
});
document.querySelector('#account-dialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) document.querySelector('#account-dialog').classList.add('hidden');
});
document.querySelector('#account-username').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 18);
});

document.querySelector('#promotion-options').addEventListener('click', event => {
  const choice = event.target.closest('[data-promotion]');
  if (!choice) return;
  const move = pendingPromotionMoves.find(candidate => candidate.promotion === choice.dataset.promotion);
  if (!move) {
    console.error('The selected promotion is not a legal move.');
    closePromotionOptions();
    return;
  }
  document.querySelector('#promotion-dialog').classList.add('hidden');
  pendingPromotionMoves = [];
  completePlayerMove(move);
});

document.querySelector('#promotion-cancel').addEventListener('click', closePromotionOptions);
document.querySelector('#promotion-dialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) closePromotionOptions();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelector('#account-dialog').classList.add('hidden');
  if (event.key === 'Escape' && !document.querySelector('#promotion-dialog').classList.contains('hidden')) {
    closePromotionOptions();
  }
});

document.querySelector('#ai-button').addEventListener('click', () => {
  if (!accountReadyForGame()) return;
  if (typeof Chess === 'undefined') {
    setLobbyMessage('Could not load the chess library. Check your internet connection and refresh.');
    return;
  }
  resetGame();
  playerName = accountUsername || normalizeName(document.querySelector('#host-name').value, 'Player 1');
  if (!accountUsername) playerRating = readPlayerRating(playerName);
  botRating = Math.max(initialRating, Math.min(maximumBotRating, Number(document.querySelector('#ai-rating').value)));
  opponentRating = botRating;
  opponentName = 'Computer';
  ratingRecorded = false;
  role = 'ai';
  document.querySelector('#game-view').classList.add('ai-game');
  document.querySelector('#room-status').textContent = 'Playing computer';
  document.querySelector('#room-hint').textContent = `Computer strength: ${botRating} Elo. You play White.`;
  document.querySelector('#active-room-code').textContent = '';
  document.querySelector('#player-name-label').textContent = playerName;
  document.querySelector('#draw-button').disabled = true;
  setPlayers();
  setLobbyMessage('');
  showGame();
  renderBoard();
});

document.querySelector('#host-button').addEventListener('click', () => {
  if (!accountReadyForGame()) return;
  if (typeof Peer === 'undefined' || typeof Chess === 'undefined') {
    setLobbyMessage('Could not load the chess or connection library. Check your internet connection and refresh.');
    return;
  }
  publicRoom = document.querySelector('#public-room').checked;
  if (publicRoom && !firebaseUser) {
    setLobbyMessage('Public games are unavailable until Firebase is configured.');
    return;
  }
  playerName = accountUsername || normalizeName(document.querySelector('#host-name').value, 'Player 1');
  playerRating = accountUsername ? playerRating : readPlayerRating(playerName);
  opponentRating = initialRating;
  ratingRecorded = false;
  setProfileRating();
  opponentName = 'Waiting for opponent';
  role = 'host';
  roomCode = createRoomCode();
  peer = new Peer(roomCode);
  document.querySelector('#active-room-code').textContent = roomCode;
  document.querySelector('#room-status').textContent = 'Creating room…';
  document.querySelector('#room-hint').textContent = 'Keep this page open while your friend joins.';
  document.querySelector('#opponent-name').textContent = opponentName;
  document.querySelector('#opponent-caption').textContent = 'Share your room code';
  document.querySelector('#self-name').textContent = playerName;
  document.querySelector('#self-caption').textContent = 'White · You';
  document.querySelector('#player-name-label').textContent = playerName;
  document.querySelector('#game-title').textContent = 'Waiting for a friend';
  setLobbyMessage('');
  showGame();
  peer.on('open', () => {
    document.querySelector('#room-status').textContent = 'Waiting for a friend';
    setGameMessage('Share the room code with your opponent.');
    renderBoard();
    publishPublicRoom();
  });
  peer.on('connection', bindConnection);
  peer.on('error', error => {
    if (error.type === 'unavailable-id') {
      resetGame();
      setLobbyMessage('That room code was already taken. Please create a new room.');
    } else setGameMessage(`Connection error: ${error.message || error.type}`);
  });
});

document.querySelector('#join-button').addEventListener('click', () => {
  if (!accountReadyForGame()) return;
  if (typeof Peer === 'undefined' || typeof Chess === 'undefined') {
    setLobbyMessage('Could not load the chess or connection library. Check your internet connection and refresh.');
    return;
  }
  const code = document.querySelector('#room-code').value.trim().toUpperCase();
  if (code.length !== 6 || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    setLobbyMessage('Enter the 6-character room code from your friend.');
    document.querySelector('#room-code').focus();
    return;
  }
  playerName = accountUsername || normalizeName(document.querySelector('#join-name').value, 'Player 2');
  playerRating = accountUsername ? playerRating : readPlayerRating(playerName);
  opponentRating = initialRating;
  ratingRecorded = false;
  setProfileRating();
  opponentName = 'Your friend';
  role = 'guest';
  roomCode = code;
  peer = new Peer();
  document.querySelector('#active-room-code').textContent = roomCode;
  document.querySelector('#room-status').textContent = 'Connecting…';
  document.querySelector('#room-hint').textContent = 'Looking for your friend’s room.';
  document.querySelector('#game-title').textContent = 'Connecting to room';
  document.querySelector('#player-name-label').textContent = playerName;
  setLobbyMessage('');
  showGame();
  peer.on('open', () => {
    connection = peer.connect(roomCode, { reliable: true });
    bindConnection(connection);
    window.setTimeout(() => {
      if (!connection?.open) {
        setGameMessage('Could not reach that room. Check the code and make sure your friend is online.');
        document.querySelector('#room-status').textContent = 'Room not found';
      }
    }, 10000);
  });
  peer.on('error', error => {
    if (error.type !== 'peer-unavailable') setGameMessage(`Connection error: ${error.message || error.type}`);
  });
});

boardElement.addEventListener('click', event => {
  const square = event.target.closest('[data-square]');
  if (square) handleMove(square.dataset.square);
});

document.querySelector('#copy-code-button').addEventListener('click', async () => {
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set('room', roomCode);
  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    showToast('Invite link copied');
  } catch {
    showToast(`Invite link: ${inviteUrl.toString()}`);
  }
});

document.querySelector('#draw-button').addEventListener('click', () => {
  if (!connection?.open || gameFinished) return;
  sendToOpponent({ type: 'draw' });
});

document.querySelector('#resign-button').addEventListener('click', () => {
  if (gameFinished || (role !== 'ai' && !connection?.open) || !window.confirm('Resign this game?')) return;
  const winner = role === 'guest' ? 'w' : 'b';
  if (role !== 'ai') sendToOpponent({ type: 'resign', winner, message: 'Your opponent resigned. You win!' });
  finishRatedGame(winner, role === 'ai' ? 'You resigned. Computer wins.' : 'You resigned.');
});

document.querySelector('#leave-button').addEventListener('click', () => {
  if (connection?.open) sendToOpponent({ type: 'finished', message: `${playerName} left the game.` });
  resetGame();
});

document.querySelector('#room-code').addEventListener('input', event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
});

document.querySelector('#room-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') document.querySelector('#join-button').click();
});

const inviteCode = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase();
if (inviteCode && /^[A-HJ-NP-Z2-9]{6}$/.test(inviteCode)) {
  document.querySelector('#room-code').value = inviteCode;
}

playerRating = readPlayerRating(document.querySelector('#host-name').value);
setProfileRating();
initializePublicGames();
if (inviteCode && /^[A-HJ-NP-Z2-9]{6}$/.test(inviteCode)) {
  document.querySelector('#join-button').click();
}