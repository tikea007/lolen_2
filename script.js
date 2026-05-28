// ── REPLACE THIS WITH YOUR NEW GAS ENDPOINT WHEN READY ───────────────────────
const ENDPOINT = "https://script.google.com/macros/s/AKfycbx3HH_oZ88i0IpyqGMK814o4TDNVLIVyLFlAat_19VYtBX8LBHyYCE6xTGUiOVAS2f6rw/exec";

// ── SHOP CONFIG ───────────────────────────────────────────────────────────────
// Session key is unique to this shop so logins don't conflict with Lolen Coffee 1
const SESSION_KEY = "lolen2_pass";


// ─────────────────────────────────────────────────────────────────────────────
// Hash the PIN with SHA-256 so the raw PIN never leaves the browser
async function hashPin(pin) {
    const data = new TextEncoder().encode(pin);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

let sessionPass = sessionStorage.getItem(SESSION_KEY) || "";
let myChart = null;
let currentItem = null;
let currentPrice = 0;
let currentPay = null;
let grossRevenue = 0;
let expenseList = [];
let itemSummary = {}; // { itemName: { qty, totalPrice } }

const getTodayKey = () => "lolen2_exp_" + new Date().toDateString();

// ── LOGIN ────────────────────────────────────────────────────────────────────
async function checkLogin() {
    const inputVal = document.getElementById("passInput").value;
    // If the user typed a PIN, hash it. If reloading from session, the stored
    // value is already a SHA-256 hash — use it directly.
    const pin = inputVal ? await hashPin(inputVal) : sessionPass;
    const btn = document.querySelector("#loginScreen .primary-btn");
    btn.disabled = true;
    btn.textContent = "Logging in…";

    const ok = await loadDashboard(pin);
    if (ok) {
        sessionPass = pin; // pin is always a SHA-256 hash from this point
        sessionStorage.setItem(SESSION_KEY, pin);
        document.getElementById("loginScreen").style.display = "none";
        document.getElementById("mainApp").style.display = "block";
    } else {
        document.getElementById("loginError").style.display = "block";
        btn.disabled = false;
        btn.textContent = "Login";
    }
}
document.getElementById("passInput").addEventListener("keydown", e => {
    if (e.key === "Enter") checkLogin();
});

// ── MENU ─────────────────────────────────────────────────────────────────────
function selectItem(name, price, btn) {
    document.querySelectorAll(".item-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentItem = name;
    currentPrice = price;
    document.getElementById("selectedName").innerText = name;
    checkForm();
}

function setPayment(method) {
    currentPay = method;
    document.getElementById("btnCash").className = "pay-btn" + (method === "Cash" ? " active cash" : "");
    document.getElementById("btnABA").className = "pay-btn" + (method === "ABA" ? " active aba" : "");
    checkForm();
}

function checkForm() {
    const qty = parseInt(document.getElementById("qtyInput").value) || 0;
    const total = currentPrice * qty;
    document.getElementById("priceDisplay").innerText = total > 0 ? total.toLocaleString() + " ៛" : "0 ៛";
    if (currentItem && currentPay && qty > 0) {
        document.getElementById("submitBtn").disabled = false;
        document.getElementById("finalItem").value = `${currentItem} | ${currentPay} | ${qty}`;
        document.getElementById("finalPrice").value = total;
    } else {
        document.getElementById("submitBtn").disabled = true;
    }
}

// ── EXPENSES ─────────────────────────────────────────────────────────────────
async function addExpense() {
    const noteEl = document.getElementById("expenseNote");
    const amtEl = document.getElementById("expenseAmt");
    const note = noteEl.value.trim();
    const amt = amtEl.value;

    if (!note || !amt) return;

    const addBtn = document.querySelector(".add-expense-btn");
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";

    const params = new URLSearchParams();
    params.append("pass", sessionPass);
    params.append("type", "expense");
    params.append("note", note);
    params.append("amount", amt);

    try {
        await fetch(ENDPOINT, { method: "POST", body: params });
        noteEl.value = "";
        amtEl.value = "";
        noteEl.focus();
        await loadDashboard(sessionPass);
    } catch (e) {
        console.error("Expense error:", e);
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = "+ Add Expense";
    }
}

function renderExpenses() {
    const container = document.getElementById("expenseList");
    const totalExp = expenseList.reduce((s, e) => s + e.amt, 0);

    document.getElementById("expenseDisplay").innerText = totalExp.toLocaleString() + " ៛";
    const expUsd = totalExp / 4000;
    document.getElementById("expenseDisplayUsd").innerText = "$" + expUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Net profit shows gross revenue as-is (expense deduction not applied yet)
    const np = document.getElementById("netProfit");
    const npUsd = document.getElementById("netProfitUsd");
    const netUsd = grossRevenue / 4000;

    np.innerText = grossRevenue.toLocaleString() + " ៛";
    np.style.color = "#2e7d32";
    npUsd.innerText = "$" + netUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    npUsd.style.color = "#2e7d32";

    if (expenseList.length === 0) {
        container.innerHTML = '<div class="expense-empty">No expenses added yet.</div>';
        return;
    }
    container.innerHTML = expenseList.map((e, i) => `
        <div class="expense-item">
            <span class="expense-item-note">${i + 1}. ${e.note}</span>
            <div class="expense-item-right">
                <span class="expense-item-price">${e.amt.toLocaleString()} ៛</span>
            </div>
        </div>
    `).join("");
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────
// GAS serializes Dates as "Date(ms)" strings — this helper parses both formats
function parseGASDate(ts) {
    if (!ts) return null;
    // Handle GAS format: "Date(1234567890000)"
    const m = String(ts).match(/Date\((\d+)\)/);
    if (m) return new Date(Number(m[1]));
    // Handle ISO string or anything else
    const d = new Date(ts);
    return isNaN(d) ? null : d;
}

async function loadDashboard(pass) {
    try {
        // Single request — returns sales + expenses together for maximum speed
        const res = await fetch(`${ENDPOINT}?pass=${encodeURIComponent(pass)}&_cb=${Date.now()}`);
        const json = await res.json();

        if (!json.auth) return false;

        const salesData = json.sales || [];
        const expData = json.expenses || [];
        const today = new Date().toDateString();

        let revCash = 0, revABA = 0, dCount = 0, counts = {};
        itemSummary = {};

        salesData.forEach(s => {
            const d = parseGASDate(s.timestamp);
            if (!d || d.toDateString() !== today) return;
            const price = Number(s.price);
            const parts = (s.item || "").split(" | ");
            const name = parts[0];
            const pay = parts[1] || "Cash";
            const qty = Number(parts[2]) || 1;

            if (pay === "ABA") revABA += price; else revCash += price;
            dCount += qty;
            counts[name] = (counts[name] || 0) + qty;
            if (!itemSummary[name]) itemSummary[name] = { qty: 0, totalPrice: 0 };
            itemSummary[name].qty += qty;
            itemSummary[name].totalPrice += price;
        });

        // Sync expenseList from sheet — using parseGASDate to handle GAS timestamp format
        expenseList = expData
            .filter(e => { const d = parseGASDate(e.timestamp); return d && d.toDateString() === today; })
            .map(e => ({ note: e.note, amt: Number(e.amount) }));

        grossRevenue = revCash + revABA;

        document.getElementById("qtyDrinks").innerText = dCount;
        document.getElementById("qtyTotal").innerText = dCount;
        document.getElementById("revCash").innerText = revCash.toLocaleString() + " ៛";
        document.getElementById("revABA").innerText = revABA.toLocaleString() + " ៛";
        document.getElementById("revTotal").innerText = grossRevenue.toLocaleString() + " ៛";

        renderExpenses();
        renderChart(counts);
        return true;
    } catch (err) {
        console.error("loadDashboard error:", err);
        return false;
    }
}

function renderChart(counts) {
    const keys = Object.keys(counts);
    // Dynamically adjust width and keep the wrapper responsive
    const minW = Math.max(600, keys.length * 60);
    document.getElementById("chartWrapperInner").style.minWidth = minW + "px";

    const ctx = document.getElementById("salesChart").getContext("2d");
    if (myChart) myChart.destroy();

    // Plugin: draw quantity labels on top of bars
    const barLabelsPlugin = {
        id: 'barLabels',
        afterDatasetsDraw(chart, args, options) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                chart.getDatasetMeta(i).data.forEach((bar, index) => {
                    const data = dataset.data[index];
                    if (data > 0) {
                        ctx.fillStyle = '#444';
                        ctx.font = 'bold 13px "Segoe UI", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(data, bar.x, bar.y - 5);
                    }
                });
            });
        }
    };

    myChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: keys,
            // Teal bar color to match Lolen Coffee 2 theme
            datasets: [{ data: Object.values(counts), backgroundColor: "#00897b", borderRadius: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grace: '10%' }
            }
        },
        plugins: [barLabelsPlugin]
    });
}

