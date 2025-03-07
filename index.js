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
  riskLevel: String,
  bidAmount: Number,
  buyPrice: Number,
  sellPrice: Number,
  status: String,
  timestamp: { type: Date, default: Date.now }
});
const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: String,
  virtualFunds: { type: Number, default: 0 },
  trades: [TradeSchema],
});
const User = mongoose.model('User', UserSchema);

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
    const { userId, riskLevel, bidAmount } = req.body;
    let user = await User.findOne({ uid: userId });
    if (!user) {
      user = new User({ uid: userId, email: 'unknown' });
    }
    if (bidAmount > user.virtualFunds) return res.status(400).json({ error: 'Insufficient funds' });

    const token = { asset: 'BTC', price: 100 }; // Mock API
    user.virtualFunds -= bidAmount;
    user.trades.push({
      asset: token.asset,
      riskLevel,
      bidAmount,
      buyPrice: token.price,
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

// Auto-Sell Logic
function getSellInterval(riskLevel) {
  switch (riskLevel) {
    case 'low': return 1 * 60 * 1000;
    case 'medium': return 3 * 60 * 1000;
    case 'high': return 7 * 60 * 1000;
  }
}

function getMockSellPrice() {
  return 100 + (Math.random() * 20 - 10);
}

setInterval(async () => {
  try {
    const users = await User.find();
    const now = new Date();

    for (const user of users) {
      let updated = false;
      for (const trade of user.trades) {
        if (trade.status === 'open') {
          const elapsed = now - new Date(trade.timestamp);
          const interval = getSellInterval(trade.riskLevel);
          if (elapsed >= interval) {
            trade.status = 'closed';
            trade.sellPrice = getMockSellPrice();
            user.virtualFunds += trade.sellPrice * (trade.bidAmount / trade.buyPrice);
            updated = true;
          }
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