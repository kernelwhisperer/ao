

import fs from 'fs';
import path from 'path';
import { defaultCacheOptions, UnsafeClientOptions, WarpFactory } from 'warp-contracts';

(async function () {
    console.log('Testing test dre...');

    let contractId = "yvWawTXhK-EsgVnNOeoQJOPK4ZEoBZ9P77JZ6jwBVJM";
    let dreHost = 'https://dre-1.warp.cc';
    let dreNode = dreHost + '/contract';

    const walletPath = process.env.PATH_TO_WALLET;

    let walletKey = JSON.parse(fs.readFileSync(path.resolve(walletPath), 'utf8'));
    
    let warp = WarpFactory.forMainnet({
        ...defaultCacheOptions,
        inMemory: true,
    });

    let u: UnsafeClientOptions = 'skip';

    let options = {
		allowBigInt: true,
		internalWrites: true,
		remoteStateSyncEnabled: true,
		remoteStateSyncSource: dreNode,
		unsafeClient: u,
	};

    let input = {function: "balance"};

    const warpContract = warp
        .contract(contractId)
        .connect(walletKey)
        .setEvaluationOptions(options);

    let res = await warpContract.writeInteraction(input);

    // must read state to load the new state/sortKey into the DRE
    // await warpContract.readState();

    // let originalTxId = res.originalTxId;

    // let crankResponse = await fetch(`http://localhost:3004/crank/${originalTxId}`, {
    //     method: `POST`,
    //     headers: {
    //         'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify({
    //         dre: dreHost
    //     })
    // });

    // console.log(await crankResponse.text());
    
})();