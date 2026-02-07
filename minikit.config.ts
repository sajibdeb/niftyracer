const ROOT_URL = 'https://niftyracer.fun';

export const minikitConfig = {
    accountAssociation: {
        header: "",
        payload: "",
        signature: ""
    },
    miniapp: {
        version: "1",
        name: "NiftyRacer",
        subtitle: "Web3 Racing Game on Base",
        description: "Race through neon highways, collect NEON tokens, buy cars, and earn rewards on-chain!",
        screenshotUrls: [ROOT_URL + '/img/screenshot1.png', ROOT_URL + '/img/screenshot2.png', ROOT_URL + '/img/screenshot3.png'],
        iconUrl: `${ROOT_URL}/img/logo.png`,
        splashImageUrl: `${ROOT_URL}/img/logo.png`,
        splashBackgroundColor: "#0d0d1a",
        homeUrl: ROOT_URL,
        webhookUrl: `${ROOT_URL}/api/webhook`,
        primaryCategory: "games",
        tags: ["racing", "web3", "nft", "base", "neon"],
        heroImageUrl: `${ROOT_URL}/img/logo.png`,
        tagline: "Race. Collect. Earn.",
        ogTitle: "NiftyRacer - Web3 Racing Game",
        ogDescription: "The ultimate Web3 racing game on Base. Race, collect NEON tokens, and earn rewards!",
        ogImageUrl: `${ROOT_URL}/img/logo.png`,
    },
} as const;
