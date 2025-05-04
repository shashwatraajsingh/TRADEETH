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
  CONFIRM_AUTO_TRADE: 'CONFIRM_AUTO_TRADE'
};

// Bot configuration with multiple Sepolia RPC endpoints for fallback
const config = {
  TELEGRAM_TOKEN: '7625273574:AAGPByqO1_K2okV1yvCm9wdXo1rgJ7tLLX0',
  DATA_FILE: path.join(__dirname, 'user_data.json'),
  NETWORK: 'sepolia',
  RPC_ENDPOINTS: [
    'https://rpc.sepolia.org',
    'https://eth-sepolia.public.blastapi.io',
    'https://sepolia.gateway.tenderly.co',
    'https://ethereum-sepolia.blockpi.network/v1/rpc/public'
  ],
  FAUCET_URL: 'https://sepoliafaucet.com/'
};

// Function to initialize Web3 with fallback
async function initWeb3() {
  for (const endpoint of config.RPC_ENDPOINTS) {
    try {
      const web3 = new Web3(new Web3.providers.HttpProvider(endpoint));
      
      // Test the connection by getting the latest block number
      const blockNumber = await web3.eth.getBlockNumber();
      console.log(`Connected to Sepolia via ${endpoint}. Latest block: ${blockNumber}`);
      
      // If successful, return this web3 instance
      return web3;
    } catch (error) {
      console.error(`Failed to connect to ${endpoint}: ${error.message}`);
      // Continue to the next endpoint
    }
  }
  
  // If all endpoints fail, throw an error
  throw new Error('Failed to connect to any Sepolia RPC endpoint');
}

// Initialize bot
const bot = new Telegraf(config.TELEGRAM_TOKEN);

// Data storage functions
function loadUserData() {
  try {
    const data = fs.readFileSync(config.DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or has invalid JSON, return empty object
    return {};
  }
}

function saveUserData(data) {
  fs.writeFileSync(config.DATA_FILE, JSON.stringify(data, null, 2));
}

// Global web3 instance
let web3;

// Wallet and trading functions
async function createUserWallet(userId) {
  const account = web3.eth.accounts.create();
  const address = account.address;
  const privateKey = account.privateKey;
  
  // In a real application, store the private key securely
  // For demo purposes, we'll store it with user data
  const userData = loadUserData();
  userData[userId] = {
    walletAddress: address,
    privateKey: privateKey, // In production, use proper key management
    balance: "0",
    autoTrades: []
  };
  saveUserData(userData);
  
  return address;
}

async function getEthPrice() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return parseFloat(response.data.ethereum.usd);
  } catch (error) {
    console.error(`Error getting ETH price: ${error.message}`);
    return 2000; // Fallback price if API fails
  }
}

async function checkBalance(address) {
  try {
    const balanceWei = await web3.eth.getBalance(address);
    const balanceEth = web3.utils.fromWei(balanceWei, 'ether');
    return parseFloat(balanceEth);
  } catch (error) {
    console.error(`Error checking balance: ${error.message}`);
    return 0;
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
      `Get free Sepolia ETH from faucets like:\n${config.FAUCET_URL}\n\n` +
      `After getting test ETH, deposit to this address to start trading.`
    );
  } else {
    address = userData[userId].walletAddress;
    await ctx.reply(
      `Welcome back to ETH Trading Bot (Sepolia Testnet)! 🚀\n\n` +
      `Your wallet address:\n${address}\n\n` +
      `Need more test ETH? Visit: ${config.FAUCET_URL}`
    );
  }
  
  await showMainMenu(ctx);
  ctx.session = { state: STATES.MAIN_MENU };
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

