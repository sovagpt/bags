// /api/wallet.js - Vercel serverless function
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

  const { twitterUserId } = req.query;

  if (!twitterUserId) {
    return res.status(400).json({ 
      success: false, 
      error: 'twitterUserId parameter is required' 
    });
  }

  try {
    // Make the request to bags.fm API from the server
    const bagsUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/fee-share/wallet?twitterUserId=${encodeURIComponent(twitterUserId)}`;
    
    const response = await fetch(bagsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.BAGS_API_KEY || 'bags_prod_DSfYkGka2rlPuntXpTKcON0hOLQj5eBIxuNH9HTHPbM'
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
      error: 'Failed to fetch wallet address'
    });
  }
}