const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/virtual-trading', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const TradeSchema = new mongoose.Schema({
  asset: String,
  tokenAddress: String, // NEW
  riskLevel: String,
  bidAmount: Number,
  buyPrice: Number,
  sellPrice: Number,
  status: String,
  priceChange: Number,
  volumeTrend: Number, //NEW
  liquidityTrend: Number, // NEW
  holderCountAtBuy: Number, // New
  topHoldersPercentAtBuy: Number, // New
  timestamp: { type: Date, default: Date.now }
});
const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: String,
  virtualFunds: { type: Number, default: 0 },
  trades: [TradeSchema],
});
const User = mongoose.model('User', UserSchema);

// Custom API Placeholder
const CUSTOM_API_URL = 'YOUR_API_URL_HERE'; // Add later
const CUSTOM_API_KEY = 'YOUR_API_KEY_HERE'; // Add later

async function getLiveTokenData(tokenAddress = 'DEFAULT_ADDRESS') {
  try {
    const response = await axios.get(`${CUSTOM_API_URL}?tokenAddress=${tokenAddress}`, {
      headers: { 'Authorization': `Bearer ${CUSTOM_API_KEY}` }
    });
    return response.data;
  } catch (error) {
    console.error('Custom API error:', error.response?.data || error.message);
    return {
      symbol: 'BTC',
      initialPrice: 100,
      initialLP: 5000,
      '00_sec_priceChain': 100,
      '00_sec_volume10Sec': 1000,
      '00_sec_LP': 5000,
      '00_sec_holderCount': 15,
      '00_sec_topHoldersPercent': 40,
      '10_sec_priceChain': 102,
      '10_sec_volume10Sec': 1200,
      '10_sec_LP': 5100,
      '10_sec_holderCount': 16,
      '10_sec_topHoldersPercent': 38
    }; // Mock data
  }
}
// Check Buy Signal
function shouldBuy(tokenData, { minHolderCount, minLP, maxTopHoldersPercent }) {
  const latest = tokenData['00_sec_holderCount'] >= minHolderCount &&
                tokenData['00_sec_LP'] >= minLP &&
                tokenData['00_sec_topHoldersPercent'] <= maxTopHoldersPercent;
  return latest;
}
// API Routes
app.get('/api/user/:id', async (req, res) => {
  try {
    let user = await User.findOne({ uid: req.params.id });
    if (!user) {
      user = new User({ uid: req.params.id, email: 'unknown' });
      await user.save();
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/deposit', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    let user = await User.findOne({ uid: userId });
    if (!user) {
      user = new User({ uid: userId, email: 'unknown' });
    }
    user.virtualFunds += amount;
    await user.save();
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/start-trade', async (req, res) => {
  try {
    const { userId, riskLevel, bidAmount, tokenAddress, minHolderCount, minLP, maxTopHoldersPercent } = req.body;
    let user = await User.findOne({ uid: userId });
    if (!user) {
      user = new User({ uid: userId, email: 'unknown' });
    }
    if (bidAmount > user.virtualFunds) return res.status(400).json({ error: 'Insufficient funds' });

    const tokenData = await getLiveTokenData(tokenAddress);
    if (!shouldBuy(tokenData, { minHolderCount, minLP, maxTopHoldersPercent })) {
      return res.status(400).json({ error: 'Buy conditions not met' });
    }

    const buyPrice = tokenData['00_sec_priceChain'];
    user.virtualFunds -= bidAmount;
    user.trades.push({
      asset: tokenData.symbol,
      tokenAddress,
      riskLevel,
      bidAmount,
      buyPrice,
      priceChange: 0,
      volumeTrend: tokenData['00_sec_volume10Sec'],
      liquidityTrend: tokenData['00_sec_LP'],
      holderCountAtBuy: tokenData['00_sec_holderCount'],
      topHoldersPercentAtBuy: tokenData['00_sec_topHoldersPercent'],
      status: 'open',
      timestamp: new Date(),
    });
    await user.save();
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  
  }
});

// Sell Logic
async function shouldSell(trade) {
  const tokenData = await getLiveTokenData(trade.tokenAddress);
  const currentPrice = tokenData['10_sec_priceChain'];
  const priceChange = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
  const volumeChange = ((tokenData['10_sec_volume10Sec'] - trade.volumeTrend) / trade.volumeTrend) * 100;
  const liquidityChange = ((tokenData['10_sec_LP'] - trade.liquidityTrend) / trade.liquidityTrend) * 100;

  const sellThresholds = {
    low: { profit: 5, loss: -2, volumeSpike: 50, liquidityDrop: -10 },
    medium: { profit: 10, loss: -5, volumeSpike: 75, liquidityDrop: -20 },
    high: { profit: 20, loss: -10, volumeSpike: 100, liquidityDrop: -30 }
  };
  const { profit, loss, volumeSpike, liquidityDrop } = sellThresholds[trade.riskLevel];
  return priceChange >= profit || priceChange <= loss || volumeChange >= volumeSpike || liquidityChange <= liquidityDrop;
}

setInterval(async () => {
  try {
    const users = await User.find();
    for (const user of users) {
      let updated = false;
      for (const trade of user.trades) {
        if (trade.status === 'open' && await shouldSell(trade)) {
          const tokenData = await getLiveTokenData(trade.tokenAddress);
          trade.status = 'closed';
          trade.sellPrice = tokenData['10_sec_priceChain'];
          trade.priceChange = ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100;
          user.virtualFunds += trade.sellPrice * (trade.bidAmount / trade.buyPrice);
          updated = true;
        }
      }
      if (updated) await user.save();
    }
  } catch (error) {
    console.error('Auto-sell error:', error);
  }
}, 10000);

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));