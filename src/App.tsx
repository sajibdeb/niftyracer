import React, { useState, useEffect, useCallback, useRef, useImperativeHandle } from 'react'
import { ethers } from 'ethers'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import {
  Platform,
  detectPlatform,
  shareToFarcasterSDK,
  shareToWarpcast,
  shareToTwitter,
  copyShareLink,
  shareNative,
  canUseNativeShare,
  type ShareScoreParams
} from './lib/share'
import { isInFarcasterMiniapp, getFarcasterProvider } from './lib/farcaster'

// ============ CONFIG - UPDATE THESE ============
const CONFIG = {
  // NGold token address (soulbound ERC20)
  NGOLD_TOKEN: import.meta.env.VITE_NGOLD_TOKEN || '',
  // NFT Cars contract address
  NFT_CONTRACT: import.meta.env.VITE_NFT_CONTRACT || '',
  // Game contract address
  GAME_CONTRACT: import.meta.env.VITE_GAME_CONTRACT || '',
  // Chain ID (8453 = Base Mainnet)
  CHAIN_ID: 8453,
  CHAIN_NAME: 'Base',
  // Public RPC for event queries (MetaMask RPC has strict rate limits)
  RPC_URL: import.meta.env.VITE_RPC_URL || '',
  // Starter car fee in ETH
  STARTER_CAR_FEE: '0.0005',
}

// ============ ABIs ============
// NGold Token ABI (soulbound - no transfers)
const NGOLD_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function frozen(address) view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]

// NFT Cars ABI
const CARS_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function hasStarterCar(address player) view returns (bool)',
  'function getSpeedBonus(uint256 tokenId) view returns (uint8)',
  'function tokenCarType(uint256 tokenId) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]

// Game Contract ABI (v1.1.0 - direct score submission)
const GAME_ABI = [
  // Car claim & purchase (payable - ETH required)
  'function claimStarterCar() payable',
  'function buyCar(uint256 carTypeId) payable',
  'function equipCar(uint256 tokenId)',

  // Score submission (direct - no signature needed)
  'function submitScore(uint256 score, uint256 neon)',
  'function submitScoresBatch(uint256[] scores, uint256[] neons)',

  // View functions
  'function starterCarFee() view returns (uint256)',
  'function carPrices(uint256 typeId) view returns (uint256)',
  'function activeCar(address player) view returns (uint256)',
  'function highScores(address player) view returns (uint256)',
  'function gamesPlayed(address player) view returns (uint256)',
  'function lifetimeMinted(address player) view returns (uint256)',
  'function totalPlayers() view returns (uint256)',
  'function totalGamesPlayed() view returns (uint256)',
  'function totalNGoldMinted() view returns (uint256)',
  'function totalETHRevenue() view returns (uint256)',

  // Aggregate view
  'function getPlayerData(address player) view returns (uint256 playerActiveCar, uint256 playerHighScore, uint256 playerGamesPlayed, uint256 playerLifetimeMinted, uint256 playerNonce, uint256 ngoldBalance, bool isFrozen)',
  'function getCarPrices() view returns (uint256[])',
  'function getGameStats() view returns (uint256 _totalPlayers, uint256 _totalGamesPlayed, uint256 _totalNGoldMinted, uint256 _totalETHRevenue)',

  // Events for leaderboard
  'event HighScoreUpdated(address indexed player, uint256 newHighScore)',
  'event GameCompleted(address indexed player, uint256 score, uint256 neon, uint256 reward, uint256 nonce)',
]

// Car types (hardcoded - matches contract typeId 1-5)
// PRICES MUST MATCH NiftyRacerGame.sol constructor values!
const CAR_TYPES = [
  { typeId: 1, name: 'Starter', speedBonus: 0, priceETH: '0.0005', soulbound: true },
  { typeId: 2, name: 'Speedster', speedBonus: 10, priceETH: '0.0033', soulbound: false },
  { typeId: 3, name: 'Turbo', speedBonus: 25, priceETH: '0.01', soulbound: false },
  { typeId: 4, name: 'Neon Beast', speedBonus: 50, priceETH: '0.022', soulbound: false },
  { typeId: 5, name: 'Legendary', speedBonus: 100, priceETH: '0.05', soulbound: false },
]

// ============ Types ============
interface Car {
  typeId: number      // Contract car type (1-5)
  tokenId: number     // Actual NFT token ID (0 if not owned)
  name: string
  priceETH: string
  bonus: number
  owned: boolean
  soulbound: boolean
}

interface PlayerData {
  activeCar: number
  highScore: bigint
  gamesPlayed: bigint
  lifetimeMinted: bigint
  tokenBalance: bigint
  isFrozen: boolean
}

interface LocalGameResult {
  score: number
  neonsCollected: number
  timestamp: number
}

interface LeaderboardEntry {
  address: string
  score: bigint
  rank: number
}

// Local storage helpers
const STORAGE_KEY = 'neon_racer_pending_games'

const getLocalGames = (): LocalGameResult[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

const saveLocalGame = (score: number, neonsCollected: number) => {
  const games = getLocalGames()
  games.push({ score, neonsCollected, timestamp: Date.now() })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games))
}

const clearLocalGames = () => {
  localStorage.removeItem(STORAGE_KEY)
}

const getLocalPendingReward = (carBonus: number = 0): number => {
  const games = getLocalGames()
  const baseReward = games.reduce((total, g) => {
    if (g.score > 100 || g.neonsCollected >= 1) {
      return total + Math.floor(g.score / 1000) + g.neonsCollected
    }
    return total
  }, 0)
  // Apply car bonus percentage
  return Math.floor(baseReward * (100 + carBonus) / 100)
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

// ============ Toast Component ============
function ToastContainer({ toasts, removeToast }: { toasts: Toast[], removeToast: (id: number) => void }) {
  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return '✓'
      case 'error': return '✕'
      case 'info': return 'ℹ'
      default: return ''
    }
  }

  return (
    <div className="toast-container">
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          style={{ animationDelay: `${index * 0.1}s` }}
          onClick={() => removeToast(toast.id)}
        >
          <span className="toast-icon">{getIcon(toast.type)}</span>
          <span className="toast-message">{toast.message}</span>
          <span className="toast-close">×</span>
        </div>
      ))}
    </div>
  )
}

// ============ Game Component ============
interface GameRef {
  moveLeft: () => void
  moveRight: () => void
  start: () => void
}

interface GameProps {
  onGameOver: (score: number, neonsCollected: number) => void
  activeCar: Car | null
  onBackToHome?: () => void
}


