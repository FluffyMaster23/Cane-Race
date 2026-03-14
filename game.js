const coinStorageKey = 'caneRaceTotalCoins';

function loadSavedCoinTotal() {
    try {
        const savedValue = localStorage.getItem(coinStorageKey);
        const parsedValue = Number.parseInt(savedValue, 10);
        if (Number.isFinite(parsedValue) && parsedValue >= 0) {
            return parsedValue;
        }
    } catch (error) {
        // Ignore storage errors and fall back to zero.
    }
    return 0;
}

function saveCoinTotal() {
    try {
        localStorage.setItem(coinStorageKey, String(gameState.coinProgress));
    } catch (error) {
        // Ignore storage errors.
    }
}

// Game state
let gameState = {
    running: false,
    playerLane: 1, // 0 = left, 1 = middle, 2 = right
    previousLane: 1,
    lastLaneChangeAt: 0,
    score: 0,
    coinProgress: loadSavedCoinTotal(),
    coinsCollected: 0,
    level: 1,
    speed: 1,
    baseSpeed: 180, // Base speed in ms for obstacle movement - moderate pace
    obstacles: [], // Array of {type: 'cane'|'skateboard'|'coin', lane: 0-2, distance: number, coinAmount: number}
    lastObstacleSpawn: 0,
    spawnInterval: 5000, // Spawn obstacles every 5 seconds at level 1
    animationFrame: null,
    stunnedUntil: 0,
    onCarId: null,
    carRoofSteps: 0
};

const carJumpBonus = 10;
const obstacleApproachMix = {
    minVolume: 0.2,
    carMinVolume: 0.35,
    distanceRange: 120,
    fadeOutRange: 10,
    caneBoost: 1.5,
    skateboardBoost: 1.8
};

let nextObstacleId = 1;
let stunRecoveryTimeout = null;
let jumpLandingTimeout = null;
const hazardCollisionDistance = 2;
const laneChangeGraceMs = 220;
const carJumpAirTimeMs = 2000;
const pointsPerLevel = 30;
const laneCount = 3;

// Sound objects - ADD YOUR SOUND FILE NAMES HERE
const sounds = {
    // Player sounds
    jump: new Howl({ src: ['sounds/player/jump.wav'] }),
    turnLeft: new Howl({ src: ['sounds/player/turn_left.wav'] }),
    turnRight: new Howl({ src: ['sounds/player/turn_right.wav'] }),
    turnCenter: new Howl({ src: ['sounds/player/turn_center.wav'] }),

    // Item sounds
    coinCollect: new Howl({
        src: ['sounds/items/coin/pickupcoin.wav'], 
        volume: 1.0
    }),
    coinLoop: new Howl({ src: ['sounds/items/coin/coin.wav'], loop: true }),
    
    // Obstacle sounds - centered sources, panned per obstacle instance
    caneConcretecenter: new Howl({ src: ['sounds/cane/cane_on_concrete_center.wav'], loop: false }),
    skateboardCenter: new Howl({ src: ['sounds/skateboard/skateboard_center.wav'], loop: false }),
    
    caneHit: new Howl({ src: ['sounds/player/caneHit.wav'] }),
    skateboardHit: new Howl({ src: ['sounds/player/skateboardhit.wav'] }),
    carAmb: new Howl({
        src: ['sounds/car/carAmb.wav'],
        loop: false,
        html5: false,
        preload: true
    }),
    carStep1: new Howl({ src: ['sounds/car/carstep1.wav'], loop: false }),
    carStep2: new Howl({ src: ['sounds/car/carstep2.wav'], loop: false }),
    carStep3: new Howl({ src: ['sounds/car/carstep3.wav'], loop: false }),
    
    // Game sounds
    levelUp: null, // new Howl({src: ['sounds/level_up.mp3']}),
    playerSteps1: new Howl({ src: ['sounds/player/concrete1.wav'] }),
    playerSteps2: new Howl({ src: ['sounds/player/concrete2.wav'] }),
    playerSteps3: new Howl({ src: ['sounds/player/concrete3.wav'] }),
    gameOver: null // new Howl({src: ['sounds/game_over.mp3']})
};

// Footstep tracking
let currentFootstepIndex = 0;
let footstepInterval = null;
let carStepInterval = null;