// Handle menu callbacks
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
    case 'deposit':
      const address = userData[userId].walletAddress;
      await ctx.editMessageText(
        `Deposit Sepolia ETH to your unique wallet address:\n\n${address}\n\n` +
        `Get free Sepolia ETH from:\n${config.FAUCET_URL}\n\n` +
        `After sending funds, it may take a few minutes for your balance to update.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.DEPOSIT;
      break;
      
    case 'trade':
      const ethPrice = await getEthPrice();
      const balance = await checkBalance(userData[userId].walletAddress);
      
      await ctx.editMessageText(
        `Current ETH Price: $${ethPrice.toFixed(2)}\n` +
        `Your Balance: ${balance.toFixed(6)} Sepolia ETH ($${(balance * ethPrice).toFixed(2)})\n\n` +
        `What would you like to do?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Buy ETH', 'buy_eth')],
          [Markup.button.callback('Sell ETH', 'sell_eth')],
          [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.MAIN_MENU;
      break;
      
    case 'auto_trade':
      const price = await getEthPrice();
      
      await ctx.editMessageText(
        `Current ETH Price: $${price.toFixed(2)}\n\n` +
        `Auto-Trade allows you to set buy and sell orders that execute automatically ` +
        `when your target prices are reached.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Set Up Auto-Trade', 'setup_auto_trade')],
          [Markup.button.callback('View Active Auto-Trades', 'view_auto_trades')],
          [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.AUTO_TRADE_SETUP;
      break;
      
    case 'portfolio':
      const currentPrice = await getEthPrice();
      const userBalance = await checkBalance(userData[userId].walletAddress);
      
      // Get auto-trade information
      const autoTrades = userData[userId].autoTrades || [];
      let autoTradeInfo = "\n\n🤖 Auto-Trades:\n";
      
      if (autoTrades.length > 0) {
        autoTrades.forEach((trade, i) => {
          autoTradeInfo += `#${i+1}: Buy at $${trade.buyPrice}, Sell at $${trade.sellPrice}\n`;
        });
      } else {
        autoTradeInfo += "No active auto-trades.\n";
      }
      
      await ctx.editMessageText(
        `💼 Your Portfolio (Sepolia Testnet):\n\n` +
        `ETH Balance: ${userBalance.toFixed(6)} ETH\n` +
        `Value: $${(userBalance * currentPrice).toFixed(2)}\n` +
        `Current ETH Price: $${currentPrice.toFixed(2)}\n` +
        `${autoTradeInfo}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
        ])
      );
      ctx.session.state = STATES.MAIN_MENU;
      break;
      
    case 'back_to_menu':
      await showMainMenu(ctx);
      ctx.session.state = STATES.MAIN_MENU;
      break;
      
    // Additional code for other actions...
    default:
      await ctx.editMessageText(
        "This feature is still being implemented for the Sepolia testnet.",
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
        ])
      );
  }
});

// Handle text messages based on state
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const text = ctx.message.text;
  
  // For now, just acknowledge the message
  await ctx.reply(
    "Got your message! The bot is currently in test mode on Sepolia.",
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
    ])
  );
});

// Add a command to check RPC connection
bot.command('checkrpc', async (ctx) => {
  try {
    const blockNumber = await web3.eth.getBlockNumber();
    await ctx.reply(
      `✅ Connected to Sepolia testnet!\n` +
      `Current block: ${blockNumber}\n`
    );
  } catch (error) {
    await ctx.reply(
      `❌ Connection error: ${error.message}\n` +
      `The bot will attempt to reconnect to an alternative RPC endpoint.`
    );
    
    // Try to reconnect
    try {
      web3 = await initWeb3();
      const newBlockNumber = await web3.eth.getBlockNumber();
      await ctx.reply(
        `✅ Reconnected successfully!\n` +
        `Current block: ${newBlockNumber}`
      );
    } catch (reconnectError) {
      await ctx.reply(
        `❌ Failed to reconnect: ${reconnectError.message}`
      );
    }
  }
});

// Add a command to get Sepolia testnet ETH information
bot.command('faucet', async (ctx) => {
  await ctx.reply(
    `🚰 Sepolia Testnet ETH Faucets 🚰\n\n` +
    `Get free Sepolia ETH from these faucets:\n\n` +
    `1. Alchemy Sepolia Faucet:\n` +
    `https://sepoliafaucet.com/\n\n` +
    `2. Infura Sepolia Faucet:\n` +
    `https://www.infura.io/faucet/sepolia\n\n` +
    `3. QuickNode Sepolia Faucet:\n` +
    `https://faucet.quicknode.com/ethereum/sepolia\n\n` +
    `You'll need some Sepolia ETH to use the trading features.`
  );
});

