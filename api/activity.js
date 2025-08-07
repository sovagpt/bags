// /api/activity.js - Simplified with better error handling
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
    
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    
    // Simple test first
    const rpcUrl = 'https://api.mainnet-beta.solana.com';
    
    console.log('Fetching signatures...');
    
    // Get signatures with error handling
    const signaturesResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet, { limit: 20 }] // Start with just 20
      })
    });
    
    if (!signaturesResponse.ok) {
      throw new Error(`RPC failed: ${signaturesResponse.status}`);
    }
    
    const signaturesData = await signaturesResponse.json();
    console.log(`Got ${signaturesData?.result?.length || 0} signatures`);
    
    if (!signaturesData?.result?.length) {
      return res.status(200).json({
        wallet: wallet,
        hasInteracted: false,
        status: 'No transactions found',
        checkedTransactions: 0,
        foundPrograms: []
      });
    }
    
    // Check just the first few transactions to avoid timeouts
    const signatures = signaturesData.result.slice(0, 5);
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
        
        if (txData?.result?.transaction?.message?.accountKeys && txData.result.transaction.message.instructions) {
          const accountKeys = txData.result.transaction.message.accountKeys;
          const instructions = txData.result.transaction.message.instructions;
          
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
                console.log(`FOUND FEE PROGRAM in ${sig.signature}!`);
                break;
              }
            }
          }
          
          if (foundProgram) break;
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (txError) {
        console.log(`Error with tx ${sig.signature}: ${txError.message}`);
        continue;
      }
    }
    
    console.log(`Check complete. Found program: ${foundProgram}`);
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
