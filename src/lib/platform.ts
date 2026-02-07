import { sdk } from '@farcaster/miniapp-sdk';

export type Platform = 'farcaster' | 'base' | 'web';

let cachedPlatform: Platform | null = null;

export const detectPlatform = async (): Promise<Platform> => {
    if (cachedPlatform) return cachedPlatform;

    try {
        // Check if running in a miniapp (Farcaster or Base)
        const isInMiniApp = await sdk.isInMiniApp();
        if (isInMiniApp) {
            // Both Farcaster and Base use the same SDK
            // We can distinguish by checking the context or just return 'farcaster' 
            // as they share the same miniapp infrastructure
            cachedPlatform = 'farcaster';
            return cachedPlatform;
        }
    } catch {
        // SDK not available or error
    }

    // Check if running in an iframe (could be Base app embedding)
    if (typeof window !== 'undefined' && window.parent !== window) {
        cachedPlatform = 'base';
        return cachedPlatform;
    }

    cachedPlatform = 'web';
    return cachedPlatform;
};

export const isMiniapp = async (): Promise<boolean> => {
    const platform = await detectPlatform();
    return platform === 'farcaster' || platform === 'base';
};