// ── RECORD SALE ──────────────────────────────────────────────────────────────
document.getElementById("salesForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("submitBtn");
    btn.disabled = true; btn.innerText = "Saving…";

    const params = new URLSearchParams(new FormData(e.target));
    params.append("pass", sessionPass);
    params.append("type", "sale");

    try {
        const res = await fetch(ENDPOINT, { method: "POST", body: params });
        const text = await res.text();

        if (text.trim() === "Success") {
            document.getElementById("status").innerHTML = "<span style='color:#2e7d32; font-size:14px;'>✓ Sale recorded!</span>";
            currentItem = null; currentPrice = 0; currentPay = null;
            document.getElementById("selectedName").innerText = "—";
            document.getElementById("qtyInput").value = "1";
            document.getElementById("priceDisplay").innerText = "0 ៛";
            document.querySelectorAll(".item-btn").forEach(b => b.classList.remove("active"));
            document.getElementById("btnCash").className = "pay-btn";
            document.getElementById("btnABA").className = "pay-btn";
            checkForm();
            await loadDashboard(sessionPass);
        } else {
            document.getElementById("status").innerHTML = "<span style='color:#e53935; font-size:14px;'>✗ Not saved: " + text.trim() + "</span>";
            btn.disabled = false; btn.innerText = "Record Sale";
        }
    } catch (err) {
        alert("Network error — sale not saved!");
        btn.disabled = false; btn.innerText = "Record Sale";
    }

    setTimeout(() => {
        document.getElementById("status").innerHTML = "";
        btn.innerText = "Record Sale";
    }, 3000);
});

// ── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.getElementById("expenseNote").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("expenseAmt").focus();
});
document.getElementById("expenseAmt").addEventListener("keydown", e => {
    if (e.key === "Enter") addExpense();
});

// ── PRINT & LOGOUT ───────────────────────────────────────────────────────────
function printReport() {
    document.getElementById("printDate").innerText =
        new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    // Build item breakdown for print
    const entries = Object.entries(itemSummary);
    const totalExp = expenseList.reduce((s, e) => s + e.amt, 0);
    const netProfit = grossRevenue - totalExp;
    const netUsd = netProfit / 4000;
    const profitColor = netProfit >= 0 ? "#2e7d32" : "#d84315";

    const itemListEl = document.getElementById("printItemList");
    let html = "";

    if (entries.length === 0) {
        html += '<p style="color:#999; text-align:center; font-style:italic;">No sales recorded today.</p>';
    } else {
        html += entries.map(([name, { qty, totalPrice }]) =>
            `<div class="print-item-row">
                <span class="print-item-name">${name}</span>
                <span class="print-item-qty">${qty}</span>
                <span class="print-item-eq">=</span>
                <span class="print-item-price">${totalPrice.toLocaleString()} ៛</span>
            </div>`
        ).join("");
    }

    // Append Net Profit Today line at the bottom
    html += `<div class="print-item-row" style="margin-top:10px; border-top:2px solid #ccc; border-bottom:none; padding-top:10px;">
        <span class="print-item-name" style="color:${profitColor};">📈 Net Profit Today</span>
        <span class="print-item-eq">=</span>
        <span class="print-item-price" style="color:${profitColor};">
            ${netProfit.toLocaleString()} ៛<br>
            <span style="font-size:11px; font-weight:600;">($${netUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
        </span>
    </div>`;

    itemListEl.innerHTML = html;
    window.print();
}
function logout() { sessionStorage.removeItem(SESSION_KEY); location.reload(); }

// ── INIT ─────────────────────────────────────────────────────────────────────
if (sessionPass) checkLogin();
