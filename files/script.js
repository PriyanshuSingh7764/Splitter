/* =====================================================
   Room Khata: frontend logic
   Step 1: paste your Supabase keys below (see setup steps)
   ===================================================== */
const SUPABASE_URL = "https://flgqpxedqjddxjavoydc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oRYcc8hBgzy53r9xLafesg_nnI-NagA";

const configured =
  !SUPABASE_URL.includes("PASTE") && !SUPABASE_ANON_KEY.includes("PASTE");
const sb = configured
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
const CONFIG_MSG =
  "Add your Supabase URL and anon key at the top of script.js.";

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const SCREENS = ["auth-screen", "room-screen", "dashboard-screen"];

function showScreen(id) {
  SCREENS.forEach((s) => {
    $(s).hidden = s !== id;
  });
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function setMsg(id, text, ok = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

// stop user-typed text from being run as HTML
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

const pad = (n) => String(n).padStart(2, "0");
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const money = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signedMoney = (n) =>
  (n > 0.004 ? "+" : n < -0.004 ? "-" : "") + money(Math.abs(n));
function prettyDate(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/* ---------- app state ---------- */
const state = {
  user: null,
  name: "",
  room: null,
  members: [],
  expenses: [],
  absences: [],
};

/* ---------- 1. login / signup tabs ---------- */
const tabLogin = $("tab-login");
const tabSignup = $("tab-signup");
const loginForm = $("login-form");
const signupForm = $("signup-form");

tabSignup.addEventListener("click", () => {
  loginForm.hidden = true;
  signupForm.hidden = false;
  tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
});
tabLogin.addEventListener("click", () => {
  loginForm.hidden = false;
  signupForm.hidden = true;
  tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
});

/* ---------- 2. signup and login ---------- */
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return setMsg("signup-msg", CONFIG_MSG);
  const name = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;
  if (!name) return setMsg("signup-msg", "Please enter your name.");
  if (password.length < 6)
    return setMsg("signup-msg", "Password must be at least 6 characters.");

  setMsg("signup-msg", "Creating account...", true);
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) return setMsg("signup-msg", error.message);
  if (!data.session) {
    return setMsg(
      "signup-msg",
      "Account created. Check your email to confirm, then log in.",
      true,
    );
  }
  setMsg("signup-msg", "");
  signupForm.reset();
  boot();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return setMsg("login-msg", CONFIG_MSG);
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password)
    return setMsg("login-msg", "Enter your email and password.");

  setMsg("login-msg", "Logging in...", true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return setMsg("login-msg", error.message);
  setMsg("login-msg", "");
  loginForm.reset();
  boot();
});

async function logout() {
  if (sb) await sb.auth.signOut();
  Object.assign(state, {
    user: null,
    name: "",
    room: null,
    members: [],
    expenses: [],
    absences: [],
  });
  showScreen("auth-screen");
}
$("logout-btn").addEventListener("click", logout);
$("room-logout-btn").addEventListener("click", logout);

/* ---------- 3. decide which screen to show ---------- */
async function boot() {
  if (!sb) {
    showScreen("auth-screen");
    return setMsg("login-msg", CONFIG_MSG);
  }

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return showScreen("auth-screen");

  state.user = session.user;
  state.name =
    (session.user.user_metadata && session.user.user_metadata.name) ||
    session.user.email;

  const { data, error } = await sb
    .from("members")
    .select("room_id, rooms(id, name, code)")
    .eq("user_id", state.user.id)
    .limit(1);
  if (error) return toast(error.message);

  if (!data.length) return showScreen("room-screen");
  state.room = data[0].rooms;
  openDashboard();
}

/* ---------- 4. create / join room ---------- */
$("create-room-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("room-name").value.trim();
  if (!name) return setMsg("room-msg", "Enter a room name.");
  const { data, error } = await sb.rpc("create_room", { room_name: name });
  if (error) return setMsg("room-msg", error.message);
  setMsg("room-msg", "");
  state.room = data;
  openDashboard();
});

$("join-room-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("room-code").value.trim();
  if (!code) return setMsg("room-msg", "Enter the room code.");
  const { data, error } = await sb.rpc("join_room", { room_code: code });
  if (error) return setMsg("room-msg", error.message);
  setMsg("room-msg", "");
  state.room = data;
  openDashboard();
});

