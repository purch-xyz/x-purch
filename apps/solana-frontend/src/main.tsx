import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./index.css";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
	ConnectionProvider,
	WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import App from "./App.tsx";
import "@solana/wallet-adapter-react-ui/styles.css";

const endpoint =
	import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl("mainnet-beta");

const wallets = [new PhantomWalletAdapter(), new BackpackWalletAdapter()];
const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<ConnectionProvider endpoint={endpoint}>
			<WalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>
					<App />
				</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
	</StrictMode>,
);