const NeonRacerGame = React.forwardRef<GameRef, GameProps>(({ onGameOver, activeCar, onBackToHome }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameState, setGameState] = useState<'start' | 'playing' | 'over'>('start')
  const [displayScore, setDisplayScore] = useState(0)
  const [displayNeonCount, setDisplayNeonCount] = useState(0)
  const [showGameOverPopup, setShowGameOverPopup] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [platform, setPlatform] = useState<Platform>('browser')
  const [copySuccess, setCopySuccess] = useState(false)
  const gameRef = useRef<any>({})
  const animationFrameRef = useRef<number | null>(null)
  const onGameOverRef = useRef(onGameOver)
  const activeCarRef = useRef(activeCar)

  // Keep refs updated
  useEffect(() => { onGameOverRef.current = onGameOver }, [onGameOver])
  useEffect(() => { activeCarRef.current = activeCar }, [activeCar])

  // Detect platform on mount
  useEffect(() => {
    detectPlatform().then(setPlatform)
  }, [])

  // Get share params
  const getShareParams = (): ShareScoreParams => ({
    score: displayScore,
    neonsCollected: displayNeonCount,
    nGoldEarned: Math.floor(displayScore / 1000) + displayNeonCount,
    carName: activeCar?.name
  })

  // Share handlers for different platforms
  const handleShareFarcaster = async () => {
    if (isSharing) return
    setIsSharing(true)
    try {
      if (platform === 'farcaster' || platform === 'base') {
        await shareToFarcasterSDK(getShareParams())
      } else {
        shareToWarpcast(getShareParams())
      }
      setShowShareMenu(false)
    } catch (error) {
      console.error('Farcaster share failed:', error)
    } finally {
      setIsSharing(false)
    }
  }

  const handleShareTwitter = () => {
    shareToTwitter(getShareParams())
    setShowShareMenu(false)
  }

  const handleCopyLink = async () => {
    const success = await copyShareLink(getShareParams())
    if (success) {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }
    setShowShareMenu(false)
  }

  const handleNativeShare = async () => {
    if (isSharing) return
    setIsSharing(true)
    try {
      await shareNative(getShareParams())
      setShowShareMenu(false)
    } catch (error) {
      console.error('Native share failed:', error)
    } finally {
      setIsSharing(false)
    }
  }

  // Main share button click
  const handleShareClick = async () => {
    if (platform === 'farcaster' || platform === 'base') {
      // Direct share in miniapp context
      await handleShareFarcaster()
    } else {
      // Show share menu in browser
      setShowShareMenu(true)
    }
  }

  // Delay game over popup by 300ms
  useEffect(() => {
    if (gameState === 'over') {
      const timer = setTimeout(() => setShowGameOverPopup(true), 300)
      return () => clearTimeout(timer)
    }
  }, [gameState])

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    moveLeft: () => gameRef.current.moveLeft?.(),
    moveRight: () => gameRef.current.moveRight?.(),
    start: () => gameRef.current.start?.(),
  }))

  const initGame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const game = gameRef.current
    game.canvas = canvas
    game.ctx = ctx
    game.running = false
    game.score = 0
    game.speed = 2  // Start at BEGINNER difficulty base speed
    game.frameCount = 0
    game.obstacles = []
    game.powerUps = []
    game.particles = []
    game.stars = []
    game.lastDifficultyLevel = 'EASY'  // Track difficulty level changes
    game.neonsCollected = 0  // Track NEONs collected this game

    // Load NEON logo for coins
    const neonLogo = new Image()
    neonLogo.src = '/img/neon.png'
    game.neonLogo = neonLogo

    // Load car sprites - 1 to 5 for player cars (Starter, Speedster, Turbo, Neon Beast, Legendary)
    const playerCarFiles = ['1.png', '2.png', '3.png', '4.png', '5.png']
    const obstacleSpriteNames = ['Logan', 'Sandero', 'Tipo', 'Jimny', 'Giulietta', '500x', 'Polo', 'Beetle']

    game.playerSprites = playerCarFiles.map(file => {
      const img = new Image()
      img.src = `/img/sprite/${file}`
      return img
    })

    game.obstacleSprites = obstacleSpriteNames.map(name => {
      const img = new Image()
      img.src = `/img/sprite/${name}.png`
      return img
    })

    // Road
    game.laneCount = 3
    game.laneWidth = canvas.width / 5
    game.roadLeft = game.laneWidth
    game.roadRight = canvas.width - game.laneWidth

    // Player car - sprite based on car type (typeId 1-5 maps to sprite index 0-4)
    const playerSpriteIndex = Math.min((activeCarRef.current?.typeId || 1) - 1, game.playerSprites.length - 1)

    // Unique glow colors for each car type (1-5)
    const carGlowColors = ['#0ff', '#f0f', '#0f0', '#f60', '#a0f'] // cyan, pink, green, orange, purple
    const playerGlowColor = carGlowColors[playerSpriteIndex] || '#0ff'

    game.player = {
      width: 65,  // 80% of original (75)
      height: 85,
      lane: 1,
      x: 0,
      y: canvas.height - 100,
      targetX: 0,
      sprite: game.playerSprites[playerSpriteIndex],
      color: playerGlowColor, // Unique glow color based on car type
    }
    game.player.x = game.roadLeft + (game.player.lane + 0.5) * game.laneWidth - game.player.width / 2
    game.player.targetX = game.player.x

    // Stars
    game.stars = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 2 + 1,
    }))

    const neonColors = ['#f0f', '#0f0', '#ff0', '#f60', '#f00']

    const createObstacle = () => {
      const lane = Math.floor(Math.random() * game.laneCount)
      const spriteIndex = Math.floor(Math.random() * game.obstacleSprites.length)
      game.obstacles.push({
        x: game.roadLeft + (lane + 0.5) * game.laneWidth - 32,
        y: -100,
        width: 65,
        height: 85,
        sprite: game.obstacleSprites[spriteIndex],
        color: neonColors[Math.floor(Math.random() * neonColors.length)],
      })
    }

    const createPowerUp = () => {
      const lane = Math.floor(Math.random() * game.laneCount)
      game.powerUps.push({
        x: game.roadLeft + (lane + 0.5) * game.laneWidth - 30,
        y: -60,
        width: 60,
        height: 60,
        type: Math.random() > 0.5 ? 'coin' : 'boost',
        rotation: 0,
      })
    }

    const createParticles = (x: number, y: number, color: string, count = 10) => {
      for (let i = 0; i < count; i++) {
        game.particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 1, color, size: Math.random() * 5 + 2 })
      }
    }

    const checkCollision = (r1: any, r2: any) =>
      r1.x < r2.x + r2.width && r1.x + r1.width > r2.x && r1.y < r2.y + r2.height && r1.y + r1.height > r2.y

    const drawCar = (x: number, y: number, w: number, h: number, color: string, sprite?: HTMLImageElement, isPlayer = false) => {
      ctx.save()
      ctx.shadowBlur = isPlayer ? 25 : 15
      ctx.shadowColor = color

      // Try to draw sprite if available and loaded
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        // Draw sprite (no rotation needed - sprites are in correct orientation)
        ctx.drawImage(sprite, x - 5, y, w + 10, h)
        // Draw again for stronger glow effect on player car
        if (isPlayer) {
          ctx.globalAlpha = 0.3
          ctx.drawImage(sprite, x - 5, y, w + 10, h)
        }
      } else {
        // Fallback to programmatic drawing
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(x, y + h * 0.2, w, h * 0.6, 5)
        ctx.fill()
        ctx.beginPath()
        ctx.roundRect(x + 5, y, w - 10, h * 0.25, [5, 5, 0, 0])
        ctx.fill()
        ctx.beginPath()
        ctx.roundRect(x + 5, y + h * 0.75, w - 10, h * 0.25, [0, 0, 5, 5])
        ctx.fill()
        if (isPlayer) {
          ctx.fillStyle = '#fff'
          ctx.shadowColor = '#fff'
          ctx.beginPath()
          ctx.arc(x + 8, y + 5, 4, 0, Math.PI * 2)
          ctx.arc(x + w - 8, y + 5, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    }

    // Get difficulty level based on score
    const getDifficulty = (score: number) => {
      if (score < 4000) return { name: 'BEGINNER', maxSpeed: 4, baseSpeed: 2, spawnRate: 120, powerUpChance: 0.92 }
      if (score < 8000) return { name: 'EASY', maxSpeed: 6, baseSpeed: 3.5, spawnRate: 100, powerUpChance: 0.85 }
      if (score < 13000) return { name: 'MEDIUM', maxSpeed: 9, baseSpeed: 6, spawnRate: 70, powerUpChance: 0.7 }
      if (score < 21000) return { name: 'HARD', maxSpeed: 13, baseSpeed: 9, spawnRate: 50, powerUpChance: 0.6 }
      return { name: 'EXTREME', maxSpeed: 16, baseSpeed: 12, spawnRate: 40, powerUpChance: 0.5 }
    }

    const update = () => {
      // Always update particles (even when game is over for crash animation)
      game.particles = game.particles.filter((p: any) => {
        p.x += p.vx; p.y += p.vy; p.life -= 0.02; p.vy += 0.2
        return p.life > 0
      })

      if (!game.running) return
      game.frameCount++
      game.player.x += (game.player.targetX - game.player.x) * 0.2

      // Get current difficulty
      const difficulty = getDifficulty(game.score)

      // Check if difficulty level changed - bump speed to new baseSpeed
      if (game.lastDifficultyLevel !== difficulty.name) {
        game.lastDifficultyLevel = difficulty.name
        game.speed = Math.max(game.speed, difficulty.baseSpeed)
      }

      game.stars.forEach((s: any) => {
        s.y += s.speed * (game.speed / 5)
        if (s.y > canvas.height) { s.y = 0; s.x = Math.random() * canvas.width }
      })

      // Dynamic spawn rate based on difficulty
      const spawnInterval = Math.floor(difficulty.spawnRate - game.speed * 1.2)
      if (game.frameCount % Math.max(spawnInterval, 18) === 0) {
        createObstacle()
        if (Math.random() > difficulty.powerUpChance) createPowerUp()
      }

      game.obstacles = game.obstacles.filter((obs: any) => {
        obs.y += game.speed
        if (checkCollision(game.player, obs)) {
          game.running = false
          // Big explosion effect with multiple colors
          const crashX = game.player.x + game.player.width / 2
          const crashY = game.player.y + game.player.height / 2
          createParticles(crashX, crashY, '#f00', 25)  // Red
          createParticles(crashX, crashY, '#ff0', 20)  // Yellow
          createParticles(crashX, crashY, '#f60', 15)  // Orange
          createParticles(crashX, crashY, '#fff', 10)  // White sparks
          setGameState('over')
          onGameOverRef.current(game.score, game.neonsCollected)
          return true  // Keep enemy car visible on crash
        }
        return obs.y < canvas.height + 100
      })

      game.powerUps = game.powerUps.filter((pu: any) => {
        pu.y += game.speed
        pu.rotation += 0.1
        if (checkCollision(game.player, pu)) {
          if (pu.type === 'coin') {
            game.score += 500  // +500 score per NEON
            game.neonsCollected++  // Track NEON collected
            setDisplayNeonCount(game.neonsCollected)
            createParticles(pu.x + 15, pu.y + 15, '#0ff', 15)
          } else {
            // Boost limited by difficulty max speed
            game.speed = Math.min(game.speed + 0.5, difficulty.maxSpeed)
            createParticles(pu.x + 15, pu.y + 15, '#0f0', 15)
          }
          return false
        }
        return pu.y < canvas.height + 50
      })

      // Gradual speed increase based on difficulty level
      if (game.frameCount % 200 === 0) {
        game.speed = Math.min(game.speed + 0.25, difficulty.maxSpeed)
      }

      game.score += 1 + Math.floor(game.speed / 5)  // Base 1 point + speed bonus

      // Throttle React state updates to every 10 frames
      if (game.frameCount % 10 === 0) {
        setDisplayScore(game.score)
      }
    }

    const render = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
      gradient.addColorStop(0, '#0a0a1a')
      gradient.addColorStop(1, '#1a0a2e')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      game.stars.forEach((s: any) => {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.5})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      })

      const roadGrad = ctx.createLinearGradient(game.roadLeft, 0, game.roadRight, 0)
      roadGrad.addColorStop(0, '#1a1a2e')
      roadGrad.addColorStop(0.5, '#16213e')
      roadGrad.addColorStop(1, '#1a1a2e')
      ctx.fillStyle = roadGrad
      ctx.fillRect(game.roadLeft, 0, game.roadRight - game.roadLeft, canvas.height)

      ctx.shadowBlur = 10
      ctx.strokeStyle = '#f0f'
      ctx.shadowColor = '#f0f'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(game.roadLeft, 0)
      ctx.lineTo(game.roadLeft, canvas.height)
      ctx.stroke()
      ctx.strokeStyle = '#0ff'
      ctx.shadowColor = '#0ff'
      ctx.beginPath()
      ctx.moveTo(game.roadRight, 0)
      ctx.lineTo(game.roadRight, canvas.height)
      ctx.stroke()

      ctx.setLineDash([30, 20])
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      for (let i = 1; i < game.laneCount; i++) {
        const x = game.roadLeft + i * game.laneWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvas.height)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.shadowBlur = 0

      game.obstacles.forEach((obs: any) => drawCar(obs.x, obs.y, obs.width, obs.height, obs.color, obs.sprite, false))

      game.powerUps.forEach((pu: any) => {
        ctx.save()
        ctx.translate(pu.x + 15, pu.y + 15)
        ctx.shadowBlur = 15
        if (pu.type === 'coin') {
          // Simple coin - no extra glow, same style as gas pump
          ctx.shadowColor = '#0ff'
          ctx.shadowBlur = 15
          // Draw NEON logo clipped to a circle
          ctx.save()
          ctx.beginPath()
          ctx.arc(0, 0, 14, 0, Math.PI * 2)
          ctx.clip()
          if (game.neonLogo && game.neonLogo.complete) {
            ctx.drawImage(game.neonLogo, -14, -14, 28, 28)
          } else {
            ctx.fillStyle = '#ff0'
            ctx.fill()
          }
          ctx.restore()
        } else {
          // Draw gas pump emoji
          ctx.shadowColor = '#0f0'
          ctx.shadowBlur = 15
          ctx.font = '26px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('⛽', 0, 0)
        }
        ctx.restore()
      })

      drawCar(game.player.x, game.player.y, game.player.width, game.player.height, game.player.color, game.player.sprite, true)

      game.particles.forEach((p: any) => {
        ctx.save()
        ctx.globalAlpha = p.life
        ctx.shadowBlur = 10
        ctx.shadowColor = p.color
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })
    }

    const gameLoop = () => {
      update()
      render()
      animationFrameRef.current = requestAnimationFrame(gameLoop)
    }

    game.moveLeft = () => {
      if (game.player.lane > 0) {
        game.player.lane--
        game.player.targetX = game.roadLeft + (game.player.lane + 0.5) * game.laneWidth - game.player.width / 2
      }
    }

    game.moveRight = () => {
      if (game.player.lane < game.laneCount - 1) {
        game.player.lane++
        game.player.targetX = game.roadLeft + (game.player.lane + 0.5) * game.laneWidth - game.player.width / 2
      }
    }

    game.start = () => {
      game.running = true
      game.score = 0
      game.speed = 2  // Start at BEGINNER difficulty base speed
      game.frameCount = 0
      game.obstacles = []
      game.powerUps = []
      game.particles = []
      game.player.lane = 1
      game.player.x = game.roadLeft + (game.player.lane + 0.5) * game.laneWidth - game.player.width / 2
      game.player.targetX = game.player.x
      game.lastDifficultyLevel = 'BEGINNER'  // Reset difficulty tracking
      game.neonsCollected = 0  // Reset NEON counter
      setDisplayScore(0)
      setDisplayNeonCount(0)
      setShowGameOverPopup(false)
      setGameState('playing')
    }

    // Cancel any existing game loop before starting a new one
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    animationFrameRef.current = requestAnimationFrame(gameLoop)
  }, []) // No dependencies - uses refs instead

  useEffect(() => {
    initGame()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameRef.current.running) return
      if (e.key === 'ArrowLeft' || e.key === 'a') gameRef.current.moveLeft()
      if (e.key === 'ArrowRight' || e.key === 'd') gameRef.current.moveRight()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      // Clean up animation frame on unmount
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [initGame])

  return (
    <div className="game-container relative" style={{ width: 380, height: 550 }}>
      <canvas
        ref={canvasRef}
        width={380}
        height={550}
        id="gameCanvas"
        onClick={(e) => {
          if (!gameRef.current.running) return
          const rect = e.currentTarget.getBoundingClientRect()
          if (e.clientX - rect.left < 190) gameRef.current.moveLeft()
          else gameRef.current.moveRight()
        }}
        onTouchStart={(e) => {
          if (!gameRef.current.running) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          if (e.touches[0].clientX - rect.left < 190) gameRef.current.moveLeft()
          else gameRef.current.moveRight()
        }}
      />

      <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
        <div>
          <span className="neon-cyan font-bold text-lg">SCORE: {displayScore}</span>
          <div className="flex items-center gap-1 mt-1">
            <img src="/img/neon.png" alt="NEON" className="w-5 h-5 rounded-full" />
            <span className="neon-yellow font-bold">{displayNeonCount}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {activeCar && <span className="neon-pink text-sm">+{activeCar.bonus}% bonus</span>}
        </div>
      </div>

      {
        gameState === 'start' && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center rounded-xl">
            <h2 className="text-3xl neon-cyan mb-4 animate-glow">NIFTY RACER</h2>
            <p className="text-gray-400 text-lg mb-2">← → or tap to move</p>
            <p className="text-gray-500 text-base mb-6">Dodge traffic, collect coins!</p>
            <button onClick={() => gameRef.current.start()} className="neon-btn">START RACE</button>
          </div>
        )
      }

      {
        showGameOverPopup && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center rounded-xl animate-fade-in">
            <h2 className="text-2xl neon-pink mb-2">GAME OVER</h2>
            <p className="text-5xl neon-cyan mb-2">{displayScore}</p>
            <div className="flex items-center gap-2 mb-3">
              <img src="/img/neon.png" alt="NEON" className="w-6 h-6 rounded-full" />
              <span className="neon-yellow text-xl">{displayNeonCount} collected</span>
            </div>

            {displayScore > 100 || displayNeonCount >= 1 ? (
              <div className="bg-green-500/20 border border-green-500 rounded-lg p-3 mb-4 text-center">
                <p className="text-green-400 text-sm mb-1">🎉 You earned:</p>
                <p className="text-2xl neon-green font-bold">
                  +{Math.floor(displayScore / 1000) + displayNeonCount} NiftyGold
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  ({Math.floor(displayScore / 1000)} from score + {displayNeonCount} collected)
                </p>
                <p className="text-green-400 text-xs mt-2">Added to claimable rewards!</p>
              </div>
            ) : (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 mb-4 text-center">
                <p className="text-red-400 text-sm">No rewards earned</p>
                <p className="text-gray-400 text-xs mt-1">Need score &gt;100 OR collect 1+ NEON</p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button onClick={() => gameRef.current.start()} className="neon-btn">RACE AGAIN</button>
              <div className="flex flex-col gap-1 relative">
                {/* Share Button */}
                <button
                  onClick={handleShareClick}
                  disabled={isSharing}
                  className="neon-btn-purple flex items-center justify-center gap-2"
                  style={{ transform: 'scale(0.7)', transformOrigin: 'center' }}
                >
                  {isSharing ? (
                    <>Sharing...</>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                      </svg>
                      {platform === 'farcaster' || platform === 'base' ? 'Share Score' : 'Share Score'}
                    </>
                  )}
                </button>

                {/* Share Menu (browser only) */}
                {showShareMenu && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 bg-black/50 z-40"
                      onClick={() => setShowShareMenu(false)}
                    />
                    {/* Menu */}
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-xl p-4 min-w-[220px] z-50"
                      style={{
                        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%)',
                        border: '2px solid #a855f7',
                        boxShadow: '0 0 20px rgba(168, 85, 247, 0.4), 0 0 40px rgba(168, 85, 247, 0.2)'
                      }}
                    >
                      <div className="text-sm text-purple-300 text-center mb-3 font-bold uppercase tracking-wider">Share Score</div>

                      <div className="flex flex-col gap-2">
                        {/* Farcaster/Warpcast */}
                        <button
                          onClick={handleShareFarcaster}
                          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium"
                          style={{
                            background: 'rgba(138, 43, 226, 0.15)',
                            border: '1px solid #8b5cf6',
                            color: '#a78bfa'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(138, 43, 226, 0.3)'
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(139, 92, 246, 0.5)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(138, 43, 226, 0.15)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 1000 1000" fill="currentColor">
                            <path d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z"/>
                            <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z"/>
                            <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.939 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z"/>
                          </svg>
                          Farcaster
                        </button>

                        {/* Twitter/X */}
                        <button
                          onClick={handleShareTwitter}
                          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium"
                          style={{
                            background: 'rgba(29, 155, 240, 0.15)',
                            border: '1px solid #1d9bf0',
                            color: '#60a5fa'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(29, 155, 240, 0.3)'
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(29, 155, 240, 0.5)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(29, 155, 240, 0.15)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                          </svg>
                          Twitter / X
                        </button>

                        {/* Native Share (mobile) */}
                        {canUseNativeShare() && (
                          <button
                            onClick={handleNativeShare}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium"
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid #22c55e',
                              color: '#4ade80'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(34, 197, 94, 0.3)'
                              e.currentTarget.style.boxShadow = '0 0 10px rgba(34, 197, 94, 0.5)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(34, 197, 94, 0.15)'
                              e.currentTarget.style.boxShadow = 'none'
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .89 2 2z"/>
                            </svg>
                            More Options
                          </button>
                        )}

                        {/* Copy Link */}
                        <button
                          onClick={handleCopyLink}
                          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium"
                          style={{
                            background: 'rgba(0, 255, 255, 0.15)',
                            border: '1px solid #0ff',
                            color: '#22d3d1'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 255, 255, 0.3)'
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 255, 0.5)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 255, 255, 0.15)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                          </svg>
                          {copySuccess ? 'Copied!' : 'Copy to Clipboard'}
                        </button>
                      </div>

                      {/* Close button */}
                      <button
                        onClick={() => setShowShareMenu(false)}
                        className="w-full mt-3 px-4 py-2 rounded-lg text-gray-400 hover:text-white text-sm transition-colors"
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}

                <button onClick={onBackToHome} className="neon-btn-pink" style={{ transform: 'scale(0.7)', transformOrigin: 'center' }}>Back to Home</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Mobile Control Buttons */}
      {gameState === 'playing' && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-between px-4 md:hidden">
          <button
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); gameRef.current.moveLeft() }}
            className="w-16 h-16 rounded-full bg-cyan-500/20 border-2 border-cyan-500 flex items-center justify-center active:bg-cyan-500/40 active:scale-95 transition-all shadow-lg shadow-cyan-500/30 touch-none"
          >
            <span className="text-cyan-400 text-2xl font-bold">◀</span>
          </button>
          <button
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); gameRef.current.moveRight() }}
            className="w-16 h-16 rounded-full bg-pink-500/20 border-2 border-pink-500 flex items-center justify-center active:bg-pink-500/40 active:scale-95 transition-all shadow-lg shadow-pink-500/30 touch-none"
          >
            <span className="text-pink-400 text-2xl font-bold">▶</span>
          </button>
        </div>
      )}
    </div >
  )
})

