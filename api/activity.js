// /api/activity.js - Debug and find correct fee program interactions
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
    console.log(`Debugging fee claims for wallet: ${wallet}`);
    
    // First, let's get ALL recent transactions to see what programs are involved
    const allTxUrl = `https://api.solscan.io/v2/account/transactions?address=${wallet}&limit=50`;
    
    const allTxResponse = await fetch(allTxUrl, {
      headers: {
        'Authorization': `Bearer ${SOLSCAN_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const allTxData = await allTxResponse.json();
    console.log('All transactions response:', allTxData);
    
    // Analyze all transactions to find fee-related ones
    const analysis = await debugTransactions(allTxData, wallet, SOLSCAN_API_KEY);
    
    // Also try the specific fee program (in case it exists)
    const FEE_PROGRAM = 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi';
    const specificFeeUrl = `https://api.solscan.io/v2/account/transactions?address=${wallet}&program=${FEE_PROGRAM}&limit=20`;
    
    const specificResponse = await fetch(specificFeeUrl, {
      headers: {
        'Authorization': `Bearer ${SOLSCAN_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const specificData = await specificResponse.json();
    console.log('Specific fee program response:', specificData);
    
    // Get wallet balance
    const balanceUrl = `https://api.solscan.io/v2/account?address=${wallet}`;
    const balanceResponse = await fetch(balanceUrl, {
      headers: {
        'Authorization': `Bearer ${SOLSCAN_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const balanceData = await balanceResponse.json();
    
    analysis.balance = balanceData?.data?.lamports ? 
      (balanceData.data.lamports / 1e9).toFixed(4) : '0.0000';
    
    analysis.specificProgramCheck = {
      found: specificData?.data?.length > 0,
      count: specificData?.data?.length || 0,
      program: FEE_PROGRAM
    };
    
    return res.status(200).json(analysis);
    
  } catch (error) {
    console.error('Debug error:', error);
    
    return res.status(200).json({
      balance: '0.0000',
      error: `Debug failed: ${error.message}`,
      debugInfo: 'Could not fetch transaction data',
      dataSource: 'error'
    });
  }
}

async function debugTransactions(allTxData, wallet, apiKey) {
  if (!allTxData?.data || !Array.isArray(allTxData.data)) {
    return {
      totalTransactions: 0,
      programsFound: [],
      potentialFeeClaims: [],
      debugInfo: 'No transaction data available'
    };
  }
  
  const programs = new Set();
  const potentialClaims = [];
  const debugInfo = [];
  
  console.log(`Processing ${allTxData.data.length} transactions...`);
  
  // Process recent transactions to find patterns
  for (const tx of allTxData.data.slice(0, 20)) {
    try {
      // Get detailed transaction info
      const txDetailUrl = `https://api.solscan.io/v2/transaction?signature=${tx.signature}`;
      
      const txDetailResponse = await fetch(txDetailUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const txDetail = await txDetailResponse.json();
      
      if (txDetail?.data) {
        // Look for programs
        if (txDetail.data.instructions) {
          txDetail.data.instructions.forEach(instruction => {
            if (instruction.programId) {
              programs.add(instruction.programId);
            }
          });
        }
        
        // Look for balance changes that might be fee claims
        const claimData = analyzeForFeePattern(txDetail.data, wallet, tx.blockTime);
        if (claimData) {
          potentialClaims.push(claimData);
        }
        
        // Debug info for first few transactions
        if (potentialClaims.length < 5) {
          debugInfo.push({
            signature: tx.signature,
            blockTime: tx.blockTime,
            programs: txDetail.data.instructions?.map(i => i.programId) || [],
            hasBalanceChange: txDetail.data.balanceChanges?.some(bc => bc.address === wallet),
            solChangeAmount: txDetail.data.balanceChanges?.find(bc => bc.address === wallet)?.changeAmount || 0
          });
        }
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 150));
      
    } catch (error) {
      console.log(`Error processing tx ${tx.signature}:`, error);
    }
  }
  
  // Look for fee-related program patterns
  const feePrograms = Array.from(programs).filter(program => 
    program.includes('FEE') || 
    program.includes('fee') ||
    program.includes('Fee') ||
    program.includes('Claim') ||
    program.includes('claim')
  );
  
  return {
    totalTransactions: allTxData.data.length,
    totalPrograms: programs.size,
    allPrograms: Array.from(programs),
    feePrograms: feePrograms,
    potentialFeeClaims: potentialClaims,
    totalClaimedSOL: potentialClaims.reduce((sum, claim) => sum + claim.solAmount, 0).toFixed(6),
    debugInfo: debugInfo,
    lastAnalyzed: new Date().toISOString()
  };
}

function analyzeForFeePattern(txDetail, wallet, blockTime) {
  // Look for balance increases that might be fee claims
  if (txDetail.balanceChanges) {
    const walletChange = txDetail.balanceChanges.find(change => 
      change.address === wallet && 
      change.changeType === 'increase' &&
      Math.abs(change.changeAmount) > 1000000 // More than 0.001 SOL
    );
    
    if (walletChange) {
      const solAmount = Math.abs(walletChange.changeAmount) / 1e9;
      
      // Check if it's from a potential fee program
      const involvedPrograms = txDetail.instructions?.map(i => i.programId) || [];
      const isLikelyFeeClaim = involvedPrograms.some(program => 
        program !== '11111111111111111111111111111111' && // Not system program
        program !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' // Not token program
      );
      
      if (isLikelyFeeClaim && solAmount > 0.001) {
        return {
          signature: txDetail.signature,
          timestamp: blockTime * 1000,
          solAmount: solAmount,
          usdValue: solAmount * 167,
          programs: involvedPrograms,
          balanceChange: walletChange.changeAmount,
          type: 'potential_fee_claim'
        };
      }
    }
  }
  
  return null;
}
