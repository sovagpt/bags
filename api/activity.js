// /api/activity.js - Simple program interaction check
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
    console.log(`Checking if ${wallet} interacted with fee program...`);
    
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    const hasInteracted = await checkProgramInteraction(wallet, FEE_PROGRAM);
    
    return res.status(200).json({
      wallet: wallet,
      feeProgram: FEE_PROGRAM,
      hasInteracted: hasInteracted,
      status: hasInteracted ? 'Active Fee Claimer' : 'No Fee Claims Detected'
    });
    
  } catch (error) {
    console.error('Check failed:', error);
    
    return res.status(200).json({
      wallet: wallet,
      hasInteracted: false,
      error: error.message,
      status: 'Check Failed'
    });
  }
}

async function checkProgramInteraction(wallet, targetProgram) {
  try {
    // Use free Solana RPC
    const rpcUrl = 'https://api.mainnet-beta.solana.com';
    
    // Get recent transaction signatures (just need to check if any exist)
    const signaturesResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet, { limit: 50 }] // Check last 50 transactions
      })
    });
    
    const signaturesData = await signaturesResponse.json();
    
    if (!signaturesData?.result?.length) {
      return false; // No transactions found
    }
    
    console.log(`Found ${signaturesData.result.length} transactions, checking for program...`);
    
    // Check each transaction for the target program
    for (const sig of signaturesData.result) {
      try {
        const txResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [
              sig.signature,
              { encoding: 'json', maxSupportedTransactionVersion: 0 }
            ]
          })
        });
        
        const txData = await txResponse.json();
        
        if (txData?.result?.transaction?.message) {
          const accountKeys = txData.result.transaction.message.accountKeys;
          const instructions = txData.result.transaction.message.instructions || [];
          
          // Check if any instruction uses the target program
          for (const instruction of instructions) {
            const programId = accountKeys[instruction.programIdIndex];
            
            if (programId === targetProgram) {
              console.log(`✅ Found interaction with ${targetProgram} in tx: ${sig.signature}`);
              return true; // Found it!
            }
          }
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (txError) {
        console.log(`Error checking tx ${sig.signature}: ${txError.message}`);
        continue; // Skip this transaction and try next
      }
    }
    
    console.log(`❌ No interactions found with ${targetProgram}`);
    return false; // Checked all transactions, none found
    
  } catch (error) {
    console.error('RPC check failed:', error);
    throw new Error(`Failed to check program interaction: ${error.message}`);
  }
}
