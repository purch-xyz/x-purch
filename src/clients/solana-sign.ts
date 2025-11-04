import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL =
	process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const prompt = async (label: string) => {
	const rl = readline.createInterface({ input, output });
	const value = await rl.question(label);
	rl.close();
	return value.trim();
};

const getPrivateKey = async () =>
	process.env.SOLANA_PRIVATE_KEY ??
	(await prompt("Enter Solana private key (base58): "));

const getSerializedTransaction = async () =>
	process.env.SERIALIZED_TRANSACTION ??
	(await prompt("Paste serialized transaction (base58): "));

const shouldBroadcast = async () => {
	const answer =
		process.env.BROADCAST_SIGNED_TX ??
		(await prompt("Broadcast signed transaction? (y/N): "));
	return answer.toLowerCase() === "y";
};

const main = async () => {
	try {
		const privateKeyBase58 = await getPrivateKey();
		const transactionBase58 = await getSerializedTransaction();

		const secretKey = bs58.decode(privateKeyBase58);
		const keypair = Keypair.fromSecretKey(secretKey);
		const connection = new Connection(RPC_URL, "confirmed");

		console.log("Using wallet:", keypair.publicKey.toBase58());
		console.log("RPC URL:", RPC_URL);

		const transactionBytes = bs58.decode(transactionBase58);
		const transaction = Transaction.from(transactionBytes);

		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash();
		transaction.recentBlockhash = blockhash;
		transaction.lastValidBlockHeight = lastValidBlockHeight;

		transaction.sign(keypair);
		const signedTransaction = transaction.serialize();
		const signedBase58 = bs58.encode(signedTransaction);

		console.log("Signed transaction (base58):", signedBase58);

		if (await shouldBroadcast()) {
			console.log("Broadcasting transaction...");
			const signature = await connection.sendRawTransaction(signedTransaction);
			console.log("Submitted signature:", signature);
			const status = await connection.confirmTransaction(
				{ signature },
				"confirmed",
			);
			console.log("Confirmation status:", status.value);
		}
	} catch (error) {
		console.error(
			"Failed to sign transaction:",
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	}
};

main();
