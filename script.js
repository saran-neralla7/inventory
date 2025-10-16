/* script.js
  Frontend logic:
  - fetch data from Apps Script (GET)
  - post data (POST) with JSON payload (including base64 PDFs)
  - client-side CSV parsing (PapaParse) and Excel reading (optional)
  - Google Charts rendering
  - animated tab transitions
*/

const SCRIPT_URL = "https://script.google.com/a/macros/gvpcdpgc.edu.in/s/AKfycbztg_WPD3RtjylYtOt1Hv7pnlOcZlC3dzbGOB4BQZvnBtvQHXhf-r-qLawFYQNYvYcS/exec"; // <<--- Set this after deploying Code.gs
const ALLOW_PDF = true; // PDFs only

// UI elements
const tabs = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');
const globalSearch = document.getElementById('globalSearch');

// dashboard cards
const cardTotal = document.getElementById('card-total-systems');
const cardWorking = document.getElementById('card-working');
const cardRepair = document.getElementById('card-repair');
const cardConsumables = document.getElementById('card-consumables');
const cardIssued = document.getElementById('card-issued');

let inventoryData = [], repairsData = [], consumablesData = [], issuedData = [];

// Tab switching with animation
tabs.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelector('.tab-btn.active')?.classList.remove('active');
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    views.forEach(v=> v.classList.remove('active'));
    const view = document.getElementById('view-' + tab);
    view.classList.add('active');
    // small delay to allow CSS transition
    setTimeout(()=> loadView(tab), 10);
  });
});

// load initial dashboard
window.addEventListener('load', ()=> {
  loadAllData().then(()=> {
    drawCharts();
    renderInventoryTable();
    renderRepairsTable();
    renderConsumablesTable();
    renderIssuedTable();
  });
});

// global search handler (simple filtering triggers)
globalSearch?.addEventListener('input', (e)=>{
  const q = e.target.value.toLowerCase();
  renderInventoryTable(q);
  renderRepairsTable(q);
});

// ========== FETCH helpers ==========

async function apiGet(action){
  const url = `${SCRIPT_URL}?action=${action}`;
  const res = await fetch(url);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch(e){ console.error('Failed parse', txt); return []; }
}

async function apiPost(payload){
  // send JSON string
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  return await res.text();
}

// ========== LOAD DATA ==========
async function loadAllData(){
  inventoryData = await apiGet('getInventory') || [];
  repairsData = await apiGet('getRepairs') || [];
  consumablesData = await apiGet('getConsumables') || [];
  issuedData = await apiGet('getIssued') || [];
  // data are arrays of arrays (rows). First row is headers; convert to objects
  inventoryData = toObjects(inventoryData);
  repairsData = toObjects(repairsData);
  consumablesData = toObjects(consumablesData);
  issuedData = toObjects(issuedData);
  updateDashboardCards();
}

// convert sheet rows to array of objects
function toObjects(rows){
  if(!rows || rows.length < 1) return [];
  const headers = rows[0].map(h => String(h).trim());
  const data = [];
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    const obj = {};
    for(let j=0;j<headers.length;j++){ obj[headers[j]] = row[j] !== undefined ? row[j] : ''; }
    data.push(obj);
  }
  return data;
}

// ========== DASHBOARD ==========
function updateDashboardCards(){
  cardTotal.textContent = inventoryData.length || 0;
  cardWorking.textContent = inventoryData.filter(i => String(i.Condition || '').toLowerCase().includes('work')).length;
  // under repair derived from Repairs where status not Completed
  cardRepair.textContent = repairsData.filter(r => String(r.Status || '').toLowerCase() !== 'completed').length;
  cardConsumables.textContent = consumablesData.reduce((s,c)=> s + Number(c.Quantity || 0), 0);
  cardIssued.textContent = issuedData.length || 0;
}

// ========== Charts (Google Charts) ==========
google.charts.load('current', {'packages':['corechart','bar']});
google.charts.setOnLoadCallback(()=> { /* charts drawn after data loaded */ });

