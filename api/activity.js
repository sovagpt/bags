// /api/activity.js - Check balance changes for feel program interactions
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

    // Helper function to get token creators from Bags API
    async function getTokenCreators(tokenAddress) {
      try {
        const API_KEY = process.env.BAGS_API_KEY;
        if (!API_KEY) {
          console.log('No Bags API key for creator lookup');
          return null;
        }

        console.log(`👥 Looking up creators for token: ${tokenAddress}`);
        
        const response = await fetch(`https://public-api-v2.bags.fm/api/v1/token-launch/creator/v2?tokenMint=${tokenAddress}`, {
          method: 'GET',
          headers: {
            'x-api-key': API_KEY
          }
        });

        if (!response.ok) {
          console.log(`Creator API failed: ${response.status}`);
          return null;
        }

        const data = await response.json();
        
        if (data.success && data.response) {
          console.log(`🎯 Found ${data.response.length} creators for ${tokenAddress}`);
          return data.response;
        } else {
          console.log(`No creators found for ${tokenAddress}`);
          return null;
        }
      } catch (error) {
        console.log(`Error fetching creators: ${error.message}`);
        return null;
      }
    }

    // Helper function to extract token info from transaction
    async function extractTokenInfo(transaction, meta) {
      try {
        const accountKeys = transaction.message.accountKeys;
        let tokenAddress = null;
        let tokenName = 'UNKNOWN'; // Default until Bags adds token metadata API
        
        const COMMON_PROGRAMS = [
          'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi', // Fee program
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',     // Token program
          'So11111111111111111111111111111111111111112',       // WSOL
          '11111111111111111111111111111111',                  // System program
          'ComputeBudget111111111111111111111111111111',       // Compute budget
        ];
        
        // Look for Bags token addresses (they all end with "BAGS")
        for (const account of accountKeys) {
          // Skip common programs and the user's wallet
          if (!COMMON_PROGRAMS.includes(account) && account !== wallet) {
            // Check if this is a Bags token (44 characters, ends with "BAGS")
            if (account.length === 44 && account.endsWith('BAGS')) {
              tokenAddress = account;
              console.log(`🎯 Found Bags token address: ${tokenAddress}`);
              break;
            }
          }
        }

        // Get creator information
        const creators = tokenAddress ? await getTokenCreators(tokenAddress) : null;
        
        return {
          address: tokenAddress,
          name: tokenName, // Will always be "UNKNOWN" until Bags adds metadata API
          creators: creators
        };
      } catch (error) {
        console.log('Error extracting token info:', error.message);
        return {
          address: null,
          name: 'UNKNOWN',
          creators: null
        };
      }
    }
    
    // Helper function to find user's profile from creators data
    function findUserProfile(claims, userWallet) {
      for (const claim of claims) {
        if (claim.creators) {
          const userCreator = claim.creators.find(creator => creator.wallet === userWallet);
          if (userCreator) {
            return {
              pfp: userCreator.pfp,
              username: userCreator.username,
              twitterUsername: userCreator.twitterUsername
            };
          }
        }
      }
      return null;
    }

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
        method: 'balance_changes_check',
        claimMetrics: null
      });
    }
    
    // Now check each transaction for balance changes and fee program involvement
    const signatures = signaturesData.result.slice(0, 50); // Limit to avoid timeouts
    let foundClaim = false;
    let claimTransactions = []; // Array to store multiple claims
    let checkedCount = 0;
    let suspiciousTransactions = [];
    let allTokenInfo = []; // Array to store all token claims
    let claimTimestamps = []; // Store timestamps for timing analysis
    
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
          
          if (hasPositiveBalanceChange) {
            foundClaim = true;
            
            // Store timestamp for timing analysis
            if (sig.blockTime) {
              claimTimestamps.push(sig.blockTime);
            }
            
            // Extract token information from this transaction (including creators)
            const tokenInfo = await extractTokenInfo(transaction, meta);
            console.log(`🪙 Extracted token info:`, tokenInfo);

            if (tokenInfo.address) {
              claimTransactions.push(sig.signature);
              allTokenInfo.push({
                address: tokenInfo.address,
                name: tokenInfo.name,
                transaction: sig.signature,
                creators: tokenInfo.creators
              });
            }
            
            suspiciousTransactions.push({
              signature: sig.signature,
              hasPositiveBalanceChange,
              involvesFeeProgram: true
            });
          }
          
          // Don't break - continue looking for more claims
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
    
    console.log(`✅ Balance change check complete. Found claims: ${foundClaim}, Total claims: ${allTokenInfo.length}, Checked: ${checkedCount} transactions`);
    console.log(`📋 All claims found:`, allTokenInfo);
    
    // Remove duplicates based on token address
    const uniqueClaims = allTokenInfo.filter((claim, index, self) => 
      index === self.findIndex(c => c.address === claim.address)
    );
    
    console.log(`🎯 Unique claims after deduplication: ${uniqueClaims.length}`, uniqueClaims);
    
    // Calculate timing metrics
    let claimMetrics = null;
    if (claimTimestamps.length > 0) {
      const dates = claimTimestamps.map(timestamp => new Date(timestamp * 1000));
      const firstClaim = new Date(Math.min(...dates));
      const lastClaim = new Date(Math.max(...dates));
      const daysSinceLastClaim = Math.floor((Date.now() - lastClaim.getTime()) / (1000 * 60 * 60 * 24));
      
      claimMetrics = {
        firstClaimDate: firstClaim.toISOString(),
        lastClaimDate: lastClaim.toISOString(),
        daysSinceLastClaim: daysSinceLastClaim
      };
    }
    
    // Get the primary claim (first unique one)
    const primaryClaim = uniqueClaims[0] || null;
    
    return res.status(200).json({
      wallet: wallet,
      feeProgram: FEE_PROGRAM,
      hasInteracted: foundClaim,
      status: foundClaim ? `${uniqueClaims.length} Token${uniqueClaims.length > 1 ? 's' : ''} Claimed!` : 'No Fee Claims Found',
      checkedTransactions: checkedCount,
      foundInTx: claimTransactions[0] || null, // Primary transaction
      method: 'balance_changes_check',
      suspiciousTransactions: suspiciousTransactions.slice(0, 3), // Limit output
      debugInfo: `Checked ${checkedCount} transactions for balance changes with fee program`,
      // Primary claim data
      tokenAddress: primaryClaim?.address || null,
      tokenName: primaryClaim?.name || null,
      // All unique claims data (now with creators)
      allClaims: uniqueClaims,
      totalClaims: uniqueClaims.length,
      // User profile info - get from the first creator that matches the searched user
      userProfile: uniqueClaims.length > 0 ? findUserProfile(uniqueClaims, wallet) : null,
      // Timing metrics
      claimMetrics: claimMetrics
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    
    return res.status(200).json({
      wallet: wallet,
      hasInteracted: false,
      error: `Check failed: ${error.message}`,
      status: 'Error occurred',
      checkedTransactions: 0,
      method: 'balance_changes_check',
      claimMetrics: null
    });
  }
}
