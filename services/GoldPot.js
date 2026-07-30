const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'gold_pot.json');

class GoldPot {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[GoldPot] 读取失败，重新初始化');
    }
    return {
      balance: 0,
      total_earned: 0,
      total_spent: 0,
      transactions: [],
      last_updated: null
    };
  }

  _save() {
    this.data.last_updated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  // 存入小金库
  deposit(amount, reason = '') {
    if (amount <= 0) return false;
    this.data.balance += amount;
    this.data.total_earned += amount;
    this.data.transactions.push({
      type: 'deposit',
      amount,
      balance_after: this.data.balance,
      reason,
      time: new Date().toISOString()
    });
    this._save();
    return true;
  }

  // 支出（给宝宝买礼物）
  spend(amount, reason = '') {
    if (amount <= 0 || amount > this.data.balance) return false;
    this.data.balance -= amount;
    this.data.total_spent += amount;
    this.data.transactions.push({
      type: 'spend',
      amount,
      balance_after: this.data.balance,
      reason,
      time: new Date().toISOString()
    });
    this._save();
    return true;
  }

  getBalance() {
    return this.data.balance;
  }

  getSummary() {
    return {
      balance: this.data.balance,
      total_earned: this.data.total_earned,
      total_spent: this.data.total_spent,
      transaction_count: this.data.transactions.length,
      last_updated: this.data.last_updated
    };
  }

  getRecentTransactions(limit = 5) {
    return this.data.transactions.slice(-limit).reverse();
  }
}

module.exports = new GoldPot();
