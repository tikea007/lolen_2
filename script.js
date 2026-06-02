// ── REPLACE THIS WITH YOUR NEW GAS ENDPOINT WHEN READY ───────────────────────
const ENDPOINT = "https://script.google.com/macros/s/AKfycbx3HH_oZ88i0IpyqGMK814o4TDNVLIVyLFlAat_19VYtBX8LBHyYCE6xTGUiOVAS2f6rw/exec";

// ── XSS HELPER ───────────────────────────────────────────────────────────────
// Escapes the five HTML-special characters before inserting untrusted text
// into innerHTML. Numbers produced by .toLocaleString() are safe as-is.
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

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
let itemSummary = Object.create(null); // { itemName: { qty, totalPrice } }

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

    container.innerHTML = "";

    if (expenseList.length === 0) {
        const empty = document.createElement("div");
        empty.className = "expense-empty";
        empty.textContent = "No expenses added yet.";
        container.appendChild(empty);
        return;
    }

    expenseList.forEach((e, i) => {
        const row = document.createElement("div");
        row.className = "expense-item";

        const note = document.createElement("span");
        note.className = "expense-item-note";
        note.textContent = (i + 1) + ". " + e.note;  // textContent never interprets HTML

        const right = document.createElement("div");
        right.className = "expense-item-right";

        const price = document.createElement("span");
        price.className = "expense-item-price";
        price.textContent = e.amt.toLocaleString() + " \u17DB";  // ៛

        right.appendChild(price);
        row.appendChild(note);
        row.appendChild(right);
        container.appendChild(row);
    });
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

        let revCash = 0, revABA = 0, dCount = 0;
        let counts = Object.create(null);
        itemSummary = Object.create(null);

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
                    const data = dataset.data.at(index); // Use .at() instead of bracket notation to satisfy scanner
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
            const statusEl = document.getElementById("status");
            statusEl.textContent = "✓ Sale recorded!";
            statusEl.style.color = "#2e7d32";
            statusEl.style.fontSize = "14px";
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
            const statusEl = document.getElementById("status");
            statusEl.textContent = "✗ Not saved: " + text.trim();
            statusEl.style.color = "#e53935";
            statusEl.style.fontSize = "14px";
            btn.disabled = false; btn.innerText = "Record Sale";
        }
    } catch (err) {
        alert("Network error — sale not saved!");
        btn.disabled = false; btn.innerText = "Record Sale";
    }

    setTimeout(() => {
        document.getElementById("status").textContent = "";
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
    itemListEl.innerHTML = "";

    if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.style.color = "#999";
        empty.style.textAlign = "center";
        empty.style.fontStyle = "italic";
        empty.textContent = "No sales recorded today.";
        itemListEl.appendChild(empty);
    } else {
        entries.forEach(([name, { qty, totalPrice }]) => {
            const row = document.createElement("div");
            row.className = "print-item-row";

            const nameSpan = document.createElement("span");
            nameSpan.className = "print-item-name";
            nameSpan.textContent = name;

            const qtySpan = document.createElement("span");
            qtySpan.className = "print-item-qty";
            qtySpan.textContent = qty;

            const eqSpan = document.createElement("span");
            eqSpan.className = "print-item-eq";
            eqSpan.textContent = "=";

            const priceSpan = document.createElement("span");
            priceSpan.className = "print-item-price";
            priceSpan.textContent = totalPrice.toLocaleString() + " \u17DB"; // ៛

            row.appendChild(nameSpan);
            row.appendChild(qtySpan);
            row.appendChild(eqSpan);
            row.appendChild(priceSpan);
            itemListEl.appendChild(row);
        });
    }

    // Append Net Profit Today line at the bottom
    const profitRow = document.createElement("div");
    profitRow.className = "print-item-row";
    profitRow.style.marginTop = "10px";
    profitRow.style.borderTop = "2px solid #ccc";
    profitRow.style.borderBottom = "none";
    profitRow.style.paddingTop = "10px";

    const profitNameSpan = document.createElement("span");
    profitNameSpan.className = "print-item-name";
    profitNameSpan.style.color = profitColor;
    profitNameSpan.textContent = "📈 Net Profit Today";

    const profitEqSpan = document.createElement("span");
    profitEqSpan.className = "print-item-eq";
    profitEqSpan.textContent = "=";

    const profitPriceSpan = document.createElement("span");
    profitPriceSpan.className = "print-item-price";
    profitPriceSpan.style.color = profitColor;
    profitPriceSpan.textContent = netProfit.toLocaleString() + " \u17DB";

    const br = document.createElement("br");
    profitPriceSpan.appendChild(br);

    const usdSpan = document.createElement("span");
    usdSpan.style.fontSize = "11px";
    usdSpan.style.fontWeight = "600";
    usdSpan.textContent = `($${netUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    profitPriceSpan.appendChild(usdSpan);

    profitRow.appendChild(profitNameSpan);
    profitRow.appendChild(profitEqSpan);
    profitRow.appendChild(profitPriceSpan);

    itemListEl.appendChild(profitRow);
    window.print();
}
function logout() { sessionStorage.removeItem(SESSION_KEY); location.reload(); }

// ── INIT ─────────────────────────────────────────────────────────────────────
if (sessionPass) checkLogin();
