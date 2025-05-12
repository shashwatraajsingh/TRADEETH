const { Telegraf, session, Markup } = require('telegraf');
const Web3 = require('web3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Constants for conversation states
const STATES = {
  MAIN_MENU: 'MAIN_MENU',
  DEPOSIT: 'DEPOSIT',
  AUTO_TRADE_SETUP: 'AUTO_TRADE_SETUP',
  SET_BUY_PRICE: 'SET_BUY_PRICE',
  SET_SELL_PRICE: 'SET_SELL_PRICE',
  SET_AMOUNT: 'SET_AMOUNT',
  CONFIRM_AUTO_TRADE: 'CONFIRM_AUTO_TRADE',
  ENTER_BUY_AMOUNT: 'ENTER_BUY_AMOUNT',
  ENTER_SEND_AMOUNT: 'ENTER_SEND_AMOUNT',
  ENTER_SEND_ADDRESS: 'ENTER_SEND_ADDRESS'
};

// Bot configuration with multiple Sepolia RPC endpoints for fallback
const config = {
  TELEGRAM_TOKEN: '7625273574:AAGPByqO1_K2okV1yvCm9wdXo1rgJ7tLLX0',
  DATA_FILE: path.join(__dirname, 'user_data.json'),
  NETWORK: 'sepolia',
  RPC_ENDPOINTS: [
    'https://eth-sepolia.public.blastapi.io',
    'https://sepolia.gateway.tenderly.co',
    'https://ethereum-sepolia.blockpi.network/v1/rpc/public',
    'https://rpc.sepolia.org'
  ],
  FAUCET_URL: 'https://sepoliafaucet.com/',
  ETHERSCAN_URL: 'https://sepolia.etherscan.io',
  COINGECKO_API_URL: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
  PRICE_CHECK_INTERVAL: 60000  
};

// Function to initialize Web3 with fallback
async function initWeb3() {
  for (const endpoint of config.RPC_ENDPOINTS) {
    try {
      const web3 = new Web3(new Web3.providers.HttpProvider(endpoint));
      const blockNumber = await web3.eth.getBlockNumber();
      console.log(`Connected to Sepolia via ${endpoint}. Latest block: ${blockNumber}`);
      return web3;
    } catch (error) {
      console.error(`Failed to connect to ${endpoint}: ${error.message}`);
    }
  }
  throw new Error('Failed to connect to any Sepolia RPC endpoint');
}


const bot = new Telegraf(config.TELEGRAM_TOKEN);

// Data storage functions
function loadUserData() {
  try {
    if (!fs.existsSync(config.DATA_FILE)) {
      fs.writeFileSync(config.DATA_FILE, JSON.stringify({}));
      return {};
    }
    const data = fs.readFileSync(config.DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading user data: ${error.message}`);
    return {};
  }
}

function saveUserData(data) {
  try {
    fs.writeFileSync(config.DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error saving user data: ${error.message}`);
    return false;
  }
}

// Global web3 instance
let web3;

// Create rate limiter for CoinGecko API
const RATE_LIMIT = {
  lastCall: 0,
  minInterval: 10000,
};

// Price caching to avoid rate limits
const priceCache = {
  ethUsd: null,
  timestamp: 0,
  validFor: 60000
};

// Wallet and trading functions
async function createUserWallet(userId) {
  const account = web3.eth.accounts.create();
  const address = account.address;
  const privateKey = account.privateKey;
  
  const userData = loadUserData();
  userData[userId] = {
    walletAddress: address,
    privateKey: privateKey,
    balance: "0",
    transactions: [],
    autoTrades: []
  };
  saveUserData(userData);
  return address;
}

async function getEthPrice() {
  const now = Date.now();
  
  if (priceCache.ethUsd !== null && now - priceCache.timestamp < priceCache.validFor) {
    console.log(`Using cached ETH price: $${priceCache.ethUsd}`);
    return priceCache.ethUsd;
  }
  
  if (now - RATE_LIMIT.lastCall < RATE_LIMIT.minInterval) {
    const delay = RATE_LIMIT.minInterval - (now - RATE_LIMIT.lastCall);
    console.log(`Rate limiting: waiting ${delay}ms before calling CoinGecko API`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  try {
    RATE_LIMIT.lastCall = Date.now();
    const response = await axios.get(config.COINGECKO_API_URL);
    const price = parseFloat(response.data.ethereum.usd);
    priceCache.ethUsd = price;
    priceCache.timestamp = Date.now();
    console.log(`Fetched new ETH price: $${price}`);
    return price;
  } catch (error) {
    console.error(`Error getting ETH price: ${error.message}`);
    if (priceCache.ethUsd !== null) return priceCache.ethUsd;
    return 2000;
  }
}

async function checkBalance(address) {
  try {
    const balanceWei = await web3.eth.getBalance(address);
    return parseFloat(web3.utils.fromWei(balanceWei, 'ether'));
  } catch (error) {
    console.error(`Error checking balance: ${error.message}`);
    return 0;
  }
}

async function simulateBuyTransaction(userId, amount) {
  const userData = loadUserData();
  const user = userData[userId];
  const ethPrice = await getEthPrice();
  const usdValue = amount * ethPrice;
  const currentBalance = await checkBalance(user.walletAddress);

  console.log(`[SIMULATION] User ${userId} bought ${amount} ETH at ${ethPrice}`);
  
  const txn = {
    type: 'buy',
    amount: amount,
    price: ethPrice,
    usdValue: usdValue,
    timestamp: Date.now(),
    txHash: `sim_buy_${Date.now().toString(16)}`
  };
  
  // Initialize transactions array if it doesn't exist
  if (!user.transactions) {
    user.transactions = [];
  }
  
  user.transactions.push(txn);
  user.balance = (currentBalance + amount).toString();
  saveUserData(userData);
  
  return {
    success: true,
    newBalance: currentBalance + amount,
    ethPrice: ethPrice,
    amount: amount,
    usdValue: usdValue,
    txHash: txn.txHash
  };
}

async function sendEthTransaction(userId, toAddress, amount) {
  try {
    const userData = loadUserData();
    const user = userData[userId];
    const currentBalance = await checkBalance(user.walletAddress);
    
    // Check if user has enough balance
    if (currentBalance < amount) {
      return { 
        success: false, 
        error: 'Insufficient balance', 
        currentBalance 
      };
    }
    
    // Here we would normally send the transaction using web3.js
    // But since we're simulating for testnet, we'll create a mock transaction
    console.log(`[SIMULATION] User ${userId} sent ${amount} ETH to ${toAddress}`);
    
    const ethPrice = await getEthPrice();
    const usdValue = amount * ethPrice;
    
    const txn = {
      type: 'send',
      amount: amount,
      to: toAddress,
      price: ethPrice,
      usdValue: usdValue,
      timestamp: Date.now(),
      txHash: `sim_send_${Date.now().toString(16)}`
    };
    
    // Initialize transactions array if it doesn't exist
    if (!user.transactions) {
      user.transactions = [];
    }
    
    user.transactions.push(txn);
    user.balance = (currentBalance - amount).toString();
    saveUserData(userData);
    
    return {
      success: true,
      newBalance: currentBalance - amount,
      ethPrice: ethPrice,
      amount: amount,
      usdValue: usdValue,
      txHash: txn.txHash,
      to: toAddress
    };
  } catch (error) {
    console.error(`Error sending ETH: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// For a real implementation, we would use this function to send ETH
async function sendEthReal(userId, toAddress, amount) {
  const userData = loadUserData();
  const user = userData[userId];
  const privateKey = user.privateKey;
  const fromAddress = user.walletAddress;
  const currentBalance = await checkBalance(fromAddress);
  
  if (currentBalance < amount) {
    return { success: false, error: 'Insufficient balance', currentBalance };
  }
  
  try {
    // Create and sign transaction
    const gasPrice = await web3.eth.getGasPrice();
    const gasLimit = 21000; // Standard gas limit for ETH transfer
    const nonce = await web3.eth.getTransactionCount(fromAddress);
    const amountWei = web3.utils.toWei(amount.toString(), 'ether');
    
    // Calculate max gas cost
    const maxGasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    
    // Check if balance is enough for amount + gas
    const totalRequired = web3.utils.toBN(amountWei).add(maxGasCost);
    const balanceWei = web3.utils.toWei(currentBalance.toString(), 'ether');
    
    if (web3.utils.toBN(balanceWei).lt(totalRequired)) {
      return { 
        success: false, 
        error: 'Insufficient balance including gas fees', 
        currentBalance 
      };
    }
    
    const txObject = {
      nonce: web3.utils.toHex(nonce),
      to: toAddress,
      value: web3.utils.toHex(amountWei),
      gasLimit: web3.utils.toHex(gasLimit),
      gasPrice: web3.utils.toHex(gasPrice)
    };
    
    // Sign transaction
    const signedTx = await web3.eth.accounts.signTransaction(txObject, privateKey);
    
    // Send transaction
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    // Update user data
    const ethPrice = await getEthPrice();
    const usdValue = amount * ethPrice;
    
    const txn = {
      type: 'send',
      amount: amount,
      to: toAddress,
      price: ethPrice,
      usdValue: usdValue,
      timestamp: Date.now(),
      txHash: receipt.transactionHash
    };
    
    if (!user.transactions) {
      user.transactions = [];
    }
    
    user.transactions.push(txn);
    const newBalance = await checkBalance(fromAddress);
    user.balance = newBalance.toString();
    saveUserData(userData);
    
    return {
      success: true,
      newBalance,
      ethPrice,
      amount,
      usdValue,
      txHash: receipt.transactionHash,
      to: toAddress
    };
  } catch (error) {
    console.error(`Error sending ETH: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Setup session middleware
bot.use(session());

// Initialize session state
bot.use((ctx, next) => {
  ctx.session = ctx.session || { state: STATES.MAIN_MENU };
  return next();
});

// Bot command handlers
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  let address;
  if (!userData[userId]) {
    address = await createUserWallet(userId);
    await ctx.reply(
      `Welcome to ETH Trading Bot (Sepolia Testnet)! 🚀\n\n` +
      `Your unique wallet address for deposits:\n${address}\n\n` +
      `Get free Sepolia ETH from faucets like:\n${config.FAUCET_URL}`
    );
  } else {
    address = userData[userId].walletAddress;
    await ctx.reply(`Welcome back! Your wallet address:\n${address}`);
  }
  
  await showMainMenu(ctx);
  ctx.session.state = STATES.MAIN_MENU;
});

async function showMainMenu(ctx) {
  await ctx.reply(
    'Choose an option:',
    Markup.inlineKeyboard([
      [Markup.button.callback('💰 Deposit', 'deposit')],
      [Markup.button.callback('📊 Trade', 'trade')],
      [Markup.button.callback('🤖 Auto-Trade', 'auto_trade')],
      [Markup.button.callback('💼 Portfolio', 'portfolio')]
    ])
  );
}

// Handle menu callbacks with proper block scoping
bot.action(/.*/, async (ctx) => {
  const action = ctx.match[0];
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  if (!userData[userId] && action !== 'back_to_menu') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Please start the bot with /start first.');
    return;
  }
  
  await ctx.answerCbQuery();
  
  switch (action) {
    case 'deposit': {
      const address = userData[userId].walletAddress;
      await ctx.editMessageText(
        `Deposit Sepolia ETH to:\n\n${address}\n\n` +
        `Faucet: ${config.FAUCET_URL}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh Balance', 'refresh_balance')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.DEPOSIT;
      break;
    }
    
    case 'refresh_balance': {
      const refreshAddress = userData[userId].walletAddress;
      const balance = await checkBalance(refreshAddress);
      userData[userId].balance = balance.toString();
      saveUserData(userData);
      
      await ctx.editMessageText(
        `Address: ${refreshAddress}\n` +
        `Balance: ${balance.toFixed(6)} ETH\n` +
        `Faucet: ${config.FAUCET_URL}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'refresh_balance')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      );
      break;
    }
    
    case 'trade': {
      const ethPrice = await getEthPrice();
      const balance = await checkBalance(userData[userId].walletAddress);
      userData[userId].balance = balance.toString();
      saveUserData(userData);
      
      await ctx.editMessageText(
        `Price: $${ethPrice.toFixed(2)}\n` +
        `Balance: ${balance.toFixed(6)} ETH ($${(balance * ethPrice).toFixed(2)})`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Buy', 'buy_eth')],
          [Markup.button.callback('Send ETH', 'send_eth')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.MAIN_MENU;
      break;
    }
    
    case 'buy_eth': {
      const ethPriceBuy = await getEthPrice();
      const balanceBuy = await checkBalance(userData[userId].walletAddress);
      
      await ctx.editMessageText(
        `Current Price: $${ethPriceBuy.toFixed(2)}\n` +
        `Your Balance: ${balanceBuy.toFixed(6)} ETH\n` +
        `Enter buy amount in ETH:`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'trade')]])
      );
      ctx.session.state = STATES.ENTER_BUY_AMOUNT;
      break;
    }
    
    case 'send_eth': {
      const ethPriceSend = await getEthPrice();
      const balanceSend = await checkBalance(userData[userId].walletAddress);
      
      await ctx.editMessageText(
        `Current Price: $${ethPriceSend.toFixed(2)}\n` +
        `Your Balance: ${balanceSend.toFixed(6)} ETH\n` +
        `Enter wallet address to send ETH to:`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'trade')]])
      );
      ctx.session.state = STATES.ENTER_SEND_ADDRESS;
      break;
    }
    
    case 'auto_trade': {
      const price = await getEthPrice();
      await ctx.editMessageText(
       
`Current Price: $${price.toFixed(2)}\n` +
        `Configure auto-trade triggers:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Setup', 'setup_auto_trade')],
          [Markup.button.callback('View', 'view_auto_trades')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ]));  
      ctx.session.state = STATES.AUTO_TRADE_SETUP;
      break;
    }
    
    case 'setup_auto_trade': {
      const currentPrice = await getEthPrice();
      await ctx.editMessageText(
        `Set buy price (current: $${currentPrice.toFixed(2)}):`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'auto_trade')]])
      );
      ctx.session.state = STATES.SET_BUY_PRICE;
      break;
    }
    
    case 'view_auto_trades': {
      const trades = userData[userId].autoTrades || [];
      let msg = trades.length > 0 
        ? trades.map((t, i) => `#${i+1}: Buy@$${t.buyPrice} Sell@$${t.sellPrice} Amount:${t.amount} ETH`).join('\n')
        : 'No active auto-trades';
      await ctx.editMessageText(
        msg, 
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'auto_trade')]
        ])
      );
      break;
    }
    
    case 'portfolio': {
      const price = await getEthPrice();
      const balance = await checkBalance(userData[userId].walletAddress);
      userData[userId].balance = balance.toString();
      saveUserData(userData);
      
      const txns = (userData[userId].transactions || []).slice(-3).reverse();
      let txHistory = txns.length > 0 ? txns.map(t => {
        if (t.type === 'buy') {
          return `🟢 Buy ${t.amount.toFixed(4)} ETH @ $${t.price.toFixed(2)}`;
        } else if (t.type === 'send') {
          return `🔹 Send ${t.amount.toFixed(4)} ETH to ${t.to.substring(0, 8)}...`;
        } else {
          return `${t.type === 'buy' ? '🟢' : '🔴'} ${t.amount.toFixed(4)} ETH @ $${t.price.toFixed(2)}`;
        }
      }).join('\n') : 'None';
      
      await ctx.editMessageText(
        `Portfolio:\n` +
        `Balance: ${balance.toFixed(6)} ETH ($${(balance * price).toFixed(2)})\n` +
        `Recent TXs:\n${txHistory}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'portfolio')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      );
      break;
    }
    
    case 'back_to_menu': {
      await showMainMenu(ctx);
      ctx.session.state = STATES.MAIN_MENU;
      break;
    }
    
    default: {
      await ctx.editMessageText(
        "Feature in development",
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_menu')]])
      );
    }
  }
});

// Handle text messages based on conversation state
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const text = ctx.message.text;
  const userData = loadUserData();
  
  if (!userData[userId]) {
    await ctx.reply('Please start the bot with /start first.');
    return;
  }
  
  switch (ctx.session.state) {
    case STATES.ENTER_BUY_AMOUNT: {
      const amount = parseFloat(text);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Please enter a valid amount (e.g. 0.01)');
        return;
      }
      
      try {
        const result = await simulateBuyTransaction(userId, amount);
        
        if (result.success) {
          await ctx.reply(
            `✅ Buy successful!\n` +
            `Amount: ${amount.toFixed(6)} ETH\n` +
            `Price: $${result.ethPrice.toFixed(2)}\n` +
            `Value: $${result.usdValue.toFixed(2)}\n` +
            `New Balance: ${result.newBalance.toFixed(6)} ETH\n` +
            `TX: ${result.txHash}`
          );
          
          await showMainMenu(ctx);
          ctx.session.state = STATES.MAIN_MENU;
        }
      } catch (error) {
        console.error(`Buy error: ${error.message}`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      break;
    }
    
    case STATES.ENTER_SEND_ADDRESS: {
      const toAddress = text.trim();
      
      // Basic address validation
      if (!toAddress.startsWith('0x') || toAddress.length !== 42) {
        await ctx.reply('Please enter a valid Ethereum address (42 chars starting with 0x)');
        return;
      }
      
      // Store the address temporarily in session
      ctx.session.sendToAddress = toAddress;
      
      const ethPrice = await getEthPrice();
      const balance = await checkBalance(userData[userId].walletAddress);
      
      await ctx.reply(
        `You're sending to: ${toAddress}\n` +
        `Your Balance: ${balance.toFixed(6)} ETH\n` +
        `Enter amount of ETH to send:`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'trade')]])
      );
      ctx.session.state = STATES.ENTER_SEND_AMOUNT;
      break;
    }
    
    case STATES.ENTER_SEND_AMOUNT: {
      const amount = parseFloat(text);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Please enter a valid amount (e.g. 0.01)');
        return;
      }
      
      const toAddress = ctx.session.sendToAddress;
      if (!toAddress) {
        await ctx.reply('Recipient address not found. Please start again.');
        await showMainMenu(ctx);
        ctx.session.state = STATES.MAIN_MENU;
        return;
      }
      
      try {
        const result = await sendEthTransaction(userId, toAddress, amount);
        
        if (result.success) {
          await ctx.reply(
            `✅ ETH sent successfully!\n` +
            `Amount: ${amount.toFixed(6)} ETH\n` +
            `To: ${toAddress}\n` +
            `Value: $${result.usdValue.toFixed(2)}\n` +
            `New Balance: ${result.newBalance.toFixed(6)} ETH\n` +
            `TX: ${result.txHash}`
          );
          
          // Clear temporary session data
          ctx.session.sendToAddress = null;
          await showMainMenu(ctx);
          ctx.session.state = STATES.MAIN_MENU;
        } else {
          await ctx.reply(`❌ Error: ${result.error}. Current balance: ${result.currentBalance?.toFixed(6) || '0'} ETH`);
        }
      } catch (error) {
        console.error(`Send error: ${error.message}`);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      break;
    }
    
    case STATES.SET_BUY_PRICE: {
      const price = parseFloat(text);
      
      if (isNaN(price) || price <= 0) {
        await ctx.reply('Please enter a valid price (e.g. 2500)');
        return;
      }
      
      ctx.session.autoTrade = ctx.session.autoTrade || {};
      ctx.session.autoTrade.buyPrice = price;
      
      const currentPrice = await getEthPrice();
      await ctx.reply(
        `Buy price set: $${price}\n` +
        `Set sell price (current: $${currentPrice.toFixed(2)}):`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'auto_trade')]])
      );
      ctx.session.state = STATES.SET_SELL_PRICE;
      break;
    }
    
    case STATES.SET_SELL_PRICE: {
      const price = parseFloat(text);
      
      if (isNaN(price) || price <= 0) {
        await ctx.reply('Please enter a valid price (e.g. 2700)');
        return;
      }
      
      ctx.session.autoTrade.sellPrice = price;
      
      await ctx.reply(
        `Sell price set: $${price}\n` +
        `Enter amount in ETH to auto-trade:`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'auto_trade')]])
      );
      ctx.session.state = STATES.SET_AMOUNT;
      break;
    }
    
    case STATES.SET_AMOUNT: {
      const amount = parseFloat(text);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Please enter a valid amount (e.g. 0.01)');
        return;
      }
      
      ctx.session.autoTrade.amount = amount;
      
      await ctx.reply(
        `Auto-trade configuration:\n` +
        `Buy at: $${ctx.session.autoTrade.buyPrice}\n` +
        `Sell at: $${ctx.session.autoTrade.sellPrice}\n` +
        `Amount: ${amount} ETH\n\n` +
        `Confirm setup?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirm', 'confirm_auto_trade')],
          [Markup.button.callback('❌ Cancel', 'auto_trade')]
        ])
      );
      ctx.session.state = STATES.CONFIRM_AUTO_TRADE;
      break;
    }
    
    default: {
      await showMainMenu(ctx);
      ctx.session.state = STATES.MAIN_MENU;
    }
  }
});

// Handle the auto-trade confirmation action
bot.action('confirm_auto_trade', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  await ctx.answerCbQuery();
  
  if (!ctx.session.autoTrade || !ctx.session.autoTrade.buyPrice || !ctx.session.autoTrade.sellPrice || !ctx.session.autoTrade.amount) {
    await ctx.editMessageText(
      'Auto-trade setup incomplete. Please start again.',
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'auto_trade')]])
    );
    return;
  }
  
  const autoTrade = {
    buyPrice: ctx.session.autoTrade.buyPrice,
    sellPrice: ctx.session.autoTrade.sellPrice,
    amount: ctx.session.autoTrade.amount,
    created: Date.now(),
    active: true
  };
  
  userData[userId].autoTrades = userData[userId].autoTrades || [];
  userData[userId].autoTrades.push(autoTrade);
  saveUserData(userData);
  
  await ctx.editMessageText(
    `✅ Auto-trade created!\n` +
    `Buy at: $${autoTrade.buyPrice}\n` +
    `Sell at: $${autoTrade.sellPrice}\n` +
    `Amount: ${autoTrade.amount} ETH`,
    Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'auto_trade')]])
  );
  
  ctx.session.autoTrade = null;
  ctx.session.state = STATES.AUTO_TRADE_SETUP;
});

// Check price triggers for auto-trades
async function checkPriceTriggers() {
  try {
    const currentPrice = await getEthPrice();
    console.log(`Checking price triggers. Current price: $${currentPrice}`);
    
    const userData = loadUserData();
    let dataChanged = false;
    
    for (const userId in userData) {
      const user = userData[userId];
      if (!user.autoTrades || user.autoTrades.length === 0) continue;
      
      for (let i = 0; i < user.autoTrades.length; i++) {
        const trade = user.autoTrades[i];
        if (!trade.active) continue;
        
        // Check buy trigger
        if (currentPrice <= trade.buyPrice && !trade.bought) {
          console.log(`Auto-trade buy triggered for user ${userId} at $${currentPrice}`);
          
          // Execute buy
          try {
            const result = await simulateBuyTransaction(userId, trade.amount);
            if (result.success) {
              trade.bought = true;
              trade.buyExecuted = Date.now();
              trade.buyTxHash = result.txHash;
              trade.buyActualPrice = currentPrice;
              
              dataChanged = true;
              
              // Notify user
              bot.telegram.sendMessage(userId, 
                `🤖 Auto-trade BUY executed!\n` +
                `Amount: ${trade.amount} ETH\n` +
                `Price: $${currentPrice.toFixed(2)}\n` +
                `Value: $${(trade.amount * currentPrice).toFixed(2)}\n` +
                `TX: ${result.txHash}`
              );
            }
          } catch (error) {
            console.error(`Auto-trade buy error: ${error.message}`);
          }
        }
        
        // Check sell trigger (only if previously bought)
        if (trade.bought && currentPrice >= trade.sellPrice) {
          console.log(`Auto-trade sell triggered for user ${userId} at $${currentPrice}`);
          
          // For simulation, we'll create a "sell" transaction
          // This would be a real transaction in production
          const txn = {
            type: 'sell',
            amount: trade.amount,
            price: currentPrice,
            usdValue: trade.amount * currentPrice,
            timestamp: Date.now(),
            txHash: `sim_sell_${Date.now().toString(16)}`
          };
          
          // Initialize transactions array if it doesn't exist
          if (!user.transactions) {
            user.transactions = [];
          }
          
          user.transactions.push(txn);
          
          // Calculate and log profit
          const profit = trade.amount * (currentPrice - trade.buyActualPrice);
          const profitPercent = ((currentPrice / trade.buyActualPrice) - 1) * 100;
          
          trade.sold = true;
          trade.sellExecuted = Date.now();
          trade.sellTxHash = txn.txHash;
          trade.sellActualPrice = currentPrice;
          trade.profit = profit;
          trade.profitPercent = profitPercent;
          trade.active = false;  // Deactivate after execution
          
          dataChanged = true;
          
          // Notify user
          bot.telegram.sendMessage(userId, 
            `🤖 Auto-trade SELL executed!\n` +
            `Amount: ${trade.amount} ETH\n` +
            `Buy Price: $${trade.buyActualPrice.toFixed(2)}\n` +
            `Sell Price: $${currentPrice.toFixed(2)}\n` +
            `Profit: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)\n` +
            `TX: ${txn.txHash}`
          );
        }
      }
    }
    
    if (dataChanged) {
      saveUserData(userData);
    }
  } catch (error) {
    console.error(`Error checking price triggers: ${error.message}`);
  }
}

// Command to view your wallet address
bot.command('wallet', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  if (!userData[userId]) {
    await ctx.reply('Please start the bot with /start first.');
    return;
  }
  
  const address = userData[userId].walletAddress;
  await ctx.reply(
    `Your wallet address:\n${address}\n\n` +
    `View on Etherscan:\n${config.ETHERSCAN_URL}/address/${address}`
  );
});

// Help command
bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 ETH Trading Bot Help 🤖\n\n' +
    'Commands:\n' +
    '/start - Initialize your wallet\n' +
    '/wallet - View your wallet address\n' +
    '/balance - Check your balance\n' +
    '/price - Get current ETH price\n' +
    '/help - Show this help message\n\n' +
    'Use the menu buttons to navigate trading features.'
  );
});

// Balance command
bot.command('balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  if (!userData[userId]) {
    await ctx.reply('Please start the bot with /start first.');
    return;
  }
  
  const address = userData[userId].walletAddress;
  const balance = await checkBalance(address);
  const ethPrice = await getEthPrice();
  
  await ctx.reply(
    `💰 Balance: ${balance.toFixed(6)} ETH\n` +
    `Value: $${(balance * ethPrice).toFixed(2)}\n` +
    `Current Price: $${ethPrice.toFixed(2)}`
  );
});

// Price command
bot.command('price', async (ctx) => {
  const ethPrice = await getEthPrice();
  await ctx.reply(`Current ETH Price: $${ethPrice.toFixed(2)}`);
});

// Show transaction history
bot.command('history', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userData = loadUserData();
  
  if (!userData[userId]) {
    await ctx.reply('Please start the bot with /start first.');
    return;
  }
  
  const txns = userData[userId].transactions || [];
  if (txns.length === 0) {
    await ctx.reply('No transaction history yet.');
    return;
  }
  
  const txHistory = txns.slice(-10).reverse().map((t, i) => {
    const date = new Date(t.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    if (t.type === 'buy') {
      return `${i+1}. 🟢 ${date} Buy ${t.amount.toFixed(4)} ETH @ $${t.price.toFixed(2)}`;
    } else if (t.type === 'sell') {
      return `${i+1}. 🔴 ${date} Sell ${t.amount.toFixed(4)} ETH @ $${t.price.toFixed(2)}`;
    } else if (t.type === 'send') {
      return `${i+1}. 🔹 ${date} Send ${t.amount.toFixed(4)} ETH to ${t.to.substring(0, 8)}...`;
    }
  }).join('\n');
  
  await ctx.reply(
    `📜 Transaction History:\n\n${txHistory}\n\n` +
    `Total transactions: ${txns.length}`
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error: ${err.message}`);
  ctx.reply('An error occurred. Please try again later.');
});

// Check and handle price-triggered trades periodically
setInterval(checkPriceTriggers, config.PRICE_CHECK_INTERVAL);

// Bot startup
async function startBot() {
  try {
    // Initialize Web3
    web3 = await initWeb3();
    
    // Start the bot
    await bot.launch();
    console.log('Bot is running...');
    
    // Initial price check
    const initialPrice = await getEthPrice();
    console.log(`Initial ETH price: $${initialPrice}`);
    
  } catch (error) {
    console.error(`Failed to start bot: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start the bot
startBot();
      