function normalizeLaneDelta(targetLane, playerLane) {
    let delta = ((targetLane - playerLane) % laneCount + laneCount) % laneCount;
    const half = Math.floor(laneCount / 2);

    if (delta > half) {
        delta -= laneCount;
    }

    return delta;
}

function getObstaclePan(obstacle) {
    const relativeLane = normalizeLaneDelta(obstacle.lane, gameState.playerLane);
    const maxOffset = Math.max(1, Math.floor(laneCount / 2));
    const rawPan = relativeLane / maxOffset;
    return Math.max(-1, Math.min(1, rawPan));
}

function startGame() {
    const playButton = document.getElementById("play");
    const gameArea = document.getElementById("gameArea");

    // Hard reset any leftover timers/sounds from a previous run.
    if (gameState.animationFrame) {
        clearTimeout(gameState.animationFrame);
    }
    stopStepAudioLoops();
    
    // Hide play button
    playButton.style.display = "none";
    
    // Focus on game area for keyboard controls
    gameArea.focus();
    
    // Initialize game state
    gameState = {
        running: true,
        playerLane: 1,
        previousLane: 1,
        lastLaneChangeAt: 0,
        score: 0,
        coinProgress: loadSavedCoinTotal(),
        coinsCollected: 0,
        level: 1,
        speed: 1,
        baseSpeed: 180,
        obstacles: [],
        lastObstacleSpawn: Date.now(),
        spawnInterval: 5000,
        animationFrame: null,
        stunnedUntil: 0,
        onCarId: null,
        carRoofSteps: 0
    };

    nextObstacleId = 1;
    if (stunRecoveryTimeout) {
        clearTimeout(stunRecoveryTimeout);
        stunRecoveryTimeout = null;
    }
    if (jumpLandingTimeout) {
        clearTimeout(jumpLandingTimeout);
        jumpLandingTimeout = null;
    }
    
    // Set up keyboard controls (avoid duplicate listeners on replay)
    document.removeEventListener('keydown', handleKeyPress);
    document.addEventListener('keydown', handleKeyPress);
    
    // Start footstep sounds (player walking automatically)
    playFootsteps();
    
    // Start game loop
    gameLoop();

    updateHUD();
    
    updateStatus("Game started!");
}

function handleKeyPress(e) {
    if (!gameState.running) return;
    
    switch(e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            if (isStunned()) return;
            gameState.previousLane = gameState.playerLane;
            gameState.playerLane = (gameState.playerLane + laneCount - 1) % laneCount;
            gameState.lastLaneChangeAt = Date.now();
            if (gameState.playerLane === 1) {
                playSound('turnCenter');
            } else {
                playSound('turnLeft');
            }
            updateDirectionalObstacleSounds();
            break;
            
        case 'ArrowRight':
            e.preventDefault();
            if (isStunned()) return;
            gameState.previousLane = gameState.playerLane;
            gameState.playerLane = (gameState.playerLane + 1) % laneCount;
            gameState.lastLaneChangeAt = Date.now();
            if (gameState.playerLane === 1) {
                playSound('turnCenter');
            } else {
                playSound('turnRight');
            }
            updateDirectionalObstacleSounds();
            break;
            
        case 'ArrowUp':
        case ' ':
        case 'Spacebar':
            e.preventDefault();

            if (gameState.onCarId !== null) {
                playSound('jump');
                tryJumpOffCar();
                break;
            }

            if (jumpLandingTimeout) {
                break;
            }

            playSound('jump');
            stopFootsteps();
            jumpLandingTimeout = setTimeout(() => {
                jumpLandingTimeout = null;
                if (!gameState.running || isStunned() || gameState.onCarId !== null) {
                    return;
                }

                movePlayerForward(2);
                if (gameState.running && !isStunned()) {
                    playFootsteps();
                }
            }, carJumpAirTimeMs);
            break;
    }
}

function isStunned() {
    return Date.now() < gameState.stunnedUntil;
}

function movePlayerForward(steps) {
    if (!gameState.running || steps <= 0) return;

    for (const obstacle of gameState.obstacles) {
        obstacle.distance -= steps;
        updateSingleObstacleSound(obstacle);
    }

    checkCollisions();
}

