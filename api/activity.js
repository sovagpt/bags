<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bags.fm Activity Tracker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        .header h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
            font-weight: 700;
        }

        .header p {
            color: #666;
            font-size: 16px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
            font-size: 14px;
        }

        input {
            width: 100%;
            padding: 15px;
            border: 2px solid #e1e5e9;
            border-radius: 12px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: #f8f9fa;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
            background: white;
            box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        }

        button {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-bottom: 20px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .result {
            padding: 20px;
            border-radius: 12px;
            margin-top: 20px;
            font-size: 14px;
            display: none;
        }

        .result.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }

        .result.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }

        .result.warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
        }

        .loading {
            display: none;
            text-align: center;
            margin: 20px 0;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .wallet-display {
            word-break: break-all;
            background: #f8f9fa;
            padding: 10px;
            border-radius: 6px;
            margin: 10px 0;
            border-left: 4px solid #667eea;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 12px;
        }

        .activity-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }

        .activity-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }

        .activity-card h4 {
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
            display: flex;
            align-items: center;
        }

        .activity-card p {
            color: #666;
            font-size: 13px;
            margin: 0;
        }

        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            display: inline-block;
        }

        .active { background: #28a745; }
        .inactive { background: #6c757d; }
        .moderate { background: #ffc107; }

        .solscan-link {
            background: #007bff;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 12px;
            display: inline-block;
            margin-top: 10px;
        }

        .solscan-link:hover {
            background: #0056b3;
        }

        .api-status {
            background: #e9ecef;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 13px;
            color: #495057;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎒 Bags.fm Activity Tracker</h1>
            <p>Check if users are actively claiming their bag fees</p>
        </div>

        <div class="api-status">
            <strong>🔐 Secure API:</strong> Using server-side authentication
        </div>

        <form id="trackerForm">
            <div class="form-group">
                <label for="twitterUsername">Twitter Username</label>
                <input type="text" id="twitterUsername" placeholder="e.g., WinRAR_RARLAB (without @)" required value="WinRAR_RARLAB">
                <small style="color: #666; font-size: 12px; margin-top: 5px; display: block;">
                    Enter Twitter username to check their bag fee claiming activity
                </small>
            </div>

            <button type="submit">🔍 Check Activity</button>
        </form>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Checking wallet and activity...</p>
        </div>

        <div class="result" id="result"></div>
    </div>

    <script>
        document.getElementById('trackerForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const twitterUsername = document.getElementById('twitterUsername').value.trim();
            const loadingEl = document.getElementById('loading');
            const resultEl = document.getElementById('result');
            const submitBtn = document.querySelector('button[type="submit"]');
            
            if (!twitterUsername) {
                showResult('Please enter a Twitter username', 'error');
                return;
            }

            const cleanUsername = twitterUsername.replace('@', '');

            loadingEl.style.display = 'block';
            resultEl.style.display = 'none';
            submitBtn.disabled = true;

            try {
                console.log(`Checking activity for: ${cleanUsername}`);
                
                // Step 1: Get wallet address via our serverless function
                const walletResponse = await fetch(`/api/wallet?username=${encodeURIComponent(cleanUsername)}`);
                const walletData = await walletResponse.json();

                if (!walletResponse.ok || !walletData.success) {
                    showResult(`❌ @${cleanUsername} not found in Bags system: ${walletData.error || 'User has no Bags account'}`, 'error');
                    return;
                }

                const walletAddress = walletData.wallet;
                console.log(`Found wallet: ${walletAddress}`);

                // Step 2: Check wallet activity via Solscan API
                const activityResponse = await fetch(`/api/activity?wallet=${encodeURIComponent(walletAddress)}&username=${encodeURIComponent(cleanUsername)}`);
                const activityData = await activityResponse.json();

                console.log('Activity data:', activityData);

                displayActivityResults(cleanUsername, walletAddress, activityData);

            } catch (error) {
                console.error('Tracking error:', error);
                showResult(`❌ Error checking activity: ${error.message}`, 'error');
            } finally {
                loadingEl.style.display = 'none';
                submitBtn.disabled = false;
            }
        });

        function displayActivityResults(username, walletAddress, activity) {
            const activityLevel = determineActivityLevel(activity);
            const statusDot = activityLevel === 'high' ? 'active' : activityLevel === 'medium' ? 'moderate' : 'inactive';
            const statusText = activityLevel === 'high' ? 'Highly Active' : activityLevel === 'medium' ? 'Moderately Active' : 'Low Activity';
            
            const resultType = activityLevel === 'high' ? 'success' : activityLevel === 'medium' ? 'warning' : 'error';

            // Build claim details if available
            let claimDetailsHtml = '';
            if (activity.claimDetails && activity.claimDetails.length > 0) {
                claimDetailsHtml = '<br><strong>Recent Fee Claims:</strong><br>';
                activity.claimDetails.forEach(claim => {
                    const date = new Date(claim.timestamp).toLocaleDateString();
                    claimDetailsHtml += `• ${date}: ${claim.solAmount} SOL (${claim.usdValue?.toFixed(2) || '0'}) via ${claim.program}<br>`;
                });
            }

            showResult(`
                <strong>✅ Fee Claim Analysis Complete!</strong><br><br>
                
                <strong>User:</strong> @${username}<br>
                <strong>Wallet:</strong>
                <div class="wallet-display">${walletAddress}</div>
                
                <div class="activity-grid">
                    <div class="activity-card">
                        <h4><span class="status-dot ${statusDot}"></span>Claim Activity</h4>
                        <p>${statusText}</p>
                    </div>
                    <div class="activity-card">
                        <h4>💰 Current Balance</h4>
                        <p>${activity.balance} SOL</p>
                    </div>
                    <div class="activity-card">
                        <h4>🎯 Actual Fee Claims</h4>
                        <p>${activity.actualFeeClaims || 0} verified claims</p>
                    </div>
                    <div class="activity-card">
                        <h4>💸 Total Claimed</h4>
                        <p>${activity.totalClaimedSOL || '0.00'} SOL</p>
                    </div>
                    <div class="activity-card">
                        <h4>💵 USD Value</h4>
                        <p>${activity.totalClaimedUSD || '0.00'}</p>
                    </div>
                    <div class="activity-card">
                        <h4>📊 Avg Claim Size</h4>
                        <p>${activity.avgClaimSize || '0.00'} SOL</p>
                    </div>
                </div>
                
                <strong>Fee Claiming Status:</strong> ${activity.actualFeeClaims > 0 ? '🟢 Actively claiming fees from their tokens' : '🔴 No verified fee claims detected'}<br>
                ${activity.lastClaim ? `<strong>Last Claim:</strong> ${new Date(activity.lastClaim).toLocaleDateString()}<br>` : ''}
                
                ${claimDetailsHtml}
                
                <a href="https://solscan.io/account/${walletAddress}" target="_blank" class="solscan-link">
                    🔍 View on Solscan
                </a>
                
                <br><br>
                <small><strong>Analysis:</strong> This checks for actual "Claim fees" transactions from Meteora/Raydium programs, not random transfers. Only verified fee claims are counted.</small>
            `, resultType);
        }

        function determineActivityLevel(activity) {
            if (activity.actualFeeClaims >= 3 && parseFloat(activity.totalClaimedSOL) >= 2.0) {
                return 'high';
            } else if (activity.actualFeeClaims >= 1 && parseFloat(activity.totalClaimedSOL) >= 0.5) {
                return 'medium';
            } else {
                return 'low';
            }
        }

        function showResult(message, type) {
            const resultEl = document.getElementById('result');
            resultEl.innerHTML = message;
            resultEl.className = `result ${type}`;
            resultEl.style.display = 'block';
        }

        // Auto-save username
        const usernameInput = document.getElementById('twitterUsername');

        if (localStorage.getItem('bags_username')) {
            usernameInput.value = localStorage.getItem('bags_username');
        }

        usernameInput.addEventListener('input', () => {
            localStorage.setItem('bags_username', usernameInput.value);
        });
    </script>
</body>
</html>
