import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
} from "recharts";
import {
  Home, List, PieChart as PieIcon, Wallet, Plus, X, TrendingUp, TrendingDown,
  AlertTriangle, ChevronLeft, ChevronRight, Trash2, Landmark, Banknote, CreditCard,
  Cloud, CloudUpload, CloudDownload, Tags, FileSpreadsheet, FileDown, Layers, Check,
} from "lucide-react";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";

// ---------- Design tokens ----------
const COLORS = {
  bg: "#12202B",
  surface: "#1B2C39",
  surface2: "#233A49",
  border: "#2E4757",
  text: "#EDEAE2",
  textDim: "#93A6B3",
  gold: "#C9974C",
  mint: "#4FD8A0",
  coral: "#E8674B",
  sky: "#5FA8D3",
  purple: "#B589D6",
};

const PALETTE = ["#4FD8A0", "#5FA8D3", "#C9974C", "#B589D6", "#E8674B", "#E0B84B", "#7C93A3", "#93A6B3"];
const ACCOUNT_ICONS = { "Banque": Landmark, "Espèces": Banknote, "Carte": CreditCard };

const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};

function buildDefaultCategories() {
  const mk = (name, icon, color, parentId = null) => ({ id: uid(), name, icon, color, parentId });
  const alim = mk("Alimentation", "🍽️", "#4FD8A0");
  const transport = mk("Transport", "🚗", "#5FA8D3");
  const logement = mk("Logement", "🏠", "#C9974C");
  const loisirs = mk("Loisirs", "🎬", "#B589D6");
  const sante = mk("Santé", "🩺", "#E8674B");
  const shopping = mk("Shopping", "🛍️", "#E0B84B");
  const factures = mk("Factures", "📄", "#7C93A3");
  const revenu = mk("Revenu", "💰", "#4FD8A0");
  const virement = mk("Virement", "🔄", "#5FA8D3");
  const autre = mk("Autre", "✨", "#93A6B3");
  return [
    alim, mk("Courses", "🛒", "#4FD8A0", alim.id), mk("Restaurants", "🍔", "#4FD8A0", alim.id),
    transport, mk("Carburant", "⛽", "#5FA8D3", transport.id), mk("Transport public", "🚌", "#5FA8D3", transport.id),
    logement, mk("Loyer", "🔑", "#C9974C", logement.id), mk("Charges", "💡", "#C9974C", logement.id),
    loisirs, mk("Sorties", "🎉", "#B589D6", loisirs.id), mk("Abonnements", "📺", "#B589D6", loisirs.id),
    sante, shopping, factures, revenu, virement, autre,
  ];
}

const DEFAULT_ACCOUNTS = [
  { id: uid(), name: "Compte courant", type: "Banque", initialBalance: 1200 },
  { id: uid(), name: "Espèces", type: "Espèces", initialBalance: 80 },
];

// ---------- Category helpers ----------
// These now take a Map<id, category> (O(1) lookup) instead of an array + .find() (O(n)).
// Build it once per component with: useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
const catById = (categoryMap, id) => categoryMap.get(id);
const catMeta = (categoryMap, id) => catById(categoryMap, id) || { name: "Autre", icon: "✨", color: COLORS.textDim, parentId: null };
const topIdOf = (categoryMap, id) => {
  const c = catById(categoryMap, id);
  if (!c) return id;
  return c.parentId || c.id;
};
const catLabel = (categoryMap, id) => {
  const c = catById(categoryMap, id);
  if (!c) return "Autre";
  if (c.parentId) {
    const parent = catById(categoryMap, c.parentId);
    return parent ? `${parent.name} · ${c.name}` : c.name;
  }
  return c.name;
};

