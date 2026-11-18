const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DAY = 86400;

async function latestTs() {
  const b = await ethers.provider.getBlock("latest");
  return b.timestamp;
}

async function mineAt(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
  await network.provider.send("evm_mine");
}

/// Start of the UTC day containing the latest block.
async function currentDayStart() {
  const ts = await latestTs();
  return Math.floor(ts / DAY) * DAY;
}

describe("AgentStreak", function () {
  let streak, mockId, owner, alice, bob, carol;

  async function giveId(user, tokenId) {
    await mockId.mint(user.address, tokenId);
  }

  /// Check in `user` right now (current block time = "today").
  async function checkInNow(user) {
    await streak.connect(user).checkIn();
  }

  /// Check in `user` on the UTC day starting at `dayStart` (+1h into the day).
  /// Only call with a dayStart in the future (start + k*DAY, k >= 1).
  async function checkInOn(user, dayStart) {
    await mineAt(dayStart + 3600);
    await streak.connect(user).checkIn();
  }

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const MockAgentID = await ethers.getContractFactory("MockAgentID");
    mockId = await MockAgentID.deploy();
    const AgentStreak = await ethers.getContractFactory("AgentStreak");
    streak = await AgentStreak.deploy(await mockId.getAddress());
  });

  it("reverts checkIn for addresses without an Agent ID", async function () {
    await expect(streak.connect(alice).checkIn()).to.be.revertedWith(
      "AgentStreak: caller does not hold an Agent ID"
    );
  });

  it("reverts on a double check-in on the same UTC day", async function () {
    await giveId(alice, 1);
    await checkInNow(alice);
    await expect(streak.connect(alice).checkIn()).to.be.revertedWith(
      "AgentStreak: already checked in today"
    );
  });

  it("increments the streak across consecutive days", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    await checkInOn(alice, start + 2 * DAY);

    const info = await streak.getUserInfo(alice.address);
    expect(info.currentStreak).to.equal(3);
    expect(info.maxStreak).to.equal(3);
    expect(info.totalCheckIns).to.equal(3);
    expect(info.lastCheckInDay).to.equal(Math.floor((start + 2 * DAY + 3600) / DAY));

    // Already checked in today, but free to check in tomorrow.
    expect(await streak.canCheckIn(alice.address)).to.equal(false);
    await mineAt(start + 3 * DAY + 3600);
    expect(await streak.canCheckIn(alice.address)).to.equal(true);
  });

  it("resets the streak after a missed day but keeps maxStreak", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    // Skip one full day, check in the day after.
    await checkInOn(alice, start + 3 * DAY);

    const info = await streak.getUserInfo(alice.address);
    expect(info.currentStreak).to.equal(1);
    expect(info.maxStreak).to.equal(2);
    expect(info.totalCheckIns).to.equal(3);
  });

  it("lets a user claim a badge at a reached milestone", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    await checkInOn(alice, start + 2 * DAY);

    await expect(streak.connect(alice).claimBadge(3))
      .to.emit(streak, "BadgeClaimed")
      .withArgs(alice.address, 3, 1);

    expect(await streak.ownerOf(1)).to.equal(alice.address);
    expect(await streak.hasBadge(alice.address, 3)).to.equal(true);
    expect(await streak.badgeOf(alice.address, 3)).to.equal(1);

    // On-chain metadata decodes to a JSON doc naming the milestone.
    const uri = await streak.tokenURI(1);
    expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
    expect(json.name).to.equal("Agent Streak Badge - 3-Day Streak");
    expect(json.attributes[0].value).to.equal(3);
    expect(json.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
  });

  it("reverts a double claim of the same milestone", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    await checkInOn(alice, start + 2 * DAY);
    await streak.connect(alice).claimBadge(3);
    await expect(streak.connect(alice).claimBadge(3)).to.be.revertedWith(
      "AgentStreak: badge already claimed"
    );
  });

  it("reverts a claim of an unreached milestone", async function () {
    await giveId(alice, 1);
    await checkInNow(alice); // streak 1, maxStreak 1
    await expect(streak.connect(alice).claimBadge(7)).to.be.revertedWith(
      "AgentStreak: milestone not reached"
    );
  });

  it("reverts a claim of an invalid milestone", async function () {
    await giveId(alice, 1);
    await expect(streak.connect(alice).claimBadge(5)).to.be.revertedWith(
      "AgentStreak: invalid milestone"
    );
  });

  it("makes badges soulbound: transferFrom and safeTransferFrom both revert", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    await checkInOn(alice, start + 2 * DAY);
    await streak.connect(alice).claimBadge(3);

    await expect(
      streak.connect(alice).transferFrom(alice.address, bob.address, 1)
    ).to.be.revertedWith("AgentStreak: badge is soulbound");
    await expect(
      streak.connect(alice)["safeTransferFrom(address,address,uint256)"](
        alice.address,
        bob.address,
        1
      )
    ).to.be.revertedWith("AgentStreak: badge is soulbound");
    expect(await streak.ownerOf(1)).to.equal(alice.address);
  });

  it("enumerates participants in order, with pagination", async function () {
    await giveId(alice, 1);
    await giveId(bob, 2);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInNow(bob);

    expect(await streak.getParticipantsCount()).to.equal(2);
    expect(await streak.isParticipant(alice.address)).to.equal(true);
    expect(await streak.isParticipant(carol.address)).to.equal(false);

    const all = await streak.getParticipants(0, 200);
    expect(all).to.deep.equal([alice.address, bob.address]);
    expect(await streak.getParticipants(1, 200)).to.deep.equal([bob.address]);
    expect(await streak.getParticipants(0, 1)).to.deep.equal([alice.address]);
    expect(await streak.getParticipants(5, 200)).to.deep.equal([]);
    // Limit is capped at 200 (asking for 500 still returns only the 2 that exist).
    expect(await streak.getParticipants(0, 500)).to.deep.equal([alice.address, bob.address]);

    // A second check-in does not add the user twice.
    await checkInOn(alice, start + DAY);
    expect(await streak.getParticipantsCount()).to.equal(2);
  });

  it("emits the CheckIn event with day, streak and totals", async function () {
    await giveId(alice, 1);
    const tx = await streak.connect(alice).checkIn();
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const day = Math.floor(block.timestamp / DAY);
    await expect(tx).to.emit(streak, "CheckIn").withArgs(alice.address, day, 1, 1);
  });

  it("pause blocks checkIn and claimBadge; unpause restores them", async function () {
    await giveId(alice, 1);
    const start = await currentDayStart();
    await checkInNow(alice);
    await checkInOn(alice, start + DAY);
    await checkInOn(alice, start + 2 * DAY);

    // Only the owner can pause.
    await expect(streak.connect(alice).pause()).to.be.revertedWithCustomError(
      streak,
      "OwnableUnauthorizedAccount"
    );

    await streak.pause();
    await expect(streak.connect(alice).checkIn()).to.be.revertedWithCustomError(
      streak,
      "EnforcedPause"
    );
    await expect(streak.connect(alice).claimBadge(3)).to.be.revertedWithCustomError(
      streak,
      "EnforcedPause"
    );

    await streak.unpause();
    await checkInOn(alice, start + 3 * DAY);
    await streak.connect(alice).claimBadge(3);
    expect(await streak.ownerOf(1)).to.equal(alice.address);
  });

  it("canCheckIn is false for non-holders", async function () {
    expect(await streak.canCheckIn(carol.address)).to.equal(false);
    await giveId(carol, 9);
    expect(await streak.canCheckIn(carol.address)).to.equal(true);
  });
});
