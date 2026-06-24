// inventory.js — Gerencia as figurinhas que este nó possui

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const INVENTORY_FILE = path.join(__dirname, '..', 'data', 'inventory.json');

class Inventory extends EventEmitter {
  constructor(myStickerId, initialQty = 28) {
    super();
    this.myStickerId = myStickerId;
    this.initialQty  = initialQty;
    this.items       = {}; // { sticker_id: quantidade }
    this._load();
  }

  // Verificar se possui pelo menos uma cópia da figurinha
  has(stickerId) {
    return this.getQuantity(stickerId) > 0;
  }

  // Quantidade disponível de uma figurinha
  getQuantity(stickerId) {
    return this.items[stickerId] || 0;
  }

  // Cópia do inventário completo
  getAll() {
    return { ...this.items };
  }

  // Quantas figurinhas distintas este nó possui
  getTotalUnique() {
    return Object.values(this.items).filter(qty => qty > 0).length;
  }

  // Soma total de todas as figurinhas
  getTotalCount() {
    return Object.values(this.items).reduce((sum, qty) => sum + qty, 0);
  }

  // Verificar se tem quantidade suficiente para uma troca
  canTrade(stickerId, qty = 1) {
    return this.getQuantity(stickerId) >= qty;
  }

  // Adicionar figurinha ao inventário
  add(stickerId, qty = 1) {
    this.items[stickerId] = this.getQuantity(stickerId) + qty;
    console.log(`[INVENTÁRIO] +${qty} ${stickerId} → total: ${this.items[stickerId]}`);
    this._save();
    this.emit('updated', this.getAll());
  }

  // Remover figurinha do inventário (lança erro se insuficiente)
  remove(stickerId, qty = 1) {
    const atual = this.getQuantity(stickerId);
    if (atual < qty) {
      throw new Error(`Inventário insuficiente: ${stickerId} tem ${atual}, precisa ${qty}`);
    }
    this.items[stickerId] = atual - qty;
    if (this.items[stickerId] === 0) delete this.items[stickerId]; // remover entradas zeradas
    console.log(`[INVENTÁRIO] -${qty} ${stickerId} → total: ${this.getQuantity(stickerId)}`);
    this._save();
    this.emit('updated', this.getAll());
  }

  // ─── Persistência ─────────────────────────────────────────────────────────

  _load() {
    if (fs.existsSync(INVENTORY_FILE)) {
      this.items = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf-8'));
      console.log('[INVENTÁRIO] Carregado do disco:', this.items);
    } else {
      // Primeiro uso: começar com as cópias iniciais da própria figurinha
      this.items = { [this.myStickerId]: this.initialQty };
      this._save();
      console.log(`[INVENTÁRIO] Criado: ${this.initialQty}x ${this.myStickerId}`);
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(this.items, null, 2), 'utf-8');
  }
}

module.exports = Inventory;
