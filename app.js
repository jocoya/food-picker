// ── 資料 ──────────────────────────────────────────────
const DEFAULT_TAG_EMOJI = {
  便當: '🍱', 麵食: '🍜', 火鍋: '🍲', 飯類: '🍚',
  日式: '🍣', 速食: '🍔', 小吃: '🥟', 其他: '🍽️'
};
// 自訂 tag 存在 localStorage，格式：[{ name, emoji }]
let customTags = JSON.parse(localStorage.getItem('customTags') || '[]');

function getAllTags() {
  const base = Object.entries(DEFAULT_TAG_EMOJI).map(([name, emoji]) => ({ name, emoji }));
  return [...base, ...customTags.filter(t => !DEFAULT_TAG_EMOJI[t.name])];
}

function getTagEmoji(tag) {
  if (DEFAULT_TAG_EMOJI[tag]) return DEFAULT_TAG_EMOJI[tag];
  const c = customTags.find(t => t.name === tag);
  return c ? c.emoji : '🍽️';
}

// TAG_EMOJI proxy for backward compat
const TAG_EMOJI = new Proxy({}, { get: (_, k) => getTagEmoji(k) });

const FOOD_CATEGORIES = [
  { name: '拉麵', tag: '麵食', emoji: '🍜' },
  { name: '牛肉麵', tag: '麵食', emoji: '🍜' },
  { name: '義大利麵', tag: '麵食', emoji: '🍝' },
  { name: '炒飯', tag: '飯類', emoji: '🍚' },
  { name: '雞腿飯', tag: '飯類', emoji: '🍗' },
  { name: '排骨飯', tag: '便當', emoji: '🍱' },
  { name: '控肉飯', tag: '飯類', emoji: '🍚' },
  { name: '火鍋', tag: '火鍋', emoji: '🍲' },
  { name: '麻辣鍋', tag: '火鍋', emoji: '🌶️' },
  { name: '壽司', tag: '日式', emoji: '🍣' },
  { name: '丼飯', tag: '日式', emoji: '🥩' },
  { name: '漢堡', tag: '速食', emoji: '🍔' },
  { name: '炸雞', tag: '速食', emoji: '🍗' },
  { name: '水餃', tag: '小吃', emoji: '🥟' },
  { name: '鹽酥雞', tag: '小吃', emoji: '🍢' },
  { name: '滷味', tag: '小吃', emoji: '🍖' },
  { name: '便當', tag: '便當', emoji: '🍱' },
  { name: '三明治', tag: '其他', emoji: '🥪' },
  { name: '沙拉', tag: '其他', emoji: '🥗' },
  { name: '披薩', tag: '其他', emoji: '🍕' },
];

// 問卷題目
const QUIZ_QUESTIONS = [
  {
    q: '想吃鹹的還是甜的？',
    opts: [
      { label: '🧂 鹹的', filter: f => f.tag !== '其他' || f.name !== '沙拉' },
      { label: '🍰 甜的 / 隨便', filter: () => true },
    ]
  },
  {
    q: '想吃熱的還是冷的？',
    opts: [
      { label: '🔥 熱的', filter: f => ['麵食','飯類','火鍋','便當','日式'].includes(f.tag) },
      { label: '❄️ 冷的 / 都可以', filter: () => true },
    ]
  },
  {
    q: '想吃飽還是吃輕食？',
    opts: [
      { label: '💪 吃飽', filter: f => !['沙拉','三明治'].includes(f.name) },
      { label: '🥗 輕食', filter: f => ['沙拉','三明治','壽司'].includes(f.name) },
    ]
  },
  {
    q: '想吃什麼類型？',
    opts: [
      { label: '🍜 麵 / 飯', filter: f => ['麵食','飯類','便當'].includes(f.tag) },
      { label: '🍲 鍋物', filter: f => f.tag === '火鍋' },
      { label: '🍣 日式', filter: f => f.tag === '日式' },
      { label: '🍔 速食 / 小吃', filter: f => ['速食','小吃'].includes(f.tag) },
      { label: '🎲 都可以', filter: () => true },
    ]
  },
];

// ── 狀態 ──────────────────────────────────────────────
let myList = JSON.parse(localStorage.getItem('myList') || '[]');
// history 格式：[{ name, ts }]，ts 為 timestamp
let history = JSON.parse(localStorage.getItem('eatHistory') || '[]');
let currentResult = null;
let rerollLeft = 3;
let rerollPool = [];

// 今日設定
let todayBudget = null;    // '1' | '2' | '3'
let todayTransport = null; // 'walk' | 'bike' | 'car'
let todaySpecial = false;  // 今天想吃特別的？

