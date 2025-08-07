// /api/activity.js - Search fee program transactions for user wallet
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
    console.log(`🔍 Searching fee program transactions for wallet: ${wallet}`);
    
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    
    // Use Helius RPC - much higher rate limits
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    const rpcUrl = HELIUS_API_KEY 
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com';
    
    console.log(`Using RPC: ${rpcUrl.includes('helius') ? 'Helius' : 'Free Solana RPC'}`);
    
    // 🎯 NEW APPROACH: Get transactions FROM the fee program (not user wallet)
    console.log(`Getting fee program transactions...`);
    
    const signaturesResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [FEE_PROGRAM, { limit: 500 }] // Check recent 500 fee program transactions
      })
    });
    
    if (!signaturesResponse.ok) {
      throw new Error(`RPC failed: ${signaturesResponse.status}`);
    }
    
    const signaturesData = await signaturesResponse.json();
    console.log(`📊 Got ${signaturesData?.result?.length || 0} fee program transactions`);
    
    if (!signaturesData?.result?.length) {
      return res.status(200).json({
        wallet: wallet,
        hasInteracted: false,
        status: 'No fee program transactions found',
        checkedTransactions: 0,
        method: 'fee_program_search'
      });
    }
    
    // Check transactions for the user's wallet as signer
    const signatures = signaturesData.result.slice(0, 100); // Check first 100 transactions
    let foundClaim = false;
    let claimTransaction = null;
    let checkedCount = 0;
    
    console.log(`🔍 Searching ${signatures.length} fee program transactions for wallet ${wallet}...`);
    
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      checkedCount++;
      
      try {
        console.log(`Checking fee tx ${i + 1}/${signatures.length}: ${sig.signature}`);
        
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
        
        if (txData?.result?.transaction?.message?.accountKeys) {
          const accountKeys = txData.result.transaction.message.accountKeys;
          const firstAccount = accountKeys[0]; // Signer & fee payer
          
          // 🎯 CHECK: Is the searched wallet the signer of this fee program transaction?
          if (firstAccount === wallet) {
            console.log(`🎉 FOUND CLAIM! Wallet ${wallet} is signer in fee program tx: ${sig.signature}`);
            foundClaim = true;
            claimTransaction = sig.signature;
            break; // Found it, no need to check more
          } else {
            console.log(`❌ Different signer: ${firstAccount.substring(0, 10)}... (not ${wallet.substring(0, 10)}...)`);
          }
        }
        
        // Small delay to avoid rate limits
        if (i % 10 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (txError) {
        console.log(`Error with fee tx ${sig.signature}: ${txError.message}`);
        continue;
      }
    }
    
    console.log(`✅ Search complete. Found claim: ${foundClaim}, Checked: ${checkedCount} transactions`);
    
    return res.status(200).json({
      wallet: wallet,
      feeProgram: FEE_PROGRAM,
      hasInteracted: foundClaim,
      status: foundClaim ? 'Fee Claims Found!' : 'No Fee Claims Found',
      checkedTransactions: checkedCount,
      foundInTx: claimTransaction,
      method: 'fee_program_search',
      searchedFeeTransactions: signatures.length,
      debugInfo: `Searched ${checkedCount} fee program transactions for wallet ${wallet}`
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    
    return res.status(200).json({
      wallet: wallet,
      hasInteracted: false,
      error: `Search failed: ${error.message}`,
      status: 'Error occurred',
      checkedTransactions: 0,
      method: 'fee_program_search'
    });
  }
}
