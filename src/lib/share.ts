import { sdk } from '@farcaster/miniapp-sdk';

// Game URL for sharing
const GAME_URL = 'https://niftyracer.fun';

export type Platform = 'farcaster' | 'base' | 'browser';

export interface ShareScoreParams {
    score: number;
    neonsCollected: number;
    nGoldEarned: number;
    carName?: string;
}

// Detect which platform we're running on
export const detectPlatform = async (): Promise<Platform> => {
    try {
        const isInMiniApp = await sdk.isInMiniApp();
        if (isInMiniApp) {
            // Check if we're in Base app context (user agent or referrer check)
            const userAgent = navigator.userAgent.toLowerCase();
            const isBase = userAgent.includes('base') || userAgent.includes('coinbase');
            return isBase ? 'base' : 'farcaster';
        }
    } catch {
        // SDK not available
    }
    return 'browser';
};

// Build share text
const buildShareText = (params: ShareScoreParams): string => {
    const { score, neonsCollected, nGoldEarned, carName } = params;
    const carText = carName ? ` with my ${carName}` : '';
    return `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER!

💰 Earned ${nGoldEarned} nGOLD (${Math.floor(score / 1000)} from score + ${neonsCollected} neons collected)

🎮 Think you can beat my score? Play now: ${GAME_URL}`;
};

// Share using Farcaster SDK (for miniapp context)
export const shareToFarcasterSDK = async (params: ShareScoreParams): Promise<boolean> => {
    try {
        const { score, neonsCollected, nGoldEarned, carName } = params;
        const carText = carName ? ` with my ${carName}` : '';
        const castText = `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER!

💰 Earned ${nGoldEarned} nGOLD (${Math.floor(score / 1000)} from score + ${neonsCollected} neons collected)

🎮 Think you can beat my score? Play now:`;

        await sdk.actions.composeCast({
            text: castText,
            embeds: [GAME_URL]
        });
        return true;
    } catch (error) {
        console.error('Failed to share via Farcaster SDK:', error);
        return false;
    }
};

// Share to Warpcast (Farcaster web)
export const shareToWarpcast = (params: ShareScoreParams): boolean => {
    try {
        const { score, neonsCollected, nGoldEarned, carName } = params;
        const carText = carName ? ` with my ${carName}` : '';
        const castText = `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER!

💰 Earned ${nGoldEarned} nGOLD (${Math.floor(score / 1000)} from score + ${neonsCollected} neons collected)

🎮 Think you can beat my score? Play now:`;

        const encodedText = encodeURIComponent(castText);
        const encodedEmbed = encodeURIComponent(GAME_URL);
        const warpcastUrl = `https://warpcast.com/~/compose?text=${encodedText}&embeds[]=${encodedEmbed}`;
        window.open(warpcastUrl, '_blank');
        return true;
    } catch {
        return false;
    }
};

// Share to Twitter/X
export const shareToTwitter = (params: ShareScoreParams): boolean => {
    try {
        const text = buildShareText(params);
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        window.open(twitterUrl, '_blank');
        return true;
    } catch {
        return false;
    }
};

// Copy share link to clipboard
export const copyShareLink = async (params: ShareScoreParams): Promise<boolean> => {
    try {
        const text = buildShareText(params);
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

// Use Web Share API (native share menu on mobile)
export const shareNative = async (params: ShareScoreParams): Promise<boolean> => {
    if (!navigator.share) {
        return false;
    }

    try {
        const { score, carName } = params;
        const carText = carName ? ` with my ${carName}` : '';

        await navigator.share({
            title: 'NIFTY RACER Score',
            text: `🏎️ Just scored ${score.toLocaleString()} points${carText} in NIFTY RACER! Can you beat my score?`,
            url: GAME_URL
        });
        return true;
    } catch (error) {
        // User cancelled or share failed
        if ((error as Error).name !== 'AbortError') {
            console.error('Native share failed:', error);
        }
        return false;
    }
};

// Check if Web Share API is available
export const canUseNativeShare = (): boolean => {
    return typeof navigator.share === 'function';
};
