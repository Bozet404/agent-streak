# Agent Streak

Daily check-in streaks for Agent ID holders — with soulbound milestone badges.

Built for the **Binance Agent ID Hackathon** (submission period 18 Nov – 9 Dec 2026).
One contract, one static website, no server, no fees, no token sale.

## What it is

Agent Streak is a simple daily habit game for people who hold an Agent ID:

1. **Hold an Agent ID** — only addresses holding an Agent ID can play.
2. **Check in once per UTC day** — each check-in extends your streak by one.
   Miss a day and the streak resets to 1 (your best streak is kept).
3. **Claim soulbound badges** at streak milestones: **3, 7, 14, 30, 60, 90 days**.
   Badges are ERC-721s that can never be transferred — they are yours forever.

Check-ins cost gas only. There is no token, no sale, and no rewards promised.

## How Agent ID is used

Agent ID is the gate **and** the identity of the whole dApp:

- `checkIn()` and `claimBadge()` both require `balanceOf(msg.sender) > 0` on the
  Agent ID registry contract — no Agent ID, no interaction.
- Streaks, totals and badges are all tracked per wallet address, so an Agent ID
  holder's history is their on-chain identity in the game.
- The frontend shows whether the connected wallet holds an Agent ID before
  anything else.

## Contract

| Item | Value |
|---|---|
| Contract | `AgentStreak` (`contracts/AgentStreak.sol`) |
| Network | BNB Smart Chain mainnet (chain id 56) |
| Address | [`0x354D387C50F130B4297C2ED5bF658af1caFbB83B`](https://bscscan.com/address/0x354D387C50F130B4297C2ED5bF658af1caFbB83B) (deployed 2026-11-18) |
| Owner | `0xA0040b85F1F9Ae44956D748472B80daD70EC3C56` (user's Agent ID wallet) |
| Agent ID registry | `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |
| Token | `Agent Streak Badge` (`STREAK`), ERC-721 soulbound |
| BscScan | verify with `flattened/AgentStreak.flattened.sol` (Solidity 0.8.24, optimizer on, 200 runs) |

### Owner permissions — full disclosure

The contract is `Ownable` + `Pausable` and that is **all** the owner can do:

- `pause()` / `unpause()` — emergency stop for `checkIn()` and `claimBadge()`
  only. No other function is pausable or owner-gated.
- There are **no fees, no mint price, no treasury, no withdrawal function,
  no upgradeability, no allowlist, and no way to move user funds or badges**.
  The Agent ID registry address is immutable and set once in the constructor.

### Key functions

- `checkIn()` — check in for today (Agent ID holders only, once per UTC day).
  Emits `CheckIn(user, day, streak, totalCheckIns)`.
- `claimBadge(uint256 milestone)` — mint the soulbound badge for a reached
  milestone. Emits `BadgeClaimed(user, milestone, tokenId)`.
- `getUserInfo(address)` → `(currentStreak, maxStreak, totalCheckIns, lastCheckInDay)`
- `canCheckIn(address)` → `bool`
- `getParticipantsCount()` / `getParticipants(offset, limit)` (limit capped at 200)
- `badgeOf(address, milestone)` / `hasBadge(address, milestone)`
- `tokenURI(tokenId)` — fully on-chain base64 JSON with an inline SVG image.

## Website

Static site in `web/` (`index.html` + `app.js` + `style.css`). No build step,
no server, no keys. Deploy it anywhere static hosting works — e.g. GitHub Pages.

- Wallet: injected provider only (`window.ethereum`, e.g. Binance Wallet /
  MetaMask). **No WalletConnect, no QR login, no session storage.**
- The contract address lives in exactly one place: the `CONFIG` object at the
  top of `web/app.js` (set to the deployed address).
- Reads (leaderboard, recent check-ins) use a public RPC so they work without
  a wallet connected.

## Development

```bash
npm install
npx hardhat test        # 13 tests, all green
npx hardhat compile
```

### Deploy (BSC mainnet)

```bash
cp .env.example .env    # fill in DEPLOYER_KEY (never commit .env)
AGENT_ID_ADDRESS=0x60b9262456de011f7d15a54cdd8c48baaa8b022f \
  npx hardhat run scripts/deploy.js --network bsc
```

This prints the deployed address and writes `deployment.json`. Then:

1. Put the address in `web/app.js` (`CONFIG.CONTRACT_ADDRESS`).
2. Verify the source on BscScan with `flattened/AgentStreak.flattened.sol`
   (regenerate with `npx hardhat flatten contracts/AgentStreak.sol >
   flattened/AgentStreak.flattened.sol` after any contract change).
3. Record the address in the table above and deploy `web/` to GitHub Pages.

## Safety notes

- Users always confirm their own transactions in their own wallet. The site
  never asks for a seed phrase, private key, or pairing code.
- The project never promises returns, income, or any monetary reward.
- Badges are soulbound: they cannot be transferred, sold, or moved by anyone,
  including the owner.

## License

MIT — see [LICENSE](LICENSE).