export default function BudgetTracker() {
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState(() => buildDefaultCategories());
  const [tab, setTab] = useState("home");
  const [showAdd, setShowAdd] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [monthCursor, setMonthCursor] = useState(monthKey(new Date()));
  const [toast, setToast] = useState(null);
  const [cloudStatus, setCloudStatus] = useState("idle");
  const [lastSynced, setLastSynced] = useState(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);

  const toggleAccountSelect = (id) => {
    setSelectedAccountIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // ---------- Load ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("budgetbacker:data");
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.accounts?.length) {
            setAccounts(parsed.accounts.map((a) => (
              a.initialBalance !== undefined ? a : { ...a, initialBalance: a.balance || 0 }
            )));
          }
          if (parsed.transactions) setTransactions(parsed.transactions);
          if (parsed.budgets) setBudgets(parsed.budgets);
          if (parsed.categories?.length) setCategories(parsed.categories);
          else {
            // migrate old budgets that used category names, seed defaults
            setBudgets((prevB) => prevB);
          }
        }
      } catch (e) {
        // no saved data yet, keep defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---------- Save ----------
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      try {
        await storage.set(
          "budgetbacker:data",
          JSON.stringify({ accounts, transactions, budgets, categories })
        );
      } catch (e) {
        console.error("Erreur de sauvegarde", e);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [accounts, transactions, budgets, categories, ready]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // ---------- Derived ----------
  // O(1) category/account lookup instead of Array.find() scattered through every render.
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // Single pass over transactions to bucket amounts per account, instead of
  // re-filtering the whole transactions array once per account (O(accounts*n) -> O(accounts+n)).
  const accountsWithBalance = useMemo(() => {
    const deltas = new Map();
    for (const t of transactions) deltas.set(t.accountId, (deltas.get(t.accountId) || 0) + t.amount);
    return accounts.map((a) => ({ ...a, balance: (a.initialBalance || 0) + (deltas.get(a.id) || 0) }));
  }, [accounts, transactions]);

  const visibleTx = useMemo(
    () => selectedAccountIds.length === 0 ? transactions : transactions.filter((t) => selectedAccountIds.includes(t.accountId)),
    [transactions, selectedAccountIds]
  );
  const monthTx = useMemo(
    () => visibleTx.filter((t) => monthKey(new Date(t.date)) === monthCursor),
    [visibleTx, monthCursor]
  );
  const totalBalance = useMemo(() => {
    const list = selectedAccountIds.length === 0 ? accountsWithBalance : accountsWithBalance.filter((a) => selectedAccountIds.includes(a.id));
    return list.reduce((s, a) => s + a.balance, 0);
  }, [accountsWithBalance, selectedAccountIds]);
  // One pass over monthTx instead of two separate .filter().reduce() passes.
  const { income, expense } = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of monthTx) {
      if (t.isTransfer) continue;
      if (t.amount > 0) inc += t.amount; else exp += t.amount;
    }
    return { income: inc, expense: exp };
  }, [monthTx]);

  // Single pass that computes spend-per-top-category once, shared by both
  // the "byCategory" breakdown and the budget progress bars (previously each
  // budget re-scanned every transaction of the month: O(budgets * n)).
  const spentByTopCategory = useMemo(() => {
    const map = {};
    for (const t of monthTx) {
      if (t.amount >= 0 || t.isTransfer) continue;
      const topId = topIdOf(categoryMap, t.categoryId);
      map[topId] = (map[topId] || 0) + Math.abs(t.amount);
    }
    return map;
  }, [monthTx, categoryMap]);

  const byCategory = useMemo(() => {
    return Object.entries(spentByTopCategory).map(([id, value]) => {
      const meta = catMeta(categoryMap, id);
      return { id, name: meta.name, icon: meta.icon, value, color: meta.color };
    }).sort((a, b) => b.value - a.value);
  }, [spentByTopCategory, categoryMap]);

  const budgetStatus = useMemo(() => {
    return budgets.map((b) => {
      const spent = spentByTopCategory[b.categoryId] || 0;
      return { ...b, spent, pct: b.limit > 0 ? Math.min(100, (spent / b.limit) * 100) : 0, over: spent > b.limit };
    });
  }, [budgets, spentByTopCategory]);

  // Single pass over visibleTx bucketed by month, instead of re-filtering the
  // whole array 6 times (once per month) - O(n) instead of O(6n).
  const last6Months = useMemo(() => {
    const buckets = new Map();
    for (const t of visibleTx) {
      if (t.isTransfer) continue;
      const key = monthKey(new Date(t.date));
      let b = buckets.get(key);
      if (!b) { b = { inc: 0, exp: 0 }; buckets.set(key, b); }
      if (t.amount > 0) b.inc += t.amount; else b.exp += Math.abs(t.amount);
    }
    const arr = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const b = buckets.get(monthKey(d)) || { inc: 0, exp: 0 };
      arr.push({ label: d.toLocaleDateString("fr-FR", { month: "short" }), Revenus: b.inc, Dépenses: b.exp });
    }
    return arr;
  }, [visibleTx]);

  // ---------- Transaction actions ----------
  const addTransaction = (tx) => {
    const amount = tx.type === "expense" ? -Math.abs(tx.amount) : Math.abs(tx.amount);
    const newTx = { id: uid(), date: tx.date, label: tx.label, categoryId: tx.categoryId, accountId: tx.accountId, amount };
    setTransactions((prev) => [newTx, ...prev]);

    if (amount < 0) {
      const topId = topIdOf(categoryMap, tx.categoryId);
      const budget = budgets.find((b) => b.categoryId === topId);
      if (budget) {
        const spentSoFar = (spentByTopCategory[topId] || 0) + Math.abs(amount);
        if (spentSoFar > budget.limit) {
          showToast(`⚠️ Budget "${catMeta(categoryMap, topId).name}" dépassé ce mois-ci`);
        }
      }
    }
    setShowAdd(false);
  };

  const deleteTransaction = (id) => {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    if (tx.isTransfer && tx.transferGroup) {
      setTransactions((prev) => prev.filter((t) => t.transferGroup !== tx.transferGroup));
      return;
    }
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const addTransfer = (tr) => {
    const amount = Math.abs(tr.amount);
    const fromAcc = accounts.find((a) => a.id === tr.fromId);
    const toAcc = accounts.find((a) => a.id === tr.toId);
    const virementCat = categories.find((c) => c.name === "Virement" && !c.parentId);
    const groupId = uid();
    const outTx = {
      id: uid(), date: tr.date, label: tr.label || `Virement vers ${toAcc?.name || ""}`,
      categoryId: virementCat?.id, accountId: tr.fromId, amount: -amount, isTransfer: true, transferGroup: groupId,
    };
    const inTx = {
      id: uid(), date: tr.date, label: tr.label || `Virement depuis ${fromAcc?.name || ""}`,
      categoryId: virementCat?.id, accountId: tr.toId, amount: amount, isTransfer: true, transferGroup: groupId,
    };
    setTransactions((prev) => [outTx, inTx, ...prev]);
    showToast(`🔄 ${fmt(amount)} transféré vers ${toAcc?.name || ""}`);
    setShowAdd(false);
  };

  const addAccount = (acc) => {
    setAccounts((prev) => [...prev, { id: uid(), name: acc.name, type: acc.type, initialBalance: Number(acc.balance) || 0 }]);
    setShowAddAccount(false);
  };

  const setAccountBalance = (id, desiredBalance) => {
    const txSum = transactions.filter((t) => t.accountId === id).reduce((s, t) => s + t.amount, 0);
    const newInitial = (Number(desiredBalance) || 0) - txSum;
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, initialBalance: newInitial } : a)));
    showToast("✅ Solde corrigé");
  };

  // Directly edit the starting balance (as opposed to setAccountBalance above,
  // which forces the *current* balance and back-solves the initial one).
  const setAccountInitialBalance = (id, newInitialBalance) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, initialBalance: Number(newInitialBalance) || 0 } : a)));
    showToast("✅ Solde initial mis à jour");
  };

  // ---------- Category actions ----------
  const addCategory = (name, icon, color) => {
    if (!name.trim()) return;
    setCategories((prev) => [...prev, { id: uid(), name: name.trim(), icon: icon || "✨", color: color || PALETTE[prev.length % PALETTE.length], parentId: null }]);
  };
  const addSubcategory = (parentId, name, icon) => {
    if (!name.trim()) return;
    const parent = catById(categoryMap, parentId);
    setCategories((prev) => [...prev, { id: uid(), name: name.trim(), icon: icon || parent?.icon || "✨", color: parent?.color || COLORS.textDim, parentId }]);
  };
  const deleteCategory = (id) => {
    const toRemove = new Set([id, ...categories.filter((c) => c.parentId === id).map((c) => c.id)]);
    setCategories((prev) => prev.filter((c) => !toRemove.has(c.id)));
    setBudgets((prev) => prev.filter((b) => b.categoryId !== id));
    setTransactions((prev) => prev.map((t) => (toRemove.has(t.categoryId) ? { ...t, categoryId: null } : t)));
  };

  // ---------- Google Drive sync ----------
  // NOTE: the original version of this feature relied on Claude.ai's
  // artifact sandbox, which injects an API key server-side and proxies MCP
  // calls to Google Drive. That doesn't exist in a standalone app - there is
  // no safe way to call the Anthropic API directly from the phone without
  // exposing a secret key. Disabled for now; your data still saves locally
  // on the device (see storage.js) and you can use CSV/Excel export below.
  const saveToDrive = async () => {
    setCloudStatus("error");
    showToast("Synchro Drive indisponible dans l'app mobile pour l'instant");
  };

  const loadFromDrive = async () => {
    setCloudStatus("error");
    showToast("Synchro Drive indisponible dans l'app mobile pour l'instant");
  };

  // ---------- Export ----------
  const buildExportRows = () => {
    return transactions
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((t) => {
        const cat = catById(categoryMap, t.categoryId);
        const parent = cat?.parentId ? catById(categoryMap, cat.parentId) : null;
        const acc = accountsById.get(t.accountId);
        const d = new Date(t.date);
        return {
          "Date": t.date,
          "Année": d.getFullYear(),
          "Mois": d.getMonth() + 1,
          "Type": t.isTransfer ? "Virement" : t.amount < 0 ? "Dépense" : "Revenu",
          "Catégorie": parent ? parent.name : (cat?.name || "Autre"),
          "Sous-catégorie": parent ? cat.name : "",
          "Compte": acc?.name || "",
          "Type de compte": acc?.type || "",
          "Description": t.label || "",
          "Montant": t.amount,
          "Montant absolu": Math.abs(t.amount),
          "Devise": "MAD",
          "ID transaction": t.id,
        };
      });
  };

  // Exports use the native Share sheet on Android (via Filesystem + Share
  // plugins) and fall back to a plain browser download when running as a
  // regular web page (e.g. `npm run dev`).
  const shareOrDownload = async (filename, data, { base64 = false, mimeType } = {}) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const written = await Filesystem.writeFile({
          path: filename,
          data,
          directory: Directory.Cache,
          ...(base64 ? {} : { encoding: "utf8" }),
        });
        await Share.share({ title: filename, url: written.uri, dialogTitle: "Partager le fichier" });
      } catch (e) {
        showToast("Erreur lors de l'export du fichier");
      }
      return;
    }
    let blob;
    if (base64) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mimeType });
    } else {
      blob = new Blob([data], { type: mimeType });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = async () => {
    const rows = buildExportRows();
    if (rows.length === 0) { showToast("Aucune donnée à exporter"); return; }
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(";"), ...rows.map((r) => headers.map((h) => esc(r[h])).join(";"))].join("\n");
    await shareOrDownload("budgetbacker-transactions.csv", "\uFEFF" + csv, { mimeType: "text/csv;charset=utf-8;" });
    showToast("📄 CSV exporté");
  };

  const exportExcel = async () => {
    const rows = buildExportRows();
    if (rows.length === 0) { showToast("Aucune donnée à exporter"); return; }
    const wb = XLSX.utils.book_new();
    const wsTx = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsTx, "Transactions");
    const wsAcc = XLSX.utils.json_to_sheet(accountsWithBalance.map((a) => ({ Nom: a.name, Type: a.type, Solde: a.balance })));
    XLSX.utils.book_append_sheet(wb, wsAcc, "Comptes");
    const wsBudgets = XLSX.utils.json_to_sheet(budgets.map((b) => ({ Catégorie: catMeta(categoryMap, b.categoryId).name, Limite: b.limit })));
    XLSX.utils.book_append_sheet(wb, wsBudgets, "Budgets");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    await shareOrDownload("budgetbacker-export.xlsx", base64, {
      base64: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    showToast("📊 Excel exporté");
  };

  if (!ready) {
    return (
      <div style={{ background: COLORS.bg, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textDim, fontFamily: "system-ui" }}>
        Chargement…
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      background: COLORS.bg, color: COLORS.text, height: "100dvh", width: "100%",
      display: "flex", flexDirection: "column", overflow: "hidden", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        html, body { overscroll-behavior: none; }
        .scrollarea::-webkit-scrollbar { display: none; }
        .hscroll::-webkit-scrollbar { display: none; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "calc(24px + env(safe-area-inset-top)) 20px 16px", background: `linear-gradient(160deg, ${COLORS.surface2}, ${COLORS.bg})`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: COLORS.textDim, letterSpacing: "0.06em", textTransform: "uppercase" }}>Vos comptes</div>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: COLORS.gold, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: COLORS.bg, fontSize: 15 }}>
            💼
          </div>
        </div>

        {/* Account dials */}
        <div className="hscroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {accountsWithBalance.map((a) => {
            const Icon = ACCOUNT_ICONS[a.type] || Landmark;
            const isSelected = selectedAccountIds.includes(a.id);
            return (
              <button key={a.id} onClick={() => toggleAccountSelect(a.id)} style={{
                minWidth: 130, background: isSelected ? `${COLORS.gold}1F` : COLORS.surface,
                border: `1.5px solid ${isSelected ? COLORS.gold : COLORS.border}`, borderRadius: 14,
                padding: "12px 14px", flexShrink: 0, textAlign: "left", position: "relative",
                boxShadow: isSelected ? `0 0 0 1px ${COLORS.gold}` : "none",
              }}>
                {isSelected && (
                  <div style={{ position: "absolute", top: 8, right: 8, width: 14, height: 14, borderRadius: "50%", background: COLORS.gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Check size={9} color={COLORS.bg} strokeWidth={3} />
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: isSelected ? COLORS.gold : COLORS.gold, fontSize: 11 }}>
                  <Icon size={13} /> <span style={{ color: COLORS.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 5, color: COLORS.text }}>{fmt(a.balance)}</div>
              </button>
            );
          })}
        </div>
        {selectedAccountIds.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <div style={{ fontSize: 11, color: COLORS.gold }}>
              {selectedAccountIds.length === 1 ? "1 compte sélectionné" : `${selectedAccountIds.length} comptes sélectionnés`}
            </div>
            <button onClick={() => setSelectedAccountIds([])} style={{ background: "none", border: "none", color: COLORS.textDim, fontSize: 11, textDecoration: "underline" }}>
              Tout afficher
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1, background: COLORS.surface, borderRadius: 14, padding: "10px 12px", border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.mint, fontSize: 12 }}><TrendingUp size={14} /> Revenus</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{fmt(income)}</div>
          </div>
          <div style={{ flex: 1, background: COLORS.surface, borderRadius: 14, padding: "10px 12px", border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.coral, fontSize: 12 }}><TrendingDown size={14} /> Dépenses</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{fmt(Math.abs(expense))}</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="scrollarea" style={{ flex: 1, overflowY: "auto", padding: "16px 20px calc(90px + env(safe-area-inset-bottom))", scrollbarWidth: "none" }}>
        {tab === "home" && (
          <HomeTab byCategory={byCategory} monthTx={monthTx} categoryMap={categoryMap} monthLabel={monthLabel(monthCursor)} onDelete={deleteTransaction} />
        )}
        {tab === "transactions" && (
          <TransactionsTab transactions={visibleTx} categoryMap={categoryMap} onDelete={deleteTransaction} />
        )}
        {tab === "budgets" && (
          <BudgetsTab budgetStatus={budgetStatus} setBudgets={setBudgets} categories={categories} categoryMap={categoryMap} />
        )}
        {tab === "stats" && (
          <StatsTab last6Months={last6Months} byCategory={byCategory} monthTx={monthTx} categories={categories} categoryMap={categoryMap} />
        )}
        {tab === "accounts" && (
          <AccountsTab
            accounts={accountsWithBalance}
            onAdd={() => setShowAddAccount(true)}
            onEditBalance={setAccountBalance}
            onEditInitialBalance={setAccountInitialBalance}
            cloudStatus={cloudStatus}
            lastSynced={lastSynced}
            onSaveDrive={saveToDrive}
            onLoadDrive={loadFromDrive}
            onExportCSV={exportCSV}
            onExportExcel={exportExcel}
            categories={categories}
            onAddCategory={addCategory}
            onAddSubcategory={addSubcategory}
            onDeleteCategory={deleteCategory}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "absolute", top: 12, left: 20, right: 20, background: COLORS.coral, color: "#1B0E09",
          padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 40,
          display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>
          <AlertTriangle size={16} /> {toast}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        style={{
          position: "absolute", bottom: "calc(78px + env(safe-area-inset-bottom))", right: 20, width: 54, height: 54, borderRadius: "50%",
          background: COLORS.gold, border: "none", color: COLORS.bg, display: "flex", alignItems: "center",
          justifyContent: "center", boxShadow: "0 8px 20px rgba(201,151,76,0.4)", zIndex: 30,
        }}
      >
        <Plus size={26} />
      </button>

      {/* Bottom nav */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "calc(64px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)", background: COLORS.surface,
        borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-around",
      }}>
        <NavBtn icon={Home} label="Accueil" active={tab === "home"} onClick={() => setTab("home")} />
        <NavBtn icon={List} label="Historique" active={tab === "transactions"} onClick={() => setTab("transactions")} />
        <NavBtn icon={Wallet} label="Budgets" active={tab === "budgets"} onClick={() => setTab("budgets")} />
        <NavBtn icon={PieIcon} label="Stats" active={tab === "stats"} onClick={() => setTab("stats")} />
        <NavBtn icon={Landmark} label="Comptes" active={tab === "accounts"} onClick={() => setTab("accounts")} />
      </div>

      {showAdd && (
        <AddTransactionModal
          accounts={accountsWithBalance}
          formAccounts={selectedAccountIds.length > 0 ? accountsWithBalance.filter((a) => selectedAccountIds.includes(a.id)) : accountsWithBalance}
          categories={categories}
          onClose={() => setShowAdd(false)} onSave={addTransaction} onTransfer={addTransfer}
        />
      )}
      {showAddAccount && <AddAccountModal onClose={() => setShowAddAccount(false)} onSave={addAccount} />}
    </div>
  );
}

