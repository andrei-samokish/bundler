import { SimpleAccountAPI } from "@account-abstraction/sdk";
import { JsonRpcProvider } from "@ethersproject/providers";
import { expect } from "chai";
import { Signer, Wallet } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

import {
	DeterministicDeployer,
	IEntryPoint,
	SimpleAccountFactory__factory,
	deployEntryPoint,
	resolveHexlify,
} from "@account-abstraction/utils";
import { ValidationManager, supportsDebugTraceCall } from "@account-abstraction/validation-manager";

import { BundlerConfig } from "../src/BundlerConfig";
import { DebugMethodHandler } from "../src/DebugMethodHandler";
import { MethodHandlerERC4337 } from "../src/MethodHandlerERC4337";
import { BundleManager, SendBundleReturn } from "../src/modules/BundleManager";
import { ExecutionManager } from "../src/modules/ExecutionManager";
import { MempoolManager } from "../src/modules/MempoolManager";
import { BundlerReputationParams, ReputationManager } from "../src/modules/ReputationManager";

import { DepositManager } from "../src/modules/DepositManager";
import { EventsManager } from "../src/modules/EventsManager";
import { createSigner } from "./testUtils";

const provider = ethers.provider;

describe("#DebugMethodHandler", () => {
	let debugMethodHandler: DebugMethodHandler;
	let entryPoint: IEntryPoint;
	let methodHandler: MethodHandlerERC4337;
	let smartAccountAPI: SimpleAccountAPI;
	let signer: Signer;
	const accountSigner = Wallet.createRandom();

	before(async () => {
		signer = await createSigner();

		entryPoint = await deployEntryPoint(provider);
		DeterministicDeployer.init(provider);

		const config: BundlerConfig = {
			useRip7560Mode: false,
			beneficiary: await signer.getAddress(),
			entryPoint: entryPoint.address,
			gasFactor: "0.2",
			minBalance: "0",
			mnemonic: "",
			network: "",
			port: 3000,
			host: "localhost",
			unsafe: !(await supportsDebugTraceCall(provider as any, false)),
			conditionalRpc: false,
			autoBundleInterval: 0,
			autoBundleMempoolSize: 0,
			maxBundleGas: 5e6,
			// minstake zero, since we don't fund deployer.
			minStake: "0",
			minUnstakeDelay: 0,
		};

		const repMgr = new ReputationManager(
			provider,
			BundlerReputationParams,
			parseEther(config.minStake),
			config.minUnstakeDelay
		);
		const mempoolMgr = new MempoolManager(repMgr);
		const validMgr = new ValidationManager(entryPoint, config.unsafe);
		const eventsManager = new EventsManager(entryPoint, mempoolMgr, repMgr);
		const bundleMgr = new BundleManager(
			entryPoint,
			entryPoint.provider as JsonRpcProvider,
			entryPoint.signer,
			eventsManager,
			mempoolMgr,
			validMgr,
			repMgr,
			config.beneficiary,
			parseEther(config.minBalance),
			config.maxBundleGas,
			false
		);
		const depositManager = new DepositManager(entryPoint, mempoolMgr, bundleMgr);
		const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr, depositManager);
		methodHandler = new MethodHandlerERC4337(execManager, provider, signer, config, entryPoint, validMgr);

		debugMethodHandler = new DebugMethodHandler(execManager, eventsManager, repMgr, mempoolMgr);

		DeterministicDeployer.init(ethers.provider);
		const accountDeployerAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [
			entryPoint.address,
		]);

		smartAccountAPI = new SimpleAccountAPI({
			provider,
			entryPointAddress: entryPoint.address,
			owner: accountSigner,
			factoryAddress: accountDeployerAddress,
		});
		const accountAddress = await smartAccountAPI.getAccountAddress();
		await signer.sendTransaction({
			to: accountAddress,
			value: parseEther("1"),
		});
	});

	it("should return sendBundleNow hashes", async () => {
		debugMethodHandler.setBundlingMode("manual");
		const addr = await smartAccountAPI.getAccountAddress();
		const op1 = await smartAccountAPI.createSignedUserOp({
			target: addr,
			data: "0x",
		});
		const userOpHash = await methodHandler.sendUserOperation(await resolveHexlify(op1), entryPoint.address);
		const { transactionHash, userOpHashes } = (await debugMethodHandler.sendBundleNow()) as SendBundleReturn;
		expect(userOpHashes).eql([userOpHash]);
		const txRcpt = await provider.getTransactionReceipt(transactionHash);
		expect(txRcpt.to).to.eq(entryPoint.address);
	});
});
