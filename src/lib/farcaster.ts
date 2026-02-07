import { sdk } from '@farcaster/miniapp-sdk';
import type { Eip1193Provider } from 'ethers';

// Game URL for sharing
const GAME_URL = 'https://niftyracer.fun';

// Track initialization state
let farcasterReady = false;
let inMiniApp: boolean | null = null;

export const initFarcaster = async () => {
    try {
        // Check if we're in a miniapp context
        inMiniApp = await sdk.isInMiniApp();
        if (!inMiniApp) {
            console.log('Not running in Farcaster/Base miniapp');
            return;
        }

        // Signal to host that miniapp is ready
        await sdk.actions.ready();
        farcasterReady = true;
        console.log('Farcaster SDK ready');
    } catch (error) {
        console.log('Farcaster SDK initialization skipped:', error);
    }
};

export const isInFarcasterMiniapp = async (): Promise<boolean> => {
    try {
        if (inMiniApp !== null) return inMiniApp;
        inMiniApp = await sdk.isInMiniApp();
        return inMiniApp;
    } catch {
        return false;
    }
};

// Get Farcaster wallet provider for use with ethers
export const getFarcasterProvider = async (): Promise<Eip1193Provider | null> => {
    try {
        const isInMiniApp = await sdk.isInMiniApp();
        if (!isInMiniApp) return null;

        // Ensure SDK is ready first
        if (!farcasterReady) {
            try {
                await sdk.actions.ready();
                farcasterReady = true;
            } catch {
                // SDK ready might fail if already called
            }
        }

        // Get the EIP-1193 provider from Farcaster SDK
        const provider = await sdk.wallet.getEthereumProvider();
        if (!provider) {
            console.log('Farcaster wallet provider not available');
            return null;
        }

        // Request account access to ensure wallet is connected
        try {
            await provider.request({ method: 'eth_requestAccounts' });
        } catch (err) {
            console.log('User declined wallet connection or already connected');
        }

        return provider as Eip1193Provider;
    } catch (error) {
        console.error('Failed to get Farcaster provider:', error);
        return null;
    }
};

// Check if Farcaster SDK is ready
export const isFarcasterReady = (): boolean => farcasterReady;

export interface ShareScoreParams {
    score: number;
    neonsCollected: number;
    nGoldEarned: number;
    carName?: string;
}

export const shareScoreToFarcaster = async (params: ShareScoreParams): Promise<boolean> => {
    const { score, neonsCollected, nGoldEarned, carName } = params;

    try {
        const isInMiniApp = await sdk.isInMiniApp();

        // Build the cast text
        const carText = carName ? ` with my ${carName}` : '';
        const castText = `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER!

💰 Earned ${nGoldEarned} nGOLD (${Math.floor(score / 1000)} from score + ${neonsCollected} neons collected)

🎮 Think you can beat my score? Play now:`;

        if (isInMiniApp) {
            // Use SDK to compose cast with embed
            await sdk.actions.composeCast({
                text: castText,
                embeds: [GAME_URL]
            });
            return true;
        } else {
            // Fallback: Open Warpcast intent URL in new tab
            const encodedText = encodeURIComponent(castText);
            const encodedEmbed = encodeURIComponent(GAME_URL);
            const warpcastUrl = `https://warpcast.com/~/compose?text=${encodedText}&embeds[]=${encodedEmbed}`;
            window.open(warpcastUrl, '_blank');
            return true;
        }
    } catch (error) {
        console.error('Failed to share to Farcaster:', error);

        // Fallback to Warpcast URL
        try {
            const carText = carName ? ` with my ${carName}` : '';
            const castText = `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER!\n\n💰 Earned ${nGoldEarned} nGOLD\n\n🎮 Play now:`;
            const encodedText = encodeURIComponent(castText);
            const encodedEmbed = encodeURIComponent(GAME_URL);
            const warpcastUrl = `https://warpcast.com/~/compose?text=${encodedText}&embeds[]=${encodedEmbed}`;
            window.open(warpcastUrl, '_blank');
            return true;
        } catch {
            return false;
        }
    }
};
