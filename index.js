const { Telegraf, Scenes, session, Markup } = require('telegraf');
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

// Bot configuration - UPDATED FOR SEPOLIA TESTNET
const config = {
  TELEGRAM_TOKEN: '7625273574:AAGPByqO1_K2okV1yvCm9wdXo1rgJ7tLLX0',
  INFURA_API_KEY: 'YifKxCSmmFcdQihif6TKGlTWKLBPXmA1uF5OYSB3LIQP1qWWZo+E6A',
  MASTER_PRIVATE_KEY: 'efc58fc03e7e924ee73fc4ea7bf5aa8d37ccb32c785148bb8871ff29099f528a',
  DATA_FILE: path.join(__dirname, 'user_data.json'),
  NETWORK: 'sepolia',
  ETHERSCAN_API_URL: 'https://api-sepolia.etherscan.io/api',
  FAUCET_URL: 'https://sepoliafaucet.com/'
};

// Set up Web3 connection for Sepolia testnet
const web3 = new Web3(new Web3.providers.HttpProvider(`https://sepolia.infura.io/v3/${config.INFURA_API_KEY}`));

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
    return null;
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

// Setup session middleware
bot.use(session());

// Initialize session state
bot.use((ctx, next) => {
  ctx.session = ctx.session || { state: STATES.MAIN_MENU };
  return next();
});

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
      
    case 'setup_auto_trade':
      const currentEthPrice = await getEthPrice();
      
      ctx.session.autoTrade = {};
      
      await ctx.editMessageText(
        `Current ETH Price: $${currentEthPrice.toFixed(2)}\n\n` +
        `Enter the ETH price at which you want to BUY (in USD):`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'back_to_auto_trade')]
        ])
      );
      ctx.session.state = STATES.SET_BUY_PRICE;
      break;
      
    case 'view_auto_trades':
      const autoTradesList = userData[userId].autoTrades || [];
      
      if (autoTradesList.length === 0) {
        await ctx.editMessageText(
          "You don't have any active auto-trades.",
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'back_to_auto_trade')]
          ])
        );
        ctx.session.state = STATES.AUTO_TRADE_SETUP;
        break;
      }
      
      let message = "Your Active Auto-Trades:\n\n";
      const keyboard = [];
      
      autoTradesList.forEach((trade, i) => {
        message += `#${i+1}: Buy at $${trade.buyPrice}, Sell at $${trade.sellPrice}\n`;
        keyboard.push([Markup.button.callback(`Cancel #${i+1}`, `cancel_trade_${i}`)]);
      });
      
      keyboard.push([Markup.button.callback('⬅️ Back', 'back_to_auto_trade')]);
      
      await ctx.editMessageText(
        message,
        Markup.inlineKeyboard(keyboard)
      );
      ctx.session.state = STATES.AUTO_TRADE_SETUP;
      break;
      
    case 'back_to_auto_trade':
      return ctx.callbackQuery('auto_trade');
      
    case 'buy_eth':
      // Implement buying functionality for Sepolia testnet
      await ctx.editMessageText(
        `To simulate buying ETH on Sepolia testnet, please specify how much ETH you want to buy:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'trade')]
        ])
      );
      ctx.session.state = 'BUY_ETH_AMOUNT';
      break;
      
    case 'sell_eth':
      // Implement selling functionality for Sepolia testnet
      await ctx.editMessageText(
        `To simulate selling ETH on Sepolia testnet, please specify how much ETH you want to sell:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'trade')]
        ])
      );
      ctx.session.state = 'SELL_ETH_AMOUNT';
      break;
      
    default:
      if (action.startsWith('cancel_trade_')) {
        const index = parseInt(action.split('_')[2]);
        const trades = userData[userId].autoTrades || [];
        
        if (index >= 0 && index < trades.length) {
          const removedTrade = trades.splice(index, 1)[0];
          userData[userId].autoTrades = trades;
          saveUserData(userData);
          
          await ctx.editMessageText(
            `Auto-trade canceled:\n` +
            `Buy at $${removedTrade.buyPrice}, Sell at $${removedTrade.sellPrice}`,
            Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'back_to_auto_trade')]
            ])
          );
        } else {
          await ctx.editMessageText("Invalid trade selection.");
        }
        
        ctx.session.state = STATES.AUTO_TRADE_SETUP;
      } else if (action === 'confirm_auto_trade') {
        const buyPrice = ctx.session.autoTrade.buyPrice;
        const sellPrice = ctx.session.autoTrade.sellPrice;
        
        if (!userData[userId].autoTrades) {
          userData[userId].autoTrades = [];
        }
        
        userData[userId].autoTrades.push({
          buyPrice: buyPrice,
          sellPrice: sellPrice,
          createdAt: new Date().toISOString()
        });
        
        saveUserData(userData);
        
        await ctx.editMessageText(
          `✅ Auto-trade setup confirmed!\n\n` +
          `The bot will automatically buy ETH when the price reaches $${buyPrice.toFixed(2)} ` +
          `and sell when it reaches $${sellPrice.toFixed(2)}.`
        );
        
        // Ensure price monitor is running
        if (!global.priceMonitorRunning) {
          global.priceMonitorRunning = true;
          startPriceMonitor();
        }
        
        await showMainMenu(ctx);
        ctx.session.state = STATES.MAIN_MENU;
      } else if (action === 'cancel_auto_trade') {
        await ctx.editMessageText("Auto-trade setup canceled.");
        await showMainMenu(ctx);
        ctx.session.state = STATES.MAIN_MENU;
      }
  }
});

