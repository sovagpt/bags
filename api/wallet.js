// /api/wallet.js - Get wallet address for Twitter username
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

  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ 
      success: false, 
      error: 'username parameter is required' 
    });
  }

  const API_KEY = process.env.BAGS_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'BAGS_API_KEY not configured'
    });
  }

  try {
    const bagsUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/fee-share/wallet/twitter?twitterUsername=${encodeURIComponent(username)}`;
    
    console.log(`Fetching wallet for ${username}`);
    
    const response = await fetch(bagsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY
      }
    });

    const data = await response.json();
    
    console.log(`Bags API response:`, data);

    if (response.ok && data.success) {
      return res.status(200).json({
        success: true,
        wallet: data.response,
        username: username
      });
    } else {
      return res.status(404).json({
        success: false,
        error: data.error || 'User not found in Bags system'
      });
    }
  } catch (error) {
    console.error('Wallet fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet address'
    });
  }
}
