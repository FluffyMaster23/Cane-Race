// Game state
let gameState = {
    running: false,
    playerLane: 1, // 0 = left, 1 = middle, 2 = right
    score: 0,
    level: 1,
    speed: 1,
    baseSpeed: 100, // Base speed in ms for obstacle movement
    obstacles: [], // Array of {type: 'cane'|'skateboard'|'coin', lane: 0-2, distance: number, coinAmount: number}
    lastObstacleSpawn: 0,
    spawnInterval: 2000,
    animationFrame: null
};

// Sound objects - ADD YOUR SOUND FILE NAMES HERE
const sounds = {
    // Player sounds
    jump: null, // new Howl({src: ['sounds/player/jump.mp3']}),
    turnLeft: null, // new Howl({src: ['sounds/player/turn_left.mp3']}),
    turnRight: null, // new Howl({src: ['sounds/player/turn_right.mp3']}),
    
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
    coinLoop: new Howl({src: ['sounds/items/coin/coin.wav'], loop: true}),
    
    // Obstacle sounds with stereo panning
    caneConcretecenter: new Howl({src: ['sounds/cane/cane_on_concrete_center.wav'], stereo: 0}),
    caneConcreteleft: new Howl({src:['sounds/cane/cane_on_concrete_left.wav'], stereo: -1}),
    caneConcreteright: new Howl({src: ['sounds/cane/cane_on_concrete_right.wav'], stereo: 1}),
caneCementcenter: new Howl({src: ['sounds/cane/cane_on_cement_center.wav'], stereo: 0}),
caneCementleft: new Howl({src: ['sounds/cane/cane_on_cement_left.wav'], stereo: -1}),
caneCementright: new Howl({src: ['sounds/cane/cane_on_cement_right.wav'], stereo: 1}),
skateboardCenter: new Howl({src: ['sounds/skateboard/skateboard_center.wav'], stereo: 0}),
skateboardLeft: new Howl({src: ['sounds/skateboard/skateboard_left.wav'], stereo: -1}),
skateboardRight: new Howl({src: ['sounds/skateboard/skateboard_right.wav'], stereo: 1}),

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
    
    updateStatus("Game started! Use arrow keys to play. Score: 0, Level: 1");
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
    // Update stereo panning for all active obstacles based on player position
    gameState.obstacles.forEach(obstacle => {
        if (obstacle.soundId) {
            // Calculate relative panning: -1 (left) to 1 (right)
            // If player is in lane 0, obstacle in lane 2 should sound right (1)
            // If player is in lane 2, obstacle in lane 0 should sound left (-1)
            const relativeLane = obstacle.lane - gameState.playerLane;
            let panValue = 0;
            
            if (relativeLane === -1) panValue = -1;      // Obstacle to the left
            else if (relativeLane === 1) panValue = 1;   // Obstacle to the right
            else panValue = 0;                            // Same lane
            
            // Get the base sound (center version) for this obstacle type
            let baseSound = null;
            if (obstacle.type === 'cane') {
                baseSound = sounds.caneConcretecenter;
            } else if (obstacle.type === 'skateboard') {
                baseSound = sounds.skateboardCenter;
            } else if (obstacle.type === 'coin') {
                baseSound = sounds.coinLoop;
            }
            
            if (baseSound) {
                baseSound.stereo(panValue, obstacle.soundId);
            }
        }
    });
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
    
    // Calculate initial panning based on relative position to player
    const relativeLane = lane - gameState.playerLane;
    let panValue = 0;
    
    if (relativeLane === -1) panValue = -1;      // Obstacle to the left
    else if (relativeLane === 1) panValue = 1;   // Obstacle to the right
    else panValue = 0;                            // Same lane
    
    // Play obstacle approach sound with dynamic panning
    if (obstacleType === 'cane') {
        sounds.caneConcretecenter.stereo(panValue);
        obstacle.soundId = sounds.caneConcretecenter.play();
    } else if (obstacleType === 'skateboard') {
        sounds.skateboardCenter.stereo(panValue);
        obstacle.soundId = sounds.skateboardCenter.play();
    } else if (obstacleType === 'coin') {
        // Play coin loop sound (it will loop continuously)
        if (sounds.coinLoop) {
            sounds.coinLoop.stereo(panValue);
            obstacle.soundId = sounds.coinLoop.play();
        }
    }
    
    gameState.obstacles.push(obstacle);
}

function moveObstacles() {
    // Move all obstacles closer to player
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        obstacle.distance -= 1;
        
        // Fade out sound when obstacle is passing by (if on different lane)
        if (obstacle.distance < 0 && obstacle.soundId && obstacle.lane !== gameState.playerLane) {
            const soundName = getSoundNameForObstacle(obstacle);
            if (soundName && sounds[soundName]) {
                sounds[soundName].fade(1, 0, 500, obstacle.soundId); // Fade out over 500ms
            }
        }
        
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
            
            gameState.obstacles.splice(i, 1);
            checkLevelUp();
        }
    }
}

function getSoundNameForObstacle(obstacle) {
    if (obstacle.type === 'cane') {
        return 'caneConcretecenter';
    } else if (obstacle.type === 'skateboard') {
        return 'skateboardCenter';
    } else if (obstacle.type === 'coin') {
        return 'coinLoop';
    }
    return null;
}

function checkCollisions() {
    for (let i = gameState.obstacles.length - 1; i >= 0; i--) {
        const obstacle = gameState.obstacles[i];
        
        // Check if obstacle is at player position (distance near 0) and in same lane
        if (obstacle.distance <= 2 && obstacle.distance >= -2 && obstacle.lane === gameState.playerLane) {
            
            if (obstacle.type === 'coin') {
                // Collect coin
                gameState.score += obstacle.coinAmount;
                
                // Stop the specific coin loop sound instance
                if (obstacle.soundId && sounds.coinLoop) {
                    sounds.coinLoop.stop(obstacle.soundId);
                }
                
                // Remove from obstacles array first
                gameState.obstacles.splice(i, 1);
                
                // Play the pickup coin sound after stopping the loop
                if (sounds.coinCollect) {
                    console.log('Attempting to play pickupcoin.wav, loaded:', sounds.coinCollect.state());
                    const pickupId = sounds.coinCollect.play();
                    console.log('Pickup sound ID:', pickupId);
                    
                    // Add event listener to check if it actually plays
                    sounds.coinCollect.once('play', function() {
                        console.log('pickupcoin.wav is now playing');
                    }, pickupId);
                }
                
                updateStatus(`Collected ${obstacle.coinAmount} coins! Score: ${gameState.score}`);
                checkLevelUp();
                
            } else {
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
    const newLevel = Math.floor(gameState.score / 100) + 1;
    
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
    
    // Stop all obstacle sounds including coin loops (but not the hit sound that just played)
    gameState.obstacles.forEach(obstacle => {
        if (obstacle.soundId) {
            const soundName = getSoundNameForObstacle(obstacle);
            if (soundName && sounds[soundName]) {
                sounds[soundName].stop(obstacle.soundId);
            }
        }
    });
    
    // Play game over sound later when implemented
    // playSound('gameOver');
    
    const hitType = hitBy === 'cane' ? 'cane' : 'skateboard';
    const message = `Game Over! You were hit by a ${hitType}. Final Score: ${gameState.score}`;
    
    updateStatus(message);
    announceToScreenReader(message);
    
    // Show play button again after a delay
    setTimeout(() => {
        document.getElementById("play").style.display = "inline-block";
    }, 2000);
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