function tryJumpOffCar() {
    if (gameState.onCarId === null) return;

    const carObstacle = gameState.obstacles.find(obstacle => obstacle.id === gameState.onCarId && obstacle.type === 'car');
    if (!carObstacle) {
        gameState.onCarId = null;
        gameState.carRoofSteps = 0;
        return;
    }

    stopCarRoofSteps();
    if (carObstacle.soundId !== null && sounds.carAmb) {
        sounds.carAmb.stop(carObstacle.soundId);
    }
    carObstacle.carJumped = true;
    gameState.onCarId = null;
    gameState.carRoofSteps = 0;
    gameState.score += carJumpBonus;
    updateHUD();
    stopFootsteps();
    if (jumpLandingTimeout) {
        clearTimeout(jumpLandingTimeout);
        jumpLandingTimeout = null;
    }
    jumpLandingTimeout = setTimeout(() => {
        jumpLandingTimeout = null;
        if (gameState.running && !isStunned() && gameState.onCarId === null) {
            playFootsteps();
        }
    }, carJumpAirTimeMs);
    checkLevelUp();
}

function getBaseObstacleSoundKey(obstacle) {
    if (obstacle.type === 'cane') return 'caneConcretecenter';
    if (obstacle.type === 'skateboard') return 'skateboardCenter';
    if (obstacle.type === 'car') return 'carAmb';
    return null;
}

function updateDirectionalObstacleSounds() {
    gameState.obstacles.forEach(obstacle => {
        if (!obstacle.soundId) return;
        if (obstacle.type !== 'cane' && obstacle.type !== 'skateboard') return;
        updateSingleObstacleSound(obstacle);
    });
}

function updateSingleObstacleSound(obstacle) {
    const soundName = obstacle.soundKey || getBaseObstacleSoundKey(obstacle);
    if (!soundName || !sounds[soundName]) return;

    if (!obstacle.soundId) return;

    const obstacleSound = sounds[soundName];
    
    // Distance-based volume: louder as it gets closer (0-100 distance)
    // At distance 100: very quiet (0.05)
    // At distance 50: medium (0.3)
    // At distance 0: loud (1.0)
    let volume = 0;
    if (obstacle.distance > 0) {
        volume = Math.max(obstacleApproachMix.minVolume, 1 - (obstacle.distance / obstacleApproachMix.distanceRange));
    } else {
        // Fading out after passing
        volume = Math.max(0, 1 + (obstacle.distance / obstacleApproachMix.fadeOutRange));
    }

    if (obstacle.type === 'cane') {
        volume *= obstacleApproachMix.caneBoost;
    } else if (obstacle.type === 'skateboard') {
        volume *= obstacleApproachMix.skateboardBoost;
    } else if (obstacle.type === 'car') {
        volume = Math.max(obstacleApproachMix.carMinVolume, volume);
    }

    volume = Math.min(1, volume);

    try {
        obstacleSound.volume(volume, obstacle.soundId);

        if (typeof obstacleSound.stereo === 'function') {
            obstacleSound.stereo(getObstaclePan(obstacle), obstacle.soundId);
        }
    } catch (error) {
        console.warn(`Obstacle sound update failed for ${soundName}:`, error);
    }
}

function playSound(soundName) {
    if (sounds[soundName] && sounds[soundName] !== null) {
        sounds[soundName].play();
    }
}

function gameLoop() {
    if (!gameState.running) return;
    
const currentTime = Date.now();
    
    // Spawn new obstacles
    if (currentTime - gameState.lastObstacleSpawn > gameState.spawnInterval / gameState.speed) {
        spawnObstacle();
        gameState.lastObstacleSpawn = currentTime;
    }
    
    // Move obstacles toward player
    moveObstacles();
    
    // Check collisions
    checkCollisions();
    
    // Continue game loop
    gameState.animationFrame = setTimeout(gameLoop, gameState.baseSpeed / gameState.speed);
}

