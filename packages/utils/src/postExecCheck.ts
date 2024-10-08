import { resolveProperties } from "ethers/lib/utils";
import Debug from "debug";
import { IEntryPoint } from "./types";
import { PackedUserOperation } from "./Utils";

const debug = Debug("aa.postExec");

export async function postExecutionDump(entryPoint: IEntryPoint, userOpHash: string): Promise<void> {
	const { gasPaid, gasUsed, success, userOp } = await postExecutionCheck(entryPoint, userOpHash);
	/// / debug dump:
	debug(
		"==== used=",
		gasUsed,
		"paid",
		gasPaid,
		"over=",
		gasPaid - gasUsed,
		"callLen=",
		userOp?.callData?.length,
		"initLen=",
		userOp?.initCode?.length,
		success ? "success" : "failed"
	);
}

/**
 * check whether an already executed UserOperation paid enough
 * (the only field that EntryPoint can check is the preVerificationGas.
 * There is no "view-mode" way to determine the actual gas cost of a given transaction,
 * so we must do it after mining it.
 * @param entryPoint
 * @param userOpHash
 */
export async function postExecutionCheck(
	entryPoint: IEntryPoint,
	userOpHash: string
): Promise<{
	gasUsed: number;
	gasPaid: number;
	success: boolean;
	userOp: PackedUserOperation;
}> {
	const currentBlockNumber = await entryPoint.provider.getBlockNumber();
	const blockSpan = 1000;
	const req = await entryPoint.queryFilter(
		entryPoint.filters.UserOperationEvent(userOpHash),
		currentBlockNumber - blockSpan
	);
	if (req.length === 0) {
		debug("postExecutionCheck: failed to read event (not mined)");
		// @ts-ignore
		return { gasUsed: 0, gasPaid: 0, success: false, userOp: {} };
	}
	const transactionReceipt = await req[0].getTransactionReceipt();

	const tx = await req[0].getTransaction();
	const { ops } = entryPoint.interface.decodeFunctionData("handleOps", tx.data);
	const userOp = await resolveProperties(ops[0] as PackedUserOperation);
	const { actualGasUsed, success } = req[0].args;
	const gasPaid = actualGasUsed.toNumber();
	const gasUsed = transactionReceipt.gasUsed.toNumber();
	return {
		gasUsed,
		gasPaid,
		success,
		userOp,
	};
}
