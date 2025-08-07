// /api/activity.js - Fixed to check if wallet is signer & fee payer
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ 
      error: 'wallet parameter is required' 
    });
  }

  try {
    console.log(`Starting check for wallet: ${wallet}`);
    console.log(`Wallet length: ${wallet.length}, First 10 chars: ${wallet.substring(0, 10)}`);
    
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    
    // Use Helius RPC - much higher rate limits
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    const rpcUrl = HELIUS_API_KEY 
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com'; // Fallback to free RPC
    
    console.log(`Using RPC: ${rpcUrl.includes('helius') ? 'Helius' : 'Free Solana RPC'}`);
    
    console.log('Fetching signatures...');
    
    // Get signatures with error handling
    const signaturesResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet, { limit: 100 }] // Increased to check more transactions
      })
    });
    
    if (!signaturesResponse.ok) {
      throw new Error(`RPC failed: ${signaturesResponse.status}`);
    }
    
    const signaturesData = await signaturesResponse.json();
    console.log(`Got ${signaturesData?.result?.length || 0} signatures for wallet: ${wallet}`);
    console.log(`Sample signatures:`, signaturesData?.result?.slice(0, 3)?.map(s => s.signature));
    
    if (!signaturesData?.result?.length) {
      return res.status(200).json({
        wallet: wallet,
        hasInteracted: false,
        status: 'No transactions found',
        checkedTransactions: 0,
        foundPrograms: []
      });
    }
    
    // Check fewer transactions to avoid rate limits
    const signatures = signaturesData.result.slice(0, 10); // Reduced from 20 to 10
    const allPrograms = [];
    let foundProgram = false;
    let foundInTx = null;
    
    console.log(`Checking ${signatures.length} transactions...`);
    
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      
      try {
        console.log(`Checking tx ${i + 1}/${signatures.length}: ${sig.signature}`);
        
        const txResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [sig.signature, { encoding: 'json' }]
          })
        });
        
        if (!txResponse.ok) {
          console.log(`TX fetch failed: ${txResponse.status}`);
          continue;
        }
        
        const txData = await txResponse.json();
        
        if (txData?.error) {
          console.log(`TX error for ${sig.signature}:`, txData.error);
          continue;
        }
        
        if (txData?.result?.transaction?.message?.accountKeys && txData.result.transaction.message.instructions) {
          const accountKeys = txData.result.transaction.message.accountKeys;
          const instructions = txData.result.transaction.message.instructions;
          
          // 🔥 NEW CHECK: Verify the searched wallet is the signer & fee payer
          const firstAccount = accountKeys[0]; // This is the signer & fee payer
          const isSignerAndFeePayer = firstAccount === wallet;
          
          console.log(`TX ${sig.signature}: First account: ${firstAccount}, Searched wallet: ${wallet}, Match: ${isSignerAndFeePayer}`);
          
          if (!isSignerAndFeePayer) {
            console.log(`Wallet ${wallet} is not the signer/fee payer in ${sig.signature}. Signer: ${firstAccount}`);
            // Still check programs for debugging, but don't count as valid claim
            for (const instruction of instructions) {
              if (instruction.programIdIndex < accountKeys.length) {
                const programId = accountKeys[instruction.programIdIndex];
                if (!allPrograms.includes(programId)) {
                  allPrograms.push(programId);
                }
                if (programId === FEE_PROGRAM) {
                  console.log(`❌ Found fee program but wallet ${wallet} is not signer in ${sig.signature}`);
                }
              }
            }
            continue; // Skip this transaction for claims
          }
          
          console.log(`✅ Wallet ${wallet} IS the signer & fee payer in ${sig.signature}`);
          
          // Check each instruction
          for (const instruction of instructions) {
            if (instruction.programIdIndex < accountKeys.length) {
              const programId = accountKeys[instruction.programIdIndex];
              
              if (!allPrograms.includes(programId)) {
                allPrograms.push(programId);
              }
              
              if (programId === FEE_PROGRAM) {
                foundProgram = true;
                foundInTx = sig.signature;
                console.log(`🎯 FOUND FEE PROGRAM CLAIM by ${wallet} in ${sig.signature}!`);
                break;
              }
            }
          }
          
          if (foundProgram) break;
        }
        
        // Longer delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        
      } catch (txError) {
        console.log(`Error with tx ${sig.signature}: ${txError.message}`);
        continue;
      }
    }
    
    console.log(`Check complete. Found valid claim: ${foundProgram}`);
    console.log(`All programs found: ${allPrograms.length}`);
    
    return res.status(200).json({
      wallet: wallet,
      feeProgram: FEE_PROGRAM,
      hasInteracted: foundProgram,
      status: foundProgram ? 'Active Fee Claimer' : 'No Fee Claims Detected',
      checkedTransactions: signatures.length,
      foundPrograms: allPrograms.slice(0, 10), // Limit output
      foundInTx: foundInTx,
      debugInfo: `Checked ${signatures.length} transactions, found ${allPrograms.length} unique programs`
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    
    // Return error as JSON, not throw
    return res.status(200).json({
      wallet: wallet,
      hasInteracted: false,
      error: `Check failed: ${error.message}`,
      status: 'Error occurred',
      checkedTransactions: 0,
      foundPrograms: []
    });
  }
}
