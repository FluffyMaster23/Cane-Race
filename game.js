// Game state
let gameState = {
    running: false,
    playerLane: 1, // 0 = left, 1 = middle, 2 = right
    score: 0,
    level: 1,
    speed: 1,
    baseSpeed: 150, // Base speed in ms for obstacle movement - moderate pace
    obstacles: [], // Array of {type: 'cane'|'skateboard'|'coin', lane: 0-2, distance: number, coinAmount: number}
    lastObstacleSpawn: 0,
    spawnInterval: 25000, // Spawn obstacles every 2.5 seconds at level 1
    animationFrame: null,
    stunnedUntil: 0,
    onCarId: null,
    carRoofSteps: 0
};

const audioMix = {
    skateboardApproachBoost: 1.35,
    skateboardApproachBaseVolume: 0.95,
    caneHitVolume: 1.0,
    skateboardHitVolume: 1.0,
    carJumpBonus: 10
};

let nextObstacleId = 1;
let stunRecoveryTimeout = null;

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
    
    // Obstacle sounds - left/center/right based on obstacle lane
    caneConcretecenter: new Howl({ src: ['sounds/cane/cane_on_concrete_center.wav'], loop: false }),
    caneConcreteleft: new Howl({ src: ['sounds/cane/cane_on_concrete_left.wav'], loop: false }),
    caneConcreteright: new Howl({ src: ['sounds/cane/cane_on_concrete_right.wav'], loop: false }),
    caneCementcenter: new Howl({ src: ['sounds/cane/cane_on_cement_center.wav'], loop: false }),
    caneCementleft: new Howl({ src: ['sounds/cane/cane_on_cement_left.wav'], loop: false }),
    caneCementright: new Howl({ src: ['sounds/cane/cane_on_cement_right.wav'], loop: false }),
    skateboardCenter: new Howl({ src: ['sounds/skateboard/skateboard_center.wav'], loop: false, volume: audioMix.skateboardApproachBaseVolume }),
    skateboardLeft: new Howl({ src: ['sounds/skateboard/skateboard_left.wav'], loop: false, volume: audioMix.skateboardApproachBaseVolume }),
    skateboardRight: new Howl({ src: ['sounds/skateboard/skateboard_right.wav'], loop: false, volume: audioMix.skateboardApproachBaseVolume }),
    
    caneHit: new Howl({ src: ['sounds/player/caneHit.wav'] }),
    skateboardHit: new Howl({ src: ['sounds/player/skateboardhit.wav'], volume: audioMix.skateboardHitVolume }),
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
        score: 0,
        level: 1,
        speed: 1,
        baseSpeed: 150,
        obstacles: [],
        lastObstacleSpawn: Date.now(),
        spawnInterval: 2000,
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
    
    // Set up keyboard controls (avoid duplicate listeners on replay)
    document.removeEventListener('keydown', handleKeyPress);
    document.addEventListener('keydown', handleKeyPress);
    
    // Start footstep sounds (player walking automatically)
    playFootsteps();
    
    // Start game loop
    gameLoop();
    
    updateStatus("Game started!");
}

