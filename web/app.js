// Agent Streak frontend — static site, no server, no keys.
// Wallet: injected provider only (window.ethereum). No WalletConnect, no QR.

"use strict";

// ---------------------------------------------------------------------------
// CONFIG — the contract address lives ONLY here. Fill it in after deployment.
// ---------------------------------------------------------------------------
const CONFIG = {
  CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000", // TODO: set after mainnet deploy
  AGENT_ID_ADDRESS: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  CHAIN_ID: 56,
  RPC_URL: "https://bsc-dataseed.binance.org",
  BSCSCAN: "https://bscscan.com",
  MILESTONES: [3, 7, 14, 30, 60, 90],
  RECENT_BLOCKS: 20000,
  LEADERBOARD_TOP: 50,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEPLOYED = CONFIG.CONTRACT_ADDRESS.toLowerCase() !== ZERO_ADDRESS;

const STREAK_ABI = [
  "function checkIn()",
  "function claimBadge(uint256 milestone)",
  "function getUserInfo(address user) view returns (uint256 currentStreak, uint256 maxStreak, uint256 totalCheckIns, uint256 lastCheckInDay)",
  "function canCheckIn(address user) view returns (bool)",
  "function getParticipantsCount() view returns (uint256)",
  "function getParticipants(uint256 offset, uint256 limit) view returns (address[])",
  "function badgeOf(address user, uint256 milestone) view returns (uint256)",
  "function hasBadge(address user, uint256 milestone) view returns (bool)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event CheckIn(address indexed user, uint256 indexed day, uint256 streak, uint256 totalCheckIns)",
  "event BadgeClaimed(address indexed user, uint256 indexed milestone, uint256 indexed tokenId)",
];

const AGENT_ID_ABI = ["function balanceOf(address owner) view returns (uint256)"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let readProvider = null;
let readContract = null;
let agentIdContract = null;
let walletProvider = null;
let signer = null;
let userAddress = null;
let userInfo = null; // { currentStreak, maxStreak, totalCheckIns, lastCheckInDay }
let holdsAgentId = false;
let badgeImages = {}; // milestone -> data URI image (fetched from tokenURI when owned)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function shortAddr(a) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}

function setStatus(msg, isError) {
  const el = $("statusMsg");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function nextUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

// ---------------------------------------------------------------------------
// Public data (no wallet needed)
// ---------------------------------------------------------------------------
async function loadPublic() {
  if (!DEPLOYED) return;
  try {
    const count = await readContract.getParticipantsCount();
    $("statParticipants").textContent = count.toString();
  } catch (e) {
    $("statParticipants").textContent = "–";
  }
  await loadLeaderboard();
  await loadRecent();
}

async function loadLeaderboard() {
  const box = $("leaderboard");
  try {
    const count = Number(await readContract.getParticipantsCount());
    if (count === 0) {
      box.innerHTML = '<p class="muted">No participants yet. Be the first to check in.</p>';
      return;
    }
    const addresses = [];
    for (let offset = 0; offset < count; offset += 200) {
      const page = await readContract.getParticipants(offset, 200);
      addresses.push(...page);
    }
    const rows = await Promise.all(
      addresses.map(async (addr) => {
        const info = await readContract.getUserInfo(addr);
        return {
          address: addr,
          currentStreak: Number(info.currentStreak),
          maxStreak: Number(info.maxStreak),
          totalCheckIns: Number(info.totalCheckIns),
        };
      })
    );
    rows.sort((a, b) => b.maxStreak - a.maxStreak || b.totalCheckIns - a.totalCheckIns);
    const top = rows.slice(0, CONFIG.LEADERBOARD_TOP);
    box.innerHTML =
      '<table><thead><tr><th>#</th><th>Address</th><th class="num">Current</th><th class="num">Best</th><th class="num">Check-ins</th></tr></thead><tbody>' +
      top
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td><td>${shortAddr(r.address)}</td>` +
            `<td class="num">${r.currentStreak}</td><td class="num">${r.maxStreak}</td>` +
            `<td class="num">${r.totalCheckIns}</td></tr>`
        )
        .join("") +
      "</tbody></table>";
  } catch (e) {
    box.innerHTML = '<p class="muted">Leaderboard could not be loaded. Please try again later.</p>';
  }
}

async function loadRecent() {
  const box = $("recent");
  try {
    const latest = await readProvider.getBlockNumber();
    const from = Math.max(0, latest - CONFIG.RECENT_BLOCKS);
    const events = await readContract.queryFilter(readContract.filters.CheckIn, from, latest);
    const last = events.slice(-20).reverse();
    if (last.length === 0) {
      box.innerHTML = '<p class="muted">No check-ins in the recent blocks yet.</p>';
      return;
    }
    const rows = await Promise.all(
      last.map(async (ev) => {
        const block = await readProvider.getBlock(ev.blockNumber);
        const time = new Date(block.timestamp * 1000).toUTCString().slice(17, 22) + " UTC";
        return `<div class="recent-row"><span>${shortAddr(ev.args.user)} checked in — streak ${ev.args.streak.toString()}</span><span class="muted">${time}</span></div>`;
      })
    );
    box.innerHTML = rows.join("");
  } catch (e) {
    box.innerHTML = '<p class="muted">Recent check-ins could not be loaded.</p>';
  }
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
async function renderBadges() {
  const grid = $("badgeGrid");
  grid.innerHTML = "";
  for (const m of CONFIG.MILESTONES) {
    const div = document.createElement("div");
    div.className = "badge";
    let stateHtml = '<p class="badge-state">Connect your wallet to see your badges.</p>';
    let btnHtml = "";

    if (DEPLOYED && userAddress) {
      const owned = await readContract.hasBadge(userAddress, m);
      if (owned) {
        div.classList.add("owned");
        const tokenId = await readContract.badgeOf(userAddress, m);
        if (!badgeImages[m]) {
          try {
            const uri = await readContract.tokenURI(tokenId);
            const json = JSON.parse(atob(uri.split(",")[1]));
            badgeImages[m] = json.image;
          } catch (e) {
            badgeImages[m] = null;
          }
        }
        const img = badgeImages[m]
          ? `<img src="${badgeImages[m]}" alt="${m}-day badge" />`
          : `<div class="badge-num">${m}</div>`;
        stateHtml = `${img}<p class="badge-state owned">Owned — token #${tokenId.toString()}</p>`;
      } else if (holdsAgentId && userInfo && userInfo.maxStreak >= m) {
        div.classList.add("claimable");
        stateHtml = `<div class="badge-num">${m}</div><p class="badge-state claimable">Milestone reached — claim it!</p>`;
        btnHtml = `<button class="btn btn-accent" data-milestone="${m}">Claim Badge</button>`;
      } else {
        const need = userInfo ? Math.max(0, m - userInfo.maxStreak) : m;
        stateHtml = `<div class="badge-num">${m}</div><p class="badge-state">Locked — ${need} more day${need === 1 ? "" : "s"} of streak needed</p>`;
      }
    } else {
      stateHtml = `<div class="badge-num">${m}</div><p class="badge-state">${DEPLOYED ? "Connect your wallet to see your badges." : "Contract not deployed yet."}</p>`;
    }

    div.innerHTML = `<h3>${m}-Day Streak</h3>${stateHtml}${btnHtml}`;
    grid.appendChild(div);
  }
  grid.querySelectorAll("button[data-milestone]").forEach((btn) => {
    btn.addEventListener("click", () => claimBadge(Number(btn.dataset.milestone)));
  });
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------
async function connect() {
  if (!window.ethereum) {
    setStatus("No injected wallet detected. Please install a wallet extension and refresh.", true);
    return;
  }
  try {
    setStatus("Connecting…");
    walletProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await walletProvider.send("eth_requestAccounts", []);
    userAddress = accounts[0];

    const net = await walletProvider.getNetwork();
    if (Number(net.chainId) !== CONFIG.CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + CONFIG.CHAIN_ID.toString(16) }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          // Standard chain metadata for the wallet's "add network" prompt.
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x" + CONFIG.CHAIN_ID.toString(16),
                chainName: "BNB Smart Chain",
                nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                rpcUrls: [CONFIG.RPC_URL],
                blockExplorerUrls: [CONFIG.BSCSCAN],
              },
            ],
          });
        } else {
          throw switchErr;
        }
      }
      walletProvider = new ethers.BrowserProvider(window.ethereum);
    }

    signer = await walletProvider.getSigner();
    userAddress = await signer.getAddress();
    $("connectBtn").textContent = shortAddr(userAddress);
    $("networkBadge").textContent = "BSC Mainnet";
    $("networkBadge").classList.add("ok");
    $("idAddress").textContent = userAddress;

    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());

    await loadUserState();
    setStatus("");
  } catch (e) {
    setStatus("Connection failed: " + (e.reason || e.message || e), true);
  }
}

