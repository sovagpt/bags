// /api/activity.js - Check balance changes for fee program interactions
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
    console.log(`💰 Checking balance changes for wallet: ${wallet}`);
    
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    
    // Use Helius RPC - much higher rate limits
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    const rpcUrl = HELIUS_API_KEY 
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com';
    
    console.log(`Using RPC: ${rpcUrl.includes('helius') ? 'Helius' : 'Free Solana RPC'}`);
    
    // Get wallet's transaction signatures
    console.log('Getting wallet transaction signatures...');
    
    const signaturesResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet, { limit: 100 }] // Check recent 100 user transactions
      })
    });
    
    if (!signaturesResponse.ok) {
      throw new Error(`RPC failed: ${signaturesResponse.status}`);
    }
    
    const signaturesData = await signaturesResponse.json();
    console.log(`📊 Got ${signaturesData?.result?.length || 0} wallet transactions`);
    
    if (!signaturesData?.result?.length) {
      return res.status(200).json({
        wallet: wallet,
        hasInteracted: false,
        status: 'No transactions found for wallet',
        checkedTransactions: 0,
        method: 'balance_changes_check'
      });
    }
    
    // Now check each transaction for balance changes and fee program involvement
    const signatures = signaturesData.result.slice(0, 50); // Limit to avoid timeouts
    let foundClaim = false;
    let claimTransaction = null;
    let checkedCount = 0;
    let suspiciousTransactions = [];
    
    console.log(`🔍 Checking ${signatures.length} transactions for fee program interactions...`);
    
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      checkedCount++;
      
      try {
        console.log(`Checking tx ${i + 1}/${signatures.length}: ${sig.signature}`);
        
        // Get transaction with detailed info including pre/post balances
        const txResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [sig.signature, { 
              encoding: 'json',
              maxSupportedTransactionVersion: 0 // Support newer transaction versions
            }]
          })
        });
        
        if (!txResponse.ok) {
          console.log(`TX fetch failed: ${txResponse.status}`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Longer delay on error
          continue;
        }
        
        const txData = await txResponse.json();
        
        if (txData?.error) {
          console.log(`TX error for ${sig.signature}:`, txData.error);
          continue;
        }
        
        const transaction = txData?.result?.transaction;
        const meta = txData?.result?.meta;
        
        if (!transaction || !meta) {
          console.log(`No transaction data for ${sig.signature}`);
          continue;
        }
        
        // Check if wallet is signer & fee payer
        const accountKeys = transaction.message.accountKeys;
        const firstAccount = accountKeys[0]; // Signer & fee payer
        
        if (firstAccount !== wallet) {
          console.log(`❌ Wallet ${wallet.substring(0, 10)}... is not signer in ${sig.signature}`);
          continue;
        }
        
        console.log(`✅ Wallet IS signer & fee payer in ${sig.signature}`);
        
        // Check if transaction involves fee program
        let involvesFeeProgram = false;
        
        // Check account keys for fee program
        if (accountKeys.includes(FEE_PROGRAM)) {
          involvesFeeProgram = true;
          console.log(`🎯 Fee program found in account keys!`);
        }
        
        // Check instructions for fee program
        if (!involvesFeeProgram && transaction.message.instructions) {
          for (const instruction of transaction.message.instructions) {
            if (instruction.programIdIndex < accountKeys.length) {
              const programId = accountKeys[instruction.programIdIndex];
              if (programId === FEE_PROGRAM) {
                involvesFeeProgram = true;
                console.log(`🎯 Fee program found in instructions!`);
                break;
              }
            }
          }
        }
        
        if (involvesFeeProgram) {
          console.log(`🎉 FOUND FEE CLAIM! Wallet ${wallet} signed tx ${sig.signature} involving fee program`);
          
          // Check balance changes to confirm it's a claim (not just interaction)
          const preBalances = meta.preBalances || [];
          const postBalances = meta.postBalances || [];
          
          let hasPositiveBalanceChange = false;
          for (let j = 0; j < Math.min(preBalances.length, postBalances.length); j++) {
            const diff = postBalances[j] - preBalances[j];
            if (diff > 0) {
              hasPositiveBalanceChange = true;
              console.log(`💰 Positive balance change detected: +${diff} lamports for account ${j}`);
            }
          }
          
          foundClaim = true;
          claimTransaction = sig.signature;
          
          suspiciousTransactions.push({
            signature: sig.signature,
            hasPositiveBalanceChange,
            involvesFeeProgram: true
          });
          
          break; // Found what we need
        }
        
        // Small delay to avoid rate limits
        if (i % 5 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        
      } catch (txError) {
        console.log(`Error with tx ${sig.signature}: ${txError.message}`);
        continue;
      }
    }
    
    console.log(`✅ Balance change check complete. Found claim: ${foundClaim}, Checked: ${checkedCount} transactions`);
    
    return res.status(200).json({
      wallet: wallet,
      feeProgram: FEE_PROGRAM,
      hasInteracted: foundClaim,
      status: foundClaim ? 'Fee Claims Found!' : 'No Fee Claims Found',
      checkedTransactions: checkedCount,
      foundInTx: claimTransaction,
      method: 'balance_changes_check',
      suspiciousTransactions: suspiciousTransactions.slice(0, 3), // Limit output
      debugInfo: `Checked ${checkedCount} transactions for balance changes with fee program`
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    
    return res.status(200).json({
      wallet: wallet,
      hasInteracted: false,
      error: `Check failed: ${error.message}`,
      status: 'Error occurred',
      checkedTransactions: 0,
      method: 'balance_changes_check'
    });
  }
}
