// /api/analytics.js - Vercel serverless function for analytics
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { twitterUsername, endpoint } = req.query;

  if (!twitterUsername) {
    return res.status(400).json({ 
      success: false, 
      error: 'twitterUsername parameter is required' 
    });
  }

  const API_KEY = process.env.BAGS_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'BAGS_API_KEY not configured in environment variables'
    });
  }

  try {
    let apiUrl;
    
    // Route to different Bags API endpoints
    switch (endpoint) {
      case 'wallet':
        apiUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/fee-share/wallet/twitter?twitterUsername=${encodeURIComponent(twitterUsername)}`;
        break;
      case 'creator':
        // For getting creator info - requires tokenMint parameter
        const { tokenMint } = req.query;
        if (!tokenMint) {
          return res.status(400).json({ success: false, error: 'tokenMint required for creator endpoint' });
        }
        apiUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/creator/v2?tokenMint=${encodeURIComponent(tokenMint)}`;
        break;
      case 'lifetime-fees':
        // For getting lifetime fees - requires tokenMint parameter
        const { tokenMint: feeTokenMint } = req.query;
        if (!feeTokenMint) {
          return res.status(400).json({ success: false, error: 'tokenMint required for lifetime-fees endpoint' });
        }
        apiUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/lifetime-fees?tokenMint=${encodeURIComponent(feeTokenMint)}`;
        break;
      default:
        apiUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/fee-share/wallet/twitter?twitterUsername=${encodeURIComponent(twitterUsername)}`;
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY
      }
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json(data);
    } else {
      return res.status(response.status).json({
        success: false,
        error: data.error || `HTTP ${response.status}`
      });
    }
  } catch (error) {
    console.error('Bags API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch data from Bags API'
    });
  }
}