function drawCharts(){
  // Pie: Working vs Under Repair
  const working = inventoryData.filter(i => String(i.Condition || '').toLowerCase().includes('work')).length;
  const under = Math.max(0, (inventoryData.length || 0) - working);
  const pieData = google.visualization.arrayToDataTable([
    ['Status','Count'],
    ['Working', working],
    ['Under Repair', under]
  ]);
  const pieOpts = {legend:'bottom', colors:['#2b90ff','#ff6666'], backgroundColor:'transparent', pieHole:0.4};
  const pieChart = new google.visualization.PieChart(document.getElementById('chart-pie'));
  pieChart.draw(pieData, pieOpts);

  // Bar: Repairs per system (top 10)
  const counts = {};
  repairsData.forEach(r => { const s = r['System Number'] || r['systemNumber'] || 'Unknown'; counts[s] = (counts[s]||0)+1; });
  const rows = [['System','Repairs']];
  Object.keys(counts).sort((a,b)=> counts[b]-counts[a]).slice(0,10).forEach(k => rows.push([k, counts[k]]));
  if(rows.length === 1) rows.push(['None',0]);
  const barData = google.visualization.arrayToDataTable(rows);
  const barOpts = {legend:'none', colors:['#3cb371'], backgroundColor:'transparent', hAxis:{title:'Repairs'}, vAxis:{title:'System'}};
  const barChart = new google.visualization.BarChart(document.getElementById('chart-bar'));
  barChart.draw(barData, barOpts);
}

// ========== INVENTORY UI & CSV Upload ==========

const addInventoryForm = document.getElementById('form-add-inventory');
addInventoryForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(addInventoryForm);
  const obj = Object.fromEntries(fd.entries());
  // handle purchase invoice file (PDF)
  const file = document.getElementById('purchaseInvoice').files[0];
  let filePayload = null;
  if(file){
    if(file.type !== 'application/pdf'){ alert('Only PDF invoices allowed'); return; }
    filePayload = await fileToBase64(file);
  }
  // send
  const payload = { action:'addInventory', data: obj, invoice: filePayload ? { name: file.name, b64: filePayload } : null };
  const res = await apiPost(payload);
  alert(res);
  await loadAllData(); renderInventoryTable();
  addInventoryForm.reset();
});

// bulk upload (client-side parse)
document.getElementById('bulkUploadBtn')?.addEventListener('click', ()=>{
  const f = document.getElementById('bulkFileInput').files[0];
  if(!f) return alert('Select CSV or Excel file');
  const name = f.name.toLowerCase();
  if(name.endsWith('.csv')){
    Papa.parse(f, { header:true, skipEmptyLines:true, complete: async (results)=>{
      const rows = results.data;
      // send rows array as json
      const payload = { action:'bulkInventory', rows: rows };
      const res = await apiPost(payload);
      alert(res);
      await loadAllData(); renderInventoryTable();
    }});
  } else {
    // simple Excel support via SheetJS can be added; for brevity, require CSV
    alert('Please upload CSV. Excel support not included in this build.');
  }
});

// inventory table rendering
function renderInventoryTable(q=''){
  const wrap = document.getElementById('inventoryTableWrap');
  if(!wrap) return;
  const headers = ['System Number','Item Type','Model','Serial Number','Processor','RAM','Storage','Purchase Date','Location','Condition','Notes','Invoice Link'];
  let html = `<table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  const rows = inventoryData.filter(r=> {
    if(!q) return true;
    const qq = q.toLowerCase();
    return Object.values(r).some(v => String(v).toLowerCase().includes(qq));
  });
  rows.forEach(r=>{
    html += '<tr>';
    headers.forEach(h=>{
      const v = r[h] || r[h.toLowerCase()] || '';
      if(h === 'Invoice Link' && v) html += `<td><a href="${v}" target="_blank">Invoice</a></td>`;
      else html += `<td>${escapeHtml(v)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ========== REPAIRS UI ==========
const addRepairForm = document.getElementById('form-add-repair');
addRepairForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(addRepairForm);
  const obj = Object.fromEntries(fd.entries());
  const file = document.getElementById('repairInvoice').files[0];
  let filePayload = null;
  if(file){
    if(file.type !== 'application/pdf'){ alert('Only PDF invoices allowed'); return; }
    filePayload = await fileToBase64(file);
  }
  const payload = { action:'addRepair', data: obj, invoice: filePayload ? { name: file.name, b64: filePayload } : null };
  const res = await apiPost(payload);
  alert(res);
  await loadAllData(); renderRepairsTable(); renderInventoryTable(); drawCharts();
  addRepairForm.reset();
});