// 交通可達性：walk 只能走路，bike 可走路+騎車，car 全部
const TRANSPORT_REACH = { walk: ['walk','any'], bike: ['walk','bike','any'], car: ['walk','bike','car','any'] };

// 預算反向權重：今天省錢 → 便宜的店權重高
// item.budget: '1'=便宜, '2'=普通, '3'=貴
function budgetWeight(item) {
  const b = parseInt(item.budget || '2');
  const t = parseInt(todayBudget || '2');
  // 差距越大（貴的店在省錢模式）→ 權重越低
  const diff = b - t; // 正數=比預算貴，負數=比預算便宜
  if (diff >= 2) return 0.2;
  if (diff === 1) return 0.5;
  if (diff === 0) return 1;
  if (diff === -1) return 1.5; // 比預算便宜，稍微加權
  return 2; // 便宜很多，最高權重
}

// 頻率對應冷卻天數
const FREQ_COOLDOWN = { daily: 0, nextday: 1, weekly: 6, biweekly: 13, special: 9999 };
const FREQ_LABEL = { daily: '🔁 天天可以', nextday: '📅 隔天再說', weekly: '📅 一週一次', biweekly: '🗓️ 兩週一次', special: '✨ 偶爾想到' };

// 取某間店上次吃的時間戳（從 history 找）
function lastEatTs(name) {
  const rec = history.find(h => h.name === name);
  return rec ? rec.ts : 0;
}

// 這間店今天是否在冷卻中（special 永遠冷卻，除非開特別模式）
function isOnCooldown(item) {
  if (todaySpecial) return false; // 特別模式無視冷卻
  const cooldown = FREQ_COOLDOWN[item.freq || 'daily'];
  if (cooldown === 0) return false;
  const last = lastEatTs(item.name);
  if (!last) return false; // 從沒吃過，不冷卻
  const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
  return daysSince < cooldown;
}
function getWeekHistory() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return history.filter(h => h.ts >= cutoff);
}

// 這週吃了幾次某個名稱
function countThisWeek(name) {
  return getWeekHistory().filter(h => h.name === name).length;
}

