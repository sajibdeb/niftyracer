/**
 * NiftyRacer Contract ABIs and Addresses
 *
 * Base Mainnet Configuration
 */

// Contract Addresses (Base Mainnet)
export const CONTRACTS = {
    NGOLD: import.meta.env.VITE_NGOLD_TOKEN || '',
    CARS: import.meta.env.VITE_NFT_CONTRACT || '',
    GAME: import.meta.env.VITE_GAME_CONTRACT || '',
};

// NGold Token ABI (minimal)
export const NGOLD_ABI = [
    'function balanceOf(address user) view returns (uint256)',
    'function frozen(address user) view returns (bool)',
    'function totalSupply() view returns (uint256)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'event Transfer(address indexed from, address indexed to, uint256 amount)'
];

// NiftyRacerCars ABI (minimal)
export const CARS_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function hasStarterCar(address player) view returns (bool)',
    'function getSpeedBonus(uint256 tokenId) view returns (uint8)',
    'function tokenCarType(uint256 tokenId) view returns (uint256)',
    'function carTypes(uint256 typeId) view returns (string name, uint8 speedBonus, bool soulbound, string metadataURI)',
    'function totalCarTypes() view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

// NiftyRacerGame ABI (full interface - NO SIGNATURE required)
export const GAME_ABI = [
    // Car claim & purchase
    'function claimStarterCar() payable',
    'function buyCar(uint256 carTypeId) payable',
    'function equipCar(uint256 tokenId)',

    // Score submission (direct - no signature needed)
    'function submitScore(uint256 score, uint256 neon)',

    // View functions
    'function starterCarFee() view returns (uint256)',
    'function carPrices(uint256 typeId) view returns (uint256)',
    'function activeCar(address player) view returns (uint256)',
    'function highScores(address player) view returns (uint256)',
    'function gamesPlayed(address player) view returns (uint256)',
    'function lifetimeMinted(address player) view returns (uint256)',
    'function nonces(address player) view returns (uint256)',
    'function totalPlayers() view returns (uint256)',
    'function totalGamesPlayed() view returns (uint256)',
    'function totalNGoldMinted() view returns (uint256)',
    'function totalETHRevenue() view returns (uint256)',
    'function treasury() view returns (address)',

    // Aggregate view
    'function getPlayerData(address player) view returns (uint256 playerActiveCar, uint256 playerHighScore, uint256 playerGamesPlayed, uint256 playerLifetimeMinted, uint256 playerNonce, uint256 ngoldBalance, bool isFrozen)',
    'function getCarPrices() view returns (uint256[])',
    'function getGameStats() view returns (uint256 _totalPlayers, uint256 _totalGamesPlayed, uint256 _totalNGoldMinted, uint256 _totalETHRevenue)',

    // Events
    'event StarterCarClaimed(address indexed player, uint256 tokenId)',
    'event CarPurchased(address indexed player, uint256 carTypeId, uint256 tokenId, uint256 price)',
    'event CarEquipped(address indexed player, uint256 tokenId)',
    'event GameCompleted(address indexed player, uint256 score, uint256 neon, uint256 reward, uint256 nonce)',
    'event HighScoreUpdated(address indexed player, uint256 newHighScore)'
];

// Chain configuration (Base Mainnet only)
export const CHAIN_CONFIG = {
    base: {
        chainId: 8453,
        name: 'Base',
        rpcUrl: 'https://mainnet.base.org',
        explorerUrl: 'https://basescan.org'
    }
};

// Current network
export const CURRENT_NETWORK = 'base';

// NFT Metadata Base URIs
export const NFT_METADATA = {
    // IPFS URI (for on-chain contract)
    ipfs: 'ipfs://bafybeih5yetqtggbfsf7qoocsiscuyl66efqtv5dfaghhq6ga3vkzkjpk4/',
    // HTTP fallback (served from public folder)
    http: '/nft/',
};

// Car Types Configuration
export interface CarType {
    id: number;
    name: string;
    description: string;
    speedBonus: number;
    soulbound: boolean;
    tradeable: boolean;
    rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
    priceETH: string;
    metadataFile: string;
    image: string;
}

export const CAR_TYPES: CarType[] = [
    {
        id: 1,
        name: 'Starter',
        description: 'Your first ride in NeonRacer. Soulbound - cannot be traded. Perfect for beginners!',
        speedBonus: 0,
        soulbound: true,
        tradeable: false,
        rarity: 'Common',
        priceETH: '0.0001',
        metadataFile: 'starter.json',
        image: 'ipfs://bafybeiez6walr5mz6tu2ezigofchs4xyierc7rgczckxntdxduwszaj73y',
    },
    {
        id: 2,
        name: 'Speedster',
        description: 'A sleek and agile racer with 10% speed bonus. Trade on OpenSea!',
        speedBonus: 10,
        soulbound: false,
        tradeable: true,
        rarity: 'Uncommon',
        priceETH: '0.0033',
        metadataFile: 'speedster.json',
        image: 'ipfs://bafybeicvccxs7wtivitr3lwvk6jslekexig3rnckakipunr7iti5y2ebbu',
    },
    {
        id: 3,
        name: 'Turbo',
        description: 'High-performance racing machine with 25% speed bonus. Feel the rush!',
        speedBonus: 25,
        soulbound: false,
        tradeable: true,
        rarity: 'Rare',
        priceETH: '0.01',
        metadataFile: 'turbo.json',
        image: 'ipfs://bafybeifls3dbyewovqrbofjdje4cmksxipjc6tdtgediilxw4ubw634cai',
    },
    {
        id: 4,
        name: 'Neon Beast',
        description: 'A powerful beast with 50% speed bonus. Dominate the leaderboards!',
        speedBonus: 50,
        soulbound: false,
        tradeable: true,
        rarity: 'Epic',
        priceETH: '0.022',
        metadataFile: 'neon_beast.json',
        image: 'ipfs://bafybeign4svypozmd6zmza6kr3mvccmgfvltw4l2gsuvjer5ufz4me5fxa',
    },
    {
        id: 5,
        name: 'Legendary',
        description: 'The ultimate racing machine with 100% speed bonus. Only for champions!',
        speedBonus: 100,
        soulbound: false,
        tradeable: true,
        rarity: 'Legendary',
        priceETH: '0.05',
        metadataFile: 'legendary.json',
        image: 'ipfs://bafybeihvff2vhgat6me6pth75vycfxgkynxojmh6x3sxyi5uk7cdg657uy',
    },
];

// Helper functions
export function getCarById(id: number): CarType | undefined {
    return CAR_TYPES.find(car => car.id === id);
}

export function getCarMetadataUrl(car: CarType, useHttp = false): string {
    const baseUri = useHttp ? NFT_METADATA.http : NFT_METADATA.ipfs;
    return `${baseUri}${car.metadataFile}`;
}
