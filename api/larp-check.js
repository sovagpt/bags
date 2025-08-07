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
        model: 'claude-3-5-sonnet-20241022',
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
- Is Verified Creator: ${creator.isCreator}
- Wallet: ${creator.wallet}
`).join('\n')}

CRITICAL RED FLAGS TO LOOK FOR:
1. HIGH ROYALTIES TO NON-CREATORS: If someone with "isCreator: false" is getting high royalties (>10%), this is a major LARP indicator
2. LOW ROYALTIES TO VERIFIED CREATORS: If verified creators (isCreator: true) get <5%, the real person likely isn't involved
3. SERIAL TOKEN LAUNCHERS: Creators with history of launching many tokens (>5) are often just spamming coins
4. MISMATCHED IDENTITIES: Generic usernames that don't match the supposed celebrity/influencer the token represents
5. NO VERIFIED CREATORS: If no one has "isCreator: true", it's likely a complete LARP
6. ROYALTY DISTRIBUTION: Most royalties should go to verified creators, not random people

EXAMPLES OF LARP PATTERNS:
- A "ElonMusk" token where @elonmusk has isCreator: false and gets 1%, while @randomguy has isCreator: false but gets 80%
- Multiple creators with generic names getting high royalties while the supposed subject gets nothing
- Creators who have launched 10+ tokens in a short period (serial scammers)

Provide:
1. Risk Score (0-100, where 100 is highest risk)
2. Main red flags found focusing on royalty distribution and creator verification
3. Brief analysis explaining why this might be a LARP

Format your response as JSON:
{
  "riskScore": number,
  "analysis": "detailed analysis text focusing on LARP indicators",
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

    // Step 6: Get historical token data for each creator to check for spam behavior
    const creatorsWithHistory = [];
    
    for (const creator of creators) {
      try {
        // Get all tokens this creator has been involved with
        const creatorHistoryUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/creator/history?wallet=${encodeURIComponent(creator.wallet)}`;
        
        const historyResponse = await fetch(creatorHistoryUrl, {
          method: 'GET',
          headers: {
            'x-api-key': BAGS_API_KEY
          }
        });

        let tokenCount = 0;
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          tokenCount = historyData.success ? (historyData.response?.length || 0) : 0;
        }

        creatorsWithHistory.push({
          ...creator,
          historicalTokenCount: tokenCount
        });
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (historyError) {
        console.log(`Could not fetch history for ${creator.wallet}:`, historyError.message);
        creatorsWithHistory.push({
          ...creator,
          historicalTokenCount: 0
        });
      }
    }

    // Step 7: Add additional red flags based on data analysis
    const additionalFlags = [];
    
    // Check for high royalties going to non-creators (MAJOR RED FLAG)
    const nonCreatorsWithHighRoyalties = creatorsWithHistory.filter(c => !c.isCreator && c.royaltyBps > 1000); // > 10%
    if (nonCreatorsWithHighRoyalties.length > 0) {
      additionalFlags.push(`🚨 MAJOR RED FLAG: ${nonCreatorsWithHighRoyalties.length} non-creator(s) receiving high royalties (${nonCreatorsWithHighRoyalties.map(c => `${(c.royaltyBps/100).toFixed(1)}%`).join(', ')})`);
    }

    // Check for low royalty percentages going to actual creators
    const realCreatorsWithLowRoyalties = creatorsWithHistory.filter(c => c.isCreator && c.royaltyBps < 500); // < 5%
    if (realCreatorsWithLowRoyalties.length > 0) {
      additionalFlags.push(`Verified creator(s) receiving suspiciously low royalties (< 5%) - possible LARP`);
    }

    // Check for serial token launchers (potential spammers)
    const serialLaunchers = creatorsWithHistory.filter(c => c.historicalTokenCount > 5);
    if (serialLaunchers.length > 0) {
      const spammerDetails = serialLaunchers.map(c => `@${c.twitterUsername || c.username} (${c.historicalTokenCount} tokens)`).join(', ');
      additionalFlags.push(`🚨 Serial token launcher(s) detected: ${spammerDetails}`);
    }

    // Check for too many creators overall
    if (creators.length > 3) {
      additionalFlags.push(`High number of creators (${creators.length}) suggests potential money grab`);
    }

    // Check for no verified creators at all
    const verifiedCreators = creatorsWithHistory.filter(c => c.isCreator === true);
    if (verifiedCreators.length === 0) {
      additionalFlags.push('🚨 CRITICAL: No verified creators found - likely LARP token');
    }

    // Check if most royalties are going to unverified creators
    const totalRoyalties = creatorsWithHistory.reduce((sum, c) => sum + c.royaltyBps, 0);
    const unverifiedRoyalties = creatorsWithHistory.filter(c => !c.isCreator).reduce((sum, c) => sum + c.royaltyBps, 0);
    const unverifiedPercentage = totalRoyalties > 0 ? (unverifiedRoyalties / totalRoyalties) * 100 : 0;
    
    if (unverifiedPercentage > 70) {
      additionalFlags.push(`🚨 ${unverifiedPercentage.toFixed(1)}% of royalties going to unverified creators - major LARP indicator`);
    }

    // Combine AI flags with additional analysis
    const allRedFlags = [...(analysisResult.redFlags || []), ...additionalFlags];

    // Calculate enhanced risk score based on red flags
    let enhancedRiskScore = analysisResult.riskScore || 50;
    
    // Boost risk score for critical red flags
    if (nonCreatorsWithHighRoyalties.length > 0) enhancedRiskScore += 30;
    if (serialLaunchers.length > 0) enhancedRiskScore += 20;
    if (verifiedCreators.length === 0) enhancedRiskScore += 25;
    if (unverifiedPercentage > 70) enhancedRiskScore += 20;
    
    // Cap at 100
    enhancedRiskScore = Math.min(100, enhancedRiskScore);

    return res.status(200).json({
      success: true,
      contractAddress: contract,
      riskScore: enhancedRiskScore,
      analysis: analysisResult.analysis,
      redFlags: allRedFlags,
      recommendation: analysisResult.recommendation,
      creators: creatorsWithHistory, // Now includes historical token counts
      metadata: {
        totalCreators: creators.length,
        verifiedCreators: verifiedCreators.length,
        averageRoyalty: (creators.reduce((sum, c) => sum + c.royaltyBps, 0) / creators.length / 100).toFixed(2) + '%',
        unverifiedRoyaltyPercentage: unverifiedPercentage.toFixed(1) + '%',
        serialLaunchersDetected: serialLaunchers.length,
        highestTokenCount: Math.max(...creatorsWithHistory.map(c => c.historicalTokenCount), 0)
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
