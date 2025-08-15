// Game state
let currentPuzzle = null;
let guessesRemaining = 3;
let hasWon = false;
let guesses = [];
let gameMode = 'daily'; // 'daily', 'easy', 'hard'
let puzzleNumber = 0;
const SESSION_SIZE = 5;
let sessionResults = [];

// Game mode settings
const GAME_MODES = {
    daily: { zoom: 333, guesses: 3, requireYear: false },
    easy: { zoom: 100, guesses: 5, requireYear: false }, // No zoom
    hard: { zoom: 400, guesses: 1, requireYear: false }, // Extra zoom, year requirement disabled for now
};

// Clue display settings
const CLUE_POS_JITTER = 15; // percent jitter around center (50% ± 10%)

// DOM elements
let carImage, makeInput, modelInput, yearInput, yearInputContainer, submitButton, guessCounter, answerDisplay, nextButton;

// Available car images with their data
const carImages = [
    { filename: 'ford_mustang_gt_2022.jpg', make: 'Ford', model: 'Mustang GT', year: '2022' },
    { filename: 'toyota_rav4_2018.jpg', make: 'Toyota', model: 'RAV4', year: '2018' },
    { filename: 'volkswagen_golfr_2019.jpg', make: 'Volkswagen', model: 'Golf R', year: '2019' }
];

// Catalog data will be loaded from catalog.json
let ALL_MAKES = [];
let MODELS_BY_MAKE = {};

// A simple string-to-hash function to create a seed from the date
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// Lightweight fuzzy match: prioritize startsWith, then includes
function fuzzyOptions(input, list, limit = 8) {
    const q = input.trim().toLowerCase();
    // If there's no query, return the full list so it can be scrolled
    if (!q) return list;
    // Otherwise, filter and apply the limit
    const starts = list.filter(x => x.toLowerCase().startsWith(q));
    const contains = list.filter(x => !x.toLowerCase().startsWith(q) && x.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, limit);
}

function wireAutocomplete(inputEl, listEl, optionsListOrFn, onSelect) {
    function render(items) {
        if (!items.length) { listEl.style.display = 'none'; listEl.innerHTML = ''; return; }
        listEl.innerHTML = items.map(x => `<div class="suggestions-item" data-val="${x}">${x}</div>`).join('');
        listEl.style.display = 'block';
    }
    function getOptions() {
        return typeof optionsListOrFn === 'function' ? optionsListOrFn() : optionsListOrFn;
    }
    inputEl.addEventListener('input', () => {
        render(fuzzyOptions(inputEl.value, getOptions()));
    });
    inputEl.addEventListener('focus', () => {
        render(fuzzyOptions(inputEl.value, getOptions()));
    });
    inputEl.addEventListener('blur', () => {
        setTimeout(() => { listEl.style.display = 'none'; }, 120);
    });
    listEl.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestions-item');
        if (!item) return;
        inputEl.value = item.getAttribute('data-val');
        listEl.style.display = 'none';
        inputEl.focus();
        if (onSelect) onSelect(inputEl.value);
    });
}

// Initialize the game
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    carImage = document.getElementById('carImage');
    makeInput = document.getElementById('makeInput');
    modelInput = document.getElementById('modelInput');
    yearInput = document.getElementById('yearInput');
    yearInputContainer = document.getElementById('yearInputContainer');
    submitButton = document.getElementById('submitGuess');

    // Create guess counter
    const puzzleContainer = document.querySelector('.puzzle-container');
    guessCounter = document.createElement('div');
    guessCounter.className = 'guess-counter';
    puzzleContainer.insertBefore(guessCounter, document.querySelector('.guess-container'));

    // Create answer display (initially hidden)
    answerDisplay = document.createElement('div');
    answerDisplay.className = 'answer-display';
    answerDisplay.style.display = 'none';
    puzzleContainer.appendChild(answerDisplay);

    // Get Next button
    nextButton = document.getElementById('nextButton');
    nextButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event from bubbling to car image
        if (puzzleNumber >= SESSION_SIZE) {
            startGame(gameMode); // Start a new session
        } else {
            newGame(); // Start next puzzle in the session
        }
    });

    // Create full image display (initially hidden)
    fullImageDisplay = document.createElement('div');
    fullImageDisplay.className = 'full-image-display';
    fullImageDisplay.style.display = 'none';
    puzzleContainer.insertBefore(fullImageDisplay, answerDisplay);

    // Load the full catalog from JSON and wire up the UI
    fetch('catalog.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to load catalog.json. Please run from a web server.');
            }
            return response.json();
        })
        .then(data => {
            ALL_MAKES = data.makes;
            MODELS_BY_MAKE = data.modelsByMake;
            console.log('Car catalog loaded successfully.');
            // Once data is loaded, wire up autocomplete
            const makeListEl = document.getElementById('makeSuggestions');
            const modelListEl = document.getElementById('modelSuggestions');

            // When selecting a make, clear the model and update its suggestion set
            wireAutocomplete(makeInput, makeListEl, ALL_MAKES, () => {
                modelInput.value = '';
                // Immediately refresh model suggestions based on new make
                const opts = getModelOptions();
                modelListEl.style.display = 'none';
                modelListEl.innerHTML = '';
                if (document.activeElement === modelInput) {
                    // defer to modelInput focus/input listeners
                }
            });

            function getModelOptions() {
                const selMake = makeInput.value.trim();
                if (MODELS_BY_MAKE[selMake] && MODELS_BY_MAKE[selMake].length) return MODELS_BY_MAKE[selMake];
                // Fallback to all known models (flattened)
                return Object.values(MODELS_BY_MAKE).flat();
            }
            wireAutocomplete(modelInput, modelListEl, () => getModelOptions());

            // Start the first game in daily mode
            startGame('daily');

            // Event listeners
            submitButton.addEventListener('click', checkGuess);
            [makeInput, modelInput].forEach(inp => inp.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') checkGuess();
            }));

            // Mode buttons
            document.getElementById('easy').addEventListener('click', (e) => {
                e.preventDefault();
                startGame('easy');
            });
            document.getElementById('hard').addEventListener('click', (e) => {
                e.preventDefault();
                startGame('hard');
            });
        })
        .catch(error => {
            console.error('Failed to load car catalog:', error);
            // Display an error to the user
            document.getElementById('game-container').innerHTML =
                '<p style="color: red; font-weight: bold;">Error: Could not load car catalog. Please ensure you are running this from a local web server, not a file:// URL.</p>';
        });
});