// ============ Main App ============
export default function App() {
  // Privy hooks
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()

  // Wallet state (derived from Privy)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<ethers.Signer | null>(null)
  const [address, setAddress] = useState<string>('')
  const [chainId, setChainId] = useState<number>(0)

  // Contract instances
  const [ngoldContract, setNgoldContract] = useState<ethers.Contract | null>(null)
  const [carsContract, setCarsContract] = useState<ethers.Contract | null>(null)
  const [gameContract, setGameContract] = useState<ethers.Contract | null>(null)

  // Game state
  const [cars, setCars] = useState<Car[]>([])
  const [playerData, setPlayerData] = useState<PlayerData | null>(null)
  const [activeCar, setActiveCar] = useState<Car | null>(null)
  const [gameStats, setGameStats] = useState<{ totalPlayers: bigint, totalGamesPlayed: bigint, totalNGoldMinted: bigint }>({ totalPlayers: 0n, totalGamesPlayed: 0n, totalNGoldMinted: 0n })
  const [hasStarterCar, setHasStarterCar] = useState(false)
  const [lastScore, setLastScore] = useState(0)
  const [lastNeonsCollected, setLastNeonsCollected] = useState(0)
  const neonGameRef = useRef<GameRef>(null)

  // UI state
  const [activeTab, setActiveTab] = useState<'home' | 'play' | 'shop' | 'leaderboard'>('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<string | null>(null) // Track specific action: 'claim', 'buy-2', 'equip-3', etc.
  const [toasts, setToasts] = useState<Toast[]>([])

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)

  // Toast helpers
  const addToast = (message: string, type: 'success' | 'error' | 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }
  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  // Track if using Farcaster miniapp wallet
  const [isFarcasterWallet, setIsFarcasterWallet] = useState(false)

  // Check config
  const isConfigured = CONFIG.NGOLD_TOKEN && CONFIG.GAME_CONTRACT && CONFIG.NFT_CONTRACT
  // Connected if authenticated via Privy OR using Farcaster miniapp wallet
  const isConnected = (authenticated || isFarcasterWallet) && !!address
  const isCorrectNetwork = chainId === CONFIG.CHAIN_ID

  // Initialize wallet - try Farcaster SDK first, then Privy
  useEffect(() => {
    async function initWallet() {
      try {
        // First, check if we're in a Farcaster/Base miniapp
        const inMiniapp = await isInFarcasterMiniapp()

        if (inMiniapp) {
          // Try Farcaster SDK wallet (works in Base app, may not work in Warpcast)
          const farcasterProvider = await getFarcasterProvider()
          if (farcasterProvider) {
            const ethersProvider = new ethers.BrowserProvider(farcasterProvider)
            const ethersSigner = await ethersProvider.getSigner()
            const walletAddress = await ethersSigner.getAddress()
            const network = await ethersProvider.getNetwork()
            const currentChainId = Number(network.chainId)

            // Check if on Base (8453) - request switch if not
            if (currentChainId !== CONFIG.CHAIN_ID) {
              try {
                await farcasterProvider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x2105' }], // 8453 in hex
                })
              } catch (switchErr) {
                console.error('Failed to switch chain:', switchErr)
                // Continue anyway, might work
              }
            }

            // Wait for Warpcast to stabilize before setting state
            await new Promise(resolve => setTimeout(resolve, 1000))

            setProvider(ethersProvider)
            setSigner(ethersSigner)
            setAddress(walletAddress)
            setChainId(CONFIG.CHAIN_ID) // Assume Base
            setIsFarcasterWallet(true)

            // Initialize contracts for writing (use signer)
            if (isConfigured) {
              const ngold = new ethers.Contract(CONFIG.NGOLD_TOKEN, NGOLD_ABI, ethersSigner)
              const cars = new ethers.Contract(CONFIG.NFT_CONTRACT, CARS_ABI, ethersSigner)
              const game = new ethers.Contract(CONFIG.GAME_CONTRACT, GAME_ABI, ethersSigner)

              setNgoldContract(ngold)
              setCarsContract(cars)
              setGameContract(game)
            }
            return
          }
          // SDK wallet failed - fall through to Privy (user needs external wallet)
        }

        // Fall back to Privy wallet connection
        setIsFarcasterWallet(false)
        if (!ready || !authenticated || wallets.length === 0) {
          setProvider(null)
          setSigner(null)
          setAddress('')
          setChainId(0)
          setNgoldContract(null)
          setCarsContract(null)
          setGameContract(null)
          return
        }

        // Get the first available wallet (embedded or external)
        const wallet = wallets[0]

        // Get ethers provider from Privy wallet
        const ethereumProvider = await wallet.getEthereumProvider()
        const ethersProvider = new ethers.BrowserProvider(ethereumProvider)
        const ethersSigner = await ethersProvider.getSigner()
        const walletAddress = await ethersSigner.getAddress()
        const network = await ethersProvider.getNetwork()

        setProvider(ethersProvider)
        setSigner(ethersSigner)
        setAddress(walletAddress)
        setChainId(Number(network.chainId))

        // Initialize contracts
        if (isConfigured) {
          const ngold = new ethers.Contract(CONFIG.NGOLD_TOKEN, NGOLD_ABI, ethersSigner)
          const cars = new ethers.Contract(CONFIG.NFT_CONTRACT, CARS_ABI, ethersSigner)
          const game = new ethers.Contract(CONFIG.GAME_CONTRACT, GAME_ABI, ethersSigner)
          setNgoldContract(ngold)
          setCarsContract(cars)
          setGameContract(game)
        }
      } catch (err) {
        console.error('Error initializing wallet:', err)
      }
    }

    initWallet()
  }, [ready, authenticated, wallets, isConfigured])

  // Switch network using Privy wallet
  const switchNetwork = async () => {
    if (wallets.length === 0) return
    try {
      await wallets[0].switchChain(CONFIG.CHAIN_ID)
      // Reinitialize after chain switch
      const ethereumProvider = await wallets[0].getEthereumProvider()
      const ethersProvider = new ethers.BrowserProvider(ethereumProvider)
      const network = await ethersProvider.getNetwork()
      setChainId(Number(network.chainId))
    } catch (err) {
      console.error('Error switching network:', err)
    }
  }

  // Load game data (uses dedicated RPC for reliable reads)
  const loadGameData = async () => {
    if (!address || !isConfigured) return
    try {
      // Use public RPC for read operations (more reliable than wallet provider)
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org')
      const carsRead = new ethers.Contract(CONFIG.NFT_CONTRACT, CARS_ABI, readProvider)
      const gameRead = new ethers.Contract(CONFIG.GAME_CONTRACT, GAME_ABI, readProvider)

      // Check if player has starter car
      const hasCar = await carsRead.hasStarterCar(address)
      setHasStarterCar(hasCar)

      // Get player data from game contract
      const data = await gameRead.getPlayerData(address)
      const pData: PlayerData = {
        activeCar: Number(data[0]),      // playerActiveCar (tokenId)
        highScore: data[1],               // playerHighScore
        gamesPlayed: data[2],             // playerGamesPlayed
        lifetimeMinted: data[3],          // playerLifetimeMinted
        tokenBalance: data[5],            // ngoldBalance
        isFrozen: data[6],                // isFrozen
      }
      setPlayerData(pData)

      // Query owned NFTs by iterating through totalSupply
      const totalSupply = Number(await carsRead.totalSupply())
      const ownedTokens: { tokenId: number, typeId: number }[] = []

      for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
        try {
          const owner = await carsRead.ownerOf(tokenId)
          if (owner.toLowerCase() === address.toLowerCase()) {
            const typeId = Number(await carsRead.tokenCarType(tokenId))
            ownedTokens.push({ tokenId, typeId })
          }
        } catch {
          // Token may not exist or be burned
        }
      }

      // Build car list from CAR_TYPES with ownership info
      const carList: Car[] = CAR_TYPES.map((carType) => {
        const ownedToken = ownedTokens.find(t => t.typeId === carType.typeId)
        return {
          typeId: carType.typeId,
          tokenId: ownedToken?.tokenId || 0,
          name: carType.name,
          priceETH: carType.priceETH,
          bonus: carType.speedBonus,
          owned: !!ownedToken,
          soulbound: carType.soulbound,
        }
      })
      setCars(carList)

      // Set active car based on activeCar tokenId from player data
      if (pData.activeCar > 0) {
        const ownedToken = ownedTokens.find(t => t.tokenId === pData.activeCar)
        if (ownedToken) {
          const carType = CAR_TYPES.find(c => c.typeId === ownedToken.typeId)
          if (carType) {
            setActiveCar({
              typeId: carType.typeId,
              tokenId: pData.activeCar,
              name: carType.name,
              priceETH: carType.priceETH,
              bonus: carType.speedBonus,
              owned: true,
              soulbound: carType.soulbound,
            })
          }
        }
      } else if (ownedTokens.length > 0) {
        // Default to first owned car
        const firstOwned = ownedTokens[0]
        const carType = CAR_TYPES.find(c => c.typeId === firstOwned.typeId)
        if (carType) {
          setActiveCar({
            typeId: carType.typeId,
            tokenId: firstOwned.tokenId,
            name: carType.name,
            priceETH: carType.priceETH,
            bonus: carType.speedBonus,
            owned: true,
            soulbound: carType.soulbound,
          })
        }
      } else {
        setActiveCar(null)
      }

      // Get game stats
      const stats = await gameRead.getGameStats()
      setGameStats({
        totalPlayers: stats[0],
        totalGamesPlayed: stats[1],
        totalNGoldMinted: stats[2],
      })

    } catch (err: any) {
      console.error('Load error:', err)
      // If loading fails, try fallback with public RPC
      if (address && isConfigured) {
        try {
          const fallbackProvider = new ethers.JsonRpcProvider('https://mainnet.base.org')
          const fallbackCars = new ethers.Contract(CONFIG.NFT_CONTRACT, CARS_ABI, fallbackProvider)
          const hasCar = await fallbackCars.hasStarterCar(address)
          setHasStarterCar(hasCar)
        } catch {
          // Ignore
        }
      }
    }
  }

  // Refresh data when contracts change
  useEffect(() => {
    // Add small delay to let Warpcast stabilize, then load data
    if (address && isConfigured) {
      const timer = setTimeout(() => loadGameData(), 500)
      return () => clearTimeout(timer)
    }
  }, [address, isConfigured])

  // Load leaderboard from HighScoreUpdated events (only fires on new high scores)
  const loadLeaderboard = async () => {
    if (!CONFIG.GAME_CONTRACT) return
    setLeaderboardLoading(true)
    try {
      // Use public RPCs for event queries (Alchemy free tier has 10 block limit)
      // Public Base RPCs allow larger range queries
      const rpcUrls = [
        'https://base-mainnet.infura.io/v3/55b0fea05a444965b6824f3a61ccdcd1',
        'https://mainnet.base.org',
        'https://base.llamarpc.com'
      ]

      let rpcProvider: ethers.JsonRpcProvider | null = null
      let currentBlock = 0

      for (const rpcUrl of rpcUrls) {
        try {
          const testProvider = new ethers.JsonRpcProvider(rpcUrl)
          currentBlock = await testProvider.getBlockNumber()
          rpcProvider = testProvider
          break
        } catch {
          // Try next RPC
        }
      }

      if (!rpcProvider) {
        console.error('All RPCs failed')
        setLeaderboardLoading(false)
        return
      }

      const readContract = new ethers.Contract(CONFIG.GAME_CONTRACT, GAME_ABI, rpcProvider)
      const scoreMap = new Map<string, bigint>()

      // Query last 50k blocks (~1 day on Base)
      // Public RPCs may have limits, so keep range reasonable
      const fromBlock = Math.max(0, currentBlock - 50000)

      try {
        const filter = readContract.filters.HighScoreUpdated()
        const events = await readContract.queryFilter(filter, fromBlock, 'latest')

        for (const event of events) {
          if ('args' in event && event.args) {
            const player = event.args[0] as string
            const newHighScore = event.args[1] as bigint
            const current = scoreMap.get(player) || 0n
            if (newHighScore > current) {
              scoreMap.set(player, newHighScore)
            }
          }
        }
      } catch (queryErr) {
        console.error('Failed to query events:', queryErr)
      }

      // Sort and take top 50
      const sorted = Array.from(scoreMap.entries())
        .sort((a, b) => Number(b[1] - a[1]))
        .slice(0, 50)
        .map(([addr, score], i) => ({
          address: addr,
          score: score,
          rank: i + 1
        }))

      setLeaderboard(sorted)
    } catch (err) {
      console.error('Failed to load leaderboard:', err)
    } finally {
      setLeaderboardLoading(false)
    }
  }

  // Load leaderboard when tab changes to leaderboard
  useEffect(() => {
    if (activeTab === 'leaderboard') {
      loadLeaderboard()
    }
  }, [activeTab])

  // Claim starter car (requires ETH payment)
  const claimStarterCar = async () => {
    if (!gameContract || !address) return
    try {
      setLoading(true)
      setLoadingAction('claim')

      // First check ownership via public RPC
      const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org')
      const carsRead = new ethers.Contract(CONFIG.NFT_CONTRACT, CARS_ABI, readProvider)
      const alreadyHasCar = await carsRead.hasStarterCar(address)

      if (alreadyHasCar) {
        addToast('You already own a starter car! Loading your data...', 'info')
        try {
          await loadGameData()
          addToast('Data loaded! Check your garage.', 'success')
        } catch (loadErr) {
          console.error('Failed to load game data:', loadErr)
          addToast('Failed to load data. Try refreshing.', 'error')
        }
        return
      }

      addToast('Claiming starter car...', 'info')
      const fee = ethers.parseEther(CONFIG.STARTER_CAR_FEE)

      // Try to simulate the transaction first
      try {
        await gameContract.claimStarterCar.staticCall({ value: fee })
      } catch (simErr: any) {
        console.error('Simulation failed:', simErr)
        const reason = simErr.reason || simErr.message || 'Unknown error'
        if (reason.includes('already') || reason.includes('Already')) {
          addToast('You already have a starter car!', 'error')
          await loadGameData()
          return
        }
        throw simErr // Re-throw for main error handler
      }

      const tx = await gameContract.claimStarterCar({ value: fee })
      await tx.wait()
      addToast('🚗 Starter car claimed!', 'success')
      await loadGameData()
    } catch (err: any) {
      console.error('Claim error:', err)
      // Extract meaningful error message
      let errorMsg = 'Failed to claim'
      if (err.reason) {
        errorMsg = err.reason
      } else if (err.message) {
        if (err.message.includes('already claimed') || err.message.includes('Already has')) {
          errorMsg = 'You already have a starter car!'
        } else if (err.message.includes('insufficient funds')) {
          errorMsg = 'Insufficient ETH for gas'
        } else if (err.message.includes('user rejected') || err.message.includes('User denied')) {
          errorMsg = 'Transaction cancelled'
        } else {
          errorMsg = err.message.slice(0, 50) // Truncate long messages
        }
      }
      addToast(errorMsg, 'error')
    } finally {
      setLoading(false)
      setLoadingAction(null)
    }
  }

  // Buy car (requires ETH payment)
  const buyCar = async (car: Car) => {
    if (!gameContract) return
    try {
      setLoading(true)
      setLoadingAction(`buy-${car.typeId}`)
      const priceWei = ethers.parseEther(car.priceETH)
      addToast(`Buying ${car.name} for ${car.priceETH} ETH...`, 'info')
      const tx = await gameContract.buyCar(car.typeId, { value: priceWei })
      await tx.wait()
      addToast(`🚗 ${car.name} purchased!`, 'success')
      await loadGameData()
    } catch (err: any) {
      addToast(err.reason || 'Purchase failed', 'error')
    } finally {
      setLoading(false)
      setLoadingAction(null)
    }
  }

  // Equip car (takes tokenId, not typeId)
  const equipCar = async (tokenId: number) => {
    if (!gameContract) return
    try {
      setLoading(true)
      setLoadingAction(`equip-${tokenId}`)
      const tx = await gameContract.equipCar(tokenId)
      await tx.wait()
      addToast('Car equipped!', 'success')
      await loadGameData()
    } catch (err: any) {
      addToast(err.reason || 'Failed', 'error')
    } finally {
      setLoading(false)
      setLoadingAction(null)
    }
  }

  // Check if eligible for rewards
  const canSubmitScore = () => {
    // Must collect at least 1 NEON ball OR have score > 100
    return lastNeonsCollected >= 1 || lastScore > 100
  }

  // Calculate reward: (score / 1000) + collected NEON balls
  const calculateReward = () => {
    const scoreReward = Math.floor(lastScore / 1000)
    return scoreReward + lastNeonsCollected
  }

  // Submit score
  const submitScore = async () => {
    if (!gameContract || !canSubmitScore()) return
    try {
      setLoading(true)
      addToast('Submitting score...', 'info')
      const tx = await gameContract.submitScore(lastScore, lastNeonsCollected)
      await tx.wait()

      const reward = calculateReward()
      addToast(`🎉 +${reward} nGOLD added to claimable rewards!`, 'success')
      setLastScore(0)
      setLastNeonsCollected(0)
      await loadGameData()
    } catch (err: any) {
      addToast(err.reason || 'Submit failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Submit all pending local games (v1.1.1 - batch with fallback)
  const submitPendingGames = async () => {
    if (!gameContract || !address) return

    const localGames = getLocalGames()
    if (localGames.length === 0) {
      addToast('No pending games to submit!', 'error')
      return
    }

    try {
      setLoading(true)

      // For Farcaster: verify player has car using public RPC (wallet provider unreliable for reads)
      if (isFarcasterWallet) {
        const readProvider = new ethers.JsonRpcProvider('https://mainnet.base.org')
        const gameRead = new ethers.Contract(CONFIG.GAME_CONTRACT, GAME_ABI, readProvider)
        const pData = await gameRead.getPlayerData(address)
        const playerActiveCar = Number(pData[0])
        if (playerActiveCar === 0) {
          addToast('You need to equip a car first!', 'error')
          return
        }
      }

      // Calculate total reward for display
      const carBonus = activeCar?.bonus || 0
      let totalReward = 0
      localGames.forEach(game => {
        const baseReward = Math.floor(game.score / 1000) + game.neonsCollected
        totalReward += Math.floor(baseReward * (100 + carBonus) / 100)
      })

      // Try batch submission first
      try {
        const scores = localGames.map(g => g.score)
        const neons = localGames.map(g => g.neonsCollected)

        // For non-Farcaster: verify player data (optional debug)
        if (!isFarcasterWallet) {
          try {
            const pData = await gameContract.getPlayerData(address)
            console.log('Player data:', { activeCar: pData[0].toString() })
          } catch (e) {
            console.error('Failed to get player data:', e)
          }
        }

        addToast(`Submitting ${localGames.length} games...`, 'info')

        // Skip staticCall for Farcaster (unreliable), use for others
        if (!isFarcasterWallet) {
          try {
            await gameContract.submitScoresBatch.staticCall(scores, neons)
          } catch (staticErr: any) {
            console.error('staticCall failed:', staticErr.reason || staticErr.message)
            throw staticErr
          }
        }

        // For Farcaster: add explicit gas to bypass estimation issues
        const txOptions = isFarcasterWallet ? { gasLimit: 500000 } : {}
        const tx = await gameContract.submitScoresBatch(scores, neons, txOptions)
        await tx.wait()

        clearLocalGames()
        addToast(`🎉 Earned ${totalReward} NiftyGold from ${localGames.length} games!`, 'success')
      } catch (batchErr: any) {
        console.error('Batch submission failed:', batchErr)

        // Fallback to individual submissions if batch fails
        addToast('Trying individual submissions...', 'info')

        for (let i = 0; i < localGames.length; i++) {
          const game = localGames[i]
          addToast(`Submitting game ${i + 1}/${localGames.length}...`, 'info')
          // For Farcaster: add explicit gas to bypass estimation issues
          const txOptions = isFarcasterWallet ? { gasLimit: 300000 } : {}
          const tx = await gameContract.submitScore(game.score, game.neonsCollected, txOptions)
          await tx.wait()
        }

        clearLocalGames()
        addToast(`🎉 Earned ${totalReward} NiftyGold from ${localGames.length} games!`, 'success')
      }

      await loadGameData()
    } catch (err: any) {
      console.error('Submit error:', err)
      let errorMsg = 'Submit failed'
      if (err.reason) {
        errorMsg = err.reason
      } else if (err.code === 'ACTION_REJECTED' || err.message?.includes('rejected')) {
        errorMsg = 'Transaction rejected'
      } else if (err.message) {
        errorMsg = err.message.slice(0, 60)
      }
      addToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Get total pending reward from local games
  const getLocalPendingTotal = (): number => {
    return getLocalPendingReward(activeCar?.bonus || 0)
  }

  const getLocalGamesCount = (): number => {
    return getLocalGames().length
  }

  const handleGameOver = (score: number, neonsCollected: number) => {
    setLastScore(score)
    setLastNeonsCollected(neonsCollected)

    // Save to local storage (NO blockchain transaction!)
    if (score > 100 || neonsCollected >= 1) {
      saveLocalGame(score, neonsCollected)
    }
  }

  const formatTokens = (amount: bigint) => {
    return parseFloat(ethers.formatEther(amount)).toFixed(2)
  }

  const shortAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 50%, #0d0d2e 100%)' }}>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Mobile Menu Button (only show when sidebar is closed) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-50 md:hidden neon-btn p-2"
        >
          ☰
        </button>
      )}

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-black/95 border-r border-cyan-500/30 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 flex flex-col`}>
        {/* Logo */}
        <div className="p-4 border-b border-cyan-500/30 flex items-center justify-between">
          <h1 className="text-xl font-black neon-cyan flex items-center gap-2">
            <img src="/img/logo.png" alt="NEON" className="hidden md:inline-block w-7 h-7 rounded-lg" style={{ filter: 'drop-shadow(0 0 8px #0ff) drop-shadow(0 0 15px #0ff)' }} />
            NIFTY RACER
          </h1>
          {/* Close button for mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden neon-btn p-2 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {[
            { id: 'home', label: '🏠 Home', color: 'cyan' },
            { id: 'play', label: '🎮 Play', color: 'green' },
            { id: 'shop', label: '🛒 Shop', color: 'pink' },
            { id: 'leaderboard', label: '🏆 Leaderboard', color: 'yellow' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id as any); setSidebarOpen(false); }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${activeTab === item.id
                ? `neon-${item.color} bg-${item.color === 'cyan' ? 'cyan' : item.color === 'green' ? 'green' : item.color === 'pink' ? 'pink' : 'yellow'}-500/20 border border-current`
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
            >
              {item.label}
            </button>
          ))}

          <div className="border-t border-gray-700 my-4 pt-4">
            <a href="/documentation.html" rel="noopener noreferrer" className="block px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all">📄 Documentation</a>
            <a href="/privacy-policy.html" rel="noopener noreferrer" className="block px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all">🔒 Privacy Policy</a>
          </div>
        </nav>

        {/* Social Links */}
        <div className="p-4 border-t border-cyan-500/30 text-center">
          <p className="text-gray-400 text-sm font-semibold mb-3">Follow Us</p>
          <div className="flex gap-3 justify-center">
            <a href="https://x.com" target="_blank" className="text-gray-400 hover:text-white text-xl"><i className="fa-brands fa-x-twitter"></i></a>
            <a href="https://t.me" target="_blank" className="text-gray-400 hover:text-cyan-400 text-xl"><i className="fa-brands fa-telegram"></i></a>
            <a href="https://discord.gg" target="_blank" className="text-gray-400 hover:text-purple-400 text-xl"><i className="fa-brands fa-discord"></i></a>
            <a href="/" target="_blank" className="text-gray-400 hover:text-purple-400 text-xl"><i className="fa-brands fa-notion"></i></a>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        {/* Header */}
        <header className="flex justify-between items-center mb-6 ml-10 md:ml-0">
          <div></div>
          <div className="flex items-center gap-3">
            {isConnected && playerData && (
              <div className="text-right mr-2 hidden sm:block">
                <p className="neon-yellow text-sm flex items-center gap-1">
                  <img src="/img/neon.png" alt="NEON" className="w-4 h-4 rounded-full" />
                  {formatTokens(playerData.tokenBalance)}
                </p>
              </div>
            )}
            {!isConnected ? (
              <button onClick={login} disabled={!ready} className="neon-btn text-sm">
                {!ready ? '...' : 'Connect'}
              </button>
            ) : !isCorrectNetwork ? (
              <button onClick={switchNetwork} className="neon-btn-pink text-sm">
                Switch Network
              </button>
            ) : (
              <div className="neon-border rounded-lg px-3 py-1.5 flex items-center gap-2">
                <span className="text-xs">{shortAddress(address)}</span>
                <button onClick={logout} className="text-red-400 hover:text-red-300 text-xs">
                  ✕
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="max-w-4xl mx-auto">
          {/* Home Tab */}
          {activeTab === 'home' && (
            <div className="space-y-6">
              {/* Hero */}
              <div className="neon-card text-center py-8">
                <h2 className="text-3xl md:text-5xl font-black neon-cyan mb-4 animate-glow flex items-center justify-center gap-3">
                  <img src="/img/logo.png" alt="NEON" className="hidden md:inline-block w-12 h-12 md:w-16 md:h-16 rounded-lg" style={{ filter: 'drop-shadow(0 0 10px #0ff) drop-shadow(0 0 20px #0ff)' }} />
                  NIFTY RACER
                </h2>
                <p className="text-gray-400 mb-6 max-w-md mx-auto">Race through neon highways, collect tokens, and earn NiftyGold rewards on-chain!</p>
                <button
                  onClick={() => setActiveTab('play')}
                  className="neon-btn-green text-xl px-12 py-5"
                >
                  🎮 PLAY NOW
                </button>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="neon-card text-center">
                  <p className="text-gray-400 text-sm">Lifetime Earnings</p>
                  <p className="text-2xl neon-green font-bold">{formatTokens(playerData?.lifetimeMinted || 0n)}</p>
                </div>
                <div className="neon-card text-center">
                  <p className="text-gray-400 text-sm">Your Balance</p>
                  <p className="text-2xl neon-yellow font-bold">{playerData ? formatTokens(playerData.tokenBalance) : '0'}</p>
                </div>
                <div className="neon-card text-center">
                  <p className="text-gray-400 text-sm">High Score</p>
                  <p className="text-2xl neon-pink font-bold">{playerData?.highScore.toString() || '0'}</p>
                </div>
                <div className="neon-card text-center">
                  <p className="text-gray-400 text-sm">Games Played</p>
                  <p className="text-2xl text-white font-bold">{playerData?.gamesPlayed.toString() || '0'}</p>
                </div>
              </div>

              {/* Pending Games */}
              {getLocalGamesCount() > 0 && (
                <div className="neon-card bg-green-500/10 border-green-500">
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="text-center sm:text-left">
                      <p className="text-gray-400">Pending Rewards</p><br />
                      <p className="text-2xl neon-green font-bold">{getLocalPendingTotal()} Nifty Gold</p><br />
                      <p className="text-gray-500 text-sm">{getLocalGamesCount()} games to submit</p>
                    </div>
                    <button onClick={submitPendingGames} disabled={loading} className="neon-btn-green text-sm px-4 py-2">
                      {loading ? 'Submitting...' : '💰 Submit & Earn'}
                    </button>
                  </div>
                </div>
              )}

              {/* How To Play */}
              <div className="neon-card">
                <h3 className="text-xl neon-pink mb-4">💡 How To Play</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="flex gap-3">
                    <span className="text-2xl">1️⃣</span>
                    <div>
                      <p className="font-bold text-white">Connect Wallet</p>
                      <p className="text-gray-400 text-sm">Connect wallet on Base network</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-2xl">2️⃣</span>
                    <div>
                      <p className="font-bold text-white">Get Starter Car</p>
                      <p className="text-gray-400 text-sm">Mint & Claim your starter car</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-2xl">3️⃣</span>
                    <div>
                      <p className="font-bold text-white">Race & Collect</p>
                      <p className="text-gray-400 text-sm">Dodge traffic, collect NiftyGold tokens</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-2xl">4️⃣</span>
                    <div>
                      <p className="font-bold text-white">Claim Rewards</p>
                      <p className="text-gray-400 text-sm">Submit scores and claim NiftyGold!</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Play Tab */}
          {activeTab === 'play' && (
            <div className="flex flex-col items-center justify-center">
              {!activeCar && isConnected && isConfigured ? (
                <div className="neon-card text-center py-10 w-full max-w-md">
                  <p className="text-gray-400 mb-4">You need a car to race!</p>
                  <p className="text-gray-500 text-sm mb-4">Starter car costs {CONFIG.STARTER_CAR_FEE} ETH</p>
                  <button onClick={claimStarterCar} disabled={loading} className="neon-btn-green">
                    {loadingAction === 'claim' ? 'Claiming...' : '🚗 Claim Starter Car'}
                  </button>
                </div>
              ) : !isConnected ? (
                <div className="neon-card text-center py-10 w-full max-w-md">
                  <p className="text-gray-400 mb-4">Connect wallet to play</p>
                  <button onClick={login} disabled={!ready} className="neon-btn">
                    {!ready ? '...' : 'Connect Wallet'}
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <NeonRacerGame ref={neonGameRef} onGameOver={handleGameOver} activeCar={activeCar} onBackToHome={() => setActiveTab('home')} />
                </div>
              )}
            </div>
          )}

          {/* Shop Tab */}
          {activeTab === 'shop' && (
            <div className="neon-card">
              <h2 className="text-2xl neon-pink mb-6">🛒 CAR SHOP</h2>
              {!isConnected ? (
                <p className="text-gray-400">Connect wallet to buy cars</p>
              ) : cars.length === 0 ? (
                <p className="text-gray-400">Loading...</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {cars.map(car => (
                    <div key={car.typeId} className={`p-4 rounded-lg border ${car.owned ? activeCar?.tokenId === car.tokenId ? 'border-green-500 bg-green-500/10' : 'border-gray-600 bg-gray-800/50' : 'border-cyan-500/30 bg-cyan-500/5'}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className={`font-bold ${car.owned ? 'text-white' : 'neon-cyan'}`}>{car.name}</h3>
                          <p className="text-gray-400 text-sm">+{car.bonus}% bonus {car.soulbound && '(Soulbound)'}</p>
                        </div>
                        <div>
                          {car.owned ? (
                            activeCar?.tokenId === car.tokenId ? (
                              <span className="neon-green text-sm">✓ Equipped</span>
                            ) : (
                              <button onClick={() => equipCar(car.tokenId)} disabled={loading} className="neon-btn text-sm px-3 py-1">
                                {loadingAction === `equip-${car.tokenId}` ? 'Equipping...' : 'Equip'}
                              </button>
                            )
                          ) : car.typeId === 1 ? (
                            <button onClick={claimStarterCar} disabled={loading} className="neon-btn-green text-sm px-3 py-1">
                              {loadingAction === 'claim' ? 'Claiming...' : `${car.priceETH} ETH`}
                            </button>
                          ) : (
                            <button onClick={() => buyCar(car)} disabled={loading} className="neon-btn-pink text-sm px-3 py-1">
                              {loadingAction === `buy-${car.typeId}` ? 'Buying...' : `${car.priceETH} ETH`}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Leaderboard Tab */}
          {activeTab === 'leaderboard' && (
            <div className="space-y-6">
              {/* Global Stats Card - ON TOP */}
              <div className="neon-card">
                <h3 className="text-xl neon-pink mb-4">📊 GLOBAL STATS</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 rounded-lg bg-gray-800/50">
                    <p className="text-gray-400 text-sm">Total Games Played</p>
                    <p className="text-xl neon-green font-bold">{gameStats.totalGamesPlayed.toString()}</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-gray-800/50">
                    <p className="text-gray-400 text-sm">Total NiftyGold Minted</p>
                    <p className="text-xl neon-yellow font-bold">{formatTokens(gameStats.totalNGoldMinted)}</p>
                  </div>
                </div>
              </div>

              {/* Leaderboard Card */}
              <div className="neon-card">
                <h2 className="text-2xl neon-yellow mb-6">🏆 LEADERBOARD</h2>

                {leaderboardLoading ? (
                  <p className="text-gray-400 text-center py-8">Loading...</p>
                ) : leaderboard.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No scores yet. Be the first to play!</p>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => {
                      const isUser = entry.address.toLowerCase() === address?.toLowerCase()
                      return (
                        <div
                          key={entry.address}
                          className={`flex justify-between items-center p-3 rounded-lg transition-colors ${isUser
                            ? 'bg-cyan-500/10 border border-cyan-500'
                            : 'bg-gray-800/50 hover:bg-gray-700/50'
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`font-bold w-8 ${entry.rank <= 3 ? 'neon-yellow' : 'text-gray-400'}`}>
                              #{entry.rank}
                            </span>
                            <span className={isUser ? 'neon-cyan' : 'text-gray-300'}>
                              {shortAddress(entry.address)}
                              {isUser && <span className="text-yellow-400 ml-2">(you)</span>}
                            </span>
                          </div>
                          <span className="neon-green font-bold">{entry.score.toString()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}
    </div>
  )
}