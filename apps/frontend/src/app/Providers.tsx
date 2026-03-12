"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <PrivyProvider
            appId="cmludcqch013c0bkyqc7yq2lf"
            config={{
                appearance: {
                    theme: "dark",
                    accentColor: "#22d3ee", // cyan-400
                    showWalletLoginFirst: true,
                },
                embeddedWallets: {
                    createOnLogin: "users-without-wallets",
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