function handleKeyPress(e) {
    if (!gameState.running) return;
    
    switch(e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            if (isStunned()) return;
            gameState.playerLane = (gameState.playerLane + 2) % 3;
            if (gameState.playerLane === 1) {
                playSound('turnCenter');
            } else {
                playSound('turnLeft');
            }
            updateAllObstacleSounds();
            break;
            
        case 'ArrowRight':
            e.preventDefault();
            if (isStunned()) return;
            gameState.playerLane = (gameState.playerLane + 1) % 3;
            if (gameState.playerLane === 1) {
                playSound('turnCenter');
            } else {
                playSound('turnRight');
            }
            updateAllObstacleSounds();
            break;
            
        case 'ArrowUp':
        case ' ':
        case 'Spacebar':
            e.preventDefault();

            if (gameState.onCarId !== null) {
                // Ignore accidental jump presses during the first roof steps.
                if (gameState.carRoofSteps < 4) {
                    break;
                }

                playSound('jump');
                tryJumpOffCar();
                break;
            }

            playSound('jump');
            movePlayerForward(2);
            tryJumpOffCar();
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

    // Car jump becomes available only after 4 roof steps.
    if (gameState.carRoofSteps >= 4) {
        stopCarRoofSteps();
        carObstacle.carJumped = true;
        gameState.onCarId = null;
        gameState.carRoofSteps = 0;
        gameState.score += audioMix.carJumpBonus;
        if (gameState.running && !isStunned()) {
            playFootsteps();
        }
        updateStatus(`Jumped off the car! +${audioMix.carJumpBonus} points. Score: ${gameState.score}`);
        checkLevelUp();
    } else {
        // Too early to jump from roof; ignore input.
        return;
    }
}

function updateAllObstacleSounds() {
    // When player moves, update which sound file plays for each obstacle
    gameState.obstacles.forEach(obstacle => {
        if (!obstacle.soundId || obstacle.type === 'coin' || obstacle.type === 'car') return;
        
        // Get current sound name and stop it
        const oldSoundName = obstacle.soundKey || getSoundNameForObstacle(obstacle);
        if (oldSoundName && sounds[oldSoundName]) {
            sounds[oldSoundName].stop(obstacle.soundId);
        }
        
        // Calculate relative position
        const relativeLane = obstacle.lane - gameState.playerLane;
        let newSound;
        
        if (obstacle.type === 'cane') {
            if (relativeLane < 0) {
                newSound = sounds.caneConcreteleft;
            } else if (relativeLane === 0) {
                newSound = sounds.caneConcretecenter;
            } else if (relativeLane > 0) {
                newSound = sounds.caneConcreteright;
            }
        } else if (obstacle.type === 'skateboard') {
            if (relativeLane < 0) {
                newSound = sounds.skateboardLeft;
            } else if (relativeLane === 0) {
                newSound = sounds.skateboardCenter;
            } else if (relativeLane > 0) {
                newSound = sounds.skateboardRight;
            }
        }
        
        // Play new sound and update volume based on distance
        if (newSound) {
            obstacle.soundId = newSound.play();
            newSound.loop(false, obstacle.soundId);
            obstacle.soundKey = getSoundKeyFromInstance(newSound);
            updateSingleObstacleSound(obstacle);
        }
    });
}

function updateSingleObstacleSound(obstacle) {
    if (!obstacle.soundId) return;
    
    const soundName = obstacle.soundKey || getSoundNameForObstacle(obstacle);
    if (!soundName || !sounds[soundName]) return;
    
    // Distance-based volume: louder as it gets closer (0-100 distance)
    // At distance 100: very quiet (0.05)
    // At distance 50: medium (0.3)
    // At distance 0: loud (1.0)
    let volume = 0;
    if (obstacle.distance > 0) {
        volume = Math.max(0.05, 1 - (obstacle.distance / 120));
    } else {
        // Fading out after passing
        volume = Math.max(0, 1 + (obstacle.distance / 10));
    }

    if (obstacle.type === 'skateboard') {
        volume = Math.min(1, volume * audioMix.skateboardApproachBoost);
    }
    
    // Apply volume
    sounds[soundName].volume(volume, obstacle.soundId);
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
    
    // 30% cane, 25% skateboard, 30% coin, 15% standing car
    if (random < 0.30) {
        obstacleType = 'cane';
    } else if (random < 0.55) {
        obstacleType = 'skateboard';
    } else if (random < 0.85) {
        obstacleType = 'coin';
    } else {
        obstacleType = 'car';
    }
    
    const lane = Math.floor(Math.random() * 3); // Random lane 0-2
    
    const obstacle = {
        id: nextObstacleId++,
        type: obstacleType,
        lane: lane,
        distance: 100, // Start at distance 100, moves toward 0 (player is at 0)
        coinAmount: obstacleType === 'coin' ? Math.floor(Math.random() * 1000) + 1 : 0,
        soundId: null, // Store the sound ID for this obstacle
        soundKey: null,
        carJumped: false,
        dodgeGraceApplied: false
    };
    
    gameState.obstacles.push(obstacle);
    
    // Play obstacle approach sound based on lane and store sound ID
    if (obstacleType === 'cane') {
        // Select sound based on lane
        let caneSound;
        if (lane === 0) {
            caneSound = sounds.caneConcreteleft;
        } else if (lane === 1) {
            caneSound = sounds.caneConcretecenter;
        } else {
            caneSound = sounds.caneConcreteright;
        }
        
        obstacle.soundId = caneSound.play();
        caneSound.loop(false, obstacle.soundId);
        obstacle.soundKey = getSoundKeyFromInstance(caneSound);
        
        // Set initial volume
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'skateboard') {
        // Select sound based on lane
        let skateboardSound;
        if (lane === 0) {
            skateboardSound = sounds.skateboardLeft;
        } else if (lane === 1) {
            skateboardSound = sounds.skateboardCenter;
        } else {
            skateboardSound = sounds.skateboardRight;
        }
        
        obstacle.soundId = skateboardSound.play();
        skateboardSound.loop(false, obstacle.soundId);
        obstacle.soundKey = getSoundKeyFromInstance(skateboardSound);
        
        // Set initial volume
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'coin') {
        // Coins don't make sound until collected
    } else if (obstacleType === 'car') {
        // No dedicated car-approach sound yet.
    }
}

function moveObstacles() {
    // Move all obstacles closer to player
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        obstacle.distance -= 1;

        // Update volume and panning continuously as obstacle moves
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
            if (obstacle.soundId) {
                const soundName = obstacle.soundKey || getSoundNameForObstacle(obstacle);
                if (soundName && sounds[soundName]) {
                    sounds[soundName].stop(obstacle.soundId);
                }
            }
            
            // Award points for avoiding obstacles (not coins)
            if (obstacle.type === 'skateboard') {
                gameState.score += 3;
                updateStatus(`Avoided skateboard! +3 points. Score: ${gameState.score}`);
            } else if (obstacle.type === 'cane') {
                gameState.score += 1;
                updateStatus(`Avoided cane! +1 point. Score: ${gameState.score}`);
            }
            // Note: Coins don't give points for avoiding, only for collecting

            if (obstacle.type === 'car' && gameState.onCarId === obstacle.id && !obstacle.carJumped) {
                gameState.onCarId = null;
                gameState.carRoofSteps = 0;
                fallFromCar();
            }
            
            gameState.obstacles.splice(i, 1);
            checkLevelUp();
        }
    }
}