// Start a new game series for a given mode
function startGame(mode) {
    gameMode = mode;
    puzzleNumber = 0;
    sessionResults = [];

    if (mode === 'daily') {
        const loadedState = loadDailyState();
        if (loadedState) {
            // Restore from localStorage
            guessesRemaining = loadedState.guessesRemaining;
            hasWon = loadedState.hasWon;
            guesses = loadedState.guesses;
            // Select the correct puzzle for today
            const today = new Date().toISOString().slice(0, 10);
            const seed = simpleHash(today);
            currentPuzzle = carImages[seed % carImages.length];
            restoreUI();
            return;
        }
    }

    // Otherwise, start a fresh game
    renderScoreTracker();
    newGame();
}

// Start a new puzzle
function newGame() {
    // Reset puzzle state
    if (puzzleNumber >= SESSION_SIZE) {
        puzzleNumber = 0;
        sessionResults = [];
    } else {
        puzzleNumber++;
    }
    
    guessesRemaining = GAME_MODES[gameMode].guesses;
    hasWon = false;
    guesses = [];
    makeInput.value = '';
    modelInput.value = '';
    yearInput.value = '';
    makeInput.disabled = false;
    modelInput.disabled = false;
    submitButton.disabled = false;
    answerDisplay.style.display = 'none';
    fullImageDisplay.style.display = 'none';
    nextButton.classList.remove('visible');

    // Select a puzzle
    if (gameMode === 'daily') {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const seed = simpleHash(today);
        const puzzleIndex = seed % carImages.length;
        currentPuzzle = carImages[puzzleIndex];
    } else {
        // Select a random car for other modes
        currentPuzzle = carImages[Math.floor(Math.random() * carImages.length)];
    }

    // Set the zoomed-in image based on mode
    const modeSettings = GAME_MODES[gameMode];
    carImage.style.backgroundImage = `url(images/${currentPuzzle.filename})`;
    carImage.style.backgroundSize = `${modeSettings.zoom}%`;
    // Randomize position but keep near center
    const randCentered = () => 50 + (Math.random() * 2 * CLUE_POS_JITTER - CLUE_POS_JITTER);
    const posX = randCentered().toFixed(1);
    const posY = randCentered().toFixed(1);
    carImage.style.backgroundPosition = `${posX}% ${posY}%`;

    // Easy mode specific logic
    if (gameMode === 'easy') {
        makeInput.value = currentPuzzle.make;
        makeInput.disabled = true;
    }

    // Show/hide year input for hard mode
    yearInputContainer.style.display = GAME_MODES[gameMode].requireYear ? 'block' : 'none';

    // Update UI
    updateGuessCounter();
}

// Check the user's guess
function checkGuess() {
    if (hasWon) return;

    const makeGuess = makeInput.value.trim();
    const modelGuess = modelInput.value.trim();
    const yearGuess = yearInput.value.trim();

    const requireYear = GAME_MODES[gameMode].requireYear;

    if (!makeGuess || !modelGuess || (requireYear && !yearGuess)) return;

    // Add to guesses list
    guesses.push({ make: makeGuess, model: modelGuess, year: yearGuess });

    const correctMake = currentPuzzle.make.toLowerCase();
    const correctModel = currentPuzzle.model.toLowerCase();
    const correctYear = currentPuzzle.year;

    const isCorrect = makeGuess.toLowerCase() === correctMake &&
        modelGuess.toLowerCase() === correctModel &&
        (!requireYear || yearGuess === correctYear);

    if (isCorrect) {
        // Correct guess
        hasWon = true;
        showAnswer(true);
        toast('Correct! 🎉');
    } else {
        // Incorrect guess
        guessesRemaining--;
        updateGuessCounter();

        if (guessesRemaining <= 0) {
            // Out of guesses
            showAnswer(false);
            toast('Out of guesses! The answer was revealed.');
        } else {
            toast(`Incorrect! ${guessesRemaining} ${guessesRemaining === 1 ? 'guess' : 'guesses'} remaining.`);
        }
    }

    if (gameMode === 'daily') {
        saveDailyState();
    }
}

