document.addEventListener('DOMContentLoaded', function() {
    // Game grid
    const gridSize = 4;
    const gridContainer = document.getElementById('grid-container');
    let grid = [];
    let score = 0;
    let bestScore = localStorage.getItem('bestScore') || 0;
    
    // DOM elements
    const scoreElement = document.getElementById('score');
    const bestScoreElement = document.getElementById('best-score');
    const newGameButton = document.getElementById('new-game-btn');
    const retryButton = document.getElementById('retry-btn');
    const gameMessage = document.getElementById('game-message');
    
    // Initialize the game
    function initGame() {
        // Create grid cells
        gridContainer.innerHTML = '';
        for (let i = 0; i < gridSize * gridSize; i++) {
            const cell = document.createElement('div');
            cell.classList.add('grid-cell');
            gridContainer.appendChild(cell);
        }
        
        // Initialize game state
        grid = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
        score = 0;
        bestScoreElement.textContent = bestScore;
        scoreElement.textContent = '0';
        
        // Add initial tiles
        addRandomTile();
        addRandomTile();
        
        // Hide game message if visible
        gameMessage.style.display = 'none';
    }
    
    // Add a random tile to the grid
    function addRandomTile() {
        const availableCells = [];
        
        // Find all empty cells
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (grid[i][j] === 0) {
                    availableCells.push({row: i, col: j});
                }
            }
        }
        
        // If there are available cells
        if (availableCells.length > 0) {
            const randomCell = availableCells[Math.floor(Math.random() * availableCells.length)];
            const value = Math.random() < 0.9 ? 2 : 4; // 90% chance for 2, 10% chance for 4
            grid[randomCell.row][randomCell.col] = value;
            
            // Create and animate the tile
            const tile = document.createElement('div');
            tile.classList.add('tile', `tile-${value}`);
            tile.textContent = value;
            
            // Position the tile
            const cellSize = (gridContainer.offsetWidth - (gridSize - 1) * 15) / gridSize;
            tile.style.width = `${cellSize}px`;
            tile.style.height = `${cellSize}px`;
            tile.style.left = `${randomCell.col * (cellSize + 15) + 15}px`;
            tile.style.top = `${randomCell.row * (cellSize + 15) + 15}px`;
            
            // Add animation class
            tile.style.transform = 'scale(0)';
            gridContainer.appendChild(tile);
            
            // Trigger animation
            setTimeout(() => {
                tile.style.transform = 'scale(1)';
            }, 50);
        }
    }
    
    // Update the display based on the grid state
    function updateDisplay() {
        // Clear existing tiles
        const tiles = document.querySelectorAll('.tile');
        tiles.forEach(tile => tile.remove());
        
        // Create new tiles based on grid state
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (grid[i][j] !== 0) {
                    const tile = document.createElement('div');
                    tile.classList.add('tile');
                    if (grid[i][j] <= 2048) {
                        tile.classList.add(`tile-${grid[i][j]}`);
                    } else {
                        tile.classList.add('tile-super');
                    }
                    tile.textContent = grid[i][j];
                    
                    // Position the tile
                    const cellSize = (gridContainer.offsetWidth - (gridSize - 1) * 15) / gridSize;
                    tile.style.width = `${cellSize}px`;
                    tile.style.height = `${cellSize}px`;
                    tile.style.left = `${j * (cellSize + 15) + 15}px`;
                    tile.style.top = `${i * (cellSize + 15) + 15}px`;
                    
                    gridContainer.appendChild(tile);
                }
            }
        }
        
        // Update score
        scoreElement.textContent = score;
        
        // Update best score if needed
        if (score > bestScore) {
            bestScore = score;
            bestScoreElement.textContent = bestScore;
            localStorage.setItem('bestScore', bestScore);
        }
        
        // Check game status
        if (checkWin()) {
            gameMessage.querySelector('p').textContent = 'You Win!';
            gameMessage.classList.add('game-won');
            gameMessage.style.display = 'flex';
        } else if (checkLose()) {
            gameMessage.querySelector('p').textContent = 'Game Over!';
            gameMessage.classList.remove('game-won');
            gameMessage.classList.add('game-over');
            gameMessage.style.display = 'flex';
        }
    }
    
    // Move tiles logic
    function moveTiles(direction) {
        let moved = false;
        const directionMap = {
            'up': {x: 0, y: -1},
            'right': {x: 1, y: 0},
            'down': {x: 0, y: 1},
            'left': {x: -1, y: 0}
        };
        
        const vector = directionMap[direction];
        
        // Helper functions for traversal
        function traverseGrid(callback) {
            if (direction === 'up' || direction === 'left') {
                for (let i = 0; i < gridSize; i++) {
                    for (let j = 0; j < gridSize; j++) {
                        callback(i, j);
                    }
                }
            } else {
                for (let i = gridSize - 1; i >= 0; i--) {
                    for (let j = gridSize - 1; j >= 0; j--) {
                        callback(i, j);
                    }
                }
            }
        }
        
        // Find farthest position and next position with same value
        function findFarthestPosition(row, col) {
            let nextRow = row + vector.y;
            let nextCol = col + vector.x;
            
            // Progress towards the vector direction until an obstacle is found
            while (
                nextRow >= 0 && nextRow < gridSize &&
                nextCol >= 0 && nextCol < gridSize &&
                grid[nextRow][nextCol] === 0
            ) {
                row = nextRow;
                col = nextCol;
                nextRow = row + vector.y;
                nextCol = col + vector.x;
            }
            
            // Check if next position has the same value (for merging)
            let canMerge = false;
            if (
                nextRow >= 0 && nextRow < gridSize &&
                nextCol >= 0 && nextCol < gridSize &&
                grid[nextRow][nextCol] === grid[row - vector.y][col - vector.x]
            ) {
                canMerge = true;
            }
            
            return {
                farthest: {row, col},
                next: {row: nextRow, col: nextCol},
                canMerge
            };
        }
        
        // Move tiles in the specified direction
        traverseGrid((i, j) => {
            if (grid[i][j] !== 0) {
                const pos = findFarthestPosition(i, j);
                
                if (pos.canMerge) {
                    // Merge tiles
                    const value = grid[i][j] * 2;
                    grid[pos.next.row][pos.next.col] = value;
                    grid[i][j] = 0;
                    score += value;
                    moved = true;
                } else if (pos.farthest.row !== i || pos.farthest.col !== j) {
                    // Move tile
                    grid[pos.farthest.row][pos.farthest.col] = grid[i][j];
                    grid[i][j] = 0;
                    moved = true;
                }
            }
        });
        
        return moved;
    }
    
    // Check if player has won
    function checkWin() {
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (grid[i][j] === 2048) {
                    return true;
                }
            }
        }
        return false;
    }
    
    // Check if there are no more moves
    function checkLose() {
        // Check for empty cells
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (grid[i][j] === 0) {
                    return false;
                }
            }
        }
        
        // Check for possible merges
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (
                    (i < gridSize - 1 && grid[i][j] === grid[i + 1][j]) ||
                    (j < gridSize - 1 && grid[i][j] === grid[i][j + 1])
                ) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    // Handle keyboard inputs
    function handleKeydown(e) {
        let moved = false;
        
        switch(e.key) {
            case 'ArrowUp':
                moved = moveTiles('up');
                break;
            case 'ArrowRight':
                moved = moveTiles('right');
                break;
            case 'ArrowDown':
                moved = moveTiles('down');
                break;
            case 'ArrowLeft':
                moved = moveTiles('left');
                break;
            default:
                return;
        }
        
        if (moved) {
            addRandomTile();
            updateDisplay();
        }
        
        e.preventDefault();
    }
    
    // Set up event listeners
    function setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', handleKeydown);
        
        // New game button
        newGameButton.addEventListener('click', () => {
            initGame();
            updateDisplay();
        });
        
        // Retry button
        retryButton.addEventListener('click', () => {
            initGame();
            updateDisplay();
        });
        
        // Touch events for mobile
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        
        gridContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, false);
        
        gridContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].clientX;
            touchEndY = e.changedTouches[0].clientY;
            
            const dx = touchEndX - touchStartX;
            const dy = touchEndY - touchStartY;
            
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
                // Horizontal swipe
                const direction = dx > 0 ? 'right' : 'left';
                const moved = moveTiles(direction);
                if (moved) {
                    addRandomTile();
                    updateDisplay();
                }
            } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20) {
                // Vertical swipe
                const direction = dy > 0 ? 'down' : 'up';
                const moved = moveTiles(direction);
                if (moved) {
                    addRandomTile();
                    updateDisplay();
                }
            }
            
            e.preventDefault();
        }, false);
    }
    
    // Initialize the game
    initGame();
    updateDisplay();
    setupEventListeners();
});
