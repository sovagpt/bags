// /api/activity.js - Check wallet activity using Solscan API
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

  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ 
      error: 'wallet parameter is required' 
    });
  }

  try {
    console.log(`Checking activity for wallet: ${wallet}`);
    
    // Get account balance from Solscan
    const balanceUrl = `https://public-api.solscan.io/account/${wallet}`;
    
    const balanceResponse = await fetch(balanceUrl);
    const balanceData = await balanceResponse.json();
    
    console.log('Balance data:', balanceData);
    
    // Get recent transactions from Solscan
    const txUrl = `https://public-api.solscan.io/account/transactions?account=${wallet}&limit=50`;
    
    const txResponse = await fetch(txUrl);
    const txData = await txResponse.json();
    
    console.log('Transaction data:', txData);
    
    // Analyze transaction data for fee claiming patterns
    const activity = analyzeTransactions(balanceData, txData);
    
    return res.status(200).json(activity);
    
  } catch (error) {
    console.error('Activity check error:', error);
    
    // Return mock data if API fails
    return res.status(200).json({
      balance: (Math.random() * 10).toFixed(2),
      recentTxCount: Math.floor(Math.random() * 30),
      largeClaims: Math.floor(Math.random() * 5),
      lastActivity: new Date().toISOString(),
      dataSource: 'mock' // Indicate this is mock data
    });
  }
}

function analyzeTransactions(balanceData, txData) {
  const balance = balanceData?.lamports ? (balanceData.lamports / 1e9).toFixed(2) : '0.00';
  
  if (!txData || !Array.isArray(txData)) {
    return {
      balance,
      recentTxCount: 0,
      largeClaims: 0,
      lastActivity: null,
      dataSource: 'api'
    };
  }
  
  // Count transactions in last 30 days
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recentTxs = txData.filter(tx => tx.blockTime * 1000 > thirtyDaysAgo);
  
  // Look for large SOL movements that might indicate fee claims
  let largeClaims = 0;
  
  recentTxs.forEach(tx => {
    if (tx.parsedInstruction) {
      tx.parsedInstruction.forEach(instruction => {
        if (instruction.type === 'transfer' && instruction.info?.lamports) {
          const solAmount = instruction.info.lamports / 1e9;
          if (solAmount >= 1.0) { // Claims larger than 1 SOL
            largeClaims++;
          }
        }
      });
    }
  });
  
  return {
    balance,
    recentTxCount: recentTxs.length,
    largeClaims,
    lastActivity: recentTxs.length > 0 ? new Date(recentTxs[0].blockTime * 1000).toISOString() : null,
    dataSource: 'api'
  };
}
