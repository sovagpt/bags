// /api/activity.js - Check wallet fee claims using Solscan API v2
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, username } = req.query;

  if (!wallet) {
    return res.status(400).json({ 
      error: 'wallet parameter is required' 
    });
  }

  const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY;
  
  if (!SOLSCAN_API_KEY) {
    return res.status(500).json({
      error: 'SOLSCAN_API_KEY not configured in environment variables'
    });
  }

  try {
    console.log(`Checking fee claims for wallet: ${wallet}`);
    
    // Target the specific fee program for Bags.fm claims
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    
    // Get wallet's current balance
    const balanceUrl = `https://api.solscan.io/v2/account?address=${wallet}`;
    const balanceResponse = await fetch(balanceUrl, {
      headers: {
        'Authorization': `Bearer ${SOLSCAN_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const balanceData = await balanceResponse.json();
    console.log('Balance response:', balanceData);
    
    // Get all transactions between this wallet and the fee program
    const feeClaimsUrl = `https://api.solscan.io/v2/account/transactions?address=${wallet}&program=${FEE_PROGRAM}&limit=50`;
    
    const feeResponse = await fetch(feeClaimsUrl, {
      headers: {
        'Authorization': `Bearer ${SOLSCAN_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const feeData = await feeResponse.json();
    console.log('Fee claims response:', feeData);
    
    // Analyze the fee claim transactions
    const analysis = await analyzeFeeClaimTransactions(feeData, wallet, SOLSCAN_API_KEY);
    
    // Add balance info
    analysis.balance = balanceData?.data?.lamports ? 
      (balanceData.data.lamports / 1e9).toFixed(4) : '0.0000';
    
    return res.status(200).json(analysis);
    
  } catch (error) {
    console.error('Fee claim check error:', error);
    
    return res.status(200).json({
      balance: '0.0000',
      totalFeeClaims: 0,
      totalClaimedSOL: '0.000000',
      totalClaimedUSD: '0.00',
      lastClaim: null,
      claimDetails: [],
      avgClaimSize: '0.0000',
      claimFrequency: 'No claims',
      error: `Failed to fetch data: ${error.message}`,
      dataSource: 'error'
    });
  }
}

async function analyzeFeeClaimTransactions(feeData, wallet, apiKey) {
  if (!feeData?.data || !Array.isArray(feeData.data)) {
    return {
      totalFeeClaims: 0,
      totalClaimedSOL: '0.000000',
      totalClaimedUSD: '0.00',
      lastClaim: null,
      claimDetails: [],
      avgClaimSize: '0.0000',
      claimFrequency: 'No claims'
    };
  }
  
  const claims = [];
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  // Process each transaction to get detailed claim info
  for (const tx of feeData.data.slice(0, 20)) { // Limit to prevent rate limits
    try {
      // Get transaction details to see actual amounts
      const txDetailUrl = `https://api.solscan.io/v2/transaction?signature=${tx.signature}`;
      
      const txDetailResponse = await fetch(txDetailUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const txDetail = await txDetailResponse.json();
      
      if (txDetail?.data) {
        const claimInfo = extractClaimInfo(txDetail.data, wallet, tx.blockTime);
        if (claimInfo && claimInfo.solAmount > 0) {
          claims.push(claimInfo);
        }
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.log(`Error processing tx ${tx.signature}:`, error);
    }
  }
  
  // Calculate statistics
  const recentClaims = claims.filter(claim => claim.timestamp > thirtyDaysAgo);
  const totalSOL = claims.reduce((sum, claim) => sum + claim.solAmount, 0);
  const totalUSD = totalSOL * 167; // Approximate SOL price
  
  // Calculate claim frequency
  let frequency = 'No claims';
  if (claims.length > 0) {
    const daysSinceFirst = (Date.now() - claims[claims.length - 1].timestamp) / (1000 * 60 * 60 * 24);
    const claimsPerDay = claims.length / daysSinceFirst;
    
    if (claimsPerDay > 0.5) frequency = 'Very Active (>0.5/day)';
    else if (claimsPerDay > 0.1) frequency = 'Active (~weekly)';
    else if (claimsPerDay > 0.03) frequency = 'Occasional (~monthly)';
    else frequency = 'Rare';
  }
  
  return {
    totalFeeClaims: claims.length,
    recentClaims: recentClaims.length,
    totalClaimedSOL: totalSOL.toFixed(6),
    totalClaimedUSD: totalUSD.toFixed(2),
    lastClaim: claims.length > 0 ? new Date(claims[0].timestamp).toISOString() : null,
    claimDetails: claims.slice(0, 10), // Most recent 10
    avgClaimSize: claims.length > 0 ? (totalSOL / claims.length).toFixed(4) : '0.0000',
    claimFrequency: frequency,
    dataSource: 'solscan_v2'
  };
}

function extractClaimInfo(txDetail, wallet, blockTime) {
  try {
    // Look for SOL balance changes for our wallet
    const balanceChanges = txDetail.balanceChanges || [];
    const walletChange = balanceChanges.find(change => 
      change.address === wallet && change.changeType === 'increase'
    );
    
    if (walletChange) {
      const solAmount = Math.abs(walletChange.changeAmount) / 1e9;
      
      return {
        signature: txDetail.signature,
        timestamp: blockTime * 1000,
        solAmount: solAmount,
        usdValue: solAmount * 167,
        type: 'fee_claim',
        program: 'Bags Fee Program'
      };
    }
    
    // Fallback: look in instruction data
    if (txDetail.instructions) {
      for (const instruction of txDetail.instructions) {
        if (instruction.accounts?.includes(wallet)) {
          // Look for SOL transfers to our wallet
          const solAmount = extractSOLFromInstruction(instruction, wallet);
          if (solAmount > 0) {
            return {
              signature: txDetail.signature,
              timestamp: blockTime * 1000,
              solAmount: solAmount,
              usdValue: solAmount * 167,
              type: 'fee_claim',
              program: 'Bags Fee Program'
            };
          }
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.log('Error extracting claim info:', error);
    return null;
  }
}

function extractSOLFromInstruction(instruction, wallet) {
  // Try to extract SOL amount from instruction data
  if (instruction.parsed?.info?.lamports) {
    return instruction.parsed.info.lamports / 1e9;
  }
  
  if (instruction.data?.lamports) {
    return instruction.data.lamports / 1e9;
  }
  
  // Look for transfers in instruction
  if (instruction.parsed?.info?.destination === wallet) {
    return (instruction.parsed.info.lamports || 0) / 1e9;
  }
  
  return 0;
}
