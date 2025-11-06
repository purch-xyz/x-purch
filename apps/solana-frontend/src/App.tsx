import { useCallback, useEffect, useMemo, useState } from "react";
import { selectPaymentRequirements } from "x402/client";
import { decodeXPaymentResponse, wrapFetchWithPayment } from "x402-fetch";
import logo from "./assets/purch_black_logo.png";
import type { CrossmintOrderResponse } from "./types";
import "./App.css";
import { type Address, address as toAddress } from "@solana/addresses";
import type { SignatureBytes } from "@solana/keys";
import type { TransactionSigner } from "@solana/signers";
import type { Transaction as KitTransaction } from "@solana/transactions";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedMessage, VersionedTransaction } from "@solana/web3.js";

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL ?? "";

interface OrderForm {
	email: string;
	payerAddress: string;
	locale: string;
	productUrl: string;
	name: string;
	line1: string;
	line2: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
}

type Step =
	| "idle"
	| "submitting"
	| "awaitingPayment"
	| "authorizing"
	| "success"
	| "error";

const initialForm: OrderForm = {
	email: "",
	payerAddress: "",
	locale: "en-US",
	productUrl: "",
	name: "",
	line1: "",
	line2: "",
	city: "",
	state: "",
	postalCode: "",
	country: "US",
};

interface OrderPayload {
	email: string;
	payerAddress: string;
	locale?: string;
	productUrl: string;
	physicalAddress: {
		name: string;
		line1: string;
		line2?: string;
		city: string;
		state?: string;
		postalCode: string;
		country: string;
	};
}

interface ResultState {
	response?: CrossmintOrderResponse;
	rawHeader?: string | null;
	errorMessage?: string;
	errorStatus?: number;
}

const fieldLabels: Record<keyof OrderForm, string> = {
	email: "Email",
	payerAddress: "Payer Wallet Address",
	locale: "Locale",
	productUrl: "Product URL",
	name: "Recipient Name",
	line1: "Address Line 1",
	line2: "Address Line 2",
	city: "City",
	state: "State / Region",
	postalCode: "Postal Code",
	country: "Country Code",
};

const fieldOrder: (keyof OrderForm)[] = [
	"email",
	"payerAddress",
	"locale",
	"productUrl",
	"name",
	"line1",
	"line2",
	"city",
	"state",
	"postalCode",
	"country",
];

