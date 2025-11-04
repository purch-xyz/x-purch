import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
	createSigner,
	decodeXPaymentResponse,
	wrapFetchWithPayment,
} from "x402-fetch";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

const promptPrivateKey = async () => {
	const rl = readline.createInterface({ input, output });
	const key = await rl.question("Enter Solana private key (base58): ");
	rl.close();
	return key.trim();
};

const createSignerFromPrivateKey = async (privateKeyBase58: string) => {
	const secretKey = bs58.decode(privateKeyBase58);
	const keypair = Keypair.fromSecretKey(secretKey);
	const signer = await createSigner("solana", privateKeyBase58);
	return { signer, keypair };
};

const fetchWithPaymentEndpoint = async (
	publicKey: string,
	signer: Awaited<ReturnType<typeof createSigner>>,
) => {
	const fetchWithPayment = wrapFetchWithPayment(fetch, signer);

	const requestBody = {
		email: "",
		payerAddress: publicKey,
		productUrl:
			"https://www.amazon.com/Wikavanli-Keychains-Keyring-Holder-Organizer/dp/B0D66ZJB7N",
		physicalAddress: {
			name: "",
			line1: "",
			city: "",
			state: "",
			postalCode: "",
			country: "",
		},
	};

	console.log("➡️  Sending unpaid request to /orders/solana...");
	const preliminaryResponse = await fetch(`${API_BASE_URL}/orders/solana`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(requestBody),
	});

	if (preliminaryResponse.status !== 402) {
		throw new Error(
			`Expected 402 Payment Required, got ${preliminaryResponse.status}`,
		);
	}
	console.log("✅ Received 402 as expected.");

	console.log("➡️  Retrying with automatic payment handling...");
	const paidResponse = await fetchWithPayment(`${API_BASE_URL}/orders/solana`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(requestBody),
	});

	if (!paidResponse.ok) {
		throw new Error(
			`Paid request failed: ${paidResponse.status} ${paidResponse.statusText}`,
		);
	}

	const paymentHeader = paidResponse.headers.get("x-payment-response");
	if (paymentHeader) {
		console.log(
			"Decoded payment response:",
			decodeXPaymentResponse(paymentHeader),
		);
	}
	console.log("✅ Payment settled. Reading response body...");

	return paidResponse.json();
};

const main = async () => {
	try {
		console.log(`🌐 API base URL: ${API_BASE_URL}`);
		console.log("Attempting to access Solana endpoint without payment...");
		console.log("Expecting 402 Payment Required response.");
		const privateKey =
			process.env.SOLANA_PRIVATE_KEY ?? (await promptPrivateKey());
		const { signer, keypair } = await createSignerFromPrivateKey(privateKey);
		const publicKeyString = keypair.publicKey.toBase58();
		console.log("Using Solana wallet:", publicKeyString);

		const connection = new Connection("https://api.mainnet-beta.solana.com");
		try {
			const balance = await connection.getBalance(keypair.publicKey);
			console.log("Current SOL balance:", balance / 1e9);
		} catch {
			console.log("Could not retrieve SOL balance.");
		}

		console.log("Executing paid request to Solana endpoint...");
		const responseData = await fetchWithPaymentEndpoint(
			publicKeyString,
			signer,
		);
		console.log("Server response:", responseData);
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : error);
		process.exit(1);
	}
};

main();
