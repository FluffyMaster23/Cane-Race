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
    spawnInterval: 2500, // Spawn obstacles every 2.5 seconds at level 1
    animationFrame: null
};

// Sound objects - ADD YOUR SOUND FILE NAMES HERE
const sounds = {
    // Player sounds
    jump: null, // new Howl({src: ['sounds/player/jump.mp3']}),
    turnLeft: new Howl({src: ['sounds/player/turn_left.wav']}),
    turnRight: new Howl({src: ['sounds/player/turn_right.wav']}),
    
    // Item sounds
    coinCollect: new Howl({
        src: ['sounds/items/coin/pickupcoin.wav'], 
        volume: 1.0,
        onload: function() {
            console.log('pickupcoin.wav loaded successfully');
        },
        onloaderror: function(id, error) {
            console.error('Failed to load pickupcoin.wav:', error);
        }
    }),
    
    // Obstacle sounds with spatial audio enabled
    caneConcretecenter: new Howl({src: ['sounds/cane/cane_on_concrete_center.wav'], stereo: true}),
    caneConcreteleft: new Howl({src:['sounds/cane/cane_on_concrete_left.wav']}),
    caneConcreteright: new Howl({src: ['sounds/cane/cane_on_concrete_right.wav']}),
caneCementcenter: new Howl({src: ['sounds/cane/cane_on_cement_center.wav']}),
caneCementleft: new Howl({src: ['sounds/cane/cane_on_cement_left.wav']}),
caneCementright: new Howl({src: ['sounds/cane/cane_on_cement_right.wav']}),
skateboardCenter: new Howl({src: ['sounds/skateboard/skateboard_center.wav'], stereo: true}),
skateboardLeft: new Howl({src: ['sounds/skateboard/skateboard_left.wav']}),
skateboardRight: new Howl({src: ['sounds/skateboard/skateboard_right.wav']}),

    caneHit: null, // new Howl({src: ['sounds/cane/hit.mp3']}),
    skateboardHit: new Howl({src: ['sounds/player/skateboardhit.wav']}),
    
    // Game sounds
    levelUp: null, // new Howl({src: ['sounds/level_up.mp3']}),
    playerSteps1: new Howl({src: ['sounds/player/concrete1.wav']}),
    playerSteps2: new Howl({src: ['sounds/player/concrete2.wav']}),
    playerSteps3: new Howl({src: ['sounds/player/concrete3.wav']}),
    gameOver: null // new Howl({src: ['sounds/game_over.mp3']})
};

// Footstep tracking
let currentFootstepIndex = 0;
let footstepInterval = null;

function startGame() {
    const playButton = document.getElementById("play");
    const gameArea = document.getElementById("gameArea");
    
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
        baseSpeed: 100,
        obstacles: [],
        lastObstacleSpawn: Date.now(),
        spawnInterval: 2000,
        animationFrame: null
    };
    
    // Set up keyboard controls
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
            if (gameState.playerLane > 0) {
                gameState.playerLane--;
                playSound('turnLeft');
                updateObstaclePanning(); // Update panning when player moves
            }
            break;
            
        case 'ArrowRight':
            e.preventDefault();
            if (gameState.playerLane < 2) {
                gameState.playerLane++;
                playSound('turnRight');
                updateObstaclePanning(); // Update panning when player moves
            }
            break;
            
        case 'ArrowUp':
            e.preventDefault();
            playSound('jump');
            break;
    }
}

function updateObstaclePanning() {
    // Update stereo panning and volume for all active obstacles based on player position and distance
    gameState.obstacles.forEach(obstacle => {
        updateSingleObstacleSound(obstacle);
    });
}

