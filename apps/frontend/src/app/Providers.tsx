"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
    const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

    if (!privyAppId) {
        return (
            <div className="min-h-screen bg-black p-10 text-white">
                <p className="text-sm text-red-300">NEXT_PUBLIC_PRIVY_APP_ID is required to run the production wallet flow.</p>
            </div>
        );
    }

    return (
        <PrivyProvider
            appId={privyAppId}
            config={{
                appearance: {
                    theme: "dark",
                    accentColor: "#22d3ee",
                    showWalletLoginFirst: true,
                },
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: "users-without-wallets",
                    },
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