// Cancel command
bot.command('cancel', async (ctx) => {
  await ctx.reply("Operation canceled. Type /start to begin again.");
  ctx.session = { state: STATES.MAIN_MENU };
});

// Price monitoring function
function startPriceMonitor() {
  const checkPrices = async () => {
    try {
      const ethPrice = await getEthPrice();
      if (ethPrice === null) {
        return;
      }
      
      const userData = loadUserData();
      let updated = false;
      
      for (const userId in userData) {
        const user = userData[userId];
        if (!user.autoTrades || user.autoTrades.length === 0) {
          continue;
        }
        
        for (let i = user.autoTrades.length - 1; i >= 0; i--) {
          const trade = user.autoTrades[i];
          const buyPrice = parseFloat(trade.buyPrice);
          const sellPrice = parseFloat(trade.sellPrice);
          
          // Check if buy conditions are met
          if (ethPrice <= buyPrice) {
            console.log(`Auto-buy triggered for user ${userId}: ETH price $${ethPrice.toFixed(2)} <= $${buyPrice.toFixed(2)}`);
            
            try {
              await bot.telegram.sendMessage(
                userId,
                `🤖 Auto-Buy Triggered! (Sepolia Testnet)\n\n` +
                `ETH Price: $${ethPrice.toFixed(2)}\n` +
                `Your Buy Price: $${buyPrice.toFixed(2)}\n\n` +
                `In a real implementation, this would execute a buy transaction on Sepolia testnet.`
              );
            } catch (error) {
              console.error(`Failed to notify user ${userId}: ${error.message}`);
            }
          }
          
          // Check if sell conditions are met
          else if (ethPrice >= sellPrice) {
            console.log(`Auto-sell triggered for user ${userId}: ETH price $${ethPrice.toFixed(2)} >= $${sellPrice.toFixed(2)}`);
            
            try {
              await bot.telegram.sendMessage(
                userId,
                `🤖 Auto-Sell Triggered! (Sepolia Testnet)\n\n` +
                `ETH Price: $${ethPrice.toFixed(2)}\n` +
                `Your Sell Price: $${sellPrice.toFixed(2)}\n\n` +
                `In a real implementation, this would execute a sell transaction on Sepolia testnet.`
              );
              
              // Remove the completed auto-trade
              user.autoTrades.splice(i, 1);
              updated = true;
            } catch (error) {
              console.error(`Failed to notify user ${userId}: ${error.message}`);
            }
          }
        }
      }
      
      if (updated) {
        saveUserData(userData);
      }
    } catch (error) {
      console.error(`Error in price monitor: ${error.message}`);
    }
    
    // Schedule the next check
    setTimeout(checkPrices, 60000); // Check every 60 seconds
  };
  
  // Start the first check
  checkPrices();
}

// Start the bot
async function startBot() {
  try {
    // Initialize Web3 with fallback RPC endpoints
    web3 = await initWeb3();
    
    // Start the bot
    await bot.launch();
    console.log('ETH Trading Bot is running on Sepolia Testnet!');
    
    // Start price monitoring
    if (!global.priceMonitorRunning) {
      global.priceMonitorRunning = true;
      startPriceMonitor();
    }
  } catch (error) {
    console.error(`Failed to start bot: ${error.message}`);
  }
}

// Start the bot
startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));