function spawnObstacle() {
    const random = Math.random();
    let obstacleType;
    
    // 25% cane, 22% skateboard, 28% coin, 25% standing car
    if (random < 0.25) {
        obstacleType = 'cane';
    } else if (random < 0.47) {
        obstacleType = 'skateboard';
    } else if (random < 0.75) {
        obstacleType = 'coin';
    } else {
        obstacleType = 'car';
    }
    
    const lane = Math.floor(Math.random() * laneCount); // Random lane 0-2
    
    const obstacle = {
        id: nextObstacleId++,
        type: obstacleType,
        lane: lane,
        distance: 100, // Start at distance 100, moves toward 0 (player is at 0)
        coinAmount: obstacleType === 'coin' ? Math.floor(Math.random() * 10) + 1 : 0,
        soundId: null, // Store the sound ID for this obstacle
        soundKey: null,
        carJumped: false,
        dodgeGraceApplied: false
    };
    
    gameState.obstacles.push(obstacle);
    
    // Play obstacle approach sound based on lane and store sound ID
    if (obstacleType === 'cane') {
        const caneSound = sounds.caneConcretecenter;
        obstacle.soundId = caneSound.play();
        caneSound.loop(true, obstacle.soundId);
        obstacle.soundKey = 'caneConcretecenter';
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'skateboard') {
        const skateboardSound = sounds.skateboardCenter;
        obstacle.soundId = skateboardSound.play();
        skateboardSound.loop(true, obstacle.soundId);
        obstacle.soundKey = 'skateboardCenter';
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'coin') {
        // Coins don't make sound until collected
    } else if (obstacleType === 'car') {
        const carSoundId = sounds.carAmb.play();
        if (typeof carSoundId === 'number') {
            obstacle.soundId = carSoundId;
            obstacle.soundKey = 'carAmb';
            updateSingleObstacleSound(obstacle);
        }
    }
}

function moveObstacles() {
    // Move all obstacles closer to player
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];

        if (obstacle.type === 'car' && gameState.onCarId === obstacle.id && !obstacle.carJumped) {
            obstacle.distance = 0;
            updateSingleObstacleSound(obstacle);
            continue;
        }

        obstacle.distance -= 1;

        // Update proximity-based approach audio
        updateSingleObstacleSound(obstacle);
        
        // Keep coins active slightly longer if player dodged them at the pass point
        if (obstacle.type === 'coin' && obstacle.distance < -5 && obstacle.distance > -10) {
            if (obstacle.lane !== gameState.playerLane) {
                if (!obstacle.dodgeGraceApplied) {
                    obstacle.distance = -4;
                    obstacle.dodgeGraceApplied = true;
                }
                continue;
            }
        }

        // Remove obstacles that passed the player without collision
        if (obstacle.distance < -5) {
            
            // Stop the sound if still playing
            if (obstacle.soundId !== null) {
                const soundName = obstacle.soundKey || getSoundNameForObstacle(obstacle);
                if (soundName && sounds[soundName]) {
                    sounds[soundName].stop(obstacle.soundId);
                }
            }
            
            // Award points for avoiding obstacles (not coins)
            let pointsAwarded = 0;
            if (obstacle.type === 'skateboard') {
                gameState.score += 3;
                pointsAwarded = 3;
            } else if (obstacle.type === 'cane') {
                gameState.score += 1;
                pointsAwarded = 1;
            }

            if (pointsAwarded > 0) {
                updateHUD();
            }
            // Note: Coins don't give points for avoiding, only for collecting

            if (obstacle.type === 'car' && gameState.onCarId === obstacle.id && !obstacle.carJumped) {
                gameState.onCarId = null;
                gameState.carRoofSteps = 0;
                fallFromCar(obstacle.id);
            }
            
            gameState.obstacles.splice(i, 1);
            checkLevelUp();
        }
    }
}

function fallFromCar(fallenCarId = null) {
    if (!gameState.running) return;

    if (fallenCarId !== null) {
        const fallenCar = gameState.obstacles.find(obstacle => obstacle.id === fallenCarId && obstacle.type === 'car');
        if (fallenCar && fallenCar.soundId !== null && sounds.carAmb) {
            sounds.carAmb.stop(fallenCar.soundId);
        }
    }

    gameState.carRoofSteps = 0;
    gameState.stunnedUntil = Date.now() + 3000;
    updateStatus('You just fell down from a car!');
    announceToScreenReader('You just fell down from a car! Stunned for 3 seconds.');
    stopStepAudioLoops();

    if (stunRecoveryTimeout) {
        clearTimeout(stunRecoveryTimeout);
    }

    stunRecoveryTimeout = setTimeout(() => {
        if (gameState.running && !isStunned()) {
            playFootsteps();
            updateStatus('Recovered from stun. Keep moving!');
        }
    }, 3050);
}

function getSoundNameForObstacle(obstacle) {
    return getBaseObstacleSoundKey(obstacle);
}