const App = () => {
	const [form, setForm] = useState<OrderForm>(initialForm);
	const [step, setStep] = useState<Step>("idle");
	const [result, setResult] = useState<ResultState>({});
	const [lastPayload, setLastPayload] = useState<OrderPayload | null>(null);
	type PaymentRequirement = ReturnType<typeof selectPaymentRequirements>;

	const [paymentRequirements, setPaymentRequirements] =
		useState<PaymentRequirement | null>(null);
	const [x402Version, setX402Version] = useState<number | null>(null);
	const {
		publicKey,
		connected,
		disconnect,
		signTransaction,
		signAllTransactions,
	} = useWallet();
	const { setVisible: setWalletModalVisible } = useWalletModal();

	useEffect(() => {
		setForm((prev) => ({
			...prev,
			payerAddress: publicKey ? publicKey.toBase58() : "",
		}));
	}, [publicKey]);

	const paymentSummary = useMemo(() => {
		if (!paymentRequirements) {
			return null;
		}

		const microAmount = Number(paymentRequirements.maxAmountRequired);
		const amount =
			Number.isFinite(microAmount) && microAmount > 0
				? (microAmount / 1_000_000).toFixed(2)
				: paymentRequirements.maxAmountRequired;

		const payTo = Array.isArray(paymentRequirements.payTo)
			? paymentRequirements.payTo[0]
			: paymentRequirements.payTo;

		const asset =
			typeof paymentRequirements.asset === "string"
				? paymentRequirements.asset
				: paymentRequirements.asset[0];

		return {
			amount,
			asset,
			network: paymentRequirements.network,
			payTo,
		};
	}, [paymentRequirements]);

	const hasSuccess = step === "success" && Boolean(result.response);

	const updateField = <T extends keyof OrderForm>(field: T, value: string) => {
		setForm((prev) => ({
			...prev,
			[field]: value,
		}));
	};

	const toVersionedTransaction = useCallback((transaction: KitTransaction) => {
		const message = VersionedMessage.deserialize(
			new Uint8Array(transaction.messageBytes),
		);

		const signerKeys = message.staticAccountKeys.slice(
			0,
			message.header.numRequiredSignatures,
		);

		const signatureMap = transaction.signatures as Record<
			string,
			SignatureBytes | null
		>;

		const signatures = signerKeys.map((key) => {
			const existing = signatureMap[key.toBase58()];
			return existing ? new Uint8Array(existing) : new Uint8Array(64);
		});

		return new VersionedTransaction(message, signatures);
	}, []);

	const versionedSignaturesToRecord = useCallback(
		(tx: VersionedTransaction): Readonly<Record<Address, SignatureBytes>> => {
			const signerKeys = tx.message.staticAccountKeys.slice(
				0,
				tx.message.header.numRequiredSignatures,
			);

			const signatureMap: Record<string, SignatureBytes> = {};

			signerKeys.forEach((key, index) => {
				const signatureBytes = tx.signatures[index];

				if (signatureBytes) {
					signatureMap[key.toBase58()] = signatureBytes as SignatureBytes;
				}
			});

			return Object.freeze(signatureMap) as Readonly<
				Record<Address, SignatureBytes>
			>;
		},
		[],
	);

	const walletSigner = useCallback((): TransactionSigner => {
		if (!publicKey) {
			throw new Error("Connect a Solana wallet to proceed.");
		}

		if (!signTransaction && !signAllTransactions) {
			throw new Error("Connected wallet cannot sign transactions.");
		}

		const signerAddress = toAddress(publicKey.toBase58());

		return {
			address: signerAddress,
			async signTransactions(transactions) {
				const versioned = transactions.map(toVersionedTransaction);

				let signed: VersionedTransaction[];

				if (signAllTransactions) {
					const result = await signAllTransactions(versioned);
					signed = result ?? versioned;
				} else if (signTransaction) {
					const list: VersionedTransaction[] = [];

					for (const transaction of versioned) {
						const result = await signTransaction(transaction);
						list.push(result ?? transaction);
					}

					signed = list;
				} else {
					throw new Error("Wallet missing signing capability.");
				}

				return signed.map(versionedSignaturesToRecord);
			},
		};
	}, [
		publicKey,
		signAllTransactions,
		signTransaction,
		toVersionedTransaction,
		versionedSignaturesToRecord,
	]);

	const shortAddress = useMemo(() => {
		if (!form.payerAddress) {
			return "";
		}
		return `${form.payerAddress.slice(0, 4)}...${form.payerAddress.slice(-4)}`;
	}, [form.payerAddress]);

	const buildPayload = (): OrderPayload => ({
		email: form.email.trim(),
		payerAddress: form.payerAddress.trim(),
		locale: form.locale.trim() || undefined,
		productUrl: form.productUrl.trim(),
		physicalAddress: {
			name: form.name.trim(),
			line1: form.line1.trim(),
			line2: form.line2.trim() || undefined,
			city: form.city.trim(),
			state: form.state.trim() || undefined,
			postalCode: form.postalCode.trim(),
			country: form.country.trim().toUpperCase(),
		},
	});

	const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (
		event,
	) => {
		event.preventDefault();
		setResult({});
		setStep("submitting");
		setPaymentRequirements(null);
		setX402Version(null);
		setLastPayload(null);

		if (!publicKey) {
			setResult({
				errorMessage: "Connect your Solana wallet before submitting the order.",
			});
			setStep("error");
			setWalletModalVisible(true);
			return;
		}

		const payload = buildPayload();

		try {
			const response = await fetch(`${API_BASE_URL}/orders/solana`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (response.status === 402) {
				const body = (await response.json().catch(() => null)) as {
					accepts?: Parameters<typeof selectPaymentRequirements>[0];
					x402Version?: number;
				} | null;

				let selectedRequirement: PaymentRequirement | null = null;

				if (Array.isArray(body?.accepts) && body.accepts.length > 0) {
					try {
						selectedRequirement = selectPaymentRequirements(
							body.accepts as Parameters<typeof selectPaymentRequirements>[0],
							"solana",
							"exact",
						);
					} catch (selectionError) {
						console.warn(
							"[x402] Failed to select payment requirement",
							selectionError,
						);
						selectedRequirement =
							(body.accepts[0] as PaymentRequirement | undefined) ?? null;
					}
				}

				setPaymentRequirements(selectedRequirement);
				setX402Version(
					typeof body?.x402Version === "number" ? body.x402Version : 1,
				);
				setStep("awaitingPayment");
				setLastPayload(payload);
				return;
			}

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				setResult({
					errorMessage:
						(body?.error as string | undefined) ??
						`Request failed with status ${response.status}`,
					errorStatus: response.status,
				});
				setStep("error");
				return;
			}

			const data = (await response.json()) as CrossmintOrderResponse;
			setResult({
				response: data,
				rawHeader: response.headers.get("x-payment-response"),
			});
			setLastPayload(null);
			setStep("success");
		} catch (error) {
			setResult({
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			setStep("error");
		}
	};

	const authorizePayment = async () => {
		if (!lastPayload) {
			return;
		}

		if (!publicKey) {
			setResult({
				errorMessage: "Connect a Solana wallet to authorize the payment.",
			});
			setStep("error");
			setWalletModalVisible(true);
			return;
		}

		if (!paymentRequirements) {
			setResult({
				errorMessage:
					"Payment requirements missing. Resubmit the order to fetch a fresh 402 response.",
			});
			setStep("error");
			return;
		}

		setStep("authorizing");
		setResult({});

		try {
			const signer = walletSigner();
			const fetchWithPayment = wrapFetchWithPayment(
				fetch,
				signer,
				undefined,
				undefined,
				SOLANA_RPC_URL
					? {
							svmConfig: { rpcUrl: SOLANA_RPC_URL },
						}
					: undefined,
			);

			const response = await fetchWithPayment(`${API_BASE_URL}/orders/solana`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(lastPayload),
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				setResult({
					errorMessage:
						(body?.error as string | undefined) ??
						`Request failed with status ${response.status}`,
					errorStatus: response.status,
				});
				setStep("error");
				return;
			}

			const data = (await response.json()) as CrossmintOrderResponse;
			const rawHeader = response.headers.get("x-payment-response");
			setResult({
				response: data,
				rawHeader,
			});
			setLastPayload(null);
			setPaymentRequirements(null);
			setX402Version(null);
			setStep("success");
		} catch (error) {
			setResult({
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			setStep("error");
		}
	};

	const decodedHeader = useMemo(() => {
		if (!result.rawHeader) {
			return null;
		}

		try {
			return decodeXPaymentResponse(result.rawHeader);
		} catch {
			return null;
		}
	}, [result.rawHeader]);

	return (
		<div className="page">
			<img src={logo} alt="Purch logo" className="logoMark" />
			<header className="hero">
				<h1 className="title strong">X-Purch Console</h1>
				<p className="title blurb">X-Purch is a x402-powered checkout</p>
				<p className="lede steps">
					1. Connect your Solana wallet
					<br />
					2. Choose any product from <b>Amazon (US)</b> or{" "}
					<b>Shopify (Global)</b>
					<br />
					3. Pay in <b>USDC</b>
					<br />
					4. Purch handles the hunt and your product delivered to your place
				</p>
				<div className="connectRow">
					<button
						type="button"
						className={`primary connectButton ${connected ? "ghost" : ""}`}
						onClick={() => {
							if (connected) {
								disconnect().catch(() => undefined);
							} else {
								setWalletModalVisible(true);
							}
						}}
					>
						{connected && form.payerAddress
							? `Disconnect ${shortAddress}`
							: "Connect Wallet"}
					</button>
				</div>
			</header>

			<main className="content">
				<section className="panel">
					<h2 className="sectionTitle strong">Order Details</h2>
					<form className="form" onSubmit={handleSubmit}>
						<div className="grid">
							{fieldOrder.map((key) => {
								const value = form[key];
								const isOptional = key === "line2" || key === "locale";
								const isWalletField = key === "payerAddress";

								return (
									<label key={key} className="field">
										<span className="fieldLabel">{fieldLabels[key]}</span>
										<input
											required={!isOptional && !isWalletField}
											value={value}
											readOnly={isWalletField}
											className={isWalletField ? "readOnlyField" : undefined}
											onChange={(event) => {
												if (isWalletField) {
													return;
												}

												updateField(key, event.target.value);
											}}
											placeholder={
												isWalletField
													? connected && form.payerAddress
														? shortAddress
														: "Connect wallet"
													: key === "line2"
														? "Optional apartment or suite"
														: key === "locale"
															? "Defaults to en-US"
															: ""
											}
										/>
									</label>
								);
							})}
						</div>

						<div className="divider" />

						<div className="actions">
							<button
								className="primary"
								type="submit"
								disabled={
									step === "submitting" ||
									step === "authorizing" ||
									!connected ||
									!form.payerAddress
								}
							>
								{step === "submitting" ? "Sending…" : "Send Order Request"}
							</button>
							{(step === "awaitingPayment" || step === "authorizing") && (
								<button
									type="button"
									className="primary ghost"
									onClick={authorizePayment}
									disabled={step === "authorizing"}
								>
									{step === "authorizing"
										? "Authorizing Payment…"
										: "Authorize Payment & Finalize"}
								</button>
							)}
						</div>

						{step === "awaitingPayment" && (
							<p className="status waiting">
								Step 1 complete — payment request{" "}
								{paymentSummary
									? `for ${paymentSummary.amount} USDC to ${paymentSummary.payTo}`
									: "received"}
								. Authorize the transaction to continue.
							</p>
						)}
						{step === "authorizing" && (
							<p className="status note">
								Verifying signature and retrying with payment middleware…
							</p>
						)}
						{step === "error" && result.errorMessage && (
							<div className="status error">
								<strong>
									Request failed
									{result.errorStatus ? ` (${result.errorStatus})` : ""}:
								</strong>{" "}
								{result.errorMessage}
							</div>
						)}
						{step === "success" && result.response && (
							<div className="status success">
								<strong>Payment settled.</strong> Order{" "}
								<code>{result.response.orderId}</code> confirmed.
							</div>
						)}
					</form>
				</section>

				<section className="panel">
					<h2 className="sectionTitle strong">Response Logs</h2>
					<div className="terminal">
						<div className="terminalHeader">
							<span>purch@x402</span>
							<span className="terminalBadge">
								{step === "success"
									? "settled"
									: step === "awaitingPayment"
										? "awaiting"
										: "idle"}
							</span>
						</div>
						<div className="terminalBody">
							{paymentSummary && (
								<div className="logBlock">
									<div className="logPrompt">$ payment.requirements</div>
									<pre className="logPre">
										{JSON.stringify(
											{
												network: paymentSummary.network,
												amount: `${paymentSummary.amount} USDC`,
												asset: paymentSummary.asset,
												payTo: paymentSummary.payTo,
												version: x402Version ?? 1,
											},
											null,
											2,
										)}
									</pre>
								</div>
							)}
							{hasSuccess && result.response && (
								<div className="logBlock">
									<div className="logPrompt">$ curl -s POST /orders/solana</div>
									<pre className="logPre">
										{JSON.stringify(result.response, null, 2)}
									</pre>
								</div>
							)}
							{decodedHeader && (
								<div className="logBlock">
									<div className="logPrompt">$ decode x-payment-response</div>
									<pre className="logPre">
										{JSON.stringify(decodedHeader, null, 2)}
									</pre>
								</div>
							)}
							{!paymentSummary && !hasSuccess && (
								<div className="logPlaceholder">
									$ awaiting order submission to inspect requirements…
								</div>
							)}
							{paymentSummary && !hasSuccess && (
								<div className="logPlaceholder">
									$ authorize payment to continue and reveal settlement payload
								</div>
							)}
						</div>
					</div>
				</section>
			</main>
		</div>
	);
};

export default App;