function renderRepairsTable(q=''){
  const wrap = document.getElementById('repairsTableWrap');
  if(!wrap) return;
  const headers = ['System Number','Repair Date','Issue Description','Parts Replaced','Estimated Cost','Status','Repaired By','Actual Cost','Invoice Link'];
  let html = `<table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  const rows = repairsData.filter(r=> {
    if(!q) return true;
    const qq = q.toLowerCase();
    return Object.values(r).some(v => String(v).toLowerCase().includes(qq));
  });
  rows.forEach(r=>{
    html += '<tr>';
    headers.forEach(h=>{
      const v = r[h] || r[h.toLowerCase()] || '';
      if(h === 'Invoice Link' && v) html += `<td><a href="${v}" target="_blank">Invoice</a></td>`;
      else html += `<td>${escapeHtml(v)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ========== CONSUMABLES UI ==========
const addConsumableForm = document.getElementById('form-add-consumable');
addConsumableForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(addConsumableForm);
  const obj = Object.fromEntries(fd.entries());
  const payload = { action:'addConsumable', data: obj };
  const res = await apiPost(payload);
  alert(res);
  await loadAllData(); renderConsumablesTable(); populateIssueSelect();
  addConsumableForm.reset();
});

function renderConsumablesTable(){
  const wrap = document.getElementById('consumableTableWrap');
  if(!wrap) return;
  const headers = ['Consumable Name','Date','Quantity','Unit','Notes'];
  let html = `<table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  consumablesData.forEach(r=>{
    html += '<tr>';
    headers.forEach(h=>{
      const v = r[h] || r[h.toLowerCase()] || '';
      html += `<td>${escapeHtml(v)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// populate issue select with consumable names
function populateIssueSelect(){
  const sel = document.getElementById('issueSelectItem');
  if(!sel) return;
  sel.innerHTML = '';
  consumablesData.forEach(c=> {
    const opt = document.createElement('option');
    opt.value = c['Consumable Name'] || c['name'] || '';
    opt.textContent = `${opt.value} (available: ${c['Quantity'] || 0})`;
    sel.appendChild(opt);
  });
}

// ========== ISSUE CONSUMABLES ==========
const issueForm = document.getElementById('form-issue');
issueForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(issueForm);
  const obj = Object.fromEntries(fd.entries());
  obj.qty = Number(obj.qty || 0);
  if(obj.qty <= 0) return alert('Invalid quantity');
  const payload = { action:'issueConsumable', data: obj };
  const res = await apiPost(payload);
  alert(res);
  await loadAllData(); renderConsumablesTable(); renderIssuedTable(); populateIssueSelect();
  issueForm.reset();
});

function renderIssuedTable(){
  const wrap = document.getElementById('issuedTableWrap');
  if(!wrap) return;
  const headers = ['Item ID','Item Name','Issued To','Quantity','Date','Remarks'];
  let html = `<table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  issuedData.forEach(r=>{
    html += '<tr>';
    headers.forEach(h=>{
      const v = r[h] || r[h.toLowerCase()] || '';
      html += `<td>${escapeHtml(v)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ========== REPORT DOWNLOADS ==========
document.getElementById('downloadInventory')?.addEventListener('click', ()=> downloadCsvFromArray(inventoryData,'inventory_report.csv'));
document.getElementById('downloadRepairs')?.addEventListener('click', ()=> downloadCsvFromArray(repairsData,'repairs_report.csv'));
document.getElementById('downloadConsumables')?.addEventListener('click', ()=> downloadCsvFromArray(consumablesData,'consumables_report.csv'));
document.getElementById('downloadIssued')?.addEventListener('click', ()=> downloadCsvFromArray(issuedData,'issued_report.csv'));

function downloadCsvFromArray(arr, filename){
  if(!arr || arr.length===0) return alert('No data');
  const headers = Object.keys(arr[0]);
  const csv = [headers.join(',')].concat(arr.map(r => headers.map(h=> `"${String(r[h]||'').replace(/"/g,'""')}"`).join(','))).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

// ========== Utilities ==========
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function fileToBase64(file){
  return new Promise((res,rej)=>{
    const reader = new FileReader();
    reader.onload = ()=> {
      const dataUrl = reader.result;
      // dataUrl = "data:application/pdf;base64,JVBERi0x..."
      const parts = dataUrl.split(',');
      res(parts[1]);
    };
    reader.onerror = (e)=> rej(e);
    reader.readAsDataURL(file);
  });
}
