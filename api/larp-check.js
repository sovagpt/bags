// /api/larp-check.js - AI-powered LARP detection for token launches
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

  const { contract } = req.query;

  if (!contract) {
    return res.status(400).json({ 
      success: false, 
      error: 'contract parameter is required' 
    });
  }

  const BAGS_API_KEY = process.env.BAGS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  
  if (!BAGS_API_KEY || !ANTHROPIC_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'API keys not configured'
    });
  }

  try {
    console.log(`🔍 LARP checking contract: ${contract}`);
    
    // Step 1: Get token creator information from Bags API
    const bagsUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/creator/v2?tokenMint=${encodeURIComponent(contract)}`;
    
    const bagsResponse = await fetch(bagsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': BAGS_API_KEY
      }
    });

    if (!bagsResponse.ok) {
      throw new Error(`Bags API failed: ${bagsResponse.status}`);
    }

    const bagsData = await bagsResponse.json();
    
    if (!bagsData.success || !bagsData.response) {
      return res.status(404).json({
        success: false,
        error: 'Token not found in Bags system'
      });
    }

    const creators = bagsData.response;
    console.log(`📊 Found ${creators.length} creators for token`);

    // Step 2: Get additional token info (you might want to add more API calls here)
    // For now, we'll work with what we have from the creators endpoint

    // Step 3: Prepare data for AI analysis
    const tokenData = {
      contractAddress: contract,
      creators: creators,
      totalCreators: creators.length,
      creatorDetails: creators.map(creator => ({
        username: creator.username,
        twitterUsername: creator.twitterUsername,
        royaltyBps: creator.royaltyBps,
        royaltyPercentage: (creator.royaltyBps / 100).toFixed(2),
        isCreator: creator.isCreator,
        wallet: creator.wallet
      }))
    };

    // Step 4: Send to Anthropic for AI analysis
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a cryptocurrency token analyst specialized in detecting potential "LARP" (Live Action Role Play) tokens - fake projects that pretend to be associated with celebrities, influencers, or legitimate projects.

Analyze this token data and provide a risk assessment:

Token Contract: ${contract}
Number of Creators: ${tokenData.totalCreators}

Creator Details:
${tokenData.creatorDetails.map(creator => `
- Username: ${creator.username}
- Twitter: @${creator.twitterUsername || 'N/A'}
- Royalty: ${creator.royaltyPercentage}%
- Is Creator: ${creator.isCreator}
- Wallet: ${creator.wallet}
`).join('\n')}

RED FLAGS TO LOOK FOR:
1. Low royalty percentages (< 5%) suggesting the real person isn't involved
2. Generic usernames that don't match the supposed celebrity/influencer
3. Multiple creators with high royalty splits (suggests money grab)
4. Creators with history of launching many tokens
5. No verified "isCreator" status for main subject
6. Mismatched Twitter usernames vs supposed token subject

Provide:
1. Risk Score (0-100, where 100 is highest risk)
2. Main red flags found
3. Brief analysis explaining the concerns

Format your response as JSON:
{
  "riskScore": number,
  "analysis": "detailed analysis text",
  "redFlags": ["list", "of", "specific", "red", "flags"],
  "recommendation": "AVOID/CAUTION/MODERATE/LOW_RISK"
}`
        }]
      })
    });

    if (!anthropicResponse.ok) {
      throw new Error(`Anthropic API failed: ${anthropicResponse.status}`);
    }

    const anthropicData = await anthropicResponse.json();
    const aiAnalysis = anthropicData.content[0].text;
    
    console.log('🤖 AI Analysis received');

    // Step 5: Parse AI response
    let analysisResult;
    try {
      // Extract JSON from AI response (in case there's extra text)
      const jsonMatch = aiAnalysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in AI response');
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      // Fallback analysis
      analysisResult = {
        riskScore: 50,
        analysis: aiAnalysis,
        redFlags: ['Unable to parse detailed analysis'],
        recommendation: 'CAUTION'
      };
    }

    // Step 6: Add additional red flags based on data analysis
    const additionalFlags = [];
    
    // Check for low royalty percentages
    const lowRoyaltyCreators = creators.filter(c => c.royaltyBps < 500); // < 5%
    if (lowRoyaltyCreators.length > 0) {
      additionalFlags.push(`${lowRoyaltyCreators.length} creator(s) with suspiciously low royalties (< 5%)`);
    }

    // Check for too many creators
    if (creators.length > 3) {
      additionalFlags.push(`High number of creators (${creators.length}) suggests potential money grab`);
    }

    // Check for no verified creators
    const verifiedCreators = creators.filter(c => c.isCreator === true);
    if (verifiedCreators.length === 0) {
      additionalFlags.push('No verified creators found - major red flag');
    }

    // Combine AI flags with additional analysis
    const allRedFlags = [...(analysisResult.redFlags || []), ...additionalFlags];

    return res.status(200).json({
      success: true,
      contractAddress: contract,
      riskScore: analysisResult.riskScore,
      analysis: analysisResult.analysis,
      redFlags: allRedFlags,
      recommendation: analysisResult.recommendation,
      creators: creators,
      metadata: {
        totalCreators: creators.length,
        verifiedCreators: verifiedCreators.length,
        averageRoyalty: (creators.reduce((sum, c) => sum + c.royaltyBps, 0) / creators.length / 100).toFixed(2) + '%'
      }
    });

  } catch (error) {
    console.error('LARP check error:', error);
    
    return res.status(500).json({
      success: false,
      error: `Analysis failed: ${error.message}`,
      contractAddress: contract
    });
  }
}
