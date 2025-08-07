// /api/activity.js - Check wallet activity using Solscan API for fee claims
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

  try {
    console.log(`Checking fee claim activity for wallet: ${wallet}`);
    
    // Get account balance from Solscan
    const balanceUrl = `https://public-api.solscan.io/account/${wallet}`;
    const balanceResponse = await fetch(balanceUrl);
    const balanceData = await balanceResponse.json();
    
    // Get detailed transactions from Solscan (more than before for better analysis)
    const txUrl = `https://public-api.solscan.io/account/transactions?account=${wallet}&limit=100`;
    const txResponse = await fetch(txUrl);
    const txData = await txResponse.json();
    
    console.log('Analyzing transactions for fee claims...');
    
    // Get their bags.fm token info if username provided
    let bagsTokenData = null;
    if (username) {
      bagsTokenData = await getBagsTokenInfo(username);
    }
    
    // Analyze for actual fee claims
    const activity = await analyzeForFeeClaims(balanceData, txData, wallet, bagsTokenData);
    
    return res.status(200).json(activity);
    
  } catch (error) {
    console.error('Activity check error:', error);
    
    return res.status(200).json({
      balance: '0.00',
      recentTxCount: 0,
      actualFeeClaims: 0,
      totalClaimedUSD: 0,
      lastClaim: null,
      claimDetails: [],
      error: 'Could not fetch transaction data',
      dataSource: 'error'
    });
  }
}

async function getBagsTokenInfo(username) {
  try {
    const API_KEY = process.env.BAGS_API_KEY;
    
    // Try to get their created tokens to cross-reference fees
    const creatorUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/creator/v2?tokenMint=${username}`;
    
    const response = await fetch(creatorUrl, {
      headers: { 'x-api-key': API_KEY }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.response || [];
    }
  } catch (error) {
    console.log('Could not fetch bags token info:', error);
  }
  
  return null;
}

async function analyzeForFeeClaims(balanceData, txData, wallet, bagsTokenData) {
  const balance = balanceData?.lamports ? (balanceData.lamports / 1e9).toFixed(2) : '0.00';
  
  if (!txData || !Array.isArray(txData)) {
    return {
      balance,
      recentTxCount: 0,
      actualFeeClaims: 0,
      totalClaimedUSD: 0,
      lastClaim: null,
      claimDetails: []
    };
  }
  
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recentTxs = txData.filter(tx => tx.blockTime * 1000 > thirtyDaysAgo);
  
  const feeClaims = [];
  
  // Look for transactions that match fee claim patterns
  for (const tx of recentTxs) {
    const claimData = await analyzeTransactionForFeeClaim(tx, wallet);
    if (claimData) {
      feeClaims.push(claimData);
    }
  }
  
  // Calculate totals
  const totalClaimedSOL = feeClaims.reduce((sum, claim) => sum + claim.solAmount, 0);
  const totalClaimedUSD = feeClaims.reduce((sum, claim) => sum + (claim.usdValue || 0), 0);
  
  return {
    balance,
    recentTxCount: recentTxs.length,
    actualFeeClaims: feeClaims.length,
    totalClaimedSOL: totalClaimedSOL.toFixed(6),
    totalClaimedUSD: totalClaimedUSD.toFixed(2),
    lastClaim: feeClaims.length > 0 ? feeClaims[0].timestamp : null,
    claimDetails: feeClaims.slice(0, 5), // Most recent 5 claims
    avgClaimSize: feeClaims.length > 0 ? (totalClaimedSOL / feeClaims.length).toFixed(4) : 0,
    dataSource: 'solscan'
  };
}

async function analyzeTransactionForFeeClaim(tx, wallet) {
  try {
    // Get detailed transaction info from Solscan
    const txDetailUrl = `https://public-api.solscan.io/transaction/${tx.txHash}`;
    const txDetailResponse = await fetch(txDetailUrl);
    const txDetail = await txDetailResponse.json();
    
    // Look for fee claim indicators
    const isFeeClaim = detectFeeClaim(txDetail, wallet);
    
    if (isFeeClaim) {
      return {
        txHash: tx.txHash,
        timestamp: new Date(tx.blockTime * 1000).toISOString(),
        solAmount: isFeeClaim.solAmount,
        usdValue: isFeeClaim.usdValue,
        program: isFeeClaim.program,
        type: 'fee_claim'
      };
    }
    
    return null;
    
  } catch (error) {
    console.log(`Error analyzing tx ${tx.txHash}:`, error);
    return null;
  }
}

function detectFeeClaim(txDetail, wallet) {
  // Look for patterns that indicate fee claims
  
  // 1. Check instruction logs for "Claim fees" text
  if (txDetail.logMessages) {
    const hasClaimFeesLog = txDetail.logMessages.some(log => 
      log.toLowerCase().includes('claim fees') || 
      log.toLowerCase().includes('claim fee') ||
      log.toLowerCase().includes('fees claimed')
    );
    
    if (hasClaimFeesLog) {
      // Extract SOL amount from balance changes
      const solAmount = extractSOLAmount(txDetail, wallet);
      return {
        solAmount: solAmount || 0,
        usdValue: (solAmount || 0) * 167, // Approximate SOL price
        program: 'Meteora Dynamic Bonding Curve Program' // Default
      };
    }
  }
  
  // 2. Check for Meteora/Raydium program interactions with balance increases
  if (txDetail.instructions) {
    for (const instruction of txDetail.instructions) {
      if (instruction.program && (
        instruction.program.includes('Meteora') ||
        instruction.program.includes('Raydium') ||
        instruction.program.includes('Bonding Curve')
      )) {
        // Check if this instruction resulted in SOL increase for our wallet
        const solAmount = extractSOLAmountFromInstruction(instruction, wallet);
        if (solAmount > 0.001) { // Minimum threshold to avoid spam
          return {
            solAmount,
            usdValue: solAmount * 167,
            program: instruction.program
          };
        }
      }
    }
  }
  
  // 3. Check for significant SOL balance increases (>0.01 SOL)
  const solIncrease = extractSOLAmount(txDetail, wallet);
  if (solIncrease > 0.01) {
    // Check if it's from a DEX/protocol (not just a transfer)
    const isFromProtocol = txDetail.instructions?.some(inst => 
      inst.program && !inst.program.includes('System Program')
    );
    
    if (isFromProtocol) {
      return {
        solAmount: solIncrease,
        usdValue: solIncrease * 167,
        program: 'Protocol Fee Claim'
      };
    }
  }
  
  return null;
}

function extractSOLAmount(txDetail, wallet) {
  // Look for balance changes in the transaction
  if (txDetail.tokenBalances) {
    const preBalance = txDetail.tokenBalances.pre?.find(b => b.account === wallet);
    const postBalance = txDetail.tokenBalances.post?.find(b => b.account === wallet);
    
    if (preBalance && postBalance) {
      const diff = (postBalance.amount - preBalance.amount) / 1e9;
      return diff > 0 ? diff : 0;
    }
  }
  
  // Fallback: look for SOL transfers to the wallet
  if (txDetail.solTransfers) {
    const transfer = txDetail.solTransfers.find(t => t.destination === wallet);
    return transfer ? transfer.amount / 1e9 : 0;
  }
  
  return 0;
}

function extractSOLAmountFromInstruction(instruction, wallet) {
  // Extract SOL amount from specific instruction data
  if (instruction.parsed?.info?.lamports) {
    return instruction.parsed.info.lamports / 1e9;
  }
  
  if (instruction.data?.amount) {
    return instruction.data.amount / 1e9;
  }
  
  return 0;
}