function checkCollisions() {
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        const recentlyChangedLane = Date.now() - gameState.lastLaneChangeAt <= laneChangeGraceMs;

        if (
            recentlyChangedLane &&
            (obstacle.type === 'cane' || obstacle.type === 'skateboard') &&
            obstacle.lane === gameState.previousLane &&
            obstacle.lane !== gameState.playerLane &&
            Math.abs(obstacle.distance) <= hazardCollisionDistance
        ) {
            continue;
        }

        if (
            obstacle.type === 'car' &&
            obstacle.lane === gameState.playerLane &&
            obstacle.distance <= 2 &&
            obstacle.distance >= -2 &&
            gameState.onCarId === null
        ) {
            gameState.onCarId = obstacle.id;
            gameState.carRoofSteps = 0;
            updateSingleObstacleSound(obstacle);
            stopFootsteps();
            startCarRoofSteps();
            continue;
        }
        
        // Check if obstacle is at player position and in same lane
        if (obstacle.lane === gameState.playerLane) {
            
            // Coins collected at distance 0
            if (obstacle.type === 'coin' && obstacle.distance <= 1 && obstacle.distance >= -1) {
                // Collect coin
                gameState.score += obstacle.coinAmount;
                gameState.coinProgress += obstacle.coinAmount;
                gameState.coinsCollected += 1;
                saveCoinTotal();
                updateHUD();
                
                // Remove from obstacles array
                gameState.obstacles.splice(i, 1);
                
                // Play the pickup coin sound
                sounds.coinCollect.play();
                
                updateStatus(`Collected ${obstacle.coinAmount} coins! Score: ${gameState.score}`);
                checkLevelUp();
            }
            
            // Canes and skateboards only hit when they are truly close to the player
            if ((obstacle.type === 'cane' || obstacle.type === 'skateboard') && Math.abs(obstacle.distance) <= hazardCollisionDistance) {
                // Hit by cane or skateboard - game over
                endGame(obstacle.type);
                return;
            }
        }
    }
}

function checkLevelUp() {
    const newLevel = Math.floor(gameState.score / pointsPerLevel) + 1;
    
    if (newLevel > gameState.level) {
        gameState.level = newLevel;
        gameState.speed = Math.min(2, 1 + (gameState.level - 1) * 0.1); // 10% faster each level, capped

        // Refresh footsteps so interval matches the new speed
        stopFootsteps();
        playFootsteps();
        
        playSound('levelUp');
        announceToScreenReader("Level up!");
        updateStatus(`Level up! Now level ${gameState.level}. Speed increased!`);
    }
}

function endGame(hitBy) {
    gameState.running = false;
    clearTimeout(gameState.animationFrame);
    gameState.onCarId = null;
    gameState.carRoofSteps = 0;
    gameState.stunnedUntil = 0;
    if (stunRecoveryTimeout) {
        clearTimeout(stunRecoveryTimeout);
        stunRecoveryTimeout = null;
    }
    if (jumpLandingTimeout) {
        clearTimeout(jumpLandingTimeout);
        jumpLandingTimeout = null;
    }
    
    // Stop footstep sounds
    stopStepAudioLoops();
    document.removeEventListener('keydown', handleKeyPress);
    
    // Fade out obstacle sounds so death audio is clear
    const obstacleFadeDuration = 700;
    gameState.obstacles.forEach(obstacle => {
        if (obstacle.soundId !== null) {
            const soundName = obstacle.soundKey || getSoundNameForObstacle(obstacle);
            if (soundName && sounds[soundName]) {
                const obstacleSound = sounds[soundName];
                const currentVolume = obstacleSound.volume(obstacle.soundId);
                obstacleSound.once('fade', function() {
                    obstacleSound.stop(obstacle.soundId);
                }, obstacle.soundId);
                obstacleSound.fade(currentVolume, 0, obstacleFadeDuration, obstacle.soundId);
            }
        }
    });

    const hitSound = hitBy === 'cane' ? sounds.caneHit : sounds.skateboardHit;
    if (hitSound) {
        hitSound.stop();
        const hitSoundId = hitSound.play();

        if (sounds.gameOver) {
            hitSound.once('end', function() {
                sounds.gameOver.play();
            }, hitSoundId);
        }
    } else if (sounds.gameOver) {
        sounds.gameOver.play();
    }
    
    // Play game over sound later when implemented
    // playSound('gameOver');
    
    const hitType = hitBy === 'cane' ? 'cane' : 'skateboard';
    const message = `Game Over! You were hit by a ${hitType}. Final Score: ${gameState.score}`;
    
    updateStatus(message);
    announceToScreenReader(message);
    
    // Show play button again
    setTimeout(() => {
        document.getElementById("play").style.display = "inline-block";
    }, 1000);
}