async function loadUserState() {
  if (!DEPLOYED || !userAddress) return;
  try {
    const balance = await agentIdContract.balanceOf(userAddress);
    holdsAgentId = balance > 0n;
    const idEl = $("idStatus");
    if (holdsAgentId) {
      idEl.textContent = "✓ You hold an Agent ID";
      idEl.className = "big ok";
    } else {
      idEl.textContent = "✗ No Agent ID on this address";
      idEl.className = "big no";
    }

    const info = await readContract.getUserInfo(userAddress);
    userInfo = {
      currentStreak: Number(info.currentStreak),
      maxStreak: Number(info.maxStreak),
      totalCheckIns: Number(info.totalCheckIns),
      lastCheckInDay: Number(info.lastCheckInDay),
    };
    $("statCurrent").textContent = userInfo.currentStreak;
    $("statMax").textContent = userInfo.maxStreak;
    $("statTotal").textContent = userInfo.totalCheckIns;

    const btn = $("checkinBtn");
    if (!holdsAgentId) {
      btn.disabled = true;
      btn.textContent = "You need an Agent ID";
    } else {
      const can = await readContract.canCheckIn(userAddress);
      btn.disabled = !can;
      btn.textContent = can ? "Check In" : "Checked in — come back tomorrow";
    }
    await renderBadges();
  } catch (e) {
    setStatus("Could not load your streak: " + (e.reason || e.message || e), true);
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function checkIn() {
  if (!signer || !DEPLOYED) return;
  const btn = $("checkinBtn");
  try {
    btn.disabled = true;
    setStatus("Sending check-in transaction… confirm in your wallet.");
    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, STREAK_ABI, signer);
    const tx = await contract.checkIn();
    setStatus("Transaction sent (" + tx.hash.slice(0, 18) + "…). Waiting for confirmation…");
    await tx.wait();
    setStatus("Checked in! Streak updated.");
    await loadUserState();
    await loadPublic();
  } catch (e) {
    setStatus("Check-in failed: " + (e.reason || e.message || e), true);
    btn.disabled = false;
  }
}

async function claimBadge(milestone) {
  if (!signer || !DEPLOYED) return;
  try {
    setStatus(`Claiming your ${milestone}-day badge… confirm in your wallet.`);
    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, STREAK_ABI, signer);
    const tx = await contract.claimBadge(milestone);
    setStatus("Transaction sent. Waiting for confirmation…");
    await tx.wait();
    setStatus(`Badge claimed! Your ${milestone}-day soulbound badge is yours.`);
    delete badgeImages[milestone];
    await loadUserState();
  } catch (e) {
    setStatus("Claim failed: " + (e.reason || e.message || e), true);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function tickCountdown() {
  $("statCountdown").textContent = fmtCountdown(nextUtcMidnight() - Date.now());
}

async function init() {
  readProvider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  agentIdContract = new ethers.Contract(CONFIG.AGENT_ID_ADDRESS, AGENT_ID_ABI, readProvider);
  if (DEPLOYED) {
    readContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, STREAK_ABI, readProvider);
    $("contractLink").href = CONFIG.BSCSCAN + "/address/" + CONFIG.CONTRACT_ADDRESS;
    $("contractLink").textContent = "Contract on BscScan: " + shortAddr(CONFIG.CONTRACT_ADDRESS);
  } else {
    $("deployBanner").classList.remove("hidden");
    $("contractLink").textContent = "Contract on BscScan (not deployed yet)";
    $("leaderboard").innerHTML = '<p class="muted">Leaderboard unlocks once the contract is deployed.</p>';
    $("recent").innerHTML = '<p class="muted">Recent check-ins unlock once the contract is deployed.</p>';
  }

  $("connectBtn").addEventListener("click", connect);
  $("checkinBtn").addEventListener("click", checkIn);
  tickCountdown();
  setInterval(tickCountdown, 1000);

  await renderBadges();
  await loadPublic();
}

init();