function updateSingleObstacleSound(obstacle) {
    if (!obstacle.soundId) return;
    
    const soundName = getSoundNameForObstacle(obstacle);
    if (!soundName || !sounds[soundName]) return;
    
    // Calculate relative lane position
    const relativeLane = obstacle.lane - gameState.playerLane;
    
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
    
    // Panning based on relative lane using pos() for spatial audio
    let panValue = relativeLane * 0.7; // -0.7 (left), 0 (center), 0.7 (right)
    panValue = Math.max(-1, Math.min(1, panValue)); // Clamp to -1 to 1
    
    // Apply volume and 3D position (x, y, z) where x is left/right
    sounds[soundName].volume(volume, obstacle.soundId);
    sounds[soundName].pos(panValue, 0, -1, obstacle.soundId);
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
    
    // 40% cane, 30% skateboard, 30% coin
    if (random < 0.4) {
        obstacleType = 'cane';
    } else if (random < 0.7) {
        obstacleType = 'skateboard';
    } else {
        obstacleType = 'coin';
    }
    
    const lane = Math.floor(Math.random() * 3); // Random lane 0-2
    
    const obstacle = {
        type: obstacleType,
        lane: lane,
        distance: 100, // Start at distance 100, moves toward 0 (player is at 0)
        coinAmount: obstacleType === 'coin' ? Math.floor(Math.random() * 1000) + 1 : 0,
        soundId: null // Store the sound ID for this obstacle
    };
    
    gameState.obstacles.push(obstacle);
    
    // Play obstacle approach sound based on lane and store sound ID
    if (obstacleType === 'cane') {
        // Calculate initial panning before playing
        const relativeLane = obstacle.lane - gameState.playerLane;
        const initialPan = relativeLane * 0.7;
        
        // Play with initial panning using pos()
        obstacle.soundId = sounds.caneConcretecenter.play();
        sounds.caneConcretecenter.pos(initialPan, 0, -1, obstacle.soundId);
        
        // Set initial volume
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'skateboard') {
        // Calculate initial panning before playing
        const relativeLane = obstacle.lane - gameState.playerLane;
        const initialPan = relativeLane * 0.7;
        
        // Play with initial panning using pos()
        obstacle.soundId = sounds.skateboardCenter.play();
        sounds.skateboardCenter.pos(initialPan, 0, -1, obstacle.soundId);
        
        // Set initial volume
        updateSingleObstacleSound(obstacle);
    } else if (obstacleType === 'coin') {
        // Coins don't make sound until collected
    }
}

function moveObstacles() {
    // Move all obstacles closer to player
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        obstacle.distance -= 1;
        
        // Update volume and panning continuously as obstacle moves
        updateSingleObstacleSound(obstacle);
        
        // Remove obstacles that passed the player without collision
        if (obstacle.distance < -5) {
            
            // Stop the sound if still playing
            if (obstacle.soundId) {
                const soundName = getSoundNameForObstacle(obstacle);
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
            
            gameState.obstacles.splice(i, 1);
            checkLevelUp();
        }
        
        // Special handling for coins: only remove if they passed AND player was in same lane
        // This prevents coins from disappearing when player dodges to another lane
        if (obstacle.type === 'coin' && obstacle.distance < -5 && obstacle.distance > -10) {
            // Coin is behind player but recently passed - check if player dodged it
            // If player is NOT in the coin's lane, keep the coin active longer
            if (obstacle.lane !== gameState.playerLane) {
                obstacle.distance = -4; // Keep it alive a bit longer
            }
        }
    }
}

function getSoundNameForObstacle(obstacle) {
    if (obstacle.type === 'cane') {
        return 'caneConcretecenter'; // Always use center sound with dynamic panning
    } else if (obstacle.type === 'skateboard') {
        return 'skateboardCenter'; // Always use center sound with dynamic panning
    }
    // Coins have no sound until collected
    return null;
}

function checkCollisions() {
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        
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
                const hitSound = obstacle.type === 'cane' ? 'caneHit' : 'skateboardHit';
                playSound(hitSound);
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
        
        playSound('levelUp');
        announceToScreenReader("Level up!");
        updateStatus(`Level up! Now level ${gameState.level}. Speed increased!`);
    }
}

function endGame(hitBy) {
    gameState.running = false;
    clearTimeout(gameState.animationFrame);
    
    // Stop footstep sounds
    stopFootsteps();
    
    // Stop all obstacle sounds including coin loops
    gameState.obstacles.forEach(obstacle => {
        if (obstacle.soundId) {
            const soundName = getSoundNameForObstacle(obstacle);
            if (soundName && sounds[soundName]) {
                sounds[soundName].stop(obstacle.soundId);
            }
        }
    });
    
    // Stop ALL sounds using Howler
    Howler.stop();
    
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
    currentFootstepIndex = 0;
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