// 依權重隨機抽一個（喜好 weight × 預算反向權重）
function pickWeighted(arr) {
  const weighted = arr.map(i => ({ item: i, w: (i.weight || 1) * budgetWeight(i) }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.item;
  }
  return weighted[weighted.length - 1].item;
}

// 轉盤
let spinning = false;
let spinAngle = 0;
let spinItems = [];

// 對決
let duelPool = [];
let duelRound = [];
let duelNextRound = [];

// 刷卡
let swipePool = [];
let swipeIndex = 0;
let swipeKept = [];
let swipeDragStartX = 0;
let swipeDragging = false;

// 問卷
let quizStep = 0;
let quizFiltered = [...FOOD_CATEGORIES];
let activeFilter = '全部';
let includeCooldown = false; // 是否把冷卻中的餐廳也加入選擇

// ── 今日設定 ──────────────────────────────────────────
function selectSetup(type, val, btn) {
  if (type === 'budget') todayBudget = val;
  else if (type === 'transport') todayTransport = val;
  else if (type === 'special') {
    todaySpecial = (val === 'yes');
    btn.closest('.setup-options').querySelectorAll('.setup-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('setupGoBtn').disabled = !(todayBudget && todayTransport);
    return;
  }
  btn.closest('.setup-options').querySelectorAll('.setup-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('setupGoBtn').disabled = !(todayBudget && todayTransport);
}

function finishSetup() {
  goTo('page-home');
}

// ── 問卷模式 ──────────────────────────────────────────
function startQuizMode() {
  quizStep = 0;
  quizFiltered = [...FOOD_CATEGORIES];
  goTo('page-quiz');
  renderQuiz();
}

function renderQuiz() {
  const body = document.getElementById('quiz-body');
  if (quizStep >= QUIZ_QUESTIONS.length || quizFiltered.length <= 1) {
    // 問完了，直接出結果
    const pick = quizFiltered[Math.floor(Math.random() * quizFiltered.length)];
    showResult(pick);
    return;
  }
  const q = QUIZ_QUESTIONS[quizStep];
  body.innerHTML = `
    <div class="quiz-question">${q.q}</div>
    <div class="quiz-options">
      ${q.opts.map((opt, i) => `
        <button class="quiz-opt" onclick="answerQuiz(${i})">${opt.label}</button>
      `).join('')}
    </div>
  `;
}

function answerQuiz(optIndex) {
  const filter = QUIZ_QUESTIONS[quizStep].opts[optIndex].filter;
  const next = quizFiltered.filter(filter);
  if (next.length > 0) quizFiltered = next;
  quizStep++;
  renderQuiz();
}

function showResult(item) {
  currentResult = item;
  rerollLeft = 3;
  rerollPool = quizFiltered.length > 1 ? quizFiltered.filter(f => f !== item) : [];
  const hero = document.getElementById('resultHero');
  const emojiEl = document.getElementById('resultEmoji');
  // 清除舊圖
  const oldImg = hero.querySelector('.result-hero-img');
  if (oldImg) oldImg.remove();
  if (item.icon && item.icon.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = item.icon;
    img.className = 'result-hero-img';
    hero.insertBefore(img, hero.firstChild);
    emojiEl.style.display = 'none';
  } else {
    emojiEl.style.display = '';
    emojiEl.textContent = item.icon || getTagEmoji(item.tag) || '🍽️';
  }
  document.getElementById('resultName').textContent = item.name;
  document.getElementById('resultTag').textContent = item.tag || '';
  document.getElementById('resultHistory').textContent = '';
  document.getElementById('rerollCount').textContent = rerollLeft;
  document.getElementById('rerollBtn').disabled = rerollPool.length === 0;
  document.getElementById('confirmBtn').disabled = false;
  goTo('page-result');
}

// ── 頁面切換 ──────────────────────────────────────────
function goTo(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'page-list-manage') { renderList(); renderTagSelect(); }
  if (id === 'page-mode') renderModeFilter();
  if (id === 'page-stats') renderStats();
  if (id === 'page-tags') renderTagList();
}

// ── 常去清單管理 ──────────────────────────────────────
function saveList() { localStorage.setItem('myList', JSON.stringify(myList)); }

function addItem() {
  const nameEl = document.getElementById('newName');
  const name = nameEl.value.trim();
  if (!name) return;
  const tag = document.getElementById('newTag').value;
  const budget = document.getElementById('newBudget').value;
  const transport = document.getElementById('newTransport').value;
  const freq = document.getElementById('newFreq').value;
  const emoji = document.getElementById('newIconEmoji').value.trim();
  const iconData = document.getElementById('newIconPreview').dataset.imgData || '';
  const icon = iconData || emoji || '';
  myList.push({ name, tag, budget, transport, freq, id: Date.now(), weight: 1, icon });
  saveList();
  // 清空表單
  nameEl.value = '';
  document.getElementById('newIconEmoji').value = '';
  const preview = document.getElementById('newIconPreview');
  preview.dataset.imgData = '';
  preview.textContent = '＋';
  preview.style.backgroundImage = '';
  renderList();
  renderTagSelect();
}

// 事件委派：清單的刪除、freq、weight 全部在這裡處理，避免 innerHTML 重建造成重複觸發
document.addEventListener('click', e => {
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    deleteItem(Number(delBtn.dataset.del));
  }
});
document.addEventListener('change', e => {
  const freqSel = e.target.closest('[data-freq]');
  if (freqSel) { setFreq(Number(freqSel.dataset.freq), freqSel.value); return; }
  const weightSel = e.target.closest('[data-weight]');
  if (weightSel) { setWeight(Number(weightSel.dataset.weight), weightSel.value); }
});

function deleteItem(id) {
  myList = myList.filter(i => i.id !== id);
  saveList();
  renderList();
}

function setWeight(id, val) {
  const item = myList.find(i => i.id === id);
  if (item) { item.weight = parseInt(val); saveList(); }
}

function setFreq(id, val) {
  const item = myList.find(i => i.id === id);
  if (item) { item.freq = val; saveList(); renderList(); }
}

const BUDGET_LABEL = { '1': '$', '2': '$$', '3': '$$$' };
const TRANSPORT_LABEL = { walk: '🚶', bike: '🛵', car: '🚗', any: '🌐' };

// 回傳 item 的圖示 HTML（圖片優先，其次 emoji icon，最後 tag emoji）
function itemIconHtml(item, size = 40) {
  if (item.icon && item.icon.startsWith('data:')) {
    return `<img src="${item.icon}" style="width:${size}px;height:${size}px;border-radius:${size*0.25}px;object-fit:cover;flex-shrink:0;" />`;
  }
  const e = item.icon || getTagEmoji(item.tag) || '🍽️';
  return `<span style="font-size:${size*0.7}px;width:${size}px;text-align:center;flex-shrink:0;line-height:1;">${e}</span>`;
}

function renderList() {
  const el = document.getElementById('list-items');
  if (!myList.length) {
    el.innerHTML = '<div class="empty-hint">還沒有餐廳，快新增一個吧</div>';
    return;
  }
  el.innerHTML = myList.map(item => {
    const onCooldown = isOnCooldown(item);
    const last = lastEatTs(item.name);
    const daysAgo = last ? Math.floor((Date.now() - last) / (1000*60*60*24)) : null;
    const cooldownDays = FREQ_COOLDOWN[item.freq || 'daily'];
    const daysLeft = onCooldown ? (cooldownDays - daysAgo) : 0;
    const freqOpts = Object.entries(FREQ_LABEL).map(([k, v]) =>
      `<option value="${k}" ${(item.freq||'daily')===k?'selected':''}>${v}</option>`
    ).join('');
    return `
    <div class="list-item ${onCooldown ? 'list-item-cooldown' : ''}">
      <div class="list-item-left">
        ${itemIconHtml(item)}
        <div>
          <div class="list-item-name">${item.name}${onCooldown ? ` <span class="cooldown-badge">冷卻 ${daysLeft}天</span>` : ''}</div>
          <div class="list-item-meta">
            <span class="list-item-tag">${item.tag}</span>
            <span class="list-item-tag">${BUDGET_LABEL[item.budget] || '$'}</span>
            <span class="list-item-tag">${TRANSPORT_LABEL[item.transport] || ''}</span>
          </div>
          <div class="list-item-selects">
            <select class="freq-select" data-freq="${item.id}">${freqOpts}</select>
            <select class="weight-select" data-weight="${item.id}">
              ${[1,2,3,4,5].map(w => `<option value="${w}" ${(item.weight||1)==w?'selected':''}>${'⭐'.repeat(w)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="list-item-right">
        <button class="list-item-del" data-del="${item.id}">🗑</button>
      </div>
    </div>
  `}).join('');
}

// ── 結果頁操作 ────────────────────────────────────────
function reroll() {
  if (rerollLeft <= 0 || rerollPool.length === 0) return;
  rerollLeft--;
  const idx = Math.floor(Math.random() * rerollPool.length);
  const item = rerollPool.splice(idx, 1)[0];
  currentResult = item;
  const hero = document.getElementById('resultHero');
  const emojiEl = document.getElementById('resultEmoji');
  const oldImg = hero.querySelector('.result-hero-img');
  if (oldImg) oldImg.remove();
  if (item.icon && item.icon.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = item.icon;
    img.className = 'result-hero-img';
    hero.insertBefore(img, hero.firstChild);
    emojiEl.style.display = 'none';
  } else {
    emojiEl.style.display = '';
    emojiEl.textContent = item.icon || getTagEmoji(item.tag) || '🍽️';
  }
  document.getElementById('resultName').textContent = item.name;
  document.getElementById('resultTag').textContent = item.tag || '';
  document.getElementById('rerollCount').textContent = rerollLeft;
  if (rerollLeft === 0 || rerollPool.length === 0) {
    document.getElementById('rerollBtn').disabled = true;
  }
}

function confirmEat() {
  if (!currentResult) return;
  history = history.filter(h => h.name !== currentResult.name);
  history.unshift({ name: currentResult.name, ts: Date.now() });
  localStorage.setItem('eatHistory', JSON.stringify(history));
  document.getElementById('confirmBtn').disabled = true;
  document.getElementById('resultHistory').textContent = '✅ 已記錄！';
}

function openMaps() {
  if (!currentResult) return;
  const q = encodeURIComponent(currentResult.name);
  window.open(`https://www.google.com/maps/search/${q}`, '_blank');
}

// ── 轉盤 ──────────────────────────────────────────────
function startSpin() {
  const pool = getFilteredList();
  if (!pool.length) { alert('清單是空的，請先新增餐廳'); return; }
  spinItems = pool;
  goTo('page-spin');
  drawWheel();
}

function getFilteredList() {
  let pool = includeCooldown ? [...myList] : myList.filter(i => !isOnCooldown(i));
  if (todayTransport) pool = pool.filter(i => TRANSPORT_REACH[todayTransport].includes(i.transport));
  if (todayBudget) pool = pool.filter(i => parseInt(i.budget || '2') <= parseInt(todayBudget) + 1);
  if (activeFilter && activeFilter !== '全部') pool = pool.filter(i => i.tag === activeFilter);
  return pool.length ? pool : (activeFilter && activeFilter !== '全部' ? myList.filter(i => i.tag === activeFilter) : myList);
}

function drawWheel() {
  const canvas = document.getElementById('spinCanvas');
  const ctx = canvas.getContext('2d');
  const cx = 150, cy = 150, r = 140;
  const slice = (2 * Math.PI) / spinItems.length;
  const colors = ['#ff6b35','#f7931e','#ffd166','#06d6a0','#118ab2','#ef476f','#8338ec','#3a86ff'];
  ctx.clearRect(0, 0, 300, 300);
  spinItems.forEach((item, i) => {
    const start = spinAngle + i * slice;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + slice);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + slice / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(item.name, r - 8, 5);
    ctx.restore();
  });
}

function spinWheel() {
  if (spinning) return;
  spinning = true;
  document.getElementById('spinBtn').disabled = true;
  const totalRotation = (Math.PI * 2 * (5 + Math.random() * 5));
  const duration = 3000;
  const start = performance.now();
  const startAngle = spinAngle;
  function animate(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    spinAngle = startAngle + totalRotation * ease;
    drawWheel();
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      spinning = false;
      document.getElementById('spinBtn').disabled = false;
      const slice = (2 * Math.PI) / spinItems.length;
      // 指針在 12 點鐘方向（-π/2），需補上偏移
      const normalized = (((-spinAngle - Math.PI / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.floor(normalized / slice) % spinItems.length;
      showResult(spinItems[idx]);
    }
  }
  requestAnimationFrame(animate);
}

// ── 刷卡 ──────────────────────────────────────────────
function startDuel() {
  const pool = getFilteredList();
  if (pool.length < 2) { alert('清單至少需要 2 個餐廳'); return; }
  swipePool = [...pool];
  swipeIndex = 0;
  swipeKept = [];
  goTo('page-swipe');
  renderSwipeCard();
  initSwipeDrag();
}

function applySwipeCard(cardId, bgId, emojiId, nameId, tagId, item) {
  const bg = document.getElementById(bgId);
  const emojiEl = document.getElementById(emojiId);
  if (item.icon && item.icon.startsWith('data:')) {
    bg.style.backgroundImage = `url(${item.icon})`;
    emojiEl.style.display = 'none';
  } else {
    bg.style.backgroundImage = '';
    emojiEl.style.display = '';
    emojiEl.textContent = item.icon || getTagEmoji(item.tag) || '🍽️';
  }
  document.getElementById(nameId).textContent = item.name;
  document.getElementById(tagId).textContent = item.tag;
  document.getElementById(cardId).style.transform = '';
}

function renderSwipeCard() {
  if (swipeIndex >= swipePool.length) {
    swipeDone();
    return;
  }
  const item = swipePool[swipeIndex];
  applySwipeCard('swipeCard', 'swipeCardBg', 'swipeEmoji', 'swipeName', 'swipeTag', item);
  document.getElementById('swipeCounter').textContent = `${swipeIndex + 1} / ${swipePool.length}`;
  document.getElementById('swipeLabelYes').style.opacity = '0';
  document.getElementById('swipeLabelNo').style.opacity = '0';
}

function swipeYes() {
  swipeKept.push(swipePool[swipeIndex]);
  swipeIndex++;
  renderSwipeCard();
}

function swipeNo() {
  swipeIndex++;
  renderSwipeCard();
}

function swipeDone() {
  const pool = swipeKept.length >= 2 ? swipeKept : swipePool;
  startDuelRound(pool);
}

function initSwipeDrag() {
  const card = document.getElementById('swipeCard');
  card.addEventListener('mousedown', e => { swipeDragStartX = e.clientX; swipeDragging = true; });
  card.addEventListener('touchstart', e => { swipeDragStartX = e.touches[0].clientX; swipeDragging = true; }, { passive: true });
  document.addEventListener('mousemove', e => {
    if (!swipeDragging) return;
    const dx = e.clientX - swipeDragStartX;
    card.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
    document.getElementById('swipeLabelYes').style.opacity = dx > 30 ? Math.min((dx - 30) / 60, 1) : '0';
    document.getElementById('swipeLabelNo').style.opacity = dx < -30 ? Math.min((-dx - 30) / 60, 1) : '0';
  });
  document.addEventListener('touchmove', e => {
    if (!swipeDragging) return;
    const dx = e.touches[0].clientX - swipeDragStartX;
    card.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
    document.getElementById('swipeLabelYes').style.opacity = dx > 30 ? Math.min((dx - 30) / 60, 1) : '0';
    document.getElementById('swipeLabelNo').style.opacity = dx < -30 ? Math.min((-dx - 30) / 60, 1) : '0';
  }, { passive: true });
  const end = (dx) => {
    swipeDragging = false;
    if (dx > 80) swipeYes();
    else if (dx < -80) swipeNo();
    else { card.style.transform = ''; document.getElementById('swipeLabelYes').style.opacity = '0'; document.getElementById('swipeLabelNo').style.opacity = '0'; }
  };
  document.addEventListener('mouseup', e => { if (swipeDragging) end(e.clientX - swipeDragStartX); });
  document.addEventListener('touchend', e => { if (swipeDragging) end(e.changedTouches[0].clientX - swipeDragStartX); });
}

// ── 對決 ──────────────────────────────────────────────
function startDuelRound(pool) {
  duelPool = [...pool];
  if (duelPool.length === 1) { showResult(duelPool[0]); return; }
  duelRound = [...duelPool];
  duelNextRound = [];
  goTo('page-duel');
  nextDuel();
}

function nextDuel() {
  if (duelRound.length < 2) {
    duelNextRound.push(...duelRound);
    if (duelNextRound.length === 1) { showResult(duelNextRound[0]); return; }
    duelRound = [...duelNextRound];
    duelNextRound = [];
  }
  const a = duelRound.shift();
  const b = duelRound.shift();
  document.getElementById('duelA').innerHTML = `<div class="duel-btn-inner">${itemIconHtml(a, 48)}<span>${a.name}</span></div>`;
  document.getElementById('duelB').innerHTML = `<div class="duel-btn-inner">${itemIconHtml(b, 48)}<span>${b.name}</span></div>`;
  document.getElementById('duelA').dataset.idx = JSON.stringify(a);
  document.getElementById('duelB').dataset.idx = JSON.stringify(b);
  document.getElementById('duelProgress').textContent = `還剩 ${duelRound.length + 2} 個`;
}

function pickDuel(side) {
  const winner = side === 0
    ? JSON.parse(document.getElementById('duelA').dataset.idx)
    : JSON.parse(document.getElementById('duelB').dataset.idx);
  duelNextRound.push(winner);
  nextDuel();
}

// ── 快速隨機 ──────────────────────────────────────────
function startQuickRandom() {
  const pool = getFilteredList();
  if (!pool.length) { alert('清單是空的，請先新增餐廳'); return; }
  const item = pickWeighted(pool);
  rerollPool = pool.filter(i => i !== item);
  showResult(item);
}

// ── 模式頁篩選 ────────────────────────────────────────
function renderModeFilter() {
  const el = document.getElementById('mode-filter');
  const tags = ['全部', ...new Set(myList.map(i => i.tag))];
  el.innerHTML = tags.map(t => `
    <button class="filter-chip ${activeFilter === t ? 'active' : ''}" onclick="setFilter('${t}')">${t}</button>
  `).join('');

  // 計算冷卻中的數量
  const coolingCount = myList.filter(i => isOnCooldown(i)).length;
  const toggleRow = document.getElementById('cooldownToggleRow');
  if (!toggleRow) return;
  if (coolingCount === 0) {
    toggleRow.innerHTML = '';
    return;
  }
  toggleRow.innerHTML = `
    <button class="cooldown-toggle ${includeCooldown ? 'active' : ''}" onclick="toggleCooldown()">
      <span class="cooldown-toggle-icon">${includeCooldown ? '🔓' : '🔒'}</span>
      <span>${includeCooldown ? `冷卻中也加入（${coolingCount} 間）` : `排除冷卻中（${coolingCount} 間）`}</span>
    </button>
  `;
}

function toggleCooldown() {
  includeCooldown = !includeCooldown;
  renderModeFilter();
}

function setFilter(tag) {
  activeFilter = tag;
  renderModeFilter();
}

// ── 自訂 Tag ──────────────────────────────────────────
function saveCustomTags() { localStorage.setItem('customTags', JSON.stringify(customTags)); }

function renderTagSelect() {
  const sel = document.getElementById('newTag');
  if (!sel) return;
  sel.innerHTML = getAllTags().map(t => `<option value="${t.name}">${t.emoji} ${t.name}</option>`).join('');
}

function addCustomTag() {
  const name = document.getElementById('newTagName').value.trim();
  const emoji = document.getElementById('newTagEmoji').value.trim() || '🍽️';
  if (!name) return;
  if (DEFAULT_TAG_EMOJI[name] || customTags.find(t => t.name === name)) {
    alert('這個種類已存在');
    return;
  }
  customTags.push({ name, emoji });
  saveCustomTags();
  document.getElementById('newTagName').value = '';
  document.getElementById('newTagEmoji').value = '';
  renderTagList();
}

function deleteCustomTag(name) {
  customTags = customTags.filter(t => t.name !== name);
  saveCustomTags();
  renderTagList();
}

function renderTagList() {
  const el = document.getElementById('tag-list');
  if (!el) return;
  const defaults = Object.entries(DEFAULT_TAG_EMOJI).map(([name, emoji]) =>
    `<div class="list-item"><div class="list-item-left"><span>${emoji}</span><div><div class="list-item-name">${name}</div></div></div><span style="font-size:12px;color:#bbb">預設</span></div>`
  ).join('');
  const customs = customTags.map(t =>
    `<div class="list-item"><div class="list-item-left"><span>${t.emoji}</span><div><div class="list-item-name">${t.name}</div></div></div><button class="list-item-del" onclick="deleteCustomTag('${t.name}')">🗑</button></div>`
  ).join('');
  el.innerHTML = `<div style="padding:8px 16px;font-size:12px;color:#aaa">預設種類</div>${defaults}<div style="padding:8px 16px;font-size:12px;color:#aaa;margin-top:8px">自訂種類</div>${customs || '<div class="empty-hint">還沒有自訂種類</div>'}`;
}

// ── 統計頁 ────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById('stats-body');
  if (!el) return;

  if (!history.length) {
    el.innerHTML = '<div class="empty-hint" style="padding:60px 0">還沒有吃飯紀錄</div>';
    return;
  }

  // 統計各餐廳次數
  const countMap = {};
  history.forEach(h => { countMap[h.name] = (countMap[h.name] || 0) + 1; });
  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];

  // 這週紀錄
  const weekHistory = getWeekHistory();
  const weekMap = {};
  weekHistory.forEach(h => { weekMap[h.name] = (weekMap[h.name] || 0) + 1; });

  // tag 統計
  const tagMap = {};
  history.forEach(h => {
    const item = myList.find(i => i.name === h.name);
    const tag = item ? item.tag : '其他';
    tagMap[tag] = (tagMap[tag] || 0) + 1;
  });
  const tagSorted = Object.entries(tagMap).sort((a, b) => b[1] - a[1]);
  const tagMax = tagSorted[0]?.[1] || 1;

  el.innerHTML = `
    <div class="stats-section">
      <div class="stats-title">🏆 最常吃（全部）</div>
      ${sorted.slice(0, 8).map(([name, count]) => {
        const item = myList.find(i => i.name === name);
        const emoji = item ? getTagEmoji(item.tag) : '🍽️';
        const pct = Math.round(count / max * 100);
        return `
        <div class="stats-row">
          <div class="stats-label">${emoji} ${name}</div>
          <div class="stats-bar-wrap">
            <div class="stats-bar" style="width:${pct}%"></div>
          </div>
          <div class="stats-count">${count}次</div>
        </div>`;
      }).join('')}
    </div>
    <div class="stats-section">
      <div class="stats-title">📅 這週吃了</div>
      ${weekHistory.length ? Object.entries(weekMap).sort((a,b)=>b[1]-a[1]).map(([name, count]) => {
        const item = myList.find(i => i.name === name);
        const emoji = item ? getTagEmoji(item.tag) : '🍽️';
        return `<div class="stats-row"><div class="stats-label">${emoji} ${name}</div><div class="stats-bar-wrap"><div class="stats-bar stats-bar-week" style="width:${Math.round(count/max*100)}%"></div></div><div class="stats-count">${count}次</div></div>`;
      }).join('') : '<div class="empty-hint" style="padding:20px 0">這週還沒紀錄</div>'}
    </div>
    <div class="stats-section">
      <div class="stats-title">🏷️ 種類分布</div>
      ${tagSorted.map(([tag, count]) => {
        const pct = Math.round(count / tagMax * 100);
        return `<div class="stats-row"><div class="stats-label">${getTagEmoji(tag)} ${tag}</div><div class="stats-bar-wrap"><div class="stats-bar stats-bar-tag" style="width:${pct}%"></div></div><div class="stats-count">${count}次</div></div>`;
      }).join('')}
    </div>
  `;
}

// ── 多人模式 ──────────────────────────────────────────
let multiPoolA = [];
let multiPoolB = [];
let multiKeptA = [];
let multiKeptB = [];
let multiIndexA = 0;
let multiIndexB = 0;

function startMultiplayer() {
  const pool = getFilteredList();
  if (pool.length < 2) { alert('清單至少需要 2 個餐廳'); return; }
  multiPoolA = [...pool];
  multiPoolB = [...pool];
  multiIndexA = 0;
  multiKeptA = [];
  goTo('page-multi-a');
  renderMultiCard('A');
  initMultiDrag('A');
}

function startMultiB() {
  multiIndexB = 0;
  multiKeptB = [];
  goTo('page-multi-b-swipe');
  renderMultiCard('B');
  initMultiDrag('B');
}

function renderMultiCard(player) {
  const pool = player === 'A' ? multiPoolA : multiPoolB;
  const index = player === 'A' ? multiIndexA : multiIndexB;
  const counter = document.getElementById(`multi${player}Counter`);
  if (index >= pool.length) {
    if (player === 'A') {
      goTo('page-multi-b');
    } else {
      finishMultiplayer();
    }
    return;
  }
  const item = pool[index];
  applySwipeCard(`multi${player}Card`, `multi${player}CardBg`, `multi${player}Emoji`, `multi${player}Name`, `multi${player}Tag`, item);
  counter.textContent = `${index + 1} / ${pool.length}`;
  [`multi${player}LabelYes`, `multi${player}LabelNo`].forEach(id => {
    document.getElementById(id).style.opacity = '0';
  });
  document.getElementById(`multi${player}Card`).style.transform = '';
}

function multiSwipe(player, liked) {
  const pool = player === 'A' ? multiPoolA : multiPoolB;
  const index = player === 'A' ? multiIndexA : multiIndexB;
  if (liked) {
    if (player === 'A') multiKeptA.push(pool[index]);
    else multiKeptB.push(pool[index]);
  }
  if (player === 'A') multiIndexA++;
  else multiIndexB++;
  renderMultiCard(player);
}

function finishMultiplayer() {
  // 取交集
  const intersection = multiKeptA.filter(a => multiKeptB.find(b => b.id === a.id));
  if (intersection.length === 0) {
    // 沒有交集，用聯集
    const union = [...multiKeptA, ...multiKeptB.filter(b => !multiKeptA.find(a => a.id === b.id))];
    if (union.length === 0) {
      alert('兩個人都沒選，直接隨機！');
      startDuelRound(getFilteredList());
    } else {
      alert('沒有共同想吃的，用大家選的來對決！');
      startDuelRound(union);
    }
  } else if (intersection.length === 1) {
    showResult(intersection[0]);
  } else {
    startDuelRound(intersection);
  }
}

function initMultiDrag(player) {
  const card = document.getElementById(`multi${player}Card`);
  let dragStartX = 0, dragging = false;
  const onStart = (x) => { dragStartX = x; dragging = true; };
  const onMove = (x) => {
    if (!dragging) return;
    const dx = x - dragStartX;
    card.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
    document.getElementById(`multi${player}LabelYes`).style.opacity = dx > 30 ? Math.min((dx-30)/60,1) : '0';
    document.getElementById(`multi${player}LabelNo`).style.opacity = dx < -30 ? Math.min((-dx-30)/60,1) : '0';
  };
  const onEnd = (x) => {
    if (!dragging) return;
    dragging = false;
    const dx = x - dragStartX;
    if (dx > 80) multiSwipe(player, true);
    else if (dx < -80) multiSwipe(player, false);
    else { card.style.transform = ''; document.getElementById(`multi${player}LabelYes`).style.opacity='0'; document.getElementById(`multi${player}LabelNo`).style.opacity='0'; }
  };
  card.addEventListener('mousedown', e => onStart(e.clientX));
  card.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  document.addEventListener('mousemove', e => onMove(e.clientX));
  document.addEventListener('touchmove', e => onMove(e.touches[0].clientX), { passive: true });
  document.addEventListener('mouseup', e => onEnd(e.clientX));
  document.addEventListener('touchend', e => onEnd(e.changedTouches[0].clientX));
}

// ── 圖示處理 ──────────────────────────────────────────
function syncIconPreview() {
  const emoji = document.getElementById('newIconEmoji').value.trim();
  const preview = document.getElementById('newIconPreview');
  if (emoji) {
    preview.textContent = emoji;
    preview.style.backgroundImage = '';
    preview.dataset.imgData = '';
  } else {
    preview.textContent = '＋';
  }
}

function handleIconFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const data = e.target.result;
    const preview = document.getElementById('newIconPreview');
    preview.dataset.imgData = data;
    preview.textContent = '';
    preview.style.backgroundImage = `url(${data})`;
    document.getElementById('newIconEmoji').value = '';
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ── 匯出 / 匯入 ───────────────────────────────────────
function exportData() {
  const data = {
    version: 1,
    myList,
    customTags,
    eatHistory: history,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `food-picker-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.myList) { alert('格式不對，請選擇正確的備份檔'); return; }
      if (!confirm(`匯入後會覆蓋現有資料（${data.myList.length} 間餐廳），確定嗎？`)) return;
      myList = data.myList;
      customTags = data.customTags || [];
      history = data.eatHistory || [];
      saveList();
      saveCustomTags();
      localStorage.setItem('eatHistory', JSON.stringify(history));
      renderList();
      alert('匯入成功！');
    } catch {
      alert('檔案讀取失敗');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}
