import axios from "axios";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { decodeXPaymentResponse, withPaymentInterceptor } from "x402-axios";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

const requestBody = {
	email: "",
	productUrl: "https://www.amazon.com/dp/B01DFKC2SO",
	physicalAddress: {
		name: "",
		line1: "",
		city: "",
		state: "",
		postalCode: "",
		country: "",
	},
};

const postWithoutPayment = async () =>
	axios.post(`${API_BASE_URL}/orders/base`, requestBody, {
		headers: { "Content-Type": "application/json" },
	});

const postWithPayment = async (
	client: ReturnType<typeof withPaymentInterceptor>,
) =>
	client.post(`${API_BASE_URL}/orders/base`, requestBody, {
		headers: { "Content-Type": "application/json" },
	});

const createClient = () => {
	const privateKey = process.env.BASE_PRIVATE_KEY;
	if (!privateKey) {
		throw new Error("BASE_PRIVATE_KEY environment variable is required");
	}

	const account = privateKeyToAccount(privateKey as `0x${string}`);
	const walletClient = createWalletClient({
		account,
		chain: base,
		transport: http(),
	}).extend(publicActions);

	const axiosInstance = axios.create();
	return withPaymentInterceptor(axiosInstance, walletClient);
};

const main = async () => {
	try {
		console.log(`🌐 API base URL: ${API_BASE_URL}`);
		console.log("Attempting to POST /orders/base without payment...");
		try {
			await postWithoutPayment();
		} catch (error) {
			if (axios.isAxiosError(error) && error.response?.status === 402) {
				console.log("✅ Received expected 402 Payment Required.");
			} else {
				throw error;
			}
		}

		const client = createClient();
		console.log("Attempting to POST /orders/base with payment...");
		const response = await postWithPayment(client);

		const paymentHeader = response.headers["x-payment-response"];
		if (paymentHeader) {
			console.log(
				"Decoded payment response:",
				decodeXPaymentResponse(paymentHeader as string),
			);
		}

		console.log("✅ Payment settled. Server response:", response.data);
	} catch (error) {
		console.error("Error executing base client:", error);
		process.exit(1);
	}
};

main();