// Handle text messages based on state
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const text = ctx.message.text;
  const userData = loadUserData();
  
  switch (ctx.session.state) {
    case STATES.SET_BUY_PRICE:
      try {
        const buyPrice = parseFloat(text.trim());
        if (buyPrice <= 0) {
          await ctx.reply(
            "Price must be greater than 0. Please enter a valid buy price:"
          );
          break;
        }
        
        ctx.session.autoTrade.buyPrice = buyPrice;
        const ethPrice = await getEthPrice();
        
        await ctx.reply(
          `Buy price set to: $${buyPrice.toFixed(2)}\n` +
          `Current ETH Price: $${ethPrice.toFixed(2)}\n\n` +
          `Now enter the ETH price at which you want to SELL (in USD):`,
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'back_to_auto_trade')]
          ])
        );
        ctx.session.state = STATES.SET_SELL_PRICE;
      } catch (error) {
        await ctx.reply("Please enter a valid number for the buy price:");
      }
      break;
      
    case STATES.SET_SELL_PRICE:
      try {
        const sellPrice = parseFloat(text.trim());
        const buyPrice = ctx.session.autoTrade.buyPrice;
        
        if (sellPrice <= 0) {
          await ctx.reply(
            "Price must be greater than 0. Please enter a valid sell price:"
          );
          break;
        }
        
        ctx.session.autoTrade.sellPrice = sellPrice;
        const ethPrice = await getEthPrice();
        
        await ctx.reply(
          `Auto-Trade Setup:\n\n` +
          `Buy ETH at: $${buyPrice.toFixed(2)}\n` +
          `Sell ETH at: $${sellPrice.toFixed(2)}\n` +
          `Current ETH Price: $${ethPrice.toFixed(2)}\n\n` +
          `Confirm this auto-trade setup?`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('Confirm', 'confirm_auto_trade'),
              Markup.button.callback('Cancel', 'cancel_auto_trade')
            ]
          ])
        );
        ctx.session.state = STATES.CONFIRM_AUTO_TRADE;
      } catch (error) {
        await ctx.reply("Please enter a valid number for the sell price:");
      }
      break;
      
    case 'BUY_ETH_AMOUNT':
      try {
        const amount = parseFloat(text.trim());
        if (amount <= 0) {
          await ctx.reply("Amount must be greater than 0. Please enter a valid amount:");
          break;
        }
        
        const ethPrice = await getEthPrice();
        const cost = amount * ethPrice;
        
        // Since this is a testnet, we'll just simulate the transaction
        await ctx.reply(
          `Transaction Simulated (Sepolia Testnet)\n\n` +
          `Bought: ${amount.toFixed(6)} ETH\n` +
          `Cost: $${cost.toFixed(2)}\n` +
          `Price: $${ethPrice.toFixed(2)}\n\n` +
          `Note: This is a simulation. On a real implementation, ` +
          `this would execute an actual transaction on the blockchain.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
          ])
        );
        ctx.session.state = STATES.MAIN_MENU;
      } catch (error) {
        await ctx.reply("Please enter a valid number for the amount:");
      }
      break;
      
    case 'SELL_ETH_AMOUNT':
      try {
        const amount = parseFloat(text.trim());
        const balance = await checkBalance(userData[userId].walletAddress);
        
        if (amount <= 0) {
          await ctx.reply("Amount must be greater than 0. Please enter a valid amount:");
          break;
        }
        
        if (amount > balance) {
          await ctx.reply(
            `You don't have enough ETH. Your balance is ${balance.toFixed(6)} ETH.\n` +
            `Please enter a smaller amount:`
          );
          break;
        }
        
        const ethPrice = await getEthPrice();
        const value = amount * ethPrice;
        
        // Since this is a testnet, we'll just simulate the transaction
        await ctx.reply(
          `Transaction Simulated (Sepolia Testnet)\n\n` +
          `Sold: ${amount.toFixed(6)} ETH\n` +
          `Received: $${value.toFixed(2)}\n` +
          `Price: $${ethPrice.toFixed(2)}\n\n` +
          `Note: This is a simulation. On a real implementation, ` +
          `this would execute an actual transaction on the blockchain.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Menu', 'back_to_menu')]
          ])
        );
        ctx.session.state = STATES.MAIN_MENU;
      } catch (error) {
        await ctx.reply("Please enter a valid number for the amount:");
      }
      break;
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

// Add a function to execute a transaction on Sepolia testnet
async function executeTransaction(fromPrivateKey, toAddress, amount) {
  try {
    const account = web3.eth.accounts.privateKeyToAccount(fromPrivateKey);
    const fromAddress = account.address;
    
    // Check balance
    const balanceWei = await web3.eth.getBalance(fromAddress);
    const balanceEth = web3.utils.fromWei(balanceWei, 'ether');
    
    if (parseFloat(balanceEth) < parseFloat(amount)) {
      return { success: false, message: 'Insufficient balance' };
    }
    
    // Get nonce
    const nonce = await web3.eth.getTransactionCount(fromAddress);
    
    // Get gas price
    const gasPrice = await web3.eth.getGasPrice();
    
    // Create transaction object
    const txObject = {
      from: fromAddress,
      to: toAddress,
      value: web3.utils.toWei(amount.toString(), 'ether'),
      gas: 21000,
      gasPrice: gasPrice,
      nonce: nonce
    };
    
    // Sign transaction
    const signedTx = await web3.eth.accounts.signTransaction(txObject, fromPrivateKey);
    
    // Send transaction
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    return {
      success: true,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    console.error(`Transaction error: ${error.message}`);
    return { success: false, message: error.message };
  }
}

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
            // In a real implementation, you would execute the buy transaction here
            // For demo purposes, we'll just log and notify
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
            // In a real implementation, you would execute the sell transaction here
            // For demo purposes, we'll just log and notify
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
bot.launch().then(() => {
  console.log('ETH Trading Bot is running on Sepolia Testnet!');
  
  // Start price monitoring
  if (!global.priceMonitorRunning) {
    global.priceMonitorRunning = true;
    startPriceMonitor();
  }
}).catch(err => {
  console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));