/* ---------- 5. dashboard ---------- */
function openDashboard() {
  $("dash-room-name").textContent = state.room.name;
  $("dash-room-code").textContent = state.room.code;
  $("dash-user-name").textContent = state.name;
  $("dash-avatar").textContent = state.name.charAt(0).toUpperCase();
  $("exp-date").value = todayStr();
  $("abs-from").value = todayStr();
  $("abs-to").value = todayStr();
  $("month-picker").value = todayStr().slice(0, 7);
  showScreen("dashboard-screen");
  loadData();
}

async function loadData() {
  const rid = state.room.id;
  const [m, e, a] = await Promise.all([
    sb.from("members").select("user_id, profiles(name)").eq("room_id", rid),
    sb
      .from("expenses")
      .select("*")
      .eq("room_id", rid)
      .order("spent_on", { ascending: false }),
    sb
      .from("absences")
      .select("*")
      .eq("room_id", rid)
      .order("from_date", { ascending: false }),
  ]);
  const err = m.error || e.error || a.error;
  if (err) return toast(err.message);

  state.members = m.data.map((row) => ({
    id: row.user_id,
    name: row.profiles ? row.profiles.name : "Unknown",
  }));
  state.expenses = e.data;
  state.absences = a.data;
  render();
}

function nameOf(userId) {
  const found = state.members.find((m) => m.id === userId);
  return found ? found.name : "Unknown";
}

// was this person away on this date? (dates are "YYYY-MM-DD" text, so < and > work)
function isAbsent(userId, date) {
  return state.absences.some(
    (a) => a.user_id === userId && a.from_date <= date && date <= a.to_date,
  );
}

// THE SPLIT LOGIC
function computeSummary(list) {
  const rows = {};
  state.members.forEach((m) => {
    rows[m.id] = { name: m.name, paid: 0, share: 0 };
  });

  list.forEach((exp) => {
    const amount = Number(exp.amount);
    if (rows[exp.added_by]) rows[exp.added_by].paid += amount;

    // fixed: everyone shares. usage: only people present on that date
    const people = state.members.filter(
      (m) => exp.type === "fixed" || !isAbsent(m.id, exp.spent_on),
    );
    if (!people.length) return;
    const each = amount / people.length;
    people.forEach((p) => {
      rows[p.id].share += each;
    });
  });
  return rows;
}

function daysAwayInMonth(userId, month) {
  const [y, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (isAbsent(userId, `${month}-${pad(d)}`)) count++;
  }
  return count;
}
function renderSettlements(summary) {
  const debtors = [];
  const creditors = [];
  Object.entries(summary).forEach(([id, r]) => {
    const name = id === state.user.id ? r.name + " (you)" : r.name;
    const bal = r.paid - r.share;
    if (bal < -0.005) debtors.push({ name, amt: -bal });
    else if (bal > 0.005) creditors.push({ name, amt: bal });
  });

  const lines = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    const d = debtors[0];
    const c = creditors[0];
    const pay = Math.min(d.amt, c.amt);
    lines.push(
      `<li><i class="avatar">${esc(d.name.charAt(0).toUpperCase())}</i>${esc(d.name)} has to pay ${esc(c.name)}<span><b>${money(pay)}</b></span></li>`,
    );
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt < 0.005) debtors.shift();
    if (c.amt < 0.005) creditors.shift();
  }
  $("settle-list").innerHTML = lines.join("");
  $("settle-empty").hidden = lines.length > 0;
}
function render() {
  const month = $("month-picker").value || todayStr().slice(0, 7);
  const list = state.expenses.filter((x) => x.spent_on.startsWith(month));
  const summary = computeSummary(list);
  renderSettlements(summary);

  // summary table
  const rowsHtml = Object.entries(summary)
    .map(([id, r]) => {
      const bal = r.paid - r.share;
      const cls = bal < -0.004 ? "negative" : "positive";
      const label = Math.abs(bal) < 0.005 ? "Settled" : signedMoney(bal);
      return `<tr>
      <td><i class="avatar">${esc(r.name.charAt(0).toUpperCase())}</i>${esc(r.name)}${id === state.user.id ? " (you)" : ""}</td>
      <td class="num">${money(r.paid)}</td>
      <td class="num">${money(r.share)}</td>
      <td class="num"><span class="pill ${cls}">${label}</span></td>
    </tr>`;
    })
    .join("");
  $("summary-body").innerHTML = rowsHtml;
  $("summary-empty").hidden = list.length > 0;

  // stat tiles
  const mine = summary[state.user.id] || { paid: 0, share: 0 };
  const myBal = mine.paid - mine.share;
  const balEl = $("stat-balance");
  balEl.textContent = signedMoney(myBal);
  balEl.classList.toggle("negative", myBal < -0.004);
  balEl.classList.toggle("positive", myBal >= -0.004);
  $("stat-total").textContent = money(
    list.reduce((s, x) => s + Number(x.amount), 0),
  );
  $("stat-absent").textContent = daysAwayInMonth(state.user.id, month);

  // expenses table
  $("expense-body").innerHTML = list
    .map(
      (x) => `<tr>
    <td>${prettyDate(x.spent_on)}</td>
    <td>${esc(x.title)}</td>
    <td><span class="badge ${x.type}">${x.type === "fixed" ? "Fixed" : "Presence"}</span></td>
    <td>${esc(nameOf(x.added_by))}</td>
    <td class="num">${money(x.amount)}</td>
    <td class="num">${
      x.added_by === state.user.id
        ? `<button class="icon-btn" data-del-expense="${x.id}" title="Delete">Delete</button>`
        : ""
    }</td>
  </tr>`,
    )
    .join("");
  $("expense-empty").hidden = list.length > 0;

  // absences list
  $("absence-list").innerHTML = state.absences
    .map(
      (a) => `<li>
    <i class="avatar">${esc(nameOf(a.user_id).charAt(0).toUpperCase())}</i>${esc(nameOf(a.user_id))}
    <span>${prettyDate(a.from_date)} to ${prettyDate(a.to_date)}</span>
    ${a.user_id === state.user.id ? `<button class="icon-btn" data-del-absence="${a.id}" title="Delete">Delete</button>` : ""}
  </li>`,
    )
    .join("");
  $("absence-empty").hidden = state.absences.length > 0;
}