// Update the guess counter display
function updateGuessCounter() {
    guessCounter.textContent = `Guesses remaining: ${guessesRemaining}`;
}

function renderScoreTracker() {
    const tracker = document.getElementById('scoreTracker');
    if (!tracker) return;

    // Only show tracker for Easy and Hard modes
    if (gameMode === 'easy' || gameMode === 'hard') {
        tracker.style.display = 'flex';
        tracker.innerHTML = '';
        for (let i = 0; i < SESSION_SIZE; i++) {
            const box = document.createElement('div');
            box.className = 'score-box';
            if (i < sessionResults.length) {
                box.textContent = sessionResults[i] ? '✅' : '❌';
                box.style.fontSize = '48px'; // 100% larger emojis
            } else if (i === sessionResults.length && i < puzzleNumber) {
                box.textContent = '❓';
                box.style.fontSize = '48px'; // 100% larger emojis
            } else {
                box.textContent = '⬛';
                box.style.fontSize = '48px'; // 100% larger emojis
            }
            tracker.appendChild(box);
        }
    } else {
        tracker.style.display = 'none';
    }
}

// Show the answer and full image
function showAnswer(isCorrect) {
    makeInput.disabled = true;
    modelInput.disabled = true;
    submitButton.disabled = true;

    // Unzoom the image for all modes
    carImage.style.backgroundSize = '100%';
    carImage.style.backgroundPosition = 'center';

    // Only add to session results if not already added for this puzzle
    if (sessionResults.length < puzzleNumber) {
        sessionResults.push(isCorrect);
    }
    
    // Update score display immediately
    renderScoreTracker();

    const isSessionOver = puzzleNumber >= SESSION_SIZE && gameMode !== 'daily';
    const showFullImage = gameMode === 'hard';

    // Show answer
    answerDisplay.innerHTML = `
      <h3>${isCorrect ? 'Correct!' : 'The answer was:'}</h3>
      <p>${currentPuzzle.make.toUpperCase()} ${currentPuzzle.model.toUpperCase()} (${currentPuzzle.year})</p>
      ${gameMode === 'daily' ?
            '<button id="playAgain" class="btn">Play Again</button>' :
            ''
        }
    `;

    // Show Next button for Easy/Hard modes after all guesses are used
    if (gameMode !== 'daily' && (hasWon || guessesRemaining <= 0)) {
        nextButton.classList.add('visible');
        nextButton.textContent = isSessionOver ? 'New Session' : 'Next';
    }
    
    answerDisplay.style.display = 'block';

    // Add event listener for play again button if it exists
    const playAgainBtn = document.getElementById('playAgain');
    if (playAgainBtn) {
        playAgainBtn.addEventListener('click', () => {
            if (gameMode === 'daily') {
                toast('Daily puzzle is once a day. Play another mode!');
                playAgainBtn.disabled = true;
                return;
            }

            if (puzzleNumber >= SESSION_SIZE) {
                startGame(gameMode); // Start a new session
            } else {
                newGame(); // Start next puzzle in the session
            }
        });
    }
}

function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.bottom = '28px';
    el.style.transform = 'translateX(-50%)';
    el.style.padding = '12px 24px';
    el.style.border = '2px solid #fff';
    el.style.borderRadius = '12px';
    el.style.background = 'rgba(0,0,0,0.8)';
    el.style.color = '#fff';
    el.style.fontWeight = '700';
    el.style.letterSpacing = '.06em';
    el.style.zIndex = '9999';
    el.style.boxShadow = '0 0 0 6px rgba(255,255,255,0.04)';
    el.style.whiteSpace = 'nowrap';
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, 1700);
}

// Dynamic year
document.getElementById('year').textContent = new Date().getFullYear();

// --- Daily Puzzle State Management ---
function getDailyStorageKey() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `dailyPuzzle-${today}`;
}

function saveDailyState() {
    const state = {
        guessesRemaining,
        hasWon,
        guesses,
    };
    localStorage.setItem(getDailyStorageKey(), JSON.stringify(state));
}

function loadDailyState() {
    const stateJSON = localStorage.getItem(getDailyStorageKey());
    return stateJSON ? JSON.parse(stateJSON) : null;
}

function restoreUI() {
    updateGuessCounter();
    renderScoreTracker();

    // Display past guesses
    const pastGuessesEl = document.getElementById('pastGuesses');
    pastGuessesEl.innerHTML = '';
    if (guesses && guesses.length > 0) {
        pastGuessesEl.innerHTML = '<h3>Your Guesses:</h3>' +
            guesses.map(g => `<div class="past-guess">${g.make} - ${g.model} ${g.year ? '(' + g.year + ')' : ''}</div>`).join('');
    }

    if (hasWon || guessesRemaining <= 0) {
        showAnswer(hasWon);
    }
}