function fallFromCar() {
    if (!gameState.running) return;

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

function getSoundKeyFromInstance(soundInstance) {
    for (const key in sounds) {
        if (sounds[key] === soundInstance) {
            return key;
        }
    }
    return null;
}

function getSoundNameForObstacle(obstacle) {
    if (obstacle.type === 'cane') {
        return 'caneConcretecenter'; // Always use center sound with dynamic panning
    } else if (obstacle.type === 'skateboard') {
        return 'skateboardCenter'; // Always use center sound with dynamic panning
    } else if (obstacle.type === 'car') {
        return null;
    }
    // Coins have no sound until collected
    return null;
}

function checkCollisions() {
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];

        if (
            obstacle.type === 'car' &&
            obstacle.lane === gameState.playerLane &&
            obstacle.distance <= 2 &&
            obstacle.distance >= -2 &&
            gameState.onCarId === null
        ) {
            gameState.onCarId = obstacle.id;
            gameState.carRoofSteps = 0;
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
                
                // Remove from obstacles array
                gameState.obstacles.splice(i, 1);
                
                // Play the pickup coin sound
                sounds.coinCollect.play();
                
                updateStatus(`Collected ${obstacle.coinAmount} coins! Score: ${gameState.score}`);
                checkLevelUp();
            }
            
            // Canes and skateboards hit at distance 2
            if ((obstacle.type === 'cane' || obstacle.type === 'skateboard') && obstacle.distance <= 2 && obstacle.distance >= -2) {
                // Hit by cane or skateboard - game over
                endGame(obstacle.type);
                return;
            }
        }
    }
}

function checkLevelUp() {
    const newLevel = Math.floor(gameState.score / 60) + 1;
    
    if (newLevel > gameState.level) {
        gameState.level = newLevel;
        gameState.speed = 1 + (gameState.level - 1) * 0.2; // 20% faster each level

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
    
    // Stop footstep sounds
    stopStepAudioLoops();
    document.removeEventListener('keydown', handleKeyPress);
    
    // Fade out obstacle sounds so death audio is clear
    const obstacleFadeDuration = 700;
    gameState.obstacles.forEach(obstacle => {
        if (obstacle.soundId) {
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
                fallFromCar();
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