const NavBtn = React.memo(function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center",
      gap: 3, color: active ? COLORS.gold : COLORS.textDim, fontSize: 10, padding: 4,
    }}>
      <Icon size={20} />
      {label}
    </button>
  );
});

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 10px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</div>
      {right}
    </div>
  );
}

function HomeTab({ byCategory, monthTx, categoryMap, monthLabel, onDelete }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: COLORS.textDim, textTransform: "capitalize" }}>{monthLabel}</div>
      {byCategory.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <div style={{ width: 130, height: 130 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={byCategory} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2}>
                  {byCategory.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {byCategory.slice(0, 4).map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.text }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, display: "inline-block" }} />
                  {c.name}
                </span>
                <span style={{ color: COLORS.textDim }}>{fmt(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState text="Aucune dépense ce mois-ci. Touchez + pour en ajouter une." />
      )}

      <SectionTitle>Transactions récentes</SectionTitle>
      {monthTx.length === 0 && <EmptyState text="Rien à afficher pour l'instant." />}
      {monthTx.slice(0, 6).map((t) => (
        <TxRow key={t.id} t={t} categoryMap={categoryMap} onDelete={onDelete} />
      ))}
    </div>
  );
}

function TransactionsTab({ transactions, categoryMap, onDelete }) {
  return (
    <div>
      <SectionTitle>Toutes les transactions</SectionTitle>
      {transactions.length === 0 && <EmptyState text="Aucune transaction. Ajoutez-en une avec le bouton +." />}
      {transactions.map((t) => <TxRow key={t.id} t={t} categoryMap={categoryMap} onDelete={onDelete} showDate />)}
    </div>
  );
}