function playFootsteps() {
    // Prevent stacking intervals when game restarts or state transitions overlap.
    stopFootsteps();

    // Cycle through footstep sounds: 1, 2, 3, 1, 2, 3...
    const footstepSounds = ['playerSteps1', 'playerSteps2', 'playerSteps3'];
    
    const playNextStep = () => {
        if (!gameState.running) return;
        
        const soundName = footstepSounds[currentFootstepIndex];
        if (sounds[soundName]) {
            sounds[soundName].play();
        }
        
        // Move to next footstep sound
        currentFootstepIndex = (currentFootstepIndex + 1) % 3;
    };
    
    // Play immediately
    playNextStep();
    
    // Continue playing based on speed (adjust timing as needed)
    footstepInterval = setInterval(() => {
        playNextStep();
    }, 400 / gameState.speed); // Adjust 400ms to match your footstep sound length
}

function stopFootsteps() {
    if (footstepInterval) {
        clearInterval(footstepInterval);
        footstepInterval = null;
    }
    if (sounds.playerSteps1) sounds.playerSteps1.stop();
    if (sounds.playerSteps2) sounds.playerSteps2.stop();
    if (sounds.playerSteps3) sounds.playerSteps3.stop();
    currentFootstepIndex = 0;
}

function startCarRoofSteps() {
    // Prevent stacking intervals on rapid state changes.
    stopCarRoofSteps();

    const carStepSequence = [
        { soundName: 'carStep1', rate: 1.0 },
        { soundName: 'carStep2', rate: 1.12 },
        { soundName: 'carStep3', rate: 1.24 },
        { soundName: 'carStep3', rate: 1.38 }
    ];

    const playNextCarStep = () => {
        if (!gameState.running || gameState.onCarId === null) return;

        const nextStepNumber = gameState.carRoofSteps + 1;
        if (nextStepNumber >= 5) {
            const carObstacle = gameState.obstacles.find(
                obstacle => obstacle.id === gameState.onCarId && obstacle.type === 'car'
            );

            if (carObstacle && !carObstacle.carJumped) {
                gameState.onCarId = null;
                gameState.carRoofSteps = 0;
                carObstacle.distance = -6;
                fallFromCar(carObstacle.id);
            }
            return;
        }

        const sequenceIndex = Math.min(nextStepNumber - 1, carStepSequence.length - 1);
        const stepAudio = carStepSequence[sequenceIndex];
        const stepSound = sounds[stepAudio.soundName];
        if (stepSound) {
            const soundId = stepSound.play();
            stepSound.rate(stepAudio.rate, soundId);
        }

        gameState.carRoofSteps = nextStepNumber;
    };

    playNextCarStep();

    carStepInterval = setInterval(() => {
        playNextCarStep();
    }, 400 / gameState.speed);
}

function stopCarRoofSteps() {
    if (carStepInterval) {
        clearInterval(carStepInterval);
        carStepInterval = null;
    }
    if (sounds.carStep1) sounds.carStep1.stop();
    if (sounds.carStep2) sounds.carStep2.stop();
    if (sounds.carStep3) sounds.carStep3.stop();
}

function stopStepAudioLoops() {
    stopFootsteps();
    stopCarRoofSteps();
}

function updateStatus(message) {
    document.getElementById("status").textContent = message;
}

function updateHUD() {
    const scoreValue = document.getElementById('scoreValue');
    const coinTotalValue = document.getElementById('coinTotalValue');

    if (scoreValue) {
        scoreValue.textContent = gameState.score;
    }

    if (coinTotalValue) {
        coinTotalValue.textContent = gameState.coinProgress;
    }
}

function announceToScreenReader(message) {
    // Create a temporary element for screen reader announcement
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'alert');
    announcement.setAttribute('aria-live', 'assertive');
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    // Remove after announcement
    setTimeout(() => {
        document.body.removeChild(announcement);
    }, 1000);
}

function initializeHUDFromStorage() {
    gameState.coinProgress = loadSavedCoinTotal();
    updateHUD();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeHUDFromStorage);
} else {
    initializeHUDFromStorage();
}