$("month-picker").addEventListener("change", render);

/* ---------- 6. add expense ---------- */
$("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("exp-title").value.trim();
  const amount = Number($("exp-amount").value);
  const date = $("exp-date").value;
  const type = $("exp-type").value;

  if (!title) return setMsg("expense-msg", "Enter what the expense was for.");
  if (!(amount > 0))
    return setMsg("expense-msg", "Amount must be more than 0.");
  if (!date) return setMsg("expense-msg", "Pick a date.");
  if (type === "usage" && !state.members.some((m) => !isAbsent(m.id, date))) {
    return setMsg(
      "expense-msg",
      "Nobody was present on this date. Check the absence dates.",
    );
  }

  const { error } = await sb.from("expenses").insert({
    room_id: state.room.id,
    added_by: state.user.id,
    title,
    amount,
    spent_on: date,
    type,
  });
  if (error) return setMsg("expense-msg", error.message);

  setMsg("expense-msg", "");
  $("exp-title").value = "";
  $("exp-amount").value = "";
  toast("Expense added");
  loadData();
});

/* ---------- 7. add absence ---------- */
$("absence-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const from = $("abs-from").value;
  const to = $("abs-to").value;
  if (!from || !to) return setMsg("absence-msg", "Pick both dates.");
  if (to < from)
    return setMsg(
      "absence-msg",
      "Return date can't be before the leaving date.",
    );

  const { error } = await sb.from("absences").insert({
    room_id: state.room.id,
    user_id: state.user.id,
    from_date: from,
    to_date: to,
  });
  if (error) return setMsg("absence-msg", error.message);

  setMsg("absence-msg", "");
  toast("Absence saved");
  loadData();
});

/* ---------- 8. delete buttons ---------- */
document.addEventListener("click", async (e) => {
  const expId = e.target.dataset && e.target.dataset.delExpense;
  const absId = e.target.dataset && e.target.dataset.delAbsence;
  if (expId) {
    const { error } = await sb.from("expenses").delete().eq("id", expId);
    if (error) return toast(error.message);
    toast("Expense deleted");
    loadData();
  }
  if (absId) {
    const { error } = await sb.from("absences").delete().eq("id", absId);
    if (error) return toast(error.message);
    toast("Absence deleted");
    loadData();
  }
});

/* ---------- 9. copy room code, auto refresh ---------- */
$("copy-code-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.room.code);
    toast("Room code copied");
  } catch (err) {
    toast("Code: " + state.room.code);
  }
});

// when you come back to this tab, load what roommates added
window.addEventListener("focus", () => {
  if (state.room) loadData();
});

boot();