const TxRow = React.memo(function TxRow({ t, categoryMap, onDelete, showDate }) {
  const meta = catMeta(categoryMap, t.categoryId);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label || meta.name}</div>
        <div style={{ fontSize: 11, color: COLORS.textDim }}>
          {catLabel(categoryMap, t.categoryId)}{showDate ? ` · ${new Date(t.date).toLocaleDateString("fr-FR")}` : ""}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.isTransfer ? COLORS.sky : t.amount < 0 ? COLORS.coral : COLORS.mint }}>
        {t.amount < 0 ? "-" : "+"}{fmt(Math.abs(t.amount))}
      </div>
      <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", color: COLORS.textDim, padding: 4 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
});

function BudgetsTab({ budgetStatus, setBudgets, categories, categoryMap }) {
  const [editing, setEditing] = useState(null);
  const topCats = categories.filter((c) => !c.parentId && c.name !== "Revenu" && c.name !== "Virement");

  const addCategoryBudget = (catId) => {
    if (budgetStatus.some((b) => b.categoryId === catId)) return;
    setBudgets((prev) => [...prev, { id: uid(), categoryId: catId, limit: 100 }]);
  };
  const updateLimit = (id, val) => {
    setBudgets((prev) => prev.map((b) => (b.id === id ? { ...b, limit: Number(val) || 0 } : b)));
  };
  const removeBudget = (id) => setBudgets((prev) => prev.filter((b) => b.id !== id));

  const unused = topCats.filter((c) => !budgetStatus.some((b) => b.categoryId === c.id));

  return (
    <div>
      <SectionTitle>Budgets du mois</SectionTitle>
      {budgetStatus.length === 0 && <EmptyState text="Aucun budget défini." />}
      {budgetStatus.map((b) => {
        const meta = catMeta(categoryMap, b.categoryId);
        return (
          <div key={b.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{meta.icon}</span> {meta.name}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {editing === b.id ? (
                  <input
                    autoFocus type="number" defaultValue={b.limit}
                    onBlur={(e) => { updateLimit(b.id, e.target.value); setEditing(null); }}
                    onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                    style={{ width: 60, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: "2px 6px", fontSize: 12 }}
                  />
                ) : (
                  <span onClick={() => setEditing(b.id)} style={{ fontSize: 12, color: COLORS.textDim, cursor: "pointer" }}>
                    {fmt(b.spent)} / {fmt(b.limit)}
                  </span>
                )}
                <button onClick={() => removeBudget(b.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div style={{ height: 6, background: COLORS.surface2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${b.pct}%`, background: b.over ? COLORS.coral : meta.color, transition: "width 0.3s" }} />
            </div>
            {b.over && <div style={{ fontSize: 11, color: COLORS.coral, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} /> Budget dépassé</div>}
          </div>
        );
      })}

      {unused.length > 0 && (
        <>
          <SectionTitle>Ajouter un budget</SectionTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {unused.map((c) => (
              <button key={c.id} onClick={() => addCategoryBudget(c.id)} style={{
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text,
                borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6,
              }}>
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsTab({ last6Months, byCategory, monthTx, categories, categoryMap }) {
  const [drillId, setDrillId] = useState(null);

  const subBreakdown = useMemo(() => {
    if (!drillId) return [];
    const map = {};
    monthTx.filter((t) => t.amount < 0 && !t.isTransfer).forEach((t) => {
      const cat = catById(categoryMap, t.categoryId);
      const top = topIdOf(categoryMap, t.categoryId);
      if (top !== drillId) return;
      const key = cat?.parentId ? cat.id : "__direct__";
      const label = cat?.parentId ? cat.name : "Non classé (catégorie principale)";
      if (!map[key]) map[key] = { name: label, value: 0, icon: cat?.icon || "✨" };
      map[key].value += Math.abs(t.amount);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [drillId, monthTx, categoryMap]);

  const drillMeta = drillId ? catMeta(categoryMap, drillId) : null;

  return (
    <div>
      <SectionTitle>Revenus vs Dépenses (6 mois)</SectionTitle>
      <div style={{ height: 170 }}>
        <ResponsiveContainer>
          <BarChart data={last6Months}>
            <XAxis dataKey="label" stroke={COLORS.textDim} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: COLORS.text }}
            />
            <Bar dataKey="Revenus" fill={COLORS.mint} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Dépenses" fill={COLORS.coral} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {!drillId ? (
        <>
          <SectionTitle>Répartition par catégorie</SectionTitle>
          {byCategory.length === 0 && <EmptyState text="Pas encore de dépenses ce mois-ci." />}
          {byCategory.map((c) => {
            const hasSub = categories.some((cc) => cc.parentId === c.id);
            return (
              <button
                key={c.id}
                onClick={() => hasSub && setDrillId(c.id)}
                style={{
                  display: "block", width: "100%", background: "none", border: "none", padding: 0,
                  marginBottom: 10, textAlign: "left", cursor: hasSub ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.text }}>
                    {c.icon} {c.name}
                  </span>
                  <span style={{ color: COLORS.textDim, display: "flex", alignItems: "center", gap: 4 }}>
                    {fmt(c.value)} {hasSub && <ChevronRight size={13} />}
                  </span>
                </div>
                <div style={{ height: 6, background: COLORS.surface2, borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (c.value / (byCategory[0]?.value || 1)) * 100)}%`, background: c.color, borderRadius: 4 }} />
                </div>
              </button>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 10px" }}>
            <button onClick={() => setDrillId(null)} style={{ background: COLORS.surface2, border: "none", color: COLORS.text, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={15} />
            </button>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{drillMeta.icon} {drillMeta.name} · sous-catégories</div>
          </div>
          {subBreakdown.length === 0 && <EmptyState text="Pas de détail par sous-catégorie ce mois-ci." />}
          {subBreakdown.map((s, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span>{s.icon} {s.name}</span><span style={{ color: COLORS.textDim }}>{fmt(s.value)}</span>
              </div>
              <div style={{ height: 6, background: COLORS.surface2, borderRadius: 4 }}>
                <div style={{ height: "100%", width: `${Math.min(100, (s.value / (subBreakdown[0]?.value || 1)) * 100)}%`, background: drillMeta.color, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AccountsTab({
  accounts, onAdd, onEditBalance, onEditInitialBalance, cloudStatus, lastSynced, onSaveDrive, onLoadDrive, onExportCSV, onExportExcel,
  categories, onAddCategory, onAddSubcategory, onDeleteCategory,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingInitialId, setEditingInitialId] = useState(null);
  const statusLabel = {
    idle: "Pas encore synchronisé",
    syncing: "Synchronisation…",
    synced: lastSynced ? `Dernière sync : ${lastSynced.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Synchronisé",
    error: "Échec de synchronisation",
  }[cloudStatus];

  return (
    <div>
      <SectionTitle>Sauvegarde cloud</SectionTitle>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: COLORS.surface2,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: cloudStatus === "error" ? COLORS.coral : cloudStatus === "synced" ? COLORS.mint : COLORS.gold,
          }}>
            <Cloud size={18} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Google Drive</div>
            <div style={{ fontSize: 11, color: COLORS.textDim }}>{statusLabel}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onSaveDrive} disabled={cloudStatus === "syncing"} style={{
            flex: 1, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 10,
            padding: "9px 0", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: cloudStatus === "syncing" ? 0.6 : 1,
          }}>
            <CloudUpload size={14} /> Sauvegarder
          </button>
          <button onClick={onLoadDrive} disabled={cloudStatus === "syncing"} style={{
            flex: 1, background: "transparent", border: `1.5px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 10,
            padding: "9px 0", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: cloudStatus === "syncing" ? 0.6 : 1,
          }}>
            <CloudDownload size={14} /> Restaurer
          </button>
        </div>
      </div>

      <SectionTitle>Exporter les données</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button onClick={onExportExcel} style={{
          flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 12,
          padding: "12px 0", fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        }}>
          <FileSpreadsheet size={18} color={COLORS.mint} /> Excel (.xlsx)
        </button>
        <button onClick={onExportCSV} style={{
          flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 12,
          padding: "12px 0", fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        }}>
          <FileDown size={18} color={COLORS.sky} /> CSV
        </button>
      </div>

      <CategoryManager categories={categories} onAdd={onAddCategory} onAddSub={onAddSubcategory} onDelete={onDeleteCategory} />

      <SectionTitle>Vos comptes</SectionTitle>
      {accounts.map((a) => {
        const Icon = ACCOUNT_ICONS[a.type] || Landmark;
        return (
          <div key={a.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.gold }}>
                <Icon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: COLORS.textDim }}>{a.type}</div>
              </div>
              {editingId === a.id ? (
                <input
                  autoFocus type="number" defaultValue={a.balance}
                  onBlur={(e) => { onEditBalance(a.id, e.target.value); setEditingId(null); }}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                  style={{ width: 90, background: COLORS.bg, border: `1px solid ${COLORS.gold}`, borderRadius: 8, color: COLORS.text, padding: "6px 8px", fontSize: 14, textAlign: "right" }}
                />
              ) : (
                <button onClick={() => setEditingId(a.id)} style={{ background: "none", border: "none", fontSize: 15, fontWeight: 600, color: COLORS.text, padding: 4 }}>
                  {fmt(a.balance)}
                </button>
              )}
            </div>

            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}`,
            }}>
              <span style={{ fontSize: 11, color: COLORS.textDim }}>Solde initial</span>
              {editingInitialId === a.id ? (
                <input
                  autoFocus type="number" defaultValue={a.initialBalance || 0}
                  onBlur={(e) => { onEditInitialBalance(a.id, e.target.value); setEditingInitialId(null); }}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                  style={{ width: 90, background: COLORS.bg, border: `1px solid ${COLORS.gold}`, borderRadius: 8, color: COLORS.text, padding: "5px 8px", fontSize: 12.5, textAlign: "right" }}
                />
              ) : (
                <button onClick={() => setEditingInitialId(a.id)} style={{ background: "none", border: "none", fontSize: 12.5, fontWeight: 600, color: COLORS.textDim, padding: 4 }}>
                  {fmt(a.initialBalance || 0)}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 10.5, color: COLORS.textDim, marginTop: -4, marginBottom: 10 }}>
        Touchez le solde actuel pour le forcer (le solde initial est recalculé automatiquement).
        Touchez le solde initial pour le corriger directement — le solde actuel s'ajuste tout seul.
      </div>
      <button onClick={onAdd} style={{
        width: "100%", marginTop: 6, background: "none", border: `1.5px dashed ${COLORS.border}`,
        color: COLORS.textDim, borderRadius: 14, padding: 14, fontSize: 13, display: "flex",
        alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        <Plus size={16} /> Ajouter un compte
      </button>
    </div>
  );
}

function CategoryManager({ categories, onAdd, onAddSub, onDelete }) {
  const [expanded, setExpanded] = useState(null);
  const [newTop, setNewTop] = useState(false);
  const [topName, setTopName] = useState("");
  const [topIcon, setTopIcon] = useState("");
  const [topColor, setTopColor] = useState(PALETTE[0]);
  const [subFor, setSubFor] = useState(null);
  const [subName, setSubName] = useState("");
  const [subIcon, setSubIcon] = useState("");

  const tops = categories.filter((c) => !c.parentId);

  const submitTop = () => {
    if (!topName.trim()) return;
    onAdd(topName, topIcon, topColor);
    setTopName(""); setTopIcon(""); setTopColor(PALETTE[0]); setNewTop(false);
  };
  const submitSub = (parentId) => {
    if (!subName.trim()) return;
    onAddSub(parentId, subName, subIcon);
    setSubName(""); setSubIcon(""); setSubFor(null);
  };

  return (
    <>
      <SectionTitle right={
        <button onClick={() => setNewTop((v) => !v)} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={13} /> Catégorie
        </button>
      }>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Tags size={13} /> Catégories</span>
      </SectionTitle>

      {newTop && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={topIcon} onChange={(e) => setTopIcon(e.target.value)} placeholder="🏷️" maxLength={2}
              style={{ width: 44, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 0", fontSize: 15 }} />
            <input value={topName} onChange={(e) => setTopName(e.target.value)} placeholder="Nom de la catégorie"
              style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {PALETTE.map((c) => (
              <button key={c} onClick={() => setTopColor(c)} style={{
                width: 20, height: 20, borderRadius: "50%", background: c, border: topColor === c ? `2px solid ${COLORS.text}` : "2px solid transparent",
              }} />
            ))}
          </div>
          <button onClick={submitTop} style={{ width: "100%", marginTop: 10, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 700 }}>
            Ajouter
          </button>
        </div>
      )}

      {tops.map((c) => {
        const subs = categories.filter((s) => s.parentId === c.id);
        const isOpen = expanded === c.id;
        const isCore = c.name === "Revenu" || c.name === "Virement" || c.name === "Autre";
        return (
          <div key={c.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
              <button onClick={() => setExpanded(isOpen ? null : c.id)} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 8, flex: 1, color: COLORS.text, textAlign: "left" }}>
                {isOpen ? <ChevronLeft size={13} style={{ transform: "rotate(-90deg)" }} /> : <ChevronRight size={13} />}
                <span>{c.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                {subs.length > 0 && <span style={{ fontSize: 10.5, color: COLORS.textDim }}>({subs.length})</span>}
              </button>
              {!isCore && (
                <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {isOpen && (
              <div style={{ padding: "0 12px 12px 34px" }}>
                {subs.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12.5, color: COLORS.textDim }}>
                    <span>{s.icon}</span><span style={{ flex: 1 }}>{s.name}</span>
                    <button onClick={() => onDelete(s.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {subFor === c.id ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <input value={subIcon} onChange={(e) => setSubIcon(e.target.value)} placeholder="🏷️" maxLength={2}
                      style={{ width: 38, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 0", fontSize: 13 }} />
                    <input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Sous-catégorie" autoFocus
                      onKeyDown={(e) => e.key === "Enter" && submitSub(c.id)}
                      style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 10px", fontSize: 12.5 }} />
                    <button onClick={() => submitSub(c.id)} style={{ background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 700 }}>OK</button>
                  </div>
                ) : (
                  <button onClick={() => setSubFor(c.id)} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <Plus size={12} /> Sous-catégorie
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function EmptyState({ text }) {
  return <div style={{ fontSize: 12.5, color: COLORS.textDim, textAlign: "center", padding: "20px 10px" }}>{text}</div>;
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: COLORS.surface, width: "100%", borderRadius: "22px 22px 0 0", padding: 20, maxHeight: "85%", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: COLORS.surface2, border: "none", color: COLORS.text, borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function fieldStyle() {
  return { width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.text, padding: "10px 12px", fontSize: 13.5, marginTop: 4 };
}
function labelStyle() {
  return { fontSize: 11.5, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.04em" };
}

function AddTransactionModal({ accounts, formAccounts, categories, onClose, onSave, onTransfer }) {
  const srcAccounts = formAccounts && formAccounts.length > 0 ? formAccounts : accounts;
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const topOptions = categories.filter((c) => !c.parentId && c.name !== "Virement" && (type === "income" ? (c.name === "Revenu" || c.name === "Autre") : c.name !== "Revenu"));
  const [topCatId, setTopCatId] = useState(topOptions[0]?.id || "");
  const [subCatId, setSubCatId] = useState("");
  const [accountId, setAccountId] = useState(srcAccounts[0]?.id || "");
  const [fromId, setFromId] = useState(srcAccounts[0]?.id || "");
  const [toId, setToId] = useState(accounts.find((a) => a.id !== srcAccounts[0]?.id)?.id || accounts[0]?.id || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const opts = categories.filter((c) => !c.parentId && c.name !== "Virement" && (type === "income" ? (c.name === "Revenu" || c.name === "Autre") : c.name !== "Revenu"));
    setTopCatId(opts[0]?.id || "");
    setSubCatId("");
  }, [type]); // eslint-disable-line

  const subOptions = categories.filter((c) => c.parentId === topCatId);
  const isTransfer = type === "transfer";
  const canSave = isTransfer
    ? amount && Number(amount) > 0 && fromId && toId && fromId !== toId
    : amount && Number(amount) > 0 && accountId && topCatId;

  const handleSave = () => {
    if (isTransfer) {
      onTransfer({ amount: Number(amount), fromId, toId, date, label });
    } else {
      onSave({ type, amount: Number(amount), label, categoryId: subCatId || topCatId, accountId, date });
    }
  };

  return (
    <ModalShell title={isTransfer ? "Nouveau transfert" : "Nouvelle transaction"} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["expense", "Dépense", COLORS.coral], ["income", "Revenu", COLORS.mint], ["transfer", "Transfert", COLORS.sky]].map(([val, lab, col]) => (
          <button key={val} onClick={() => setType(val)} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, border: `1.5px solid ${type === val ? col : COLORS.border}`,
            background: type === val ? `${col}22` : "transparent", color: type === val ? col : COLORS.textDim, fontWeight: 600, fontSize: 12.5,
          }}>{lab}</button>
        ))}
      </div>

      <label style={labelStyle()}>Montant</label>
      <input style={fieldStyle()} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Description {isTransfer ? "(optionnel)" : ""}</label>
      <input style={fieldStyle()} type="text" placeholder={isTransfer ? "Ex : Épargne du mois" : "Ex : Courses Marjane"} value={label} onChange={(e) => setLabel(e.target.value)} />

      {isTransfer ? (
        <>
          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Depuis le compte</label>
          <select style={fieldStyle()} value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {srcAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Vers le compte</label>
          <select style={fieldStyle()} value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {fromId === toId && (
            <div style={{ fontSize: 11, color: COLORS.coral, marginTop: 6 }}>Choisissez deux comptes différents.</div>
          )}
        </>
      ) : (
        <>
          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Catégorie</label>
          <select style={fieldStyle()} value={topCatId} onChange={(e) => { setTopCatId(e.target.value); setSubCatId(""); }}>
            {topOptions.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>

          {subOptions.length > 0 && (
            <>
              <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Sous-catégorie (optionnel)</label>
              <select style={fieldStyle()} value={subCatId} onChange={(e) => setSubCatId(e.target.value)}>
                <option value="">Aucune</option>
                {subOptions.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </>
          )}

          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Compte</label>
          <select style={fieldStyle()} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {srcAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </>
      )}

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Date</label>
      <input style={fieldStyle()} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

      <button
        disabled={!canSave}
        onClick={handleSave}
        style={{
          width: "100%", marginTop: 18, padding: 13, borderRadius: 12, border: "none",
          background: canSave ? COLORS.gold : COLORS.surface2, color: canSave ? COLORS.bg : COLORS.textDim,
          fontWeight: 700, fontSize: 14,
        }}
      >
        {isTransfer ? "Transférer" : "Enregistrer"}
      </button>
    </ModalShell>
  );
}

function AddAccountModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Banque");
  const [balance, setBalance] = useState("");

  return (
    <ModalShell title="Nouveau compte" onClose={onClose}>
      <label style={labelStyle()}>Nom du compte</label>
      <input style={fieldStyle()} type="text" placeholder="Ex : Livret d'épargne" value={name} onChange={(e) => setName(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Type</label>
      <select style={fieldStyle()} value={type} onChange={(e) => setType(e.target.value)}>
        {Object.keys(ACCOUNT_ICONS).map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Solde initial</label>
      <input style={fieldStyle()} type="number" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)} />

      <button
        disabled={!name}
        onClick={() => onSave({ name, type, balance })}
        style={{
          width: "100%", marginTop: 18, padding: 13, borderRadius: 12, border: "none",
          background: name ? COLORS.gold : COLORS.surface2, color: name ? COLORS.bg : COLORS.textDim,
          fontWeight: 700, fontSize: 14,
        }}
      >
        Ajouter le compte
      </button>
    </ModalShell>
  );
}
